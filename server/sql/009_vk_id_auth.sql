-- Server-side VK ID OAuth transactions and stable provider identity mapping.
CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('vk_id')),
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS vk_auth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash char(64) NOT NULL UNIQUE,
  poll_secret_hash char(64) NOT NULL,
  code_verifier text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed','consumed')),
  result_token text,
  result_user jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vk_auth_requests_expires_at ON vk_auth_requests(expires_at);
