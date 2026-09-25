import { NavLink, Outlet } from 'react-router-dom';

import PipelineStrip from './PipelineStrip.jsx';
import SOSBanner from './SOSBanner.jsx';
import ScenarioPanel from './ScenarioPanel.jsx';
import { useFleetStore } from '../store/useFleetStore.js';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/live', label: 'Live Map' },
  { to: '/alerts', label: 'Alerts & SOS', badge: 'alerts' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/trips', label: 'Trips' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/fuel', label: 'Fuel' },
  { to: '/maintenance', label: 'Maintenance' },
  { to: '/settings', label: 'Settings' },
];

// Count of alerts nobody has acknowledged yet; red when any of them is critical.
function UnacknowledgedCount() {
  const alerts = useFleetStore((s) => s.alerts);
  let count = 0;
  let critical = false;
  for (const a of Object.values(alerts)) {
    if (a.status !== 'ACTIVE') continue;
    count += 1;
    if (a.level === 'critical') critical = true;
  }
  if (count === 0) return null;
  return (
    <span
      className={`ml-auto rounded-full px-1.5 text-xs font-semibold leading-5 ${critical ? 'bg-crit text-white' : 'bg-warn text-asphalt'}`}
      aria-label={`${count} unacknowledged`}
    >
      {count}
    </span>
  );
}

function Clock() {
  const now = useFleetStore((s) => s.now);
  const time = new Date(now).toLocaleTimeString('en-GB', { hour12: false });
  return <span className="text-sm text-muted">{time}</span>;
}

export default function Layout() {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[208px_1fr]">
      <aside className="border-b border-line bg-panel md:min-h-screen md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span aria-hidden className="h-3 w-5 rounded-[2px] border border-plate-ink/70 bg-plate" />
          <span className="font-cond text-lg font-bold tracking-wide">Fleet Command</span>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:gap-0.5 md:overflow-visible">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 rounded-[4px] px-3 py-1.5 text-[15px] ${
                  isActive ? 'bg-panel-hi font-medium text-ink' : 'text-muted hover:bg-panel-hi/60 hover:text-ink'
                }`
              }
            >
              {item.label}
              {item.badge === 'alerts' && <UnacknowledgedCount />}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="flex h-12 items-center justify-between gap-4 border-b border-line px-4 md:px-6">
          <PipelineStrip />
          <Clock />
        </header>
        <SOSBanner />
        <main className="px-4 py-5 md:px-6">
          <Outlet />
        </main>
        <ScenarioPanel />
      </div>
    </div>
  );
}
