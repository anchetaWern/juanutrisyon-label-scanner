# Experiment B — Explicit Nutrition-Basis Detection and Selection

**Project:** Juan Nutrisyon nutrition-label OCR  
**Status:** Experimental specification  
**Goal:** Determine whether making nutrition bases explicit and constraining nutrient/value association to a selected basis reduces multi-basis errors without degrading single-basis labels.

---

## 1. Background

The current nutrition-label pipeline is:

> photo → crop / optional straighten → quality advice → image enhancement → PaddleOCR → nutrient/value matching → review/export

Current relevant state:

- OCR: PaddleOCR.js 0.4.2 / PP-OCRv6 tiny
- Parser: `spatial-review-v5`
- Production behavior currently favors safety: ambiguous values may remain `null`
- Experiment A showed that re-running the same Paddle detector+recognizer on localized 1×/2× value crops should **not** be adopted
- The parser is no longer the dominant general bottleneck, but **multi-basis labels remain the biggest single-label association problem**

Examples of multi-basis layouts include:

```text
Nutrition Information

                 Per serving     Per 100 g
Energy           130 kcal        260 kcal
Protein          3 g             6 g
Sodium           210 mg          420 mg
```

or:

```text
                 Per pack        Per serving     %DV
Total Fat        14 g            7 g             9%
Sodium           600 mg          300 mg           13%
```

Perfect OCR does not solve this by itself. The system must decide which value column belongs to the intended nutrition basis.

---

## 2. Evidence vs hypothesis

### Evidence from the current project

1. Recent parser changes substantially improved general nutrient/value association.
2. The current parser can achieve zero wrong populated nutrient values on the development baseline while still leaving fields missing when uncertain.
3. Multi-basis tables remain a recurring high-impact failure mode.
4. OCR recognition errors and basis-association errors are distinct problems.
5. Experiment A showed that recognition changes can indirectly trigger a wrong neighboring-column association.
6. Multiple bases may contain simultaneously valid readings, so a parser cannot always infer the user's intended basis from OCR alone.

### Hypothesis being tested

> If the system explicitly identifies nutrition-basis columns and nutrient/value association is constrained to one selected basis, multi-basis accuracy will improve without harming single-basis labels.

Secondary hypothesis:

> Requiring or exposing a user basis choice only when multiple credible bases exist can eliminate avoidable cross-column errors with minimal interaction cost.

---

## 3. Primary research questions

Experiment B should answer four separate questions:

1. **Basis detection:** Can the system identify the bases that are actually present?
2. **Basis labeling:** Can it assign useful names such as `per serving`, `per 100 g`, `per pack`, or `%DV`?
3. **Selected-basis association:** Given the correct basis, can the parser reliably associate nutrient values within that basis?
4. **Interaction need:** How often can basis selection be automatic versus requiring user confirmation?

Do not collapse these into one aggregate accuracy number.

---

## 4. Scope

### In scope

- detecting multiple value columns/bases
- identifying basis headers
- representing bases explicitly
- selecting one basis for nutrient extraction
- constraining association to the selected basis
- measuring cross-column errors
- measuring effects on single-basis labels
- review/selection behavior in experiment tooling
- explicit fallback when basis is uncertain

### Out of scope

Do **not** change as part of Experiment B:

- PaddleOCR model
- OCR detector threshold
- OCR preprocessing defaults
- value/unit re-recognition
- nutrient-name OCR
- serving parser except where serving text is used as basis evidence
- JSON export semantics
- nutrient normalization
- confidence calibration
- cloud OCR
- alternative recognizers
- general parser rewrites unrelated to basis handling

Production behavior must remain unchanged until the experiment passes.

---

## 5. Experimental principle

This experiment should isolate **basis structure and association** from OCR recognition.

Use the same frozen OCR output for baseline and experimental parser comparisons wherever possible.

Conceptually:

```text
saved OCR
   ↓
identify nutrient rows
   ↓
identify candidate basis columns
   ↓
identify / label basis headers
   ↓
SELECT BASIS
   ↓
associate values only within selected basis
```

The experimental parser should not receive improved OCR text that the baseline does not have.

---

## 6. Definitions

### Basis

A distinct set of nutrient values sharing the same denominator/context.

Examples:

- per serving
- per 100 g
- per 100 mL
- per pack
- per container
- per piece
- per prepared serving
- as sold
- as prepared
- % Daily Value

### Basis header

OCR text that labels or strongly describes a basis.

