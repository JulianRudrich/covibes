-- Spec 40: durable admission and accounting, owned by the worker's admin connection.
-- No project/run reference: deleting a project must not refund committed instance spending.
create table public.ai_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  project_id uuid not null,
  user_id uuid references public.users (id) on delete set null,
  agent_key text not null,
  kind text not null,
  purpose text not null,
  model text not null,
  provider text not null default 'anthropic',
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  operator_note text,
  budget_day date not null,
  budget_month date not null,
  outcome text check (outcome in ('succeeded', 'failed', 'cancelled')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'cancelled', 'uncertain', 'reconciled')),
  reserved_usd numeric(14, 6) not null check (reserved_usd > 0),
  hold_usd numeric(14, 6) not null check (hold_usd >= 0),
  cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  web_searches integer not null default 0 check (web_searches >= 0)
);
create index ai_attempts_run_idx on public.ai_attempts (run_id);
create index ai_attempts_hold_idx on public.ai_attempts (budget_month, project_id, user_id)
  where hold_usd > 0;
alter table public.ai_attempts enable row level security;
revoke all on public.ai_attempts from public, covibes_app;

create table public.ai_budget_warnings (
  month date primary key,
  created_at timestamptz not null default clock_timestamp(),
  committed_usd numeric(14, 6) not null,
  limit_usd numeric(14, 6) not null
);
alter table public.ai_budget_warnings enable row level security;
revoke all on public.ai_budget_warnings from public, covibes_app;

-- A job finishing later must not overwrite costs from an earlier failed attempt or the
-- parallel intent classification. Legacy runs retain their original accounting behavior.
create function private.keep_attempt_usage()
returns trigger language plpgsql set search_path = '' as $$
begin
  select greatest(new.cost_usd, coalesce(sum(a.cost_usd), 0)),
         greatest(new.input_tokens, coalesce(sum(a.input_tokens), 0)),
         greatest(new.output_tokens, coalesce(sum(a.output_tokens), 0))
  into new.cost_usd, new.input_tokens, new.output_tokens
  from public.ai_attempts a where a.run_id = new.id;
  return new;
end;
$$;
revoke all on function private.keep_attempt_usage() from public;
create trigger ai_runs_keep_attempt_usage
  before update of cost_usd, input_tokens, output_tokens on public.ai_runs
  for each row execute function private.keep_attempt_usage();

create or replace function private.meter_ai_run()
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
  -- Attempts meter their own spending; legacy runs still use the original path.
  if exists (select 1 from public.ai_attempts a where a.run_id = new.id) then
    v_input := 0;
    v_output := 0;
    v_cost := 0;
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


-- Reuse the original BEFORE DELETE trigger; adding another copying trigger would double usage.
create or replace function private.keep_usage_of_user()
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
  -- Remove the old buckets in this same deletion statement; the FK cascade has nothing left.
  delete from public.usage where user_id = old.id;
  return old;
end;
$$;

-- Members read only their project/person totals; the operator aggregate stays admin-only.
drop function public.usage_totals(uuid);
create function public.usage_totals(p_project_id uuid)
returns table (project_month numeric, user_day numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := private.current_user_id();
  v_day date := (now() at time zone 'utc')::date;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
begin
  if not private.is_member(p_project_id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query select
    (select coalesce(sum(u.cost_usd), 0) from public.usage u
      where u.project_id = p_project_id and u.day >= v_month and u.day < (v_month + interval '1 month'))
      + (select coalesce(sum(a.hold_usd), 0) from public.ai_attempts a
         where a.hold_usd > 0 and a.project_id = p_project_id and a.budget_month = v_month),
    (select coalesce(sum(u.cost_usd), 0) from public.usage u
      where u.user_id = v_user and u.day = v_day)
      + (select coalesce(sum(a.hold_usd), 0) from public.ai_attempts a
         where a.hold_usd > 0 and a.user_id = v_user and a.budget_day = v_day);
end;
$$;
revoke all on function public.usage_totals(uuid) from public;
grant execute on function public.usage_totals(uuid) to covibes_app;
