-- Experimental private task inbox; recording does not imply delivery or read.
CREATE TABLE field_task_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL,
  task_id uuid NOT NULL,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_id uuid NOT NULL,
  audience text NOT NULL CHECK (audience IN ('GROUP_LEAD','FIELD_LEAD')),
  kind text NOT NULL CHECK (kind IN ('ASSIGNED','STARTED','RESULT_SUBMITTED','RESULT_ACCEPTED','RESULT_RETURNED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  FOREIGN KEY(task_id,search_id) REFERENCES field_tasks(id,search_id) ON DELETE CASCADE,
  UNIQUE(recipient_id,kind,reference_id)
);
CREATE INDEX field_task_notifications_unread ON field_task_notifications(recipient_id,created_at,id) WHERE acknowledged_at IS NULL;
