import { parseTs } from '../engine/time.js';

// Health of each hop the data passes through before reaching the browser.
// status: 'ok' | 'degraded' | 'down'. The browser adds its own "UI" hop (socket state).
//
// mock:    Simulator -> BFF
// fastapi: Device -> FastAPI -> BFF   (device/FastAPI hops are filled in when the real
// hybrid:  Device -> FastAPI -> BFF    source is wired; until then the source runs mock)
export function computePipeline({ mode, trucks, nowMs, startedAt }) {
  const hops = [];
  const reporting = (list) => list.filter((t) => t.freshness === 'live').length;
  const statusFor = (live, total) => (total === 0 || live === 0 ? 'down' : live < total ? 'degraded' : 'ok');

  const sim = trucks.filter((t) => t.provenance === 'SIM');
  const hw = trucks.filter((t) => t.provenance === 'LIVE_HW');

  if (mode === 'fastapi' || mode === 'hybrid') {
    const live = reporting(hw);
    hops.push({ id: 'device', label: 'Device', status: statusFor(live, hw.length), detail: `${live} of ${hw.length} hardware trucks reporting` });
  }
  if (mode === 'mock' || mode === 'hybrid') {
    const live = reporting(sim);
    hops.push({ id: 'sim', label: 'Simulator', status: statusFor(live, sim.length), detail: `${live} of ${sim.length} simulated trucks reporting` });
  }
  hops.push({ id: 'bff', label: 'BFF', status: 'ok', detail: `up ${Math.round((nowMs - startedAt) / 1000)} s` });

  // End-to-end latency is only meaningful for real hardware timestamps.
  const lags = hw
    .filter((t) => t.freshness === 'live')
    .map((t) => nowMs - parseTs(t.timestamp))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  const latency_ms = lags.length ? lags[Math.floor(lags.length / 2)] : null;

  return { mode, hops, latency_ms, server_time: nowMs };
}
