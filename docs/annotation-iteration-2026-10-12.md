# Annotation-driven iteration — 2026-10-12

## Outcome

Adopt parser `spatial-review-v5`, compared with the committed v4 baseline `d7c2b96`. This iteration uses the owner's testing notes to target remaining extraction failures. It changes nutrition parsing only: PaddleOCR, detector settings, preprocessing, capture warnings, sharing, and JSON schema remain unchanged. No OCR inference, paid/cloud service, deployment, or commit was performed in this iteration.

| Same 15 saved iPhone scans, owner-verified truth | v4 | v5 |
| --- | ---: | ---: |
| Correct nutrients | 153/191 (80.1%) | 164/191 (85.9%) |
| Missing nutrients | 37 | 26 |
| Wrong nutrients | 1 | 1 |
| Correct serving fields | 27/30 (90%) | 27/30 (90%) |
| Missing serving fields | 3 | 3 |

The 11 additional correct nutrient values come from identical OCR, not better character recognition. Every existing non-null prediction remains unchanged across the replayed datasets, including unannotated predictions. No new scored errors or lost correct fields were found. These are exposed regression products, **not fresh blind validation or a guarantee about unseen labels**.

## Changes and boundaries

- Narrow, source-preserving name corrections: `Dietayy Fiber`, `Tolal Carbohydrates`, `calcum`, `lodine`, `selenlum`, and `Calorlas from Fat`. Corrections produce review warnings; no fuzzy matching or numeric repair.
- Accept `Cal` as the food-energy unit on explicitly named energy rows only, normalize to the existing `kcal` output, and warn. Do not change kJ amounts or accept Cal on mass nutrients. Accept the explicitly recognized microgram spelling `ug` without changing digits.
- Interpret exact bullet-prefixed `-Trans` and `-Saturated` table subrows only when a total-fat label is present before the footer. Units must still be recognized, and duplicate/multi-basis safeguards remain active.
- Recognize the complete statement form “Each serving contains X mg DHA of the Y mg of Omega-3” (also readable g/microgram units). Require a single nutrition panel, a statement after its rows and before ingredients/reference tables, explicit amounts/units, and no competing statement. Malformed competing claims block extraction too. Never replace or fill an existing table anchor from the sentence. This is deliberately not a general prose/claim extractor.
- Recover the narrowly observed `sugarg)` label as `Sugar(g)`: the g is already present; only the opening parenthesis is lost. Do not repair truncated `Vitamin A(U)`, damaged units, or alphabetic/missing digits.

Raw OCR, source bounding boxes and evidence indexes are preserved. Output remains review-required.

## How the owner's notes map to current behavior

The notes describe the pre-v4 app. Several misses were already recovered by v4; the following separates this iteration from earlier fixes and remaining recognition/capture limits. Visual observations such as glare are useful hypotheses, not independently established causes.

| Product | This iteration / current remaining issue |
| --- | --- |
| 01 shrimp snack | Protein recovered in v4. Total-fat label is still truncated in OCR (`tal Fat`); bottom vitamin row is outside this crop. No glare-based value guessing. |
| 02 yellow snack | Newly recovers fiber. Serving size, calcium and potassium were recovered in v4. Raw energy is still wrongly recognized as 60 rather than 160. |
| 03 Tang | Newly recovers trans and saturated fat. Other missing values contain damaged OCR units (`4B`, `0B`, `08`, `1.5吧`). The nutrition table is fully in the crop: excessive zoom is not established as the cause. |
| 04 blue tub | Serving size and minerals recovered in v4. Vitamin D remains unresolved because OCR says `O0mcg`; do not collapse ambiguous digits. |
| 05 Spam | Still abstains from multiple nutrition bases. Borderless layout alone is not the demonstrated cause. Explicit basis selection remains a separate change. |
| 06 555 sardines | Newly recovers energy, calcium, iodine and selenium, plus separately scored calories-from-fat. v4 recovered cholesterol, sugar, zinc, DHA and omega-3. Fiber (`DiotaryFiberlg`) and vitamin D (`Vitamin b101U`) still require recognition improvement. |
| 07 CDO sardines | Newly recovers both DHA and omega-3 from the explicit serving statement outside the table. Table values remain unchanged; calories/energy already share the same output key. |
| 08 Mega sardines | No changes; preserves all owner-verified readings. |
| 09 palm oil | Newly recovers carbohydrate 0g. v4 already recovered unsaturated fat and omega-9/6. |
| 10 crackers | No new change; v4 already recovered all owner-verified nutrients and serving fields. |
| 11 wafer | v4 recovered energy and serving fields. Carbohydrate OCR says `139`, not a readable `13g`; no inferred unit or digit change. |
| 12 potato snack | No new change; v4 already recovered serving fields and all owner-verified nutrients. |
| 13 biscuit | Count 20 is absent from this phone OCR, not simply an unsupported wording variant. Serving size and all owner-verified nutrients remain correct. |
| 14 yellow milk | v4 recovered separate-unit rows and the serving count. Saturated-fat amount is missing; remaining trans/sugar/protein units or digits are damaged. No unit-column sliding or guessing. |
| 15 brown milk | Newly recovers sugars 10g. Trans-fat amount is absent from OCR; Vitamin A's IU unit is truncated. Existing vitamin-D key follows the unchanged owner annotation. |

