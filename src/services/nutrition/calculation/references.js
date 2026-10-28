import { normalizeNutrient } from './nutrients.js';
import { isExact } from './numbers.js';

export function normalizeReferenceRows(rows) {
  const records = {};
  for (const row of rows || []) {
    const result = normalizeNutrient({ name: row.nutrient, amount: row.daily_value, unit: row.unit });
    const previous = records[result.nutrient_id];
    const conflict = previous && (previous.value !== result.value || previous.unit !== result.unit || previous.state !== result.state);
    records[result.nutrient_id] = { ...result, source: { ...row },
      ...(!isExact(result) || result.value <= 0 ? { value: null, state: isExact(result) ? 'invalid' : result.state } : {}),
      ...(conflict || previous?.reason === 'conflicting_reference' ? { value: null, state: 'invalid', reason: 'conflicting_reference' } : {}),
    };
  }
  return records;
}

export function referencePercentage(nutrient, reference) {
  const metadata = { snapshot_id: reference?.snapshot_id ?? null };
  if ((nutrient?.coverage && nutrient.coverage !== 'complete') || (nutrient?.state && !['known', 'explicit_zero'].includes(nutrient.state))) return { ...metadata, percentage: null, state: 'missing', reason: 'incomplete_intake' };
  const numerator = normalizeNutrient(nutrient);
  const denominator = reference?.nutrient_id ? reference : normalizeNutrient({ name: reference?.nutrient, amount: reference?.daily_value, unit: reference?.unit });
  for (const result of [numerator, denominator]) {
    if (!isExact(result)) {
      const state = ['known', 'explicit_zero'].includes(result.state) ? 'invalid' : result.state;
      return { ...metadata, percentage: null, state, reason: result.reason ?? 'invalid_reference_or_intake' };
    }
  }
  if (denominator.value <= 0 || numerator.nutrient_id !== denominator.nutrient_id || numerator.unit !== denominator.unit) {
    return { ...metadata, percentage: null, state: 'invalid', reason: 'incompatible_reference' };
  }
  const percentage = numerator.value / denominator.value * 100;
  return Number.isFinite(percentage) ? { ...metadata, percentage, state: 'known' }
    : { ...metadata, percentage: null, state: 'invalid' };
}

