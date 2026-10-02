-- Invitations, members and what stays of them (spec 21a).
--
-- Owners invite people by link or by email with a role. Only the hash of an invitation's token is
-- stored, and the database checks it: the preview and accepting are functions. Members can leave,
-- former members keep their name, and every change of the members is announced live. RLS, policies
-- and grants for covibes_app in this same migration.

-- People of a project ------------------------------------------------------------------------------

-- Everyone who is or ever was a member of a project. Messages, decisions and files refer to their
-- authors; this keeps the name of someone who left readable for the members. Nobody reads the
-- table directly.
create table public.project_people (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  primary key (project_id, user_id)
);

create index project_people_user_id_idx on public.project_people (user_id);

alter table public.project_people enable row level security;
revoke all on public.project_people from public;

insert into public.project_people (project_id, user_id)
select project_id, user_id from public.project_members;

create function private.remember_project_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_people (project_id, user_id)
  values (new.project_id, new.user_id)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function private.remember_project_person() from public;

create trigger project_members_remember_person
  after insert on public.project_members
  for each row execute function private.remember_project_person();

-- True if p_user_id is or was a member of a project the current user is a member of.
create function private.knows_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_people theirs on theirs.project_id = mine.project_id
    where mine.user_id = private.current_user_id()
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function private.knows_user(uuid) from public;
grant execute on function private.knows_user(uuid) to covibes_app;

drop policy "users: read self and fellow members" on public.users;
create policy "users: read self and people of own projects"
  on public.users for select to covibes_app
  using (id = private.current_user_id() or private.knows_user(id));

-- Members ----------------------------------------------------------------------------------------------

-- Only owners and editors approve Git actions.
update public.project_members set can_approve_git = false where role = 'viewer' and can_approve_git;
alter table public.project_members
  add constraint project_members_viewers_approve_nothing
  check (not (role = 'viewer' and can_approve_git));

-- Everyone can leave a project; the trigger of spec 04 keeps its last owner in.
create policy "project_members: members leave"
  on public.project_members for delete to covibes_app
  using (user_id = private.current_user_id());

-- Whatever changes among the members:
-- - is announced on the live channel of the project
-- - a personal custom agent is in a team through its creator, so it leaves with them
-- - the creator of a project is only its first owner: the place passes to the longest-standing
--   other owner when the creator leaves or stops being an owner
create function private.project_members_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_successor uuid;
begin
  perform pg_notify(
    'covibes_live', json_build_object('kind', 'project', 'projectId', v_project_id)::text
  );

  if tg_op = 'DELETE' then
    delete from public.project_agents pa
    using public.custom_agents a
    where pa.project_id = old.project_id
      and pa.agent_key = a.id::text
      and a.owner_id = old.user_id
      and a.project_id is null;
  end if;

  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select m.user_id into v_successor
    from public.project_members m
    where m.project_id = old.project_id and m.role = 'owner' and m.user_id <> old.user_id
    order by m.created_at, m.user_id
    limit 1;
    if v_successor is not null then
      update public.projects
      set owner_id = v_successor
      where id = old.project_id and owner_id = old.user_id;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.project_members_changed() from public;

create trigger project_members_changed
  after insert or update or delete on public.project_members
  for each row execute function private.project_members_changed();

-- Invitations ------------------------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- A link for several people, or a mail to one address that works once.
  kind text not null check (kind in ('link', 'email')),
  -- An owner is made in the member list, never by an invitation.
  role public.project_role not null check (role in ('editor', 'viewer')),
  email text check (char_length(email) between 3 and 254 and email = lower(btrim(email))),
  -- SHA-256 of the token as lowercase hex; the token itself is only in the link.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  uses integer not null default 0 check (uses >= 0),
  last_used_at timestamptz,
  revoked_at timestamptz,
  check ((kind = 'email') = (email is not null))
);

create index invitations_project_id_idx on public.invitations (project_id);

alter table public.invitations enable row level security;

-- The hash is written, never read: the functions below compare it.
revoke all on public.invitations from public;
grant select (
  id, project_id, kind, role, email, created_by, created_at, expires_at, uses, last_used_at,
  revoked_at
) on public.invitations to covibes_app;
grant insert (project_id, kind, role, email, token_hash, created_by)
  on public.invitations to covibes_app;
