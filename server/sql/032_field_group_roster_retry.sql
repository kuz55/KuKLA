-- Immutable receipts for group roster commands; old commands have no receipt.
CREATE TABLE field_group_member_proposal_receipts (
  proposal_id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  search_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  target_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('ADD','REMOVE')),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  UNIQUE(search_id,actor_id,request_id)
);
CREATE TABLE field_group_member_decision_receipts (
  proposal_id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  search_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  approved boolean NOT NULL,
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE
);
CREATE TABLE field_group_member_change_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  search_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  target_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('ADD','REMOVE')),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  UNIQUE(search_id,actor_id,request_id)
);
