# Plan

Dashboard (React client on Vercel + Express BFF in Docker). Each step must leave a working demo. Redeploy after every step.

- [x] 1. Simulator + BFF + Socket.IO + Dashboard grid updating live (local, DATA_SOURCE=mock)
- [ ] 2. Deploy skeleton: server Dockerfile + docker-compose, client vercel.json; verify Vercel URL gets live updates over WSS
- [ ] 3. Live Map: markers, trails, OSM tiles, dashboard mini-map
- [ ] 4. Health rules + alert engine + global banner + Alerts page
- [ ] 5. SOS lifecycle + Scenario panel + Pipeline strip
- [ ] 6. Vehicle list + Vehicle Details tabs (Health, Maintenance risk breakdown) + Maintenance board
- [ ] 7. Geofencing: engine + map overlay + Settings (Geofences, Alert Thresholds)
- [ ] 8. Trips derivation + Trips page + Replay
- [ ] 9. Driver behaviour events + scores + Drivers page
- [ ] 10. Fuel estimate + anomalies + Fuel page + Vehicle Fuel tab
- [ ] 11. Analytics page (computed from ring buffer + engine outputs)
- [ ] 12. `fastapi` / `hybrid` source wiring against the real public FastAPI endpoint (validate/coerce numeric fields in source.js; strip incoming keys that collide with derived fields)

If time runs out, simplify 9 to 11 first. Never cut 1 to 5.
