-- Agent runs and their jobs (spec 07).
--
-- A human message that mentions an agent creates one run per agent and a job for the worker, in
-- the same transaction as the message. Clients can create neither: the trigger runs as its owner,
-- and covibes_app has no access to the job queue (schema graphile_worker).

-- An agent message starts empty while its answer streams in.
alter table public.messages drop constraint messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(content) <= 8000 and (status = 'streaming' or char_length(content) >= 1)
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  agent_key text not null check (char_length(agent_key) between 1 and 40),
  trigger_message_id uuid references public.messages (id) on delete set null,
  reply_message_id uuid references public.messages (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  provider text,
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index ai_runs_project_id_status_idx on public.ai_runs (project_id, status);

alter table public.ai_runs enable row level security;

revoke all on public.ai_runs from public;
grant select on public.ai_runs to covibes_app;

create policy "ai_runs: members read"
  on public.ai_runs for select to covibes_app
  using (private.is_member(project_id));

-- Jobs ------------------------------------------------------------------------------------------

-- One run and one job per mentioned agent. Until the agent catalog (spec 14) only the moderator
-- answers. Every agent has its own serial queue per project, so it answers one request after the
-- other; different agents work in parallel. The notification lets the chat show "waiting" at once.
create function private.enqueue_agent_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_key text;
  v_run_id uuid;
begin
  foreach v_agent_key in array new.mentions loop
    continue when v_agent_key <> 'moderator';

    insert into public.ai_runs (project_id, agent_key, trigger_message_id)
    values (new.project_id, v_agent_key, new.id)
    returning id into v_run_id;

    perform graphile_worker.add_job(
      'agent_turn',
      json_build_object('runId', v_run_id),
      queue_name => 'agent:' || new.project_id || ':' || v_agent_key,
      max_attempts => 3
    );

    perform pg_notify(
      'covibes_live',
      json_build_object('kind', 'run', 'projectId', new.project_id, 'runId', v_run_id)::text
    );
  end loop;
  return new;
end;
$$;

revoke all on function private.enqueue_agent_runs() from public;

create trigger messages_enqueue_agent_runs
  after insert on public.messages
  for each row
  when (new.author_kind = 'human' and cardinality(new.mentions) > 0)
  execute function private.enqueue_agent_runs();
