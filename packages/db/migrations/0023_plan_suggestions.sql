-- Generating the plan (spec 25b).
--
-- On a click the moderator writes the plan; its text arrives as one suggestion per section, and
-- nothing enters the plan before an owner or editor accepts it. The worker writes the suggestions;
-- people start a generation and decide the suggestions through the functions below.
-- RLS, policies and grants for covibes_app in this same migration.

-- A generation is a run of its own kind, metered like every other.
alter table public.ai_runs drop constraint ai_runs_kind_check;
alter table public.ai_runs
  add constraint ai_runs_kind_check check (kind in ('reply', 'observe', 'summary', 'plan'));

create table public.plan_suggestions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The generation the suggestion came from.
  run_id uuid references public.ai_runs (id) on delete set null,
  section text not null check (section in ('scope', 'milestones', 'tech', 'risks', 'costs')),
  -- The suggested text as the nodes of the plan's document.
  content jsonb not null check (jsonb_typeof(content) = 'array'),
  -- replaced: a later generation made a new suggestion for the section before anyone decided.
  status text not null default 'open'
    check (status in ('open', 'accepted', 'rejected', 'replaced')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users (id) on delete set null,
  check ((status = 'open') = (decided_at is null))
);

-- One open suggestion per section.
create unique index plan_suggestions_one_open_per_section
  on public.plan_suggestions (project_id, section) where status = 'open';
create index plan_suggestions_project_id_created_at_idx
  on public.plan_suggestions (project_id, created_at);

alter table public.plan_suggestions enable row level security;

revoke all on public.plan_suggestions from public;
grant select on public.plan_suggestions to covibes_app;

create policy "plan_suggestions: members read"
  on public.plan_suggestions for select to covibes_app
  using (private.is_member(project_id));

-- Starting a generation ---------------------------------------------------------------------------

-- Owners and editors start a generation; one runs at a time per project. A run that neither
-- finished nor failed within ten minutes is taken as lost, so it cannot block the plan for good.
create function public.start_plan_generation(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors generate the plan' using errcode = '42501';
  end if;
  -- One at a time, also when two people click in the same moment.
  perform 1 from public.projects where id = p_project_id for update;
  if exists (
    select 1
    from public.ai_runs r
    where r.project_id = p_project_id
      and r.kind = 'plan'
      and r.status in ('queued', 'running')
      and r.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'A generation is running already' using errcode = '55000';
  end if;

  insert into public.ai_runs (project_id, agent_key, kind, status)
  values (p_project_id, 'moderator', 'plan', 'queued')
  returning id into v_run_id;

  -- One try: a generation that fails says so, and someone starts it again.
  perform graphile_worker.add_job(
    'plan_generate',
    json_build_object('runId', v_run_id),
    max_attempts => 1
  );
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'plan', 'projectId', p_project_id)::text
  );
  return v_run_id;
end;
$$;

revoke all on function public.start_plan_generation(uuid) from public;
grant execute on function public.start_plan_generation(uuid) to covibes_app;

-- Deciding suggestions ----------------------------------------------------------------------------

-- Owners and editors accept or reject a suggestion; the server writes an accepted one into the
-- plan in the same transaction. `p_suggestion_id` null decides all open ones of the project.
create function public.decide_plan_suggestions(
  p_project_id uuid,
  p_suggestion_id uuid,
  p_status text
)
returns setof public.plan_suggestions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('accepted', 'rejected') then
    raise exception 'A suggestion is accepted or rejected' using errcode = '22023';
  end if;
  if not private.is_member(p_project_id) then
    raise exception 'No such project' using errcode = 'P0002';
  end if;
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors decide suggestions' using errcode = '42501';
  end if;
  if p_suggestion_id is not null then
    if not exists (
      select 1 from public.plan_suggestions s
      where s.id = p_suggestion_id and s.project_id = p_project_id
    ) then
      raise exception 'No such suggestion' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.plan_suggestions s where s.id = p_suggestion_id and s.status = 'open'
    ) then
      raise exception 'The suggestion is decided already' using errcode = '55000';
    end if;
  end if;

  perform pg_notify(
    'covibes_live', json_build_object('kind', 'plan', 'projectId', p_project_id)::text
  );
  return query
    update public.plan_suggestions s
    set status = p_status, decided_at = now(), decided_by = private.current_user_id()
    where s.project_id = p_project_id
      and s.status = 'open'
      and (p_suggestion_id is null or s.id = p_suggestion_id)
    returning s.*;
end;
$$;

revoke all on function public.decide_plan_suggestions(uuid, uuid, text) from public;
grant execute on function public.decide_plan_suggestions(uuid, uuid, text) to covibes_app;

-- Suggestions wait for the team ---------------------------------------------------------------------

-- A new suggestion schedules the mail about what waits, like a proposal (spec 22b).
create trigger plan_suggestions_schedule_mail
  after insert on public.plan_suggestions
  for each row
  when (new.status = 'open')
  execute function private.schedule_mail_for_waiting();

-- How much waits for the current user in a project (spec 22a), now with the plan's suggestions.
create or replace function public.project_waiting_count(p_project_id uuid)
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
      + (
        select count(*)
        from public.plan_suggestions s
        where s.project_id = p_project_id and s.status = 'open'
      )
    )::integer
  end;
$$;

-- The same for the worker's mails (spec 22b).
create or replace function public.waiting_for_user(p_user_id uuid)
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
      union all
      select s.created_at
      from public.plan_suggestions s
      where s.project_id = m.project_id and s.status = 'open'
    ) waiting_items
  ) items
  where m.user_id = p_user_id and m.role in ('owner', 'editor') and items.waiting > 0
  order by p.name, m.project_id;
$$;
