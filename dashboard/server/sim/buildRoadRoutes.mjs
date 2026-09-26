// Fetches a road-following path for every leg of every simulated route from OSRM (OpenStreetMap
// routing) and writes sim/roadRoutes.json. The simulator drives along these stored coordinates,
// so it never needs the routing service at runtime.
//
// Run from dashboard/server after changing sim/routes.js:  node sim/buildRoadRoutes.mjs
// OSRM_URL overrides the public demo server (https://router.project-osrm.org).

import { writeFileSync } from 'node:fs';

import { benchWaypoints, waypoints } from './routes.js';
import { fetchRoadPath } from './osrm.js';

const OUT = new URL('./roadRoutes.json', import.meta.url);

const out = { source: 'OSRM driving profile over OpenStreetMap data', built_at: new Date().toISOString(), trucks: {} };
let points = 0;
for (const [truck_id, stops] of Object.entries(waypoints)) {
  out.trucks[truck_id] = [];
  for (let i = 0; i < stops.length; i++) {
    const from = stops[i];
    const to = stops[(i + 1) % stops.length];
    const path = await fetchRoadPath([from.lat, from.lng], [to.lat, to.lng], { timeoutMs: 15000 });
    out.trucks[truck_id].push({ from: from.name, to: to.name, path });
    points += path.length;
    console.log(`${truck_id} ${from.name} -> ${to.name}: ${path.length} points`);
    await new Promise((r) => setTimeout(r, 400)); // be gentle with the public demo server
  }
}
out.bench = [];
for (let i = 0; i < benchWaypoints.length; i++) {
  const from = benchWaypoints[i];
  const to = benchWaypoints[(i + 1) % benchWaypoints.length];
  const path = await fetchRoadPath([from.lat, from.lng], [to.lat, to.lng], { timeoutMs: 15000 });
  out.bench.push({ from: from.name, to: to.name, path });
  points += path.length;
  console.log(`bench ${from.name} -> ${to.name}: ${path.length} points`);
  await new Promise((r) => setTimeout(r, 400));
}
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${points} points to sim/roadRoutes.json`);
