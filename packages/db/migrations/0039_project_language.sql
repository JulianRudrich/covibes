-- The language of a project (spec 32b).
--
-- A project is written in German or English: plan, exports, the package and what goes into the
-- repository. The column has been there since the first projects (migration 0002), but nothing
-- could set it, so every project was German. Now the project is created in the language its
-- creator chooses. Owners change it like the other settings: the grant for the column and the
-- policy for owners exist since migration 0002.

drop function public.create_project(text);

-- The only way to create a project: it adds the caller as owner and creates the main board,
-- all in one transaction. The main board is named in the project's language; the app shows it
-- in the reader's own.
create function public.create_project(p_name text, p_language text default 'de')
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

  -- The column's check refuses anything that is no language of the app.
  insert into public.projects (name, owner_id, language)
  values (btrim(p_name), v_user_id, p_language)
  returning * into v_project;

  insert into public.project_members (project_id, user_id, role)
  values (v_project.id, v_user_id, 'owner');

  insert into public.boards (project_id, title, kind, position)
  values (
    v_project.id,
    case v_project.language when 'en' then 'Main canvas' else 'Haupt-Canvas' end,
    'main',
    0
  );

  return v_project;
end;
$$;

revoke all on function public.create_project(text, text) from public;
grant execute on function public.create_project(text, text) to covibes_app;
