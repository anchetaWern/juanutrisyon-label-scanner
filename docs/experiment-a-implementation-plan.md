# Experiment A implementation plan

Planning date: 2026-10-12. This document proposes implementation; it does not change scanner behavior or report experimental results.

## Approach

Build an offline, browser-based experiment under `evaluation/experiment-a/`, using the existing Paddle models, frozen baseline OCR, and unchanged current parser. Start with rectangle-label inputs, 20% padding, and original-color local crops at 1× and 2×. Map boxes back to original photographs before extracting pixels. Keep recognition scoring independent of parser normalization and report parser replay separately.

The experiment can be implemented and tested on existing data now. A production recommendation requires fresh reserved products and phone timing; the existing pilot is useful development evidence but is no longer a blind holdout.

## A0: integration audit findings

| Required integration point | Current implementation and implication |
| --- | --- |
| Retained source image | `src/composables/useNutritionLabelScanner.ts` retains `originalFile` and `croppedBlob` separately. Original pixels remain available during the scanner session. The experiment should read benchmark source photos directly. |
| Crop lifecycle | `ScannerCropper.vue` renders rectangular crops with a 2400-pixel cap. Perspective rendering adds another transform. A retained crop is therefore not necessarily full resolution. |
| OCR geometry | `src/services/ocr/types.ts` stores axis-aligned `bbox` on lines and optional tokens. `PaddleOcrEngine.normalizePaddleItems` discards provider polygons in favor of their bounding rectangles. Existing saved rectangles suffice for the initial axis-aligned experiment. |
| Text and confidence | `OcrResult` contains aggregate text, lines, engine/version, prepared-image `sourceSize`, preprocessing ID, and diagnostics. Paddle scores become 0–100 confidence. Preserve baseline objects unchanged; retain complete experimental results too. |
| Saved-OCR replay | `evaluation/load.ts`, `evaluation/metrics.ts`, pilot reports, and Phase 5 already replay stored OCR through `parseNutrition`. Reuse their field-level evaluator for secondary metrics. |
| Ground truth | Pilot paired files live in `labels/nutrition_labels_json`; resolved annotations and source hashes are in pilot `dataset.json`. `evaluation/datasets/phase-2-pilot.json` records product IDs, splits, panel corners, conditions, and separately marked supplements. Portable mobile fixtures exist, but some lack source photos and cannot support fresh local recognition. |
| Association evidence | `parseNutrition` returns field evidence containing `lineIndexes`, raw text, and method. Evidence can include the nutrient name and value together, several fragments, or unresolved name-only evidence; it does not provide exact character geometry. |
| Coordinate transforms | OCR boxes refer to the preprocessed input dimensions. Preprocessing can resize to 2400 pixels. Pilot `prepared.json` records rectangular offsets, output sizes, and perspective output-to-source matrices. Exact scale ratios must use recorded dimensions, including rounding. |
| Diagnostics | Pilot galleries, per-field CSV, JSON run checkpoints, and Markdown reports provide existing conventions. Add a candidate gallery rather than a scanner UI. |
| Timing | `PaddleOcrEngine` already measures initialization, preprocessing, prediction, detector, recognizer, and total time using `performance.now()`. The pilot also records job durations and browser environment. |
| Region extraction | Pilot preparation contains canvas crop code. `perspective.ts` supplies `mapPoint` and output-to-source homographies. There is no dedicated nutrient-region extractor to reuse directly. |

Two spec assumptions need updating: the installed SDK is 0.4.2, but the current parser is **`spatial-review-v5`**, not v3. Freeze the current parser rather than reverting it. The installed public Paddle API exposes `predict`, including detection and recognition; it does not expose a public recognizer-only method. Use detection + recognition and label that limitation explicitly, without SDK patching or private API access.

## A1: candidates and original-image crops

Proposed modules: `types.ts`, `dataset.ts`, `candidates.ts`, `geometry.ts`, `crops.ts`, and focused tests under `evaluation/experiment-a/`.

