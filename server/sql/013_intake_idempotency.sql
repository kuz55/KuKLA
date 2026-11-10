-- Existing rows have no client key. New API writes require both fields.
ALTER TABLE initial_reports ADD COLUMN request_key uuid;
ALTER TABLE initial_reports ADD COLUMN request_fingerprint text;
ALTER TABLE initial_reports ADD CONSTRAINT initial_reports_request_key_check CHECK (
  (request_key IS NULL AND request_fingerprint IS NULL) OR
  (request_key IS NOT NULL AND request_fingerprint IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX initial_reports_actor_request_key_idx
  ON initial_reports (recorded_by, request_key) WHERE request_key IS NOT NULL;
