-- Reviews of merge requests against the architecture (spec 30b).
--
-- A review is a run of the model that reads a merge request and what the team decided, and says
-- whether the change fits. It changes nothing in the repository, so it needs no approval. The job
-- that reads the repository's state starts one for every merge request of an issue Covibes
-- created, once per state of its commits; owners and editors start one with a click. RLS,
-- policies and grants for covibes_app in this same migration.

-- A review is a run of its own kind, metered like every other.
alter table public.ai_runs drop constraint ai_runs_kind_check;
alter table public.ai_runs
  add constraint ai_runs_kind_check
  check (kind in ('reply', 'observe', 'summary', 'plan', 'package', 'review'));

create table public.git_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The repository the merge request is in.
  base_url text not null check (char_length(base_url) between 8 and 300),
  repository_id bigint not null,
  -- Its number there, as people write it: "!7".
  number bigint not null check (number > 0),
  -- The last commit of the merge request when the review was asked for: the state it is about.
  sha text not null check (sha ~ '^[0-9a-f]{7,64}$'),
  -- The merge request as it was then, for the list and the review itself.
  title text not null check (char_length(title) between 1 and 500),
  url text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  source_branch text not null check (char_length(source_branch) <= 300),
  author text not null check (char_length(author) <= 200),
  -- The issue Covibes created that it belongs to; null for a merge request of its own.
  issue_number bigint check (issue_number > 0),
  -- What started it: the reading of the repository's state, or a person's click.
  trigger text not null check (trigger in ('auto', 'manual')),
  requested_by uuid references public.users (id) on delete set null,
  -- The run that writes it; its status says whether the review still runs or failed.
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  -- Null until the review is written.
  verdict text check (verdict in ('fits', 'deviates')),
  summary text check (char_length(summary) between 1 and 2000),
  -- The findings as the server checked them: a list of objects.
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  -- The merge request is still open, as far as the repository's state was read.
  mr_open boolean not null default true,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- One review per merge request and state of its commits.
  unique (project_id, base_url, repository_id, number, sha)
);

create index git_reviews_project_created_idx on public.git_reviews (project_id, created_at desc);

alter table public.git_reviews enable row level security;

revoke all on public.git_reviews from public;
grant select on public.git_reviews to covibes_app;

create policy "git_reviews: members read"
  on public.git_reviews for select to covibes_app
  using (private.is_member(project_id));

-- Starts the review of a merge request at a state of its commits, for the repository the project
-- has now. Returns the review, or null if there is nothing to start: the project has no
-- repository, this state has a review already, or the day's reviews are used up. A review whose
-- run failed, or was lost for ten minutes, is started again only for a person (`manual`). What
-- the merge request is (title, address, branch, author) is the caller's to read from GitLab.
create function private.start_git_review(
  p_project_id uuid,
  p_number bigint,
  p_sha text,
  p_title text,
  p_url text,
  p_source_branch text,
  p_author text,
  p_issue_number bigint,
  p_trigger text,
  p_requested_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_repository_id bigint;
  v_review_id uuid;
  v_run_status text;
  v_run_created timestamptz;
  v_run_id uuid;
  v_today integer;
  v_today_auto integer;
begin
  if p_trigger not in ('auto', 'manual') then
    raise exception 'A review is started by the sync or by a person' using errcode = '22023';
  end if;
  -- One at a time per project, also when the sync and a click meet.
  perform 1 from public.projects where id = p_project_id for update;
  select c.base_url, c.repository_id into v_base_url, v_repository_id
  from public.git_connections c
  where c.project_id = p_project_id and c.repository_id is not null;
  if v_repository_id is null then
    return null;
  end if;

  select g.id, r.status, r.created_at into v_review_id, v_run_status, v_run_created
  from public.git_reviews g
  join public.ai_runs r on r.id = g.run_id
  where g.project_id = p_project_id
    and g.base_url = v_base_url
    and g.repository_id = v_repository_id
    and g.number = p_number
    and g.sha = p_sha;
  if v_review_id is not null then
    -- This state was reviewed, or is being reviewed.
    if v_run_status = 'done'
      or (v_run_status in ('queued', 'running') and v_run_created > now() - interval '10 minutes')
    then
      return null;
    end if;
    -- It failed or was lost: the sync does not try again by itself, or a merge request that
    -- cannot be reviewed would be tried with every reading.
    if p_trigger = 'auto' then
      return null;
    end if;
  end if;

  select count(*), count(*) filter (where g.trigger = 'auto') into v_today, v_today_auto
  from public.git_reviews g
  where g.project_id = p_project_id and g.created_at > now() - interval '24 hours';
  if v_today >= 60 or (p_trigger = 'auto' and v_today_auto >= 20) then
    if p_trigger = 'auto' then
      return null;
    end if;
    raise exception 'The reviews of this day are used up' using errcode = '53400';
  end if;

  insert into public.ai_runs (project_id, agent_key, kind, status)
  values (p_project_id, 'moderator', 'review', 'queued')
  returning id into v_run_id;

  insert into public.git_reviews (
    project_id, base_url, repository_id, number, sha, title, url, source_branch, author,
    issue_number, trigger, requested_by, run_id
  )
  values (
    p_project_id, v_base_url, v_repository_id, p_number, p_sha,
    left(p_title, 500), p_url, left(p_source_branch, 300), left(p_author, 200),
    p_issue_number, p_trigger, p_requested_by, v_run_id
  )
  on conflict (project_id, base_url, repository_id, number, sha) do update
    set run_id = excluded.run_id,
        title = excluded.title,
        url = excluded.url,
        source_branch = excluded.source_branch,
        author = excluded.author,
        issue_number = excluded.issue_number,
        trigger = excluded.trigger,
        requested_by = excluded.requested_by,
        verdict = null,
        summary = null,
        findings = '[]'::jsonb,
        mr_open = true,
        created_at = now(),
        finished_at = null
  returning id into v_review_id;

  perform graphile_worker.add_job(
    'mr_review',
    json_build_object('reviewId', v_review_id, 'runId', v_run_id),
    queue_name => 'review:' || p_project_id::text,
    max_attempts => 1
  );
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'git', 'projectId', p_project_id)::text
  );
  return v_review_id;
end;
$$;

revoke all on function private.start_git_review(
  uuid, bigint, text, text, text, text, text, bigint, text, uuid
) from public;

-- An owner or editor asks for the review of a merge request at a state of its commits. The
-- server read the merge request from GitLab before. Raises if that state was reviewed already or
-- is being reviewed, and if the day's reviews are used up.
create function public.request_git_review(
  p_project_id uuid,
  p_number bigint,
  p_sha text,
  p_title text,
  p_url text,
  p_source_branch text,
  p_author text,
  p_issue_number bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review_id uuid;
begin
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors ask for a review' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.git_connections c
    where c.project_id = p_project_id and c.repository_id is not null
  ) then
    raise exception 'The project has no repository' using errcode = 'P0002';
  end if;
  v_review_id := private.start_git_review(
    p_project_id, p_number, p_sha, p_title, p_url, p_source_branch, p_author, p_issue_number,
    'manual', private.current_user_id()
  );
  if v_review_id is null then
    raise exception 'This state of the merge request was reviewed already' using errcode = '55000';
  end if;
  return v_review_id;
end;
$$;

revoke all on function public.request_git_review(
  uuid, bigint, text, text, text, text, text, bigint
) from public;
grant execute on function public.request_git_review(
  uuid, bigint, text, text, text, text, text, bigint
) to covibes_app;
