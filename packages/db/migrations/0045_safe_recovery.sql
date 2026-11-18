-- Spec 41: operational state is written only by the trusted worker/server roles.
create table public.tool_commands (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  position integer not null check (position >= 0),
  tool_name text not null,
  input jsonb not null,
  status text not null default 'started' check (status in ('started', 'complete')),
  response text,
  canvas jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (run_id, position)
);
alter table public.tool_commands enable row level security;
revoke all on public.tool_commands from public, covibes_app;

create table public.worker_heartbeats (
  singleton boolean primary key default true check (singleton),
  instance_id uuid not null,
  heartbeat_at timestamptz not null default now(),
  ai_available boolean not null default false,
  ai_retry_at timestamptz
);
alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from public, covibes_app;

-- Keep the delivery identity after success, but discard the copied history payload. The
-- completion receipt prevents a lost commit acknowledgement from duplicating an entry.
create table public.board_history_outbox (
  id uuid primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  payload jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (payload is not null or completed_at is not null)
);
create index board_history_outbox_pending on public.board_history_outbox (created_at)
  where completed_at is null;
alter table public.board_history_outbox enable row level security;
revoke all on public.board_history_outbox from public, covibes_app;
