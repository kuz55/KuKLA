-- Development-only group workflow. No automatic product-role mapping.
CREATE TABLE field_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,search_id)
);
CREATE TABLE field_group_leads (
  group_id uuid PRIMARY KEY,
  search_id uuid NOT NULL,
  user_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  FOREIGN KEY(search_id,user_id) REFERENCES search_members(search_id,user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE field_group_lead_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE,
  search_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  proposed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  FOREIGN KEY(search_id,candidate_id) REFERENCES search_members(search_id,user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE field_group_members (
  group_id uuid NOT NULL,
  search_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,user_id),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  FOREIGN KEY(search_id,user_id) REFERENCES search_members(search_id,user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE field_group_member_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  search_id uuid NOT NULL,
  user_id uuid NOT NULL,
  proposed_by uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK(action IN ('ADD','REMOVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id,user_id),
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  FOREIGN KEY(search_id,user_id) REFERENCES search_members(search_id,user_id) DEFERRABLE INITIALLY DEFERRED
);
