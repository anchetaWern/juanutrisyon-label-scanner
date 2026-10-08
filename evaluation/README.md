# Accuracy evaluation — Phase 1

Run the portable baseline from a clean checkout with installed dependencies:

```sh
npm run evaluate
```

This replays the eight tracked mobile OCR fixtures through the current production parser. It requires no browser, network, private images, OCR download, or API key. It writes `evaluation/results/latest/report.json`, `report.md`, and `fields.csv`. The harness and annotations are tracked; generated results are ignored.

To include the existing local, gitignored desktop corpus:

```sh
npm run evaluate -- --legacy benchmark --out evaluation/results/phase-1
```

Both cohorts are reported separately. Requested legacy inputs must exist; malformed files, duplicate IDs, unmatched manifests, stale corrections, invalid geometry, and product split conflicts within a cohort fail the command. No cases are silently skipped. The inherited label-030 holdout/mobile-regression overlap is exposed separately and disqualifies that product as a blind holdout. Historical split assignments are preserved.

To evaluate a saved OCR experiment from the old harness against the same annotations:

```sh
npm run evaluate -- --legacy benchmark --run benchmark/results/mobile-color.json --out evaluation/results/mobile-color
```

This changes only the **legacy** cohort's OCR input. Mobile regression fixtures remain frozen. A fresh recognition experiment must first save a run using the existing OCR harness. This evaluator does not rerun OCR or measure current device speed.

## Annotation contract

Annotations are independent of the current parser output. Each case has an ID, product ID, cohort, historical split, provenance, tags, and a `fields` map. Nutrients use production keys; serving fields use `serving.serving_size` and `serving.servings_per_container`.

Each field is one of:

| Representation | Meaning | Scoring |
| --- | --- | --- |
| `"3.3g"` | Readable printed value | Exact output is correct; null is missing; a different value is wrong |
| `{ "status": "absent", "note": "Not printed" }` | Confirmed absent from selected panel | Null is a correct abstention; any value is a false positive |
| `{ "status": "unreadable", "note": "Glare obscures a digit" }` | Printed field cannot be completely read in this input image | Null is a correct abstention; any populated value is unsupported and counted as a false positive |
| `{ "status": "unreviewed", "note": "Not transcribed" }` | Ground truth is unknown | Excluded from correctness denominators; emitted values enter a review queue |

Missing annotations are also unreviewed, never assumed absent. Null is rejected as ambiguous ground truth. A legible image with damaged **OCR** is still a readable target: new-1's serving size is `1/3 cup (40g)`, new-2's count is `About 6`, and new-3's fat is `3.3g`, despite current parser abstentions. The five older mobile images are unavailable in this checkout; those annotations inherit the earlier documented image review. Six older serving fields and one calories-from-fat field remain unreviewed.

`annotations/legacy-corrections.json` applies reviewed corrections in memory and checks the expected old value before applying each one. It leaves the existing labels, legacy annotations, and raw OCR intact. The overlay fixes two nutrient reference errors, the printed serving grouping on label 001, the mass on label 009, and the unreadable serving field on label 019. Readable serving errors on labels 008 and 014 were also checked against their images. The remainder of the older corpus is inherited owner-verified data, **not a newly completed full visual audit**.

The current annotations cover selected fields, not every printed row. In particular, eight emitted legacy calories-from-fat values are unscored. Future transcription should review the whole selected panel, including fields the parser never emits, to avoid selecting annotations based on successes.

## Metric definitions (`field-exact-v1`)

| Metric | Numerator / denominator |
| --- | --- |
| Exact recall | Correct field/value pairs / readable annotated fields |
| Precision | Correct / (correct + wrong + false-positive outputs); unreviewed outputs excluded and counted separately |
| Coverage | (Correct + wrong) / readable annotated fields |
| Abstention rate | Missing outputs / readable annotated fields |
| False-positive rate | Outputs on absent/unreadable fields / annotated absent/unreadable fields |
| OCR name presence | Readable fields whose name/alias appears in recognized lines / readable fields |
| OCR amount/string presence | Readable fields whose bounded value appears in recognized lines / readable fields |

All ratios with zero denominators are `null`/N/A, not 0% or 100%. Counts accompany every aggregate. Nutrients and serving fields are separated, as are cohorts and historical splits. JSON additionally reports results by field and tag. Tags can overlap; do not sum tag groups.

Normalization changes case, whitespace, Unicode microgram spelling, and `less than` versus `<`. It does not repair OCR letters/digits, round values, convert units, change fractions, remove qualifiers, or remove parentheses. For example, `1mg` differs from `1g`, `<1g` differs from `1g`, and `About 6` differs from `6`. Strict string differences, including `1.0g` versus `1g`, may need manual adjudication rather than a parser change. Serving semantics are not inferred.

Exact field scoring catches swapped row assignments even when both numbers occur elsewhere in OCR. The name/value presence probes search individual recognized lines across the panel and may match another row or nutrition basis. They do not join detached text boxes, so correctly parsed split units can have a negative presence probe. They are triage aids, not measures of row accuracy, detector recall, or proven error causes. Bounded tokens fix the old `0g`-inside-`10g` scoring problem; the legacy composite metric is unchanged for historical comparisons.

**Detection recall is N/A** until independently drawn ground-truth text regions are available. Missing text in OCR alone cannot distinguish detector failure from recognition failure. The current negative set contains one reviewed mobile absent field and one reviewed legacy unreadable serving field; it is too small for a meaningful general false-positive estimate. Synthetic readable/absent/unreadable cases exercise the scorer in tests and are excluded from real-image aggregates.

## Artifacts and reproducibility

- `report.json`: outcomes for every annotated or emitted field, original evidence indexes, parser warnings, triage categories, per-cohort/split/tag/field metrics, product overlaps, and input/code SHA-256 digests.
- `report.md`: scannable baseline, ranked error queue, per-case totals, and suspicious/unscored outputs.
- `fields.csv`: quoted review worksheet with truth, output, outcome, original evidence, and warnings. Formula-like raw strings are escaped for spreadsheet use.
- `baselines/phase-1-2026-10-08.json`: tracked summary and source digests for the initial combined replay. Full local detail is under `results/phase-1/`.
- `../docs/accuracy-baseline-2026-10-08.md`: tracked human-readable initial combined report.

Outputs are deterministic for unchanged inputs and code; there is no run-time timestamp. Source digests identify the frozen OCR, ground truth, correction images, and implementation. A new experiment should use a new output folder and the same annotations. Compare each cohort and split separately; the small mobile regression set is not a generalization estimate. Recorded desktop processing times exclude initialization; the sanitized mobile fixtures have no timing. No phone latency measurement is fabricated.

Validation:

```sh
npm test
npm run type-check:evaluation
npm run lint
npm run build
```

## What this baseline makes possible next

Phase 2 can add a representative image set, full independent transcriptions, readable/unreadable labels, text-region annotations, device timings, and product-disjoint new holdouts. Existing historical holdouts have already been inspected. Recognition and extraction improvements in later phases should be evaluated against readable-field recall, wrong outputs, negative-field outputs, and runtime together; a reduction in abstentions alone is not enough.
