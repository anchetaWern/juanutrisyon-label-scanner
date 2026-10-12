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

The [Phase 2 pilot](evaluation/pilot/README.md) runs fresh OCR on 15 owner-verified original photos and compares original, rectangular, and perspective inputs. `phase2:prepare` generates crops for review, `phase2:run` recognizes them with resumable checkpoints, and `phase2:report` replays the saved OCR. See [the pilot findings](docs/phase-2-pilot-2026-10-11.md) for measured gains, remaining errors, and the limits of this small dataset.

The [Phase 4 study](evaluation/phase4/README.md) compares frozen preprocessing configurations on development images, selects a candidate using field recovery/error/runtime rules, and evaluates only the selected candidate on reserved images. Run `npm run phase4 -- --help` for commands. The [initial findings](docs/phase-4-preprocessing-2026-10-11.md) retain the current production settings because none of the five alternatives passed the development criteria.

The [Phase 5 parser study](evaluation/phase5/README.md) compares parser changes on identical saved OCR, freezes a passing development candidate, then checks reserved products. The [findings](docs/phase-5-parser-2026-10-11.md) adopt `spatial-review-v3`: rectangle nutrient recovery rose from 97 to 125 of 191 across the pilot, with only one of those extra fields on the five reserved products. No previously correct scored fields were lost; broader unseen-label validation is still needed.

The [single-basis layout update](docs/single-basis-layout-2026-10-12.md) improved correct owner nutrient fields from 124 to 153/191 and serving fields from 18 to 27/30 on 15 exported iPhone scans. The [annotation-driven iteration](docs/annotation-iteration-2026-10-12.md) adopts `spatial-review-v5` and further recovers 11 nutrients (164/191, 85.9%), with serving fields unchanged. No new scored errors, lost correct fields or changed existing non-null readings occur against v4 across the saved regressions. These products are already exposed, not fresh validation. The OCR model is unchanged. The [pre-implementation phone audit](OCR_IPHONE_AUDIT.md) and [condensed OCR summary](OCR_ACCURACY_SUMMARY.md) explain the remaining gaps.

[Experiment A](evaluation/experiment-a/README.md) re-reads reviewed value/unit crops from original photos at 1×/2× using an isolated evaluation harness. The [development findings](docs/experiment-a-results-2026-10-12.md) retain production behavior: both measured variants lose correct readings and introduce a wrong populated field in hypothetical parser replay. Run `npm run experiment:a -- --help` for reproduction and reserved-data safeguards.

## Scanner pipeline

```text
take/upload photo
  → rectangular crop + rotation
  → optional four-corner perspective correction + reviewed preview
  → advisory browser-side quality checks
  → grayscale, contrast-stretch, and light sharpening preprocessing
  → provider-independent OCR adapter
  → text, lines, tokens, confidence, bounding boxes
  → conservative spatial nutrition extraction with source evidence
  → debug output and overlay
```

The original `File` and its object URL remain separate from the generated lossless PNG crop. Crop coordinates, rotation, and confirmed perspective corners are retained in memory so the selection can be reopened. Neither image is persisted or uploaded by this app.

Choose **Straighten tilted panel** for a slanted label. Place the four corners just outside the panel (including serving information and the last row), preview the result, then confirm. **Suggest panel edges** is an optional border heuristic, not nutrition-panel recognition; review or replace its suggestions. **Back to rectangle** keeps ordinary cropping available. See the [Phase 3 implementation and validation notes](docs/phase-3-capture-geometry.md).

## OCR provider decision

The default is PaddleOCR.js 0.4.2 with PP-OCRv6 tiny detection and recognition in a Web Worker. Configuration `v6-tiny-recall-v2` retains grayscale/contrast/sharpen preprocessing and lowers the detector box threshold from 0.6 to 0.45. Selection is based on the 30 verified labels and a separate exported iPhone crop; see [the mobile OCR iteration report](docs/ocr-iteration-2026-09-10.md).