Examples:

```text
Per Serving
Per 100 g
Per 100 mL
Per Pack
% Daily Value
%DV
```

### Basis column

A spatially coherent vertical group of nutrient values associated with one basis.

### Selected basis

The basis whose nutrient values should be used for extraction/export during the experiment.

---

## 7. Integration-point audit

Before implementation, identify and document:

1. where OCR tokens/boxes/polygons enter `spatial-review-v5`
2. how nutrient rows are currently represented
3. how competing values are currently ranked
4. whether column clustering already exists
5. how `%DV` values are distinguished from mass/energy values
6. how serving size / servings-per-container are represented
7. whether current parser output retains alternate candidate values
8. how parser diagnostics are generated
9. how benchmark owner truth identifies basis, if at all
10. how saved OCR replay is performed

Do not assume filenames or APIs.

If current benchmark truth does not identify the expected basis for a multi-basis label, record that gap before scoring.

---

## 8. Dataset requirements

### 8.1 Development set

Use existing multi-basis examples already exposed during development.

Include examples with:

- per serving + per 100 g
- per serving + %DV
- per pack + per serving
- three or more numeric columns
- split tables
- curved labels
- fragmented headers
- headers separated from nutrient rows
- repeated or partially duplicated panels

### 8.2 Single-basis controls

Include enough ordinary single-basis labels to verify that the new logic does not create unnecessary ambiguity or regressions.

### 8.3 Fresh reserved data

Do **not** consume fresh reserved labels until the experimental logic first clears the development gate.

Once development results are promising, capture fresh product-disjoint labels containing:

- at least several multi-basis layouts
- at least several single-basis controls

Fresh reserved labels must not be used for tuning clustering thresholds or header rules.

---

## 9. Ground truth additions

For multi-basis labels, benchmark truth should explicitly represent:

```json
{
  "bases": [
    {
      "id": "per_serving",
      "label": "Per serving",
      "expected": true
    },
    {
      "id": "per_100g",
      "label": "Per 100 g",
      "expected": false
    }
  ]
}
```

Where appropriate, each nutrient target should retain its basis:

```json
{
  "nutrient": "sodium",
  "basis": "per_serving",
  "value": "210",
  "unit": "mg"
}
```

If owner truth currently contains only one expected nutrient value without basis metadata, do not silently infer the basis unless it is unambiguous from the source label. Record the inference as provisional.

---

## 10. Experiment modes

Run at least three modes.

### Mode A — Current baseline

Run `spatial-review-v5` unchanged.

Record:

- selected value
- candidate values
- correct / missing / wrong
- cross-column mistakes

### Mode B — Oracle selected basis

Provide the experiment parser the **ground-truth intended basis**.

The parser must then associate nutrient values only within that basis.

Purpose:

> Measure the maximum benefit available from basis-constrained association if basis selection itself were perfect.

This separates:

- basis detection problems
from
- within-basis association problems

### Mode C — Automatically detected basis

Let the experiment detect available bases and choose a basis automatically using frozen rules.

Purpose:

> Measure real automatic behavior without user intervention.

### Mode D — Explicit user-selected basis

Expose detected bases and simulate or perform a one-step user selection.

Then constrain association to the selected basis.

Purpose:

> Measure the product value of explicit confirmation when auto-selection is uncertain.

If Mode B does not materially improve multi-basis accuracy, do not invest heavily in UI selection yet; the remaining issue is likely within-basis association.

---

## 11. Basis detection

The experiment should use both **textual** and **spatial** evidence.

### 11.1 Textual evidence

Look for header-like OCR text such as:

```text
per serving
serving
per 100 g
per 100g
100 g
100g
per 100 ml
100 ml
per pack
per container
per piece
% daily value
%dv
daily value
```

Matching should be tolerant of:

- capitalization
- punctuation
- spaces
- line fragmentation

Do not introduce speculative character correction merely to force a header match.

### 11.2 Spatial evidence

A basis candidate should be supported by a coherent column of value-like OCR tokens beneath or near the header.

Useful signals:

- similar x-coordinate / horizontal center
- repeated vertical alignment across nutrient rows
- consistent units/value styles
- header located above or near the value column
- multiple nutrient rows contributing to the same column cluster

### 11.3 Headerless basis columns

Some labels may show multiple aligned value columns but OCR may miss one or more headers.

The experiment may detect these as:

```text
unknown_basis_1
unknown_basis_2
```

Do not invent semantic labels.

