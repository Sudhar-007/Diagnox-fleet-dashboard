import { NavLink, Outlet } from 'react-router-dom';

import ConnectionNotice from './ConnectionNotice.jsx';
import SOSBanner from './SOSBanner.jsx';
import ScenarioPanel from './ScenarioPanel.jsx';
import Toaster from './ui/Toaster.jsx';
import { useFleetStore } from '../store/useFleetStore.js';

// Monitoring first (what is happening now), then the records the manager keeps, then reports.
const NAV = [
  {
    group: 'Monitor',
    items: [
      { to: '/', label: 'Overview', end: true },
      { to: '/live', label: 'Live map' },
      { to: '/alerts', label: 'Alerts & SOS', badge: 'alerts' },
    ],
  },
  {
    group: 'Fleet',
    items: [
      { to: '/vehicles', label: 'Vehicles' },
      { to: '/drivers', label: 'Drivers' },
      { to: '/trips', label: 'Trips' },
      { to: '/maintenance', label: 'Maintenance' },
      { to: '/fuel', label: 'Fuel' },
    ],
  },
  {
    group: 'Reports',
    items: [{ to: '/analytics', label: 'Analytics' }],
  },
];

// Count of alerts nobody has acknowledged yet; red when any of them is critical or an SOS.
function UnacknowledgedCount() {
  const alerts = useFleetStore((s) => s.alerts);
  let count = 0;
  let critical = false;
  for (const a of Object.values(alerts)) {
    if (a.status !== 'ACTIVE') continue;
    count += 1;
    if (a.level === 'critical' || a.kind === 'sos') critical = true;
  }
  if (count === 0) return null;
  return (
    <span
      className={`ml-auto min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold text-white ${critical ? 'bg-crit' : 'bg-warn'}`}
      aria-label={`${count} unacknowledged`}
    >
      {count}
    </span>
  );
}

function Clock() {
  const now = useFleetStore((s) => s.now);
  const d = new Date(now);
  const time = d.toLocaleTimeString('en-GB', { hour12: false });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <span className="shrink-0 text-[13px] whitespace-nowrap text-muted">
      {date} <span className="text-ink">{time}</span>
    </span>
  );
}

function NavItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `relative flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors md:py-2 ${
          isActive
            ? 'bg-accent/8 font-semibold text-accent before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-r before:bg-accent'
            : 'font-medium text-[#3d4652] hover:bg-subtle hover:text-ink'
        }`
      }
    >
      {item.label}
      {item.badge === 'alerts' && <UnacknowledgedCount />}
    </NavLink>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[216px_1fr]">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r md:border-b-0">
        <div className="flex h-13 flex-col justify-center px-4 md:border-b md:border-line">
          <img src="/diagnox-wordmark.png" alt="DiagnoX" width="113" height="18" className="h-[18px] w-auto self-start" />
          <span className="mt-0.5 pl-px font-display text-[11px] leading-none font-semibold tracking-[0.02em] text-muted">Dashboard</span>
        </div>
        <nav
          aria-label="Main"
          className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto md:pt-3 md:pb-3"
        >
          {NAV.map((g, i) => (
            <div
              key={g.group}
              className={`flex shrink-0 gap-1 md:flex-col md:gap-0.5 ${i > 0 ? 'md:mt-3 md:border-t md:border-line md:pt-3' : ''}`}
            >
              <p className="hidden px-3 pt-0.5 pb-1.5 font-display text-[12.5px] font-bold tracking-tight text-ink md:block">
                {g.group}
              </p>
              {g.items.map((item) => (
                <NavItem key={item.to} item={item} />
              ))}
            </div>
          ))}
          <div className="flex shrink-0 md:hidden">
            <NavItem item={{ to: '/settings', label: 'Settings' }} />
          </div>
        </nav>
        <div className="hidden border-t border-line p-3 md:block">
          <NavItem item={{ to: '/settings', label: 'Settings' }} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-[1050] flex h-13 items-center justify-between gap-4 border-b border-line bg-surface px-4 md:px-6">
          <ConnectionNotice />
          <Clock />
        </header>
        <SOSBanner />
        <main className="px-4 py-5 md:px-6 md:py-6">
          <Outlet />
        </main>
        <ScenarioPanel />
        <Toaster />
      </div>
    </div>
  );
}
