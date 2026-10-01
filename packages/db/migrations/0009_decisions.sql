-- Criteria, decisions and the decision log (spec 16a).
--
-- Criteria are short texts that owners, editors and the moderator maintain. Decisions are recorded
-- by the moderator (the worker) on an instruction, or by an owner or editor who confirms a
-- proposal or reopens a decision, through the functions below. Every change of both is written
-- to `decision_log` by triggers, so no path can skip the log, and announced on the live channel
-- from there. Every table: RLS, policies and grants for covibes_app in this same migration.

create table public.criteria (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 80 and text = btrim(text)),
  created_by uuid references public.users (id) on delete set null,
  created_by_agent text check (char_length(created_by_agent) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index criteria_project_id_created_at_idx on public.criteria (project_id, created_at);

create trigger criteria_touch_updated_at
  before update on public.criteria
  for each row execute function private.touch_updated_at();

alter table public.criteria enable row level security;

revoke all on public.criteria from public;
grant select, insert, delete on public.criteria to covibes_app;
grant update (text) on public.criteria to covibes_app;

create policy "criteria: members read"
  on public.criteria for select to covibes_app
  using (private.is_member(project_id));

create policy "criteria: editors add in their own name"
  on public.criteria for insert to covibes_app
  with check (
    created_by = private.current_user_id()
    and created_by_agent is null
    and private.has_role(project_id, 'editor')
  );

create policy "criteria: editors change"
  on public.criteria for update to covibes_app
  using (private.has_role(project_id, 'editor'))
  with check (private.has_role(project_id, 'editor'));

create policy "criteria: editors remove"
  on public.criteria for delete to covibes_app
  using (private.has_role(project_id, 'editor'));

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 80 and topic = btrim(topic)),
  status text not null default 'open' check (status in ('open', 'decided')),
  value text check (char_length(value) between 1 and 200),
  reasoning text not null default '' check (char_length(reasoning) <= 2000),
  -- Discarded options: [{ "name": …, "note": … }].
  alternatives jsonb not null default '[]'::jsonb check (jsonb_typeof(alternatives) = 'array'),
  -- Who confirmed the decision, and the agent that recorded it.
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  recorded_by_agent text check (char_length(recorded_by_agent) between 1 and 40),
  -- Set while a decision is open again after it was decided.
  reopen_reason text check (char_length(reopen_reason) between 1 and 500),
  reopened_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'decided') = (value is not null)),
  check ((status = 'decided') = (decided_at is not null))
);

-- A topic exists once per project, whatever its case.
create unique index decisions_project_id_topic_idx on public.decisions (project_id, lower(topic));

create trigger decisions_touch_updated_at
  before update on public.decisions
  for each row execute function private.touch_updated_at();

alter table public.decisions enable row level security;

revoke all on public.decisions from public;
grant select on public.decisions to covibes_app;

create policy "decisions: members read"
  on public.decisions for select to covibes_app
  using (private.is_member(project_id));

create table public.decision_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (
    kind in (
      'decided', 'reopened', 'opened', 'criterion_added', 'criterion_changed', 'criterion_removed'
    )
  ),
  decision_id uuid references public.decisions (id) on delete set null,
  -- The decision's topic; null for criteria.
  topic text,
  -- The decision's value (for `reopened` the one that was reopened), or the criterion's text.
  value text,
  -- decided: reasoning, alternatives; reopened: reason, reasoning, alternatives;
  -- criterion_changed: previous.
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  actor_user uuid references public.users (id) on delete set null,
  actor_agent text,
  -- The wall clock, so the entries of one transaction keep their order.
  created_at timestamptz not null default clock_timestamp()
);

create index decision_log_project_id_created_at_idx
  on public.decision_log (project_id, created_at desc);

alter table public.decision_log enable row level security;

revoke all on public.decision_log from public;
grant select on public.decision_log to covibes_app;

create policy "decision_log: members read"
  on public.decision_log for select to covibes_app
  using (private.is_member(project_id));

-- The log -------------------------------------------------------------------------------------------

-- The agent on whose behalf the worker writes in this transaction (`set_config('app.agent_key')`).
create function private.current_agent_key()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.agent_key', true), '');
$$;

revoke all on function private.current_agent_key() from public;

-- Everyone who has the project open loads decisions, criteria and the log again.
create function private.announce_decisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'decisions', 'projectId', new.project_id)::text
  );
  return new;
end;
$$;

revoke all on function private.announce_decisions() from public;

create trigger decision_log_announce
  after insert on public.decision_log
  for each row execute function private.announce_decisions();

create function private.log_criteria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.decision_log (project_id, kind, value, actor_user, actor_agent)
    values (new.project_id, 'criterion_added', new.text, new.created_by, new.created_by_agent);
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.text is distinct from old.text then
      insert into public.decision_log (project_id, kind, value, details, actor_user, actor_agent)
      values (
        new.project_id, 'criterion_changed', new.text, jsonb_build_object('previous', old.text),
        private.current_user_id(), private.current_agent_key()
      );
    end if;
    return new;
  end if;
  -- Criteria that go with their project leave no entry: the log goes with it too.
  if exists (select 1 from public.projects where id = old.project_id) then
    insert into public.decision_log (project_id, kind, value, actor_user, actor_agent)
    values (
      old.project_id, 'criterion_removed', old.text,
      private.current_user_id(), private.current_agent_key()
    );
  end if;
  return old;
