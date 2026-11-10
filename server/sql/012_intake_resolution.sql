-- Registrar resolution; existing handed-off reports remain unresolved.
ALTER TABLE initial_reports
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by uuid REFERENCES users(id),
  ADD COLUMN search_id uuid REFERENCES searches(id),
  ADD COLUMN resolution_reason text;

ALTER TABLE initial_reports ADD CONSTRAINT initial_reports_resolution_check CHECK (
  (resolved_at IS NULL AND resolved_by IS NULL AND search_id IS NULL AND resolution_reason IS NULL)
  OR
  (handed_off_at IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND
    ((search_id IS NOT NULL AND resolution_reason IS NULL) OR
     (search_id IS NULL AND resolution_reason IS NOT NULL AND length(btrim(resolution_reason)) > 0)))
);

ALTER TABLE initial_report_audit DROP CONSTRAINT initial_report_audit_action_check;
ALTER TABLE initial_report_audit ADD CONSTRAINT initial_report_audit_action_check
  CHECK (action IN ('CREATED', 'HANDED_OFF', 'SEARCH_LINKED', 'CLOSED_WITHOUT_SEARCH'));
ALTER TABLE initial_report_audit ADD COLUMN search_id uuid REFERENCES searches(id);
ALTER TABLE initial_report_audit ADD COLUMN reason text;
ALTER TABLE initial_report_audit ADD CONSTRAINT initial_report_audit_resolution_check CHECK (
  (action IN ('CREATED', 'HANDED_OFF') AND search_id IS NULL AND reason IS NULL)
  OR (action = 'SEARCH_LINKED' AND search_id IS NOT NULL AND reason IS NULL)
  OR (action = 'CLOSED_WITHOUT_SEARCH' AND search_id IS NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0)
);

CREATE INDEX initial_reports_unresolved_queue_idx ON initial_reports (handed_off_at, id)
  WHERE handed_off_at IS NOT NULL AND resolved_at IS NULL;
