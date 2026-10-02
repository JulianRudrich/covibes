-- Mentions of people, notifications and what waits for someone (spec 22a).
--
-- A message stores the people it mentions; the server decides who that is. Notifications collect
-- for each person what happened while they looked elsewhere: a mention, a changed role, a removal,
-- a new member of an own project. They carry the names they show, so they stay readable for
-- someone who was removed. Triggers write them, so no path skips one. RLS, policies and grants for
-- covibes_app in this same migration.

alter table public.messages
  add column mentioned_users uuid[] not null default '{}'
  check (cardinality(mentioned_users) <= 20);

grant insert (mentioned_users) on public.messages to covibes_app;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('mention', 'role_changed', 'removed', 'joined')),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The names as they were: the person may no longer be allowed to read the project or its people.
  project_name text not null,
  -- Who mentioned, changed the role, removed or joined; null when the system did it.
  actor_id uuid references public.users (id) on delete set null,
  actor_name text not null default '',
  -- A mention: the message and how it starts.
  message_id uuid references public.messages (id) on delete cascade,
  excerpt text not null default '' check (char_length(excerpt) <= 200),
  -- The new role of a changed one, or the role of who joined.
  role public.project_role,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

revoke all on public.notifications from public;
grant select on public.notifications to covibes_app;
grant update (read_at) on public.notifications to covibes_app;

create policy "notifications: own read"
  on public.notifications for select to covibes_app
  using (user_id = private.current_user_id());

create policy "notifications: own mark as read"
  on public.notifications for update to covibes_app
  using (user_id = private.current_user_id())
  with check (user_id = private.current_user_id());

-- A person's message that mentions people notifies them: members of the project only, and never
-- the author.
create function private.notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications
    (user_id, kind, project_id, project_name, actor_id, actor_name, message_id, excerpt)
  select
    m.user_id,
    'mention',
    new.project_id,
    p.name,
    new.author_user_id,
    coalesce(u.name, ''),
    new.id,
    left(btrim(regexp_replace(new.content, '\s+', ' ', 'g')), 200)
  from public.project_members m
  join public.projects p on p.id = m.project_id
  left join public.users u on u.id = new.author_user_id
  where m.project_id = new.project_id
    and m.user_id = any (new.mentioned_users)
    and m.user_id is distinct from new.author_user_id;
  return null;
end;
$$;

revoke all on function private.notify_mentions() from public;

create trigger messages_notify_mentions
  after insert on public.messages
  for each row
  when (new.author_kind = 'human' and cardinality(new.mentioned_users) > 0)
  execute function private.notify_mentions();

-- A change of the members notifies whom it concerns:
-- - a new member: the owners of the project (not the first member, who created it)
-- - a role someone else changed: the member
-- - a member someone else removed: that person
create function private.notify_member_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_user_id();
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_project_name text;
  v_actor_name text;
begin
  -- Gone with the whole project: nothing to tell.
  select p.name into v_project_name from public.projects p where p.id = v_project_id;
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.notifications
      (user_id, kind, project_id, project_name, actor_id, actor_name, role)
    select m.user_id, 'joined', new.project_id, v_project_name, new.user_id, u.name, new.role
    from public.project_members m
    join public.users u on u.id = new.user_id
    where m.project_id = new.project_id and m.role = 'owner' and m.user_id <> new.user_id;
    return null;
  end if;

  select coalesce(u.name, '') into v_actor_name from public.users u where u.id = v_actor;

  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role and v_actor is distinct from new.user_id then
      insert into public.notifications
        (user_id, kind, project_id, project_name, actor_id, actor_name, role)
      values (
        new.user_id, 'role_changed', new.project_id, v_project_name, v_actor,
        coalesce(v_actor_name, ''), new.role
      );
    end if;
    return null;
  end if;

  -- Removed by someone else; an account that is being deleted gets nothing.
  if v_actor is distinct from old.user_id
    and exists (select 1 from public.users u where u.id = old.user_id)
  then
    insert into public.notifications
      (user_id, kind, project_id, project_name, actor_id, actor_name)
    values (
      old.user_id, 'removed', old.project_id, v_project_name, v_actor, coalesce(v_actor_name, '')
    );
  end if;
  return null;
end;
$$;

revoke all on function private.notify_member_changes() from public;

create trigger project_members_notify
  after insert or update or delete on public.project_members
  for each row execute function private.notify_member_changes();

-- How much waits for the current user in a project: open proposals, raised hands, and open votes
-- without their vote. Nothing for viewers and people outside; while only the owner decides,
-- decisions and variants wait for owners only.
create function public.project_waiting_count(p_project_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.has_role(p_project_id, 'editor') then 0
    else (
      (
        select count(*)
        from public.proposals pr
        join public.projects p on p.id = pr.project_id
        where pr.project_id = p_project_id
          and pr.status = 'open'
          and (
            pr.kind not in ('decision', 'variants')
            or coalesce(p.settings ->> 'decisionProcess', 'consensus') <> 'owner'
            or private.has_role(p_project_id, 'owner')
          )
      )
      + (
        select count(*)
        from public.hand_raises h
        where h.project_id = p_project_id and h.status = 'open'
      )
      + (
        select count(*)
        from public.votes v
        where v.project_id = p_project_id
          and v.status = 'open'
          and not exists (
            select 1
            from public.vote_ballots b
            where b.vote_id = v.id and b.user_id = private.current_user_id()
          )
      )
    )::integer
  end;
$$;

revoke all on function public.project_waiting_count(uuid) from public;
grant execute on function public.project_waiting_count(uuid) to covibes_app;
