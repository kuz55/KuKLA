-- Experimental, per-report grants. Membership deletion revokes them through the
-- composite FK. A search may contain several reports with different applicants.
CREATE TABLE search_contact_grants (
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES initial_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(search_id, report_id, user_id),
  FOREIGN KEY(search_id,user_id) REFERENCES search_members(search_id,user_id) ON DELETE CASCADE
);
CREATE INDEX search_contact_grants_user_idx ON search_contact_grants(user_id);