The OCR adapter prepares a separate lossless image; the user-visible crop remains unchanged. Debug output offers raw text, OCR JSON, diagnostics files, and crop saving/sharing. **Share OCR JSON** and **Share diagnostics** open the phone's file share sheet, where you can choose AirDrop. Browsers without file sharing open a download/preview instead. Diagnostics include the selected settings, preprocessing/detection/recognition timings, box counts, and browser information, plus the complete OCR result and nutrition extraction. Raw OCR text is not corrected or replaced with expected nutrition values.

The Tesseract.js 6 adapter remains available with single-block segmentation; it is not an automatic retry after Paddle failures. UI and scanner state depend only on `NutritionLabelOcrEngine` and `OcrResult`. The first Paddle scan downloads the runtime and models, so initialization is slower and needs network access unless assets are self-hosted.

## Nutrition extraction (experimental)

After OCR, `parseNutrition` matches nutrient names and amounts using inline text and bounding-box geometry, including complete ordered columns on slanted labels. It preserves raw OCR. The review panel offers a separate **Copy nutrition JSON** action using the agreed format: `"sugars": "4g"`, `"energy": "80kcal"`, `"niacin": "4%"`. Serving values are strings. Unknown values are JSON `null`, never inferred zeros. The ten core nutrient keys are always present; recognized additional nutrients, vitamins, and minerals are included. Percent-only amounts are retained when no mass is readable/present in the supported layout.

Diagnostics schema version 3 retains `nutrition` with the data, parser version, warnings, and source line indexes, and adds crop geometry, explicit coordinate spaces, and advisory capture metrics. **Share OCR JSON** exports the original OCR object. Numeric-slot corrections such as `Og` → `0g` and `mmg` → `mg` are flagged for review. Missing digits/units and ambiguous associations are not filled from a reference label. Multiple nutrition bases are conservatively rejected, except for a separately headed micronutrient table with an unambiguous per-serving column below inline per-serving macros.

Eight older mobile diagnostic exports, seven Phase 5 development OCR cases, six exposed iPhone layout cases, and five annotation-focused phone cases are stored as sanitized OCR-only fixtures under `src/services/nutrition/fixtures/`; they contain no device/browser details or image bytes. The annotation fixtures also retain frozen v4 predictions. See [the initial extraction validation report](docs/nutrition-extraction-2026-09-11.md), [the September 18 format report](docs/nutrition-extraction-2026-09-18.md), [Phase 5 findings](docs/phase-5-parser-2026-10-11.md), [layout findings](docs/single-basis-layout-2026-10-12.md), and [annotation findings](docs/annotation-iteration-2026-10-12.md) for exact outputs and limitations. The current parser is `spatial-review-v5`; its narrowly supported OCR name/unit corrections also produce review warnings. It additionally handles explicit merged inline nutrients, serving blocks beside the table, complete separate-unit columns with an identifiable daily-value boundary, and a narrowly defined explicit per-serving DHA/omega-3 statement. It does not infer missing digits or relax multiple-basis abstention.

## Deployment

`npm run build` produces the static `dist/` application. `vercel.json` and `public/_redirects` provide SPA routing defaults for Vercel and hosts that support Netlify-style redirects. No hostname is hard-coded.

## Current limitations

- English OCR and heuristic, review-required nutrition parsing. Incomplete tables, unknown nutrient names, curved/multi-panel layouts, and OCR digit errors can still produce omissions or wrong values. This is not unattended extraction.
- OCR runtime/model assets are fetched on first use and are not available offline yet.
- Quality thresholds are heuristics and deliberately advisory.
- Small-text and localized-glare checks can miss problems or raise false alarms. A clean quality report is not proof of readable text or correct OCR.
- Four-corner correction handles flat-panel perspective, not curved-label dewarping, missing detail, or obscured text. Border suggestions can be incomplete or wrong.
- Capture advice is shown before/after native photo selection, not as live camera analysis. Real-phone performance and before/after accuracy validation remain pending.
- HEIC support depends on the browser's ability to decode it.
- The manifest makes the shell installable-friendly, but no service worker/offline cache is included.
