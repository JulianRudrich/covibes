-- Read-only links (spec 21b).
--
-- A project can be shown to people without an account: the canvas and the overview, not the chat.
-- A request with a link runs as covibes_app without a user; the server sets the link's token for
-- the transaction (`app.share_token`), and the policies below let it read what the view needs of
-- that one project. No policy lets it read people. Only the hash of a token is stored. RLS,
-- policies and grants for covibes_app in this same migration.

create table public.share_links (
  -- One link per project; a new one replaces it.
  project_id uuid primary key references public.projects (id) on delete cascade,
  -- SHA-256 of the token as lowercase hex; the token itself is only in the link.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.share_links enable row level security;

-- The hash is written, never read.
revoke all on public.share_links from public;
grant select (project_id, created_by, created_at) on public.share_links to covibes_app;
grant insert (project_id, token_hash, created_by) on public.share_links to covibes_app;
grant update (token_hash, created_by, created_at) on public.share_links to covibes_app;
grant delete on public.share_links to covibes_app;

-- Every member sees that the project has a link: their work is visible through it.
create policy "share_links: members read"
  on public.share_links for select to covibes_app
  using (private.is_member(project_id));

create policy "share_links: owners create"
  on public.share_links for insert to covibes_app
  with check (created_by = private.current_user_id() and private.has_role(project_id, 'owner'));

create policy "share_links: owners replace"
  on public.share_links for update to covibes_app
  using (private.has_role(project_id, 'owner'))
  with check (created_by = private.current_user_id() and private.has_role(project_id, 'owner'));

create policy "share_links: owners remove"
  on public.share_links for delete to covibes_app
  using (private.has_role(project_id, 'owner'));

-- The project of the link whose token is set for this transaction, or null. Anything that cannot
-- be a token, and a token nobody issued, is null.
create function private.shared_project_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.project_id
  from public.share_links s
  where s.token_hash = private.invitation_token_hash(
    nullif(current_setting('app.share_token', true), '')
  );
$$;

revoke all on function private.shared_project_id() from public;
grant execute on function private.shared_project_id() to covibes_app;

-- What a link reads -------------------------------------------------------------------------------
-- The subselect makes the function run once per statement instead of once per row.

create policy "projects: share link reads"
  on public.projects for select to covibes_app
  using (id = (select private.shared_project_id()));

create policy "boards: share link reads"
  on public.boards for select to covibes_app
  using (project_id = (select private.shared_project_id()));

create policy "criteria: share link reads"
  on public.criteria for select to covibes_app
  using (project_id = (select private.shared_project_id()));

create policy "decisions: share link reads"
  on public.decisions for select to covibes_app
  using (project_id = (select private.shared_project_id()));

-- What a decision shows with it: the comparison it followed, the result of the vote that decided
-- (never who voted for what), and the variants it chose from.
create policy "comparisons: share link reads"
  on public.comparisons for select to covibes_app
  using (project_id = (select private.shared_project_id()));

create policy "votes: share link reads"
  on public.votes for select to covibes_app
  using (project_id = (select private.shared_project_id()));

create policy "proposals: share link reads variants"
  on public.proposals for select to covibes_app
  using (kind = 'variants' and project_id = (select private.shared_project_id()));

-- Name and color of the custom agents the shared project refers to (its team, its shared agents,
-- authors of a run in it), so the canvas names them. Never their role, instructions or creator.
create function public.shared_agent_directory()
returns table (id uuid, name text, color smallint, deleted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.name, a.color, a.deleted_at is not null
  from public.custom_agents a
  cross join (select private.shared_project_id() as project_id) shared
  where shared.project_id is not null
    and (
      a.project_id = shared.project_id
      or exists (
        select 1
        from public.project_agents pa
        where pa.project_id = shared.project_id and pa.agent_key = a.id::text
      )
      or exists (
        select 1
        from public.ai_runs r
        where r.project_id = shared.project_id and r.agent_key = a.id::text
      )
    )
  order by lower(a.name), a.id;
$$;

revoke all on function public.shared_agent_directory() from public;
grant execute on function public.shared_agent_directory() to covibes_app;
