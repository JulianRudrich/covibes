-- The project plan (spec 25a).
--
-- The plan is one shared document per project. The collaboration server stores it in
-- `yjs_documents` under the name `plan:<project id>`, like the boards' documents; that table has no
-- key to the projects, so the plan would outlive its project. It goes with it here.

create function private.delete_plan_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.yjs_documents where name = 'plan:' || old.id;
  return null;
end;
$$;

revoke all on function private.delete_plan_document() from public;

create trigger projects_delete_plan_document
  after delete on public.projects
  for each row execute function private.delete_plan_document();
