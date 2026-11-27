-- GitHub App integration (spec 46). Private credentials have no covibes_app grants.

alter table public.git_connections
  add column provider text not null default 'gitlab' check (provider in ('gitlab', 'github')),
  drop constraint git_connections_connected_by_fkey,
  add constraint git_connections_connected_by_fkey
    foreign key (connected_by) references public.users (id) on delete cascade;

create table public.github_accounts (
  user_id uuid primary key references public.users (id) on delete cascade,
  account_id bigint not null check (account_id > 0),
  login text not null check (char_length(login) between 1 and 100),
  name text not null default '' check (char_length(name) <= 200),
  access_token text not null check (char_length(access_token) between 1 and 8000),
  refresh_token text check (char_length(refresh_token) between 1 and 8000),
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.github_accounts enable row level security;
revoke all on public.github_accounts from public, covibes_app;

-- Preserve the old foreign-key invariant separately for each provider.
create function private.check_git_provider_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.provider = 'gitlab' and not exists (
    select 1 from public.git_accounts where user_id = new.connected_by
  )) or (new.provider = 'github' and not exists (
    select 1 from public.github_accounts where user_id = new.connected_by
  )) then
    raise exception 'The repository provider needs its own integration account' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function private.check_git_provider_account() from public;
create trigger git_connections_provider_account before insert or update of connected_by, provider
  on public.git_connections for each row execute function private.check_git_provider_account();

create table public.github_installations (
  project_id uuid primary key references public.git_connections (project_id) on delete cascade,
  user_id uuid not null references public.github_accounts (user_id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  repository_id bigint not null check (repository_id > 0),
  created_at timestamptz not null default now()
);
create index github_installations_installation_idx on public.github_installations (installation_id);
alter table public.github_installations enable row level security;
revoke all on public.github_installations from public, covibes_app;

create table public.github_oauth_states (
  state_hash text primary key check (char_length(state_hash) = 64),
  user_id uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.github_oauth_states enable row level security;
revoke all on public.github_oauth_states from public, covibes_app;

create table public.github_webhook_deliveries (
  delivery_id text primary key check (char_length(delivery_id) between 1 and 100),
  received_at timestamptz not null default now()
);
alter table public.github_webhook_deliveries enable row level security;
revoke all on public.github_webhook_deliveries from public, covibes_app;

-- Preserve GitLab's account-removal cascade without making GitHub depend on a GitLab account.
create function private.disconnect_provider_accounts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.git_connections c
  where c.connected_by = old.user_id
    and c.provider = case when tg_table_name = 'github_accounts' then 'github' else 'gitlab' end;
  return old;
end;
$$;
revoke all on function private.disconnect_provider_accounts() from public;
create trigger git_accounts_disconnect_provider before delete on public.git_accounts
  for each row execute function private.disconnect_provider_accounts();
create trigger github_accounts_disconnect_provider before delete on public.github_accounts
  for each row execute function private.disconnect_provider_accounts();

alter table public.git_requests
  add column provider text not null default 'gitlab' check (provider in ('gitlab', 'github'));

-- Existing request builders all snapshot the provider through this one insertion boundary.
create function private.snapshot_git_provider()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select c.provider into new.provider from public.git_connections c where c.project_id = new.project_id;
  -- Old administrator-created historical requests may outlive a connection. Public request
  -- functions already require one; those historical rows keep the legacy provider.
  new.provider := coalesce(new.provider, 'gitlab');
  return new;
end;
$$;
revoke all on function private.snapshot_git_provider() from public;
create trigger git_requests_provider before insert on public.git_requests
  for each row execute function private.snapshot_git_provider();

create or replace function public.approve_git_requests(p_project_id uuid, p_request_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.current_user_id();
  v_request_id uuid;
  v_provider text;
  v_count integer := 0;
begin
  if not private.can_approve_git(p_project_id) then
    raise exception 'Only who may approve Git actions approves' using errcode = '42501';
  end if;
  select provider into v_provider from public.git_connections where project_id = p_project_id;
  if v_provider = 'github' then
    if not exists (select 1 from public.github_accounts where user_id = v_actor) then
      raise exception 'Approving needs an own GitHub integration account' using errcode = '28000';
    end if;
  elsif not exists (select 1 from public.git_accounts where user_id = v_actor) then
    raise exception 'Approving needs an own GitLab account' using errcode = '28000';
  end if;
  for v_request_id in
    update public.git_requests r
    set status = 'approved', decided_by = v_actor,
        decided_by_name = coalesce((select u.name from public.users u where u.id = v_actor), ''),
        decided_at = now(), finished_at = null
    where r.project_id = p_project_id and r.id = any(p_request_ids)
      and r.status in ('waiting', 'failed') and r.provider = v_provider
    returning r.id
  loop
    update public.git_actions set status = 'waiting', error_code = null, error_detail = ''
      where request_id = v_request_id and status = 'failed';
    perform graphile_worker.add_job('git_request', json_build_object('requestId', v_request_id),
      queue_name => 'git:' || p_project_id::text, max_attempts => 3);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.approve_git_requests(uuid, uuid[]) from public;
grant execute on function public.approve_git_requests(uuid, uuid[]) to covibes_app;
