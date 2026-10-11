# Phase 2 pilot findings — 2026-10-11

The pilot is complete: all 15 supplied photos were evaluated as original images, rectangular panel crops, and perspective-corrected crops (45 OCR cases, no provider failures). It establishes a reproducible baseline and identifies failure cases; it does **not** complete production warning calibration or establish general accuracy across phones and packaging.

No production OCR configuration, extraction logic, capture thresholds, or UI behavior was changed. The implementation adds dataset validation, batch preparation/recognition, saved-OCR replay, interruption recovery, and field-level comparisons. It uses the app's PaddleOCR engine, not an OpenAI API model.

## Primary results: owner-verified labels only

The owner supplied 191 nutrient strings and 30 serving strings. Results use the existing `field-exact-v1` metric. Correct/readable measures field recovery; omitted fields remain in the denominator. A wrong output differs from a missing output. Punctuation mismatches still count as wrong strings, even if their quantities agree.

| Input | Correct nutrients | Nutrient recovery | Correct serving fields | Wrong nutrients | Wrong serving strings |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original photo | 71/191 | 37.2% | 12/30 | 0 | 4 |
| Rectangular crop | 97/191 | 50.8% | 13/30 | 2 | 5 |
| Perspective-corrected crop | 90/191 | 47.1% | 13/30 | 1 | 3 |

Rectangular cropping recovered 26 additional nutrient fields overall, but introduced two incorrect nutrient assignments. Straightening was not consistently beneficial. These are results from selected reference corners, not proof that automatic panel detection achieves the same improvement.

| Input | Development nutrients | Validation nutrients | Development serving | Validation serving |
| --- | ---: | ---: | ---: | ---: |
| Original photo | 47/137 | 24/54 | 9/20 | 3/10 |
| Rectangular crop | 70/137 | 27/54 | 10/20 | 3/10 |
| Perspective-corrected crop | 62/137 | 28/54 | 10/20 | 3/10 |

Development products: 01, 03, 04, 06, 07, 09, 10, 12, 13, 15. Validation products: 02, 05, 08, 11, 14. The split and geometry were selected before recognition. All variants of a product remain in the same split. There are only five validation products, from the same supplied collection; annotations required viewing those images. Do not treat this as a large blind or independent capture-source test, or pool the 45 cases as independent photographs. The one-field validation advantage for straightening is insufficient to select a default.

## Expanded audit and review requirements

The expanded audit adds nine readable calories-from-fat values and seven absent-field annotations, yielding 200 readable nutrient fields plus the original 30 serving fields. Nutrient matches become 75/200, 102/200, and 95/200 respectively. The original-photo variant has one false positive among seven annotated absent fields; both crop variants have zero.

These supplements, panel corners, and qualitative condition tags were reviewed by Codex and **still need independent human verification**. They are excluded from the primary owner-only comparison. Original JSON and photos were not modified. Unspecified fields remain unreviewed, not automatically absent or unreadable.

Items to adjudicate before changing annotation/scoring policy:

- Products 01 and 12: `1.06 oz (30g)` versus OCR punctuation such as `1.06 oz. (30g)`. This is a strict string mismatch, not a wrong amount.
- Product 06: leading commas in `, 56g` and `, about 3` explain serving-string mismatches. Do not confuse these with numeric errors.
- Product 15: the owner key is `vitamin_d`, while the panel prints D3; product 13 uses `vitamin_d3`. Preserve the supplied keys until a consistent semantic policy is reviewed.
- Review the nine supplemental values, seven absent-field decisions, and the selected upper panels on products 04 and 10. The full original-photo variants intentionally retain competing panels.

## Useful failure cases

These observations guide subsequent work; they are not permission to tune against validation cases.

- **Competing panels (04, 10):** selecting the intended panel substantially improves recovery. In original photo 10, `24kcal` from the lower panel is incorrectly assigned as calories from fat for the selected upper panel. Cropping removes that false positive in the expanded audit.
- **Wrong row/value association (03):** the rectangle assigns zinc's `1.62mg` to vitamin D and `30%` to zinc. OCR also reads several gram units as `8` and misreads the vitamin D amount/unit. Both recognition and association need attention.
- **Straightening regression (07):** expanded correct-field counts fall from 13 in the rectangle to 4 after straightening. Many numbers remain present, while the protein label becomes `Toial Protein (g)`. This is a regression fixture for fragile label/value association, not evidence that every lost field has that single cause.
- **Curved/folded packaging (12, 13):** a four-corner perspective transform cannot flatten nonlinear folds. On 13, the serving phrase is split across OCR lines, and all variants assign `1kcal` instead of the supplemental `6kcal` calories-from-fat target.
- **Compact/inverse text (15):** all three variants recover only two expanded fields. Several nutrient names and unit glyphs are malformed despite recognizable numbers. This is a development case for targeted recognition experiments.
- **Validation observations, reserved for evaluation:** product 05's two serving bases produce no correct fields in any variant; 14 has separate unit/amount columns and low recovery; 08 is fully recovered in all variants. Do not turn these five held-out products into tuning fixtures without obtaining a new untouched validation set.

