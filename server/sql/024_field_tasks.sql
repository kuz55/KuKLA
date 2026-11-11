-- Experimental group task workflow. Delivery, offline retry and production policy are not implemented.
CREATE TABLE field_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL,
  group_id uuid NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
  priority text NOT NULL CHECK (priority IN ('NORMAL','HIGH','URGENT')),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','IN_PROGRESS','REVIEW','ACCEPTED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  UNIQUE(id,search_id)
);
CREATE INDEX field_tasks_search_group_idx ON field_tasks(search_id,group_id,id);
CREATE TABLE field_task_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES field_tasks(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES users(id),
  result text NOT NULL CHECK (length(btrim(result)) BETWEEN 1 AND 4000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decision text CHECK (decision IN ('ACCEPTED','RETURNED')),
  decision_by uuid REFERENCES users(id),
  decision_at timestamptz,
  return_reason text,
  CHECK (((decision IS NULL AND decision_by IS NULL AND decision_at IS NULL AND return_reason IS NULL)
    OR (decision='ACCEPTED' AND decision_by IS NOT NULL AND decision_at IS NOT NULL AND return_reason IS NULL)
    OR (decision='RETURNED' AND decision_by IS NOT NULL AND decision_at IS NOT NULL AND return_reason IS NOT NULL AND length(btrim(return_reason)) BETWEEN 1 AND 2000)) IS TRUE)
);
CREATE UNIQUE INDEX field_task_one_pending_result ON field_task_results(task_id) WHERE decision IS NULL;
