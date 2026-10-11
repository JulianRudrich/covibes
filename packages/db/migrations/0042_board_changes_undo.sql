-- Taking an entry of a board's history back (spec 38b).
--
-- Taking back is itself a change of the board, by the person who did it: a new entry that names
-- the entry it takes back. The entry that was taken back says when and by whom, how many of its
-- elements were set back and how many stayed as they were. The server writes both; the grants and
-- policies of the table stay as they are.

alter table public.board_changes
  -- The entry this one takes back. Null once that entry is gone: then this is an entry like any.
  add column reverts uuid references public.board_changes (id) on delete set null,
  add column undone_at timestamptz,
  -- Null once the person deleted their account; their name stays with the entry.
  add column undone_by uuid references public.users (id) on delete set null,
  add column undone_by_name text not null default '' check (char_length(undone_by_name) <= 200),
  add column undone_reverted integer check (undone_reverted >= 1),
  add column undone_kept integer check (undone_kept >= 0),
  add constraint board_changes_undone check (
    (undone_at is null) = (undone_reverted is null)
    and (undone_at is null) = (undone_kept is null)
    and (undone_at is not null or (undone_by is null and undone_by_name = ''))
  ),
  add constraint board_changes_reverts_other check (reverts is distinct from id);

-- Entries go after 30 days; the ones that took them back are found by this.
create index board_changes_reverts_idx on public.board_changes (reverts) where reverts is not null;
