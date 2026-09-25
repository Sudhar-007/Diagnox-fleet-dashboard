// CORS_ORIGINS is a comma separated list; "*" inside an entry matches one subdomain label.
export function parseOrigins(value = '') {
  return value
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((entry) => {
      if (!entry.includes('*')) return entry;
      const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+');
      return new RegExp(`^${escaped}$`, 'i');
    });
}

export function originChecker(allowed) {
  return (origin, cb) => {
    // Requests without an Origin header (curl, health checks) are not browser cross-origin calls.
    if (!origin) return cb(null, true);
    const ok = allowed.some((a) => (a instanceof RegExp ? a.test(origin) : a === origin));
    cb(null, ok);
  };
}
