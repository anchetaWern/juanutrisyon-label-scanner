import { finiteResult, isExact, parseAmount } from './numbers.js';
import { nutrientConversion, nutrientId } from './units.js';
import { scalingFactor } from './basis.js';
import { copySource } from './source.js';

export function normalizeNutrient(input = {}) {
  input ??= {};
  const id = nutrientId(input.nutrient_id ?? input.name);
  const source = copySource(input.source ?? input);
  const composition = Array.isArray(input.composition) ? input.composition.map(normalizeNutrient) : [];
  const base = { nutrient_id: id, value: null, unit: input.unit ?? null, basis: input.basis ?? null, source, composition, ...(input.coverage ? { coverage: input.coverage } : {}) };
  // A normalized unknown must remain unknown when normalized again.
  if (input.nutrient_id != null && input.state && !['known', 'explicit_zero'].includes(input.state)) {
    return { ...base, state: input.state, ...(input.reason ? { reason: input.reason } : {}) };
  }
  const status = input.qualifier ?? input.status ?? input.state ?? source.qualifier ?? source.status;
  if (['trace', 'not_analyzed'].includes(status)) return { ...base, state: status };
  const parsed = parseAmount(Object.hasOwn(input, 'amount') ? input.amount : input.value);
  if (!isExact(parsed)) return { ...base, ...parsed };
  const conversion = nutrientConversion(id, input.unit, input.form ?? source.form);
  if (conversion.factor == null) return { ...base, ...conversion };
  return { ...base, ...finiteResult(parsed.value * conversion.factor), unit: conversion.unit };
}

export function scaleNutrient(nutrient, sourceBasis, selectedBasis, options) {
  const normalized = normalizeNutrient(nutrient);
  const factor = scalingFactor(sourceBasis, selectedBasis, options);
  function scale(node) {
    const base = { ...node, basis: factor.basis, composition: node.composition.map(scale) };
    if (!isExact(factor)) return { ...base, value: null, state: factor.state, reason: factor.reason };
    if (!isExact(node)) return base;
    return { ...base, ...finiteResult(node.value * factor.value) };
  }
  return scale(normalized);
}

export function scaleEnergy(sourceEnergy, sourceBasis, selectedBasis, options) {
  return scaleNutrient({ name: 'calories', amount: sourceEnergy?.value, unit: sourceEnergy?.unit }, sourceBasis, selectedBasis, options);
}
