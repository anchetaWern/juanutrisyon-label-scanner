export const canonicalUnits = Object.freeze(Object.fromEntries([
  ['kcal', 'calories'],
  ['g', 'protein,total fat,saturated fat,trans fat,monounsaturated fat,polyunsaturated fat,omega-3,omega-6,tryptophan,total carbohydrates,dietary fiber,total fiber,sugar,added sugar'],
  ['mL', 'water'],
  ['mg', 'cholesterol,sodium,potassium,calcium,fluoride,iron,magnesium,zinc,chloride,choline,copper,manganese,phosphorus,vitamin c,vitamin b1,vitamin b2,niacin,niacin from tryptophan,vitamin b5,vitamin b6'],
  ['mcg', 'selenium,vitamin d,vitamin k,vitamin b12,biotin,chromium,iodine,molybdenum,retinol,beta-carotene,alpha-carotene,beta-cryptoxanthin'],
  ['mcg RAE', 'vitamin a'], ['mg AT', 'vitamin e'], ['mg NE', 'vitamin b3'], ['mcg DFE', 'vitamin b9'],
].flatMap(([unit, names]) => names.split(',').map(name => [name, unit]))));

export const cleanLabel = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
export const unitKey = value => cleanLabel(value).replace(/(?:[µμ]|u)g/g, 'mcg').replace(/\s+/g, '');
// Spelling aliases only. Chemical forms/equivalents remain conversion decisions.
export const nutrientAliases = Object.freeze({
  energy: 'calories', fat: 'total fat', carbohydrates: 'total carbohydrates',
  'total carbohydrate': 'total carbohydrates', fiber: 'dietary fiber',
  sugars: 'sugar', 'added sugars': 'added sugar', riboflavin: 'vitamin b2',
  'niacin equivalents': 'vitamin b3',
  'retinol activity equivalent': 'vitamin a',
});
export function nutrientId(name) {
  const id = cleanLabel(name);
  return nutrientAliases[id] ?? id;
}

const mass = { g: 1, mg: 0.001, mcg: 0.000001 };
const has = (object, key) => Object.hasOwn(object, key);

// Factors only encode conversions approved by contract v0.1. Unknown forms stay unknown.
export function nutrientConversion(id, unit, form) {
  const target = canonicalUnits[id];
  const from = unitKey(unit);
  const to = unitKey(target);
  const unsupported = reason => ({ state: 'unsupported_unit', reason });
  if (!has(canonicalUnits, id)) return { state: 'unsupported_nutrient', reason: 'unknown_nutrient' };
  if (from === to) return { factor: 1, unit: target };
  if (id === 'calories' && from === 'kj') return { factor: 1 / 4.184, unit: target };
  if (id === 'water') {
    if (from === 'l') return { factor: 1000, unit: target };
    return unsupported(has(mass, from) ? 'mass_to_volume_mapping_unapproved' : 'unknown_unit');
  }
  if (has(mass, from) && has(mass, to)) return { factor: mass[from] / mass[to], unit: target };
  if (id === 'vitamin d' && from === 'iu') return { factor: 0.025, unit: target };
  // Prefix changes are safe within an explicitly declared equivalent basis.
  const equivalent = from.match(/^(g|mg|mcg)(rae|at|ne|dfe)$/);
  const canonical = to.match(/^(g|mg|mcg)(rae|at|ne|dfe)$/);
  if (equivalent && canonical && equivalent[2] === canonical[2]) {
    return { factor: mass[equivalent[1]] / mass[canonical[1]], unit: target };
  }
  if (id === 'vitamin a') {
    if (/^(mcg|mg|g)re$/.test(from)) return unsupported('RE_to_RAE_mapping_unapproved');
    if (from === 'iu' && form === 'retinol') return { factor: 0.3, unit: target };
    return unsupported('vitamin_a_form_missing');
  }
  if (id === 'vitamin e') {
    if (from === 'iu' && form === 'natural_alpha_tocopherol') return { factor: 0.67, unit: target };
    if (from === 'iu' && form === 'synthetic_alpha_tocopherol') return { factor: 0.45, unit: target };
    return unsupported(from.includes('te') ? 'alpha_TE_to_AT_mapping_unapproved' : 'natural_or_synthetic_form_missing');
  }
  if (id === 'vitamin b9' && has(mass, from) && form === 'natural_food_folate') {
    return { factor: mass[from] / mass.mcg, unit: target };
  }
  return unsupported(id === 'vitamin b9' ? 'folate_form_missing' :
    id === 'vitamin b3' ? 'niacin_form_missing' : 'unknown_unit');
}
