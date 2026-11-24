-- Personal/team workspaces and durable storage cleanup (spec 43).
-- Project membership remains the effective permission boundary. Workspace-managed
-- memberships are tracked so explicit project grants are never silently replaced.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('personal', 'team')),
  personal_owner_id uuid unique references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  check ((kind = 'personal') = (personal_owner_id is not null))
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.project_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  role public.project_role not null check (role in ('viewer','editor')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index workspace_invitations_workspace_idx on public.workspace_invitations(workspace_id);
create table public.file_cleanup (
  storage_key text primary key check (storage_key ~ '^[0-9a-f-]{36}$'),
  created_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_error_at timestamptz
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.file_cleanup enable row level security;
revoke all on public.workspaces, public.workspace_members, public.workspace_invitations,
  public.file_cleanup from public, covibes_app;
grant select on public.workspaces, public.workspace_members to covibes_app;
grant select (id, workspace_id, email, role, created_by, created_at, expires_at,
  accepted_by, accepted_at, revoked_at) on public.workspace_invitations to covibes_app;

create function private.has_workspace_role(p_workspace uuid, p_min public.project_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members
    where workspace_id=p_workspace and user_id=private.current_user_id() and role>=p_min);
$$;
revoke all on function private.has_workspace_role(uuid, public.project_role) from public;
grant execute on function private.has_workspace_role(uuid, public.project_role) to covibes_app;
create policy "workspaces: members read" on public.workspaces for select to covibes_app
  using (private.has_workspace_role(id,'viewer'));
create policy "workspace_members: members read" on public.workspace_members for select to covibes_app
  using (private.has_workspace_role(workspace_id,'viewer'));
create policy "workspace_invitations: owners read" on public.workspace_invitations for select to covibes_app
  using (private.has_workspace_role(workspace_id,'owner'));

create function private.ensure_personal_workspace(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.workspaces(name,kind,personal_owner_id,created_by)
    values ('Personal','personal',p_user,p_user)
    on conflict(personal_owner_id) do nothing;
  select id into v_id from public.workspaces where personal_owner_id=p_user;
  insert into public.workspace_members(workspace_id,user_id,role) values(v_id,p_user,'owner')
    on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function private.ensure_personal_workspace(uuid) from public;
create function private.user_personal_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.ensure_personal_workspace(new.id); return new; end;
$$;
revoke all on function private.user_personal_workspace() from public;
create trigger users_personal_workspace after insert on public.users
  for each row execute function private.user_personal_workspace();
select private.ensure_personal_workspace(id) from public.users;

-- Existing request identities have a personal workspace. Admin inserts have no
-- request identity; the BEFORE INSERT trigger then derives it from owner_id.
create function private.default_personal_workspace()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.workspaces where personal_owner_id=private.current_user_id();
$$;
revoke all on function private.default_personal_workspace() from public;

alter table public.projects add column workspace_id uuid references public.workspaces(id) on delete restrict;
update public.projects p set workspace_id=w.id from public.workspaces w where w.personal_owner_id=p.owner_id;
alter table public.projects alter column workspace_id set not null;
alter table public.projects alter column workspace_id set default private.default_personal_workspace();
create index projects_workspace_idx on public.projects(workspace_id);
create function private.project_personal_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.workspace_id is null then new.workspace_id := private.ensure_personal_workspace(new.owner_id); end if;
  return new;
end;
$$;
revoke all on function private.project_personal_workspace() from public;
create trigger projects_personal_workspace before insert on public.projects
  for each row execute function private.project_personal_workspace();

create table public.workspace_project_grants (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  user_id uuid not null,
  role public.project_role not null,
  primary key (project_id,user_id),
  foreign key (project_id,user_id) references public.project_members(project_id,user_id) on delete cascade
);
alter table public.workspace_project_grants enable row level security;
revoke all on public.workspace_project_grants from public, covibes_app;

-- The caller holds the workspace row lock. Existing explicit project memberships
-- are deliberately preserved, including a more restrictive project role.
create function private.grant_workspace_project(p_workspace uuid, p_project uuid, p_user uuid, p_role public.project_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_members(project_id,user_id,role) values(p_project,p_user,p_role)
    on conflict do nothing;
  if found then
    insert into public.workspace_project_grants(workspace_id,project_id,user_id,role)
      values(p_workspace,p_project,p_user,p_role);
  end if;
end;
$$;
revoke all on function private.grant_workspace_project(uuid,uuid,uuid,public.project_role) from public;

create function private.workspace_project_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_member record;
begin
  perform 1 from public.workspaces where id=new.workspace_id for update;
  for v_member in select user_id,role from public.workspace_members
      where workspace_id=new.workspace_id and user_id<>new.owner_id order by user_id loop
    perform private.grant_workspace_project(new.workspace_id,new.id,v_member.user_id,v_member.role);
  end loop;
  return new;
end;
$$;
revoke all on function private.workspace_project_created() from public;
create trigger projects_workspace_grants after insert on public.projects
  for each row execute function private.workspace_project_created();

create function private.detach_explicit_project_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.workspace_project_grants
    where project_id=new.project_id and user_id=new.user_id and role<>new.role;
  return new;
end;
$$;
revoke all on function private.detach_explicit_project_role() from public;
create trigger project_members_explicit_role after update of role on public.project_members
  for each row execute function private.detach_explicit_project_role();

create function private.workspace_members_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_project record;
begin
  if tg_op='INSERT' then
    for v_project in select id from public.projects where workspace_id=new.workspace_id order by id loop
      perform private.grant_workspace_project(new.workspace_id,v_project.id,new.user_id,new.role);
    end loop;
  elsif tg_op='UPDATE' then
    perform 1 from public.projects where workspace_id=new.workspace_id order by id for update;
    -- Update the source first so the explicit-role trigger recognizes managed updates.
    update public.workspace_project_grants set role=new.role
      where workspace_id=new.workspace_id and user_id=new.user_id;
    update public.project_members m set role=new.role,
      can_approve_git=case when new.role='viewer' then false else m.can_approve_git end
      from public.workspace_project_grants g
      where g.workspace_id=new.workspace_id and g.user_id=new.user_id
        and m.project_id=g.project_id and m.user_id=g.user_id;
  elsif tg_op='DELETE' then
    perform 1 from public.projects where workspace_id=old.workspace_id order by id for update;
    delete from public.project_members m using public.workspace_project_grants g
      where g.workspace_id=old.workspace_id and g.user_id=old.user_id
        and m.project_id=g.project_id and m.user_id=g.user_id;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.workspace_members_changed() from public;
create trigger workspace_members_changed after insert or update of role or delete on public.workspace_members
  for each row execute function private.workspace_members_changed();

create function private.workspace_keeps_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace public.workspaces;
begin
  select * into v_workspace from public.workspaces where id=old.workspace_id for update;
  if not found then return coalesce(new,old); end if;
  if old.role='owner' and (tg_op='DELETE' or new.role<>'owner') and not exists(
      select 1 from public.workspace_members where workspace_id=old.workspace_id
      and user_id<>old.user_id and role='owner') then
    -- The user's cascading personal workspace deletion is allowed; a live team
    -- always needs an owner, including when user deletion is attempted directly.
    if v_workspace.kind='personal' and not exists(select 1 from public.users where id=old.user_id) then
      return coalesce(new,old);
    end if;
    raise exception 'A workspace needs at least one owner.' using errcode='P0001', hint='last_workspace_owner';
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.workspace_keeps_owner() from public;
create trigger workspace_members_keep_owner before update or delete on public.workspace_members
  for each row execute function private.workspace_keeps_owner();

create function public.create_workspace(p_name text)
returns public.workspaces language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=private.current_user_id(); v_workspace public.workspaces;
begin
  if v_user is null then raise exception 'Not authenticated.' using errcode='42501'; end if;
  insert into public.workspaces(name,kind,created_by) values(btrim(p_name),'team',v_user) returning * into v_workspace;
  insert into public.workspace_members(workspace_id,user_id,role) values(v_workspace.id,v_user,'owner');
  return v_workspace;
end;
$$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to covibes_app;

create function public.update_workspace(p_workspace uuid,p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not private.has_workspace_role(p_workspace,'owner') then raise exception 'Not allowed.' using errcode='42501'; end if;
  update public.workspaces set name=btrim(p_name) where id=p_workspace;
end;
$$;
revoke all on function public.update_workspace(uuid,text) from public;
grant execute on function public.update_workspace(uuid,text) to covibes_app;

create function public.set_workspace_member(p_workspace uuid,p_user uuid,p_role public.project_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  select kind into v_kind from public.workspaces where id=p_workspace for update;
  if not private.has_workspace_role(p_workspace,'owner') and not(p_role is null and p_user=private.current_user_id())
    then raise exception 'Not allowed.' using errcode='42501'; end if;
  if v_kind='personal' then raise exception 'A personal workspace cannot be shared.' using errcode='P0001',hint='personal_workspace'; end if;
  if p_role is null then
    delete from public.workspace_members where workspace_id=p_workspace and user_id=p_user;
  else
    update public.workspace_members set role=p_role where workspace_id=p_workspace and user_id=p_user;
    if not found then raise exception 'Member not found.' using errcode='P0001',hint='not_found'; end if;
  end if;
end;
$$;
revoke all on function public.set_workspace_member(uuid,uuid,public.project_role) from public;
grant execute on function public.set_workspace_member(uuid,uuid,public.project_role) to covibes_app;

create function public.delete_workspace(p_workspace uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  select kind into v_kind from public.workspaces where id=p_workspace for update;
  if not private.has_workspace_role(p_workspace,'owner') then raise exception 'Not allowed.' using errcode='42501'; end if;
  if v_kind='personal' then raise exception 'Personal workspace.' using errcode='P0001',hint='personal_workspace'; end if;
  if exists(select 1 from public.projects where workspace_id=p_workspace) then
    raise exception 'Move or delete its projects first.' using errcode='P0001',hint='workspace_not_empty'; end if;
  delete from public.workspaces where id=p_workspace;
end;
$$;
revoke all on function public.delete_workspace(uuid) from public;
grant execute on function public.delete_workspace(uuid) to covibes_app;

create function public.create_workspace_project(p_workspace uuid,p_name text,p_language text default 'de')
returns public.projects language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=private.current_user_id(); v_project public.projects;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not private.has_workspace_role(p_workspace,'editor') then raise exception 'Not allowed.' using errcode='42501'; end if;
  insert into public.projects(name,owner_id,language,workspace_id)
    values(btrim(p_name),v_user,p_language,p_workspace) returning * into v_project;
  insert into public.project_members(project_id,user_id,role) values(v_project.id,v_user,'owner');
  insert into public.boards(project_id,title,kind,position) values(v_project.id,
    case p_language when 'en' then 'Main canvas' else 'Haupt-Canvas' end,'main',0);
  return v_project;
end;
$$;
revoke all on function public.create_workspace_project(uuid,text,text) from public;
grant execute on function public.create_workspace_project(uuid,text,text) to covibes_app;

create function public.move_workspace_project(p_project uuid,p_workspace uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_user uuid:=private.current_user_id(); v_member record;
begin
  select workspace_id into v_old from public.projects where id=p_project;
  if not found or not private.has_role(p_project,'owner') then raise exception 'Not allowed.' using errcode='42501'; end if;
  perform 1 from public.workspaces where id in(v_old,p_workspace) order by id for update;
  perform 1 from public.projects where id=p_project and workspace_id=v_old for update;
  if not found then raise exception 'Project moved concurrently.' using errcode='P0001',hint='project_moved'; end if;
  if not private.has_workspace_role(p_workspace,'editor') then raise exception 'Not allowed.' using errcode='42501'; end if;
  if v_old=p_workspace then return; end if;
  -- The acting owner becomes an explicit project owner before old managed grants leave.
  delete from public.workspace_project_grants where project_id=p_project and user_id=v_user;
  delete from public.project_members m using public.workspace_project_grants g
    where g.project_id=p_project and m.project_id=g.project_id and m.user_id=g.user_id;
  update public.projects set workspace_id=p_workspace where id=p_project;
  for v_member in select user_id,role from public.workspace_members where workspace_id=p_workspace order by user_id loop
    perform private.grant_workspace_project(p_workspace,p_project,v_member.user_id,v_member.role);
  end loop;
end;
$$;
revoke all on function public.move_workspace_project(uuid,uuid) from public;
grant execute on function public.move_workspace_project(uuid,uuid) to covibes_app;

create function public.invite_workspace_member(p_workspace uuid,p_hash text,p_email text,p_role public.project_role)
returns public.workspace_invitations language plpgsql security definer set search_path = '' as $$
declare v_invite public.workspace_invitations;
begin
  perform 1 from public.workspaces where id=p_workspace and kind='team' for update;
  if not found or not private.has_workspace_role(p_workspace,'owner') then raise exception 'Not allowed.' using errcode='42501'; end if;
  if (select count(*) from public.workspace_invitations where workspace_id=p_workspace
      and accepted_at is null and revoked_at is null and expires_at>now())>=100 then
    raise exception 'Too many pending invitations.' using errcode='P0001',hint='invitation_limit'; end if;
  insert into public.workspace_invitations(workspace_id,email,role,token_hash,created_by)
    values(p_workspace,case when p_email is null then null else lower(btrim(p_email)) end,p_role,p_hash,private.current_user_id())
    returning * into v_invite;
  return v_invite;
end;
$$;
revoke all on function public.invite_workspace_member(uuid,text,text,public.project_role) from public;
grant execute on function public.invite_workspace_member(uuid,text,text,public.project_role) to covibes_app;

create function public.accept_workspace_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user public.users; v_invite public.workspace_invitations;
begin
  select * into v_user from public.users where id=private.current_user_id();
  if not found then raise exception 'Not authenticated.' using errcode='42501'; end if;
  select * into v_invite from public.workspace_invitations
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found then raise exception 'Invitation unavailable.' using errcode='P0001',hint='invalid_invitation'; end if;
  -- Every invitation mutation locks the workspace first, then the invitation.
  perform 1 from public.workspaces where id=v_invite.workspace_id for update;
  select * into v_invite from public.workspace_invitations where id=v_invite.id for update;
  if not found or v_invite.expires_at<=now() or v_invite.accepted_at is not null or v_invite.revoked_at is not null
    then raise exception 'Invitation unavailable.' using errcode='P0001',hint='invalid_invitation'; end if;
  if v_invite.email is not null and (not v_user.email_verified or lower(v_user.email)<>v_invite.email)
    then raise exception 'Use the invited verified address.' using errcode='42501'; end if;
  insert into public.workspace_members(workspace_id,user_id,role) values(v_invite.workspace_id,v_user.id,v_invite.role)
    on conflict do nothing;
  update public.workspace_invitations set accepted_by=v_user.id,accepted_at=now() where id=v_invite.id;
  return v_invite.workspace_id;
end;
$$;
revoke all on function public.accept_workspace_invitation(text) from public;
grant execute on function public.accept_workspace_invitation(text) to covibes_app;

create function public.revoke_workspace_invitation(p_workspace uuid,p_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not private.has_workspace_role(p_workspace,'owner') then raise exception 'Not allowed.' using errcode='42501'; end if;
  update public.workspace_invitations set revoked_at=coalesce(revoked_at,now())
    where workspace_id=p_workspace and id=p_invitation and accepted_at is null;
end;
$$;
revoke all on function public.revoke_workspace_invitation(uuid,uuid) from public;
grant execute on function public.revoke_workspace_invitation(uuid,uuid) to covibes_app;

create function private.enqueue_deleted_file()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.file_cleanup(storage_key) values(old.storage_key) on conflict do nothing;
  perform graphile_worker.add_job('file_cleanup', json_build_object('key',old.storage_key)::json,
    job_key:='file_cleanup:'||old.storage_key);
  return old;
end;
$$;
revoke all on function private.enqueue_deleted_file() from public;
create trigger files_cleanup after delete on public.files for each row execute function private.enqueue_deleted_file();

-- Workspace members can see one another's public display fields, never email or auth data.
create function private.shares_workspace_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members mine join public.workspace_members theirs
    on theirs.workspace_id=mine.workspace_id where mine.user_id=private.current_user_id() and theirs.user_id=p_user);
$$;
revoke all on function private.shares_workspace_with(uuid) from public;
grant execute on function private.shares_workspace_with(uuid) to covibes_app;
drop policy "users: read self and people of own projects" on public.users;
create policy "users: read self and workspace/project people" on public.users for select to covibes_app
  using(id=private.current_user_id() or private.knows_user(id) or private.shares_workspace_with(id));

-- Knowledge files also live outside PostgreSQL and must survive metadata cascades
-- in the cleanup ledger. Link-only knowledge records have no storage key.
create function private.enqueue_deleted_knowledge_file()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.storage_key is not null then
    insert into public.file_cleanup(storage_key) values(old.storage_key) on conflict do nothing;
    perform graphile_worker.add_job('file_cleanup',json_build_object('key',old.storage_key)::json,
      job_key:='file_cleanup:'||old.storage_key);
  end if;
  return old;
end;
$$;
revoke all on function private.enqueue_deleted_knowledge_file() from public;
create trigger knowledge_files_cleanup after delete on public.agent_knowledge
  for each row execute function private.enqueue_deleted_knowledge_file();

-- Execute cleanup/ownership checks inside the auth adapter's actual user DELETE.
-- A later failure rolls the entire statement back, rather than erasing private
-- projects in a before-delete callback which runs in another transaction.
create function private.prepare_deleted_account()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace record; v_project record; v_successor uuid;
begin
  for v_workspace in select w.id,w.kind from public.workspaces w
      join public.workspace_members m on m.workspace_id=w.id
      where m.user_id=old.id order by w.id for update of w loop
    if v_workspace.kind='team' and exists(select 1 from public.workspace_members where workspace_id=v_workspace.id and user_id=old.id and role='owner')
      and not exists(select 1 from public.workspace_members where workspace_id=v_workspace.id and user_id<>old.id and role='owner')
      and (exists(select 1 from public.workspace_members where workspace_id=v_workspace.id and user_id<>old.id)
        or exists(select 1 from public.projects p join public.project_members m on m.project_id=p.id
          where p.workspace_id=v_workspace.id and m.user_id<>old.id))
      then raise exception 'Transfer shared workspace ownership first.' using errcode='P0001',hint='last_workspace_owner'; end if;
  end loop;
  for v_project in select p.id from public.projects p where p.owner_id=old.id order by p.id for update loop
    select user_id into v_successor from public.project_members where project_id=v_project.id
      and user_id<>old.id and role='owner' order by created_at,user_id limit 1;
    if v_successor is not null then
      update public.projects set owner_id=v_successor where id=v_project.id;
    elsif exists(select 1 from public.project_members where project_id=v_project.id and user_id<>old.id) then
      raise exception 'Transfer shared project ownership first.' using errcode='P0001',hint='last_project_owner';
    else
      delete from public.projects where id=v_project.id;
    end if;
  end loop;
  -- Shared projects owned by a surviving person leave the deleted personal
  -- workspace. Their explicit project permissions survive this relocation.
  for v_project in select p.id,p.owner_id from public.projects p join public.workspaces w on w.id=p.workspace_id
      where w.personal_owner_id=old.id order by p.id for update of p loop
    update public.projects set workspace_id=private.ensure_personal_workspace(v_project.owner_id)
      where id=v_project.id;
  end loop;
  delete from public.files where uploaded_by=old.id;
  -- A team with nobody else and no project can disappear with its last owner.
  delete from public.workspaces w where w.kind='team'
    and exists(select 1 from public.workspace_members where workspace_id=w.id and user_id=old.id and role='owner')
    and not exists(select 1 from public.workspace_members where workspace_id=w.id and user_id<>old.id)
    and not exists(select 1 from public.projects where workspace_id=w.id);
  return old;
end;
$$;
revoke all on function private.prepare_deleted_account() from public;
create trigger users_prepare_deletion before delete on public.users
  for each row execute function private.prepare_deleted_account();

-- Revocation also covers database-driven workspace grants and account cascades,
-- and reaches every listening server after the transaction commits.
create function private.project_access_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' or old.role<>new.role then
    perform pg_notify('covibes_live',json_build_object('kind','access','projectId',old.project_id,
      'userId',old.user_id,'scope',case when tg_op='DELETE' then 'all' else 'boards' end)::text);
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.project_access_changed() from public;
create trigger project_members_access after delete or update of role on public.project_members
  for each row execute function private.project_access_changed();

create function private.deleted_board_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin delete from public.yjs_documents where name='board:'||old.id; return old; end;
$$;
revoke all on function private.deleted_board_document() from public;
create trigger boards_delete_document after delete on public.boards
  for each row execute function private.deleted_board_document();

-- A parent lock makes the existence check atomic with deletion. Store paths use
-- INSERT ON CONFLICT, so this guard runs before acquiring a document row lock.
create function private.live_document_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name like 'board:%' then
    if substring(new.name from 7) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
    perform 1 from public.boards where id=substring(new.name from 7)::uuid for key share;
    if not found then return null; end if;
  elsif new.name like 'plan:%' then
    if substring(new.name from 6) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
    perform 1 from public.projects where id=substring(new.name from 6)::uuid for key share;
    if not found then return null; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.live_document_parent() from public;
create trigger yjs_documents_live_parent before insert on public.yjs_documents
  for each row execute function private.live_document_parent();
