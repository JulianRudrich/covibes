-- Connecting GitLab (spec 28a).
--
-- A project has at most one connection to a GitLab, made by an owner through OAuth. The connection
-- says where the GitLab is, whose account it is and which repository the project belongs to; its
-- tokens sit apart, encrypted by the server, and no request of a user reads them. The server
-- writes both after it checked who asks. RLS, policies and grants for covibes_app in this same
-- migration.

create table public.git_connections (
  project_id uuid primary key references public.projects (id) on delete cascade,
  -- Where the GitLab is, e.g. https://gitlab.com; stored per connection (self-managed GitLab).
  base_url text not null check (char_length(base_url) between 8 and 300),
  -- The owner whose access this is.
  connected_by uuid not null references public.users (id) on delete cascade,
  -- The account in GitLab.
  account_id bigint not null,
  account_username text not null check (char_length(account_username) between 1 and 255),
  account_name text not null default '' check (char_length(account_name) <= 255),
  -- The repository, once the owner picked it.
  repository_id bigint,
  repository_path text check (char_length(repository_path) between 1 and 500),
  repository_name text check (char_length(repository_name) between 1 and 255),
  repository_url text check (char_length(repository_url) between 8 and 600),
  repository_default_branch text check (char_length(repository_default_branch) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((repository_id is null) = (repository_path is null)),
  check ((repository_id is null) = (repository_name is null)),
  check ((repository_id is null) = (repository_url is null))
);

create trigger git_connections_touch_updated_at
  before update on public.git_connections
  for each row execute function private.touch_updated_at();

alter table public.git_connections enable row level security;

revoke all on public.git_connections from public;
grant select on public.git_connections to covibes_app;

create policy "git_connections: members read"
  on public.git_connections for select to covibes_app
  using (private.is_member(project_id));

-- The tokens of a connection, encrypted by the server (AES-256-GCM). covibes_app has no access at
-- all: RLS is on, there is no policy and no grant.
create table public.oauth_tokens (
  project_id uuid primary key references public.git_connections (project_id) on delete cascade,
  access_token text not null check (char_length(access_token) between 1 and 4000),
  refresh_token text check (char_length(refresh_token) between 1 and 4000),
  -- When the access token ends; null if GitLab gave none.
  expires_at timestamptz,
  scope text not null default '' check (char_length(scope) <= 500),
  updated_at timestamptz not null default now()
);

alter table public.oauth_tokens enable row level security;

revoke all on public.oauth_tokens from public;

-- Everyone with the project open learns that its connection changed.
create function private.announce_git_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_notify(
    'covibes_live',
    json_build_object('kind', 'git', 'projectId', coalesce(new.project_id, old.project_id))::text
  );
  return null;
end;
$$;

revoke all on function private.announce_git_connection() from public;

create trigger git_connections_announce
  after insert or update or delete on public.git_connections
  for each row execute function private.announce_git_connection();

-- The access belongs to the owner who connected. Once that person leaves the project, is removed
-- from it or is no owner any more, the connection ends, and its tokens with it.
create function private.end_git_connection_of_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.role <> 'owner' then
    delete from public.git_connections c
    where c.project_id = old.project_id and c.connected_by = old.user_id;
  end if;
  return null;
end;
$$;

revoke all on function private.end_git_connection_of_member() from public;

create trigger project_members_end_git_connection
  after delete or update of role on public.project_members
  for each row execute function private.end_git_connection_of_member();
