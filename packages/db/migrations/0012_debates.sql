-- Debates (spec 18).
--
-- On request the moderator opens a debate between two or three specialists. It is a chain of
-- ordinary agent runs: when a run of the debate ends, the trigger below queues the next one, the
-- next participant's turn or, after the last turn, the moderator's summary. Only the worker
-- creates a debate; owners and editors end it early through `stop_debate`. RLS, policies and
-- grants for covibes_app in this same migration.

create table public.debates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The moderator's message that opens the debate; it shows the debate's card.
  message_id uuid not null unique references public.messages (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 80 and topic = btrim(topic)),
  question text not null check (char_length(question) between 1 and 300),
  -- Agent keys in the order they speak; a round is one turn of each.
  participants text[] not null check (cardinality(participants) between 2 and 3),
  rounds smallint not null check (rounds between 1 and 3),
  -- Turns that are finished.
  turns smallint not null default 0 check (turns >= 0),
  -- running: turns are taken; summarizing: the moderator sums up; failed: a run failed for good.
  status text not null default 'running' check (
    status in ('running', 'summarizing', 'done', 'failed')
  ),
  -- Set when someone ends the debate early; the turn in progress is still finished.
  stopped_at timestamptz,
  stopped_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status in ('done', 'failed')) = (finished_at is not null))
);

-- One debate at a time per project.
create unique index debates_one_active_per_project
  on public.debates (project_id) where status in ('running', 'summarizing');
create index debates_project_id_created_at_idx on public.debates (project_id, created_at);

alter table public.debates enable row level security;

revoke all on public.debates from public;
grant select on public.debates to covibes_app;

create policy "debates: members read"
  on public.debates for select to covibes_app
  using (private.is_member(project_id));

-- Runs of a debate -----------------------------------------------------------------------------------

-- `debate_round` is the round of a turn; it is null for the answer that opens the debate and for
-- the moderator's summary.
alter table public.ai_runs
  add column debate_id uuid references public.debates (id) on delete set null,
  add column debate_round smallint check (debate_round >= 1);

-- The chat marks the messages of a debate by the run that wrote them.
create index ai_runs_debate_reply_message_id_idx
  on public.ai_runs (reply_message_id) where debate_id is not null;

-- Queues a run of the debate and tells the server, like the mention trigger (migration 0005).
create function private.enqueue_debate_run(
  p_debate public.debates,
  p_agent_key text,
  p_round integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  insert into public.ai_runs (project_id, agent_key, debate_id, debate_round)
  values (p_debate.project_id, p_agent_key, p_debate.id, p_round)
  returning id into v_run_id;

  perform graphile_worker.add_job(
    'agent_turn',
    json_build_object('runId', v_run_id),
    queue_name => 'agent:' || p_debate.project_id || ':' || p_agent_key,
    max_attempts => 3
  );
  perform pg_notify(
    'covibes_live',
    json_build_object('kind', 'run', 'projectId', p_debate.project_id, 'runId', v_run_id)::text
  );
  return v_run_id;
end;
$$;

revoke all on function private.enqueue_debate_run(public.debates, text, integer) from public;

-- The debate's card is part of its opening message, so the message is announced again.
create function private.announce_debate(p_debate public.debates)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_notify(
    'covibes_live',
    json_build_object(
      'kind', 'message', 'projectId', p_debate.project_id, 'messageId', p_debate.message_id
    )::text
  );
$$;

revoke all on function private.announce_debate(public.debates) from public;

-- The chain: a run of the debate ended.
--   running, the run failed       -> the debate is aborted
--   running, ended early, no turn -> the debate is over without a summary
--   running, last turn or ended   -> the moderator sums up
--   running, otherwise            -> the next participant's turn
--   summarizing                   -> the debate is over
create function private.advance_debate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debate public.debates;
  v_count integer;
  v_turns integer;
begin
  select * into v_debate from public.debates where id = new.debate_id for update;
  if not found or v_debate.status not in ('running', 'summarizing') then
    return new;
  end if;

  if v_debate.status = 'summarizing' then
    update public.debates
    set status = case when new.status = 'done' then 'done' else 'failed' end, finished_at = now()
    where id = v_debate.id;
  elsif new.status = 'error' then
    update public.debates set status = 'failed', finished_at = now() where id = v_debate.id;
  else
    v_count := cardinality(v_debate.participants);
    -- The answer that opens the debate is not a turn.
    v_turns := v_debate.turns + case when new.debate_round is null then 0 else 1 end;
    if v_debate.stopped_at is not null and v_turns = 0 then
      update public.debates set status = 'done', finished_at = now() where id = v_debate.id;
    elsif v_debate.stopped_at is not null or v_turns >= v_count * v_debate.rounds then
      update public.debates set turns = v_turns, status = 'summarizing' where id = v_debate.id;
      perform private.enqueue_debate_run(v_debate, 'moderator', null);
    else
      update public.debates set turns = v_turns where id = v_debate.id;
      perform private.enqueue_debate_run(
        v_debate,
        v_debate.participants[(v_turns % v_count) + 1],
        (v_turns / v_count) + 1
      );
    end if;
  end if;

  perform private.announce_debate(v_debate);
  return new;
end;
$$;

revoke all on function private.advance_debate() from public;

create trigger ai_runs_advance_debate
  after update of status on public.ai_runs
  for each row
  when (
    new.debate_id is not null
    and new.status in ('done', 'error')
    and old.status is distinct from new.status
  )
  execute function private.advance_debate();

-- "Debatte beenden": no further turns; the moderator sums up what was said once the turn in
-- progress is finished. Errors: 'P0002' unknown, '42501' viewers, '55000' not running any more.
create function public.stop_debate(p_debate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debate public.debates;
begin
  select * into v_debate from public.debates where id = p_debate_id for update;
  perform private.check_decider(v_debate.project_id);
  if v_debate.status <> 'running' or v_debate.stopped_at is not null then
    raise exception 'the debate is not running' using errcode = '55000';
  end if;

  update public.debates
  set stopped_at = now(), stopped_by = private.current_user_id()
  where id = p_debate_id;
  perform private.announce_debate(v_debate);
end;
$$;

revoke all on function public.stop_debate(uuid) from public;
grant execute on function public.stop_debate(uuid) to covibes_app;
