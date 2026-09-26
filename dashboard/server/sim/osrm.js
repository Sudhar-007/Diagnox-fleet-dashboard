// Road routing through an OSRM server (OpenStreetMap data). Used by the route build script and
// by the geofence-breach demo, never on the telemetry path.

const DEFAULT_URL = 'https://router.project-osrm.org';

// Road path from `from` to `to` ([lat, lng] each) as [[lat, lng], ...], rounded to ~1 m.
// Throws when the service is unreachable, slow (timeoutMs) or finds no route.
export async function fetchRoadPath(from, to, { timeoutMs = 5000, baseUrl = process.env.OSRM_URL || DEFAULT_URL } = {}) {
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `${baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`routing service answered ${res.status}`);
  const body = await res.json();
  const line = body.routes?.[0]?.geometry?.coordinates;
  if (body.code !== 'Ok' || !Array.isArray(line) || line.length < 2) throw new Error(`no road route (${body.code ?? 'unknown'})`);
  const path = [];
  for (const [lng, lat] of line) {
    const p = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5];
    const last = path[path.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) path.push(p);
  }
  if (path.length < 2) throw new Error('road route too short');
  return path;
}
