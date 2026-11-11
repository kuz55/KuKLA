-- Decisions are retained after the pending proposal is removed. Existing
-- proposals resolved before this migration have no retroactive receipt.
CREATE TABLE field_group_lead_response_receipts (
  proposal_id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  search_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES users(id),
  accepted boolean NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE
);
