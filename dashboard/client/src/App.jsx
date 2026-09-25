import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import LiveMap from './pages/LiveMap.jsx';
import Alerts from './pages/Alerts.jsx';
import Vehicles from './pages/Vehicles.jsx';
import VehicleDetails from './pages/VehicleDetails.jsx';
import Maintenance from './pages/Maintenance.jsx';
import Settings from './pages/Settings.jsx';
import Trips from './pages/Trips.jsx';
import Drivers from './pages/Drivers.jsx';
import Fuel from './pages/Fuel.jsx';
import Analytics from './pages/Analytics.jsx';
import { API_URL, API_URL_PROBLEM } from './config.js';
import { useSocket } from './hooks/useSocket.js';

function ConfigProblem({ problem }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-[15px]">
      <h1 className="font-cond text-2xl font-bold">
        {problem === 'missing' ? 'Backend URL not set' : 'Backend URL must use HTTPS'}
      </h1>
      <p className="mt-2 text-muted">
        {problem === 'missing' ? (
          <>
            This build has no <code className="text-ink">VITE_API_URL</code>.
          </>
        ) : (
          <>
            This build points at <code className="text-ink">{API_URL}</code>, which browsers block on an HTTPS page.
          </>
        )}{' '}
        Set <code className="text-ink">VITE_API_URL</code> to the fleet server's https:// URL for both Production and
        Preview in the hosting project's environment variables, then redeploy.
      </p>
    </main>
  );
}

function Connected() {
  useSocket();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="live" element={<LiveMap />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="vehicles/:truckId" element={<VehicleDetails />} />
        <Route path="trips" element={<Trips />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="fuel" element={<Fuel />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return <p className="text-muted">This page doesn't exist. Use the menu to pick a page.</p>;
}

export default function App() {
  return API_URL_PROBLEM ? <ConfigProblem problem={API_URL_PROBLEM} /> : <Connected />;
}
