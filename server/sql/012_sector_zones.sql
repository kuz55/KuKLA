-- KuKLA Wave C foundation: typed search zones and sweep parameters.
-- Geometry stays as GeoJSON (jsonb); coverage/POD math is computed server-side
-- (see server/src/geo.ts). PostGIS remains a future enhancement for true
-- spatial intersections/buffering.

ALTER TABLE search_sectors ADD COLUMN IF NOT EXISTS zone_type text NOT NULL DEFAULT 'GENERIC'
  CHECK (zone_type IN ('FOOT_AREA', 'VEHICLE_CORRIDOR', 'UAV_AREA', 'GENERIC'));

ALTER TABLE search_sectors ADD COLUMN IF NOT EXISTS sweep_params jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN search_sectors.zone_type IS
  'Distinguishes how a zone is searched: FOOT_AREA (polygon swept on foot in lanes), '
  'VEHICLE_CORRIDOR (road corridor searched from a vehicle with a view radius), '
  'UAV_AREA (polygon overflown), GENERIC (unspecified).';
COMMENT ON COLUMN search_sectors.sweep_params IS
  'Search-effort parameters: laneWidthM, speedKmh, hours, viewRadiusM.';
