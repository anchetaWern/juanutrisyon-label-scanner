# User-facing nutrition label scanner implementation plan

Planned: 2026-10-28. Implemented on 2026-10-28; see [implementation and validation notes](user-facing-scanner-implementation.md). The sections below preserve the agreed implementation plan.

## Confirmed scope and decisions

- `/` becomes the public photo-to-assessment experience.
- `/improve` hosts the current scanner, including cropping, quality inspection, OCR overlays, raw text, JSON, and diagnostics exports.
- Taking or selecting a photo starts recognition immediately. Cropping, rotation, and perspective correction are recovery tools rather than prerequisites.
- Daily references use the supplied male, age 19 endpoint, with this population clearly identified in the UI.
- Users can correct serving details, nutrition basis, nutrient amounts, and units. Valid corrections immediately update the assessment.
- The macro chart shows calorie contributions: carbohydrate × 4, protein × 4, and fat × 9. It does not reproduce the existing food page's gram-share percentages.
- Images and scan results remain in browser memory. This iteration does not add accounts, saved scans, product database writes, or image uploads to a server.

## Sources inspected

- Live example: https://app.juanutrisyon.info/food/jack-n-jill-chippy-barbecue-flavored-corn-chips
- Daily references: https://api.juanutrisyon.info/api/consolidated-recommended-daily-nutrient-intake?gender=male&age=19
- Local food page: `~/projects/juanutrisyon/nuxt-juanutrisyon/src/pages/food/[food].vue`.
- PNPM rules: that repository's `src/helpers/PnpmWarnings.js` and `src/components/FoodContainerCallout.vue`.
- Nutrition calculations, reference normalization, unit rules, and highlights: its `src/helpers/calculation/` modules.
- Source checkout HEAD when inspected: `235584362a2bf6e11154ea6b4a144ea8c948631e`. Record the exact source files/content when porting; HEAD alone does not describe uncommitted source changes.

The live page and local source differ. The local source uses “Notable nutrients” and “Nutrients to monitor” at 20% of the daily reference for the displayed portion; the live page still presents older FAO source claims. Follow the local implementation requested by the user. Preserve PNPM as a separate assessment from daily-reference highlights.

## Public user flow

1. Show a short introduction and prominent **Take photo** / **Upload image** controls, using the existing native file picker and rear-camera capture behavior.
2. Validate and decode the selected file, retain its preview, and automatically run the existing preprocessing, PaddleOCR worker, and conservative nutrition parser. Image-quality checks provide advice and do not add a manual continue step.
3. Show understandable progress for model loading and recognition. The first scan may download runtime/model assets. Keep cancel/reset and recovery actions available with protection against late results from an obsolete scan.
4. Present the assessment as soon as extraction is available, with a compact notice to check readings against the photo. Show partial results when useful; identify the fields preventing the remaining assessments.
5. Offer **Check/edit values**, **Crop or straighten photo**, **Retake**, and **Scan another label**. A confirmed crop automatically starts a new recognition pass.
6. Keep a collapsible source-image preview near the editable values so corrections can be made without losing context. Do not expose developer diagnostics in the main results flow.

Suggested result order: serving/basis summary → calories and macros → PNPM assessment → nutrition highlights → complete nutrition breakdown → source/reference notes. Use the existing Vue/Vuetify app and Juan Nutrisyon styling, with a stacked mobile layout and accessible text equivalents for charts and warning badges.

## Routing and application shell

- Change `src/router/index.ts` to map `/` to a new lazy-loaded `LabelAssessmentView.vue` and `/improve` to the existing `ScannerView.vue`.
- Make the brand link return to `/`; add a modest **Help improve scanning** link to `/improve` and a return link there.
- Make the global “Review required” chip route-specific. Public results should carry a short contextual verification notice.
- Preserve the current `/improve` workflow and exports. Keep its manual crop/check/recognize steps as they work today.
- Verify direct visits and refreshes at both routes under the existing SPA rewrites.

## Recognition and state architecture

Reuse the existing `PaddleOcrEngine`, preprocessing, image picker, cropper, perspective editor, and `parseNutrition`. Do not introduce a second OCR provider or change model settings in this feature.

Refactor the shared scanner orchestration only as needed to accept a full-image input without a confirmed crop. Keep the default behavior manual for `/improve`; opt the public view into automatic scanning. Keep source image, recognition input, crop geometry, recognition result, and assessment state distinct.

Introduce a public `useLabelAssessment` composable to coordinate:

