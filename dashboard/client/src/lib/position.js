// A usable GPS fix: finite, in range, and not exactly 0,0 (the usual "no fix" placeholder).
export function isValidPosition(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}
