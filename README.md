# Juan Nutrisyon Nutrition Label Scanner

Standalone Vue application for capturing, cropping, quality-checking, and OCRing nutrition-label images, with experimental, review-required nutrition extraction. It does not import from, call, or otherwise depend on the Juan Nutrisyon frontend or API.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Camera capture generally requires HTTPS on a phone (localhost is treated as secure on the development computer); uploading an existing image works without camera permission.

## Checks

```bash
npm run lint
npm run type-check
npm test
npm run build
```

## Accuracy baseline

`npm run evaluate` replays the eight tracked mobile OCR fixtures against independent label annotations and produces field-level JSON, Markdown, and CSV reports. To also evaluate the 30-image local desktop corpus, run `npm run evaluate -- --legacy benchmark --out evaluation/results/phase-1`. This is a frozen OCR replay, not a new recognition or phone-performance run. Wrong values, missed readable values, correct abstentions, and unreviewed annotations are counted separately.

See the [evaluation guide](evaluation/README.md) for metric definitions and reproduction, and the [Phase 1 baseline report](docs/accuracy-baseline-2026-10-08.md) for results and limitations. Run `npm run type-check:evaluation` when changing the harness.

## Scanner pipeline

```text
take/upload photo
  → rectangular crop + rotation
  → advisory browser-side quality checks
  → grayscale, contrast-stretch, and light sharpening preprocessing
  → provider-independent OCR adapter
  → text, lines, tokens, confidence, bounding boxes
  → conservative spatial nutrition extraction with source evidence
  → debug output and overlay
```

The original `File` and its object URL remain separate from the generated JPEG crop. Crop coordinates and rotation are retained so the selection can be reopened. Neither image is persisted or uploaded by this app.

## OCR provider decision

The default is PaddleOCR.js 0.4.2 with PP-OCRv6 tiny detection and recognition in a Web Worker. Configuration `v6-tiny-recall-v2` retains grayscale/contrast/sharpen preprocessing and lowers the detector box threshold from 0.6 to 0.45. Selection is based on the 30 verified labels and a separate exported iPhone crop; see [the mobile OCR iteration report](docs/ocr-iteration-2026-09-10.md).

The OCR adapter prepares a separate lossless image; the user-visible crop remains unchanged. Debug output offers raw text, OCR JSON, diagnostics copying, and crop saving/sharing. Diagnostics include the selected settings, preprocessing/detection/recognition timings, box counts, and browser information. Raw OCR text is not corrected or replaced with expected nutrition values.

The Tesseract.js 6 adapter remains available with single-block segmentation; it is not an automatic retry after Paddle failures. UI and scanner state depend only on `NutritionLabelOcrEngine` and `OcrResult`. The first Paddle scan downloads the runtime and models, so initialization is slower and needs network access unless assets are self-hosted.

## Nutrition extraction (experimental)

After OCR, `parseNutrition` matches nutrient names and amounts using inline text and bounding-box geometry, including complete ordered columns on slanted labels. It preserves raw OCR. The review panel offers a separate **Copy nutrition JSON** action using the agreed format: `"sugars": "4g"`, `"energy": "80kcal"`, `"niacin": "4%"`. Serving values are strings. Unknown values are JSON `null`, never inferred zeros. The ten core nutrient keys are always present; recognized additional nutrients, vitamins, and minerals are included. Percent-only amounts are retained when no mass is readable/present in the supported layout.

Diagnostics schema version 2 adds `nutrition` with the data, parser version, warnings, and source line indexes. The existing `ocr` object and **Copy OCR JSON** remain unchanged. Numeric-slot corrections such as `Og` → `0g` and `mmg` → `mg` are flagged for review. Missing digits/units and ambiguous associations are not filled from a reference label. Multiple nutrition bases are conservatively rejected, except for a separately headed micronutrient table with an unambiguous per-serving column below inline per-serving macros.

Eight mobile diagnostic exports are stored as sanitized OCR-only fixtures under `src/services/nutrition/fixtures/`; they contain no device/browser details or image bytes. See [the initial extraction validation report](docs/nutrition-extraction-2026-09-11.md) and [the September 18 format report](docs/nutrition-extraction-2026-09-18.md) for exact outputs and limitations. The current parser is `spatial-review-v2`; its narrowly supported OCR name corrections also produce review warnings.

## Deployment

`npm run build` produces the static `dist/` application. `vercel.json` and `public/_redirects` provide SPA routing defaults for Vercel and hosts that support Netlify-style redirects. No hostname is hard-coded.

## Current limitations

- English OCR and heuristic, review-required nutrition parsing. Incomplete tables, unknown nutrient names, curved/multi-panel layouts, and OCR digit errors can still produce omissions or wrong values. This is not unattended extraction.
- OCR runtime/model assets are fetched on first use and are not available offline yet.
- Quality thresholds are heuristics and deliberately advisory.
- Glare detection uses clipped-highlight ratios; it can report bright white label backgrounds as possible glare.
- Crop is rectangular and does not perform perspective correction or curved-label dewarping.
- HEIC support depends on the browser's ability to decode it.
- The manifest makes the shell installable-friendly, but no service worker/offline cache is included in Phase 1.
