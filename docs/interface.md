# Hardware <-> Software Interface

## Hops
1. ESP32-WROOM + EC200U (4G) + GPS + OBD-II -> FastAPI (HTTP over 4G). Owned by hardware teammate.
2. FastAPI -> dashboard BFF (PLANNED, not implemented yet): BFF polls `GET {FASTAPI_URL}/latest` every 1 s over HTTPS, 3 s timeout. Response assumed to be a JSON array of telemetry objects (shape not final; all mapping lives in `dashboard/server/services/source.js`). Today `DATA_SOURCE=fastapi|hybrid` logs a warning and falls back to the built-in simulator (`DATA_SOURCE=mock`, provenance `SIM`); `FASTAPI_URL` is not read by any code yet.
3. BFF -> React (BFF default port 4000, `PORT`):
   - REST: `GET /api/trucks` (`{ server_time, freshness, health_rules, trucks[] }`), `GET /api/trucks/:truck_id/history?from=&to=&limit=` (`{ truck_id, points[] }`, raw telemetry objects ascending; `from`/`to` are epoch ms or contract timestamps; `limit` (positive integer, max 5000) keeps the newest N points; other values are ignored), `GET /api/health` (`{ ok, data_source, requested_data_source, uptime_s, trucks, pipeline, server_time }`), `GET /api/alerts?status=ACTIVE|ACKNOWLEDGED|RESOLVED|open&truck_id=&kind=health|sos` (`{ alerts[] }`, newest first), `GET /api/alerts/events?limit=` (`{ events[] }`, newest first), `PATCH /api/alerts/:id` with `{ status: "ACKNOWLEDGED"|"RESOLVED", note?, by? }` (returns `{ alert, event }`), `POST /api/trucks/:truck_id/sos` with `{ note?, by? }` (manual SOS; returns `{ alert, event }`; 404 unknown truck, 409 if the truck already has an open SOS of any trigger), `PATCH /api/sos/:id` (same body and response as `PATCH /api/alerts/:id`; 404 if the id is not an SOS), fleet manager data: `GET /api/registry` (`{ trucks[], drivers[], service_types[], storage: { kind, persistent } }`; registry `truck_id`s are kept exactly as entered and matched to telemetry case-sensitively), `POST /api/registry/trucks`, `PUT /api/registry/trucks/:truck_id`, `DELETE /api/registry/trucks/:truck_id`, `POST /api/registry/drivers`, `GET /api/service-records?truck_id=`, `POST /api/service-records`, `DELETE /api/service-records/:id` (validation errors 400, conflicts 409, unknown ids 404), `GET /api/demo/scenarios` (`{ enabled, available[{ id, label, description, default_truck, duration_s }], running[] }`), `POST /api/demo/scenario` with `{ scenario, truck_id? }` (returns `{ run: { id, scenario, truck_id, started_ms, ends_ms }, running[] }`, where `run.id` is the scenario key and `run.scenario` its label; 403 when `DEMO_ENABLED=false`, 409 without the simulator, 400 unknown scenario or non-simulated truck). `pipeline` is `{ mode, hops[{ id: device|sim|bff, label, status: ok|degraded|down, detail }], latency_ms, server_time }` (`latency_ms` is null unless live hardware trucks are reporting).
   - Socket.IO: `truck:update` (one derived truck object per truck that received new points in a batch, built from that truck's newest point, plus `server_time`). `alert:new` / `alert:update` (`{ alert, event }`; `event` is null for condition-only updates; `alert.version` increases on every change). `registry:update` (no payload; reload `GET /api/registry`), `pipeline:status` (same shape as `/api/health` `pipeline`, every 2 s). Alerts have `kind: "health" | "sos"`; SOS carry `trigger: manual | hardware | collision` and the last known `latitude`/`longitude`/`location_at`.
   - Derived truck objects carry every contract field verbatim and add only: `status`, `health`, `findings`, `freshness`, `provenance`, `driver_id`, `driver_name`, `received_at` (epoch ms), `last_seen_s`, `optional_fields` (names of optional fields present), `registration`, `model`, `tank_capacity_l`, `in_registry` (from the fleet registry), `rule_risk_score` (0 to 100) and `risk_breakdown` (`[{ field, rule_name, op, threshold, unit, weight, exposure, intensity, breach_s, worst_value, points }]`, last `rules.risk.window_s` seconds).

The ESP32 never talks to the BFF directly. `FASTAPI_URL` must be a public HTTPS URL.

## Telemetry object (field names, types and casing are fixed)
| field | type | unit / format |
|---|---|---|
| `truck_id` | string | e.g. `"TN01"` |
| `timestamp` | string | ISO 8601, no TZ suffix, treated as local time, e.g. `"2026-09-10T10:00:00"` |
| `latitude` | float | WGS84 degrees |
| `longitude` | float | WGS84 degrees |
| `coolant_temp` | number | °C |
| `oil_temp` | number | °C |
| `battery_voltage` | number | V |
| `rpm` | int | rev/min |
| `engine_load` | number | 0 to 100 % |
| `speed` | number | km/h |

Optional (auto-detected when present, passed through verbatim and listed in `optional_fields`). `sos` is implemented; `fuel_level` and `maintenance_risk_score` behaviour is PLANNED:
| field | type | meaning |
|---|---|---|
| `fuel_level` | number | 0 to 100 %, replaces the fuel estimate |
| `sos` | bool | hardware panic button; `true` raises an SOS (one open SOS per truck; a person closes it) |
| `maintenance_risk_score` | number | 0 to 100, ML model output |

`sos` semantics (as implemented in `dashboard/server/services/alerts.js` `evaluateSos`):
- Only the JSON boolean `true` raises an SOS (strict `=== true`). `"true"`, `1`, `"1"` and `null` do not raise anything and log nothing; they are still passed through verbatim and `sos` still appears in `optional_fields`. `false` or omitting the field are equivalent.
- The flag is read from the truck's newest point only, once per ingest batch. A `sos: true` point that is not the newest point for its truck in a batch, arrives older than the stored latest point, or repeats an already-seen `timestamp` is never evaluated.
- One open SOS per truck, shared by all triggers (manual, hardware, collision). While any SOS is open for the truck, further `sos: true` points are ignored.
- The SOS stays open until a person resolves it. Only a change of `sos` to `true` raises one: a device that keeps sending `true` (latching button) raises a single SOS, and a new one only after it has sent a non-true value and then `true` again.
- A hardware SOS takes `opened_at` from the point's `timestamp` and its `latitude`/`longitude` from the same point.

## Rules
- Nominal rate 1 Hz per truck. Points are deduplicated by (`truck_id`, `timestamp`), comparing the exact `timestamp` string. Points with no `truck_id` or an unparseable `timestamp` are dropped. Points whose `timestamp` is more than 300 s ahead of the BFF clock are dropped (`rules.ingest.max_future_s`).
- Truck is `stale` after 15 s without an update, `offline` after 60 s (measured on BFF receive time).
- Driver mapping and tank capacity are BFF config (`dashboard/server/config/fleet.js`), not part of the telemetry.
