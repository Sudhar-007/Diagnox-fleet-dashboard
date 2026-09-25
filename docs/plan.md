# Plan

Dashboard (React client on Vercel + Express BFF in Docker). Each step must leave a working demo. Redeploy after every step.

- [x] 1. Simulator + BFF + Socket.IO + Dashboard grid updating live (local, DATA_SOURCE=mock)
- [x] 2. Deploy skeleton: server Dockerfile + docker-compose, client vercel.json; verify Vercel URL gets live updates over WSS
- [x] 3. Live Map: markers, trails, OSM tiles, dashboard mini-map
- [x] 4. Health rules + alert engine + Alerts page (acknowledge / resolve with notes)
- [x] 5. SOS lifecycle + global SOS banner + Scenario panel + Pipeline strip
- [ ] 6. Vehicle list + Vehicle Details tabs (Health, Maintenance risk breakdown) + Maintenance board
- [ ] 7. Geofencing: engine + map overlay + Settings (Geofences, Alert Thresholds)
- [ ] 8. Trips derivation + Trips page + Replay
- [ ] 9. Driver behaviour events + scores + Drivers page
- [ ] 10. Fuel estimate + anomalies + Fuel page + Vehicle Fuel tab
- [ ] 11. Analytics page (computed from ring buffer + engine outputs)
- [ ] 12. `fastapi` / `hybrid` source wiring against the real public FastAPI endpoint (validate/coerce numeric fields in source.js; strip incoming keys that collide with derived fields; evaluate every ingested point in time order, not only the newest per batch, so a backlog uploaded after a 4G outage still raises its alerts and SOS; coerce `sos` to a real boolean; confirm with hardware where `speed` comes from and whether it reads 0 on GPS/OBD dropouts, since one such sample could look like a collision)

If time runs out, simplify 9 to 11 first. Never cut 1 to 5.