1. Load the completed Phase 2 run and its prepared/dataset manifests. Verify image, baseline OCR, and manifest hashes. Select rectangle inputs for the primary experiment; preserve original/perspective inputs as optional separate cohorts.
2. Freeze parser output once per baseline label. Select candidates first from associated evidence, then unresolved row evidence, adjacent boxes, and value-like boxes. Record selection provenance and deduplicate shared regions. Include baseline-correct values as well as errors so regressions are measurable.
3. Keep the OCR candidate list independent of expected numeric values. Ground truth must not choose a favorable OCR box or alternative reading. Link regions to nutrient/basis annotations in a separate review step.
4. Use whole value boxes where available; union only reviewed fragments belonging to the same value. Never union all field evidence indiscriminately, since that may include names and other columns.
5. Inline name/value boxes and boxes containing multiple columns lack character geometry. Queue these for small manual value-region annotations; do not estimate character positions and treat the result as exact geometry. Mark automatically suggested but unverified candidates explicitly.
6. Map all four OCR rectangle corners through prepared-image scaling and rectangular offsets into source-photo coordinates. For optional perspective cases, apply the saved normalized-output homography first, then rectangular scale/offset. Use the enclosing source rectangle; retain the mapped quadrilateral for diagnostics.
7. Expand each side by 20% of the unpadded source box width/height, round outward, and clamp to image bounds. Record requested versus actual padding and truncation. This defines 20% as padding **per side**.
8. Extract a lossless 1× crop from source pixels and create the 2× crop using browser canvas high-quality smoothing. Explicitly bypass production contrast/sharpening and avoid accidental additional scale/caps. Record actual output dimensions and interpolation settings.
9. Export source overlays and both crops. Manually inspect several labels covering decimals, fragments, borders, tiny text, and multiple columns before running OCR.

Coordinate metadata that cannot be verified produces an explicit unsupported/failure record. Do not substitute enhanced pixels silently. Retained source detail may already be insufficient; flag that separately from mapping errors.

## A2: localized recognition and scoring

Proposed modules: `browser.ts`, `browser.html`, `runner.ts`, `scoring.ts`, `replay.ts`, `cli.ts`.

- Reuse the pilot browser-launch, local authenticated job transport, hash validation, and checkpoint conventions. Avoid changing historical pilot artifact contracts merely to share infrastructure.
- Instantiate the current `PaddleOcrEngine` with an experiment-only preprocessing configuration: original color, scale 1, and an explicit limit that cannot shrink the prepared local crops. Preserve production models and prediction settings, including detector box threshold 0.45.
- Reuse one initialized engine and process candidates sequentially. Baseline A is the frozen existing OCR with no new baseline recognition pass; B and C process the same reviewed regions at 1× and 2×.
- Record all returned local boxes, text, confidence, exceptions, and empty outputs. Apply one predeclared geometry/order rule to join fragmented local output; ambiguous multiple readings remain ambiguous. Never choose the reading nearest ground truth or by highest confidence after inspecting answers.
- Keep raw strings and conservative scoring tokens separately. Normalize whitespace, unit case, and Unicode micro symbols only. Preserve decimal spelling, numeric qualifiers, and unknown unit strings such as `mq`; do not repair confusable letters or convert units. Score numeric, unit, and combined correctness independently with explicit eligibility denominators.
- Record printed unit separately from semantic nutrient unit. A calories row with no printed unit can receive numeric scoring, but cannot establish printed-unit accuracy. Unit headings, percentages, and additional columns need region-specific truth beyond the existing nutrient JSON.
- Use reviewed, frozen candidate-to-nutrient/basis links for recognition comparisons. Association failures and basis ambiguity are separate classifications, not digit-recognition failures. Manual classifications retain provenance; automated triage remains provisional. Allow an unknown category rather than forcing a cause.
- For secondary replay, create an experiment-only copy of baseline OCR. Replace only source spans/lines with unambiguous mappings, preserve names, unrelated columns, baseline geometry, and line identity, and run the unchanged parser. Inline or overlapping replacements require a reviewed replacement map; otherwise report them as not replayable. Preserve the original baseline object and report replay coverage.
- Report wrong populated nutrient values using existing field scoring (`wrong` plus `false-positive`), including outputs on unreadable/absent fields. Also report changed-wrong-to-different-wrong fields and every baseline-correct regression. Candidate recognition errors and populated parser errors must have separate counts.

Per-candidate records include image/product/candidate IDs, split, source hashes, field/basis identity, truth provenance, baseline line indexes/spans, frozen association, coordinate transforms, source bounds, crop hashes/paths, variant, raw OCR, scored tokens, failure classes, and timing.

## A3: development, freeze, reserved evaluation

Proposed command contract:

