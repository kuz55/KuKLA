-- Existing experimental tasks predate request IDs and remain readable.
-- New task creation requires an explicit client-generated UUID.
ALTER TABLE field_tasks ADD COLUMN create_request_id uuid;
CREATE UNIQUE INDEX field_task_create_request_unique
  ON field_tasks(search_id,created_by,create_request_id)
  WHERE create_request_id IS NOT NULL;
