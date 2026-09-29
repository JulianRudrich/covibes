-- Stored Y.Docs of the collaboration server (spec 05), e.g. `board:{boardId}`.
--
-- Only the server reads and writes them, with the admin role: RLS is on without any policy, and
-- covibes_app has no rights at all. Access checks happen before a document is loaded (board
-- membership in the Hocuspocus auth hook).

create table public.yjs_documents (
  name text primary key check (length(name) between 1 and 200),
  state bytea not null,
  updated_at timestamptz not null default now()
);

alter table public.yjs_documents enable row level security;
revoke all on public.yjs_documents from public, covibes_app;
