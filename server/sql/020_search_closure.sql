-- Experimental closure state. Confirmation is tied to a specific accepted
-- field-lead assignment, not merely a user, so replacement invalidates it.
ALTER TABLE search_field_leads ADD COLUMN assignment_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE search_closure_confirmations (
  search_id uuid PRIMARY KEY REFERENCES searches(id) ON DELETE CASCADE,
  field_lead_id uuid NOT NULL REFERENCES users(id),
  assignment_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

-- Only the currently closed cycle is stored here; events retain the history.
-- Restoring the previous status on reopen avoids inventing a new activation.
CREATE TABLE search_closures (
  search_id uuid PRIMARY KEY REFERENCES searches(id) ON DELETE CASCADE,
  previous_status text NOT NULL CHECK (previous_status IN ('PLANNED','ACTIVE','PAUSED')),
  closed_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now()
);
