# Experiment B implementation plan

Status: implementation authorized by the user on 2026-10-12. The isolated development harness is implemented; see `experiment-b-results-2026-10-12.md`. Production integration remains unapproved and the development adoption gate failed.

Reviewed on 2026-10-12 against `experiment-b-explicit-nutrition-basis-selection-spec.md` and repository revision `335d5849558f6ff474ae732db5e78233de3f8e29`.

## Recommendation and confirmed decisions

Build a saved-OCR evaluation harness first. Prove selected-basis association with oracle geometry before investing in selection UI. Keep the scanner on unchanged `spatial-review-v5` throughout the experiment.

The user confirmed:

- Preserve genuine percent-only micronutrients when they belong to the selected serving context. Never use percentages as fallback for an existing or damaged quantity cell.
- Do not prefer per serving automatically. Select automatically only when a unique credible quantity basis exists; otherwise require a choice.

The first decision clarifies the spec's strict column constraint. Keep quantity and percentage columns structurally separate, but permit an explicitly proven, context-linked percent-only target. Record its actual percentage-column provenance and relationship to the selected context. This is an explicit exception, not blanket permission to mix columns. If context or the absence of a quantity cell cannot be established, abstain. A percentage column is not a primary quantity-basis radio option; display it as supporting information. This also resolves the conflict between sections 13 and 16.

## B0: integration audit

| Concern | Existing implementation | Implication |
| --- | --- | --- |
| OCR input | `src/services/ocr/types.ts`: `OcrResult.lines` with text, confidence, axis-aligned bounding boxes, optional tokens and source size | Use original line indexes and actual available token geometry. Parser input has no polygon contract. |
| Nutrient rows | Private `Anchor` objects in `parseNutrition.ts`: key, source box, inline tail, optional unit and source boxes | Reuse existing name recognition and normalization. Merged lines retain original geometry; do not invent character positions. |
| Candidate ranking | Inline values first; ordered complete columns; local spatial rows; percent-only rows; ordered percentages; separate-unit columns; tight explicit-unit rows; narrow explicit serving statements | A basis restriction must cover every association path. Filtering only the final prediction does not establish reliable within-basis extraction. |
| Columns | Label-column grouping and unit-column grouping exist, plus a narrow explicitly headed per-serving micronutrient exception | These are not a general basis detector. Side-by-side nutrient sections can share one basis. |
| Ambiguity | Most per-100/as-sold/as-prepared tables block nutrient extraction; duplicate nutrients and multiple panels also block | A selected basis must bypass only the relevant basis ambiguity, never panel, duplicate-row or damaged-cell safeguards. |
| Percentages | Percent headings bound quantity searches; genuine percent-only micronutrients are supported; damaged quantity cells block percentage fallback | Preserve these distinctions and apply the confirmed context policy. |
| Serving | `data.serving` has `serving_size` and `servings_per_container`, both strings or null | Copy baseline serving output and evidence unchanged. Read serving text as basis evidence without changing serving extraction. |
| Output | `NutritionExtraction` contains data, warnings, source line indexes/text and method | No alternate candidates or basis identity. Add these to an experiment envelope, not exported nutrition JSON. |
| Review UI | `ScannerNutritionResult.vue` shows JSON and warnings; evidence is available in diagnostics | Build a separate experiment review page. Do not add controls to the production scanner. |
| Truth | `evaluation/types.ts` has field truths and product/split provenance, but no structured basis truth | Introduce an experiment sidecar with reviewed basis, context and geometry annotations. |
| Replay | `evaluation/load.ts`, pilot replay and `evaluation/phone/compare.ts` load saved OCR and score parser output; Experiment A supplies hashing/freeze/gallery patterns | Reuse evaluation conventions, not Experiment A's OCR runner or exact-unit recognition scorer. Freeze current v5, not an older comparison baseline. |

The baseline cannot expose its actual internal alternate ranking without instrumentation. For Mode A, collect a separate, clearly labeled diagnostic candidate inventory from the same OCR. Do not claim these candidates were considered by v5 or modify its output to expose them.

## Dataset and truth preparation

