// Provenance of the existing consolidated male/19 endpoint, traced through
// pinoy-food-api/app/Services/DailyValueReferenceService.php. No values live here.
const pdri = 'https://www.fnri.dost.gov.ph/index.php/95-tools-and-standard/philippine-dietary-reference-intakes-pdri';
const fda = 'https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels';
const pdriFields = {
  protein: ['pdri_macronutrient_intake.male_protein_in_grams', 'recommended_intake'],
  'dietary fiber': ['pdri_macronutrient_intake.fiber_from_in_grams', 'recommended_range_lower_bound'],
  calcium: ['pdri_minerals_intake.male_calcium'], iron: ['pdri_minerals_intake.male_iron'],
  zinc: ['pdri_minerals_intake.male_zinc'], selenium: ['pdri_minerals_intake.male_selenium'],
  iodine: ['pdri_minerals_intake.male_iodine'], magnesium: ['pdri_minerals_intake.male_magnesium'],
  phosphorus: ['pdri_minerals_intake.male_phosphorus'], potassium: ['pdri_minerals_intake.potassium'],
  chloride: ['pdri_minerals_intake.chloride'], fluoride: ['pdri_minerals_intake.male_fluoride'],
  'vitamin a': ['pdri_vitamins_intake.male_vitamin_a'],
  'vitamin b1': ['pdri_vitamins_intake.male_thiamin'],
  'vitamin b2': ['pdri_vitamins_intake.male_riboflavin'],
  'vitamin b3': ['pdri_vitamins_intake.male_niacin'],
  'vitamin b6': ['pdri_vitamins_intake.male_pyridoxine'],
  'vitamin b9': ['pdri_vitamins_intake.male_folate'],
  'vitamin b12': ['pdri_vitamins_intake.male_cobalamin'],
  'vitamin c': ['pdri_vitamins_intake.male_vitamin_c'],
  'vitamin d': ['pdri_vitamins_intake.male_vitamin_d'],
  'vitamin e': ['pdri_vitamins_intake.male_vitamin_e'],
  'vitamin k': ['pdri_vitamins_intake.male_vitamin_k'],
};
const fdaNutrients = new Set(['biotin', 'choline', 'cholesterol', 'chromium', 'copper',
  'manganese', 'molybdenum', 'vitamin b5', 'saturated fat']);

export function referenceProvenance(name) {
  if (pdriFields[name]) {
    const [source_field, reference_type = 'intake_reference'] = pdriFields[name];
    return { source_name: 'PDRI 2015 intake tables', source_url: pdri, source_field, reference_type,
      definition_status: reference_type === 'intake_reference' ? 'RNI_or_AI_subtype_unverified' : 'identified' };
  }
  if (fdaNutrients.has(name)) return { source_name: 'FDA Daily Values as stored by Juan Nutrisyon',
    source_url: fda, source_field: `fda_daily_values_for_nutrients.${name}`,
    reference_type: 'labelling_reference', definition_status: 'stored_value_not_independently_verified' };
  return { source_name: 'Juan Nutrisyon fixed reference', source_url: null,
    source_field: 'DailyValueReferenceService.getDailyValues', reference_type: 'unspecified_reference',
    definition_status: 'original_definition_unverified',
    ...(name === 'sugar' ? { sugar_type: 'unverified' } : {}) };
}
