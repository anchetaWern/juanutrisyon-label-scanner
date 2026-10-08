# Phase 3: capture guidance and perspective correction

Implemented October 9, 2026. Phase 2 collection/calibration is not a prerequisite for the controls, but is still needed to measure their accuracy benefit and calibrate the heuristics. OCR settings and nutrition parsing are unchanged.

## Behavior

- Capture advice emphasizes the smallest digits, even lighting, a front-facing view, and inclusion of serving details and every row.
- Rectangle cropping starts with the full image, preserves rotation, and emits PNG instead of recompressing as JPEG.
- Optional four-corner editing supports pointer/touch dragging and keyboard arrows (Shift moves ten source pixels). Invalid, crossed, too-small, or nearly collinear selections cannot be rendered.
- Border suggestions are opt-in. The conservative `border-lines-v1` heuristic searches strong, approximately horizontal/vertical boundaries, rejects prominent enclosing lines, and abstains when no convincing quadrilateral is found. It has no semantic knowledge of nutrients or serving details. Borderless, strongly tilted, and curved labels often need manual selection.
- Preview is required before confirmation; any corner edit invalidates it. Users should inspect the complete table, not just whether its sides look straight. Returning to rectangular cropping remains available.
- Adjust crop restores the confirmed rectangle and corners, but requires a new preview. Changing the rectangle or rotation invalidates saved corners; resetting clears them. State lasts only for the current in-memory scan.
- Worker tasks are cancelled on editor exit/unmount, time out after 30 seconds, and terminate on success/error. Late OCR/quality results cannot replace a newer image's state. Image replacement and crop controls are disabled while OCR is busy.

## Image processing and diagnostics

The `four-corner-v1` transform uses a projective mapping with bilinear sampling and a white background. Rectangle rendering is limited to 2400 pixels on either axis; perspective preview is limited to 960 pixels and the final output to 2400 pixels on either axis and four million pixels. Output dimensions follow the larger opposite edges. The foreshortened side may still be locally enlarged; interpolation cannot recover missing detail. Source decoding can consume more memory than these output bounds, and real-phone memory profiling remains outstanding.

Schema 3 diagnostics retain legacy `images.crop.coordinatesInOriginal` and add `rectangleCoordinateSpace: cropperjs-rotated-image`. Rotation means those legacy coordinates should not be interpreted as a raw, unrotated source rectangle. `images.crop.geometry` is null for a rectangle; otherwise it contains the transform version, rendered rectangle size, clockwise corners (top-left first), output size, selection provenance, suggestion score, and output-to-source homography. The homography maps **normalized output coordinates [0,1]** into **rendered rectangular-crop pixels**, not original-file pixels. OCR boxes still refer to OCR input space. No image bytes are embedded in diagnostics.

Capture metrics use `local-text-and-highlights-v1`, measured on a maximum-720-pixel analysis image. Adaptive connected components estimate the lower-quarter glyph height (at least 12 candidates), text footprint, and edge contacts. Local white patches surrounded by detailed darker areas suggest glare; a bright white page alone does not. Existing blur/darkness checks remain. Estimated text height is conservatively reduced for substantial perspective stretching. These are advisory heuristics, not OCR confidence or calibrated readability scores; they never block scanning. Footnotes, decoration, unusual fonts, and inverted text can affect estimates.

## Verification

- 100 automated tests pass, covering identity/trapezoid sampling, invalid geometry, bounded output, conservative border selection, localized glare versus white paper, small/edge text, stale asynchronous results, worker success/abort/error/timeout cleanup, diagnostics, preview requirements, restoration, and cancellation.
- Application and evaluation TypeScript checks, lint, and production build pass. The build includes the new geometry worker; existing large OCR/OpenCV bundle warnings remain.
- Desktop Chrome smoke test using local `labels/processed/007/IMG_2337-cropped.jpeg`: full-image rectangular default, suggestion abstention on the curved package, manual corner dragging, preview, confirmation (790 × 664 PNG), quality advice, reopening saved corners, returning to rectangle, and ordinary confirmation (900 × 850) all worked. The preview retained serving details and all nutrient rows; package curvature remained visible as expected. This was a development-server check, not a real-phone or production-host test.
- Frozen replay command:

  ```bash
  npm run evaluate -- --legacy benchmark --out evaluation/results/phase-3-regression
  ```

  Results are unchanged from Phase 1: desktop nutrient matches 176/371 and serving matches 19/59; four wrong serving values and one false-positive nutrient output. Mobile nutrient matches 121/124 and serving matches 8/10, with no wrong/false-positive values. This only verifies parser regression on existing OCR; it does **not** measure the new crop pipeline's OCR accuracy.

## Remaining validation

Before making accuracy claims, collect matched original/cropped/straightened scans with independently checked annotations through Phase 2. Compare field errors and omissions, not just text appearance. Include flat/skewed panels, borderless tables, small text, glare, curved packaging, and deliberately incomplete crops. Record phone/browser, runtime, failures, and memory behavior on iOS Safari and Android Chrome. In particular check touch dragging near screen edges, rotation/reopen, interruption, and source decoding of large photos. Live camera analysis, curved-surface dewarping, OCR retries, and parser changes are outside this phase.
