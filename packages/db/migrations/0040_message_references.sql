-- References from the chat to the canvas (spec 37a).
--
-- A message keeps the elements of the canvas it refers to in `block_refs`: board, element, the
-- name as written and who made the element. The column has been there since the first messages
-- (migration 0004) and was never written. The server decides what a message refers to; the app
-- role stores it with the message it inserts. Agent messages are written by the worker.

alter table public.messages
  add constraint messages_block_refs_max check (jsonb_array_length(block_refs) <= 20);

grant insert (block_refs) on public.messages to covibes_app;
