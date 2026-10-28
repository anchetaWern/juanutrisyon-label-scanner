// Calculation precision stays intact; formatting belongs at the display boundary.
export function parseAmount(input) {
  if (input == null || (typeof input === 'string' && input.trim() === '')) {
    return { value: null, state: 'missing', reason: 'missing_amount' };
  }
  if (typeof input !== 'number' && (typeof input !== 'string' ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input.trim()))) {
    return { value: null, state: 'invalid', reason: 'malformed_amount' };
  }
  const value = Number(input);
  if (!Number.isFinite(value)) return { value: null, state: 'invalid', reason: 'non_finite_amount' };
  if (value < 0) return { value: null, state: 'invalid', reason: 'negative_amount' };
  return { value: value === 0 ? 0 : value, state: value === 0 ? 'explicit_zero' : 'known' };
}

export const isExact = result => ['known', 'explicit_zero'].includes(result?.state) &&
  Number.isFinite(result.value) && result.value >= 0 && (result.coverage == null || result.coverage === 'complete');

export function finiteResult(value) {
  return Number.isFinite(value) ? parseAmount(value) :
    { value: null, state: 'invalid', reason: 'numeric_overflow' };
}

export function displayWholeKcal(result) {
  return isExact(result) && result.unit === 'kcal' ? Math.round(result.value) : null;
}
