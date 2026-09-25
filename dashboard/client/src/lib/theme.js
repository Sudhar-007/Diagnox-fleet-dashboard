// Theme colours as concrete values, for libraries that write them into SVG attributes
// (where CSS variables do not resolve). Tokens are defined once in index.css.
const cache = new Map();

export function themeColor(token) {
  if (!cache.has(token)) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim();
    cache.set(token, value || '#888888');
  }
  return cache.get(token);
}
