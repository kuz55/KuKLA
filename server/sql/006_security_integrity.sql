-- Security and integrity hardening after the initial RBAC foundation.

CREATE UNIQUE INDEX IF NOT EXISTS ux_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_search_members_user_search ON search_members(user_id, search_id);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at);

CREATE OR REPLACE FUNCTION kukla_bootstrap_system_owner(
  p_name text,
  p_email text,
  p_password text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Owner name is required';
  END IF;
  IF length(trim(p_email)) < 3 OR position('@' IN p_email) = 0 THEN
    RAISE EXCEPTION 'Owner email is required';
  END IF;
  IF length(p_password) < 12 THEN
    RAISE EXCEPTION 'Owner password must contain at least 12 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE role IN ('SYSTEM_OWNER','SUPERADMIN') AND active = true) THEN
    RAISE EXCEPTION 'System owner is already configured';
  END IF;

  IF EXISTS (SELECT 1 FROM public.system_bootstrap WHERE completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Bootstrap has already been completed';
  END IF;

  INSERT INTO public.users(name,email,password_hash,role,active)
  VALUES(trim(p_name),lower(trim(p_email)),crypt(p_password,gen_salt('bf',12)),'SYSTEM_OWNER',true)
  RETURNING id INTO v_id;

  UPDATE public.system_bootstrap
  SET completed_at = now(), completed_by = v_id
  WHERE id = true;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A user with this email or phone already exists';
END;
$$;

REVOKE ALL ON FUNCTION public.kukla_bootstrap_system_owner(text,text,text) FROM PUBLIC;
