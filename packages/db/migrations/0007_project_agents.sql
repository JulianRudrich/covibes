-- The agent team of a project (spec 14).
--
-- Every project has the moderator, which cannot be removed; owners and editors add and remove the
-- specialists of the catalog, owners choose their model. Only agents of the team answer a mention.
-- The team may also change through a proposal of the moderator (proposals of kind `team`).

create table public.project_agents (
  project_id uuid not null references public.projects (id) on delete cascade,
  agent_key text not null check (char_length(agent_key) between 1 and 40),
  -- Null means the catalog default of the agent.
  model text check (char_length(model) between 1 and 80),
  added_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, agent_key)
);

alter table public.project_agents enable row level security;

revoke all on public.project_agents from public;
grant select, insert, delete on public.project_agents to covibes_app;
grant update (model) on public.project_agents to covibes_app;

create policy "project_agents: members read"
  on public.project_agents for select to covibes_app
  using (private.is_member(project_id));

-- The moderator is added with every project; people add specialists in their own name.
create policy "project_agents: editors add"
  on public.project_agents for insert to covibes_app
  with check (
    agent_key <> 'moderator'
    and model is null
    and added_by = private.current_user_id()
    and private.has_role(project_id, 'editor')
  );

create policy "project_agents: editors remove"
  on public.project_agents for delete to covibes_app
  using (agent_key <> 'moderator' and private.has_role(project_id, 'editor'));

-- Choosing a model decides about costs, so it is the owner's.
create policy "project_agents: owner chooses the model"
  on public.project_agents for update to covibes_app
  using (private.has_role(project_id, 'owner'))
  with check (private.has_role(project_id, 'owner'));

-- Every project starts with the moderator ---------------------------------------------------------

create function private.add_moderator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_agents (project_id, agent_key) values (new.id, 'moderator');
  return new;
end;
$$;

revoke all on function private.add_moderator() from public;

create trigger projects_add_moderator
  after insert on public.projects
  for each row execute function private.add_moderator();

insert into public.project_agents (project_id, agent_key)
select id, 'moderator' from public.projects
on conflict do nothing;

-- Only agents of the team answer -----------------------------------------------------------------

create or replace function private.enqueue_agent_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_key text;
  v_run_id uuid;
begin
  foreach v_agent_key in array new.mentions loop
    continue when not exists (
      select 1 from public.project_agents
      where project_id = new.project_id and agent_key = v_agent_key
    );

    insert into public.ai_runs (project_id, agent_key, trigger_message_id)
    values (new.project_id, v_agent_key, new.id)
    returning id into v_run_id;

    perform graphile_worker.add_job(
      'agent_turn',
      json_build_object('runId', v_run_id),
      queue_name => 'agent:' || new.project_id || ':' || v_agent_key,
      max_attempts => 3
    );

    perform pg_notify(
      'covibes_live',
      json_build_object('kind', 'run', 'projectId', new.project_id, 'runId', v_run_id)::text
    );
  end loop;
  return new;
end;
$$;

-- Proposals to change the team -------------------------------------------------------------------

alter table public.proposals drop constraint proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (kind in ('canvas', 'team'));
alter table public.proposals alter column board_id drop not null;
alter table public.proposals add constraint proposals_board_check check (
  (kind = 'canvas') = (board_id is not null)
);
