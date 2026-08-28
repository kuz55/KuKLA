-- KuKLA secure RBAC bootstrap foundation
-- No default administrator credentials are created by this migration.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','SEARCHER','VIEWER'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_single_system_owner
  ON users ((role))
  WHERE role = 'SYSTEM_OWNER' AND active = true;

CREATE TABLE IF NOT EXISTS system_bootstrap (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id)
);

INSERT INTO system_bootstrap(id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- One-time database bootstrap function.
-- It can create SYSTEM_OWNER only while no active SYSTEM_OWNER/SUPERADMIN exists.
-- The password is hashed by pgcrypto and is never stored in source control.
CREATE OR REPLACE FUNCTION kukla_bootstrap_system_owner(
  p_name text,
  p_email text,
  p_password text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Owner name is required';
  END IF;
  IF length(trim(p_email)) < 3 THEN
    RAISE EXCEPTION 'Owner email is required';
  END IF;
  IF length(p_password) < 12 THEN
    RAISE EXCEPTION 'Owner password must contain at least 12 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE role IN ('SYSTEM_OWNER','SUPERADMIN') AND active = true) THEN
    RAISE EXCEPTION 'System owner is already configured';
  END IF;

  IF EXISTS (SELECT 1 FROM system_bootstrap WHERE completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Bootstrap has already been completed';
  END IF;

  INSERT INTO users(name,email,password_hash,role,active)
  VALUES(trim(p_name),lower(trim(p_email)),crypt(p_password,gen_salt('bf',12)),'SYSTEM_OWNER',true)
  RETURNING id INTO v_id;

  UPDATE system_bootstrap
  SET completed_at = now(), completed_by = v_id
  WHERE id = true;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A user with this email or phone already exists';
END;
$$;

REVOKE ALL ON FUNCTION kukla_bootstrap_system_owner(text,text,text) FROM PUBLIC;

-- The old public development administrator used a known password.
-- Disable that exact seeded account if it exists. It must not remain a production login.
UPDATE users
SET active = false
WHERE lower(email) = 'admin@kukla.local';
