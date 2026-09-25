import { API_URL, REQUEST_TIMEOUT_MS } from '../config.js';

// JSON request with a timeout. Throws an Error whose message is safe to show.
export async function sendJson(path, method, body) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'The server did not respond in time. Try again.' : 'Could not reach the server. Try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? `Not saved: ${data.error}.` : `Not saved: the server answered ${res.status}.`);
  return data;
}

// The name a viewer last signed actions with. Per-browser convenience only.
const NAME_KEY = 'fleet.handlerName';
export function rememberedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function rememberName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage unavailable (private mode): nothing to remember
  }
}

// A signal that aborts after the request timeout or when `parent` aborts.
// (AbortSignal.any is too new for some browsers.) Call done() when finished.
export function timeoutSignal(parent) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  const onParent = () => ctrl.abort(parent.reason);
  parent?.addEventListener('abort', onParent, { once: true });
  return {
    signal: ctrl.signal,
    done() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParent);
    },
  };
}
