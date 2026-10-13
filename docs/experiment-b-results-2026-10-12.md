# Experiment B development findings — 2026-10-12

Keep production `spatial-review-v5`. Explicit basis constraints recover useful fields on Spam, but the first detector/automatic selector fails the development regression gate. Do not consume fresh reserved data or integrate this candidate into the scanner.

## What was implemented

An isolated saved-OCR harness represents basis instances, header/context labels, geometric value membership, unknown columns and percentage references. It runs unchanged baseline, oracle structure, conservative automatic selection and simulated explicit choice. Selected-basis association checks ownership before ranking and independently audits actual value sources afterward. Missing/damaged selected cells cannot borrow foreign quantities or percentages. Genuine percent-only micronutrients remain valid in the selected context, as requested.

The standalone gallery shows source images when available, actual OCR boxes, candidate contexts, corrected selections, diagnostics and all four replay modes. No production selection UI was added. The only production-module addition exposes frozen existing primitives; the production parser function and call sites are unchanged.

## Dataset and evidence limits

- 26 portable tracked OCR fixtures; 15 existing exposed pilot rectangle replays added locally.
- 41 case observations across 23 products; repeated exports/crops are not independent products.
- Structured spatial truth: Spam phone and pilot, bread (`new-2`), and one oil control. Codex visually reviewed original label/crop images and OCR geometry; this is not independent human review.
- Oracle and explicit efficacy: three multi-basis observations across two products, with 41 owner nutrient targets.
- Only one independently source-reviewed single-context detection control in this iteration. Other exposed cases supply field regression checks, not verified basis-detection ground truth.
- Real per-pack/per-serving, three-quantity-column, fragmented-header and separated-header coverage is incomplete. Synthetic tests establish mechanics only.
- No fresh reserved products, reference-phone timings or real user usability measurements were consumed.

Expected nutrient values never select a basis or enter the association algorithm. Oracle injection supplies reviewed column membership and selected identity, not expected row-to-value answers. Baseline source evidence distinguishes headers and unit support from value-bearing lines; boundary headers do not count as cross-column values.

## Paired multi-basis results

| Mode | Correct nutrients | Missing | Wrong populated | Cross-column substitutions |
| --- | ---: | ---: | ---: | ---: |
| A: unchanged v5 | 21/41 | 20 | 0 | 0 |
| B: oracle basis | 32/41 | 9 | 0 | 0 |
| C: conservative automatic | 0/41 | 41 | 0 | 0 |
| D: simulated explicit choice | 32/41 | 9 | 0 | 0 |

Automatic selection abstains on all three multi-basis observations, as intended when multiple contexts are credible. This is the expected interaction tradeoff, not a reason to silently prefer per serving.

Spam phone gains six nutrients: protein, trans fat, cholesterol, fiber, sugars and sodium. Pilot Spam gains five; its protein OCR is damaged. These eleven recovered observations are gains on **one product**, so the requirement for improvement across two independent products is not met. Unsupported nutrient names, hierarchical carbohydrate rows and the dual kJ/kcal energy cell remain unresolved; OCR/name handling was not broadened.

Bread retains all 21 previously correct nutrient fields, including eight genuine per-serving percent-only micronutrients. Its serving output remains unchanged. Selecting its per-100g context cannot import the per-serving macro quantities.

## Detection and automatic selection

On the four spatially reviewed cases, the detector matches 9/10 annotated basis/reference instances and labels all nine matched instances correctly. Intended selection is available on all three reviewed multi-basis observations. These counts do not establish reliable detection across the full corpus.

Among reviewed cases, automatic selection chooses the oil control correctly and abstains on the three multi-basis observations. No wrong automatic selections or false prompts occur in this very small reviewed control denominator (1).

Across the broader 38 control/other exposed regression observations, automatic nutrient recovery falls from **434/509 to 248/509**; baseline wrong values fall from 1 to 0 through abstention. Seventeen of all 41 observations require selection, including the three reviewed multi-basis cases. Extra clusters, unresolved unit/value structure and context fragmentation cause avoidable ambiguity on many other cases. Missing-field losses cannot be offset by gains on Spam.

All-label baseline and automatic totals have different purposes from oracle/explicit totals: B/D run only on cases with reviewed intended bases. Do not compare their totals without matching denominators.

## Gate and recommendation

The development gate fails because:

1. Oracle gains occur on only one independent product.
2. Automatic/scoped handling loses baseline-correct fields on the broader exposed regression set.
3. Required real-layout coverage is incomplete.

Selected-basis source safety, availability of the intended reviewed candidates and preservation of bread percent-only targets are promising. The supported conclusion is **parser-positive / detection-weak**, with limited development evidence. Inspect false columns and unit/section ownership, expand explicitly exposed development coverage, and rerun paired controls before any reserved validation. The harness intentionally rejects freezing or validating this candidate. No heavy production UX work is justified yet.

## Verification and reproduction

- **278 tests passed**, including 31 Experiment B tests.
- App and evaluation type checks, lint and production build passed.
- Production extraction is exactly equal to frozen v5 across all **41** replay inputs, including nutrition data, warnings and evidence. Serving outputs and evidence are unchanged in every experimental mode.
- Tests cover damaged/missing cells, foreign equal-valued columns, percentage context, shared units, fragmented headers, unknown/same-category columns, repeated panels, maximum one-to-one matching, immutable inputs/results, overwrite rejection and reserved-data barriers.
- Generated gallery selection/correction/reset passed a DOM smoke check: Spam sodium switches from 400mg to 714mg when changing contexts, then clears the selection when changing cases.

See the [harness guide](../evaluation/experiment-b/README.md) for commands. The local run is `evaluation/results/experiment-b-final-2026-10-12/`, with JSON, Markdown, field CSV and `review.html`. The [tracked summary](../evaluation/baselines/experiment-b-2026-10-12.json) retains effective config, source/input digests, gate results and aggregate metrics. Raw images and run artifacts remain ignored. Existing production behavior is retained; these findings do not establish absence of errors on unseen labels.
