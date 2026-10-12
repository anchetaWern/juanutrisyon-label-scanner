# Experiment A: targeted digit/unit re-recognition

Local experiment only. Production OCR, parser, review UI, confidence rules and exports are unchanged. See the [implementation audit and plan](../../docs/experiment-a-implementation-plan.md) and [specification](../../experiment-a-targeted-digit-unit-rerecognition-spec.md).

## Run development

Requires installed dependencies, the local Phase 2 source photos, and its complete baseline directory. No API key or cloud OCR is used. The first browser run downloads the existing Paddle/ONNX models. Images stay local.

```sh
# Generate source crops and pending review suggestions; does NOT run OCR.
npm run experiment:a -- prepare --out evaluation/results/a-review

# Inspect review.html and review/*-sheet.png. Edit a COPY of review-manifest.json.
# Make a new immutable preparation using that region-review overlay.
npm run experiment:a -- prepare --manifest <review.json> --out evaluation/results/a-development
npm run experiment:a -- develop --out evaluation/results/a-development
npm run experiment:a -- report --out evaluation/results/a-development
```

For the supplied provisional six-product development review:

```sh
npm run experiment:a -- prepare --manifest evaluation/datasets/experiment-a-development-review.json --out evaluation/results/a-reproduction
npm run experiment:a -- develop --out evaluation/results/a-reproduction
```

The tracked overlay records Codex visual inspection, not an independent human audit. It deliberately includes baseline-correct controls, errors, unitless regions, explicit percentages, two nutrition bases, and inverted text. It is a partial development sample, not a representative or blind benchmark. Pending regions remain visible, excluded from OCR and correctness denominators. Keep owner JSON unchanged.

Only rectangle inputs are supported initially. Boxes are mapped from saved OCR dimensions through the original rectangular offset/scale to source photos. Incomplete/invalid mapping, EXIF rotation, perspective inputs and oversized images/crops fail explicitly. Crops use 20% padding **on each side**, round outward and clamp to the photo. B/C preserve color at 1×/2× without global contrast/sharpening; browser canvas uses high-quality smoothing for 2×. They use unchanged PP-OCRv6 tiny models and detector settings. PaddleOCR.js 0.4.2 exposes no public recognizer-only call: the local pass does detection plus recognition, which affects interpretation of gains/losses.

## Review overlay contract

`review-manifest.json` contains the baseline-run SHA-256, exposed-product IDs, optional fresh reserved image IDs/provenance, optional phone limits, and region overrides. A reviewed record needs:

- Stable candidate/image ID, selected nutrient (or null) and explicit basis/column identity.
- OCR-space axis-aligned bounds. Inline boxes require a manually reviewed value region; do not estimate character coordinates and call them verified.
- Baseline line indexes and, when safely replayable, one exact `[start,end)` character span on one baseline line. Fragmented values without a safe span can be recognition-scored but are explicitly not replayable.
- Printed-region numeric truth and printed unit, or explicit unreadability. Use `unit: null` when the unit appears only in a heading/name outside the region. Do not infer kcal/g/mg from a nutrient name.
- Review status/note, transcription provenance and baseline failure class: none, recognition, association, basis, detection, unreadable or unknown.

The initial selector suggests existing parser evidence, unique adjacent value-like boxes, then other value-like boxes. It never receives expected numeric values. Suggestions are **not** automatically verified. Original `parserField` and raw evidence survive when review fixes the region's identity. Manual overrides/new regions are supported when tied to existing OCR evidence. Detection failures with no OCR evidence remain dataset-level gaps rather than forced recognition candidates in this first implementation.

Exact scoring trims/collapses whitespace, standardizes unit case and the two Unicode micro symbols. It does not repair O/0, l/1, q/g, decimals or convert units. `µg` and `mcg` remain distinct printed spellings. Numeric qualifiers and decimal strings are preserved. Unit scoring is independent of valid numeric recognition: `Og` can have the correct unit and wrong digits. Combined accuracy requires both printed numeric and unit truth; unitless crops contribute numeric accuracy only.

