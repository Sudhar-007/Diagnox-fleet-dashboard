// Static fleet config. The telemetry contract has no driver or tank fields, so they live here.

export const DEFAULT_TANK_CAPACITY_L = 300;

export const fleet = [
  { truck_id: 'TN01', driver_id: 'D01', driver_name: 'Ravi Kumar', tank_capacity_l: DEFAULT_TANK_CAPACITY_L },
  { truck_id: 'TN02', driver_id: 'D02', driver_name: 'Suresh Babu', tank_capacity_l: DEFAULT_TANK_CAPACITY_L },
  { truck_id: 'TN03', driver_id: 'D03', driver_name: 'Arun Prakash', tank_capacity_l: DEFAULT_TANK_CAPACITY_L },
  { truck_id: 'TN04', driver_id: 'D04', driver_name: 'Karthik Raja', tank_capacity_l: DEFAULT_TANK_CAPACITY_L },
  { truck_id: 'TN05', driver_id: 'D05', driver_name: 'Muthu Selvan', tank_capacity_l: DEFAULT_TANK_CAPACITY_L },
];

export function fleetEntry(truck_id) {
  return (
    fleet.find((t) => t.truck_id === truck_id) ?? {
      truck_id,
      driver_id: null,
      driver_name: 'Unassigned',
      tank_capacity_l: DEFAULT_TANK_CAPACITY_L,
    }
  );
}
