# Hardware <-> Software Interface

## Hops
1. ESP32-WROOM + EC200U (4G) + GPS + OBD-II -> FastAPI (HTTP over 4G). Owned by hardware teammate.
2. FastAPI -> dashboard BFF (PLANNED, not implemented yet): BFF polls `GET {FASTAPI_URL}/latest` every 1 s over HTTPS, 3 s timeout. Response assumed to be a JSON array of telemetry objects (shape not final; all mapping lives in `dashboard/server/services/source.js`). Today `DATA_SOURCE=fastapi|hybrid` logs a warning and falls back to the built-in simulator (`DATA_SOURCE=mock`, provenance `SIM`); `FASTAPI_URL` is not read by any code yet.
3. BFF -> React (BFF default port 4000, `PORT`):
   - REST: `GET /api/trucks` (`{ server_time, freshness, health_rules, trucks[] }`), `GET /api/trucks/:truck_id/history?from=&to=&limit=` (`{ truck_id, points[] }`, raw telemetry objects ascending; `from`/`to` are epoch ms or contract timestamps; `limit` (positive integer, max 5000) keeps the newest N points; other values are ignored), `GET /api/health`, `GET /api/alerts?status=ACTIVE|ACKNOWLEDGED|RESOLVED|open&truck_id=` (`{ alerts[] }`, newest first), `GET /api/alerts/events?limit=` (`{ events[] }`, newest first), `PATCH /api/alerts/:id` with `{ status: "ACKNOWLEDGED"|"RESOLVED", note?, by? }` (returns `{ alert, event }`).
   - Socket.IO: `truck:update` (one derived truck object per new point, plus `server_time`). `alert:new` / `alert:update` (`{ alert, event }`; `alert.version` increases on every change). PLANNED, not emitted yet: `pipeline:status`.
   - Derived truck objects carry every contract field verbatim and add only: `status`, `health`, `findings`, `freshness`, `provenance`, `driver_id`, `driver_name`, `received_at` (epoch ms), `last_seen_s`, `optional_fields` (names of optional fields present).

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

Optional (auto-detected when present). Today they are only passed through verbatim and listed in `optional_fields`; the behaviour in the "meaning" column is PLANNED, not implemented:
| field | type | meaning |
|---|---|---|
| `fuel_level` | number | 0 to 100 %, replaces the fuel estimate |
| `sos` | bool | hardware panic button; `true` raises SOS |
| `maintenance_risk_score` | number | 0 to 100, ML model output |

## Rules
- Nominal rate 1 Hz per truck. Points are deduplicated by (`truck_id`, `timestamp`), comparing the exact `timestamp` string. Points with no `truck_id` or an unparseable `timestamp` are dropped.
- Truck is `stale` after 15 s without an update, `offline` after 60 s (measured on BFF receive time).
- Driver mapping and tank capacity are BFF config (`dashboard/server/config/fleet.js`), not part of the telemetry.
