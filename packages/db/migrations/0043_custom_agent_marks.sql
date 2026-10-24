-- The mark of a custom agent (spec 36c).
--
-- The creator picks one of twelve shapes. Agents without one keep the shape their id gives them in
-- the web app, so nothing changes for them until someone picks one. Both directories carry the mark,
-- so every member, and the read-only view, draws the agent the same way. The policies of the table
-- stay as they are.

alter table public.custom_agents
  add column mark text check (
    mark in (
      'circle', 'diamond', 'triangle', 'frame', 'plus', 'drop',
      'leaf', 'moon', 'star', 'dots', 'ring', 'arrow'
    )
  );

-- Who may create or change the agent sets its mark, like its color.
grant insert (mark), update (mark) on public.custom_agents to covibes_app;

-- The return type changes, so both functions are dropped and created again as in 0013 and 0017.
drop function public.project_agent_directory(uuid);

create function public.project_agent_directory(p_project_id uuid)
returns table (
  id uuid,
  name text,
  role text,
  color smallint,
  mark text,
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
      a.mark,
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

drop function public.shared_agent_directory();

create function public.shared_agent_directory()
returns table (id uuid, name text, color smallint, mark text, deleted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.name, a.color, a.mark, a.deleted_at is not null
  from public.custom_agents a
  cross join (select private.shared_project_id() as project_id) shared
  where shared.project_id is not null
    and (
      a.project_id = shared.project_id
      or exists (
        select 1
        from public.project_agents pa
        where pa.project_id = shared.project_id and pa.agent_key = a.id::text
      )
      or exists (
        select 1
        from public.ai_runs r
        where r.project_id = shared.project_id and r.agent_key = a.id::text
      )
    )
  order by lower(a.name), a.id;
$$;

revoke all on function public.shared_agent_directory() from public;
grant execute on function public.shared_agent_directory() to covibes_app;
