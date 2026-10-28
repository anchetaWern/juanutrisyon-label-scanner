# Public nutrition label assessment

Implemented 2026-10-28, based on the agreed [plan](user-facing-scanner-implementation-plan.md).

## Behavior

`/` now runs full-image OCR automatically after photo selection. It presents calories/macros, PNPM warning badges and calculations, nutrition highlights, and all extracted nutrients grouped by category. The original manual scanner and its diagnostic/export tools are at `/improve`.

Users can correct readings and their units, serving details, and nutrition basis. Results update immediately. The editor preserves original readings and source evidence separately and supports restoring the scanned values. The source photo can remain visible beside the editor on desktop. Crop/rotate/perspective recovery uses the existing cropper and automatically rescans after confirmation.

The app ports the food page's pure normalization, reference comparison, highlights, and PNPM helpers. Content hashes and local adaptations are recorded in `src/services/nutrition/calculation/provenance.json`. Reference normalization/highlighting accept API data explicitly instead of importing the food app's fixed bundled snapshot.

The fixed male/19 daily-reference request is independent of OCR. It validates data, deduplicates requests, and stores only reference data with a seven-day expiry. Network failure may use an identified valid cache; otherwise the page shows amounts and available PNPM results without daily percentages/highlights. The macro bar uses calorie contributions rather than the food page's gram percentages, as requested.

## Verification

- Lint, application type-check, all 294 tests across 31 files, and production build passed. Vite retains warnings for the existing OCR/OpenCV dependencies and their large asset chunks.
- New calculation cases cover the Chippy example, declared versus estimated energy, explicit zero versus unknown, qualifiers/percent-only amounts, unit conversion, basis ambiguity, g/mL separation, portion scaling, missing serving weight, 20% highlights, sugar-definition safeguards, PNPM boundary thresholds, invalid inputs, and existing frozen OCR integration.
- Reference-service checks cover request deduplication, fixed-profile units, validated cache fallback, malformed responses, and expired caches.
- Scanner checks exercise automatic full-image recognition, crop/rescan, and serialization/discarding of obsolete scans alongside the existing manual workflow regressions.
- Chromium UI checks use actual file input and the production parser/calculation/UI with frozen OCR responses. They exercise scanning, PNPM and chart output, editing/restoring sodium, container scaling, desktop/mobile rendering, dialogs, crop/rescan, and reset. API failure leaves amounts and PNPM results usable, and retry restores daily references. Direct `/improve` navigation and refresh are verified. No browser page errors occurred, and mobile horizontal overflow was absent at 390px, including the editor.
- Real OCR is also exercised through the browser on two local label photos. A multiple-column image produces unavailable values requiring recovery rather than fabricated assessments. A second image yields 180 kcal, 12 g fat, 15 g carbohydrate, and 1 g protein; missing readings and unclear basis remain unassessed. Both runs complete without browser page errors. This feature is not a new OCR accuracy evaluation.

## Limits

A physical-phone camera session has not been exercised. Existing camera/HEIC/browser support and model-download limitations still apply. Label layouts with missing, ambiguous, bounded, percent-only, or incompatible-form data may yield partial assessments; correction and crop/retake remain necessary. No image, scan, or correction persistence is added.
