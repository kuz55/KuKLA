-- Historical acceptance receipts support retries without reinstating old leads.
CREATE TABLE field_lead_acceptance_receipts (
  proposal_id uuid PRIMARY KEY,
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES users(id),
  accepted_at timestamptz NOT NULL DEFAULT now()
);
