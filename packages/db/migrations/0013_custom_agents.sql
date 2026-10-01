-- Custom agents (spec 19).
--
-- People create their own agents: personal ones for their own projects, or shared in one project.
-- Wherever an agent is referred to by its key (team, messages, runs, proposals, raised hands), a
-- custom agent's key is its id. The instructions are only readable for those who may edit or share
-- the agent; other members of a project that uses it see the directory entry (name, role, color).
-- RLS, policies and grants for covibes_app in this same migration.

create table public.custom_agents (
  id uuid primary key default gen_random_uuid(),
  -- The creator. Deleting an account also deletes its agents.
  owner_id uuid not null references public.users (id) on delete cascade,
  -- Null: personal, for the creator's projects. Set: shared in this project.
  project_id uuid references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 24 and name = btrim(name)),
  role text not null check (char_length(role) between 1 and 120 and role = btrim(role)),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  -- With it the agent has the canvas tools; without it it only talks.
  can_draw boolean not null default true,
  -- Null means the default model of all agents.
  model text check (char_length(model) between 1 and 80),
  -- One of the six custom colors.
  color smallint not null default 1 check (color between 1 and 6),
  -- The catalog agent it was created from, if any.
  template text check (char_length(template) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deleted agents stay as rows, so their messages keep their name.
  deleted_at timestamptz
);

-- A name is how the agent is mentioned, so it is unique where the agent is chosen from.
create unique index custom_agents_personal_name_key
  on public.custom_agents (owner_id, lower(name))
  where project_id is null and deleted_at is null;
create unique index custom_agents_project_name_key
  on public.custom_agents (project_id, lower(name))
  where project_id is not null and deleted_at is null;

create trigger custom_agents_touch_updated_at
  before update on public.custom_agents
  for each row execute function private.touch_updated_at();

alter table public.custom_agents enable row level security;

revoke all on public.custom_agents from public;
grant select on public.custom_agents to covibes_app;
grant insert (owner_id, project_id, name, role, instructions, can_draw, model, color, template)
  on public.custom_agents to covibes_app;
grant update (project_id, name, role, instructions, can_draw, model, color)
  on public.custom_agents to covibes_app;

-- Personal agents belong to their creator; shared agents to the members of their project.
create policy "custom_agents: creator and members read"
  on public.custom_agents for select to covibes_app
  using (
    deleted_at is null
    and (
      (project_id is null and owner_id = private.current_user_id())
      or (project_id is not null and private.is_member(project_id))
    )
  );

create policy "custom_agents: create own"
  on public.custom_agents for insert to covibes_app
  with check (
    owner_id = private.current_user_id()
    and (project_id is null or private.has_role(project_id, 'editor'))
  );

-- The creator changes a personal agent and shares it in a project where they are owner or
-- editor; owners and editors change a shared agent; only the creator takes it back to personal.
create policy "custom_agents: creator and editors change"
  on public.custom_agents for update to covibes_app
  using (
    deleted_at is null
    and (
      (project_id is null and owner_id = private.current_user_id())
      or (project_id is not null and private.has_role(project_id, 'editor'))
    )
  )
  with check (
    (project_id is null and owner_id = private.current_user_id())
    or (project_id is not null and private.has_role(project_id, 'editor'))
  );

-- The team -----------------------------------------------------------------------------------------

