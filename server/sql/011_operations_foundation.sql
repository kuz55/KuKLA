-- KuKLA operations foundation (Wave B)
-- Decouples team<->sector<->period assignments from individual tasks and adds
-- search closeout records. Both are required for real-search operations.

CREATE TABLE IF NOT EXISTS sector_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES search_sectors(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES search_teams(id) ON DELETE CASCADE,
  operational_period_id uuid REFERENCES operational_periods(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE(sector_id, team_id, operational_period_id)
);

CREATE INDEX IF NOT EXISTS idx_sector_assignments_search ON sector_assignments(search_id);
CREATE INDEX IF NOT EXISTS idx_sector_assignments_sector ON sector_assignments(sector_id);
CREATE INDEX IF NOT EXISTS idx_sector_assignments_team ON sector_assignments(team_id);

CREATE TABLE IF NOT EXISTS search_closeout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  reason text NOT NULL,
  outcome text NOT NULL DEFAULT 'INCONCLUSIVE'
    CHECK (outcome IN ('FOUND_ALIVE','FOUND_DECEASED','INCONCLUSIVE','CANCELLED','HANDED_OVER')),
  summary text,
  closed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(search_id)
);

CREATE INDEX IF NOT EXISTS idx_closeout_search ON search_closeout(search_id);
