import { existsSync, readFileSync } from 'node:fs';

import { haversine } from '../engine/geo.js';

// Looping routes across Chennai, as named stops. `dwell_s` = stop at that waypoint,
// `cruise` = target speed (km/h) on the leg that leaves it.
// Long dwells (>= 120 s) are depot / yard stops where the engine is switched off.
// Trucks drive the road path of each leg from sim/roadRoutes.json (built from OpenStreetMap
// by sim/buildRoadRoutes.mjs), never a straight line between stops.

export const waypoints = {
  TN01: [
    { name: 'Chennai Port', lat: 13.096, lng: 80.292, dwell_s: 150, cruise: 35 },
    { name: 'Chennai Central', lat: 13.0827, lng: 80.2757, cruise: 40 },
    { name: 'Egmore', lat: 13.0732, lng: 80.2609, cruise: 50 },
    { name: 'Anna Nagar', lat: 13.085, lng: 80.2101, cruise: 45 },
    { name: 'Koyambedu', lat: 13.0694, lng: 80.1948, dwell_s: 30, cruise: 50 },
    { name: 'T Nagar', lat: 13.0418, lng: 80.2341, cruise: 35 },
    { name: 'Mylapore', lat: 13.0339, lng: 80.2619, cruise: 45 },
    { name: 'Marina', lat: 13.05, lng: 80.2824, cruise: 50 },
  ],
  TN02: [
    { name: 'Ambattur', lat: 13.1143, lng: 80.1548, dwell_s: 150, cruise: 55 },
    { name: 'Padi', lat: 13.0977, lng: 80.1837, cruise: 45 },
    { name: 'Anna Nagar', lat: 13.085, lng: 80.2101, cruise: 40 },
    { name: 'Koyambedu', lat: 13.0694, lng: 80.1948, dwell_s: 40, cruise: 55 },
    { name: 'Porur', lat: 13.0382, lng: 80.1565, cruise: 60 },
    { name: 'Poonamallee', lat: 13.0473, lng: 80.0945, cruise: 60 },
  ],
  TN03: [
    { name: 'Guindy', lat: 13.0067, lng: 80.2206, dwell_s: 150, cruise: 40 },
    { name: 'Velachery', lat: 12.9815, lng: 80.218, cruise: 60 },
    { name: 'Tambaram', lat: 12.9249, lng: 80.1, dwell_s: 35, cruise: 55 },
    { name: 'Pallavaram', lat: 12.9675, lng: 80.1491, cruise: 50 },
  ],
  TN04: [
    { name: 'Adyar', lat: 13.0012, lng: 80.2565, dwell_s: 150, cruise: 45 },
    { name: 'Thiruvanmiyur', lat: 12.983, lng: 80.2594, cruise: 55 },
    { name: 'Perungudi', lat: 12.9654, lng: 80.2461, cruise: 65 },
    { name: 'Sholinganallur', lat: 12.901, lng: 80.2279, dwell_s: 30, cruise: 55 },
    { name: 'Velachery', lat: 12.9815, lng: 80.218, cruise: 45 },
    { name: 'Saidapet', lat: 13.0213, lng: 80.2231, cruise: 40 },
  ],
  TN05: [
    { name: 'Ennore', lat: 13.2146, lng: 80.3203, dwell_s: 150, cruise: 50 },
    { name: 'Tiruvottiyur', lat: 13.1643, lng: 80.3001, cruise: 45 },
    { name: 'Royapuram', lat: 13.1137, lng: 80.2954, cruise: 35 },
    { name: 'Chennai Port', lat: 13.096, lng: 80.292, dwell_s: 40, cruise: 45 },
    { name: 'Madhavaram', lat: 13.1482, lng: 80.231, cruise: 55 },
    { name: 'Red Hills', lat: 13.1865, lng: 80.1999, cruise: 60 },
  ],
};

// Road loop for bench boards (BENCH_TRUCKS): a real device that cannot move is placed along
// this loop by its own reported speed. An area the simulated trucks do not drive.
export const benchWaypoints = [
  { name: 'Avadi', lat: 13.1147, lng: 80.1098 },
  { name: 'Thiruninravur', lat: 13.1155, lng: 80.0264 },
  { name: 'Thirumazhisai', lat: 13.0526, lng: 80.06 },
];

// Each stop carries the road path of the leg that leaves it (`path`: [[lat, lng], ...] and
// `cum`: metres along it), and sits where that path starts, i.e. on the road.
function withRoads(stops, legs) {
  return stops.map((stop, i) => {
    const path = legs[i].path;
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + haversine(path[k - 1][0], path[k - 1][1], path[k][0], path[k][1]));
    return { ...stop, lat: path[0][0], lng: path[0][1], path, cum };
  });
}

const ROADS = new URL('./roadRoutes.json', import.meta.url);

// The stored road file, or null when it is missing or unreadable (the build script rewrites it).
function readRoads() {
  if (!existsSync(ROADS)) {
    console.error('[sim] sim/roadRoutes.json is missing; run node sim/buildRoadRoutes.mjs');
    return null;
  }
  try {
    return JSON.parse(readFileSync(ROADS, 'utf8'));
  } catch (err) {
    console.error(`[sim] sim/roadRoutes.json is unreadable (${err.message}); run node sim/buildRoadRoutes.mjs`);
    return null;
  }
}
const ROAD_FILE = readRoads();

function loadRoutes() {
  if (!ROAD_FILE?.trucks) return waypoints;
  const roads = ROAD_FILE.trucks;
  const out = {};
  for (const [id, stops] of Object.entries(waypoints)) {
    const legs = roads[id];
    if (!legs || legs.length !== stops.length || legs.some((l, i) => l.from !== stops[i].name)) {
      console.error(`[sim] road paths for ${id} do not match its stops; run node sim/buildRoadRoutes.mjs`);
      out[id] = stops;
      continue;
    }
    out[id] = withRoads(stops, legs);
  }
  return out;
}

export const routes = loadRoutes();

// The bench loop as one closed road path ({ path, cum } in metres), or null if not built yet.
function loadBenchLoop() {
  const legs = ROAD_FILE?.bench;
  if (!legs || legs.length !== benchWaypoints.length || legs.some((l, i) => l.from !== benchWaypoints[i].name)) {
    console.error('[sim] bench road loop is missing or stale; run node sim/buildRoadRoutes.mjs');
    return null;
  }
  const path = legs.flatMap((l, i) => (i === 0 ? l.path : l.path.slice(1)));
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + haversine(path[k - 1][0], path[k - 1][1], path[k][0], path[k][1]));
  return { path, cum };
}

export const benchLoop = loadBenchLoop();