-- Whether the user may add the agent with this key to the project's team: catalog keys are
-- checked by the server; a custom agent must be shared in the project or be the user's own.
create function private.can_add_agent(p_project_id uuid, p_agent_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_agent_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return true;
  end if;
  return exists (
    select 1
    from public.custom_agents a
    where a.id = p_agent_key::uuid
      and a.deleted_at is null
      and (
        a.project_id = p_project_id
        or (a.project_id is null and a.owner_id = private.current_user_id())
      )
  );
end;
$$;

revoke all on function private.can_add_agent(uuid, text) from public;
grant execute on function private.can_add_agent(uuid, text) to covibes_app;

drop policy "project_agents: editors add" on public.project_agents;
create policy "project_agents: editors add"
  on public.project_agents for insert to covibes_app
  with check (
    agent_key <> 'moderator'
    and model is null
    and added_by = private.current_user_id()
    and private.has_role(project_id, 'editor')
    and private.can_add_agent(project_id, agent_key)
  );

-- An agent that is shared in a project belongs to that project only: it leaves the other teams.
create function private.leave_other_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  for v_project_id in
    delete from public.project_agents
    where agent_key = new.id::text and project_id <> new.project_id
    returning project_id
  loop
    perform pg_notify(
      'covibes_live', json_build_object('kind', 'project', 'projectId', v_project_id)::text
    );
  end loop;
  return new;
end;
$$;

revoke all on function private.leave_other_teams() from public;

create trigger custom_agents_leave_other_teams
  after update of project_id on public.custom_agents
  for each row
  when (new.project_id is not null and new.project_id is distinct from old.project_id)
  execute function private.leave_other_teams();

-- The directory ------------------------------------------------------------------------------------

-- The custom agents a project refers to: shared in it, in its team, or author of a run in it
-- (so old messages keep their name). For members; never the instructions.
-- Errors: 'P0002' when the project does not exist for the user.
create function public.project_agent_directory(p_project_id uuid)
returns table (
  id uuid,
  name text,
  role text,
  color smallint,
  model text,
  can_draw boolean,
  scope text,
  owner_id uuid,
  owner_name text,
  deleted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_project_id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query
    select
      a.id,
      a.name,
      a.role,
      a.color,
      a.model,
      a.can_draw,
      case when a.project_id is null then 'personal' else 'project' end,
      a.owner_id,
      u.name,
      a.deleted_at is not null
    from public.custom_agents a
    join public.users u on u.id = a.owner_id
    where (a.project_id = p_project_id and a.deleted_at is null)
      or a.id::text in (
        select t.agent_key from public.project_agents t where t.project_id = p_project_id
      )
      or a.id::text in (
        select r.agent_key from public.ai_runs r where r.project_id = p_project_id
      )
    order by lower(a.name), a.id;
end;
$$;

revoke all on function public.project_agent_directory(uuid) from public;
grant execute on function public.project_agent_directory(uuid) to covibes_app;

-- Deleting -----------------------------------------------------------------------------------------

-- Marks the agent as deleted and removes it from every team, also in projects the user is not
-- part of (a personal agent of a creator who left). The teams are told live.
-- Errors: 'P0002' when the agent does not exist for the user, '42501' for viewers of its project.
create function public.delete_custom_agent(p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent public.custom_agents;
  v_project_id uuid;
begin
  select * into v_agent
  from public.custom_agents
  where id = p_agent_id and deleted_at is null
  for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_agent.project_id is null then
    if v_agent.owner_id is distinct from private.current_user_id() then
      raise exception 'not found' using errcode = 'P0002';
    end if;
  else
    if not private.is_member(v_agent.project_id) then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    if not private.has_role(v_agent.project_id, 'editor') then
      raise exception 'only owners and editors delete a shared agent' using errcode = '42501';
    end if;
  end if;

  update public.custom_agents set deleted_at = now() where id = p_agent_id;
  for v_project_id in
    delete from public.project_agents where agent_key = p_agent_id::text returning project_id
  loop
    perform pg_notify(
      'covibes_live', json_build_object('kind', 'project', 'projectId', v_project_id)::text
    );
  end loop;
  -- A shared agent is listed in its project even when it is in no team.
  if v_agent.project_id is not null then
    perform pg_notify(
      'covibes_live',
      json_build_object('kind', 'project', 'projectId', v_agent.project_id)::text
    );
  end if;
end;
$$;

revoke all on function public.delete_custom_agent(uuid) from public;
grant execute on function public.delete_custom_agent(uuid) to covibes_app;
