// Reads the server's ml_risk summary: { score, source: device|model, state, readings, window_s }.

export function mlBadgeKind(truck) {
  return truck?.ml_risk?.source === 'device' ? truck.provenance : 'ML_MODEL';
}

// Short text for when there is no score to show.
export function mlMissingText(ml) {
  if (!ml || ml.state === 'no_model') return 'Not connected';
  if (ml.state === 'engine_off') return 'Engine off';
  return 'No readings';
}
