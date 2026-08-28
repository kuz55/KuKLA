-- KuKLA operational domain foundation
-- Adds entities required for real search operations while keeping the existing MVP tables compatible.

CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  full_name text,
  age integer CHECK (age IS NULL OR age >= 0),
  sex text,
  description text,
  clothing text,
  medical_notes text,
  last_known_lat double precision,
  last_known_lng double precision,
  last_known_at timestamptz,
  photo_url text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operational_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','CLOSED')),
  briefing text,
  debriefing text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'UNSEARCHED' CHECK (status IN ('UNSEARCHED','ASSIGNED','SEARCHING','COMPLETE','SUSPENDED')),
  priority integer NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  geometry jsonb NOT NULL DEFAULT '{}',
  pod numeric(5,2) CHECK (pod IS NULL OR (pod >= 0 AND pod <= 100)),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(search_id, code)
);

CREATE TABLE IF NOT EXISTS search_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  name text NOT NULL,
  callsign text,
  team_type text NOT NULL DEFAULT 'FOOT' CHECK (team_type IN ('FOOT','VEHICLE','K9','UAV','AIR','OTHER')),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','ASSIGNED','SEARCHING','RETURNING','OFFLINE','EMERGENCY')),
  leader_id uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES search_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  team_id uuid REFERENCES search_teams(id) ON DELETE SET NULL,
  sector_id uuid REFERENCES search_sectors(id) ON DELETE SET NULL,
  operational_period_id uuid REFERENCES operational_periods(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS clues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES search_sectors(id) ON DELETE SET NULL,
  reported_by uuid REFERENCES users(id),
  clue_type text NOT NULL,
  description text NOT NULL,
  lat double precision,
  lng double precision,
  observed_at timestamptz,
  photo_url text,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONFIRMED','DISMISSED','RESOLVED')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS witnesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  name text,
  phone text,
  contact_at timestamptz,
  location_lat double precision,
  location_lng double precision,
  statement text,
  reliability text CHECK (reliability IS NULL OR reliability IN ('UNKNOWN','LOW','MEDIUM','HIGH')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('VEHICLE','K9','UAV','AIRCRAFT','RADIO','MEDICAL','EQUIPMENT','OTHER')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','ASSIGNED','IN_USE','UNAVAILABLE','LOST')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkins (
  id bigserial PRIMARY KEY,
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES search_teams(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'OK' CHECK (status IN ('OK','DELAYED','HELP','EMERGENCY')),
  lat double precision,
  lng double precision,
  battery integer CHECK (battery IS NULL OR (battery >= 0 AND battery <= 100)),
  network text,
  accuracy double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid REFERENCES searches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','ALERT','EMERGENCY')),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  client_created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','APPLIED','REJECTED','CONFLICT')),
  error text
);

CREATE INDEX IF NOT EXISTS idx_subjects_search ON subjects(search_id);
CREATE INDEX IF NOT EXISTS idx_periods_search ON operational_periods(search_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_sectors_search_status ON search_sectors(search_id, status);
CREATE INDEX IF NOT EXISTS idx_teams_search_status ON search_teams(search_id, status);
CREATE INDEX IF NOT EXISTS idx_clues_search_time ON clues(search_id, created_at);
CREATE INDEX IF NOT EXISTS idx_witnesses_search ON witnesses(search_id);
CREATE INDEX IF NOT EXISTS idx_resources_search_status ON resources(search_id, status);
CREATE INDEX IF NOT EXISTS idx_checkins_search_time ON checkins(search_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_operations_device_time ON sync_operations(device_id, received_at);
