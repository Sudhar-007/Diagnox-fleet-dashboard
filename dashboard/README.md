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

Or run the server in Docker instead of terminal 1:

```sh
docker compose up --build    # same port 4000, DATA_SOURCE=mock unless set
```

Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env` to change settings.

## Deploy

Backend (Render, Docker): `render.yaml` at the repo root is a Render Blueprint.
Create it from the Render dashboard (New > Blueprint > this repo). It builds `dashboard/server/Dockerfile`
and runs a single instance with health check `/api/health`. Render asks for `CORS_ORIGINS` when the Blueprint
is created; set it to the Vercel URLs, e.g.
`https://<project>.vercel.app,https://<project>-*-<vercel-team>.vercel.app,http://localhost:5173`.
Keeping the team slug in the preview pattern stops other Vercel accounts' projects from matching.
The server logs the allowed origins at startup; check them in the Render logs after the first deploy.
Set `TELEMETRY_API_KEY` in the Render dashboard (Environment) to accept device data; without it
`POST /api/telemetry` answers 503.
Run exactly one instance: all state is in memory.

Frontend (Vercel): import the repo, set Root Directory to `dashboard/client` (framework Vite is detected),
and set `VITE_API_URL` to the Render service URL (`https://<service>.onrender.com`, no trailing slash) for both
Production and Preview. The value is baked in at build time, so redeploy after changing it.
`vercel.json` rewrites every path to `index.html` so deep links survive a refresh.

Free Render instances sleep when idle, take a while to wake, and lose all in-memory state (history, alerts, trips)
when they do; the simulator refills live data within seconds. Switch the plan to Starter before demo day.

## Tests

```sh
cd server && npm test
cd client && npm run build
```

## Endpoints so far

- `GET /api/health`: data source, uptime, truck count
- `POST /api/telemetry`: the truck device pushes one point or an array (header `x-api-key`, see `docs/interface.md`)
- `GET /api/trucks`: latest point per truck plus derived `status`, `health`, `findings`, `freshness`, `provenance`
- `GET /api/trucks/:truck_id/history?from&to`: raw points (`from`/`to` as contract timestamps or epoch ms)
- Socket.IO `truck:update`: contract payload with the same derived fields
