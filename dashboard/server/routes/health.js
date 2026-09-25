import { Router } from 'express';

export function healthRouter({ source, fleet, startedAt }) {
  const r = Router();

  r.get('/health', (req, res) => {
    res.json({
      ok: true,
      data_source: source.mode(),
      requested_data_source: source.requestedMode(),
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      trucks: fleet.snapshot().length,
      server_time: Date.now(),
    });
  });

  return r;
}
