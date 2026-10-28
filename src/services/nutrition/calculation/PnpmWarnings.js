const WARNING_LABELS = {
  totalFat: 'High in Total Fat',
  sodium: 'High in Sodium',
  sugar: 'High in Sugar',
  saturatedFat: 'High in Saturated Fat',
};

const isValidPositiveEnergy = (value) => Number.isFinite(value) && value > 0;

const toFiniteNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const unknownResult = (nutrient, label, reason) => ({
  nutrient,
  status: 'unknown',
  label,
  reason,
});

export function calculatePnpmWarnings(input = {}) {
  const energyKcal = toFiniteNumberOrNull(input.energyKcal);
  const totalFatG = toFiniteNumberOrNull(input.totalFatG);
  const sodiumMg = toFiniteNumberOrNull(input.sodiumMg);
  const totalSugarG = toFiniteNumberOrNull(input.totalSugarG);
  const saturatedFatG = toFiniteNumberOrNull(input.saturatedFatG);
  const invalidEnergy = !isValidPositiveEnergy(energyKcal);
  const totalFat = invalidEnergy || totalFatG === null
    ? unknownResult('total-fat', WARNING_LABELS.totalFat, invalidEnergy ? 'Energy data is unavailable or invalid.' : 'Total fat data is unavailable.')
    : { nutrient: 'total-fat', status: ((totalFatG * 9) / energyKcal) * 100 >= 30 ? 'high' : 'not-high', label: WARNING_LABELS.totalFat, value: ((totalFatG * 9) / energyKcal) * 100, threshold: 30, unit: '% energy' };
  const sodium = invalidEnergy || sodiumMg === null
    ? unknownResult('sodium', WARNING_LABELS.sodium, invalidEnergy ? 'Energy data is unavailable or invalid.' : 'Sodium data is unavailable.')
    : { nutrient: 'sodium', status: sodiumMg / energyKcal >= 1 ? 'high' : 'not-high', label: WARNING_LABELS.sodium, value: sodiumMg / energyKcal, threshold: 1, unit: 'mg/kcal' };
  const sugar = invalidEnergy || totalSugarG === null
    ? unknownResult('sugar', WARNING_LABELS.sugar, invalidEnergy ? 'Energy data is unavailable or invalid.' : 'Total sugar data is unavailable.')
    : { nutrient: 'sugar', status: ((totalSugarG * 4) / energyKcal) * 100 >= 10 ? 'high' : 'not-high', label: WARNING_LABELS.sugar, value: ((totalSugarG * 4) / energyKcal) * 100, threshold: 10, unit: '% energy' };
  const saturatedFat = invalidEnergy || saturatedFatG === null
    ? unknownResult('saturated-fat', WARNING_LABELS.saturatedFat, invalidEnergy ? 'Energy data is unavailable or invalid.' : 'Saturated fat data is unavailable.')
    : { nutrient: 'saturated-fat', status: ((saturatedFatG * 9) / energyKcal) * 100 >= 10 ? 'high' : 'not-high', label: WARNING_LABELS.saturatedFat, value: ((saturatedFatG * 9) / energyKcal) * 100, threshold: 10, unit: '% energy' };

  return { totalFat, sodium, sugar, saturatedFat };
}

export function summarizePnpmWarnings(results = {}) {
  const statuses = [
    results.totalFat?.status,
    results.sodium?.status,
    results.sugar?.status,
    results.saturatedFat?.status,
  ].filter(Boolean);

  if (statuses.some((status) => status === 'high')) return 'warnings-present';
  if (statuses.length > 0 && statuses.every((status) => status === 'not-high')) return 'no-warnings';
  if (statuses.length > 0 && statuses.every((status) => status === 'unknown')) return 'unavailable';
  return 'partial';
}
