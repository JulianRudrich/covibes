-- Keyset pagination keeps both PostgreSQL timestamp precision and the ID tie-breaker (spec 47).
-- The replacement keeps the old index's useful prefix while avoiding a sort at every page.
create index messages_history_cursor_idx
  on public.messages (project_id, created_at desc, id desc);
drop index public.messages_project_id_created_at_idx;
