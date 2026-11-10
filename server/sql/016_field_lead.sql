-- Experimental field-lead foundation. No eligibility is granted automatically.
CREATE TABLE field_lead_eligibility (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE search_field_leads (
  search_id uuid PRIMARY KEY REFERENCES searches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL REFERENCES users(id)
);
CREATE TABLE field_lead_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL UNIQUE REFERENCES searches(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES users(id),
  proposed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
