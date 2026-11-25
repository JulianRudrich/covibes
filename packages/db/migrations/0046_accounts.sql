-- Spec 42: Better Auth's passwordless account security, plus exact-email beta invitations.
-- Auth schema generated with auth:schema for Better Auth/passkey 1.7.18.
alter table public.users add column two_factor_enabled boolean not null default false;

create table public.account_two_factors (
  id uuid default gen_random_uuid() primary key,
  secret text not null,
  backup_codes text not null,
  user_id uuid not null unique references public.users(id) on delete cascade,
  verified boolean not null default false,
  failed_verification_count integer not null default 0,
  locked_until timestamptz
);
create index account_two_factors_secret_idx on public.account_two_factors(secret);

create table public.account_passkeys (
  id uuid default gen_random_uuid() primary key,
  name text,
  public_key text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  credential_id text not null unique,
  counter integer not null,
  device_type text not null,
  backed_up boolean not null,
  transports text,
  created_at timestamptz,
  aaguid text
);
create index account_passkeys_user_id_idx on public.account_passkeys(user_id);

create table public.beta_invitations (
  email text primary key check (email = lower(trim(email))),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Better Auth and the operator use covibes_admin; the application role never reads secrets.
alter table public.account_two_factors enable row level security;
alter table public.account_passkeys enable row level security;
alter table public.beta_invitations enable row level security;
revoke all on public.account_two_factors, public.account_passkeys, public.beta_invitations
  from public, covibes_app;
