-- Observer, offering help and raised hands (spec 15).
--
-- After a pause in the chat the worker's observer looks at the conversation. The moderator offers
-- help (`offers`, with a moderator message), and specialists raise hands (`hand_raises`). Only the
-- worker creates both; owners and editors decide them through the functions below, which also
-- start the agent's run, like the mention trigger does. Every table: RLS, policies and grants for
-- covibes_app in this same migration.

create table public.hand_raises (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  agent_key text not null check (char_length(agent_key) between 1 and 40),
  reason text not null check (char_length(reason) between 1 and 300),
  status text not null default 'open' check (status in ('open', 'heard', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users (id) on delete set null,
  run_id uuid references public.ai_runs (id) on delete set null,
  check ((status = 'open') = (decided_at is null))
);

-- One open raised hand per agent; the worker keeps the limit of two per project.
create unique index hand_raises_one_open_per_agent
  on public.hand_raises (project_id, agent_key) where status = 'open';
create index hand_raises_project_id_created_at_idx on public.hand_raises (project_id, created_at);

alter table public.hand_raises enable row level security;

revoke all on public.hand_raises from public;
grant select on public.hand_raises to covibes_app;

create policy "hand_raises: members read"
  on public.hand_raises for select to covibes_app
  using (private.is_member(project_id));

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The moderator's message that makes the offer.
  message_id uuid not null unique references public.messages (id) on delete cascade,
  kind text not null check (kind in ('consensus', 'stuck')),
  -- The text of the button that accepts the offer, e.g. "Ja, zusammenfassen".
  action text not null check (char_length(action) between 1 and 40),
  -- What the moderator does when the offer is accepted.
  task text not null check (char_length(task) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users (id) on delete set null,
  run_id uuid references public.ai_runs (id) on delete set null,
  check ((status = 'open') = (decided_at is null))
);

-- At most one open offer per project.
create unique index offers_one_open_per_project on public.offers (project_id) where status = 'open';
create index offers_project_id_created_at_idx on public.offers (project_id, created_at);

alter table public.offers enable row level security;

revoke all on public.offers from public;
grant select on public.offers to covibes_app;

create policy "offers: members read"
  on public.offers for select to covibes_app
  using (private.is_member(project_id));

-- Runs: answers to a mention, a raised hand or an accepted offer, and the observer's looks -------

alter table public.ai_runs
  add column kind text not null default 'reply' check (kind in ('reply', 'observe')),
  add column hand_raise_id uuid references public.hand_raises (id) on delete set null,
  add column offer_id uuid references public.offers (id) on delete set null;

create index ai_runs_project_id_kind_created_at_idx on public.ai_runs (project_id, kind, created_at);

-- Queues a reply run of an agent and tells the server, like the mention trigger (migration 0005).
create function private.enqueue_reply_run(
  p_project_id uuid,
  p_agent_key text,
  p_hand_raise_id uuid,
  p_offer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  insert into public.ai_runs (project_id, agent_key, hand_raise_id, offer_id)
  values (p_project_id, p_agent_key, p_hand_raise_id, p_offer_id)
  returning id into v_run_id;

  perform graphile_worker.add_job(
    'agent_turn',
    json_build_object('runId', v_run_id),
    queue_name => 'agent:' || p_project_id || ':' || p_agent_key,
    max_attempts => 3
  );
  perform pg_notify(
    'covibes_live',
    json_build_object('kind', 'run', 'projectId', p_project_id, 'runId', v_run_id)::text
  );
  return v_run_id;
end;
$$;

revoke all on function private.enqueue_reply_run(uuid, text, uuid, uuid) from public;

-- Deciding raised hands and offers ----------------------------------------------------------------
-- Errors: 'P0002' when the row does not exist for the user, '42501' for viewers, '55000' when it
-- was decided already.

create function private.check_decider(p_project_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_project_id is null or not private.is_member(p_project_id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'only owners and editors decide' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.check_decider(uuid) from public;

-- "Anhören": the agent posts what it raised its hand for.
create function public.listen_to_hand(p_hand_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hand public.hand_raises;
  v_run_id uuid;
begin
  select * into v_hand from public.hand_raises where id = p_hand_id for update;
  perform private.check_decider(v_hand.project_id);
  if v_hand.status <> 'open' then
    raise exception 'already decided' using errcode = '55000';
  end if;

  v_run_id := private.enqueue_reply_run(v_hand.project_id, v_hand.agent_key, v_hand.id, null);
  update public.hand_raises
  set status = 'heard', decided_at = now(), decided_by = private.current_user_id(), run_id = v_run_id
  where id = p_hand_id;
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'hands', 'projectId', v_hand.project_id)::text
  );
  return v_run_id;
end;
$$;

create function public.dismiss_hand(p_hand_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hand public.hand_raises;
begin
  select * into v_hand from public.hand_raises where id = p_hand_id for update;
  perform private.check_decider(v_hand.project_id);
  if v_hand.status <> 'open' then
    raise exception 'already decided' using errcode = '55000';
  end if;

  update public.hand_raises
  set status = 'dismissed', decided_at = now(), decided_by = private.current_user_id()
  where id = p_hand_id;
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'hands', 'projectId', v_hand.project_id)::text
  );
end;
$$;

-- Accepting starts the moderator with the offer's task; declining only records it. Returns the
-- run, or null when declined.
create function public.decide_offer(p_offer_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.offers;
  v_run_id uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  perform private.check_decider(v_offer.project_id);
  if v_offer.status <> 'open' then
    raise exception 'already decided' using errcode = '55000';
  end if;

  if p_accept then
    v_run_id := private.enqueue_reply_run(v_offer.project_id, 'moderator', null, v_offer.id);
  end if;
  update public.offers
  set
    status = case when p_accept then 'accepted' else 'declined' end,
    decided_at = now(),
    decided_by = private.current_user_id(),
    run_id = v_run_id
  where id = p_offer_id;
  -- The offer is shown in its message, so the message is announced again.
  perform pg_notify(
    'covibes_live',
    json_build_object(
      'kind', 'message', 'projectId', v_offer.project_id, 'messageId', v_offer.message_id
    )::text
  );
  return v_run_id;
end;
$$;

revoke all on function public.listen_to_hand(uuid) from public;
revoke all on function public.dismiss_hand(uuid) from public;
revoke all on function public.decide_offer(uuid, boolean) from public;
grant execute on function public.listen_to_hand(uuid) to covibes_app;
grant execute on function public.dismiss_hand(uuid) to covibes_app;
grant execute on function public.decide_offer(uuid, boolean) to covibes_app;

-- An agent that leaves the team takes its open raised hands along.
create function private.dismiss_hands_of_removed_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hand_raises
  set status = 'dismissed', decided_at = now()
  where project_id = old.project_id and agent_key = old.agent_key and status = 'open';
  if found then
    perform pg_notify(
      'covibes_live', json_build_object('kind', 'hands', 'projectId', old.project_id)::text
    );
  end if;
  return old;
end;
$$;

revoke all on function private.dismiss_hands_of_removed_agent() from public;

create trigger project_agents_dismiss_hands
  after delete on public.project_agents
  for each row execute function private.dismiss_hands_of_removed_agent();

-- The observer looks after a pause ------------------------------------------------------------------

-- Every human message schedules the observer 15 seconds later; the job key makes a newer message
-- replace the waiting job, so it only runs after a pause. Owners can switch it off
-- (`settings.observer = false`).
create function private.schedule_observer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select settings -> 'observer' from public.projects where id = new.project_id)
    is distinct from 'false'::jsonb then
    perform graphile_worker.add_job(
      'observe',
      json_build_object('projectId', new.project_id),
      queue_name => 'observer:' || new.project_id,
      run_at => now() + interval '15 seconds',
      max_attempts => 1,
      job_key => 'observer:' || new.project_id,
      job_key_mode => 'replace'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.schedule_observer() from public;

create trigger messages_schedule_observer
  after insert on public.messages
  for each row
  when (new.author_kind = 'human')
  execute function private.schedule_observer();
