-- One-time invitations keep public self-registration disabled while allowing
-- authorized administrators to onboard named users without a shared password.
CREATE TABLE IF NOT EXISTS user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  role text NOT NULL CHECK (role IN ('SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','SEARCHER','VIEWER')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id uuid UNIQUE REFERENCES users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invitations_contact_check CHECK ((email IS NULL) <> (phone IS NULL)),
  CONSTRAINT user_invitations_email_normalized_check CHECK (email IS NULL OR (email = lower(btrim(email)) AND email <> '')),
  CONSTRAINT user_invitations_phone_format_check CHECK (phone IS NULL OR phone ~ '^[+][1-9][0-9]{7,14}$'),
  CONSTRAINT user_invitations_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_invitations_acceptance_check CHECK (
    (accepted_at IS NULL AND accepted_user_id IS NULL) OR
    (accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL)
  ),
  CONSTRAINT user_invitations_terminal_state_check CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_inviter_created
  ON user_invitations(invited_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_invitations_pending_expiry
  ON user_invitations(expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_invitations_pending_email
  ON user_invitations(lower(email))
  WHERE email IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_invitations_pending_phone
  ON user_invitations(phone)
  WHERE phone IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL;
