-- Suggestions for the texts of the package for coding agents (spec 27c).
--
-- On a click the moderator suggests the code standards or the UI direction. The suggestion waits
-- next to the text until an owner or editor takes it over or dismisses it; the text itself is
-- written by people only (package_texts). The worker writes the suggestion; people ask for one
-- and take it over through the functions below. RLS, policies and grants for covibes_app in this
-- same migration.

-- A suggestion is a run of its own kind, metered like every other.
alter table public.ai_runs drop constraint ai_runs_kind_check;
alter table public.ai_runs
  add constraint ai_runs_kind_check
  check (kind in ('reply', 'observe', 'summary', 'plan', 'package'));

create table public.package_suggestions (
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('code_standards', 'ui_direction')),
  -- The run that writes it; its status says whether the moderator still writes or failed.
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  -- Null until the moderator wrote it.
  content text check (char_length(content) between 1 and 8000),
  requested_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, kind)
);

alter table public.package_suggestions enable row level security;

revoke all on public.package_suggestions from public;
grant select, delete on public.package_suggestions to covibes_app;

create policy "package_suggestions: members read"
  on public.package_suggestions for select to covibes_app
  using (private.is_member(project_id));

create policy "package_suggestions: editors dismiss"
  on public.package_suggestions for delete to covibes_app
  using (private.has_role(project_id, 'editor'));

-- Owners and editors ask for a suggestion; one runs at a time per text. It takes the place of a
-- suggestion that waited for the same text. A run that neither finished nor failed within ten
-- minutes is taken as lost, so it cannot block the text for good.
create function public.start_package_suggestion(p_project_id uuid, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if p_kind not in ('code_standards', 'ui_direction') then
    raise exception 'A suggestion is for the code standards or the UI direction'
      using errcode = '22023';
  end if;
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors ask for a suggestion' using errcode = '42501';
  end if;
  -- One at a time, also when two people click in the same moment.
  perform 1 from public.projects where id = p_project_id for update;
  if exists (
    select 1
    from public.package_suggestions s
    join public.ai_runs r on r.id = s.run_id
    where s.project_id = p_project_id
      and s.kind = p_kind
      and r.status in ('queued', 'running')
      and r.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'A suggestion is being written already' using errcode = '55000';
  end if;

  insert into public.ai_runs (project_id, agent_key, kind, status)
  values (p_project_id, 'moderator', 'package', 'queued')
  returning id into v_run_id;

  insert into public.package_suggestions (project_id, kind, run_id, requested_by)
  values (p_project_id, p_kind, v_run_id, private.current_user_id())
  on conflict (project_id, kind) do update
    set run_id = excluded.run_id,
        content = null,
        requested_by = excluded.requested_by,
        created_at = now();

  perform graphile_worker.add_job(
    'package_suggest',
    json_build_object('runId', v_run_id, 'kind', p_kind),
    max_attempts => 1
  );
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'package', 'projectId', p_project_id)::text
  );
  return v_run_id;
end;
$$;

revoke all on function public.start_package_suggestion(uuid, text) from public;
grant execute on function public.start_package_suggestion(uuid, text) to covibes_app;

-- Takes a written suggestion over: it becomes the team's text in the name of who took it, and the
-- suggestion is gone. Returns the text, or null if no written suggestion waits.
create function public.accept_package_suggestion(p_project_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content text;
begin
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors take a suggestion over' using errcode = '42501';
  end if;
  delete from public.package_suggestions
  where project_id = p_project_id and kind = p_kind and content is not null
  returning content into v_content;
  if v_content is null then
    return null;
  end if;

  insert into public.package_texts (project_id, kind, content, updated_by)
  values (p_project_id, p_kind, v_content, private.current_user_id())
  on conflict (project_id, kind) do update
    set content = excluded.content, updated_by = excluded.updated_by;
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'package', 'projectId', p_project_id)::text
  );
  return v_content;
end;
$$;

revoke all on function public.accept_package_suggestion(uuid, text) from public;
grant execute on function public.accept_package_suggestion(uuid, text) to covibes_app;
