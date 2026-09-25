// Seed zones for first boot; afterwards the fleet manager edits them in Settings.
// Circles only.
//   type       'allowed': a breach is being outside it; 'restricted': being inside it
//   alert      whether a breach raises an alert (entries and exits are logged either way)
//   truck_ids  trucks the zone applies to; empty means every truck
// The depot and port are on normal routes, so they only log visits. The restricted zone
// sits about 400 m clear of every simulated route: only the breach scenario enters it.

export const geofences = [
  {
    id: 'Z-depot',
    name: 'Ennore depot',
    center_lat: 13.2146,
    center_lng: 80.3203,
    radius_m: 600,
    type: 'allowed',
    alert: false,
    truck_ids: [],
  },
  {
    id: 'Z-port',
    name: 'Chennai Port',
    center_lat: 13.096,
    center_lng: 80.292,
    radius_m: 1000,
    type: 'allowed',
    alert: false,
    truck_ids: [],
  },
  {
    id: 'Z-kodungaiyur',
    name: 'Kodungaiyur dump yard',
    center_lat: 13.1343,
    center_lng: 80.2599,
    radius_m: 500,
    type: 'restricted',
    alert: true,
    truck_ids: [],
  },
];
