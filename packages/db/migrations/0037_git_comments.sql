-- The review as a comment (spec 30c).
--
-- A Git request can also post the review of a merge request as a comment there. It is approved,
-- run and logged like the others. A review is laid before the approvers once at a time and posted
-- once; what waits for an older review of the same merge request is taken back when a newer one
-- arrives.

alter table public.git_requests drop constraint git_requests_kind_check;
alter table public.git_requests
  add constraint git_requests_kind_check
  check (kind in ('issues', 'merge_request', 'merge', 'comment'));

alter table public.git_actions drop constraint git_actions_kind_check;
alter table public.git_actions
  add constraint git_actions_kind_check
  check (kind in ('milestone', 'issue', 'commit', 'merge_request', 'merge', 'comment'));

-- Stores a request for the project's repository, with its actions in their order, made by a
-- person or by an agent. A task has one issue per repository: an action for a task that has one,
-- or for which one waits, is refused. A request for the package, one to merge a merge request and
-- one to post a review is refused while another one for the same waits, runs or failed; a review
-- that was posted is not posted again. Who may ask is checked by the caller.
create or replace function private.insert_git_request(
  p_project_id uuid,
  p_kind text,
  p_actions jsonb,
  p_requested_by uuid,
  p_agent_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.git_connections;
  v_request_id uuid;
begin
  if p_kind is null or p_kind not in ('issues', 'merge_request', 'merge', 'comment') then
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
      or (e.value ->> 'kind' = 'merge' and e.value -> 'payload' ->> 'number' is null)
      or (
        e.value ->> 'kind' = 'comment'
        and (
          e.value -> 'payload' ->> 'number' is null
          or e.value -> 'payload' ->> 'reviewId' is null
          or e.value -> 'payload' ->> 'body' is null
        )
      )
  ) then
    raise exception
      'An action has a kind and a payload with a title; an issue names its task, a merge its merge request, a comment its merge request, its review and its text'
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
      and a.kind = 'merge'
      and a.payload ->> 'number' = e.value -> 'payload' ->> 'number'
    join public.git_requests r on r.id = a.request_id
    where e.value ->> 'kind' = 'merge'
      and r.base_url = v_connection.base_url
      and r.repository_id = v_connection.repository_id
      and r.status in ('waiting', 'approved', 'failed')
  ) then
    raise exception 'A request to merge this merge request waits already' using errcode = '23505';
  end if;

  -- A comment posts a review of this project's repository that is written, about the merge
  -- request the review is for.
  if exists (
    select 1
    from jsonb_array_elements(p_actions) e
    where e.value ->> 'kind' = 'comment'
      and not exists (
        select 1
        from public.git_reviews g
        where g.id = (e.value -> 'payload' ->> 'reviewId')::uuid
          and g.project_id = p_project_id
          and g.base_url = v_connection.base_url
          and g.repository_id = v_connection.repository_id
          and g.number::text = e.value -> 'payload' ->> 'number'
          and g.verdict is not null
      )
  ) then
    raise exception 'The review is not there, or not written yet' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_actions) e
    join public.git_actions a
      on a.project_id = p_project_id
      and a.kind = 'comment'
      and a.payload ->> 'reviewId' = e.value -> 'payload' ->> 'reviewId'
    join public.git_requests r on r.id = a.request_id
    where e.value ->> 'kind' = 'comment'
      and r.status in ('waiting', 'approved', 'failed', 'done')
  ) or (
    select count(*) <> count(distinct e.value -> 'payload' ->> 'reviewId')
    from jsonb_array_elements(p_actions) e
    where e.value ->> 'kind' = 'comment'
  ) then
    raise exception 'The review was posted already, or its comment waits' using errcode = '23505';
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
    requested_by, requested_by_name, agent_key
  )
  values (
    p_project_id, p_kind, v_connection.base_url, v_connection.repository_id,
    v_connection.repository_path, v_connection.repository_url, p_requested_by,
    coalesce((select u.name from public.users u where u.id = p_requested_by), ''),
    p_agent_key
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

-- Takes back the comments that still wait for approval for a merge request, except the one of a
-- review: when a newer review arrives, what the older one says is no longer about the commits the
-- merge request has. What runs, failed or is posted stays. How many were taken back.
create function private.withdraw_older_review_comments(
  p_project_id uuid,
  p_number bigint,
  p_review_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_count integer := 0;
begin
  for v_request_id in
    select r.id
    from public.git_requests r
    where r.project_id = p_project_id
      and r.kind = 'comment'
      and r.status = 'waiting'
      and exists (
        select 1
        from public.git_connections c
        where c.project_id = r.project_id
          and c.base_url = r.base_url
          and c.repository_id = r.repository_id
      )
      and exists (
        select 1
        from public.git_actions a
        where a.request_id = r.id
          and a.kind = 'comment'
          and a.payload ->> 'number' = p_number::text
          and a.payload ->> 'reviewId' is distinct from p_review_id::text
      )
    for update
  loop
    perform private.end_git_request(v_request_id, 'withdrawn');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.withdraw_older_review_comments(uuid, bigint, uuid) from public;
