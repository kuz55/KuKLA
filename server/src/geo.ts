// GeoJSON helpers and search-zone coverage/POD estimation.
// Kept dependency-free so it runs on the existing CI Postgres without PostGIS.
// Projections use an equirectangular approximation around the geometry centroid,
// which is adequate for the moderate areas of a missing-person search.

export type ZoneType = 'FOOT_AREA' | 'VEHICLE_CORRIDOR' | 'UAV_AREA' | 'GENERIC';

export interface SweepParams {
  laneWidthM?: number;
  speedKmh?: number;
  hours?: number;
  viewRadiusM?: number;
}

export interface GeometryMetrics {
  areaSqM: number;
  perimeterM: number;
  lengthM: number;
  plannedCoverageSqM: number;
  estimatedHours: number;
  podPct: number;
}

const EARTH_M_PER_DEG_LAT = 110_540;
// Detection-rate constant for the baseline POD model: probability contributed
// per person-hour of effective sweep. A placeholder requiring field calibration.
const DETECTION_RATE_PER_PERSON_HOUR = 0.03;

type Position = [number, number];

function project(coords: Position[], origin: Position): Position[] {
  const [lng0, lat0] = origin;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return coords.map(([lng, lat]) => [
    (lng - lng0) * mPerDegLng,
    (lat - lat0) * EARTH_M_PER_DEG_LAT,
  ]);
}

function polygonAreaSqM(ring: Position[]): number {
  if (ring.length < 3) return 0;
  const pts = project(ring, ring[0]);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function lineLengthM(coords: Position[]): number {
  if (coords.length < 2) return 0;
  const pts = project(coords, coords[0]);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    total += Math.hypot(dx, dy);
  }
  return total;
}

function ringCoords(geometry: unknown): Position[] | null {
  const g = geometry as { type?: string; coordinates?: unknown };
  if (!g || typeof g.type !== 'string' || !Array.isArray(g.coordinates)) return null;
  if (g.type === 'Polygon') {
    const poly = g.coordinates as Position[][];
    return poly?.[0] ?? null;
  }
  if (g.type === 'LineString') {
    return g.coordinates as Position[];
  }
  return null;
}

export function validateGeometry(geometry: unknown): boolean {
  const g = geometry as { type?: string; coordinates?: unknown };
  if (!g || typeof g.type !== 'string' || !Array.isArray(g.coordinates)) return false;
  if (g.type === 'Point') return Array.isArray(g.coordinates) && g.coordinates.length === 2;
  if (g.type === 'LineString' || g.type === 'Polygon') {
    if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return false;
    if (g.type === 'Polygon') {
      return Array.isArray(g.coordinates[0]) && (g.coordinates[0] as unknown[]).length >= 3;
    }
    return (g.coordinates as unknown[]).length >= 2;
  }
  return false;
}

export function computeMetrics(
  geometry: unknown,
  zoneType: ZoneType,
  sweep: SweepParams,
): GeometryMetrics {
  const ring = ringCoords(geometry);
  const areaSqM = ring && (zoneType === 'FOOT_AREA' || zoneType === 'UAV_AREA' || zoneType === 'GENERIC')
    ? polygonAreaSqM(ring)
    : 0;
  const perimeterM = ring ? lineLengthM([...ring, ring[0]]) : 0;
  const lengthM = ring ? lineLengthM(ring) : 0;

  const lane = sweep.laneWidthM ?? 0;
  const view = sweep.viewRadiusM ?? 0;
  const speedMph = (sweep.speedKmh ?? 0) * 1000;

  let plannedCoverageSqM = areaSqM;
  if (zoneType === 'FOOT_AREA') {
    plannedCoverageSqM = areaSqM + perimeterM * (lane / 2) + Math.PI * (lane / 2) ** 2;
  } else if (zoneType === 'UAV_AREA') {
    plannedCoverageSqM = areaSqM + perimeterM * view + Math.PI * view ** 2;
  } else if (zoneType === 'VEHICLE_CORRIDOR') {
    plannedCoverageSqM = lengthM * 2 * view;
  }

  let estimatedHours = 0;
  if (speedMph > 0) {
    if (zoneType === 'VEHICLE_CORRIDOR') estimatedHours = lengthM / speedMph;
    else if (zoneType === 'FOOT_AREA' || zoneType === 'UAV_AREA') {
      const effectiveWidth = zoneType === 'UAV_AREA' ? Math.max(view * 2, lane) : lane;
      estimatedHours = effectiveWidth > 0 ? areaSqM / (effectiveWidth * speedMph) : 0;
    }
  }

  const personHours = sweep.hours ?? estimatedHours;
  const podPct = personHours > 0
    ? (1 - Math.exp(-DETECTION_RATE_PER_PERSON_HOUR * personHours)) * 100
    : 0;

  return {
    areaSqM: Math.round(areaSqM),
    perimeterM: Math.round(perimeterM),
    lengthM: Math.round(lengthM),
    plannedCoverageSqM: Math.round(plannedCoverageSqM),
    estimatedHours: Math.round(estimatedHours * 10) / 10,
    podPct: Math.round(podPct * 10) / 10,
  };
}
