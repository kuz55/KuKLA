-- Organization, device, hazard and evidence foundations for KuKLA.
-- Additive migration: existing MVP tables remain compatible.

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER','ADMIN','COORDINATOR','MEMBER','OBSERVER')),
  active boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS search_organizations (
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  participation text NOT NULL DEFAULT 'PRIMARY' CHECK (participation IN ('PRIMARY','MUTUAL_AID','OBSERVER')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (search_id, organization_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_key text NOT NULL UNIQUE,
  name text,
  platform text,
  app_version text,
  last_seen_at timestamptz,
  battery integer CHECK (battery IS NULL OR battery BETWEEN 0 AND 100),
  network text,
  gps_accuracy double precision,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hazards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  reported_by uuid REFERENCES users(id),
  hazard_type text NOT NULL,
  severity text NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO','WARNING','DANGER','CRITICAL')),
  geometry jsonb NOT NULL DEFAULT '{}',
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  clue_id uuid REFERENCES clues(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('PHOTO','VIDEO','AUDIO','DOCUMENT','OTHER')),
  storage_key text NOT NULL,
  sha256 text,
  captured_at timestamptz,
  lat double precision,
  lng double precision,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  team_id uuid REFERENCES search_teams(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('SOS','HELP','MEDICAL','LOST_CONTACT','DEVICE_FAILURE','OTHER')),
  severity text NOT NULL DEFAULT 'EMERGENCY' CHECK (severity IN ('ALERT','EMERGENCY','CRITICAL')),
  lat double precision,
  lng double precision,
  message text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_operation_id uuid REFERENCES sync_operations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  local_payload jsonb NOT NULL,
  server_payload jsonb,
  resolution text CHECK (resolution IS NULL OR resolution IN ('LOCAL','SERVER','MERGED','MANUAL')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES searches(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id),
  job_type text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  model text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_search_orgs_org ON search_organizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_hazards_search_active ON hazards(search_id, active);
CREATE INDEX IF NOT EXISTS idx_evidence_search_time ON evidence(search_id, created_at);
CREATE INDEX IF NOT EXISTS idx_emergency_search_status ON emergency_events(search_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_search_status ON ai_jobs(search_id, status, created_at);
