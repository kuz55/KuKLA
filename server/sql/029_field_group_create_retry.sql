-- Immutable creation receipts survive proposal resolution and future title edits.
-- Earlier experimental groups have no receipt and remain unchanged.
CREATE TABLE field_group_create_receipts (
  group_id uuid PRIMARY KEY,
  search_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  initial_title text NOT NULL,
  initial_candidate_id uuid NOT NULL REFERENCES users(id),
  proposal_id uuid NOT NULL,
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  UNIQUE(search_id,actor_id,request_id)
);
