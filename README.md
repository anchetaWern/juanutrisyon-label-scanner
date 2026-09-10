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

`TesseractOcrEngine` uses Tesseract.js 6 with the English model. It was selected for Phase 1 because it executes in mainstream browsers and returns layout blocks, lines, words, confidence, and coordinates without a server. Its first use downloads the OCR worker/model, so initialization can be noticeably slower and requires network access unless those assets are self-hosted later.

The OCR adapter prepares a separate lossless high-contrast image and uses automatic page segmentation with preserved word spacing. The user-visible crop remains unchanged. Debug output offers separate copy actions for raw text and the complete normalized JSON result, including confidence, preprocessing version, and geometry.

PaddleOCR remains a strong future candidate, but its browser deployment currently requires additional WASM/ONNX runtime and model packaging work. Provider-specific objects are normalized inside `src/services/ocr/TesseractOcrEngine.ts`; UI and scanner state depend only on `NutritionLabelOcrEngine` and `OcrResult`. A later provider only needs to implement `initialize`, `recognize`, `terminate`, and optionally progress updates.

## Deployment

`npm run build` produces the static `dist/` application. `vercel.json` and `public/_redirects` provide SPA routing defaults for Vercel and hosts that support Netlify-style redirects. No hostname is hard-coded.

## Current limitations

- English OCR only; nutrition parsing and table reconstruction belong to Phase 2.
- Tesseract model assets are fetched on first OCR use and are not available offline yet.
- Quality thresholds are heuristics and deliberately advisory.
- Glare detection uses clipped-highlight ratios; it can report bright white label backgrounds as possible glare.
- Crop is rectangular and does not perform perspective correction or curved-label dewarping.
- HEIC support depends on the browser's ability to decode it.
- The manifest makes the shell installable-friendly, but no service worker/offline cache is included in Phase 1.
