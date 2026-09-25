import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';

export const PROVENANCE = { SIM: 'SIM', LIVE_HW: 'LIVE_HW' };

// The only module that knows where telemetry comes from.
// mock: built-in simulator. fastapi / hybrid: wired in a later step; until then they fall back to mock.
export function createSource({ mode = 'mock', onPoints, log = console }) {
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
      sim.start((points) => onPoints(points, PROVENANCE.SIM));
    },
    stop() {
      sim.stop();
    },
  };
}
