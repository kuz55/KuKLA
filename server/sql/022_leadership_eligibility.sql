-- Explicit experimental authority, empty on migration. Existing system roles
-- are not automatically mapped to the agreed operational leadership role.
CREATE TABLE leadership_eligibility (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
