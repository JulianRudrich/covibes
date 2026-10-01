-- Variants A/B (spec 17).
--
-- Variants are a proposal of the kind `variants`: two or three alternative diagrams for one topic,
-- each with its canvas operations. Applying it adopts one of them (`chosen`); the choice is
-- recorded as the decision of the topic, which keeps the proposal as the snapshot of the variants
-- that were discarded.

alter table public.proposals drop constraint proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check check (
  kind in ('canvas', 'team', 'decision', 'variants')
);

-- Variants belong to a board like canvas proposals.
alter table public.proposals drop constraint proposals_board_check;
alter table public.proposals add constraint proposals_board_check check (
  (kind in ('canvas', 'variants')) = (board_id is not null)
);

alter table public.proposals drop constraint proposals_reason_check;
alter table public.proposals add constraint proposals_reason_check check (
  reason in ('question', 'initiative', 'proposals_only', 'locked', 'owner_decides', 'variants')
);

-- The position of the adopted variant, once a `variants` proposal was applied.
alter table public.proposals add column chosen smallint check (chosen >= 0);

alter table public.decisions
  add column variants_id uuid references public.proposals (id) on delete set null;

-- The log entry of a decision also refers to the variants it chose from.
create or replace function private.log_decisions()
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
      jsonb_strip_nulls(
        jsonb_build_object(
          'reasoning', new.reasoning,
          'alternatives', new.alternatives,
          'comparisonId', new.comparison_id,
          'votes', (select tally from public.votes where id = new.vote_id),
          'variantsId', new.variants_id
        )
      ),
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

-- `decide` also takes the variants proposal along that the decision chose from.
drop function private.decide(uuid, text, text, text, jsonb, text, uuid, uuid);

create function private.decide(
  p_project_id uuid,
  p_topic text,
  p_value text,
  p_reasoning text,
  p_alternatives jsonb,
  p_agent text,
  p_user uuid,
  p_vote_id uuid default null,
  p_variants_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text := btrim(p_topic);
  v_decision public.decisions;
  v_comparison_id uuid;
begin
  select id into v_comparison_id
  from public.comparisons
  where project_id = p_project_id and lower(topic) = lower(v_topic)
  order by created_at desc
  limit 1;

  select * into v_decision
  from public.decisions
  where project_id = p_project_id and lower(topic) = lower(v_topic)
  for update;

  if v_decision.id is null then
    insert into public.decisions
      (project_id, topic, status, value, reasoning, alternatives, decided_by, decided_at,
       recorded_by_agent, comparison_id, vote_id, variants_id)
    values
      (p_project_id, v_topic, 'decided', btrim(p_value), coalesce(p_reasoning, ''),
       coalesce(p_alternatives, '[]'::jsonb), p_user, now(), p_agent, v_comparison_id, p_vote_id,
       p_variants_id)
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
    reopened_by = null,
    comparison_id = v_comparison_id,
    vote_id = p_vote_id,
    variants_id = p_variants_id
  where id = v_decision.id;
  return v_decision.id;
end;
$$;

revoke all on function private.decide(uuid, text, text, text, jsonb, text, uuid, uuid, uuid)
  from public;

-- Reopening also lets go of the variants; the log keeps them.
create or replace function public.reopen_decision(p_decision_id uuid, p_reason text)
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
    comparison_id = null,
    vote_id = null,
    variants_id = null,
    reopen_reason = btrim(p_reason),
    reopened_by = private.current_user_id()
  where id = p_decision_id;

  v_run_id := private.enqueue_reply_run(v_decision.project_id, 'moderator', null, null);
  update public.ai_runs set decision_id = p_decision_id where id = v_run_id;
  return v_run_id;
end;
$$;

-- Adopting a variant: called by the person who just applied the proposal, in the same
-- transaction. It stores the choice and records it as the decision of the topic, unless the topic
-- was decided another way in the meantime. While the owner decides, only owners adopt.
-- Errors: 'P0002' unknown, '42501' not allowed, '55000' not applied by the caller just now,
-- '22023' no such variant.
create function public.adopt_variant(p_proposal_id uuid, p_position integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.proposals;
  v_data jsonb;
  v_variants jsonb;
  v_chosen jsonb;
  v_topic text;
begin
  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  perform private.check_decider(v_proposal.project_id);
  if v_proposal.kind <> 'variants' then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if (select settings ->> 'decisionProcess' from public.projects where id = v_proposal.project_id)
      = 'owner'
    and not private.has_role(v_proposal.project_id, 'owner') then
    raise exception 'the owner decides' using errcode = '42501';
  end if;
  if v_proposal.status <> 'applied'
    or v_proposal.decided_by is distinct from private.current_user_id()
    or v_proposal.chosen is not null then
    raise exception 'not applied by the caller' using errcode = '55000';
  end if;

  v_data := v_proposal.operations -> 0;
  v_variants := v_data -> 'variants';
  v_topic := v_data ->> 'topic';
  if jsonb_typeof(v_variants) is distinct from 'array'
    or p_position < 0 or p_position >= jsonb_array_length(v_variants) then
    raise exception 'no such variant' using errcode = '22023';
  end if;
  v_chosen := v_variants -> p_position;

  update public.proposals set chosen = p_position where id = p_proposal_id;

  if not exists (
    select 1 from public.decisions
    where project_id = v_proposal.project_id
      and lower(topic) = lower(btrim(v_topic))
      and status = 'decided'
  ) then
    perform private.decide(
      v_proposal.project_id,
      v_topic,
      v_chosen ->> 'name',
      v_chosen ->> 'summary',
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('name', entry ->> 'name', 'note', entry ->> 'summary')
            order by position
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(v_variants) with ordinality as other (entry, position)
        where position - 1 <> p_position
      ),
      v_proposal.agent_key,
      private.current_user_id(),
      null,
      p_proposal_id
    );
  end if;
end;
$$;

revoke all on function public.adopt_variant(uuid, integer) from public;
grant execute on function public.adopt_variant(uuid, integer) to covibes_app;
