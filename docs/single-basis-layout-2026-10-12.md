# Single-basis layout update — 2026-10-12

## Outcome

Adopt `spatial-review-v4`. This changes the app's nutrition extraction, not the Paddle OCR model, image preprocessing, capture workflow, quality thresholds, or JSON schema. It recovers explicitly recognized text that v3 could not associate. It does not fix underlying OCR digit errors.

| Same frozen iPhone OCR, owner-verified fields | v3 | v4 |
| --- | ---: | ---: |
| Correct nutrients | 124/191 (64.9%) | 153/191 (80.1%) |
| Missing nutrients | 66 | 37 |
| Wrong nutrients | 1 | 1 |
| Correct serving fields | 18/30 (60%) | 27/30 (90%) |
| Missing serving fields | 12 | 3 |
| Wrong serving fields | 0 | 0 |

The additional 29 correct nutrient fields and 9 serving fields come from the same OCR, without recropping or running recognition again. No previously correct scored field was lost. These are already-exposed regression products, including the former holdout, **not a new blind accuracy estimate**.

## Changes

- Split multiple explicit inline nutrients/calories in one recognized line only when every fragment has a valid printed amount. Retain the entire original line and original evidence index; do not fabricate bounding boxes or detach ambiguous fragments.
- Read a serving block beside the nutrient table, not only above the first nutrient row. Support unique detached household measures, stacked size/count fragments, and narrow observed label misspellings. Reject competing candidates, nutrient-column borrowing, partial preparation-dependent sizes, and extended scope across multiple panels/bases.
- Align complete separate unit-cell columns, retaining damaged cells as blockers. Require an identifiable right-hand percent heading, explicit units, unique amounts, and consistent geometry. Support a printed unit embedded in its label only when several accepted rows establish the column's offset.
- Recover tight explicit-unit rows within their local section without merging amounts from parallel sections. Do not infer missing units, reuse an amount, or replace damaged inline text with a nearby value.
- Support `Total Calories`, `Total Fats/Lipids`, unsaturated fat, DHA, omega-3/6/9, bullet-prefixed names, selected joined label/number boundaries, and narrow observed spelling errors. Strip terminal punctuation only after a fully printed amount unit; never repair numeric digits or incomplete decimals.
- Sort working geometry deterministically, keeping original source indexes. Preserve existing footer, duplicate-field, unit, incomplete-column, and multiple-basis protections.

Examples: yellow milk recovers six owner nutrient values plus its already separately annotated calories-from-fat value; crackers recover the detached carbohydrate amount, four merged micronutrients, and both serving fields; palm oil recovers five owner nutrient fields plus calories-from-fat. Damaged milk units/amounts remain unresolved.

## Regression results

All comparisons use frozen v3 from commit `0927174` and identical saved OCR. Source/label/scoring hashes and field changes are retained locally in the release comparison. Primary pilot totals exclude Codex-added supplements; gates additionally inspect those supplements/negative fields.

| Cohort | Correct nutrients, v3 → v4 | Correct serving, v3 → v4 | v4 wrong outputs | v4 false positives |
| --- | ---: | ---: | ---: | ---: |
| iPhone, 15 crops | 124 → 153/191 | 18 → 27/30 | 1 | Not established by owner truth alone |
| Pilot original | 96 → 102/191 | 17 → 21/30 | 0 | 0 |
| Pilot rectangle | 125 → 144/191 | 20 → 26/30 | 0 | 0 |
| Pilot perspective | 111 → 121/191 | 17 → 23/30 | 0 | 0 |
| Historical desktop, 30 cases | 176 → 180/371 | 19 → 21/59 | 4 (pre-existing) | 1 (pre-existing) |
| Historical mobile, 8 cases | 121 → 121/124 | 8 → 8/10 | 0 | 0 |

The separate iPhone supplemental audit improves 7 → 8/9 printed fields, with all seven annotated absent fields still absent. Supplements are Codex visual transcriptions awaiting independent owner review, not extra human-verified primary truth.

No new wrong/false-positive scored outputs or lost correct fields occur in any checked cohort. Pilot variants share the same 15 original photos; totals across variants are not independent-image sample sizes. Historical negatives are sparse, and unannotated new outputs remain unscored, so these checks cannot guarantee zero real-world false positives.

Verification: 190 tests pass, including 31 new layout/serving tests and six sanitized phone OCR regression fixtures. Checks cover damaged/missing units and amounts, ambiguous columns, bare daily values, duplicate fields, incomplete decimals, raw OCR immutability, source evidence, and reversed/scaled geometry. App and evaluation type checks, lint, and production build pass. The build retains existing large OCR-runtime chunk/browser-external warnings. No new OCR run, device timing study, deployment, or commit was performed.

## Reproduction

With the supplied local phone exports, saved Phase 2 `dataset.json`/`run.json`, and historical benchmark corpus present:

```sh
# Compare without writing output; nonzero exit if a comparison gate fails.
node --import tsx evaluation/phone/compare.ts

# Save detailed comparisons to a NEW directory.
node --import tsx evaluation/phone/compare.ts --out evaluation/results/single-basis-layout-2026-10-12-release

npm test
npm run lint
npm run type-check:evaluation
npm run build
```

Local `comparison.json` records baseline revision/digest, current source/input hashes, owner metrics, cohort metrics, safety gates and field changes. Cohort `*-report.json` and `*-fields.csv` retain all field outcomes, evidence and warnings. The compact tracked checkpoint is [the layout baseline](../evaluation/baselines/single-basis-layout-2026-10-12.json). Generated reports and raw phone exports remain gitignored; sanitized fixtures contain no images or device/browser metadata.

The original [phone audit](../OCR_IPHONE_AUDIT.md) remains a v3 baseline; its audit script now explicitly replays frozen v3 so later parser changes do not invalidate reproduction. This comparison uses the frozen dataset snapshot rather than weakening the old Phase 2 loader's exact inventory check. That older CLI still requires addressing extra export files before rerunning against the expanded labels folder.

## Remaining work

- The yellow-snack `160 kcal` → `60 kcal` error is still in raw OCR and remains wrong. A future region/detector/recognizer experiment must address this without guessing the missing digit.
- Spam's multiple nutrition bases deliberately remain unresolved. Explicit basis selection is a separate implementation, not included here.
- The shrimp-snack crop excludes a verified vitamin row. No parser can restore text outside the input.
- Missing units, damaged gram/microgram tokens, lost serving-count text, unsupported nutrient sentences, and unfamiliar layouts remain limitations.
- Fresh labeled products and unreadable/ambiguous negatives are needed for a new reserved validation set. Test the updated app on iPhone to confirm integration; exact larger phone originals are needed only for full original-to-crop reproduction.