end;
$$;

revoke all on function private.log_criteria() from public;

create trigger criteria_log
  after insert or update or delete on public.criteria
  for each row execute function private.log_criteria();

create function private.log_decisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'decided' and (tg_op = 'INSERT' or old.status = 'open') then
    insert into public.decision_log
      (project_id, kind, decision_id, topic, value, details, actor_user, actor_agent)
    values (
      new.project_id, 'decided', new.id, new.topic, new.value,
      jsonb_build_object('reasoning', new.reasoning, 'alternatives', new.alternatives),
      new.decided_by, new.recorded_by_agent
    );
  elsif tg_op = 'INSERT' then
    insert into public.decision_log (project_id, kind, decision_id, topic, actor_user, actor_agent)
    values (
      new.project_id, 'opened', new.id, new.topic,
      private.current_user_id(), new.recorded_by_agent
    );
  elsif new.status = 'open' and old.status = 'decided' then
    insert into public.decision_log
      (project_id, kind, decision_id, topic, value, details, actor_user)
    values (
      new.project_id, 'reopened', new.id, new.topic, old.value,
      jsonb_build_object(
        'reason', new.reopen_reason, 'reasoning', old.reasoning, 'alternatives', old.alternatives
      ),
      new.reopened_by
    );
  end if;
  return new;
end;
$$;

revoke all on function private.log_decisions() from public;

create trigger decisions_log
  after insert or update on public.decisions
  for each row execute function private.log_decisions();

-- Deciding and reopening ----------------------------------------------------------------------------

-- Records a decision as confirmed by `p_user`: a new topic, or an open one. A decided topic has to
-- be reopened first ('55000'). The worker calls this for an instruction, with the person who gave
-- it.
create function private.decide(
  p_project_id uuid,
  p_topic text,
  p_value text,
  p_reasoning text,
  p_alternatives jsonb,
  p_agent text,
  p_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text := btrim(p_topic);
  v_decision public.decisions;
begin
  select * into v_decision
  from public.decisions
  where project_id = p_project_id and lower(topic) = lower(v_topic)
  for update;

  if v_decision.id is null then
    insert into public.decisions
      (project_id, topic, status, value, reasoning, alternatives, decided_by, decided_at,
       recorded_by_agent)
    values
      (p_project_id, v_topic, 'decided', btrim(p_value), coalesce(p_reasoning, ''),
       coalesce(p_alternatives, '[]'::jsonb), p_user, now(), p_agent)
    returning * into v_decision;
    return v_decision.id;
  end if;
  if v_decision.status = 'decided' then
    raise exception 'already decided' using errcode = '55000';
  end if;

  update public.decisions
  set
    status = 'decided',
    value = btrim(p_value),
    reasoning = coalesce(p_reasoning, ''),
    alternatives = coalesce(p_alternatives, '[]'::jsonb),
    decided_by = p_user,
    decided_at = now(),
    recorded_by_agent = p_agent,
    reopen_reason = null,
    reopened_by = null
  where id = v_decision.id;
  return v_decision.id;
end;
$$;

revoke all on function private.decide(uuid, text, text, text, jsonb, text, uuid) from public;

-- An owner or editor confirms a decision, e.g. by applying the moderator's proposal.
create function public.record_decision(
  p_project_id uuid,
  p_topic text,
  p_value text,
  p_reasoning text,
  p_alternatives jsonb,
  p_agent text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_decider(p_project_id);
  return private.decide(
    p_project_id, p_topic, p_value, p_reasoning, p_alternatives, p_agent,
    private.current_user_id()
  );
end;
$$;

-- Reopens a decision with a reason: it is open again, the log keeps the old one, and the moderator
-- starts a new round. Returns the moderator's run.
create function public.reopen_decision(p_decision_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision public.decisions;
  v_run_id uuid;
begin
  select * into v_decision from public.decisions where id = p_decision_id for update;
  perform private.check_decider(v_decision.project_id);
  if v_decision.status <> 'decided' then
    raise exception 'not decided' using errcode = '55000';
  end if;

  update public.decisions
  set
    status = 'open',
    value = null,
    reasoning = '',
    alternatives = '[]'::jsonb,
    decided_by = null,
    decided_at = null,
    recorded_by_agent = null,
    reopen_reason = btrim(p_reason),
    reopened_by = private.current_user_id()
  where id = p_decision_id;

  v_run_id := private.enqueue_reply_run(v_decision.project_id, 'moderator', null, null);
  update public.ai_runs set decision_id = p_decision_id where id = v_run_id;
  return v_run_id;
end;
$$;

revoke all on function public.record_decision(uuid, text, text, text, jsonb, text) from public;
revoke all on function public.reopen_decision(uuid, text) from public;
grant execute on function public.record_decision(uuid, text, text, text, jsonb, text) to covibes_app;
grant execute on function public.reopen_decision(uuid, text) to covibes_app;

-- Runs and proposals --------------------------------------------------------------------------------

alter table public.ai_runs
  add column decision_id uuid references public.decisions (id) on delete set null;

alter table public.proposals drop constraint proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (
  kind in ('canvas', 'team', 'decision')
);
