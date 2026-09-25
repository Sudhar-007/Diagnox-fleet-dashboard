import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';

export const PROVENANCE = { SIM: 'SIM', LIVE_HW: 'LIVE_HW' };

export const MODES = ['mock', 'hybrid', 'device'];

// The only module that knows where telemetry comes from.
// mock:   built-in simulator only; device pushes are refused.
// hybrid: simulator plus trucks pushing to POST /api/telemetry.
// device: only trucks pushing to POST /api/telemetry.
// warmStartS: on start, the simulator first replays this many seconds of past driving as
// history (1 point per truck per second, sent with { backfill: true }), so trips and charts
// have data right after a restart. Simulated data only.
export function createSource({ mode = 'mock', onPoints, warmStartS = 0, log = console }) {
  let effectiveMode = mode;
  if (!MODES.includes(mode)) {
    log.warn(`[source] unknown DATA_SOURCE=${mode}, running mock`);
    effectiveMode = 'mock';
  }
  const sim = effectiveMode === 'device' ? null : createSimulator({ routes });

  return {
    mode: () => effectiveMode,
    requestedMode: () => mode,
    acceptsDevice: () => effectiveMode !== 'mock',
    sim,
    start() {
      if (!sim) return;
      if (warmStartS > 0) {
        const nowMs = Date.now();
        for (let s = warmStartS; s >= 1; s--) onPoints(sim.step(nowMs - s * 1000), PROVENANCE.SIM, { backfill: true });
        log.log(`[source] warm start: ${warmStartS} s of simulated history`);
      }
      sim.start((points) => onPoints(points, PROVENANCE.SIM));
    },
    stop() {
      sim?.stop();
    },
  };
}
