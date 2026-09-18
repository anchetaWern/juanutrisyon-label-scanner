# Nutrition extraction — 2026-09-18

`spatial-review-v2` supports the three new frozen mobile OCR cases, yielding 49
non-null nutrient values and four serving fields checked against the supplied JPG
crops. One nutrient and two serving fields deliberately remain null. No OCR
settings, raw OCR, label images, existing extracted JSON, or benchmark artifacts
were changed.

## Source inspection and baseline

Read the project README, both earlier iteration reports, parser, existing tests,
and all five previous mobile fixtures before editing. Inspected all three
`labels/new/new-N.JPG` crops against `new-N-diagnostics.json`. The uncropped
originals named by those diagnostics (IMG_3655, IMG_3653, IMG_3638) were not supplied.
The exported JPG dimensions match diagnostics, but their byte sizes differ; this
is a frozen diagnostic replay, not an exact-input OCR reproduction.

Added `fixtures/mobile-ocr-2026-09-18.json` before changing parser logic. It retains
the exact OCR text, line order, confidence, bounding boxes, engine, and source
dimensions, omitting device/browser/network metadata, timing, image metadata, and
the previous parser output. No OCR text was cleaned in these fixtures.

The full baseline run after adding the initial regressions passed all 51 existing
tests and one new guard test; ten new tests failed as expected. The failures
captured the missing names, unsupported mixed-basis section, incomplete serving
fields, and the incorrectly accepted `n 3 cup (4og)` serving size.

## Exact supported output

Values below are the final parser JSON, checked against each crop. Null means
unresolved, never zero. Percentages for new-2 use the printed **Per Serving** column.

### new-1

```json
{
  "serving": { "serving_size": null, "servings_per_container": "About 13" },
  "nutrients": {
    "energy": "150kcal", "total_fat": "2.5g", "saturated_fat": "0.5g",
    "trans_fat": "0g", "cholesterol": "0mg", "sodium": "0mg",
    "carbohydrate": "26g", "fiber": "7g", "sugars": "1g", "protein": "7g",
    "added_sugars": "0g", "vitamin_d": "0mcg", "calcium": "20mg",
    "iron": "2mg", "potassium": "201mg"
  }
}
```

The image prints `1/3 cup (40g)`, but OCR says `Serving sizen 3 cup (4og)`.
The parser now requires a word boundary after `size` and does not accept or repair
that damaged field. `Dletary Fiber` is a narrowly recognized OCR spelling with a
normalization warning. Existing `Og`/`Omg`/`Omcg` numeric-slot corrections retain
their individual warnings for trans fat, cholesterol, sodium, added sugars, and
vitamin D.

### new-2

```json
{
  "serving": { "serving_size": "(2 slices) 62g", "servings_per_container": null },
  "nutrients": {
    "energy": "178kcal", "energy_from_fat": "18kcal", "total_fat": "2g",
    "saturated_fat": "1g", "trans_fat": "0g", "cholesterol": "1mg",
    "sodium": "225mg", "carbohydrate": "31g", "fiber": "3g",
    "soluble_fiber": "1g", "insoluble_fiber": "2g", "sugars": "4g", "protein": "9g",
    "vitamin_a": "15%", "vitamin_c": "0%", "calcium": "14%", "iron": "23%",
    "vitamin_b1": "6%", "vitamin_b2": "0%", "vitamin_b3": "12%", "folate": "0%"
  }
}
```

The detached `62g` completes the readable `(2 slices)` serving measure. The count
prints `About 6`, but OCR's `Arout6` remains unresolved. `Sodiun` and `Irón` are
normalized only for name matching and generate field-specific review warnings.
`Vit. B1 (Thiamine)`, `Vit. B2 (Riboflavin)`, and `Vit. B3 (Niacin)` map to vitamin
keys without duplicating the named vitamin as a second nutrient. These are label
aliases, not changes to OCR. Trans fat retains its `Og` correction warning.

The macro section explicitly says Amount Per Serving. Below it, aligned and
non-overlapping Per Serving / Per 100g headings identify a separate micronutrient
table. The narrow exception requires readable inline amounts above those headings,
at least three detached non-core rows below, and unique, aligned headings with the
serving column on the left. Row geometry selects cells only within that serving
column; missing/unreadable cells stay null. Basis headings are included in every
extracted table value's original-line evidence, and a panel warning explains the
selection. The per-100g values are not copied or converted.

### new-3

```json
{
  "serving": { "serving_size": "(34g)", "servings_per_container": "10" },
  "nutrients": {
    "energy": "65kcal", "total_fat": null, "saturated_fat": "1.3g",
    "trans_fat": "0g", "cholesterol": "18mg", "sodium": "250mg",
    "carbohydrate": "3.8g", "fiber": "0g", "sugars": "1.1g", "protein": "3g",
    "vitamin_d": "0mg", "calcium": "0mg", "iron": "0mg", "potassium": "50mg"
  }
}
```

The count-first `10 servings per container` and detached `(34g)` are now supported.
Total fat prints `3.3 g` but OCR returns `3.39`: its missing unit is not guessed,
and its neighboring `6%` is not substituted. Vitamin D really prints `0 mg` in
this crop, so the output retains `0mg` rather than imposing the usual mcg unit.

## Verification and limitations

- All 66 tests pass across 14 files, including all five unchanged earlier mobile
  cases. New tests verify full output, explicit nulls, OCR immutability, original
  evidence indexes, order/scale invariance, normalization warnings, selected basis,
  damaged/missing/competing cells, duplicate rows, ambiguous serving masses, and
  missing/reversed/overlapping/misaligned basis headings. Explicit mass still wins
  over an accompanying percentage; two competing percentages are rejected.
- `npm run lint`, `npm run type-check`, and `npm run build` pass. The build retains
  the existing OpenCV browser-externalization and large-chunk warnings.
- Read-only replay of the 30 stored benchmark OCR results and one supplemental
  crop changed no existing nutrient values. Label 001 gains seven recognized null
  keys while its unsupported mixed table remains rejected. Two newly readable
  serving values were checked against the older crops: label 003 count `1` and
  label 007 size `64g`. No fresh OCR benchmark was run.
- SHA-256 verification covers the existing source/artifact files under `labels/`
  and `benchmark/`; all remain unchanged. Finder `.DS_Store` metadata is excluded:
  `labels/.DS_Store` changed during the session without an agent write.
- Calories retains the existing kcal interpretation. No unit/digit repair was
  added for `3.39`, `Arout6`, or the damaged serving fraction. No percentage-to-mass
  conversion is performed, and qualifiers remain covered by the original tests.
- The mixed-basis exception intentionally does not support reversed columns,
  ambiguous headers, core nutrients in the lower multi-basis table, or unreadable
  upper inline amounts. Those layouts still abstain. Unknown nutrient names and
  damaged cells can remain omitted or null; these three samples do not establish
  general accuracy. Review against the label remains required.
- No deployment, new recognition run, or phone runtime/performance test was done.
  The supplied crops were sufficient for these parser changes; uncropped originals
  would be needed to audit the original-to-crop workflow.
