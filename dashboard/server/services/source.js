import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';

export const PROVENANCE = { SIM: 'SIM', LIVE_HW: 'LIVE_HW' };

// The only module that knows where telemetry comes from.
// mock: built-in simulator. fastapi / hybrid: wired in a later step; until then they fall back to mock.
// warmStartS: on start, the simulator first replays this many seconds of past driving as
// history (1 point per truck per second, sent with { backfill: true }), so trips and charts
// have data right after a restart. Simulated data only.
export function createSource({ mode = 'mock', onPoints, warmStartS = 0, log = console }) {
  const sim = createSimulator({ routes });
  let effectiveMode = mode;

  if (mode !== 'mock') {
    log.warn(`[source] DATA_SOURCE=${mode} is not wired yet, running mock`);
    effectiveMode = 'mock';
  }

  return {
    mode: () => effectiveMode,
    requestedMode: () => mode,
    sim,
    start() {
      if (warmStartS > 0) {
        const nowMs = Date.now();
        for (let s = warmStartS; s >= 1; s--) onPoints(sim.step(nowMs - s * 1000), PROVENANCE.SIM, { backfill: true });
        log.log(`[source] warm start: ${warmStartS} s of simulated history`);
      }
      sim.start((points) => onPoints(points, PROVENANCE.SIM));
    },
    stop() {
      sim.stop();
    },
  };
}
