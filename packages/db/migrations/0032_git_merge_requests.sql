-- The plan package as a merge request (spec 29c).
--
-- A Git request can also bring the package for coding agents into the repository: a commit of its
-- files on a branch of its own, and a merge request for that branch. Both are actions of a request
-- like the issues of migration 0031; they are approved, run and logged the same way. One request
-- for the package waits at a time per project.

alter table public.git_requests drop constraint git_requests_kind_check;
alter table public.git_requests
  add constraint git_requests_kind_check check (kind in ('issues', 'merge_request'));

alter table public.git_actions drop constraint git_actions_kind_check;
alter table public.git_actions
  add constraint git_actions_kind_check
  check (kind in ('milestone', 'issue', 'commit', 'merge_request'));

-- `blocked`: an action it builds on did not work, e.g. the commit of a merge request.
alter table public.git_actions drop constraint git_actions_error_code_check;
alter table public.git_actions
  add constraint git_actions_error_code_check check (
    error_code in (
      'forbidden', 'not_found', 'invalid', 'unreachable', 'no_account', 'milestone', 'blocked',
      'failed'
    )
  );

-- Makes a request for the project's repository, with its actions in their order. Owners and
-- editors do; the server words the actions. A task has one issue per repository: an action for a
-- task that has one, or for which one waits, is refused. A request for the package is refused
-- while another one waits, runs or failed.
create or replace function public.create_git_request(p_project_id uuid, p_kind text, p_actions jsonb)
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
  if p_kind is null or p_kind not in ('issues', 'merge_request') then
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

  if p_kind = 'merge_request' and exists (
    select 1
    from public.git_requests r
    where r.project_id = p_project_id
      and r.kind = 'merge_request'
      and r.status in ('waiting', 'approved', 'failed')
  ) then
    raise exception 'A request for the package waits already' using errcode = '23505';
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
