import { finiteResult, isExact, parseAmount } from './numbers.js';
import { unitKey } from './units.js';

const units = {
  g: ['weight', 'g', 1], kg: ['weight', 'g', 1000],
  ml: ['volume', 'mL', 1], l: ['volume', 'mL', 1000],
  serving: ['count', 'serving', 1], piece: ['count', 'piece', 1],
};

export function normalizeBasis(input, role = 'source') {
  const parsed = parseAmount(input?.amount);
  const base = { amount: null, unit: null, dimension: 'unavailable', edible_basis: input?.edible_basis ?? null };
  if (['missing', 'invalid', 'unsupported_unit'].includes(input?.state)) {
    return { ...base, state: input.state, reason: input.reason ?? `invalid_${role}_basis` };
  }
  if (!isExact(parsed)) return { ...base, state: parsed.state,
    reason: `${parsed.state === 'missing' ? 'missing' : parsed.reason === 'negative_amount' ? 'negative' : 'malformed'}_${role}_basis` };
  if (role === 'source' && parsed.value === 0) return { ...base, state: 'invalid', reason: 'zero_source_basis' };
  const key = unitKey(input?.unit);
  if (!Object.hasOwn(units, key)) return { ...base, state: 'unsupported_unit', reason: `unsupported_${role}_basis_unit` };
  const [dimension, unit, factor] = units[key];
  const converted = finiteResult(parsed.value * factor);
  return { ...base, dimension, unit, amount: converted.value, state: converted.state, ...(converted.reason ? { reason: converted.reason } : {}) };
}

export function convertEdibleWeight(amount, percent, direction = 'ap_to_ep') {
  const weight = parseAmount(amount);
  if (!isExact(weight)) return weight;
  const edible = parseAmount(percent);
  if (edible.state === 'missing') return { value: null, state: 'missing', reason: 'missing_edible_portion' };
  if (!isExact(edible) || edible.value <= 0 || edible.value > 100) {
    return { value: null, state: 'invalid', reason: 'edible_portion_out_of_range' };
  }
  if (!['ap_to_ep', 'ep_to_ap'].includes(direction)) return { value: null, state: 'invalid', reason: 'unknown_edible_direction' };
  return { ...finiteResult(direction === 'ap_to_ep' ? weight.value * (edible.value / 100) : weight.value / (edible.value / 100)), unit: 'g' };
}

export function scalingFactor(sourceInput, selectedInput, { density, edible_portion_percent } = {}) {
  const source = normalizeBasis(sourceInput);
  const selected = normalizeBasis(selectedInput, 'selected');
  const basis = { source, selected, conversions: [] };
  for (const item of [source, selected]) {
    if (!['known', 'explicit_zero'].includes(item.state)) return { value: null, state: item.state, reason: item.reason, basis };
  }
  let amount = selected.amount;
  if (source.dimension !== selected.dimension) {
    if (![source.dimension, selected.dimension].every(value => ['weight', 'volume'].includes(value))) {
      return { value: null, state: 'invalid', reason: 'incompatible_basis_dimensions', basis };
    }
    const normalizedDensity = normalizeDensity(density);
    if (!isExact(normalizedDensity)) return { ...normalizedDensity, basis };
    amount = selected.dimension === 'volume' ? amount * normalizedDensity.value : amount / normalizedDensity.value;
    basis.conversions.push({ method: 'density', density_g_per_ml: normalizedDensity.value });
  } else if (source.unit !== selected.unit) {
    return { value: null, state: 'invalid', reason: 'incompatible_count_units', basis };
  }
  if (source.edible_basis !== selected.edible_basis) {
    if (source.dimension !== 'weight' || selected.dimension !== 'weight' ||
        ![source.edible_basis, selected.edible_basis].every(value => ['edible', 'as_purchased'].includes(value))) {
      return { value: null, state: 'missing', reason: 'unknown_edible_basis', basis };
    }
    const direction = source.edible_basis === 'edible' ? 'ap_to_ep' : 'ep_to_ap';
    const converted = convertEdibleWeight(amount, edible_portion_percent, direction);
    if (!isExact(converted)) return { ...converted, basis };
    amount = converted.value;
    basis.conversions.push({ method: direction, edible_portion_percent: Number(edible_portion_percent) });
  }
  if (source.edible_basis != null && !['edible', 'as_purchased'].includes(source.edible_basis)) {
    return { value: null, state: 'invalid', reason: 'unknown_edible_basis', basis };
  }
  return { ...finiteResult(amount / source.amount), basis };
}

export function normalizeDensity(input, scalarUnit) {
  const raw = input && typeof input === 'object' ? input.density : input;
  const parsed = parseAmount(raw);
  if (!isExact(parsed)) return { ...parsed, reason: 'missing_or_invalid_density' };
  if (parsed.value === 0) return { value: null, state: 'invalid', reason: 'zero_density' };
  const unit = input && typeof input === 'object' ? input.unit : scalarUnit;
  if (unitKey(unit) !== 'g/ml') return { value: null, state: 'unsupported_unit', reason: 'unknown_density_unit' };
  return { ...parsed, unit: 'g/mL' };
}

export function normalizeHouseholdMeasure(input = {}) {
  const quantity = parseAmount(input.quantity);
  const density = normalizeDensity(input.density, input.density_unit);
  const result = { label: input.label ?? input.name ?? null, quantity: quantity.value, weight_grams: null, volume_ml: null,
    density_g_per_ml: density.value, source_unit: input.weight_unit ?? input.unit ?? null, provenance: null };
  if (!isExact(quantity)) return { ...result, state: quantity.state, reason: 'invalid_or_missing_quantity' };
  let weight = parseAmount(input.weight_in_grams ?? input.weight_grams);
  if (weight.state === 'missing' && input.weight != null) {
    const declared = normalizeBasis({ amount: input.weight, unit: input.weight_unit ?? input.unit });
    if (declared.dimension !== 'weight' || declared.state !== 'known') {
      return { ...result, state: declared.state === 'known' ? 'invalid' : declared.state, reason: declared.reason ?? 'incompatible_household_weight_unit' };
    }
    weight = parseAmount(declared.amount);
  }
  const volume = parseAmount(input.volume_in_ml ?? input.volume_ml);
  const hasWeight = weight.state !== 'missing';
  const measure = hasWeight ? weight : volume;
  if (!isExact(measure) || measure.value <= 0) return { ...result, state: measure.state === 'missing' ? 'missing' : 'invalid', reason: 'invalid_or_missing_measure' };
  if (isExact(volume) && volume.value > 0) result.volume_ml = finiteResult(volume.value * quantity.value).value;
  if (!hasWeight && !isExact(density)) return { ...result, state: density.state, reason: density.reason };
  const total = finiteResult((hasWeight ? weight.value : volume.value * density.value) * quantity.value);
  return { ...result, weight_grams: total.value, state: total.state,
    ...(total.reason ? { reason: total.reason } : {}), provenance: hasWeight ? 'supplied_gram_weight' : 'volume_times_density' };
}
