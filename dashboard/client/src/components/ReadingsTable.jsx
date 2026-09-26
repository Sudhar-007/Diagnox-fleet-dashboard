import { Link } from 'react-router-dom';

import Plate from './Plate.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import StatusBadge from './StatusBadge.jsx';
import { EmptyState } from './ui/Panel.jsx';

// Contract fields exactly as the latest telemetry point carried them, one row per truck.
const COLUMNS = [
  { field: 'latitude', label: 'Latitude', digits: 5 },
  { field: 'longitude', label: 'Longitude', digits: 5 },
  { field: 'speed', label: 'Speed', unit: 'km/h', digits: 0 },
  { field: 'rpm', label: 'RPM', digits: 0 },
  { field: 'engine_load', label: 'Load', unit: '%', digits: 0 },
  { field: 'coolant_temp', label: 'Coolant', unit: '°C', digits: 1 },
  { field: 'oil_temp', label: 'Oil', unit: '°C', digits: 1 },
  { field: 'battery_voltage', label: 'Battery', unit: 'V', digits: 2 },
];

export default function ReadingsTable({ rows }) {
  if (rows.length === 0) return <EmptyState>No trucks have reported yet.</EmptyState>;
  return (
    <table className="w-full min-w-[1040px] text-left text-sm tabular-nums">
      <thead className="border-b border-line">
        <tr>
          <th className="px-4 py-2">truck_id</th>
          <th className="px-3 py-2">timestamp</th>
          {COLUMNS.map((c) => (
            <th key={c.field} className="px-3 py-2 text-right" title={c.field}>
              {c.label}
              {c.unit && <span className="font-normal text-muted"> {c.unit}</span>}
            </th>
          ))}
          <th className="px-3 py-2">Status</th>
          <th className="px-4 py-2">Source</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => {
          const t = row.truck;
          const levelOf = (field) => (t.findings ?? []).find((f) => f.field === field)?.level;
          return (
            <tr key={t.truck_id} className={row.sos ? 'bg-crit/5' : ''}>
              <td className="px-4 py-2">
                <Link to={`/vehicles/${encodeURIComponent(t.truck_id)}`} aria-label={`Open ${t.truck_id}`}>
                  <Plate truckId={t.truck_id} size="sm" />
                </Link>
              </td>
              <td className={`px-3 py-2 whitespace-nowrap ${row.silent ? 'text-idle' : 'text-muted'}`}>
                {t.timestamp?.replace('T', ' ') ?? '-'}
              </td>
              {COLUMNS.map((c) => {
                const v = t[c.field];
                const level = levelOf(c.field);
                const tone = level === 'critical' ? 'font-medium text-crit' : level === 'warning' ? 'font-medium text-warn' : row.silent ? 'text-muted' : 'text-ink';
                return (
                  <td key={c.field} className={`px-3 py-2 text-right whitespace-nowrap ${tone}`}>
                    {typeof v === 'number' ? v.toFixed(c.digits) : <span className="text-faint">null</span>}
                  </td>
                );
              })}
              <td className="px-3 py-2">
                <StatusBadge status={row.status} sos={Boolean(row.sos)} />
              </td>
              <td className="px-4 py-2">
                <ProvenanceBadge kind={t.provenance} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
