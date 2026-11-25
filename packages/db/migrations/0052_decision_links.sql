-- Explicit decision dependencies (spec 50). Documents remain the source of target identity/text.
alter table public.decisions add constraint decisions_project_identity unique (project_id, id);

create table public.decision_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  decision_id uuid not null,
  target_kind text not null check (target_kind in ('block', 'task')),
  board_id uuid,
  target_id uuid not null,
  target_label text not null check (char_length(target_label) between 1 and 300),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, decision_id) references public.decisions(project_id, id) on delete cascade,
  check ((target_kind = 'block' and board_id is not null) or
         (target_kind = 'task' and board_id is null)),
  unique nulls not distinct (project_id, decision_id, target_kind, board_id, target_id)
);
-- No board FK: deleting a target preserves the explicit relationship as unavailable.
create index decision_links_target_idx
  on public.decision_links(project_id, target_kind, board_id, target_id);

alter table public.decision_links enable row level security;
revoke all on public.decision_links from public;
grant select, insert, delete on public.decision_links to covibes_app;

create policy "decision_links: members read"
  on public.decision_links for select to covibes_app
  using (private.is_member(project_id));
create policy "decision_links: editors add in their own name"
  on public.decision_links for insert to covibes_app
  with check (
    private.has_role(project_id, 'editor') and created_by = private.current_user_id() and
    (target_kind = 'task' or exists (
      select 1 from public.boards b
      where b.id = decision_links.board_id and b.project_id = decision_links.project_id
    ))
  );
create policy "decision_links: editors remove"
  on public.decision_links for delete to covibes_app
  using (private.has_role(project_id, 'editor'));

create function private.announce_decision_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_notify('covibes_live', json_build_object(
    'kind', 'decisions', 'projectId', coalesce(new.project_id, old.project_id)
  )::text);
  return null;
end;
$$;
revoke all on function private.announce_decision_links() from public;
create trigger decision_links_announce after insert or delete on public.decision_links
  for each row execute function private.announce_decision_links();
