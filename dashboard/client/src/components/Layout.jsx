import { NavLink, Outlet } from 'react-router-dom';

import ConnectionState from './ConnectionState.jsx';
import { useFleetStore } from '../store/useFleetStore.js';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/live', label: 'Live Map' },
];

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
                `shrink-0 rounded-[4px] px-3 py-1.5 text-[15px] ${
                  isActive ? 'bg-panel-hi font-medium text-ink' : 'text-muted hover:bg-panel-hi/60 hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="flex h-12 items-center justify-between gap-4 border-b border-line px-4 md:px-6">
          <ConnectionState />
          <Clock />
        </header>
        <main className="px-4 py-5 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
