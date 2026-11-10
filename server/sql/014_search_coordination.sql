-- The product-role mapping and grant management are not yet approved.
-- No user is automatically given coordinator eligibility.
CREATE TABLE coordinator_eligibility (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE search_coordinators (
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  is_primary boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY(search_id,user_id)
);
CREATE UNIQUE INDEX search_coordinators_one_primary ON search_coordinators(search_id) WHERE is_primary;

CREATE TABLE coordinator_transfers (
  search_id uuid PRIMARY KEY REFERENCES searches(id) ON DELETE CASCADE,
  initiated_by uuid NOT NULL REFERENCES users(id),
  from_user_id uuid NOT NULL REFERENCES users(id),
  to_user_id uuid NOT NULL REFERENCES users(id),
  retain_previous boolean NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(from_user_id <> to_user_id)
);