### Crop warnings

Existing advisory checks already warn about text touching crop edges, small text, possible glare, and blur. A close crop is not inherently bad. Tang includes the whole nutrition table, while shrimp snack loses a bottom row; these are different problems. Thresholds were not changed without calibrated examples. Complete-panel guidance remains important, but an “over-zoomed” classification would be unsupported by this batch.

## Regression verification

| Cohort | Correct nutrients, v4 → v5 | Correct serving fields | Existing wrong / false-positive outputs |
| --- | ---: | ---: | ---: |
| iPhone owner, 15 cases | 153 → 164/191 | 27 → 27/30 | 1 / no owner negative annotations |
| Pilot original, 15 variants | 102 → 106/191 | 21 → 21/30 | 0 / 0 |
| Pilot rectangle, 15 variants | 144 → 147/191 | 26 → 26/30 | 0 / 0 |
| Pilot perspective, 15 variants | 121 → 123/191 | 23 → 23/30 | 0 / 0 |
| Historical desktop, 30 cases | 180 → 181/371 | 21 → 21/59 | 4 / 1, unchanged |
| Historical mobile, 8 cases | 121 → 121/124 | 8 → 8/10 | 0 / 0 |

The separate supplemental phone audit improves 8 → 9/9 printed values; all seven annotated absent fields still abstain. These supplemental transcriptions await independent owner review and are not included in the 191 primary nutrient fields. Pilot variants reuse the same 15 products and are not independent images.

The comparison now supports an explicit frozen baseline commit while independently checking that the original saved diagnostics still replay as v3 (`0927174`). It checks unchanged truth, raw OCR immutability, source evidence, reversed/scaled geometry, no newly wrong/false-positive fields, no lost correct fields, no cohort losses, and **no changed existing non-null predictions**, including unscored fields. All newly added predictions in this release are covered by existing owner truth or the separately identified supplemental truth; no truth labels were edited.

Verification: 224 tests pass, including 34 new annotation-focused cases; five additional sanitized phone fixtures retain frozen v4 data to protect all previous readings. Lint, evaluation/app type checks and production build pass. Existing OCR runtime chunk/browser-external warnings remain. No iPhone runtime test, new OCR run, or latency study was performed.

## Reproduction

Requires the same local phone JSON exports, frozen Phase 2 snapshot and historical benchmark corpus used for v4. Output directories are new-only; do not overwrite earlier reports.

```sh
node --import tsx evaluation/phone/compare.ts --baseline d7c2b96
node --import tsx evaluation/phone/compare.ts --baseline d7c2b96 --out evaluation/results/annotation-iteration-2026-10-12-release
npm test
npm run lint
npm run type-check:evaluation
npm run build
```

Default comparison without `--baseline` still uses v3 for compatibility with the earlier layout report. Detailed local reports retain per-field changes and source hashes. The [tracked checkpoint](../evaluation/baselines/annotation-iteration-2026-10-12.json) records this release's inputs, source digests and gates.

## Next separate work

Test the updated app on iPhone and reserve fresh labeled products before tuning further. Remaining priorities are explicit basis selection for Spam and recognition experiments for missing digits/units, with ambiguous/unreadable negatives included. Keep the current parser as the baseline for those experiments; do not infer zero or missing characters to increase coverage.
