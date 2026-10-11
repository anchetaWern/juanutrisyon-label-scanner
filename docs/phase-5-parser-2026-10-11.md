# Phase 5 parser/layout results — 2026-10-11

## Decision

Adopt `spatial-review-v3` in the app. Unlike Phase 4, this changes production extraction and improves measured field recovery on the existing pilot. It does **not** change Paddle models, preprocessing, crop geometry, quality thresholds, raw OCR, or the exported nutrition schema. All extracted values still require review.

The before/after comparison uses identical saved Phase 2 OCR, owner annotations and `field-exact-v1` scoring. Baseline parser v2 is loaded from commit `57234a0`, not reconstructed from current source. Ten products were used for development; the parser and scoring/input hashes were frozen before evaluating five reserved products once. No parser edits followed that validation.

## What changed in the app

- More reliable alignment of complete, curved/tilted amount columns, with consecutive row-spacing checks. Incomplete tall/overlapping bare-number tables still abstain; compact, clean rows permit tightly bounded local matching.
- Guard against taking an amount from a neighboring nutrient column or assigning a lower micronutrient row's amount to a damaged row. A damaged explicit mass also blocks substitution of its %DV.
- Join explicit nearby serving fragments such as `Serving size: 1 | piece (4g)` and `No. of Serving | container/pack: 20`; normalize serving punctuation and recognize `per pack`. Preserve fractions and decimal counts.
- Recognize joined names such as `TotalCarbohydrates`, Unicode vitamin subscripts and the observed `Toial Protein` spelling. Support printed IU and microgram RE units without converting amounts. An open parenthesis is accepted only if the complete unit is readable; `(kca)` is not guessed to mean `(kcal)`.
- Join the explicit `Includes 0g | Added Sugar` fragments. Reject conflicting detached units rather than guessing a unit or digit. Literal inline values remain as OCR read them, even if nutritionally unusual.
- Disable automatic nutrient extraction for supported detection of vertically stacked competing panels. Repeated rows and multi-basis layouts retain conservative exclusions. This is not general panel segmentation.

Raw OCR remains unchanged, and every emitted value retains source indexes/text. Character/name normalizations produce review issues. Missing values remain `null`, not zero.

## Owner-verified results

These are exact readable-field recovery counts, not complete-label success rates. Primary denominators are 191 nutrient strings and 30 serving strings per input variant. Supplements are excluded from these tables.

### Development: ten products

| Input | Nutrients v2 → v3 /137 | Serving v2 → v3 /20 | Wrong nutrients v2 → v3 | Wrong serving v2 → v3 |
| --- | ---: | ---: | ---: | ---: |
| Original | 47 → 72 | 9 → 14 | 0 → 0 | 4 → 0 |
| Rectangle | 70 → 97 | 10 → 17 | 2 → 0 | 5 → 0 |
| Perspective | 62 → 83 | 10 → 14 | 1 → 0 | 3 → 0 |

### Reserved validation: five products

| Input | Nutrients v2 → v3 /54 | Serving v2 → v3 /10 | Wrong nutrients/serving v3 |
| --- | ---: | ---: | ---: |
| Original | 24 → 24 | 3 → 3 | 0 / 0 |
| Rectangle | 27 → 28 | 3 → 3 | 0 / 0 |
| Perspective | 28 → 28 | 3 → 3 | 0 / 0 |

The only new correct owner field on reserved products is rectangle product 11 (`Total Fat | 5g`), now recovered through ordered-column alignment. All previously correct scored fields were retained. Both development and validation passed the expanded audit gates: no new/changed wrong values, no new annotated false positives, no lost correct fields, and no cohort recovery losses.

### Combined pilot: descriptive, not independent validation

| Input | Nutrients v2 → v3 /191 | Serving v2 → v3 /30 |
| --- | ---: | ---: |
| Original | 71 → 96 | 12 → 17 |
| Rectangle | 97 → 125 | 13 → 20 |
| Perspective | 90 → 111 | 13 → 17 |

For rectangles, nutrient recovery rose from **50.8% to 65.4%** (+14.7 percentage points, calculated before rounding). No wrong owner-verified readings remain in this pilot replay, but 66 rectangle nutrient fields and 10 serving fields are still missing. Zero observed errors in 15 products does not establish production reliability.

## Examples and historical regressions

Product 03 no longer assigns zinc's `1.62mg` to vitamin D or treats `30%` as zinc's mass. Zinc is recovered correctly; unreadable vitamin D stays null. Product 07's perspective table recovers all supported core rows after recognizing the protein label. Product 13's rectangle recovers its curved column and two fragmented serving fields. Product 15 gains joined-name/IU readings but still leaves corrupted sugar-unit rows unresolved. Serving gains include punctuation-only exact-string fixes as well as newly assembled fields; they are not all newly recognized content.

Historical exact counts are unchanged:

| Exposed cohort | Nutrients correct/readable | Serving correct/readable | Wrong scored fields | Annotated false positives |
| --- | ---: | ---: | ---: | ---: |
| Desktop, 30 cases | 176/371 | 19/59 | 4 | 1 |
| Mobile, 8 cases | 121/124 | 8/10 | 0 | 0 |

No previously correct historical scored field was lost. The desktop errors/false positive predate this change and remain unresolved. One additional desktop output, `label-026` calories from fat `10kcal`, is **unreviewed**, so it is not counted as an accuracy gain. Complete field deltas remain in the local comparison artifacts.

## Verification and reproducibility

- `npm test`: **145 tests passed**, including 25 new parser tests and seven comparison-gate tests.
- `npm run type-check:evaluation`, `npm run lint`, and `npm run build`: passed. Build includes app type checking; existing OpenCV browser-externalization and large-bundle warnings remain.
- Frozen development/validation comparisons passed. Repeating validation was correctly rejected without overwriting results.
- Parser tests cover raw-OCR immutability, reordered/scaled boxes, source-index fidelity, missing values, damaged units, %DV blockers, competing columns/panels, IU/RE, serving ambiguity and explicit-fragment joining.

The [Phase 5 guide](../evaluation/phase5/README.md) contains reproduction commands. The [compact baseline](../evaluation/baselines/phase-5-2026-10-11.json) tracks source/input/artifact hashes, owner and expanded counts, gates and reserved-product field evidence. Full artifacts are under the gitignored `evaluation/results/phase-5-release-2026-10-11/`. Seven sanitized OCR-only development fixtures are tracked; no photos, device details or held-out fixtures were added.

## Limits and next step

The three input variants share the same 15 photos; they are not 45 independent test images. The five reserved products were previously reported in Phase 2 and Phase 4 and were excluded from Phase 5 parser tuning; they are not a fresh external blind dataset. Their gain is only one field, so most improvement is demonstrated on development layouts, not broad unseen-label generalization. Supplemental visual annotations remain provisional and separate from owner-verified primary metrics.

This is a frozen OCR replay, not a fresh recognition, phone-speed or deployment test. OCR digit errors and damaged/missing units remain major limits. The next accuracy check should use new owner-verified labels and real-phone captures, reserved before any further tuning, with explicit absent/unreadable negatives. Do not tune further against the five now-exposed Phase 5 validation products.
