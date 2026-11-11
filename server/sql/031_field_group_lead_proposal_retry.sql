-- Snapshot of a proposed lead, retained after acceptance or refusal.
CREATE TABLE field_group_lead_proposal_receipts (
  proposal_id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  search_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES users(id),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  UNIQUE(search_id,actor_id,request_id)
);
