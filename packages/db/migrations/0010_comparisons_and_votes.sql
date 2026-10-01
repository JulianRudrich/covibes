-- Comparisons, votes and decision processes (spec 16b).
--
-- A comparison and a vote each belong to a moderator message and show as a card in the chat; only
-- the worker creates them. Owners and editors vote through `cast_vote`; a vote ends when all of
-- them have voted or an owner ends it (`close_vote`), and its winner is recorded as the decision.
-- Every table: RLS, policies and grants for covibes_app in this same migration.

create table public.comparisons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  message_id uuid not null unique references public.messages (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 80 and topic = btrim(topic)),
  -- Options, one row per criterion with a rating per option, and the recommendation if any.
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);

create index comparisons_project_id_created_at_idx on public.comparisons (project_id, created_at);

alter table public.comparisons enable row level security;

revoke all on public.comparisons from public;
grant select on public.comparisons to covibes_app;

create policy "comparisons: members read"
  on public.comparisons for select to covibes_app
  using (private.is_member(project_id));

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  message_id uuid not null unique references public.messages (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 80 and topic = btrim(topic)),
  -- The names of the options; a ballot refers to one by its position.
  options jsonb not null check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5
  ),
  status text not null default 'open' check (status in ('open', 'closed')),
  -- The option with the most votes; null while open and after a tie.
  winner text,
  -- Once closed: [{ "name": …, "votes": n }] in the order of the options.
  tally jsonb,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.users (id) on delete set null,
  check ((status = 'open') = (closed_at is null))
);

-- One open vote per topic.
create unique index votes_one_open_per_topic
  on public.votes (project_id, lower(topic)) where status = 'open';

alter table public.votes enable row level security;

revoke all on public.votes from public;
grant select on public.votes to covibes_app;

create policy "votes: members read"
  on public.votes for select to covibes_app
  using (private.is_member(project_id));

