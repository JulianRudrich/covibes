-- Git actions and their approval (spec 29b).
--
-- Everything that changes something in a repository is a request that waits for approval. A
-- request holds its actions, the single changes; with their outcomes they are the log of Git
-- actions. Owners and editors make a request; who may approve Git actions approves or rejects it.
-- An approved request is a job of the worker, which runs it with the approver's access and writes
-- the outcomes. People change these tables only through the functions below. RLS, policies and
-- grants for covibes_app in this same migration.

create table public.git_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('issues')),
  status text not null default 'waiting'
    check (status in ('waiting', 'approved', 'done', 'failed', 'rejected', 'withdrawn')),
  -- The repository the request was made for, as it was then.
  base_url text not null check (char_length(base_url) between 8 and 300),
  repository_id bigint not null,
  repository_path text not null check (char_length(repository_path) between 1 and 500),
  repository_url text not null check (char_length(repository_url) between 8 and 600),
  -- The names are kept as they were: the log still names a person whose account is gone.
  requested_by uuid references public.users (id) on delete set null,
  requested_by_name text not null default '' check (char_length(requested_by_name) <= 200),
  -- Who approved or rejected it.
  decided_by uuid references public.users (id) on delete set null,
  decided_by_name text not null default '' check (char_length(decided_by_name) <= 200),
  decided_at timestamptz,
  -- When it was done, failed, rejected or taken back.
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index git_requests_project_id_created_at_idx
  on public.git_requests (project_id, created_at desc);

create trigger git_requests_touch_updated_at
  before update on public.git_requests
  for each row execute function private.touch_updated_at();

alter table public.git_requests enable row level security;

revoke all on public.git_requests from public;
grant select on public.git_requests to covibes_app;

create policy "git_requests: members read"
  on public.git_requests for select to covibes_app
  using (private.is_member(project_id));

create table public.git_actions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.git_requests (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Its place in the request; the actions run in this order.
  position integer not null check (position >= 0),
  kind text not null check (kind in ('milestone', 'issue')),
  -- What it is about: the title of the issue or the milestone.
  title text not null check (char_length(title) between 1 and 255),
  -- What is created, in words that name no host.
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- The task of the plan an issue is for.
  task_id uuid,
  status text not null default 'waiting'
    check (status in ('waiting', 'started', 'done', 'failed', 'dropped')),
  attempts integer not null default 0 check (attempts >= 0),
  -- What it created or found: the host's id of it, its number in the repository, its address.
  result_id bigint,
  result_number bigint,
  result_url text check (char_length(result_url) <= 600),
  -- It was there already (a milestone of the same title).
  result_existed boolean not null default false,
  error_code text check (
    error_code in (
      'forbidden', 'not_found', 'invalid', 'unreachable', 'no_account', 'milestone', 'failed'
    )
  ),
  -- What the host said, as text.
  error_detail text not null default '' check (char_length(error_detail) <= 300),
  -- With whose access it ran.
  executed_by uuid references public.users (id) on delete set null,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, position),
  check ((kind = 'issue') = (task_id is not null))
);

create index git_actions_project_id_task_id_idx
  on public.git_actions (project_id, task_id) where task_id is not null;

create trigger git_actions_touch_updated_at
  before update on public.git_actions
  for each row execute function private.touch_updated_at();

alter table public.git_actions enable row level security;

revoke all on public.git_actions from public;
grant select on public.git_actions to covibes_app;

create policy "git_actions: members read"
  on public.git_actions for select to covibes_app
  using (private.is_member(project_id));

-- Whether the current user approves Git actions in a project: owners, and editors with the right.
create function private.can_approve_git(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = p_project_id
      and m.user_id = private.current_user_id()
      and (m.role = 'owner' or m.can_approve_git)
  );
$$;

revoke all on function private.can_approve_git(uuid) from public;
grant execute on function private.can_approve_git(uuid) to covibes_app;

