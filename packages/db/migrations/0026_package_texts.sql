-- The team's texts for the package for coding agents (spec 27b).
--
-- What the plan does not say and a coding agent needs: the code standards and the UI direction.
-- One text per kind and project; a text nobody gave has no row. Members read; owners and editors
-- write in their own name. RLS, policies and grants for covibes_app in this same migration.

create table public.package_texts (
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('code_standards', 'ui_direction')),
  content text not null check (char_length(content) between 1 and 8000),
  -- Who wrote the text as it stands.
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, kind)
);

create trigger package_texts_touch_updated_at
  before update on public.package_texts
  for each row execute function private.touch_updated_at();

alter table public.package_texts enable row level security;

revoke all on public.package_texts from public;
grant select, insert, delete on public.package_texts to covibes_app;
grant update (content, updated_by) on public.package_texts to covibes_app;

create policy "package_texts: members read"
  on public.package_texts for select to covibes_app
  using (private.is_member(project_id));

create policy "package_texts: editors add in their own name"
  on public.package_texts for insert to covibes_app
  with check (
    updated_by = private.current_user_id()
    and private.has_role(project_id, 'editor')
  );

create policy "package_texts: editors change in their own name"
  on public.package_texts for update to covibes_app
  using (private.has_role(project_id, 'editor'))
  with check (
    updated_by = private.current_user_id()
    and private.has_role(project_id, 'editor')
  );

create policy "package_texts: editors remove"
  on public.package_texts for delete to covibes_app
  using (private.has_role(project_id, 'editor'));
