-- Regional managers are management-role users, but search access still goes
-- through the normal direct-search or active-organization membership checks.
-- Do not add this role to privileged/global access in a future migration without
-- a reviewed region-assignment model and audit scope.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR',
    'REGIONAL_MANAGER','SEARCHER','VIEWER'
  ));

ALTER TABLE user_invitations DROP CONSTRAINT IF EXISTS user_invitations_role_check;
ALTER TABLE user_invitations ADD CONSTRAINT user_invitations_role_check
  CHECK (role IN (
    'SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR',
    'REGIONAL_MANAGER','SEARCHER','VIEWER'
  ));
