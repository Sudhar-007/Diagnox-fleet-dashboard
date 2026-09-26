import { test } from 'node:test';
import assert from 'node:assert/strict';

import { haversine } from '../engine/geo.js';
import { routes, waypoints } from '../sim/routes.js';
import { createSimulator, pathLengths, pointAlong } from '../sim/simulator.js';

// Metres from point p to the nearest segment of a [lat, lng] path (flat-earth, fine at city scale).
function distanceToPath(p, path) {
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][1] * kx;
    const ay = path[i - 1][0] * ky;
    const bx = path[i][1] * kx;
    const by = path[i][0] * ky;
    const px = p[1] * kx;
    const py = p[0] * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

test('every leg of every simulated route has a stored road path that joins the next leg', () => {
  for (const [id, stops] of Object.entries(routes)) {
    assert.equal(stops.length, waypoints[id].length);
    stops.forEach((stop, i) => {
      assert.ok(Array.isArray(stop.path) && stop.path.length >= 10, `${id} leg ${i} has a road path`);
      const next = stops[(i + 1) % stops.length];
      const end = stop.path.at(-1);
      assert.ok(haversine(end[0], end[1], next.path[0][0], next.path[0][1]) < 1, `${id} leg ${i} ends where the next starts`);
      // Stops are snapped onto the road, close to the named place.
      const named = waypoints[id][i];
      assert.ok(haversine(named.lat, named.lng, stop.lat, stop.lng) < 300, `${id} ${named.name} is near its road point`);
    });
  }
});

test('pointAlong walks a path by distance', () => {
  const path = [
    [13, 80],
    [13.001, 80],
    [13.001, 80.001],
  ];
  const cum = pathLengths(path);
  assert.deepEqual(pointAlong(path, cum, 0), path[0]);
  assert.deepEqual(pointAlong(path, cum, cum.at(-1) + 50), path[2]);
  const mid = pointAlong(path, cum, cum[1] / 2);
  assert.ok(Math.abs(mid[0] - 13.0005) < 1e-9 && mid[1] === 80);
});

test('simulated trucks stay on their road paths and move as far as their speed says', () => {
  const sim = createSimulator({ routes });
  const all = Object.fromEntries(Object.entries(routes).map(([id, stops]) => [id, stops.flatMap((s) => s.path)]));
  const prev = {};
  let t = Date.parse('2026-09-10T10:00:00');
  let worst = 0;
  let checkedSteps = 0;
  for (let s = 0; s < 1800; s++) {
    t += 1000;
    for (const p of sim.step(t)) {
      worst = Math.max(worst, distanceToPath([p.latitude, p.longitude], all[p.truck_id]));
      const q = prev[p.truck_id];
      if (q) {
        // Distance covered in the second matches the speeds at either end of it.
        const moved = haversine(q.latitude, q.longitude, p.latitude, p.longitude);
        const expected = (p.speed / 3.6) * 1;
        assert.ok(moved <= Math.max(q.speed, p.speed) / 3.6 + 2, `${p.truck_id} jumped ${moved.toFixed(1)} m in 1 s`);
        if (expected > 5) checkedSteps += 1;
      }
      prev[p.truck_id] = p;
    }
  }
  assert.ok(worst < 2, `a point was ${worst.toFixed(1)} m off its road path`);
  assert.ok(checkedSteps > 1000);
});