Local result selection first keeps boxes whose centers lie inside the original unpadded target bounds, mapped into the local OCR image. Padding text remains in raw diagnostics. It then joins at most three fragments on one row in spatial order. Multiple readings/rows abstain; confidence never chooses an answer. All raw local lines and scores remain saved. Primary scoring uses frozen region/nutrient/basis links. Secondary replay copies baseline OCR and substitutes only reviewed, nonoverlapping spans, preserving baseline geometry, nutrient names and other columns. Empty/ambiguous local output clears that span; provider failure skips it and is explicitly counted. Replay is hypothetical evaluation, not a production replacement policy.

## Reserved data and freezing

All 15 historical pilot products are exposed development data, including the old five-product holdout. A fresh reserved collection must already have complete compatible pilot baseline artifacts from the unchanged production engine. Use `--baseline <directory>` during preparation, list genuinely fresh products in `reservedImageIds`, attest provenance, and retain every known exposed product in the exposure registry. The loader additionally rejects the checked-in pilot/mobile exposed IDs. Alias/product overlap across all historical corpora still needs owner review; IDs alone cannot prove product independence.

```sh
npm run experiment:a -- freeze --out evaluation/results/a-development
npm run experiment:a -- validate --out evaluation/results/a-development
```

Freeze requires completed development and locks plan/development hashes. Validation refuses the historical pilot as reserved and refuses a second completed validation. An interrupted run resumes completed label/scale jobs only with identical plan, code, input and crop hashes. Recorded failures are retained, not retried until a lucky success. A changed review, setting, scorer or runtime requires fresh preparation. Development is blocked after freeze/validation starts. `report` can reread immutable completed artifacts without new OCR.

The accepted practical gates are ≥10% of baseline recognition failures recovered, net combined improvement, zero reserved baseline-correct regressions, zero new/changed wrong populated fields, gains spanning products/patterns, no crop/provider failures, and complete secondary replay. Overall relative combined accuracy improvement is reported separately, since relative improvement within a baseline-failure subset has a zero denominator. These are experiment gates, not statistical guarantees or authorization to ship.

Phone latency requires a frozen manifest `phone` object with `device`, `medianLabelMs`, and `p95LabelMs`. Run `develop`/`validate` with `--manual` to print a local browser URL. The server binds loopback only; forward that port to a phone (for example with an existing USB development connection). Desktop/headless measurements cannot pass the phone gate. Record the exact phone/browser with the capture notes. Use a fresh experiment directory for a distinct device measurement; do not mix desktop and phone timing sessions and claim phone-only results.

## Outputs and limitations

- `plan.json`, `identity.json`, `review-manifest.json`: frozen configuration, review, source hashes, baseline data, and experiment identity.
- `development-run.json` / `reserved-run.json`: actual raw OCR, candidate timings, label timings, session environment/initialization and provider errors.
- `actual/`: lossless browser-generated inputs used by OCR, with dimensions and hashes.
- `review.html`, `review/`: source overlays, source-crop previews, contact sheets and before/after diagnostics. Sharp previews are distinct from actual browser inputs.
- `report.md`, `report.json`, `fields.csv`: exact scores, paired gains/losses, owner-only and expanded hypothetical parser outcomes, failure categories, digit/unit/condition/height breakdowns, timing and adoption gates.
- `frozen.json`, `validation-started.json`, `validation.json`: study lifecycle evidence when available.

Initialization is measured separately. Per-label added latency includes source load and sequential crop extraction, local resize/PNG encoding, and recognition. Diagnostic serialization/transport is excluded. JS heap size is recorded when the browser exposes it; it is not total WASM/browser memory. The p95 uses a nearest-rank estimate and is descriptive on small samples.

The development sample does not establish detection recall, independent readability labels, general phone performance, or production trigger/conflict handling. Source detail lost during capture cannot be recovered. Current source photos may already fit below the production resize cap; review dimensions before attributing a gain to access to higher resolution. Do not add padding/preprocessing variants from reserved outcomes. A negative result is a valid outcome and can motivate an alternative recognizer comparison on the same crops.

## Checks

```sh
npm test
npm run type-check:evaluation
npm run build
npm run lint
```

The experiment tests cover source mapping, clipping, strict numeric/unit scoring, ambiguity, paired regressions, immutable replay, input/source identity, reserved exposure, review validation, and checkpoint safeguards. No app import references this harness.
