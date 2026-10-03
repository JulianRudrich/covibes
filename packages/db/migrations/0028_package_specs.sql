-- Written-out feature specs of the package for coding agents (spec 27d).
--
-- On a click the moderator writes the feature specs of a milestone out. A written spec belongs to
-- the text of its task as the plan words it: a reworded task has none any more, a task that only
-- moves keeps it. The worker writes the specs; people ask for a run through the function below.
-- RLS, policies and grants for covibes_app in this same migration.

create table public.package_specs (
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The task as the plan worded it when the spec was written, on one line.
  task_text text not null check (char_length(task_text) between 1 and 2000),
  -- The spec as Markdown: goal, approach, out of scope, checklist.
  content text not null check (char_length(content) between 1 and 8000),
  -- The run that wrote it.
  run_id uuid references public.ai_runs (id) on delete set null,
  written_at timestamptz not null default now()
);

-- One spec per task text; the text itself can be too long for an index.
create unique index package_specs_project_id_task_idx
  on public.package_specs (project_id, md5(task_text));

alter table public.package_specs enable row level security;

revoke all on public.package_specs from public;
grant select on public.package_specs to covibes_app;

create policy "package_specs: members read"
  on public.package_specs for select to covibes_app
  using (private.is_member(project_id));

-- The latest run per milestone; its status says whether the moderator still writes or failed.
create table public.package_spec_runs (
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The milestone's place in the order of the plan, from 1.
  milestone integer not null check (milestone between 1 and 24),
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  requested_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, milestone)
);

alter table public.package_spec_runs enable row level security;

revoke all on public.package_spec_runs from public;
grant select on public.package_spec_runs to covibes_app;

create policy "package_spec_runs: members read"
  on public.package_spec_runs for select to covibes_app
  using (private.is_member(project_id));

-- Owners and editors ask for the specs of a milestone; one run per milestone at a time, several
-- milestones side by side. A run that neither finished nor failed within ten minutes is taken as
-- lost, so it cannot block the milestone for good.
create function public.start_package_specs(p_project_id uuid, p_milestone integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if p_milestone is null or p_milestone not between 1 and 24 then
    raise exception 'A plan has milestones 1 to 24' using errcode = '22023';
  end if;
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors have specs written out' using errcode = '42501';
  end if;
  -- One at a time, also when two people click in the same moment.
  perform 1 from public.projects where id = p_project_id for update;
  if exists (
    select 1
    from public.package_spec_runs s
    join public.ai_runs r on r.id = s.run_id
    where s.project_id = p_project_id
      and s.milestone = p_milestone
      and r.status in ('queued', 'running')
      and r.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'The specs of this milestone are being written already'
      using errcode = '55000';
  end if;

  insert into public.ai_runs (project_id, agent_key, kind, status)
  values (p_project_id, 'moderator', 'package', 'queued')
  returning id into v_run_id;

  insert into public.package_spec_runs (project_id, milestone, run_id, requested_by)
  values (p_project_id, p_milestone, v_run_id, private.current_user_id())
  on conflict (project_id, milestone) do update
    set run_id = excluded.run_id,
        requested_by = excluded.requested_by,
        created_at = now();

  perform graphile_worker.add_job(
    'package_specs',
    json_build_object('runId', v_run_id, 'milestone', p_milestone),
    max_attempts => 1
  );
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'package', 'projectId', p_project_id)::text
  );
  return v_run_id;
end;
$$;

revoke all on function public.start_package_specs(uuid, integer) from public;
grant execute on function public.start_package_specs(uuid, integer) to covibes_app;
