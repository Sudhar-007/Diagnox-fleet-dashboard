// The only place the backend URL is read. In local dev it defaults to the local BFF.
const configured = import.meta.env.VITE_API_URL;

export const API_URL = (configured || (import.meta.env.DEV ? 'http://localhost:4000' : '')).replace(/\/$/, '');

// An HTTPS page can only reach an HTTPS backend; http would be blocked as mixed content.
export const API_URL_PROBLEM = !API_URL
  ? 'missing'
  : window.location.protocol === 'https:' && !API_URL.startsWith('https://')
    ? 'insecure'
    : null;

export const REQUEST_TIMEOUT_MS = 5000;
