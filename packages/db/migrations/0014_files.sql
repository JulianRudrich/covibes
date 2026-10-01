-- Files of a project (spec 20a).
--
-- People attach files and images to their chat messages. The content lies in the file storage
-- under `storage_key` (invariant 8: metadata in Postgres, large files in the storage); this table
-- holds what the app needs to list, serve and attach them. A file is uploaded first and attached
-- when its message is sent. RLS, policies and grants for covibes_app in this same migration.

create table public.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  uploaded_by uuid references public.users (id) on delete set null,
  -- The message the file is attached to; null until that message is sent.
  message_id uuid references public.messages (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200 and name = btrim(name)),
  -- What the server found the content to be, which decides how agents read it.
  kind text not null check (kind in ('image', 'pdf', 'text')),
  media_type text not null check (char_length(media_type) between 1 and 100),
  -- At most 10 MB.
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  -- Where the content lies in the file storage; made up by the server, never from a file name.
  storage_key text not null unique check (storage_key ~ '^[0-9a-f-]{36}$'),
  created_at timestamptz not null default now()
);

create index files_project_id_created_at_idx on public.files (project_id, created_at);
create index files_message_id_idx on public.files (message_id) where message_id is not null;

alter table public.files enable row level security;

revoke all on public.files from public;
grant select, delete on public.files to covibes_app;
grant insert (project_id, uploaded_by, name, kind, media_type, size_bytes, storage_key)
  on public.files to covibes_app;
grant update (message_id) on public.files to covibes_app;

create policy "files: members read"
  on public.files for select to covibes_app
  using (private.is_member(project_id));

-- Owners and editors upload in their own name; a new file is attached to nothing yet.
create policy "files: editors upload"
  on public.files for insert to covibes_app
  with check (
    uploaded_by = private.current_user_id()
    and message_id is null
    and private.has_role(project_id, 'editor')
  );

-- Whether the message is the user's own message in this project.
create function private.is_own_message(p_project_id uuid, p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and m.project_id = p_project_id
      and m.author_user_id = private.current_user_id()
  );
$$;

revoke all on function private.is_own_message(uuid, uuid) from public;
grant execute on function private.is_own_message(uuid, uuid) to covibes_app;

-- Attaching: the uploader's own file that is attached to nothing yet goes to their own message
-- of the same project. An attached file stays where it is.
create policy "files: uploader attaches"
  on public.files for update to covibes_app
  using (
    uploaded_by = private.current_user_id()
    and message_id is null
    and private.has_role(project_id, 'editor')
  )
  with check (private.is_own_message(project_id, message_id));

-- Taking an upload back before the message is sent.
create policy "files: uploader removes unattached"
  on public.files for delete to covibes_app
  using (uploaded_by = private.current_user_id() and message_id is null);
