-- "Since you were away" (spec 23).
--
-- A member who did not have a project open for at least an hour is back when they open it again.
-- The database notes that absence; the server lists what happened in it, and the worker lets the
-- moderator sum up the conversation when there is enough of it.
-- RLS, policies and grants for covibes_app in this same migration.

-- Per member the last absence: from when to when, the moderator's words about it, and when the
-- member closed the summary. The next return replaces it.
create table public.away_summaries (
  project_id uuid not null,
  user_id uuid not null,
  away_from timestamptz not null,
  back_at timestamptz not null,
  text text check (char_length(text) between 1 and 1200),
  -- none: nothing to sum up; pending: the job waits or runs; done; failed: the model gave nothing.
  text_status text not null default 'none'
    check (text_status in ('none', 'pending', 'done', 'failed')),
  dismissed_at timestamptz,
  primary key (project_id, user_id),
  foreign key (project_id, user_id)
    references public.project_members (project_id, user_id) on delete cascade,
  check (back_at > away_from)
);

alter table public.away_summaries enable row level security;

revoke all on public.away_summaries from public;
grant select on public.away_summaries to covibes_app;
grant update (dismissed_at) on public.away_summaries to covibes_app;

-- A summary is personal: the moderator wrote it for one person.
create policy "away_summaries: own read"
  on public.away_summaries for select to covibes_app
  using (user_id = private.current_user_id());

create policy "away_summaries: own close"
  on public.away_summaries for update to covibes_app
  using (user_id = private.current_user_id())
  with check (user_id = private.current_user_id());

-- The moderator's summaries are metered like every other run.
alter table public.ai_runs drop constraint ai_runs_kind_check;
alter table public.ai_runs
  add constraint ai_runs_kind_check check (kind in ('reply', 'observe', 'summary'));

-- Notes that the current user has the project open right now (spec 22b), and tells whether they
-- are back from an absence: the project was not open for at least an hour. Then the absence is
-- noted, and with five or more messages by others the moderator's summary is scheduled. Does
-- nothing for someone who is no member.
drop function public.touch_project_seen(uuid);

create function public.touch_project_seen(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.current_user_id();
  v_last timestamptz;
  v_messages integer;
begin
  if v_user_id is null or not private.is_member(p_project_id) then
    return false;
  end if;

  -- Locked, so two tabs that report at the same moment note one return.
  select a.last_seen_at into v_last
  from public.member_activity a
  where a.project_id = p_project_id and a.user_id = v_user_id
  for update;

  insert into public.member_activity (project_id, user_id, last_seen_at)
  values (p_project_id, v_user_id, now())
  on conflict (project_id, user_id) do update set last_seen_at = excluded.last_seen_at;

  -- A first visit has nothing to compare with.
  if v_last is null or v_last > now() - interval '1 hour' then
    return false;
  end if;

  select count(*) into v_messages
  from public.messages m
  where m.project_id = p_project_id
    and m.status = 'complete'
    and m.created_at > v_last
    and m.author_user_id is distinct from v_user_id;

  insert into public.away_summaries (project_id, user_id, away_from, back_at, text_status)
  values (
    p_project_id,
    v_user_id,
    v_last,
    now(),
    case when v_messages >= 5 then 'pending' else 'none' end
  )
  on conflict (project_id, user_id) do update
    set away_from = excluded.away_from,
        back_at = excluded.back_at,
        text = null,
        text_status = excluded.text_status,
        dismissed_at = null;

  if v_messages >= 5 then
    -- One try: a summary that fails is left out, the rest of the section stands without it.
    perform graphile_worker.add_job(
      'away_summary',
      json_build_object('projectId', p_project_id, 'userId', v_user_id),
      max_attempts => 1,
      job_key => 'away_summary:' || p_project_id || ':' || v_user_id
    );
  end if;
  return true;
end;
$$;

revoke all on function public.touch_project_seen(uuid) from public;
grant execute on function public.touch_project_seen(uuid) to covibes_app;
