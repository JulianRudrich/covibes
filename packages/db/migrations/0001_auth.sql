-- Login tables of Better Auth (spec 04). Generated with `pnpm --filter @covibes/server auth:schema`
-- for the configuration in apps/server/src/auth/auth.ts, then extended:
-- - users.locale defaults to 'de' and only allows the UI languages
-- - RLS on every table. Only covibes_admin (the login library) works with these tables; the app
--   role may read a few user columns, the policy for that follows with the project tables.

create table "users" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "name" text not null,
  "email" text not null unique,
  "email_verified" boolean not null,
  "image" text,
  "created_at" timestamptz default CURRENT_TIMESTAMP not null,
  "updated_at" timestamptz default CURRENT_TIMESTAMP not null,
  "locale" text not null default 'de' check ("locale" in ('de', 'en'))
);

create table "sessions" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "expires_at" timestamptz not null,
  "token" text not null unique,
  "created_at" timestamptz default CURRENT_TIMESTAMP not null,
  "updated_at" timestamptz not null,
  "ip_address" text,
  "user_agent" text,
  "user_id" uuid not null references "users" ("id") on delete cascade
);

create table "accounts" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "account_id" text not null,
  "provider_id" text not null,
  "user_id" uuid not null references "users" ("id") on delete cascade,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz default CURRENT_TIMESTAMP not null,
  "updated_at" timestamptz not null
);

create table "verifications" (
  "id" uuid default pg_catalog.gen_random_uuid() not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expires_at" timestamptz not null,
  "created_at" timestamptz default CURRENT_TIMESTAMP not null,
  "updated_at" timestamptz default CURRENT_TIMESTAMP not null
);

create index "sessions_user_id_idx" on "sessions" ("user_id");
create index "accounts_user_id_idx" on "accounts" ("user_id");
create index "verifications_identifier_idx" on "verifications" ("identifier");

alter table "users" enable row level security;
alter table "sessions" enable row level security;
alter table "accounts" enable row level security;
alter table "verifications" enable row level security;

revoke all on "users", "sessions", "accounts", "verifications" from public, covibes_app;
grant select ("id", "name", "image", "locale") on "users" to covibes_app;
