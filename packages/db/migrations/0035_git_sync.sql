-- Task status from the repository (spec 30a).
--
-- After the handover GitLab owns the status of a task. A job of the worker reads the issues
-- Covibes created and stores here whether each is open or closed. Members ask for that reading;
-- a webhook with the project's secret does too. RLS, policies and grants for covibes_app in this
-- same migration.

create table public.git_issue_states (
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The repository the issue is in.
  base_url text not null check (char_length(base_url) between 8 and 300),
  repository_id bigint not null,
  -- Its number there, as people write it: "#12".
  number bigint not null check (number > 0),
  state text not null check (state in ('opened', 'closed')),
  synced_at timestamptz not null default now(),
  primary key (project_id, base_url, repository_id, number)
);

alter table public.git_issue_states enable row level security;

revoke all on public.git_issue_states from public;
grant select on public.git_issue_states to covibes_app;

create policy "git_issue_states: members read"
  on public.git_issue_states for select to covibes_app
  using (private.is_member(project_id));

-- When the repository's state was last asked for and last read, per project.
create table public.git_sync (
  project_id uuid primary key references public.projects (id) on delete cascade,
  requested_at timestamptz,
  synced_at timestamptz,
  -- The last reading did not work.
  failed boolean not null default false
);

alter table public.git_sync enable row level security;

revoke all on public.git_sync from public;
grant select on public.git_sync to covibes_app;

create policy "git_sync: members read"
  on public.git_sync for select to covibes_app
  using (private.is_member(project_id));

-- What was read belongs to one repository. A project that gets another repository, or loses its
-- repository, starts anew: nothing was read yet, and the next reading may run at once.
create function private.forget_git_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.git_sync where project_id = old.project_id;
    return old;
  end if;
  if new.repository_id is distinct from old.repository_id
    or new.base_url is distinct from old.base_url
  then
    delete from public.git_sync where project_id = new.project_id;
  end if;
  return new;
end;
$$;

revoke all on function private.forget_git_sync() from public;

create trigger git_connections_forget_sync
  after update or delete on public.git_connections
  for each row execute function private.forget_git_sync();

-- The secret GitLab sends with a webhook call, encrypted by the server like the tokens.
-- covibes_app has no access at all: RLS is on, there is no policy and no grant.
create table public.git_webhooks (
  project_id uuid primary key references public.projects (id) on delete cascade,
  secret text not null check (char_length(secret) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.git_webhooks enable row level security;

revoke all on public.git_webhooks from public;

-- Queues the job that reads the repository's state, for a project with a repository. Several
-- calls in a row become one job: a burst of webhook calls reads once. Whether a job is queued.
create function private.queue_git_sync(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.git_connections c
    where c.project_id = p_project_id and c.repository_id is not null
  ) then
    return false;
  end if;
  insert into public.git_sync (project_id, requested_at)
  values (p_project_id, now())
  on conflict (project_id) do update set requested_at = now();
  perform graphile_worker.add_job(
    'git_sync',
    json_build_object('projectId', p_project_id),
    queue_name => 'git-sync:' || p_project_id::text,
    run_at => now() + interval '2 seconds',
    max_attempts => 2,
    job_key => 'git_sync:' || p_project_id::text,
    job_key_mode => 'preserve_run_at'
  );
  return true;
end;
$$;

revoke all on function private.queue_git_sync(uuid) from public;

-- A member asks for the repository's state to be read: by opening the project, regularly while it
-- is open, or with a click (`p_force`). Not more often than every two minutes per project, and
-- with a click not more often than every ten seconds. Whether a job was queued.
create function public.request_git_sync(p_project_id uuid, p_force boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_at timestamptz;
begin
  if not private.is_member(p_project_id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  select s.requested_at into v_requested_at
  from public.git_sync s
  where s.project_id = p_project_id;
  if v_requested_at is not null
    and v_requested_at > now() - (
      case when coalesce(p_force, false) then interval '10 seconds' else interval '2 minutes' end
    )
  then
    return false;
  end if;
  return private.queue_git_sync(p_project_id);
end;
$$;

revoke all on function public.request_git_sync(uuid, boolean) from public;
grant execute on function public.request_git_sync(uuid, boolean) to covibes_app;
