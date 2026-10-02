-- Phases (spec 24).
--
-- A project has one current phase on the way brainstorming → decide → architecture → plan. It is
-- orientation: nothing depends on it but the phase bar and what the agents are told. Owners and
-- editors change it, and so does the moderator when someone tells it to.

alter table public.projects
  add column phase text not null default 'brainstorming'
    check (phase in ('brainstorming', 'decide', 'architecture', 'plan'));

-- Changing a project is the owners' right (migration 0002); the phase is the team's. So the app
-- role gets no grant on the column and changes it through this function.
create function public.set_project_phase(p_project_id uuid, p_phase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors change the phase' using errcode = '42501';
  end if;
  update public.projects
  set phase = p_phase
  where id = p_project_id and phase is distinct from p_phase;
end;
$$;

revoke all on function public.set_project_phase(uuid, text) from public;
grant execute on function public.set_project_phase(uuid, text) to covibes_app;

-- Everyone who has the project open sees the new phase at once, whoever changed it: a member
-- through the function, or the worker for the moderator.
create function private.project_phase_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'project', 'projectId', new.id)::text
  );
  return null;
end;
$$;

revoke all on function private.project_phase_changed() from public;

create trigger projects_phase_changed
  after update of phase on public.projects
  for each row
  when (old.phase is distinct from new.phase)
  execute function private.project_phase_changed();

-- The moderator also offers to move on to the next phase.
alter table public.offers drop constraint offers_kind_check;
alter table public.offers
  add constraint offers_kind_check check (kind in ('consensus', 'stuck', 'next_step'));
