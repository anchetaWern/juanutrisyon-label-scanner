import { referencePercentage } from './references.js';
import { normalizeNutrient } from './nutrients.js';

export const HIGHLIGHTS_POLICY_VERSION = 'jn-nutrient-highlights-1';
export const HIGHLIGHT_THRESHOLD = 20;
export const notableNutrientIds = Object.freeze([
  'protein', 'dietary fiber',
  'vitamin a', 'vitamin b1', 'vitamin b2', 'vitamin b3', 'vitamin b5', 'vitamin b6',
  'vitamin b9', 'vitamin b12', 'vitamin c', 'vitamin d', 'vitamin e', 'vitamin k',
  'biotin', 'choline', 'calcium', 'chromium', 'copper', 'iodine', 'iron', 'magnesium',
  'manganese', 'molybdenum', 'phosphorus', 'potassium', 'selenium', 'zinc',
]);
export const monitorNutrientIds = Object.freeze(['saturated fat', 'sodium', 'sugar']);

const flatten = nodes => (nodes || []).flatMap(node => [node, ...flatten(node.composition)]);

// Input is the complete shared calculation for the portion currently displayed,
// not a subtotal, selected display groups, a daily-intake total, or a claim.
export function classifyNutrientHighlights(nutrients, references = { records: {} }) {
  const nodes = flatten(nutrients).map(normalizeNutrient);
  const assess = ids => {
    const items = [], skipped = [];
    let evaluatedCount = 0;
    for (const name of ids) {
      const matches = nodes.filter(node => node.nutrient_id === name);
      const reference = references.records?.[name];
      if (name === 'sugar') {
        const referenceType = reference?.reference_metadata?.sugar_type;
        // A generic sugar field is not proof of total, added, or free sugars.
        const nutrientType = matches[0]?.source?.sugar_type;
        if (!['total', 'added', 'free'].includes(referenceType) || nutrientType !== referenceType) {
          skipped.push({ name, reason: 'sugar_definition_unverified_or_mismatched' });
          continue;
        }
      }
      const result = matches.length === 1 ? referencePercentage(matches[0], reference) : null;
      if (!result || result.percentage === null) {
        skipped.push({ name, reason: result?.reason ?? (matches.length > 1 ? 'duplicate_nutrient' : 'missing_nutrient') });
        continue;
      }
      evaluatedCount++;
      if (result.percentage >= HIGHLIGHT_THRESHOLD) items.push({
        name, amount: matches[0].value, unit: matches[0].unit,
        percentage: result.percentage, reference: reference.reference_metadata,
      });
    }
    items.sort((a, b) => b.percentage - a.percentage || ids.indexOf(a.name) - ids.indexOf(b.name));
    return { items, skipped, evaluatedCount,
      state: evaluatedCount === 0 ? 'unavailable' : skipped.length ? 'partial' : 'complete' };
  };
  return { notable: assess(notableNutrientIds), monitor: assess(monitorNutrientIds),
    policy_version: HIGHLIGHTS_POLICY_VERSION, reference_snapshot_id: references.snapshot_id };
}

export function highlightEmptyMessage(group) {
  return group.evaluatedCount > 0
    ? 'No assessed nutrients reach 20% of the daily reference amount for this portion.'
    : 'There is not enough complete, compatible nutrient and reference data to assess this portion.';
}
