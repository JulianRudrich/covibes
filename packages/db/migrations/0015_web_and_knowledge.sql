-- Web access and the knowledge of custom agents (spec 20b).
--
-- A run counts the web searches it made, for the usage view. A custom agent gets its own
-- knowledge: files and links its creator gives it, which it reads in a run when the question
-- calls for it. Whoever reads the agent's instructions sees its knowledge, whoever edits the agent
-- maintains it. RLS, policies and grants for covibes_app in this same migration.

alter table public.ai_runs
  add column web_searches integer not null default 0 check (web_searches >= 0);

create table public.agent_knowledge (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.custom_agents (id) on delete cascade,
  kind text not null check (kind in ('file', 'link')),
  -- The file's name, or what the link is called in lists (its address unless a note names it).
  name text not null check (char_length(name) between 1 and 200 and name = btrim(name)),
  -- A link: its address and what the agent should know about it.
  url text check (char_length(url) between 1 and 2000),
  note text not null default '' check (char_length(note) <= 200),
  -- A file: what it is, and where its content lies in the file storage (as for `files`).
  file_kind text check (file_kind in ('image', 'pdf', 'text')),
  media_type text check (char_length(media_type) between 1 and 100),
  size_bytes integer check (size_bytes between 1 and 10485760),
  storage_key text unique check (storage_key ~ '^[0-9a-f-]{36}$'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (
      kind = 'link'
      and url is not null
      and file_kind is null
      and media_type is null
      and size_bytes is null
      and storage_key is null
    )
    or (
      kind = 'file'
      and url is null
      and file_kind is not null
      and media_type is not null
      and size_bytes is not null
      and storage_key is not null
    )
  )
);

create index agent_knowledge_agent_id_created_at_idx
  on public.agent_knowledge (agent_id, created_at);

-- Who reads a custom agent with its instructions: its creator, or the members of the project it
-- is shared in. The same rule as the select policy of `custom_agents`.
create function private.can_read_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.custom_agents a
    where a.id = p_agent_id
      and a.deleted_at is null
      and (
        (a.project_id is null and a.owner_id = private.current_user_id())
        or (a.project_id is not null and private.is_member(a.project_id))
      )
  );
$$;

-- Who edits a custom agent: its creator, or owners and editors of the project it is shared in.
create function private.can_edit_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.custom_agents a
    where a.id = p_agent_id
      and a.deleted_at is null
      and (
        (a.project_id is null and a.owner_id = private.current_user_id())
        or (a.project_id is not null and private.has_role(a.project_id, 'editor'))
      )
  );
$$;

revoke all on function private.can_read_agent(uuid) from public;
revoke all on function private.can_edit_agent(uuid) from public;
grant execute on function private.can_read_agent(uuid) to covibes_app;
grant execute on function private.can_edit_agent(uuid) to covibes_app;

alter table public.agent_knowledge enable row level security;

revoke all on public.agent_knowledge from public;
grant select, delete on public.agent_knowledge to covibes_app;
grant insert (
  agent_id, kind, name, url, note, file_kind, media_type, size_bytes, storage_key, created_by
) on public.agent_knowledge to covibes_app;

create policy "agent_knowledge: readers of the agent read"
  on public.agent_knowledge for select to covibes_app
  using (private.can_read_agent(agent_id));

create policy "agent_knowledge: editors of the agent add"
  on public.agent_knowledge for insert to covibes_app
  with check (created_by = private.current_user_id() and private.can_edit_agent(agent_id));

create policy "agent_knowledge: editors of the agent remove"
  on public.agent_knowledge for delete to covibes_app
  using (private.can_edit_agent(agent_id));
