# Fleet Command dashboard

React client (Vercel) and Express BFF (single Docker container) for live fleet telemetry.
The telemetry contract is in `../docs/interface.md`; every threshold is in `server/config/rules.js`.

## Run locally (no network needed)

```sh
# terminal 1
cd server
npm install
npm run dev            # http://localhost:4000, DATA_SOURCE=mock by default

# terminal 2
cd client
npm install
npm run dev            # http://localhost:5173
```

Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env` to change settings.

## Tests

```sh
cd server && npm test
cd client && npm run build
```

## Endpoints so far

- `GET /api/health`: data source, uptime, truck count
- `GET /api/trucks`: latest point per truck plus derived `status`, `health`, `findings`, `freshness`, `provenance`
- `GET /api/trucks/:truck_id/history?from&to`: raw points (`from`/`to` as contract timestamps or epoch ms)
- Socket.IO `truck:update`: contract payload with the same derived fields
