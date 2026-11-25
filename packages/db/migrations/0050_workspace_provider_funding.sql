-- Spec 44. Application users, including workspace owners, cannot read ciphertext through SQL.
create table public.workspace_provider_keys (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  ciphertext text not null,
  primary key (workspace_id, provider)
);
alter table public.workspace_provider_keys enable row level security;
revoke all on public.workspace_provider_keys from public, covibes_app;

alter table public.ai_attempts
  add column payer text not null default 'instance' check (payer in ('instance', 'workspace')),
  add column workspace_id uuid references public.workspaces(id) on delete set null;
update public.ai_attempts a set workspace_id = p.workspace_id
  from public.projects p where p.id = a.project_id;
create index ai_attempts_workspace_month_idx on public.ai_attempts(workspace_id, budget_month);
create index ai_attempts_workspace_payer_month_idx on public.ai_attempts(budget_month) where payer = 'workspace';

-- The usage buckets include legacy calls and spend from both sources. Remove only the settled
-- workspace portion. Uncertain instance attempts keep the unaccounted part of their reservation.
create function private.instance_committed_usd(p_month date)
returns numeric language sql stable set search_path = '' as $$
  select (select coalesce(sum(cost_usd), 0) from public.usage
           where day >= p_month and day < p_month + interval '1 month')
       - (select coalesce(sum(cost_usd), 0) from public.ai_attempts
           where payer = 'workspace' and budget_month = p_month)
       + (select coalesce(sum(hold_usd), 0) from public.ai_attempts
           where payer = 'instance' and hold_usd > 0 and budget_month = p_month)
$$;
revoke all on function private.instance_committed_usd(date) from public, covibes_app;

-- Freeze costs predating the attempt ledger while the projects that own them are still known.
-- Old projects already deleted before this migration no longer have a workspace to attribute.
create table public.workspace_legacy_ai_costs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  month date not null,
  cost_usd numeric not null check (cost_usd > 0),
  primary key (workspace_id, month)
);
alter table public.workspace_legacy_ai_costs enable row level security;
revoke all on public.workspace_legacy_ai_costs from public, covibes_app;
insert into public.workspace_legacy_ai_costs (workspace_id, month, cost_usd)
select workspace_id, month, sum(amount) from (
  select p.workspace_id, date_trunc('month', u.day)::date as month, u.cost_usd as amount
  from public.usage u join public.projects p on p.id = u.project_id
  union all
  select workspace_id, budget_month, -cost_usd from public.ai_attempts where workspace_id is not null
) amounts group by workspace_id, month having sum(amount) > 0;