1. Inventory exposed pilot, mobile and phone replay cases by product and layout. Existing historical holdouts are exposed development/regression data, not fresh reserved data. Avoid treating repeated exports/crops of one product as independent products.
2. Start with Spam's per-56g/per-100g table and mobile `new-2`'s headed micronutrient columns. Spam's panel note identifies per-56g owner truth; `new-2` provenance identifies Per Serving. Both still need structured, spatially reviewed annotations.
3. Include quantity-plus-percentage controls, Tang and wafer split sections, curved/detached-value cases, separate-unit cases, and repeated-panel negatives. Blue tub's selected upper panel excludes its lower dual-basis panel; do not count that crop as dual-basis evidence. Panel selection remains a separate problem.
4. Produce a coverage matrix for every requested layout. Per-pack/per-serving, three quantity columns and fragmented/separated headers must be verified, not assumed present. Synthetic fixtures can test mechanics but cannot substitute for real-label efficacy evidence. Any additional development captures must be declared exposed and frozen before comparisons.
5. Annotate basis instances, canonical labels, raw headers, denominator/context, table/section relationships, intended basis, and field-level targets. Retain owner truth separately from supplemental annotations. Missing intended-basis metadata blocks scoring of selection correctness; source-based provisional annotations remain visibly provisional until reviewed.
6. Add source-image regions and OCR line/token memberships for headers and value cells, including damaged cells. Record genuine percent-only targets and their context links explicitly. Do not infer basis ownership from equality with expected nutrient values.
7. Keep annotations available to the scorer only. The oracle parser receives structural basis membership/regions and selected identity, never expected values or expected row-to-value answers. Detection and automatic selection receive neither annotations nor oracle geometry.

Show missing-source-image and insufficient-geometry cases as exclusions with reasons. They may remain regression replays, but cannot supply independently verified spatial attribution. Validate saved image/OCR coordinate transforms before rendering overlays.

## B1–B2: representation and detection

Proposed experiment modules under `evaluation/experiment-b/`: `types.ts`, `dataset.ts`, `headers.ts`, `columns.ts`, `association.ts`, `selection.ts`, `replay.ts`, `report.ts`, `gallery.ts`, `cli.ts`, tests and README. Add an `experiment:b` package script. Keep raw run artifacts under gitignored `evaluation/results/` and publish compact findings/baselines separately.

Represent stable basis instance IDs independently of canonical categories: two per-serving columns must remain distinct. Store quantity/percentage kind, denominator, preparation context, raw header lines, geometric support, section IDs, member cells, unknowns, ambiguities and rejection reasons. Preparation state can qualify a denominator, such as per-100g as-prepared; it is not necessarily a competing column by itself.

Use explainable geometry normalized to source dimensions and local text height. Match header fragments conservatively, associate nearby repeated value cells, and tolerate modest skew with row-relative alignment. Require multiple nutrient-row support unless an explicit header supports a sparse column. Preserve damaged cells as occupancy blockers. Keep bare percentages under a percent heading separate from bare quantities. Retain %DV/%RENI/%RNI raw labels without pretending they are identical reference schemes.

Do not equate every x-cluster with a new basis: split nutrient sections can share one context, and separate unit/value columns can be one quantity stream. Conversely, do not merge columns solely because their canonical labels match. Conflicting or missing evidence yields unknown/unassigned candidates. If one OCR line spans multiple values without actual token geometry, abstain rather than estimate character coordinates.

Store all thresholds and rule versions in run provenance. Match detected to annotated columns one-to-one by reviewed geometry/membership, not by semantic label or value equality, so mislabeled columns remain detectable as such. Report detection precision/false detections as well as recall; separately report percentage columns and quantity bases.

## B3: oracle association before UI

Use a separate experiment entry point accepting original OCR, structural candidates and an explicit selection. Prefer narrowly extracting existing pure nutrient/amount helpers for reuse, with no behavior changes, over copying the whole parser. Keep `parseNutrition(result)` and all production call sites unchanged. Any shared extraction requires exact default-output parity checks against the frozen v5 baseline, including evidence and warnings.

Within the experimental association path:

- Build a selected-basis eligibility view before candidate grouping/ranking. Preserve original text, geometry and source IDs; do not delete headers to trick v5 past its blocker.
- Reuse existing unit validation, row ownership, complete ordered alignment, duplicate/panel/footer safeguards and damaged-cell blockers. Scope duplicate detection to the selected table without hiding genuine repeated panels.
- Keep foreign and ambiguous cells visible as exclusions/blockers, never fallback candidates. Do not invent units or repair OCR beyond unchanged existing normalization.
- Gate inline, detached, separate-unit, ordered, percentage and statement paths. Unsupported basis ownership means null. Preserve the original serving result unchanged.
- For a context-linked percent-only target, require positive evidence of a genuine percent-only row and selected-context ownership. A missing/damaged quantity, or an unlinked percentage column, cannot qualify.
- Audit final value-bearing sources independently of the candidate filter. Separate label/header/unit support from actual value sources. Reject any prohibited source, even when its value equals the selected column's value. Report rejected attempts as well as escaped violations.

Oracle geometry measures association independently of detection. Do not implement Mode B merely by selecting a detected candidate with a ground-truth label: that would confound detector failure with association failure. Stop before substantial UI work if oracle results do not support the hypothesis.

## B4–B5: automatic and explicit selection