-- Makes a request for the project's repository, with its actions in their order. Owners and
-- editors do; the server words the actions. A task has one issue per repository: an action for a
-- task that has one, or for which one waits, is refused.
create function public.create_git_request(p_project_id uuid, p_kind text, p_actions jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_user_id();
  v_connection public.git_connections;
  v_request_id uuid;
begin
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors make Git requests' using errcode = '42501';
  end if;
  if p_kind is distinct from 'issues' then
    raise exception 'Unknown kind of request' using errcode = '22023';
  end if;
  if p_actions is null
    or jsonb_typeof(p_actions) <> 'array'
    or jsonb_array_length(p_actions) not between 1 and 150
  then
    raise exception 'A request has 1 to 150 actions' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_actions) e
    where jsonb_typeof(e.value) <> 'object'
      or jsonb_typeof(e.value -> 'payload') is distinct from 'object'
      or e.value ->> 'kind' is null
      or e.value -> 'payload' ->> 'title' is null
      or (e.value ->> 'kind' = 'issue' and e.value -> 'payload' ->> 'taskId' is null)
  ) then
    raise exception 'An action has a kind and a payload with a title; an issue names its task'
      using errcode = '22023';
  end if;

  -- One at a time per project, so two requests cannot take the same task.
  perform 1 from public.projects where id = p_project_id for update;
  select * into v_connection from public.git_connections c where c.project_id = p_project_id;
  if not found or v_connection.repository_id is null then
    raise exception 'The project has no repository' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_actions) e
    join public.git_actions a
      on a.project_id = p_project_id
      and a.task_id = (e.value -> 'payload' ->> 'taskId')::uuid
      and a.status <> 'dropped'
    join public.git_requests r on r.id = a.request_id
    where e.value ->> 'kind' = 'issue'
      and r.base_url = v_connection.base_url
      and r.repository_id = v_connection.repository_id
  ) or (
    select count(*) <> count(distinct e.value -> 'payload' ->> 'taskId')
    from jsonb_array_elements(p_actions) e
    where e.value ->> 'kind' = 'issue'
  ) then
    raise exception 'A task has an issue already, or one waits' using errcode = '23505';
  end if;

  insert into public.git_requests (
    project_id, kind, base_url, repository_id, repository_path, repository_url,
    requested_by, requested_by_name
  )
  values (
    p_project_id, p_kind, v_connection.base_url, v_connection.repository_id,
    v_connection.repository_path, v_connection.repository_url, v_actor,
    coalesce((select u.name from public.users u where u.id = v_actor), '')
  )
  returning id into v_request_id;

  insert into public.git_actions (request_id, project_id, position, kind, title, payload, task_id)
  select
    v_request_id,
    p_project_id,
    (e.ordinality - 1)::integer,
    e.value ->> 'kind',
    e.value -> 'payload' ->> 'title',
    e.value -> 'payload',
    case when e.value ->> 'kind' = 'issue' then (e.value -> 'payload' ->> 'taskId')::uuid end
  from jsonb_array_elements(p_actions) with ordinality e;

  return v_request_id;
end;
$$;

revoke all on function public.create_git_request(uuid, text, jsonb) from public;
grant execute on function public.create_git_request(uuid, text, jsonb) to covibes_app;

