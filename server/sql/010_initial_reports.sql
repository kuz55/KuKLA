-- Storage foundation only: there is deliberately no API or role mapping in
-- this migration. NULL represents a field explicitly recorded as unknown.
-- No SMS, handoff, or workflow status is inferred from creating a row.
CREATE TABLE initial_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_by uuid NOT NULL REFERENCES users(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  applicant_name text CHECK (applicant_name IS NULL OR length(btrim(applicant_name)) > 0),
  applicant_contact text CHECK (applicant_contact IS NULL OR length(btrim(applicant_contact)) > 0),
  missing_person_name text CHECK (missing_person_name IS NULL OR length(btrim(missing_person_name)) > 0),
  last_seen_time text CHECK (last_seen_time IS NULL OR length(btrim(last_seen_time)) > 0),
  last_seen_place text CHECK (last_seen_place IS NULL OR length(btrim(last_seen_place)) > 0),
  situation text CHECK (situation IS NULL OR length(btrim(situation)) > 0)
);

CREATE INDEX initial_reports_received_at_idx ON initial_reports (received_at DESC, id);