- Image selection → recognition → extraction → normalized nutrition → assessment.
- Reference loading independently of OCR, so API delays do not block reading the label.
- Immutable extracted readings and evidence, a separate editable draft, and the effective values used by calculations.
- Explicit states for empty, reading, results, correction, crop recovery, and recoverable error.
- Revision checks for replacement photos, crop changes, reset, and navigation. Ignore obsolete OCR/reference responses, revoke object URLs, and release workers on disposal.

A failed read should offer crop/retake and manual correction, rather than retrying repeatedly or inventing values. Avoid automatic panel-edge detection as a mandatory dependency; the existing edge heuristic is advisory.

## Normalized nutrition and basis handling

Add an adapter from `NutritionExtraction` to a typed assessment model. Map scanner names such as `energy`, `carbohydrate`, `fiber`, and `sugars` to the canonical food-page names. Retain original strings, units, qualifiers, parser issues, source lines, and whether a value was edited.

- Missing is unknown; an explicitly read or entered zero is zero.
- Convert compatible mass units and kJ/kcal using the existing calculation rules.
- Preserve `<1 g`, percentages, and unsupported vitamin forms as qualified/source values. Do not coerce them into exact amounts for assessments.
- A package's printed %DV may use a different reference population. Display percent-only readings as printed-label values; do not reverse-calculate mass or treat them as the app's male/19 percentages.
- Extend extraction with backward-compatible basis metadata/evidence where needed. Accept an explicit single per-serving, per-100-g, or per-100-mL basis; mark unclear bases as unknown and allow the user to confirm them.
- Do not enable the rejected experimental multi-basis selection behavior. Multiple or prepared/unprepared columns remain unassessed until a single basis is selected through correction/cropping.
- Serving size and nutrition basis are separate: “30 g serving” does not prove that the selected amount column is per serving.
- Default results to the recognized source basis. Offer per serving, per 100 g/mL, and per container only when the required conversions/counts are known. Never assume 1 mL = 1 g.
- Drive calories, macro amounts, highlights, and nutrient rows from one selected-portion calculation. PNPM ratios are portion invariant and use valid same-basis inputs.

## Assessment behavior

### Calories and macros

Show label calories in kcal, carbohydrate/fat/protein grams, and estimated calorie contributions. Calculate chart shares from `(carbs × 4) + (fat × 9) + (protein × 4)`. Identify this as estimated energy from macros; do not replace the label's declared calories when rounding, fiber, or other constituents cause a difference.

If one macro is unknown, retain known gram amounts and explain why the complete chart cannot be shown. Do not turn unknown macros into zero or renormalize an incomplete set as a complete breakdown. Handle all-zero macros without dividing by zero.

### PNPM assessment

Port the existing helper and its boundary cases rather than deriving rules from UI text. Preserve its four thresholds: total fat at least 30% of energy, saturated fat at least 10%, total sugar at least 10%, and sodium at least 1 mg/kcal.

Use energy and nutrient amounts from one verified nutrition basis. The ratios can be calculated from the same serving or volume basis without converting to 100 g; only label amounts as “per 100 g” when that conversion is supported. Missing serving weight alone need not block otherwise valid same-basis ratios.

Require positive energy and valid nonnegative nutrient amounts. Unknown inputs produce an unknown result for that warning. Clearly distinguish complete results, partial assessment, and unavailable assessment. Only state “No thresholds exceeded” when every warning is evaluable and below its cutoff. Keep a concise calculation explanation and the existing educational attribution.

### Nutrition highlights

Follow local `classifyNutrientHighlights`: eligible notable nutrients and nutrients to monitor are highlighted at ≥20% of the daily reference for the portion shown. Keep its unit/form compatibility checks and its distinction between no qualifying assessed nutrients and insufficient data.

Preserve the local sugar-reference safeguard: the endpoint's generic sugar reference is not enough to prove a matching total/added/free sugar definition. Suppress an unsupported sugar highlight while still allowing the separate PNPM total-sugar calculation when its inputs are valid.

### Nutrition breakdown

Group energy, macronutrients, vitamins, minerals, and other recognized nutrients. Show amount, unit, and percent of daily reference where compatible. Include missing core nutrients as unavailable, retain extra recognized nutrients, and avoid inventing absent micronutrients. Use text and icons alongside colors; percentages over 100 remain visible as text even if progress bars stop at 100.

## Daily-reference integration

The endpoint was successfully read during planning. It returns an array of `{ nutrient, daily_value, unit }` rows and allows cross-origin access. Values include 2,530 kcal, 71 g protein, and units such as µgRE, µgDFE, mgNE, and mg α-TE.

Add a small reference service that fetches this fixed endpoint once, validates rows, and normalizes names/units. Retain endpoint, population, and fetch date with the data. Deduplicate requests and optionally retain a validated reference-only browser cache with a date and bounded expiry.

