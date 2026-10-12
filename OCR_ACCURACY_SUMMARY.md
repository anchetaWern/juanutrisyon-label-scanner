# OCR accuracy: progress and brainstorming

Updated: 2026-10-12

## What the app does

A browser app for photographing/uploading labels and exporting review-required nutrition JSON. Processing/OCR runs locally; no OpenAI/cloud extraction is currently used.

**Pipeline:** photo → crop/optional straighten → quality advice → image enhancement → PaddleOCR → nutrient/value matching → review and export.

**Important distinction:** OCR reads characters; the parser decides which nutrient those characters belong to. Better final readings can come from improving either stage.

## What we have done

- **Capture (including Phase 3):** rotation, lossless PNG crops, optional four-corner straightening with preview, border suggestions, and advice about blur/glare/small text/clipped edges. Warnings are not calibrated guarantees.
- **OCR:** PaddleOCR.js 0.4.2 / PP-OCRv6 tiny; Tesseract remains available, not an automatic fallback. Grayscale + contrast + light sharpening. Lowering detector acceptance from 0.6 to 0.45 gave a small historical text-recall gain.
- **Measurement (Phase 1):** repeatable scoring of correct, missing and wrong fields; saved-OCR replay, source evidence, diagnostics, crop export and regression tests.
- **Pilot (Phase 2):** 15 human-labeled photos, each tested original/cropped/straightened. Cropping improved old-parser nutrient recovery from 71 to 97 /191. Straightening was not consistently better.
- **Experiments (Phase 4):** tested color, no sharpening and 2× enlargement combinations. None met improvement/safety rules; production settings stayed unchanged.
- **Parser (Phase 5):** improved row/column matching, fragmented servings, joined names, units and competing-panel safeguards. Original rectangular pilot result: 97 → 125/191 correct nutrients.
- **Phone audit and layout update:** checked 15 actual iPhone crop/OCR/diagnostic exports. Added merged inline nutrient support, serving blocks beside the table, narrow label corrections, and complete separate-unit columns. Current parser: `spatial-review-v4`. Raw OCR is preserved; ambiguous values stay `null`.

## Latest measured improvement

Same saved OCR from the 15 iPhone exports; only the parser changed (v3 → v4):

| Measure | Before → after |
| --- | ---: |
| Correct nutrient fields | 124 → 153 /191 (64.9% → 80.1%) |
| Correct serving fields | 18 → 27 /30 (60% → 90%) |
| Wrong owner-verified readings | 1 → 1 |

No newly wrong scored values or losses of previously correct fields across phone, original/cropped/straightened pilot, and historical regressions. All 190 tests pass. All 15 products (including the former holdout) are now exposed, so this does not prove accuracy on unseen labels. Earlier desktop crops used different source bytes/geometry and are not a fair phone-versus-desktop comparison.

## What still limits accuracy

Tiny/damaged digits and units, glare, curved packaging, inverted text, fragmented boxes and multiple panels/bases. One phone scan still reads **160 kcal as 60**. Spam's per-serving/per-100g table deliberately remains unresolved; one crop cuts off a vitamin row. Straightening cannot flatten curves or restore missing detail. Fresh unseen test data and on-device confirmation of v4 are still needed.

## Ideas to investigate next — not implemented or proven

1. **New test data:** diverse human-labeled phone captures, including unreadable examples. Reserve untouched products before tuning.
2. **Find the failing stage:** missed text, wrong characters or wrong row association? Annotate text boxes to measure detection directly.
3. **Target tiny text:** test detailed row/word crops or a stronger recognizer, not just whole-image enlargement.
4. **Selective enhancement:** test local lighting correction, inverse-text handling and curved-surface correction against the current baseline.
5. **Structure/retries:** explicit panel/basis selection and targeted rescans. Conflicting readings should trigger review.
6. **Optional second engine/vision model:** compare correctness, latency, cost and privacy on reserved images. More output is not necessarily better.

**Decision rule:** keep changes only when they recover more correct fields without introducing incorrect values or losing previously correct ones. Never treat OCR confidence as calibrated correctness.

Details: [phone audit](OCR_IPHONE_AUDIT.md), [layout results](docs/single-basis-layout-2026-10-12.md), [OCR tuning](docs/ocr-iteration-2026-09-10.md), [capture](docs/phase-3-capture-geometry.md), [pilot](docs/phase-2-pilot-2026-10-11.md), [preprocessing](docs/phase-4-preprocessing-2026-10-11.md), [Phase 5](docs/phase-5-parser-2026-10-11.md).
