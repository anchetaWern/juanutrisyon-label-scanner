# Juan Nutrisyon Nutrition Label Scanner

Standalone Phase 1 Vue application for capturing, cropping, quality-checking, and OCRing nutrition-label images. It does not import from, call, or otherwise depend on the Juan Nutrisyon frontend or API.

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

## Phase 1 pipeline

```text
take/upload photo
  → rectangular crop + rotation
  → advisory browser-side quality checks
  → grayscale, contrast-stretch, and light sharpening preprocessing
  → provider-independent OCR adapter
  → text, lines, tokens, confidence, bounding boxes
  → debug output and overlay
```

The original `File` and its object URL remain separate from the generated JPEG crop. Crop coordinates and rotation are retained so the selection can be reopened. Neither image is persisted or uploaded by this app.

## OCR provider decision

The default is PaddleOCR.js 0.4.2 with PP-OCRv6 tiny detection and recognition in a Web Worker. Configuration `v6-tiny-recall-v2` retains grayscale/contrast/sharpen preprocessing and lowers the detector box threshold from 0.6 to 0.45. Selection is based on the 30 verified labels and a separate exported iPhone crop; see [the mobile OCR iteration report](docs/ocr-iteration-2026-09-10.md).

The OCR adapter prepares a separate lossless image; the user-visible crop remains unchanged. Debug output offers raw text, OCR JSON, diagnostics copying, and crop saving/sharing. Diagnostics include the selected settings, preprocessing/detection/recognition timings, box counts, and browser information. Raw OCR text is not corrected or replaced with expected nutrition values.

The Tesseract.js 6 adapter remains available with single-block segmentation; it is not an automatic retry after Paddle failures. UI and scanner state depend only on `NutritionLabelOcrEngine` and `OcrResult`. The first Paddle scan downloads the runtime and models, so initialization is slower and needs network access unless assets are self-hosted.

## Deployment

`npm run build` produces the static `dist/` application. `vercel.json` and `public/_redirects` provide SPA routing defaults for Vercel and hosts that support Netlify-style redirects. No hostname is hard-coded.

## Current limitations

- English OCR only; nutrition parsing and table reconstruction belong to Phase 2.
- OCR runtime/model assets are fetched on first use and are not available offline yet.
- Quality thresholds are heuristics and deliberately advisory.
- Glare detection uses clipped-highlight ratios; it can report bright white label backgrounds as possible glare.
- Crop is rectangular and does not perform perspective correction or curved-label dewarping.
- HEIC support depends on the browser's ability to decode it.
- The manifest makes the shell installable-friendly, but no service worker/offline cache is included in Phase 1.
