# Assumptions

Choices made where the spec left room. Each is isolated behind config so it can change without touching the rest.

| # | Assumption | Where |
|---|---|---|
| 1 | Freshness (stale > 15 s, offline > 60 s) is measured on BFF receive time, not the telemetry `timestamp`, so device clock drift cannot make a live truck look stale. | `server/services/fleet.js`, `server/config/rules.js` |
| 2 | Contract timestamps have no TZ suffix; the BFF interprets them in `TZ` (default `Asia/Kolkata`). | `server/.env.example` |
| 3 | Driver names and the truck to driver mapping are placeholders until the team provides real ones. | `server/config/fleet.js` |
| 4 | Each health rule reports only its highest level per field (a coolant reading of 112 shows "Coolant critical", not also "Coolant high"). | `server/engine/health.js` |
| 5 | The sustained engine-load rule needs data covering the full 60 s window with no gap over 5 s (`max_gap_s`); a dropout means it does not fire. | `server/engine/health.js` |
| 6 | Simulated routes are straight lines between real Chennai landmarks, not road-snapped. | `server/sim/routes.js` |
| 7 | Simulated trucks switch the engine off during long depot stops (>= 120 s) after 20 s of idling, so battery rules (engine running only) and trip end detection both get exercised. | `server/sim/simulator.js` |
| 8 | In local dev the client defaults to `http://localhost:4000` when `VITE_API_URL` is unset. Production builds require `VITE_API_URL` and show a setup message without it. | `client/src/config.js` |
| 9 | Until the FastAPI wiring step, `DATA_SOURCE=fastapi` or `hybrid` logs a warning and runs the simulator; `/api/health` reports both the requested and the effective source. | `server/services/source.js` |
| 10 | Requests with no `Origin` header (curl, container health checks) bypass the CORS allow-list; browsers always send one. | `server/services/cors.js` |
| 11 | Points stamped more than 300 s ahead of the BFF clock are dropped (`ingest.max_future_s`), so a device whose clock is not yet set cannot freeze its tile on a bogus future point. | `server/config/rules.js`, `server/services/store.js` |
| 12 | Battery rules fire only when the bad voltage holds for 10 s with the engine running (`sustain_s: 10`), so the 1 to 2 s dip while cranking is not an alert. Demo-tuned; to be confirmed with the hardware teammate. | `server/config/rules.js`, `server/engine/health.js` |
| 13 | "Held" means every reading in the window breaches; one reading back on the good side restarts the count. Readings missing the needed values are skipped (the gap limit still applies). "Engine running" is `rpm > 0` as specified, so an unusually long crank (over 10 s) could still raise a battery alert; a higher running-rpm cut-off needs a value from the hardware teammate. | `server/engine/health.js` |