-- Approves requests of a project, one or several at once: those of the list that wait, or that
-- failed and are tried again. Who may approve Git actions does, with a GitLab account of their
-- own, since the actions run with it. Every approved request becomes a job; the jobs of a project
-- run one after the other. Returns how many were approved.
create function public.approve_git_requests(p_project_id uuid, p_request_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_user_id();
  v_request_id uuid;
  v_count integer := 0;
begin
  if not private.can_approve_git(p_project_id) then
    raise exception 'Only who may approve Git actions approves' using errcode = '42501';
  end if;
  if not exists (select 1 from public.git_accounts a where a.user_id = v_actor) then
    raise exception 'Approving needs an own GitLab account' using errcode = '28000';
  end if;

  for v_request_id in
    update public.git_requests r
    set status = 'approved',
        decided_by = v_actor,
        decided_by_name = coalesce((select u.name from public.users u where u.id = v_actor), ''),
        decided_at = now(),
        finished_at = null
    where r.project_id = p_project_id
      and r.id = any (p_request_ids)
      and r.status in ('waiting', 'failed')
    returning r.id
  loop
    -- What failed before is tried again.
    update public.git_actions a
    set status = 'waiting', error_code = null, error_detail = ''
    where a.request_id = v_request_id and a.status = 'failed';
    perform graphile_worker.add_job(
      'git_request',
      json_build_object('requestId', v_request_id),
      queue_name => 'git:' || p_project_id::text,
      max_attempts => 3
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.approve_git_requests(uuid, uuid[]) from public;
grant execute on function public.approve_git_requests(uuid, uuid[]) to covibes_app;

-- Ends a request without running (the rest of) it: its actions that are not done are dropped.
create function private.end_git_request(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.git_requests r
  set status = p_status, finished_at = now()
  where r.id = p_request_id;
  update public.git_actions a
  set status = 'dropped'
  where a.request_id = p_request_id and a.status in ('waiting', 'started', 'failed');
end;
$$;

revoke all on function private.end_git_request(uuid, text) from public;

-- Rejects a request that waits or failed. Who may approve Git actions does.
create function public.reject_git_request(p_project_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_user_id();
  v_status text;
begin
  if not private.can_approve_git(p_project_id) then
    raise exception 'Only who may approve Git actions rejects' using errcode = '42501';
  end if;
  select r.status into v_status
  from public.git_requests r
  where r.id = p_request_id and r.project_id = p_project_id
  for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_status not in ('waiting', 'failed') then
    raise exception 'The request was decided already' using errcode = '55000';
  end if;
  update public.git_requests r
  set decided_by = v_actor,
      decided_by_name = coalesce((select u.name from public.users u where u.id = v_actor), ''),
      decided_at = now()
  where r.id = p_request_id;
  perform private.end_git_request(p_request_id, 'rejected');
end;
$$;

revoke all on function public.reject_git_request(uuid, uuid) from public;
grant execute on function public.reject_git_request(uuid, uuid) to covibes_app;

-- Takes a waiting request back. Who made it does.
create function public.withdraw_git_request(p_project_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.git_requests;
begin
  if not private.is_member(p_project_id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  select * into v_request
  from public.git_requests r
  where r.id = p_request_id and r.project_id = p_project_id
  for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_request.requested_by is distinct from private.current_user_id() then
    raise exception 'Only who made a request takes it back' using errcode = '42501';
  end if;
  if v_request.status <> 'waiting' then
    raise exception 'The request was decided already' using errcode = '55000';
  end if;
  perform private.end_git_request(p_request_id, 'withdrawn');
end;
$$;

revoke all on function public.withdraw_git_request(uuid, uuid) from public;
grant execute on function public.withdraw_git_request(uuid, uuid) to covibes_app;

-- A request belongs to the repository it was made for. When the project's repository is removed
-- or replaced, what waits or failed is taken back; what runs is finished, and what is done stays.
create function private.withdraw_git_requests_of_repository()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.repository_id is not distinct from old.repository_id
    and new.base_url = old.base_url
  then
    return null;
  end if;
  for v_request_id in
    select r.id
    from public.git_requests r
    where r.project_id = old.project_id and r.status in ('waiting', 'failed')
  loop
    perform private.end_git_request(v_request_id, 'withdrawn');
  end loop;
  return null;
end;
$$;

revoke all on function private.withdraw_git_requests_of_repository() from public;

create trigger git_connections_withdraw_requests
  after delete or update on public.git_connections
  for each row execute function private.withdraw_git_requests_of_repository();

-- Everyone with the project open learns of a new request, of every decision and of every action
-- that ended; the function of migration 0029 announces `git` for the row's project.
create trigger git_requests_announce
  after insert or update on public.git_requests
  for each row execute function private.announce_git_connection();

create trigger git_actions_announce
  after update on public.git_actions
  for each row
  when (new.status is distinct from old.status and new.status in ('done', 'failed'))
  execute function private.announce_git_connection();

-- A new request is mailed to those who may approve it, like a proposal (spec 22b).
create function private.schedule_mail_for_git_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.schedule_notification_mail(m.user_id)
  from public.project_members m
  where m.project_id = new.project_id and (m.role = 'owner' or m.can_approve_git);
  return null;
end;
$$;

revoke all on function private.schedule_mail_for_git_request() from public;

create trigger git_requests_schedule_mail
  after insert on public.git_requests
  for each row
  when (new.status = 'waiting')
  execute function private.schedule_mail_for_git_request();

-- How much waits for the current user in a project (spec 22a), now with the Git requests that
-- wait or failed, for who may approve them.
create or replace function public.project_waiting_count(p_project_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.has_role(p_project_id, 'editor') then 0
    else (
      (
        select count(*)
        from public.proposals pr
        join public.projects p on p.id = pr.project_id
        where pr.project_id = p_project_id
          and pr.status = 'open'
          and (
            pr.kind not in ('decision', 'variants')
            or coalesce(p.settings ->> 'decisionProcess', 'consensus') <> 'owner'
            or private.has_role(p_project_id, 'owner')
          )
      )
      + (
        select count(*)
        from public.hand_raises h
        where h.project_id = p_project_id and h.status = 'open'
      )
      + (
        select count(*)
        from public.votes v
        where v.project_id = p_project_id
          and v.status = 'open'
          and not exists (
            select 1
            from public.vote_ballots b
            where b.vote_id = v.id and b.user_id = private.current_user_id()
          )
      )
      + (
        select count(*)
        from public.plan_suggestions s
        where s.project_id = p_project_id and s.status = 'open'
      )
      + (
        select count(*)
        from public.git_requests g
        where g.project_id = p_project_id
          and g.status in ('waiting', 'failed')
          and private.can_approve_git(p_project_id)
      )
    )::integer
  end;
$$;

-- The same for the worker's mails (spec 22b).
create or replace function public.waiting_for_user(p_user_id uuid)
returns table (
  project_id uuid,
  project_name text,
  waiting integer,
  newest timestamptz,
  last_seen_at timestamptz,
  waiting_mailed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.project_id, p.name, items.waiting::integer, items.newest, a.last_seen_at,
    a.waiting_mailed_at
  from public.project_members m
  join public.projects p on p.id = m.project_id
  left join public.member_activity a on a.project_id = m.project_id and a.user_id = m.user_id
  cross join lateral (
    select count(*) as waiting, max(waiting_items.created_at) as newest
    from (
      select pr.created_at
      from public.proposals pr
      where pr.project_id = m.project_id
        and pr.status = 'open'
        and (
          pr.kind not in ('decision', 'variants')
          or coalesce(p.settings ->> 'decisionProcess', 'consensus') <> 'owner'
          or m.role = 'owner'
        )
      union all
      select h.created_at
      from public.hand_raises h
      where h.project_id = m.project_id and h.status = 'open'
      union all
      select v.created_at
      from public.votes v
      where v.project_id = m.project_id
        and v.status = 'open'
        and not exists (
          select 1
          from public.vote_ballots b
          where b.vote_id = v.id and b.user_id = m.user_id
        )
      union all
      select s.created_at
      from public.plan_suggestions s
      where s.project_id = m.project_id and s.status = 'open'
      union all
      select g.created_at
      from public.git_requests g
      where g.project_id = m.project_id
        and g.status in ('waiting', 'failed')
        and (m.role = 'owner' or m.can_approve_git)
    ) waiting_items
  ) items
  where m.user_id = p_user_id and m.role in ('owner', 'editor') and items.waiting > 0
  order by p.name, m.project_id;
$$;