-- Revoking, and sending an email invitation again with a new token.
grant update (revoked_at, token_hash, expires_at) on public.invitations to covibes_app;

create policy "invitations: owners read"
  on public.invitations for select to covibes_app
  using (private.has_role(project_id, 'owner'));

create policy "invitations: owners invite"
  on public.invitations for insert to covibes_app
  with check (created_by = private.current_user_id() and private.has_role(project_id, 'owner'));

create policy "invitations: owners change"
  on public.invitations for update to covibes_app
  using (private.has_role(project_id, 'owner'))
  with check (private.has_role(project_id, 'owner'));

-- What became of an invitation: revoked, expired, used (an email invitation works once) or open.
create function private.invitation_status(p_invitation public.invitations)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_invitation.revoked_at is not null then 'revoked'
    when p_invitation.expires_at <= now() then 'expired'
    when p_invitation.kind = 'email' and p_invitation.uses > 0 then 'used'
    else 'open'
  end;
$$;

revoke all on function private.invitation_status(public.invitations) from public;

-- The hash a token is stored under; null for anything that cannot be a token.
create function private.invitation_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_token ~ '^[A-Za-z0-9_-]{43}$'
      then encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  end;
$$;

revoke all on function private.invitation_token_hash(text) from public;

-- Whether an owner's project has a member with this address; owners invite by address without
-- learning whose it is.
create function public.project_has_member_email(p_project_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_project_id, 'owner') and exists (
    select 1
    from public.project_members m
    join public.users u on u.id = m.user_id
    where m.project_id = p_project_id and lower(u.email) = lower(btrim(p_email))
  );
$$;

revoke all on function public.project_has_member_email(uuid, text) from public;
grant execute on function public.project_has_member_email(uuid, text) to covibes_app;

-- What an invitation link leads to, for the signed-in person who opened it. No row for a token
-- nobody issued. `status` is 'member' for someone who is in the project already, else what became
-- of the invitation; only an open invitation (or a member) learns the project and who invites.
-- Errors: '42501' without a user.
create function public.invitation_preview(p_token text)
returns table (
  project_id uuid,
  project_name text,
  role text,
  invited_by text,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations;
  v_status text;
begin
  if private.current_user_id() is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  select i.* into v_invitation
  from public.invitations i
  where i.token_hash = private.invitation_token_hash(p_token);
  if not found then
    return;
  end if;

  v_status := case
    when private.is_member(v_invitation.project_id) then 'member'
    else private.invitation_status(v_invitation)
  end;
  if v_status not in ('member', 'open') then
    return query select null::uuid, null::text, null::text, null::text, v_status;
    return;
  end if;
  return query
    select
      case when v_status = 'member' then p.id end,
      p.name,
      v_invitation.role::text,
      u.name,
      v_status
    from public.projects p
    left join public.users u on u.id = v_invitation.created_by
    where p.id = v_invitation.project_id;
end;
$$;

revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to covibes_app;

-- Joins the project of an open invitation with its role. No row for a token nobody issued.
-- `status`: 'joined', 'member' (was in the project already; the role stays), 'full' (the project
-- has 50 members), or what became of the invitation ('revoked', 'expired', 'used'). The project
-- is only told to someone who is in it afterwards.
-- Errors: '42501' without a user.
create function public.accept_invitation(p_token text)
returns table (project_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.current_user_id();
  v_invitation public.invitations;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  -- Locked, so an email invitation is not used twice at the same moment.
  select i.* into v_invitation
  from public.invitations i
  where i.token_hash = private.invitation_token_hash(p_token)
  for update;
  if not found then
    return;
  end if;

  if private.is_member(v_invitation.project_id) then
    return query select v_invitation.project_id, 'member'::text;
    return;
  end if;
  v_status := private.invitation_status(v_invitation);
  if v_status <> 'open' then
    return query select null::uuid, v_status;
    return;
  end if;
  if (
    select count(*) from public.project_members m where m.project_id = v_invitation.project_id
  ) >= 50 then
    return query select null::uuid, 'full'::text;
    return;
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_invitation.project_id, v_user_id, v_invitation.role);
  update public.invitations
  set uses = uses + 1, last_used_at = now()
  where id = v_invitation.id;
  return query select v_invitation.project_id, 'joined'::text;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to covibes_app;
