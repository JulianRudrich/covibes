-- Proposals of agents (spec 13).
--
-- A canvas change that an agent may not make directly (a question, the proposals-only mode, a
-- block someone edits) is stored here as operations until someone applies or rejects it. Only the
-- worker creates proposals and changes their operations (admin role); owners and editors decide
-- them. Every table: RLS, policies and grants for covibes_app in this same migration.

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  run_id uuid references public.ai_runs (id) on delete set null,
  agent_key text not null check (char_length(agent_key) between 1 and 40),
  kind text not null default 'canvas' check (kind in ('canvas')),
  status text not null default 'open' check (status in ('open', 'applied', 'rejected')),
  reason text not null check (reason in ('question', 'initiative', 'proposals_only', 'locked')),
  operations jsonb not null check (jsonb_typeof(operations) = 'array'),
  -- Titles of the existing elements the operations refer to, as they were when proposed, so the
  -- overview can name them without loading the board.
  names jsonb not null default '{}'::jsonb check (jsonb_typeof(names) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users (id) on delete set null,
  -- A decided proposal records when; an open one has no decision yet.
  check ((status = 'open') = (decided_at is null))
);

create index proposals_project_id_status_idx on public.proposals (project_id, status);
create index proposals_run_id_idx on public.proposals (run_id);

create trigger proposals_touch_updated_at
  before update on public.proposals
  for each row execute function private.touch_updated_at();

alter table public.proposals enable row level security;

revoke all on public.proposals from public;
grant select on public.proposals to covibes_app;
grant update (status, decided_at, decided_by) on public.proposals to covibes_app;

create policy "proposals: members read"
  on public.proposals for select to covibes_app
  using (private.is_member(project_id));

-- Owners and editors apply or reject open proposals, in their own name.
create policy "proposals: editors decide"
  on public.proposals for update to covibes_app
  using (status = 'open' and private.has_role(project_id, 'editor'))
  with check (
    status in ('applied', 'rejected')
    and decided_by = private.current_user_id()
    and private.has_role(project_id, 'editor')
  );
