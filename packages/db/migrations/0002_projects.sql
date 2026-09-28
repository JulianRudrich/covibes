-- Projects, members and boards with row level security (spec 04).
--
-- Every table gets explicit grants for covibes_app; RLS policies then decide which rows the current
-- user (private.current_user_id()) may see or change. Helper functions in `private` are security
-- definer so they can read project_members without triggering its own policies (no recursion).

-- Ordered by privilege, so `role >= 'editor'` means "editor or owner".
create type public.project_role as enum ('viewer', 'editor', 'owner');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  owner_id uuid not null references public.users (id) on delete restrict,
  language text not null default 'de' check (language in ('de', 'en')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_id_idx on public.projects (owner_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.project_role not null,
  can_approve_git boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_id_idx on public.project_members (user_id);

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  kind text not null check (kind in ('main', 'extra')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index boards_project_id_idx on public.boards (project_id);
create unique index boards_one_main_per_project on public.boards (project_id) where kind = 'main';

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.boards enable row level security;

-- Helper functions ------------------------------------------------------------------------------

create function private.is_member(p_project_id uuid)
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
  );
$$;

create function private.has_role(p_project_id uuid, p_min_role public.project_role)
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
      and m.role >= p_min_role
  );
$$;

-- True if the current user and p_user_id are members of at least one common project.
create function private.shares_project_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = private.current_user_id()
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_role(uuid, public.project_role) from public;
revoke all on function private.shares_project_with(uuid) from public;
grant execute on function private.is_member(uuid) to covibes_app;
grant execute on function private.has_role(uuid, public.project_role) to covibes_app;
grant execute on function private.shares_project_with(uuid) to covibes_app;

-- Triggers --------------------------------------------------------------------------------------

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function private.touch_updated_at();

-- A project always keeps at least one owner. When the whole project is deleted, the cascade
-- removes its members after the project row is gone, so the check lets that through.
create function private.ensure_project_keeps_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner'
    and (tg_op = 'DELETE' or new.role <> 'owner')
    and exists (select 1 from public.projects p where p.id = old.project_id)
    and not exists (
      select 1
      from public.project_members m
      where m.project_id = old.project_id
        and m.role = 'owner'
        and m.user_id <> old.user_id
    )
  then
    raise exception 'A project needs at least one owner.' using errcode = 'P0001', hint = 'last_owner';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.ensure_project_keeps_owner() from public;

create trigger project_members_keep_owner
  before update or delete on public.project_members
  for each row execute function private.ensure_project_keeps_owner();

-- Creating a project ----------------------------------------------------------------------------

-- The only way to create a project: it adds the caller as owner and creates the main board,
-- all in one transaction.
create function public.create_project(p_name text)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.current_user_id();
  v_project public.projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  insert into public.projects (name, owner_id)
  values (btrim(p_name), v_user_id)
  returning * into v_project;

  insert into public.project_members (project_id, user_id, role)
  values (v_project.id, v_user_id, 'owner');

  insert into public.boards (project_id, title, kind, position)
  values (v_project.id, 'Haupt-Canvas', 'main', 0);

  return v_project;
end;
$$;

revoke all on function public.create_project(text) from public;
grant execute on function public.create_project(text) to covibes_app;

-- Grants ----------------------------------------------------------------------------------------
-- Column lists keep ids, owners and timestamps out of client updates.

revoke all on public.projects, public.project_members, public.boards from public;

grant select, delete on public.projects to covibes_app;
grant update (name, language, settings) on public.projects to covibes_app;

grant select, insert, delete on public.project_members to covibes_app;
grant update (role, can_approve_git) on public.project_members to covibes_app;

grant select, insert, delete on public.boards to covibes_app;
grant update (title, position) on public.boards to covibes_app;

-- Policies --------------------------------------------------------------------------------------

create policy "users: read self and fellow members"
  on public.users for select to covibes_app
  using (id = private.current_user_id() or private.shares_project_with(id));

create policy "projects: members read"
  on public.projects for select to covibes_app
  using (private.is_member(id));

create policy "projects: owner updates"
  on public.projects for update to covibes_app
  using (private.has_role(id, 'owner'))
  with check (private.has_role(id, 'owner'));

create policy "projects: owner deletes"
  on public.projects for delete to covibes_app
  using (private.has_role(id, 'owner'));

create policy "project_members: members read"
  on public.project_members for select to covibes_app
  using (private.is_member(project_id));

create policy "project_members: owner adds"
  on public.project_members for insert to covibes_app
  with check (private.has_role(project_id, 'owner'));

create policy "project_members: owner changes"
  on public.project_members for update to covibes_app
  using (private.has_role(project_id, 'owner'))
  with check (private.has_role(project_id, 'owner'));

create policy "project_members: owner removes"
  on public.project_members for delete to covibes_app
  using (private.has_role(project_id, 'owner'));

create policy "boards: members read"
  on public.boards for select to covibes_app
  using (private.is_member(project_id));

-- The main board is created by create_project and can neither be added twice nor deleted.
create policy "boards: editors add"
  on public.boards for insert to covibes_app
  with check (kind = 'extra' and private.has_role(project_id, 'editor'));

create policy "boards: editors change"
  on public.boards for update to covibes_app
  using (private.has_role(project_id, 'editor'))
  with check (private.has_role(project_id, 'editor'));

create policy "boards: editors delete"
  on public.boards for delete to covibes_app
  using (kind = 'extra' and private.has_role(project_id, 'editor'));
