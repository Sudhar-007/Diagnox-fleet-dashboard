// Plain-words helpers for geofence zones.

export const zoneScope = (zone) => (zone.truck_ids.length === 0 ? 'All trucks' : zone.truck_ids.join(', '));

export function zoneRule(zone) {
  if (!zone.alert) return 'Visits logged, no alerts';
  return zone.type === 'restricted' ? 'Alert when a truck is inside' : 'Alert when a truck is outside';
}