Mode A runs frozen v5 unchanged. Mode B receives oracle structural basis data. Mode C uses detected candidates only, auto-selects a single credible quantity basis and otherwise abstains. Mode D chooses only among detected candidates; a missing intended candidate remains a detector miss, not an injected oracle choice.

Run explicit-selection simulation first, clearly labeled as ideal user choice rather than measured usability. Resolve the intended candidate using the scorer's geometric correspondence, including unknown but correctly detected columns. Then build a small standalone review page after the oracle checkpoint: label crop, colored columns, headers, sample nutrient values, selected state, rejected alternatives and rerun results. Unknown columns use visible examples. Selection must be correctable and must reset when switching cases. No cloud/OCR work or production export integration is needed.

Preserve percent-only behavior when there is a proven unique context, including labels with no useful quantity column. A percentage-only context is not permission to select %DV as a substitute quantity basis. Ambiguous percentage context must abstain and remain visible in regression results.

## Metrics, gates and verification

Report Mode A/B/C/D paired field outcomes separately for multi-quantity-basis labels, quantity-plus-percentage labels, percentage-only labels and ordinary controls. Retain owner-only versus supplemental results and product counts. Score all annotated fields, not just recovered targets.

Report detection recall/precision, labeling accuracy among matched columns, unknowns, auto-selection precision and coverage/abstention, explicit-choice availability, prompt rate/false prompts, correct/missing/wrong/false-positive fields, cross-column sourcing, context-linked percent-only outputs, reason-specific nulls and runtime. Include denominators and unscored/excluded cases. A foreign-column source is a violation even if the numeric answer happens to be correct. An approved context-linked percentage is separately identified, not disguised as a quantity-column source.

Classify failures using reviewed source attribution: detector miss, wrong label, wrong selection, cross-column, wrong row within basis, OCR recognition failure, or missing safe value. Allow uncertain attribution rather than using whole-panel string presence as proof. Recognition-caused wrong outputs still count in end-to-end safety totals; they are not charged to association in causal analysis.

Recommended development gates, to freeze before evaluating results:

- Default production API: exact parity with frozen v5 across saved fixtures, including warnings/evidence, and unchanged OCR inputs, serving output and nutrition JSON schema.
- Experimental controls: zero newly wrong/changed-wrong/false-positive fields, zero lost baseline-correct fields, and zero unnecessary basis prompts on reviewed single-context controls. Gains elsewhere cannot offset a control regression.
- Selected-basis safety: zero prohibited cross-column outputs in oracle and explicit modes, zero wrong automatic selections, and no increase in wrong populated fields. Approved percent-only context links must pass their own provenance checks.
- Material benefit: propose at least three additional correct owner nutrient fields across at least two independent multi-quantity-basis products, with no lost correct fields on those products. Report wrong-to-null safety improvements separately. This is a conservative operational proposal, not a threshold specified by the source document.
- Practical selection: propose that every reviewed development label requiring a choice exposes its intended quantity basis, allowing an unknown label if its examples support selection. If this fails while oracle association succeeds, conclude parser-positive/detection-weak rather than force selection.

If the available corpus cannot support these product counts/layouts, report insufficient evidence and expand declared development data before freezing; do not consume reserved data to fill the gap. Review these proposed gates before a frozen efficacy run.

Meaningful tests cover missing/damaged selected cells with valid foreign neighbors; equal values in different bases; percent-only context links and damaged-quantity rejection; inline merged boxes; fragmented/ambiguous headers; same-category distinct columns; sparse unknowns; split sections; separate units; skew/scale/order invariance with remapped source IDs; duplicate panels; selector correction; one-to-one detection scoring; immutable OCR/truth and product split separation. Run focused tests, the full existing suite, app/evaluation type checks, lint and build. Replay existing portable phone/owner fixtures against current v5, not historical parser revisions.

Freeze code/config/input/truth hashes and reject stale resumes. Record parser-only timings separately from file loading/rendering and label desktop measurements accurately. Publish JSON, field CSV, Markdown report and a spatial review gallery following the spec's report sections.

## Reserved validation and completion

Only after the development gate passes, obtain fresh product-disjoint multi-basis and single-basis labels. Keep their OCR, annotations and results out of tuning. A reserved failure requires a new development iteration and a new untouched reserved set; do not reuse the failed set as fresh validation.

Fresh-label availability, reference phone/browser, sample counts, acceptable phone overhead and UX prompt thresholds must be agreed before reserved validation. These do not block the local development harness. Simulation cannot establish understandable phone UX.

Deliver the harness, reviewed annotations, reproducible comparisons, gallery, findings and one of the spec's five conclusions. Development-only evidence must be labeled as such. A positive result supports later production design; this plan does not authorize production integration.