Adapt the food-page percentage/highlight helpers to accept this reference set explicitly: the local `references.js` currently defaults to a reviewed bundled snapshot, so copying it unchanged would silently bypass the requested API. Reuse its provenance and compatibility policies, but use the supplied endpoint for this feature.

If fetching fails, use a clearly identified validated cached reference if present. Otherwise show amounts and evaluable PNPM results while daily percentages/highlights are unavailable, with a retry action. Do not fall back silently to another population or generic 2,000-kcal values. Do not send images or scan contents in reference requests.

Label percentages as **% of daily reference**, with male, age 19 identified and a link/explanation for the source. Respect unsupported equivalent forms; for example, do not silently equate RE and RAE.

## Reuse and file boundaries

The Nuxt project's published nutrition-core boundary exposes normalization/scaling helpers but does not currently expose highlights, PNPM, or reference utilities. For this standalone repository, port the smallest necessary pure helper dependency set, its source attribution/version, and relevant reference metadata into a local calculation directory. Adapt imports and types here; avoid runtime imports from a sibling checkout or copying Nuxt-specific app components wholesale. A shared package can be considered separately if both apps will maintain these rules together.

Proposed files, subject to final implementation details:

- `src/views/LabelAssessmentView.vue` — public view.
- `src/composables/useLabelAssessment.ts` — public scan and edit orchestration.
- `src/services/nutrition/normalizeScannedNutrition.ts` — extraction/basis adapter.
- `src/services/nutrition/assessNutrition.ts` — portion calculations and assessment output.
- `src/services/nutrition/calculation/` — scoped pure helpers ported from the food app.
- `src/services/references/dailyReferences.ts` — fixed-profile API service and normalization.
- `src/components/assessment/` — calories/macros, PNPM summary, highlights, grouped breakdown, and correction form.
- Existing router, application shell, and shared scanner composable — targeted integration updates.
- `README.md` — two routes, API dependency, reference policy, correction behavior, and privacy details.

## Implementation sequence

1. Route the existing screen to `/improve`; introduce the public view and route-aware shell.
2. Add automatic full-image recognition with optional crop recovery while preserving the manual improvement workflow.
3. Add the normalized nutrition/basis model, editable draft, and reference service.
4. Port and integrate the scoped calculation helpers, PNPM, highlights, and breakdown.
5. Build the mobile results/correction experience and loading, partial-data, failure, and retry states.
6. Run focused validation, full existing checks, and browser/mobile QA; update documentation.

## Validation and acceptance

- Both direct routes render correctly; `/improve` retains existing diagnostics and exports.
- Photo selection starts recognition without a crop confirmation or separate OCR button. Cropping and correction remain available afterward.
- Test real orchestration risks: replacement photos and navigation during recognition, model/decoding failure, obsolete results, reset, and reference failure/retry.
- Test nutrient aliases, explicit zero versus missing, unit conversion, percent-only/bounded values, same-basis requirements, missing serving weight, mL versus g, and multi-column abstention.
- Test macro energy shares with a known example, missing macros, zero totals, and differences from declared calories.
- Test PNPM thresholds at/below/above cutoffs, invalid energy, partial results, and invariance across correctly scaled portions. Compare outputs against the existing food-app helper.
- Test 20% highlights, unsupported vitamin forms, sugar definition handling, and fixed-reference API normalization/cache failure paths.
- Editing an amount, unit, basis, or serving detail updates all dependent displays; invalid drafts do not feed stale or fabricated values into the assessment. Resetting edits restores original extraction and warnings.
- Use existing frozen OCR fixtures for integration regression without claiming improved OCR accuracy. Add hand-verified calculation cases, including the linked Chippy label (160 kcal, 10 g fat, 5 g saturated fat, 18 g carbohydrate, 2 g protein per 30 g) with verified sodium if assessing sodium. Those macro amounts produce an estimated 170 kcal: approximately 52.9% fat, 42.4% carbohydrate, and 4.7% protein. Keep the declared 160 kcal separate.
- Run `npm run lint`, `npm run type-check`, `npm test`, and `npm run build`. If parser metadata changes affect evaluation tooling, also run its type-check/replay checks.
- Visually verify upload, progress, results, editing, crop recovery, partial data, and errors at desktop and phone widths; perform an actual phone camera check when a device is available. Keep unresolved device-only checks explicit.

## Scope limits

This is a new consumer flow over the existing extraction engine, not an OCR accuracy/model project. Missing or ambiguous scans must have useful recovery paths. Cloud recognition, product identification, barcode lookup, saved history, shareable result URLs, and personalized demographic references are outside this iteration.