```sh
npm run experiment:a -- prepare --baseline <pilot-directory> --manifest <experiment-manifest> --out <fresh-directory>
npm run experiment:a -- develop --out <directory>
npm run experiment:a -- report --out <directory>
npm run experiment:a -- freeze --out <directory>
npm run experiment:a -- validate --out <directory>
```

Preparation creates reviewed candidate manifests and crops. Development recognizes only development products. Freeze locks candidate rules, padding, scales, output interpretation, scoring, replay policy, source hashes, and thresholds before validation. Validation runs the frozen variants on reserved products once; changing anything requires a new study. Resume only when all recorded identities match, with per-candidate/per-variant checkpoints and explicit failed jobs.

Use the existing pilot as development/exposed regression data, retaining historical split labels as provenance. Add fresh product-disjoint reserved captures, screened against every previously exposed corpus. Establish their baseline with unchanged production OCR. Verify desired condition/unit coverage; do not assume the 15-photo corpus covers every requested category. Annotate missing percentage/unit/column truths only where needed. Keep ground truth out of browser recognition jobs.

## A4–A5: diagnostics, analysis, recommendation

Proposed modules: `report.ts`, `gallery.ts`, plus an experiment README.

Outputs follow existing conventions: `plan.json`, `candidates.json`, `run.json`, `crops/`, `review.html`, `records.json`, `fields.csv`, `report.json`, and `report.md`. Raw assets remain under gitignored `evaluation/results/`; publish a compact dated findings document and baseline summary under tracked paths.

The report uses the spec's final-report structure and includes:

- Counts and exact numeric/unit/combined accuracy, paired recoveries/regressions, and net gain by variant and split.
- Recognition-only results for all eligible candidates and the baseline recognition-failure subset; candidate coverage and excluded/unreviewed cases remain visible.
- Full-parser replay correct/missing/wrong/false-positive fields and replay eligibility. Evaluate all annotated fields in replayable labels, not just targeted nutrients, to catch collateral effects.
- Development versus fresh reserved results, grouped by product. Multiple crops/variants of one photo are paired observations, not independent labels.
- Median/p95 candidate recognition time and added label time, separating crop/resize, provider time, initialization, and diagnostic export. Include candidates per label, labels with candidates, crop/provider failures, and available memory measurements; unavailable memory is N/A.
- Desktop measurements labeled as desktop. Support the same experiment runner in a phone browser to measure the agreed device/browser; a phone-latency gate cannot pass from desktop data alone.
- Failure analysis by digit count, decimals, unit, source text height, condition tags, failure class, and scale. Gallery entries link original image/box, source crop, scaled crop, truths, baseline/local readings, and parser evidence.

Start with B/C only. Test alternate padding, 3×, or one preprocessing follow-up only after development diagnostics justify it. Never tune these against reserved outcomes.

## Verification and completion gates

Meaningful automated checks should cover rounded resize mappings, clamped/outward crop bounds, perspective mapping if enabled, fragmented/inline/ambiguous candidate handling, strict scoring without character repair, paired recovery/regression counts, replay preserving unrelated OCR, product split separation, and immutable resume/freeze validation. Use a small browser smoke run to verify actual crop dimensions and provider outputs, then manually review crop correctness.

Run focused tests, existing OCR/parser regressions, `npm run type-check`, `npm run type-check:evaluation`, and the production build. Production engine defaults, parser behavior, export schema, confidence rules, and review UI stay unchanged.

Finish with one of the spec's four recommendations. If fresh reserved data or phone measurements are missing, deliver development findings and explicitly leave those adoption gates unevaluated. Implementation completion and final experimental completion are distinct: the latter requires reviewed crops, executed comparisons, and an evidence-based report.

## Decisions to settle before frozen evaluation

1. Fresh reserved photo availability and capture ownership. Existing exposed products cannot supply a new blind evaluation.
2. Reference phone/browser and acceptable median/p95 added label latency.
3. The spec's “10% relative improvement among recognition-failure candidates” has a zero baseline accuracy by definition. Proposed interpretation: report recovery fraction on that subset, require at least 10% recovered, and separately report relative accuracy improvement across all eligible candidates. Confirm the intended gate before freezing.
4. Proposed initial regression gate: zero baseline-correct regressions on reserved data, alongside zero increase in wrong populated values. This makes “a very small number” concrete and conservative; a different tolerance must be set before validation.

These decisions do not block building the development harness. They must be resolved before declaring reserved-data success or recommending production design.