create table public.vote_ballots (
  vote_id uuid not null references public.votes (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  option smallint not null check (option >= 0),
  created_at timestamptz not null default now(),
  primary key (vote_id, user_id)
);

alter table public.vote_ballots enable row level security;

revoke all on public.vote_ballots from public;
grant select on public.vote_ballots to covibes_app;

-- Who voted for what is visible to the members of the project.
create policy "vote_ballots: members read"
  on public.vote_ballots for select to covibes_app
  using (
    exists (
      select 1 from public.votes v
      where v.id = vote_ballots.vote_id and private.is_member(v.project_id)
    )
  );

-- Decisions carry their comparison and their vote ---------------------------------------------------

alter table public.decisions
  add column comparison_id uuid references public.comparisons (id) on delete set null,
  add column vote_id uuid references public.votes (id) on delete set null;

alter table public.proposals drop constraint proposals_reason_check;
alter table public.proposals add constraint proposals_reason_check check (
  reason in ('question', 'initiative', 'proposals_only', 'locked', 'owner_decides')
);

-- The log entry of a decision refers to its comparison and holds the result of its vote.
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
          'votes', (select tally from public.votes where id = new.vote_id)
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

-- `decide` takes the latest comparison of the topic along, and the vote that decided, if any.
drop function private.decide(uuid, text, text, text, jsonb, text, uuid);

create function private.decide(
  p_project_id uuid,
  p_topic text,
  p_value text,
  p_reasoning text,
  p_alternatives jsonb,
  p_agent text,
  p_user uuid,
  p_vote_id uuid default null
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
       recorded_by_agent, comparison_id, vote_id)
    values
      (p_project_id, v_topic, 'decided', btrim(p_value), coalesce(p_reasoning, ''),
       coalesce(p_alternatives, '[]'::jsonb), p_user, now(), p_agent, v_comparison_id, p_vote_id)
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
    vote_id = p_vote_id
  where id = v_decision.id;
  return v_decision.id;
end;
$$;

revoke all on function private.decide(uuid, text, text, text, jsonb, text, uuid, uuid) from public;

-- Reopening also lets go of the comparison and the vote; the log keeps them.
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
    reopen_reason = btrim(p_reason),
    reopened_by = private.current_user_id()
  where id = p_decision_id;

  v_run_id := private.enqueue_reply_run(v_decision.project_id, 'moderator', null, null);
  update public.ai_runs set decision_id = p_decision_id where id = v_run_id;
  return v_run_id;
end;
$$;

-- While the owner decides, only owners confirm a decision.
create or replace function public.record_decision(
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
  if (select settings ->> 'decisionProcess' from public.projects where id = p_project_id) = 'owner'
    and not private.has_role(p_project_id, 'owner') then
    raise exception 'the owner decides' using errcode = '42501';
  end if;
  return private.decide(
    p_project_id, p_topic, p_value, p_reasoning, p_alternatives, p_agent,
    private.current_user_id()
  );
end;
$$;

-- Voting ----------------------------------------------------------------------------------------------

-- Ends a vote: counts the ballots, and records the option with the most votes as the decision.
-- A tie, or no ballot at all, ends it without a decision.
create function private.finish_vote(p_vote_id uuid, p_closed_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vote public.votes;
  v_tally jsonb;
  v_most integer;
  v_winner text;
begin
  select * into v_vote from public.votes where id = p_vote_id for update;

  select jsonb_agg(
    jsonb_build_object('name', o.name, 'votes', coalesce(b.count, 0)) order by o.position
  )
  into v_tally
  from jsonb_array_elements_text(v_vote.options) with ordinality as o (name, position)
  left join (
    select option, count(*)::integer as count
    from public.vote_ballots
    where vote_id = p_vote_id
    group by option
  ) as b on b.option = o.position - 1;

  select max((entry ->> 'votes')::integer) into v_most from jsonb_array_elements(v_tally) as entry;
  if v_most > 0 and (
    select count(*) from jsonb_array_elements(v_tally) as entry
    where (entry ->> 'votes')::integer = v_most
  ) = 1 then
    select entry ->> 'name' into v_winner
    from jsonb_array_elements(v_tally) as entry
    where (entry ->> 'votes')::integer = v_most;
  end if;

  update public.votes
  set status = 'closed', winner = v_winner, tally = v_tally, closed_at = now(),
    closed_by = p_closed_by
  where id = p_vote_id;

  if v_winner is not null then
    begin
      perform private.decide(
        v_vote.project_id, v_vote.topic, v_winner, '',
        (
          select coalesce(
            jsonb_agg(jsonb_build_object('name', entry ->> 'name', 'note', '')), '[]'::jsonb
          )
          from jsonb_array_elements(v_tally) as entry
          where entry ->> 'name' <> v_winner
        ),
        'moderator', null, p_vote_id
      );
    exception when sqlstate '55000' then
      -- The topic was decided another way in the meantime; the vote keeps its result.
      null;
    end;
  end if;
end;
$$;

revoke all on function private.finish_vote(uuid, uuid) from public;

-- The vote's card is part of its message, so the message is announced again.
create function private.announce_vote(p_vote public.votes)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_notify(
    'covibes_live',
    json_build_object(
      'kind', 'message', 'projectId', p_vote.project_id, 'messageId', p_vote.message_id
    )::text
  );
$$;

revoke all on function private.announce_vote(public.votes) from public;

-- An owner or editor votes, or changes their vote. Once all of them have voted, the vote ends.
-- Errors: 'P0002' unknown, '42501' viewers, '55000' closed, '22023' no such option.
create function public.cast_vote(p_vote_id uuid, p_option integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vote public.votes;
begin
  select * into v_vote from public.votes where id = p_vote_id for update;
  perform private.check_decider(v_vote.project_id);
  if v_vote.status <> 'open' then
    raise exception 'the vote is closed' using errcode = '55000';
  end if;
  if p_option < 0 or p_option >= jsonb_array_length(v_vote.options) then
    raise exception 'no such option' using errcode = '22023';
  end if;

  insert into public.vote_ballots (vote_id, user_id, option)
  values (p_vote_id, private.current_user_id(), p_option)
  on conflict (vote_id, user_id) do update set option = excluded.option, created_at = now();

  if not exists (
    select 1
    from public.project_members m
    where m.project_id = v_vote.project_id
      and m.role >= 'editor'
      and not exists (
        select 1 from public.vote_ballots b where b.vote_id = p_vote_id and b.user_id = m.user_id
      )
  ) then
    perform private.finish_vote(p_vote_id, null);
  end if;
  perform private.announce_vote(v_vote);
end;
$$;

-- An owner ends the vote with the ballots cast so far.
create function public.close_vote(p_vote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vote public.votes;
begin
  select * into v_vote from public.votes where id = p_vote_id for update;
  perform private.check_decider(v_vote.project_id);
  if not private.has_role(v_vote.project_id, 'owner') then
    raise exception 'only owners end a vote' using errcode = '42501';
  end if;
  if v_vote.status <> 'open' then
    raise exception 'the vote is closed' using errcode = '55000';
  end if;
  perform private.finish_vote(p_vote_id, private.current_user_id());
  perform private.announce_vote(v_vote);
end;
$$;

revoke all on function public.cast_vote(uuid, integer) from public;
revoke all on function public.close_vote(uuid) from public;
grant execute on function public.cast_vote(uuid, integer) to covibes_app;
grant execute on function public.close_vote(uuid) to covibes_app;
