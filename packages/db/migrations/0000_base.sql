-- Base for all later migrations (spec 02a).
--
-- The server runs every request on behalf of a user as role covibes_app inside a transaction and
-- sets `app.user_id` first (withUser). RLS policies read it through private.current_user_id().
-- Helper functions live in the `private` schema.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to covibes_app;

revoke all on schema public from public;
grant usage on schema public to covibes_app;

-- Null when no user is set: then every policy that compares against it denies access.
create function private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

revoke all on function private.current_user_id() from public;
grant execute on function private.current_user_id() to covibes_app;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;
