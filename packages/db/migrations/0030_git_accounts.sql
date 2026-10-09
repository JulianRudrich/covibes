-- GitLab access per person (spec 29a).
--
-- Git actions run with the access of the person who approves them, so the tokens belong to a
-- person now, not to a project: everyone connects one GitLab account. A project still has one
-- repository; its connection names the owner who picked it, and the agents read with that
-- person's access. The tokens stay sealed by the server, and no request of a user reads them.
-- RLS and grants for covibes_app in this same migration.

create table public.git_accounts (
  user_id uuid primary key references public.users (id) on delete cascade,
  -- Where the GitLab is, e.g. https://gitlab.com.
  base_url text not null check (char_length(base_url) between 8 and 300),
  -- The account in GitLab.
  account_id bigint not null,
  account_username text not null check (char_length(account_username) between 1 and 255),
  account_name text not null default '' check (char_length(account_name) <= 255),
  -- The tokens, encrypted by the server (AES-256-GCM).
  access_token text not null check (char_length(access_token) between 1 and 4000),
  refresh_token text check (char_length(refresh_token) between 1 and 4000),
  -- When the access token ends; null if GitLab gave none.
  expires_at timestamptz,
  scope text not null default '' check (char_length(scope) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- covibes_app has no access at all: RLS is on, there is no policy and no grant.
alter table public.git_accounts enable row level security;

revoke all on public.git_accounts from public;

-- The connections of spec 28a become the account of the owner who made them. Someone who
-- connected several projects keeps the tokens that were renewed last.
insert into public.git_accounts (
  user_id, base_url, account_id, account_username, account_name,
  access_token, refresh_token, expires_at, scope, created_at, updated_at
)
select distinct on (c.connected_by)
  c.connected_by, c.base_url, c.account_id, c.account_username, c.account_name,
  t.access_token, t.refresh_token, t.expires_at, t.scope, c.created_at, t.updated_at
from public.git_connections c
join public.oauth_tokens t on t.project_id = c.project_id
order by c.connected_by, t.updated_at desc;

drop table public.oauth_tokens;

-- A connection without tokens could not be used; none should exist.
delete from public.git_connections c
where not exists (select 1 from public.git_accounts a where a.user_id = c.connected_by);

-- From now on a project is connected by picking its repository. A connection of spec 28a whose
-- owner had not picked one yet is just that owner's account now.
delete from public.git_connections where repository_id is null;

-- A project's connection lives on the account of the owner who picked the repository: when that
-- person disconnects their account, the project is disconnected with it.
alter table public.git_connections
  drop constraint git_connections_connected_by_fkey,
  add constraint git_connections_connected_by_fkey
    foreign key (connected_by) references public.git_accounts (user_id) on delete cascade;
