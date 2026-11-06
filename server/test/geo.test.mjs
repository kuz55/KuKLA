import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, validateGeometry } from '../dist/geo.js';

const square = {
  type: 'Polygon',
  coordinates: [[
    [73.0, 55.0], [73.009, 55.0], [73.009, 55.009], [73.0, 55.009], [73.0, 55.0],
  ]],
};

const road = {
  type: 'LineString',
  coordinates: [[73.0, 55.0], [73.009, 55.0], [73.009, 55.009]],
};

test('validateGeometry accepts polygons, linestrings and points', () => {
  assert.equal(validateGeometry(square), true);
  assert.equal(validateGeometry(road), true);
  assert.equal(validateGeometry({ type: 'Point', coordinates: [73, 55] }), true);
  assert.equal(validateGeometry({ type: 'Polygon', coordinates: [] }), false);
  assert.equal(validateGeometry(null), false);
  assert.equal(validateGeometry({ type: 'WKT' }), false);
});

test('computeMetrics: foot area yields positive area and finite POD', () => {
  const m = computeMetrics(square, 'FOOT_AREA', { laneWidthM: 20, speedKmh: 3.5, hours: 8 });
  // ~575 m x 995 m square => ~572,000 m^2 (equirectangular approximation).
  assert.ok(m.areaSqM > 400_000 && m.areaSqM < 700_000, `area=${m.areaSqM}`);
  assert.ok(m.perimeterM > 2800 && m.perimeterM < 3500, `perimeter=${m.perimeterM}`);
  assert.ok(m.plannedCoverageSqM > m.areaSqM, 'planned coverage expands beyond raw area');
  assert.ok(m.estimatedHours > 0 && m.estimatedHours < 100, `hours=${m.estimatedHours}`);
  assert.ok(m.podPct > 0 && m.podPct <= 100, `pod=${m.podPct}`);
});

test('computeMetrics: vehicle corridor uses length * 2 * view radius', () => {
  const m = computeMetrics(road, 'VEHICLE_CORRIDOR', { speedKmh: 40, viewRadiusM: 200, hours: 2 });
  assert.equal(m.areaSqM, 0);
  assert.ok(m.lengthM > 1400 && m.lengthM < 1800, `length=${m.lengthM}`);
  assert.ok(m.plannedCoverageSqM > 0, 'corridor planned coverage is positive');
  assert.ok(m.podPct > 0 && m.podPct <= 100);
});

test('computeMetrics: missing effort yields zero POD', () => {
  const m = computeMetrics(square, 'FOOT_AREA', {});
  assert.equal(m.podPct, 0);
  assert.equal(m.estimatedHours, 0);
});
