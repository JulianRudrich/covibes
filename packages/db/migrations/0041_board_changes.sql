-- The history of a board (spec 38a).
--
-- An entry is what one author did on a board in one go: the elements they added, removed, moved
-- or changed, each as it was before and after, so the entry can be listed and taken back as a
-- whole (spec 38b). The server writes the entries when it stores the board; nobody else writes
-- them. Members read the history of their project's boards. RLS, policies and grants for
-- covibes_app in this same migration.

create table public.board_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Who did it: a person, an agent, or nobody the server could name.
  actor_kind text not null check (actor_kind in ('human', 'agent', 'unknown')),
  -- Null once the person deleted their account; their name stays with the entry.
  actor_user_id uuid references public.users (id) on delete set null,
  actor_agent_key text check (char_length(actor_agent_key) between 1 and 40),
  -- The person's name when the entry was written, so it stays readable after they left.
  actor_name text not null default '' check (char_length(actor_name) <= 200),
  -- The elements: id, kind, label, action, and the element before and after.
  items jsonb not null check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 300
  ),
  created_at timestamptz not null default now(),
  -- When the author last added to the entry.
  updated_at timestamptz not null default now(),
  constraint board_changes_actor check (
    (actor_kind = 'agent') = (actor_agent_key is not null)
    and (actor_kind = 'human' or actor_user_id is null)
  )
);

create index board_changes_board_idx on public.board_changes (board_id, updated_at desc, id);

alter table public.board_changes enable row level security;

revoke all on public.board_changes from public;
grant select on public.board_changes to covibes_app;

-- What is on a board is shown to every member, and so is how it got there.
create policy "board_changes: members read"
  on public.board_changes for select to covibes_app
  using (private.is_member(project_id));
