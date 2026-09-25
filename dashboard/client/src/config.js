// The only place the backend URL is read. In local dev it defaults to the local BFF.
const configured = import.meta.env.VITE_API_URL;

export const API_URL = (configured || (import.meta.env.DEV ? 'http://localhost:4000' : '')).replace(/\/$/, '');

export const API_CONFIGURED = API_URL !== '';

export const REQUEST_TIMEOUT_MS = 5000;
