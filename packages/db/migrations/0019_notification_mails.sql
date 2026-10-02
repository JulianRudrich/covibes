-- Notifications by email (spec 22b).
--
-- A job per person sums up in one mail what they have not seen: unread mentions, a changed role, a
-- removal, and how much waits for them in projects they have not opened since. Triggers schedule
-- the job ten minutes ahead, once per person; the worker sends the mail and notes what it mailed.
-- RLS, policies and grants for covibes_app in this same migration.

-- When a notification went out by mail; null until then.
alter table public.notifications add column mailed_at timestamptz;

-- Per person: the switch for mails, and when the last mail went out (the pause between mails).
create table public.notification_settings (
  user_id uuid primary key references public.users (id) on delete cascade,
  email boolean not null default true,
  last_mail_at timestamptz
);

alter table public.notification_settings enable row level security;

revoke all on public.notification_settings from public;
grant select (user_id, email) on public.notification_settings to covibes_app;
grant insert (user_id, email) on public.notification_settings to covibes_app;
grant update (email) on public.notification_settings to covibes_app;

create policy "notification_settings: own read"
  on public.notification_settings for select to covibes_app
  using (user_id = private.current_user_id());

create policy "notification_settings: own create"
  on public.notification_settings for insert to covibes_app
  with check (user_id = private.current_user_id());

create policy "notification_settings: own change"
  on public.notification_settings for update to covibes_app
  using (user_id = private.current_user_id())
  with check (user_id = private.current_user_id());

-- What a member did last in a project: when they had it open, and when a mail last told them that
-- something waits there. Kept apart from `project_members`, whose changes are announced to
-- everyone. Nobody reads the table directly.
create table public.member_activity (
  project_id uuid not null,
  user_id uuid not null,
  last_seen_at timestamptz,
  waiting_mailed_at timestamptz,
  primary key (project_id, user_id),
  foreign key (project_id, user_id)
    references public.project_members (project_id, user_id) on delete cascade
);

alter table public.member_activity enable row level security;
revoke all on public.member_activity from public;

-- Notes that the current user has the project open right now. The web app reports it while the
-- project is open in a visible tab. Does nothing for someone who is no member.
create function public.touch_project_seen(p_project_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.member_activity (project_id, user_id, last_seen_at)
  select p_project_id, private.current_user_id(), now()
  where private.is_member(p_project_id)
  on conflict (project_id, user_id) do update set last_seen_at = excluded.last_seen_at;
$$;

revoke all on function public.touch_project_seen(uuid) from public;
grant execute on function public.touch_project_seen(uuid) to covibes_app;

-- Scheduling the mail job --------------------------------------------------------------------------

-- One job per person at a time, ten minutes after the first event: whoever is in the app reads it
-- there first. Later events before the job runs join the same mail.
create function private.schedule_notification_mail(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform graphile_worker.add_job(
    'notification_mail',
    json_build_object('userId', p_user_id),
    run_at => now() + interval '10 minutes',
    max_attempts => 3,
    job_key => 'notification_mail:' || p_user_id,
    job_key_mode => 'preserve_run_at'
  );
end;
$$;

revoke all on function private.schedule_notification_mail(uuid) from public;

-- A mention, a changed role and a removal are mailed; that someone joined stays in the app.
create function private.schedule_mail_for_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.schedule_notification_mail(new.user_id);
  return null;
end;
$$;

revoke all on function private.schedule_mail_for_notification() from public;

create trigger notifications_schedule_mail
  after insert on public.notifications
  for each row
  when (new.kind in ('mention', 'role_changed', 'removed'))
  execute function private.schedule_mail_for_notification();

-- Something new waits in a project: for everyone who can act on it.
create function private.schedule_mail_for_waiting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.schedule_notification_mail(m.user_id)
  from public.project_members m
  where m.project_id = new.project_id and m.role in ('owner', 'editor');
  return null;
end;
$$;

revoke all on function private.schedule_mail_for_waiting() from public;

create trigger proposals_schedule_mail
  after insert on public.proposals
  for each row
  when (new.status = 'open')
  execute function private.schedule_mail_for_waiting();

create trigger hand_raises_schedule_mail
  after insert on public.hand_raises
  for each row
  when (new.status = 'open')
  execute function private.schedule_mail_for_waiting();

create trigger votes_schedule_mail
  after insert on public.votes
  for each row
  when (new.status = 'open')
  execute function private.schedule_mail_for_waiting();

-- What waits for a person, for the worker ------------------------------------------------------------

-- Per project how much waits for `p_user_id` (as `project_waiting_count` counts it for the current
-- user), when the newest of it appeared, when the person last had the project open and when a
-- mail last told them. Only the worker calls it.
create function public.waiting_for_user(p_user_id uuid)
returns table (
  project_id uuid,
  project_name text,
  waiting integer,
  newest timestamptz,
  last_seen_at timestamptz,
  waiting_mailed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.project_id, p.name, items.waiting::integer, items.newest, a.last_seen_at,
    a.waiting_mailed_at
  from public.project_members m
  join public.projects p on p.id = m.project_id
  left join public.member_activity a on a.project_id = m.project_id and a.user_id = m.user_id
  cross join lateral (
    select count(*) as waiting, max(waiting_items.created_at) as newest
    from (
      select pr.created_at
      from public.proposals pr
      where pr.project_id = m.project_id
        and pr.status = 'open'
        and (
          pr.kind not in ('decision', 'variants')
          or coalesce(p.settings ->> 'decisionProcess', 'consensus') <> 'owner'
          or m.role = 'owner'
        )
      union all
      select h.created_at
      from public.hand_raises h
      where h.project_id = m.project_id and h.status = 'open'
      union all
      select v.created_at
      from public.votes v
      where v.project_id = m.project_id
        and v.status = 'open'
        and not exists (
          select 1
          from public.vote_ballots b
          where b.vote_id = v.id and b.user_id = m.user_id
        )
    ) waiting_items
  ) items
  where m.user_id = p_user_id and m.role in ('owner', 'editor') and items.waiting > 0
  order by p.name, m.project_id;
$$;

revoke all on function public.waiting_for_user(uuid) from public;
