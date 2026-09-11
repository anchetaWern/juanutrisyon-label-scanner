# Nutrition extraction — 2026-09-11

## Scope

Added browser-side `spatial-review-v1` post-processing, review UI, a separate nutrition-JSON copy action, and diagnostic schema version 2. No OCR models, preprocessing settings, original images, crops, existing label JSON, cloud services, or deployments were changed. The browser still performs all image processing locally.

This is a parser improvement, not an OCR recognition improvement. Raw OCR text/geometry remain unchanged. All output must be checked against the image, including values that have no field-specific warning.

## Five supplied mobile cases

Tests replay the exported OCR boxes, not newly recognized images. Expected nutrient values were read from the images supplied in the conversation. The fixtures strip browser/device/network metadata. Fixtures and unit tests are tracked independently of the gitignored benchmark corpus.

| Case | Non-null nutrient values | Outcome |
| --- | ---: | --- |
| IMG_3584 | 15 | Macros, added sugars, and four micronutrients retained; serving fields unresolved. OCR's `95g` is not accepted from the garbled serving header. |
| IMG_3585 | 13 | Split amounts/units, six percent-only micronutrients, and both serving fields recovered. Saturated fat, carbohydrate, and calories from fat remain unresolved; trans fat is absent from the label and stays null. Generic daily-reference table excluded. |
| IMG_3586 | 16 | Macros, added sugars, and five micronutrients retained; garbled serving fields unresolved. |
| IMG_3587 | 11 | Ordered column alignment preserves trans fat 0g, cholesterol 7mg, sodium 77mg, carbohydrate 8g, fiber 2g, sugars 7g, protein 2g. Both serving fields recovered. |
| IMG_3588 | 17 | Includes B3/B5/B6/B12, taurine, L-carnitine L-tartrate, and caffeine. `1015mmg` normalized with a warning; garbled serving fields unresolved. |

All 72 non-null nutrient values match the image-derived test expectations. This small development set does not establish general accuracy. Four nutrient slots are null in IMG_3585; six serving fields remain null across IMG_3584/3586/3588. Missing and absent values are not zero. There is no inference of printed masses from %DV.

## Broader local replay

Replayed the stored production OCR in `benchmark/results/latest.json` against the existing 30 annotation files, without rerunning OCR or modifying that dataset. Of 371 annotated nutrient fields, 176 were populated by the parser; 174 matched stored annotations after unit whitespace and `less than`/`<` normalization. Unrecognized/unresolved fields remain a significant limitation. This count does not evaluate serving fields or extra unannotated nutrients, and is not a fresh OCR benchmark.

A neighboring-row percentage error on label 023 was found and fixed: a missing vitamin value must not borrow the previous row's `0%`. A synthetic regression test covers the case.

The two remaining annotation mismatches were checked against the original crops:

- Label 007 / IMG_2337: the crop prints trans fat **1g**; the existing annotation says **0g**. OCR and the new parser return 1g.
- Label 017 / IMG_2887: the crop prints sodium **460mg**; the existing annotation says **640mg**. OCR and the new parser return 460mg.

These appear to be existing reference-data errors, not parser errors. They are documented here but neither the labels nor the frozen benchmark annotations were modified. The rest of that older reference dataset was not re-audited visually.

## Safety and compatibility

- Raw recognition results are never mutated. Nutrition diagnostics carry zero-based indexes into the original `ocr.lines`, source text, association method, and warnings.
- Only recognized label aliases become nutrient keys. Unknown names may still be omitted. Core keys are always present; additional recognized fields may be null.
- Explicit masses take priority over percent-only amounts. Only narrowly defined numeric-slot OCR corrections are applied and flagged.
- Incomplete bare-number tables abstain instead of shifting subsequent rows. Duplicate nutrients and detected per-100g/multiple-basis labels abstain. These checks are heuristic and cannot identify every unusual layout.
- The UI always says review is required, even if the parser produces no warnings. This matters because plausible OCR digit errors cannot reliably be detected from text alone.
- Diagnostics schema moves from 1 to 2 by adding `nutrition`; the nested OCR contract and separate raw OCR JSON copy action are unchanged.

## Verification

`npm test`: 51 tests passed across 13 files, including five full-output cases, order/scale invariance, incomplete columns, unit ambiguity, %DV association, reference table exclusion, preservation of raw OCR, serving strings, invalid geometry, multiple bases, duplicate nutrients, and review-panel copying.

`npm run lint`, `npm run type-check` (via build), and `npm run build` passed. Build reports OpenCV browser externalization and large-bundle warnings. No on-device runtime/performance or new OCR recognition benchmarks were run for this parser-only change.
