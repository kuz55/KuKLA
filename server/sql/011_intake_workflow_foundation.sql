-- Explicit permissions are deliberately empty on installation; existing roles
-- are not automatically mapped to the new intake responsibilities.
CREATE TABLE intake_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('RECORD', 'REGISTER')),
  PRIMARY KEY (user_id, permission)
);

ALTER TABLE initial_reports ADD COLUMN handed_off_at timestamptz;

CREATE TABLE initial_report_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES initial_reports(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('CREATED', 'HANDED_OFF')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX initial_report_audit_report_idx ON initial_report_audit (report_id, id);
CREATE INDEX initial_reports_handoff_queue_idx ON initial_reports (handed_off_at, id) WHERE handed_off_at IS NOT NULL;
