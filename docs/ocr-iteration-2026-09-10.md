# Mobile OCR iteration — 2026-09-10

## Result

Select PaddleOCR.js 0.4.2 PP-OCRv6 tiny, configuration `v6-tiny-recall-v2`:
retain grayscale/contrast/light sharpening and lower text detection box acceptance
from 0.6 to 0.45. Models, worker execution, and WASM thread count remain unchanged.
Raw OCR text is preserved, including uncertain digits and source spelling.

This is a small recall improvement, not evidence that unattended nutrition parsing
is reliable. No parser, nutrient correction, automatic panel detection, or cloud
extraction was added.

## Controlled experiments

Each run used all 30 manually verified source crops with the frozen 18 development,
8 holdout, and 4 regression splits. One exported iPhone Brave crop of label 030 was
evaluated separately and excluded from every corpus aggregate. Source images and
annotations were not modified. Times below are desktop Chrome measurements,
including preprocessing and recognition but excluding initialization.

| Experiment | Development | Holdout | Regression | Aggregate | Seconds/image | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Previous production baseline | 62.48% | 59.40% | 75.44% | 63.34% | 1.39 | Baseline |
| Preserve color | 63.62% | 58.97% | 76.32% | 64.03% | 1.38 | Reject: holdout loss and per-image regressions |
| Detector maximum side 1280px | 62.86% | 58.55% | 73.68% | 63.12% | 1.05 | Reject: holdout/regression loss |
| Detector box threshold 0.45 | 62.48% | 60.68% | 76.32% | 63.80% | 1.43 | Keep: no drop in any image's three tracked recall counts |
| Polygon expansion ratio 2.0 | 60.57% | 61.11% | 74.56% | 62.54% | 1.37 | Reject: development/regression loss |
| Detector maximum side 1600px | 60.76% | 59.40% | 74.56% | 62.20% | 1.20 | Reject: development/regression loss |

The selected candidate increased aggregate composite recall by 0.46 percentage
points with roughly 3% additional processing time. This small dataset does not
establish statistical significance; new on-device cases remain necessary.

The final default-path run reproduced the selected candidate's exact OCR text for
all 30 corpus cases and the same split scores, with zero provider failures. Its
average processing time was 1.49 seconds/image (about 7% above the baseline run),
illustrating timing variation between runs. Budget approximately 3–7% desktop
overhead from these measurements rather than promising a speed improvement.

The installed SDK's bundled pipeline explicitly uses minimum side 64px and maximum
side 4000px, not the 960px maximum-side fallback found elsewhere in its source.
Thus the 1280px/1600px caps reduced detector resolution on larger images. Production
now explicitly supplies the SDK defaults plus the selected threshold, and includes
those settings in copied diagnostics.

## Phone crop findings

The baseline reproduces the supplied phone failures closely. Threshold 0.45 recovers
`Includes 2g Added Sugar`, additional percentage boxes, and more header fragments.
It retains Calories `80` and the main already-recognized nutrient values. Serving
count and `(85g)` remain unreliable; `Og` and `Omcg` remain raw OCR character errors.
More permissive detection also introduces noisy fragments, which are not silently
rewritten into nutrition facts.

The packaging itself prints `Cholestrol`. The earlier conversation incorrectly
classified this source spelling as an OCR error. A future parser may normalize it,
but raw OCR should preserve it.

The attached export is 1511×2400 and 882182 bytes; the phone diagnostics reported
1511×2400 and 869084 bytes. The reproduction therefore uses a re-encoded export,
not the exact input bytes. Observed baseline iPhone time was 10.355 seconds total
(5.598 initialization, 0.633 preprocessing, 4.120 recognition). No improved iPhone
runtime has been measured yet; desktop timings cannot substitute for that test.

## Metric limitations

The composite averages fragment, keyword, and numeric/unit recall. Numeric matching
searches the complete text and can match a substring (`0g` within `10g`); it does
not establish row association. The existing ten core nutrient metrics do not cover
serving details, added sugar, or micronutrients comprehensively. Some corpus score
gains come from extra detected text or isolated numbers. Recovery of the added-sugar
row was checked directly in the supplemental OCR output rather than inferred from
the composite. Benchmark metric definitions were held fixed for this comparison.

## Reproduction and artifacts

The existing `labels/` and `benchmark/` directories are gitignored and stay local.
The local harness uses the same production adapter and stores full results under
`benchmark/results/`, Markdown under `benchmark/reports/`, and the independent phone
crop under `benchmark/mobile/`. This tracked report records the decision for code
review; reproducing benchmarks on another checkout requires that local corpus/harness.

```sh
npm run benchmark:paddle -- --experiment mobile-baseline
npm run benchmark:paddle -- --experiment mobile-color
npm run benchmark:paddle -- --experiment mobile-det-1280
npm run benchmark:paddle -- --experiment mobile-box-045
npm run benchmark:paddle -- --experiment mobile-unclip-2
npm run benchmark:paddle -- --experiment mobile-det-1600
npm run benchmark:ocr
```

Experimental runs do not overwrite `latest.json`. The final default run updates it
and writes `provider-paddleocr-v6-tiny-recall-v2.json`. Supplemental results live in
`supplementalImages`, outside the frozen aggregates. The headless runner disables
file watching so editing source cannot silently restart a benchmark midway.

After deployment, scan label 030 once plus 3–5 different labels on the phone and
send copied diagnostics with crops saved to Files. Diagnostics should identify
`v6-tiny-recall-v2` and `textDetBoxThresh: 0.45`. Check missed rows, added noise,
first-scan timing, and repeat-scan timing before increasing the test batch.
