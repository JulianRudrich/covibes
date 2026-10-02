-- Plan outdated, updates and versions (spec 25c).
--
-- An update is a smaller generation: after decisions or criteria changed, the moderator suggests
-- new text only for the sections the change affects. Every state of the plan is kept as a version:
-- once the suggestions of a generation or update are decided, and before that for a plan people
-- had changed by hand. RLS, policies and grants for covibes_app in this same migration.

-- A suggestion comes from a generation of the whole plan or from an update, and knows whether
-- people changed its section by hand since the moderator last wrote it.
alter table public.plan_suggestions
  add column kind text not null default 'generate' check (kind in ('generate', 'update')),
  add column hand_edited boolean not null default false;

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Counted per project, from 1.
  number integer not null check (number > 0),
  -- The plan as the nodes of its document.
  content jsonb not null check (jsonb_typeof(content) = 'array'),
  -- generated, updated: the suggestions of a generation or update were decided;
  -- manual: the plan as it stood before the first of them was written into it.
  reason text not null check (reason in ('generated', 'updated', 'manual')),
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id) on delete set null,
  unique (project_id, number)
);

alter table public.plan_versions enable row level security;

revoke all on public.plan_versions from public;
grant select on public.plan_versions to covibes_app;

create policy "plan_versions: members read"
  on public.plan_versions for select to covibes_app
  using (private.is_member(project_id));

-- Keeps the plan as a version, in the name of the owner or editor whose decision led to it. A plan
-- that says the same as the latest version is not kept again; then the result is null.
create function public.keep_plan_version(p_project_id uuid, p_content jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest public.plan_versions;
  v_id uuid;
begin
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors keep versions of the plan' using errcode = '42501';
  end if;
  -- One at a time per project, so the numbers have no gaps and no doubles.
  perform 1 from public.projects where id = p_project_id for update;
  select * into v_latest
  from public.plan_versions v
  where v.project_id = p_project_id
  order by v.number desc
  limit 1;
  if v_latest.content = p_content then
    return null;
  end if;

  insert into public.plan_versions (project_id, number, content, reason, created_by)
  values (
    p_project_id,
    coalesce(v_latest.number, 0) + 1,
    p_content,
    p_reason,
    private.current_user_id()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.keep_plan_version(uuid, jsonb, text) from public;
grant execute on function public.keep_plan_version(uuid, jsonb, text) to covibes_app;

-- Starting a generation or an update. As before (migration 0023): owners and editors, one run at
-- a time per project, a run without an end within ten minutes counts as lost.
drop function public.start_plan_generation(uuid);

create function public.start_plan_generation(p_project_id uuid, p_kind text default 'generate')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if p_kind not in ('generate', 'update') then
    raise exception 'A plan is generated or updated' using errcode = '22023';
  end if;
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors generate the plan' using errcode = '42501';
  end if;
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

  perform graphile_worker.add_job(
    'plan_generate',
    json_build_object('runId', v_run_id, 'kind', p_kind),
    max_attempts => 1
  );
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'plan', 'projectId', p_project_id)::text
  );
  return v_run_id;
end;
$$;

revoke all on function public.start_plan_generation(uuid, text) from public;
grant execute on function public.start_plan_generation(uuid, text) to covibes_app;
