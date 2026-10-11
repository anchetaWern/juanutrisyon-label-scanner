# Phase 4 preprocessing study — 2026-10-11

The experiment implementation and development comparison are complete. **Retain production configuration `v6-tiny-recall-v2`.** None of the five preprocessing alternatives passed the frozen development criteria. This round establishes no production accuracy improvement; the scanner's preprocessing, models, parser and UI remain unchanged.

## Controlled comparison

The study uses the Phase 2 corpus fingerprint `425705706287eec5111d543c75e9b73eed8387d236a755603b8e39becb1c989c`. All 45 newly prepared PNGs are byte-for-byte identical to the Phase 2 inputs. Every configuration processes the ten development photos as original, rectangle and perspective variants, for 180 development OCR cases. The control reproduces the earlier field counts exactly.

Configurations, source hashes and selection rules were frozen in `plan.json` before OCR. Scoring uses only the owner's 137 nutrient and 20 serving values for development, with the unchanged `field-exact-v1` scorer and nutrition parser. Codex supplemental transcriptions are excluded. All settings keep PP-OCRv6 tiny, WASM with one thread, and the detector box threshold of 0.45. The SDK supports preprocessing through image input and explicit prediction parameters; see the [official PaddleOCR.js documentation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md).

| Preprocessing | Original nutrients /137 | Rectangle nutrients /137 | Perspective nutrients /137 | Rectangle serving /20 | Wrong rectangle nutrients | Rectangle mean ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current grayscale/contrast/sharpen | 47 | 70 | 62 | 10 | 2 | 892 |
| Color | 43 | 61 | 66 | 10 | 0 | 879 |
| Grayscale/contrast, no sharpening | 44 | 63 | 58 | 9 | 2 | 881 |
| Current enhancement at 2× scale | 45 | 64 | 68 | 8 | 1 | 1505 |
| Grayscale/contrast at 2×, no sharpening | 54 | 69 | 69 | 8 | 0 | 1547 |
| Color at 2× scale | 50 | 61 | 70 | 9 | 4 | 1539 |

Scale 2 requests interpolation and is capped at 2400 pixels on the longest side; large originals therefore receive less than 2× enlargement. All observations are paired variants of ten photos. Times are one desktop Chrome batch, include preparation for OCR and recognition, and exclude model initialization. They do not establish phone performance or stable speed differences.

## Selection decision

The development rule requires at least three more exact nutrient fields on rectangles, no additional wrong nutrients or serving strings on any variant, no loss of correct nutrients summed across variants, no provider failures, and a bounded runtime increase. No alternative meets these rules.

The contrast/upscale candidate improves original and perspective nutrient recovery and removes both rectangle nutrient errors. However, it recovers one fewer rectangle nutrient, two fewer rectangle serving fields, and three fewer perspective serving fields, while increasing perspective serving-string errors from three to five. Its rectangle mean processing time is about 73% higher. This is a precision/recovery tradeoff worth recording, not evidence for switching every scan to that setting.

Some strict serving errors involve punctuation or leading separators rather than incorrect amounts. Those remain separate from missing fields and incorrect nutrient quantities in the saved field CSVs. Neither annotation policy nor scoring was relaxed after observing results.

Keeping control follows the frozen selection criteria; it does not establish that the current pipeline is globally optimal. These five alternatives do not cover local illumination normalization, specialized recognizers, nonlinear dewarping or every possible scale. Further recognition experiments can use the saved development evidence, with a new frozen plan.

## Validation and artifacts

The selection was frozen as `control` before validation. Since no alternative qualified, only control was recognized on the five reserved products; rejected candidates were not tested against their labels. Validation reproduced Phase 2: original 24/54 nutrients, rectangle 27/54, perspective 28/54; each recovered 3/10 serving fields, with no wrong scored fields. All 195 recognition cases completed without provider failures. The existing Phase 2 report already exposed these images for annotation/evaluation, so they are a small reserved set from the same capture collection, not a new independent blind test.

Full local artifacts are in `evaluation/results/phase-4-pilot-2026-10-11/`: `plan.json`, the unchanged dataset, prepared images/gallery, six development run/checkpoint/report directories, `selection.json`, and the validation artifacts. [The compact baseline](../evaluation/baselines/phase-4-2026-10-11.json) preserves counts, gates and artifact hashes. Photos, labels, generated PNGs and full OCR remain gitignored and unchanged.

The [Phase 4 guide](../evaluation/phase4/README.md) describes preparation, development, validation and replay commands. The shared browser runner now accepts an explicit OCR configuration and split, records them in checkpoints, filters OCR jobs before they reach the browser, and rejects incompatible resumes. Phase 2 still defaults to production settings and all 15 photos.

Checks include the complete test suite, app and evaluation type checks, lint, production build, unchanged Phase 1 replay results, identical prepared PNG hashes, completed-run resume without new OCR, and rejection of changed-config/changed-split resumes. Existing OpenCV externalization and large-bundle build warnings remain.

## Next implementation target

Phase 5 parser/layout work now has clearer priority. Recognition changes alone are not consistently improving extracted fields. The development fixtures include incorrect vitamin-D/zinc row assignments (03), fragmented serving text (13), competing panels (04 and 10), and the fragile ordered-column layout on 07. Presence probes show more names and some correct values in several alternative OCR outputs even when fewer complete fields are extracted; those probes are whole-panel diagnostics and cannot prove correct row association.

Use the saved development OCR to add structural association checks, prevent wrong-row values, and join serving fragments conservatively. Track wrong values and missing fields separately, then evaluate preselected changes on the reserved set. This study does not implement those parser changes or claim the remaining failures are all caused by the parser.
