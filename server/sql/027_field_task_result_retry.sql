-- Existing results remain readable; new submissions carry a client request ID.
ALTER TABLE field_task_results ADD COLUMN submit_request_id uuid;
CREATE UNIQUE INDEX field_task_result_request_unique
  ON field_task_results(task_id,submitted_by,submit_request_id)
  WHERE submit_request_id IS NOT NULL;
