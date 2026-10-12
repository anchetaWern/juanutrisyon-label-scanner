# Experiment A Results

## Dataset

The experiment harness is implemented and the reviewed development comparison is complete. **The current variants should not be adopted.** Production scanner/OCR/parser behavior is unchanged.

- Loaded development corpus: 15 exposed pilot photos, including the previously exposed five-product holdout.
- OCR comparison: 79 visually reviewed regions across six products; 192 additional suggestions remain pending and were not recognized or scored.
- Printed value+unit targets: 40; numeric-only targets with units outside the region: 39.
- Baseline recognition failures with printed units: 10; one separately identified association failure.
- Fresh reserved labels: none. Reference-phone latency: not measured.

Region transcriptions are provisional Codex visual reviews of source crops and full labels, with owner JSON used for row identity. They are not an independent human audit. The six products cover split tables, decimals, g/mg/mcg/µg/kcal/kJ/%, curved packaging, multiple bases, and light text on dark packaging. This reviewed subset does not cover glare, verified blur/unreadability, or text heights ≤20 source pixels. These are development findings, not general accuracy estimates.

## Variants

Baseline A is saved production PaddleOCR.js 0.4.2 / PP-OCRv6 tiny output. B and C re-read original-photo regions at 1× and 2× with 20% padding per side and minimal original-color preprocessing. The detector threshold, models, production preprocessing defaults and `spatial-review-v5` parser are unchanged.

The installed public SDK does not expose recognition-only inference, so B/C perform **detection + recognition**. Results therefore include detector/crop effects. Source photos are 1536×2048, already below the production resize cap; this sample does not establish a benefit from recovering source detail lost to downscaling.

Before the final freeze, a development-only diagnostic iteration corrected local-output selection to exclude boxes centered outside the original unpadded target bounds. Padding text remains in raw diagnostics. Selection uses frozen geometry, never expected values or confidence. The final configuration was prepared and recognized afresh; earlier artifacts are retained separately.

## Recognition results

| Variant | Exact numeric | Exact unit | Exact value+unit | Recovered combined | Combined regressions | Numeric regressions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 70/79 | 32/40 | 30/40 | — | — | — |
| Local 1× | 66/79 | 28/40 | 27/40 | 1 | 4 | 6 |
| Local 2× | 68/79 | 31/40 | 29/40 | 1 | 2 | 4 |

Each variant recovers 1/10 recognition-failure targets, but loses more previously correct readings than it recovers. Overall combined accuracy declines from 75% to 67.5% at 1× and 72.5% at 2×. Numeric-only regressions remain visible rather than disappearing from combined scoring.

Exact scoring preserves digits, qualifiers, decimal spelling and unit spelling. It does not repair O/0 or q/g. `µg` and `mcg` are distinct printed spellings; the two Unicode micro symbols are equivalent. Unreadable/unreviewed targets do not enter exact denominators.

## Full-pipeline secondary results

Only reviewed nonoverlapping value spans were substituted in a copy of baseline OCR. Nutrient names, unrelated columns, geometry and parser code were preserved. All 79 reviewed regions had replay mappings. The counts below cover all 15 loaded labels, including unchanged untargeted labels.

| Variant | Owner correct nutrients | Missing | Wrong populated | Expanded correct nutrients | Previously correct parser fields lost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 147/191 | 44 | 0 | 156/200 | — |
| Local 1× | 146/191 | 44 | 1 | 155/200 | 1 |
| Local 2× | 146/191 | 44 | 1 | 155/200 | 1 |

Both hypothetical replays populate Tang vitamin D as `30%` instead of the owner target `1.5µg`, after the mass reading becomes unusable and the unchanged parser selects a neighboring percentage. This is a secondary association consequence of recognition changes, not an exact-recognition success. Both also lose the previously correct saturated-fat field on the brown milk label. Serving results remain unchanged: 26/30 correct, four missing, zero wrong.

**These replacements were never applied to the production scanner or saved baseline OCR.** The extra wrong field fails the safety requirement even if individual readings improve.

## Reserved-set results

