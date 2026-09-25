import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { API_CONFIGURED } from './config.js';
import { useSocket } from './hooks/useSocket.js';

function MissingConfig() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-[15px]">
      <h1 className="font-cond text-2xl font-bold">Backend URL not set</h1>
      <p className="mt-2 text-muted">
        This build has no <code className="text-ink">VITE_API_URL</code>. Set it to the fleet server's HTTPS URL in the
        hosting project's environment variables and redeploy.
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
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return <p className="text-muted">This page doesn't exist. Use the menu to pick a page.</p>;
}

export default function App() {
  return API_CONFIGURED ? <Connected /> : <MissingConfig />;
}
