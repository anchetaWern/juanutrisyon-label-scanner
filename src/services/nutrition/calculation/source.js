// API records are JSON data. Copy by enumeration so Vue reactive records also work;
// structuredClone rejects Proxy objects. Calculations never modify source records.
export function copySource(value) {
  if (Array.isArray(value)) return value.map(copySource);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copySource(item)]));
  }
  return value;
}