Unevaluated. The historical holdout is exposed and cannot establish a fresh reserved result. The CLI refuses to treat those products as fresh reserved data. Given the development losses, there is no basis to recommend production adoption while awaiting new captures.

## Latency

Desktop headless Chrome, WASM, one initialized engine, sequential candidates. Initialization and diagnostic serialization/transport are excluded. Label time includes source loading, extraction, resizing/PNG encoding and inference. These six-label timing estimates are descriptive.

| Variant | Candidate median / p95 | Added label median / p95 |
| --- | ---: | ---: |
| Local 1× | 20.3 / 54.6 ms | 254.0 / 750.3 ms |
| Local 2× | 23.1 / 66.6 ms | 263.8 / 1000.6 ms |

There were zero crop failures or provider exceptions across 158 local passes. Browser-exposed JS heap observations are recorded in session metadata; they do not measure total WASM/browser memory. Phone acceptability remains unevaluated.

## Failure analysis

### Digits

Numeric accuracy decreases at both scales, including losses on correct numeric-only controls. The CDO `20` crop is a correctly read calories-from-fat value that the baseline parser selected as energy; it is classified separately as association failure.

### Decimals

Among 13 decimal value+unit targets, 1× scores 7/13 and 2× scores 10/13. A baseline-correct `12.9 g` is locally read as `12.99`, illustrating a unit/digit confusion rather than a missing source digit.

### Units

The 2× variant recovers the yellow-snack `Omcg` as `0mcg`, but regresses another baseline-correct `0mg` to `Omg`. Gains on one zero/unit combination do not justify unconditional rerecognition.

### Tiny text

The tested source text heights are above 20 pixels. Smaller text remains a coverage gap.

### Glare

No reviewed glare regions in this run. Do not infer performance on glare or unreadable sources.

### Curved labels

Curved-label combined accuracy is 16/21 at 1× and 19/21 at 2×. Padding sometimes includes fragments of adjacent rows, and an additional detector pass can split or merge them differently. The geometry rule removes out-of-target detections conservatively; remaining ambiguity is explicit.

## Representative recoveries

- Tang energy daily-reference percentage: baseline `2%`, 1× `<2%`, matching the printed qualifier.
- Yellow-snack vitamin D: baseline `Omcg`, 2× `0mcg`.

## Representative regressions

- SPAM total fat per 56 g: baseline `12.9 g`, local `12.99` at both scales.
- Yellow-snack calcium: baseline `0mg`, 2× `Omg`.
- Brown milk saturated fat: a correct numeric reading is lost, and parser replay abstains.

## Conclusion

**Negative on this reviewed development sample.** Neither local original-color 1× nor 2× preserves baseline accuracy or the zero-wrong-population requirement. This does not prove every localized-recognition approach fails; it rejects these measured variants as production candidates.

## Recommendation

Keep production unchanged. Preserve these crops and diagnostics for a separate alternative-recognizer comparison rather than adding broad preprocessing combinations. Fresh product-disjoint reserved captures, independent region review and reference-phone measurements are required before any future production recommendation. Any later padding study should be narrowly motivated by the recorded neighboring-row contamination and use development data only.

## Implementation and regression checks

- No changes under `src/`, no production model/threshold/parser/export/confidence changes, and no dependency changes.
- All 247 tests pass, including 23 new experiment checks for mapping, scoring, immutable replay, reviewed truth, exposure/splits, checkpoints and safety metrics.
- Production build, application type check, evaluation type check and lint pass.
- Existing portable mobile replay: 121/124 correct nutrients, 8/10 correct serving fields, zero wrong values and zero false positives.
- Final experiment is frozen; changes require a fresh output directory. Fresh reserved validation is intentionally incomplete.

See the [harness guide](../evaluation/experiment-a/README.md) and [tracked compact baseline](../evaluation/baselines/experiment-a-2026-10-12.json). Full local artifacts are in `evaluation/results/experiment-a-final-2026-10-12/`: `report.md`, `report.json`, `fields.csv`, `review.html`, raw run checkpoints, hashed actual OCR inputs and frozen plan. They remain gitignored alongside the private source photos.
