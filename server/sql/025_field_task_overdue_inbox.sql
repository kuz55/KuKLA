-- Private experimental inbox, not device delivery. No task text or personal data.
CREATE TABLE field_task_overdue_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES field_tasks(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE(task_id,recipient_id)
);
CREATE INDEX field_task_overdue_unread_idx ON field_task_overdue_notifications(recipient_id,created_at,id) WHERE acknowledged_at IS NULL;
