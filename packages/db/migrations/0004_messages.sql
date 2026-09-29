-- Chat messages of a project (spec 06).
--
-- People write through the API on their own behalf; RLS makes sure nobody poses as someone else or
-- as an agent. Agent messages come from the server alone (spec 07), with the admin role. Messages
-- cannot be edited or deleted by clients in V1.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  author_kind text not null check (author_kind in ('human', 'agent')),
  -- Deleting an account also deletes its messages.
  author_user_id uuid references public.users (id) on delete cascade,
  author_agent_key text check (char_length(author_agent_key) between 1 and 40),
  content text not null check (char_length(content) between 1 and 8000),
  mentions text[] not null default '{}' check (cardinality(mentions) <= 20),
  block_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(block_refs) = 'array'),
  reply_to uuid,
  status text not null default 'complete' check (status in ('complete', 'streaming', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_one_author check (
    (author_kind = 'human' and author_user_id is not null and author_agent_key is null)
    or (author_kind = 'agent' and author_agent_key is not null and author_user_id is null)
  ),
  -- A reply always points to a message of the same project.
  constraint messages_project_id_id_key unique (project_id, id),
  constraint messages_reply_to_same_project foreign key (project_id, reply_to)
    references public.messages (project_id, id) on delete set null (reply_to)
);

create index messages_project_id_created_at_idx on public.messages (project_id, created_at);

alter table public.messages enable row level security;

create trigger messages_touch_updated_at
  before update on public.messages
  for each row execute function private.touch_updated_at();

-- Grants ----------------------------------------------------------------------------------------
-- Clients may only set these columns; status, block references, replies and timestamps stay with
-- the server. There is no update or delete for clients.

revoke all on public.messages from public;
grant select on public.messages to covibes_app;
grant insert (id, project_id, author_kind, author_user_id, content, mentions)
  on public.messages to covibes_app;

-- Policies --------------------------------------------------------------------------------------

create policy "messages: members read"
  on public.messages for select to covibes_app
  using (private.is_member(project_id));

create policy "messages: editors write as themselves"
  on public.messages for insert to covibes_app
  with check (
    author_kind = 'human'
    and author_user_id = private.current_user_id()
    and author_agent_key is null
    and private.has_role(project_id, 'editor')
  );
