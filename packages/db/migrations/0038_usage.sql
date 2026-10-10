-- Usage and limits (spec 31a).
--
-- What the AI costs is kept per day, project, person, agent, kind of run and model. The table
-- follows the runs by itself, so no job can forget to meter, and it outlives its project, so
-- deleting a project gives nobody their day back. The worker reads the totals before every model
-- call; members read through a function whether a limit is reached. RLS, policies and grants for
-- covibes_app in this same migration.

-- The person a run is for: who caused it. Null for what runs by itself (the observer, an
-- automatic review).
alter table public.ai_runs
  add column user_id uuid references public.users (id) on delete set null;

create index ai_runs_user_id_idx on public.ai_runs (user_id) where user_id is not null;
-- To find the run an agent's message came from, and the runs of a debate.
create index ai_runs_reply_message_id_idx
  on public.ai_runs (reply_message_id) where reply_message_id is not null;
create index ai_runs_debate_id_idx on public.ai_runs (debate_id) where debate_id is not null;

-- Runs from before: a reply to a person's message is that person's run.
update public.ai_runs r
set user_id = m.author_user_id
from public.messages m
where m.id = r.trigger_message_id and m.author_kind = 'human';

-- A new run is the run of who causes it: the person whose request creates it (a mention, an
-- accepted offer, a click), else the person an agent works for when it causes the run (an agent
-- it mentions, a round of a debate). The worker names the person itself where it knows better.
create function private.attribute_ai_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    new.user_id := coalesce(
      private.current_user_id(),
      (
        select r.user_id
        from public.ai_runs r
        where new.trigger_message_id is not null
          and r.reply_message_id = new.trigger_message_id
          and r.user_id is not null
        limit 1
      ),
      (
        select r.user_id
        from public.ai_runs r
        where new.debate_id is not null and r.debate_id = new.debate_id and r.user_id is not null
        order by r.created_at
        limit 1
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function private.attribute_ai_run() from public;

create trigger ai_runs_attribute
  before insert on public.ai_runs
  for each row execute function private.attribute_ai_run();

create table public.usage (
  -- The day in UTC, so a limit means the same for everyone on an instance.
  day date not null,
  -- No reference: the usage of a project that was deleted still counts for its people.
  project_id uuid not null,
  -- Null: nobody; what ran by itself, and what a person used who is gone.
  user_id uuid references public.users (id) on delete cascade,
  agent_key text not null check (char_length(agent_key) between 1 and 40),
  kind text not null,
  -- Empty for a run that ended before it knew its model.
  model text not null default '',
  runs integer not null default 0 check (runs >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0),
  unique nulls not distinct (day, project_id, user_id, agent_key, kind, model)
);

create index usage_project_day_idx on public.usage (project_id, day);
create index usage_user_day_idx on public.usage (user_id, day) where user_id is not null;

alter table public.usage enable row level security;

revoke all on public.usage from public;
grant select on public.usage to covibes_app;

-- Owners read the usage of their project, with who used what (spec 31b). Everyone else learns
-- only whether a limit is reached, through `usage_totals`.
create policy "usage: owners read"
  on public.usage for select to covibes_app
  using (private.has_role(project_id, 'owner'));

-- What the runs of before cost, by the day they were made.
insert into public.usage (
  day, project_id, user_id, agent_key, kind, model, runs, input_tokens, output_tokens, cost_usd
)
select
  (r.created_at at time zone 'utc')::date,
  r.project_id,
  r.user_id,
  r.agent_key,
  r.kind,
  coalesce(r.model, ''),
  count(*) filter (where r.status in ('done', 'error')),
  sum(r.input_tokens),
  sum(r.output_tokens),
  sum(r.cost_usd)
from public.ai_runs r
group by 1, 2, 3, 4, 5, 6;

-- Adds to the usage whatever a run's tokens and costs grow by, on the day that happens, and
-- counts the run once it ended. A run that is written again with less takes nothing back: what
-- was spent stays spent. Tells the project that its usage changed.
create function private.meter_ai_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runs integer;
  v_input bigint;
  v_output bigint;
  v_cost numeric;
begin
  if tg_op = 'INSERT' then
    v_runs := case when new.status in ('done', 'error') then 1 else 0 end;
    v_input := new.input_tokens;
    v_output := new.output_tokens;
    v_cost := new.cost_usd;
  else
    v_runs := case
      when new.status in ('done', 'error') and old.status not in ('done', 'error') then 1
      else 0
    end;
    v_input := greatest(new.input_tokens - old.input_tokens, 0);
    v_output := greatest(new.output_tokens - old.output_tokens, 0);
    v_cost := greatest(new.cost_usd - old.cost_usd, 0);
  end if;
  if v_runs = 0 and v_input = 0 and v_output = 0 and v_cost = 0 then
    return null;
  end if;

  insert into public.usage (
    day, project_id, user_id, agent_key, kind, model, runs, input_tokens, output_tokens, cost_usd
  )
  values (
    (now() at time zone 'utc')::date, new.project_id, new.user_id, new.agent_key, new.kind,
    coalesce(new.model, ''), v_runs, v_input, v_output, v_cost
  )
  on conflict (day, project_id, user_id, agent_key, kind, model) do update
    set runs = public.usage.runs + excluded.runs,
        input_tokens = public.usage.input_tokens + excluded.input_tokens,
        output_tokens = public.usage.output_tokens + excluded.output_tokens,
        cost_usd = public.usage.cost_usd + excluded.cost_usd;

  if v_cost > 0 then
    perform pg_notify(
      'covibes_live', json_build_object('kind', 'usage', 'projectId', new.project_id)::text
    );
  end if;
  return null;
end;
$$;

revoke all on function private.meter_ai_run() from public;

create trigger ai_runs_meter
  after insert or update of status, cost_usd, input_tokens, output_tokens on public.ai_runs
  for each row execute function private.meter_ai_run();

-- A person who is deleted leaves their usage with the projects: it becomes nobody's, so the
-- totals of a project stay what they were.
create function private.keep_usage_of_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage (
    day, project_id, user_id, agent_key, kind, model, runs, input_tokens, output_tokens, cost_usd
  )
  select
    u.day, u.project_id, null, u.agent_key, u.kind, u.model,
    u.runs, u.input_tokens, u.output_tokens, u.cost_usd
  from public.usage u
  where u.user_id = old.id
  on conflict (day, project_id, user_id, agent_key, kind, model) do update
    set runs = public.usage.runs + excluded.runs,
        input_tokens = public.usage.input_tokens + excluded.input_tokens,
        output_tokens = public.usage.output_tokens + excluded.output_tokens,
        cost_usd = public.usage.cost_usd + excluded.cost_usd;
  return old;
end;
$$;

revoke all on function private.keep_usage_of_user() from public;

create trigger users_keep_usage
  before delete on public.users
  for each row execute function private.keep_usage_of_user();

-- What counts toward the limits, for a member of the project: what the project cost in the
-- current month, and what the person cost today across all projects (days and months of UTC).
-- The server compares with the limits and tells members only whether one is reached.
create function public.usage_totals(p_project_id uuid)
returns table (project_month numeric, user_day numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_day date := (now() at time zone 'utc')::date;
  v_month date := make_date(
    extract(year from v_day)::integer, extract(month from v_day)::integer, 1
  );
begin
  if not private.is_member(p_project_id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query
  select
    (
      select coalesce(sum(u.cost_usd), 0)
      from public.usage u
      where u.project_id = p_project_id and u.day >= v_month
    ),
    (
      select coalesce(sum(u.cost_usd), 0)
      from public.usage u
      where u.user_id = v_user and u.day = v_day
    );
end;
$$;

revoke all on function public.usage_totals(uuid) from public;
grant execute on function public.usage_totals(uuid) to covibes_app;
