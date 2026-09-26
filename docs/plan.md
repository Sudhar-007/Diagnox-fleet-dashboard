# Plan

Dashboard (React client on Vercel + Express BFF in Docker). Each step must leave a working demo. Redeploy after every step.

- [x] 1. Simulator + BFF + Socket.IO + Dashboard grid updating live (local, DATA_SOURCE=mock)
- [x] 2. Deploy skeleton: server Dockerfile + docker-compose, client vercel.json; verify Vercel URL gets live updates over WSS
- [x] 3. Live Map: markers, trails, OSM tiles, dashboard mini-map
- [x] 4. Health rules + alert engine + Alerts page (acknowledge / resolve with notes)
- [x] 5. SOS lifecycle + global SOS banner + Scenario panel + Pipeline strip
- [x] 6. Vehicle list + Vehicle Details tabs (Health, Maintenance risk breakdown) + Maintenance board
- [x] 7. Geofencing: engine + map overlay + Settings (Geofences, Alert Thresholds)
- [x] 8. Trips derivation + Trips page + Replay
- [x] 9. Driver behaviour events + scores + Drivers page
- [x] 10. Fuel estimate + anomalies + Fuel page + Vehicle Fuel tab
- [x] 11. Analytics page (computed from ring buffer + engine outputs)
- [x] 11b. Maintenance model in the BFF: random forest from `ml/` exported to JSON and scored in Node (`ml_risk`, 60 s mean, engine running only; a device-sent `maintenance_risk_score` wins), parity test against sklearn, ML score on Vehicle Maintenance tab and Maintenance board
- [ ] 12. Device push instead of FastAPI polling: `POST /api/telemetry` with `x-api-key` (`TELEMETRY_API_KEY`), one point or a backlog array, validated and coerced (numbers, `sos` boolean, contract fields only), every point judged in time order; `DATA_SOURCE` mock / hybrid / device; simulated points dropped for a truck id the device uses. Still to confirm with hardware: where `speed` comes from and whether it reads 0 on GPS/OBD dropouts (one such sample could look like a collision); if GPS speed, the parked-truck reading for `rules.trips.stop_speed_kmh`. Done when the real device shows up as LIVE HW on the deployed dashboard
- [x] 13. Light-theme redesign (shared design system, Overview/Vehicles/Details rework, search and filters, confirmations), Sora + Inter fonts, DiagnoX branding and favicon; simulated trucks drive OSRM road paths (stored, no runtime routing) and the geofence-breach demo takes a road detour; bench boards (`BENCH_TRUCKS`) are placed on a road loop by their reported speed

If time runs out, simplify 9 to 11 first. Never cut 1 to 5.