The presence probes now recognize IU, µg RE, hyphenated Omega names, and Unicode D₃. This improves diagnostic triage only: no unit conversion, extraction change, or relaxation of exact matching was introduced.

## Quality warnings and panel suggestions

There were no quality-check failures. The provisional visual review marked panel reflections on products 01, 04, 09, and 14; the glare warning fired on none of them in any variant. Visible reflection does not mean a nutrient is unreadable. The set contains no verified unreadable nutrient fields or representative blurred/obscured examples, so these counts cannot establish a safe rejection threshold.

For small text, development recall was 2/4 on original/rectangular images and 3/4 after straightening. On the single tagged validation example, only the original-image check warned; rectangle also produced one false positive. These small counts and qualitative tags do not support production calibration.

Edge suggestions were offered on 2/15 originals (neither close to reference) and 6/15 rectangular crops (three close). There were no suggestion-worker errors. “Close” means every corner is within 5% of the reference panel diagonal; it is not measured text-region coverage or proof that every row is retained. Suggestions were recorded, not applied to choose the reference crops.

**Decision: retain current production thresholds and keep straightening optional.** Development-only threshold exploration is saved in `calibration.json`; no threshold was selected from validation outcomes.

## Runtime and reproducibility

The run used production configuration `v6-tiny-recall-v2`, PaddleOCR.js 0.4.2 / PP-OCRv6 tiny, desktop headless Chrome 154, and the WASM backend. Initialization took about 4.05 seconds separately from recognition. Mean/p95 per-image processing was 2258/2709 ms for originals, 908/1464 ms for rectangles, and 915/1438 ms for perspective crops. These are one desktop batch, not phone timings or repeated performance trials.

Dataset fingerprint: `425705706287eec5111d543c75e9b73eed8387d236a755603b8e39becb1c989c`.

The [compact baseline](../evaluation/baselines/phase-2-2026-10-11.json) records counts, runtime/configuration, source hashes, and hashes of the complete local artifacts. The study date follows the client date; machine timestamps are retained unchanged in raw artifacts.

The full local run is in `evaluation/results/phase-2-pilot-2026-10-11/`:

- `review.html`, `review/`, and `crops/`: original/crop visual review.
- `run.json`: all raw OCR and checkpoint/runtime metadata.
- `comparison.md`, `comparison.json`: owner-only and expanded paired results.
- `report.md`, `report.json`, `fields.csv`: expanded per-field evidence.
- `calibration.json`: provisional warning assessment and development-only exploration.

Photos, owner JSON, and generated artifacts remain gitignored. See the [runner instructions](../evaluation/pilot/README.md) to prepare a fresh run, resume an interruption, or replay OCR without another recognition pass.

An isolated resume integration check started with 44 saved cases and completed only the remaining case. It preserved all first 44 results, produced 45 completed cases, and recorded two initialization sessions. The original baseline was not overwritten. Regression checks preserved the Phase 1 frozen-replay results; unit tests, app/evaluation type checks, lint, and production build passed.

## Next work

1. Independently review the supplemental annotations, corners, and condition tags; obtain additional photos with verified blur, obstructive glare, clipped rows, and unreadable fields before production warning calibration. Include real-phone measurements.
2. Use development cases for the planned recognition/preprocessing experiments, preserving original/rectangle/perspective comparisons and measuring wrong assignments as well as recovered fields.
3. Use saved development OCR for parser work on fragmented serving text, unit/name recognition, competing panels, and row/column association. Add regression tests for incorrect assignments rather than increasing output coverage alone.
4. Keep validation products unchanged and report them separately for each preselected candidate. If their errors become development examples, replace the holdout before claiming generalization.

The Phase 2 pilot is sufficient to start evidence-driven follow-up work. Broader calibration remains pending new independently reviewed examples; this implementation does not silently advance into the later recognition/parser phases.