Unknown bases may still be presented for explicit selection using visible examples.

Example:

```text
Column 1 — e.g. Sodium 210 mg
Column 2 — e.g. Sodium 420 mg
```

This is preferable to silently assigning the wrong basis name.

---

## 12. Column clustering

Implement basis-column grouping using simple, explainable geometry first.

Possible inputs:

- token x-center
- token left/right bounds
- row membership
- nutrient/value candidate membership

Avoid introducing a complex learned layout model in Experiment B.

The clustering logic should:

1. group value-like tokens by horizontal position
2. require support across multiple nutrient rows where possible
3. tolerate mild skew and curved packaging
4. avoid merging `%DV` with mass-value columns
5. avoid creating a new basis from one isolated number unless supported by a header

All thresholds must be configurable and reported.

Do not tune them on reserved data.

---

## 13. Distinguish `%DV` from nutrient quantity bases

`%DV` is structurally different from mass/energy bases.

Example:

```text
Sodium      230 mg      10%
```

The experiment should represent:

```text
basis: per_serving
value: 230 mg

basis: percent_dv
value: 10%
```

A `%DV` column must not be selected as the primary nutrient quantity basis when the expected export requires mass/energy values.

If both quantity and `%DV` are useful to the product later, that is a separate product-design decision.

For Experiment B, keep them distinct.

---

## 14. Basis labeling

Use conservative canonical categories when text supports them.

Suggested canonical IDs:

```text
per_serving
per_100g
per_100ml
per_pack
per_container
per_piece
as_sold
as_prepared
percent_dv
unknown
```

Preserve raw header text alongside canonical labeling.

Example:

```json
{
  "basis_id": "per_100g",
  "raw_header": "Per 100 g",
  "confidence_source": "header+geometry"
}
```

Do not collapse two distinct columns merely because both appear compatible with the same canonical category.

---

## 15. Auto-selection rules

Keep auto-selection intentionally conservative.

Suggested priority logic:

1. if only one non-`%DV` quantity basis exists → select it
2. if multiple quantity bases exist and one clearly matches an explicit product rule already defined elsewhere, select only if the rule is testable
3. otherwise → require selection / mark ambiguous

Do not add a hidden assumption such as:

> always prefer per serving

unless that is an explicit Juan Nutrisyon product requirement.

Experiment B should measure both:

- how well conservative auto-selection works
- how often explicit selection is still needed

---

## 16. Explicit-selection UX prototype

The experiment does not need final production UI, but should test a realistic selection model.

Example:

```text
Nutrition basis

● Per serving
  1 serving = 30 g

○ Per 100 g

○ % Daily Value
```

If labels are unclear:

```text
Nutrition basis

○ Column 1
  Sodium 210 mg · Protein 3 g

○ Column 2
  Sodium 420 mg · Protein 6 g
```

Requirements:

- show only credible basis candidates
- preserve the original label crop nearby if possible
- make the selected basis obvious
- allow correction before export
- do not hide ambiguity behind a confidence score

---

## 17. Selected-basis association

Once a basis is selected:

1. nutrient rows may only choose values assigned to that basis
2. values from competing basis columns must not be used as fallback merely because they have higher OCR confidence
3. if the selected basis lacks a usable value for a nutrient:
   - return `null` / review-required
   - do not borrow from another basis
4. `%DV` values must not substitute for mass/energy quantities
5. existing row-association safeguards remain active

This is the core safety behavior Experiment B is testing.

---

## 18. Failure categories

Every multi-basis error should be classified as one of:

### Basis not detected

The relevant basis column exists but the experiment does not identify it.

### Basis mislabeled

The column is detected but assigned the wrong semantic basis label.

### Wrong auto-selection

Multiple bases are detected, but the automatic selection chooses the wrong one.

### Cross-column association

The correct basis is known/selected, but a nutrient value is taken from another column.

### Within-basis association error

The selected column is correct, but row association within that column is wrong.

### OCR recognition error

The correct box/column is used, but the text itself is damaged.

Not an Experiment B parser failure.

### Missing value

The intended basis is selected, but no safe usable value is available.

Track separately from wrong populated values.

---

## 19. Primary metrics

Report multi-basis labels separately from all-label totals.

### 19.1 Basis detection recall

```text
correctly detected expected bases
---------------------------------
all expected bases
```

### 19.2 Basis labeling accuracy

Among detected bases, how many received the correct canonical label?

### 19.3 Auto-selection accuracy

Among labels where an intended basis is defined:

```text
correct automatic basis selections
-----------------------------------
auto-selected labels
```

Also report the abstention rate.

### 19.4 Oracle-basis nutrient accuracy

With ground-truth basis supplied:

- correct nutrients
- missing nutrients
- wrong populated nutrients

This is the most important diagnostic metric.

### 19.5 Explicit-selection nutrient accuracy

With the correct basis selected manually:

- correct nutrients
- missing nutrients
- wrong populated nutrients
- cross-column errors

### 19.6 Cross-column wrong values

Count any nutrient populated from a different basis than the selected one.

Target:

> **0**

---

## 20. Secondary metrics

Measure:

- number of bases detected per label
- number of labels requiring explicit selection
- percentage of single-basis labels unnecessarily prompting for selection
- number of unknown/unlabeled bases
- parser runtime impact
- UI interaction count
- percentage of nutrients left `null` because the selected basis lacked a safe value

---

## 21. Single-basis regression controls

Experiment B must not degrade ordinary labels.

For the single-basis control set, compare:

- correct nutrient fields
- missing fields
- wrong populated fields
- false multi-basis detections
- unnecessary user prompts

A basis system that improves complex labels but causes frequent prompts on ordinary labels is not ready for production.

---

## 22. Suggested result record

```json
{
  "image_id": "example-001",
  "multi_basis": true,
  "expected_basis": "per_serving",
  "detected_bases": [
    {
      "id": "per_serving",
      "raw_header": "Per serving",
      "column_x": 612
    },
    {
      "id": "per_100g",
      "raw_header": "Per 100 g",
      "column_x": 804
    }
  ],
  "auto_selected_basis": null,
  "requires_selection": true,
  "mode": "explicit_selection",
  "selected_basis": "per_serving",
  "nutrient_results": {
    "sodium": {
      "expected": "210 mg",
      "actual": "210 mg",
      "correct": true,
      "source_basis": "per_serving"
    }
  },
  "cross_column_errors": 0
}
```

Prefer existing benchmark/report conventions where practical.

---

## 23. Diagnostics

For every multi-basis label, make it possible to inspect:

- source label image
- OCR tokens/boxes
- detected nutrient rows
- candidate value columns
- basis header candidates
- canonical basis labels
- selected basis
- rejected competing columns
- final nutrient associations
- owner ground truth
- failure classification

A visual overlay is strongly preferred.

Suggested overlay:

- nutrient rows
- each basis column boxed/labeled
- selected basis highlighted
- rejected cross-column candidates visible

Do not rely only on JSON to debug spatial mistakes.

---

## 24. Decision logic

### Development gate

Proceed to fresh reserved validation only if:

1. oracle-basis mode materially improves multi-basis nutrient accuracy
2. cross-column wrong populated values are zero or lower than baseline
3. single-basis controls do not materially regress
4. explicit-selection mode is clearly safer than baseline on affected labels
5. auto-detection identifies the relevant bases often enough to make selection practical

### Production gate

Consider production only if fresh reserved data confirms:

- lower multi-basis wrong/missing field rate
- no increase in wrong populated values
- zero or near-zero cross-column substitutions
- acceptable prompt frequency on normal labels
- selection UI is understandable on a reference phone

---

## 25. Important interpretation rule

A good outcome may still involve more `null` values.

Example:

```text
Baseline:
correct 18
missing 2
wrong 4

Selected basis:
correct 20
missing 4
wrong 0
```

This may be preferable because wrong cross-column values are more harmful than review-required missing values.

Do not optimize purely for field coverage.

---

## 26. Recommended implementation phases

### Phase B0 — Audit

Document:

- current column logic
- candidate-value ranking
- OCR geometry format
- benchmark truth limitations
- existing diagnostics

No parser behavior changes.

### Phase B1 — Basis representation

Add experiment-only structures for:

- basis candidates
- headers
- columns
- labels
- selected basis

Do not yet change nutrient output.

### Phase B2 — Basis detection

Implement:

- header matching
- value-column clustering
- `%DV` separation
- unknown basis support

Generate diagnostics.

### Phase B3 — Oracle-basis replay

Inject the expected basis from benchmark truth.

Constrain association to that basis.

This phase determines whether basis-constrained parsing actually solves the target problem.

### Phase B4 — Automatic selection

Add conservative automatic selection.

Measure:

- correct selections
- abstentions
- wrong selections

Do not force selection when ambiguous.

### Phase B5 — Explicit-selection simulation/UI

