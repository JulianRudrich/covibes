-- Assigning tasks (spec 26b).
--
-- A task is a list item of the plan; the plan's document holds its id and its text. This table
-- holds who took it. Owners and editors assign through assign_task; every member can be assigned
-- and reads the assignments. RLS, policies and grants for covibes_app in this same migration.

create table public.tasks (
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The id the task carries in the plan's document.
  id uuid not null,
  -- How the task read when it was last assigned; the plan holds what it says now.
  title text not null default '' check (char_length(title) <= 300),
  -- Null: nobody has the task (any more).
  assignee_id uuid references public.users (id) on delete set null,
  assigned_by uuid references public.users (id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index tasks_assignee_id_idx on public.tasks (assignee_id) where assignee_id is not null;

alter table public.tasks enable row level security;

revoke all on public.tasks from public;
grant select on public.tasks to covibes_app;

create policy "tasks: members read"
  on public.tasks for select to covibes_app
  using (private.is_member(project_id));

-- The read-only link (spec 21b) shows that a task is taken; the server never tells it by whom.
create policy "tasks: share link reads"
  on public.tasks for select to covibes_app
  using (project_id = (select private.shared_project_id()));

-- The person a task goes to learns of it (spec 22a).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('mention', 'role_changed', 'removed', 'joined', 'task_assigned'));

-- Gives a task to a member of the project, or to nobody (p_assignee_id null). Whoever gets a task
-- from someone else is notified; taking a task oneself, or assigning it to who has it already,
-- tells nobody. Returns whether the assignee changed.
create function public.assign_task(
  p_project_id uuid,
  p_task_id uuid,
  p_assignee_id uuid,
  p_title text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_user_id();
  v_before uuid;
  v_title text := left(btrim(coalesce(p_title, '')), 300);
begin
  if not private.has_role(p_project_id, 'editor') then
    raise exception 'Only owners and editors assign tasks' using errcode = '42501';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = p_assignee_id
  ) then
    raise exception 'A task goes to a member of the project' using errcode = '22023';
  end if;

  -- One at a time per task: two people assigning at once end with one assignee and one answer.
  perform 1 from public.projects where id = p_project_id for update;
  select t.assignee_id into v_before
  from public.tasks t
  where t.project_id = p_project_id and t.id = p_task_id;
  if v_before is not distinct from p_assignee_id then
    return false;
  end if;

  insert into public.tasks (project_id, id, title, assignee_id, assigned_by, assigned_at)
  values (p_project_id, p_task_id, v_title, p_assignee_id, v_actor, now())
  on conflict (project_id, id) do update
    set title = excluded.title,
        assignee_id = excluded.assignee_id,
        assigned_by = excluded.assigned_by,
        assigned_at = excluded.assigned_at;

  if p_assignee_id is not null and p_assignee_id is distinct from v_actor then
    insert into public.notifications
      (user_id, kind, project_id, project_name, actor_id, actor_name, excerpt)
    select
      p_assignee_id, 'task_assigned', p.id, p.name, v_actor,
      coalesce((select u.name from public.users u where u.id = v_actor), ''),
      left(v_title, 200)
    from public.projects p
    where p.id = p_project_id;
  end if;
  return true;
end;
$$;

revoke all on function public.assign_task(uuid, uuid, uuid, text) from public;
grant execute on function public.assign_task(uuid, uuid, uuid, text) to covibes_app;

-- Someone who leaves a project, or is removed from it, no longer has its tasks.
create function private.release_tasks_of_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks t
  set assignee_id = null, assigned_by = null, assigned_at = null
  where t.project_id = old.project_id and t.assignee_id = old.user_id;
  return null;
end;
$$;

revoke all on function private.release_tasks_of_member() from public;

create trigger project_members_release_tasks
  after delete on public.project_members
  for each row execute function private.release_tasks_of_member();

-- An assigned task is mailed like a mention (spec 22b): the mail job of migration 0019 is scheduled
-- for it too. That someone joined stays in the app, as before.
drop trigger notifications_schedule_mail on public.notifications;

create trigger notifications_schedule_mail
  after insert on public.notifications
  for each row
  when (new.kind in ('mention', 'role_changed', 'removed', 'task_assigned'))
  execute function private.schedule_mail_for_notification();