Expose detected bases.

Allow one selected basis to drive association.

Measure the resulting nutrient accuracy and interaction frequency.

### Phase B6 — Regression run

Run:

- multi-basis development set
- single-basis controls
- existing regression suite

Production remains unchanged.

### Phase B7 — Recommendation

Conclude one of:

1. **Strong positive:** explicit basis selection should move toward production design
2. **Parser-positive / detection-weak:** selected-basis association works, but basis detection needs another experiment
3. **Auto-selection weak / manual strong:** expose explicit selection rather than guessing
4. **Negative:** basis constraint does not materially improve association
5. **Blocked:** ground truth or OCR structure is insufficient to evaluate

---

## 27. Expected final report

```markdown
# Experiment B Results

## Dataset
- multi-basis development labels:
- single-basis controls:
- expected bases:
- fresh reserved labels:

## Baseline

...

## Basis detection

| Metric | Result |
| --- | ---: |
| Expected bases detected | |
| Correct basis labels | |
| Unknown bases | |
| False basis detections | |

## Oracle selected-basis results

| Metric | Baseline | Oracle basis |
| --- | ---: | ---: |
| Correct nutrients | | |
| Missing | | |
| Wrong populated | | |
| Cross-column errors | | |

## Automatic selection

- correct:
- wrong:
- abstained:
- selection accuracy:
- prompt-required rate:

## Explicit selection

...

## Single-basis controls

...

## Representative fixes

...

## Representative failures

...

## Failure analysis

### Basis not detected
### Basis mislabeled
### Wrong auto-selection
### Cross-column association
### Within-basis association
### OCR recognition failures

## Conclusion

## Recommendation
```

---

## 28. Acceptance criteria for Experiment B implementation

The experiment is complete when:

- [ ] basis candidates are represented explicitly
- [ ] multiple basis columns can be visualized
- [ ] `%DV` is distinguished from quantity bases
- [ ] oracle selected-basis replay works
- [ ] selected-basis association cannot borrow from competing columns
- [ ] automatic selection can abstain
- [ ] explicit selection can be simulated/tested
- [ ] multi-basis and single-basis metrics are reported separately
- [ ] cross-column errors are counted explicitly
- [ ] OCR recognition errors remain distinguishable from association errors
- [ ] development and reserved sets remain distinct
- [ ] production behavior is unchanged
- [ ] final recommendation is evidence-based

---

## 29. Guardrails

Stop and report rather than broadening scope if Experiment B appears to require:

- retraining OCR
- changing OCR model
- adding local re-recognition
- introducing cloud OCR
- rewriting nutrient-name recognition
- inferring basis from expected benchmark values
- tuning thresholds on reserved labels
- silently defaulting to `per serving` without an explicit product rule
- borrowing values from another basis when the selected basis is missing
- using OCR confidence as proof of correctness

Those belong to separate experiments or product decisions.

---

## 30. Key interpretation scenarios

### Scenario A — Oracle basis strongly improves accuracy

Example:

```text
Baseline multi-basis:
31 correct / 9 missing / 4 wrong

Oracle selected basis:
39 correct / 5 missing / 0 wrong
```

Interpretation:

> Basis ambiguity is genuinely a major remaining parser problem.

Proceed with basis detection and explicit-selection UX.

### Scenario B — Oracle basis barely helps

Example:

```text
Baseline:
31 / 9 / 4

Oracle:
32 / 9 / 3
```

Interpretation:

> The remaining problem is not primarily basis choice. Inspect within-row association and OCR damage before investing in UI.

### Scenario C — Oracle strong, auto-selection weak

Interpretation:

> Explicit user basis selection is likely more valuable than more heuristics.

### Scenario D — Auto-selection strong and safe

Interpretation:

> Auto-select when unambiguous; expose selection only when multiple plausible bases remain.

### Scenario E — Explicit selection eliminates wrong values but increases missing fields

Interpretation:

> This may still be a successful safety improvement. Review missing-field cost separately from wrong-field cost.

---

## 31. Key question Experiment B must answer

At the end of Experiment B, we should be able to say:

> **When a nutrition label contains multiple legitimate value bases, does explicitly representing and selecting one basis materially reduce cross-column nutrient-association errors while preserving the project's zero/near-zero wrong-population standard?**

If yes, the next step is production UX and safe automatic-selection design.

If no, the next OCR-focused experiment should compare an alternative recognizer on the frozen Experiment A challenge crops.
