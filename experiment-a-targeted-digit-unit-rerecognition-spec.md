# Experiment A — Targeted Digit/Unit Re-recognition

**Project:** Juan Nutrisyon nutrition-label OCR  
**Status:** Experimental specification  
**Goal:** Determine whether re-recognizing small nutrient value/unit regions from the original-resolution image improves digit/unit accuracy without increasing incorrect populated nutrient values.

---

## 1. Background

The current nutrition-label pipeline is:

> photo → crop / optional straighten → quality advice → image enhancement → PaddleOCR → nutrient/value matching → review/export

Current OCR uses **PaddleOCR.js 0.4.2 / PP-OCRv6 tiny**. The current parser is **`spatial-review-v3`**.

Recent parser work materially improved nutrient/value association on the existing saved-OCR benchmark, so the next OCR experiment should focus narrowly on a recurring remaining failure mode:

- damaged or misread digits
- missing decimal points
- damaged or misread units
- tiny value text that is detected but recognized incorrectly

Examples:

- `180 mg` → `130 mq`
- `5.5 g` → `55 g`
- `230 mg` → `280 mg`
- `0 g` → `8 g`
- `12%` → `72%`

This experiment is **not** intended to solve:

- nutrient/value association
- multi-basis parsing
- panel selection
- row detection in general
- OCR of ingredient lists or arbitrary packaging text

Those should remain separate so the source of any accuracy gain is measurable.

---

## 2. Evidence vs hypothesis

### Evidence from the current project

1. Cropping previously improved nutrient recovery.
2. Straightening was not consistently better.
3. Whole-image preprocessing experiments, including 2× enlargement, did not meet adoption criteria.
4. Parser changes produced a large improvement on the existing saved-OCR development set.
5. Damaged/tiny digits and units remain a recurring observed failure mode.
6. Raw OCR and repeatable scoring/replay infrastructure already exist.
7. Incorrect populated values are considered more harmful than leaving an ambiguous field `null`.

### Hypothesis being tested

> Re-cropping a detected nutrient value/unit region from the **original-resolution source image** and re-running recognition on that localized region will recover more correct numeric/unit readings than the current whole-label OCR result.

A secondary hypothesis is:

> Enlarging the localized crop may help even though enlarging the whole image did not.

The previous whole-image enlargement result must **not** be treated as proof that localized enlargement cannot help.

---

## 3. Primary research question

**When a likely nutrient value/unit region has already been located, does targeted local re-recognition improve exact numeric and unit recognition without increasing wrong populated readings?**

---

## 4. Scope

### In scope

- nutrient numeric values
- decimal points
- units
- percentages when they are part of nutrient values
- localized re-cropping from original-resolution images
- localized resizing
- tightly controlled preprocessing variants
- experimental scoring and reporting
- replay using existing benchmark data where possible
- new reserved examples where existing data is insufficient

### Out of scope

Do **not** change any of the following as part of Experiment A:

- production detector threshold
- nutrient-name recognition logic
- nutrient/value association logic
- parser heuristics
- multi-basis interpretation
- table/column selection
- serving-size parser
- export schema
- production review behavior
- production confidence rules
- automatic fallback to Tesseract or another engine
- automatic replacement of production OCR output

If implementation requires touching shared code, production behavior must remain unchanged behind an experiment-only path or feature flag.

---

## 5. Core principle: isolate recognition from association

This experiment should avoid mixing OCR-recognition gains with parser gains.

Conceptually:

```text
original image
    ↓
existing detection / existing OCR geometry
    ↓
candidate value/unit region
    ├── baseline existing OCR result
    └── targeted crop from original-resolution image
             ↓
       re-recognition
```

The same nutrient/value association result should be used when comparing baseline vs experimental recognition wherever practical.

The experiment should answer:

> “Was the value itself read more accurately?”

not:

> “Did the full pipeline happen to produce more fields?”

Full-pipeline scoring should still be reported as a secondary outcome.

---

## 6. Integration-point audit

Before implementing the experiment, the local agent should identify and document the relevant existing integration points.

Do not assume filenames, class names, or APIs.

Find:

1. where the original-resolution uploaded/captured image is retained
2. where OCR boxes/polygons are stored
3. how OCR text and confidence are represented
4. where saved-OCR replay is implemented
5. where benchmark ground truth is stored
6. how nutrient/value matches retain source evidence
7. whether source image coordinates survive crop / straighten / resize transforms
8. how experiment results are currently written or displayed
9. how timing is currently measured, if at all
10. whether there is already a utility for extracting image regions from source coordinates

Document findings briefly before changing behavior.

---

## 7. Candidate selection

Experiment A should initially operate only on **likely nutrient value/unit regions**.

Preferred sources, in order:

1. regions already associated with a nutrient row by the current parser
2. OCR boxes adjacent to a recognized nutrient name
3. OCR boxes matching value-like patterns
4. manually annotated regions for benchmark-only cases

Useful value-like patterns include:

```text
<number>
<number><space?>g
<number><space?>mg
<number><space?>mcg
<number><space?>µg
<number><space?>kcal
<number><space?>kJ
<number><space?>%
```

Examples:

```text
0 g
2.5g
180 mg
35mcg
120 kcal
5 %
```

This pattern matching is only for selecting experiment candidates. It must **not** become a new production parser heuristic during this experiment.

---

## 8. Source image requirement

All targeted crops must be extracted from the **highest-quality image currently available before OCR downscaling/enhancement**, preferably the original-resolution label crop.

Do not crop the already enlarged, sharpened, compressed, or otherwise transformed OCR bitmap unless no original-coordinate mapping exists.

If coordinate transforms make this impossible, record that limitation explicitly.

If necessary, add a geometry utility that maps OCR coordinates back to the retained source image.

---

## 9. Crop generation

For each candidate value/unit region:

1. obtain its source-image bounding polygon/rectangle
2. convert to an axis-aligned crop for the first experiment
3. add configurable padding around the region
4. clamp crop bounds to the source image
5. preserve the crop for diagnostics

### Initial padding values

Test a small number of controlled values only:

- **10%**
- **20%**
- **30%**

Padding should be relative to the detected box width/height.

Do not combine every padding size with every other experiment variant unless automated evaluation makes this cheap and easy.

A practical first pass is:

- fixed 20% padding for all variants
- only test alternate padding if error review suggests truncation/context is a major issue

---

## 10. Experiment variants

Keep the first experiment deliberately small.

### Variant A — Baseline

Current production OCR result.

No new recognition pass.

### Variant B — Local crop, original scale

- crop value/unit region from original-resolution source
- use the current recognizer
- no artificial enlargement
- use minimal preprocessing consistent with current recognition requirements

### Variant C — Local crop, 2× enlargement

Same as Variant B, but enlarge the localized crop 2× before recognition.

Use a standard high-quality browser-supported interpolation method.

### Variant D — Local crop, 3× enlargement

Optional.

Run only if Variant C shows promising improvement or if the experiment harness makes this nearly free to compare.

### Variant E — Local crop + targeted preprocessing

Do **not** start here.

Add only after B/C have been measured.

Possible later preprocessing candidates:

- grayscale
- local contrast normalization
- mild sharpening
- inversion for light text on dark background

Each must be evaluated independently against the best prior variant.

Avoid creating a combinatorial matrix.

---

## 11. Recognition mode

If the current PaddleOCR integration exposes a recognizer-only mode, prefer that for localized crops.

If not, it is acceptable to run OCR again on the small crop, but document whether the second pass performs:

- detection + recognition, or
- recognition only

This distinction matters for interpretation.

Do not change the production PaddleOCR model in Experiment A.

---

## 12. Normalization for scoring

Scoring should distinguish raw OCR from normalized semantic value.

Retain both.

Example:

```json
{
  "raw_text": "18O mq",
  "normalized_candidate": "180 mg"
}
```

However, do **not** let aggressive normalization artificially inflate OCR accuracy.

### Exact OCR scoring

Use conservative normalization only for:

- trimming whitespace
- normalizing Unicode micro symbols where appropriate
- normalizing repeated spaces
- optionally standardizing case for units

Do not convert visually confusable characters such as:

- `O` → `0`
- `l` → `1`
- `q` → `g`

for the primary exact-recognition metric.

Those may be analyzed separately as recoverable post-processing errors.

---

## 13. Ground truth

Use existing human-labeled benchmark data wherever it already contains sufficient information.

Do **not** require creating a large new manually cropped dataset before testing the concept.

### Preferred hierarchy

1. reuse existing benchmark images + known nutrient values
2. automatically derive candidate regions from existing OCR geometry
3. manually annotate only cases where the candidate region cannot be reliably identified
4. add fresh phone captures to cover failure types missing from the existing set

### Reserved data

Maintain untouched/reserved products for evaluation.

Do not tune crop padding, scaling, or preprocessing based on all available products.

At minimum, separate:

- **development set**
- **reserved set**

If the existing 15-photo pilot is heavily used for tuning already, add fresh reserved phone captures before making a production decision.

---

## 14. Required benchmark composition

The benchmark should intentionally include:

- easy horizontal labels
- tiny nutrient values
- decimal values
- `g`
- `mg`
- `mcg` / `µg`
- `kcal`
- `%`
- glare
- mild blur
- curved packaging
- low contrast
- light text on dark background
- fragmented OCR
- values near table borders
- multiple value columns

Multi-basis examples may be included for recognition scoring, but basis association itself is **not** part of Experiment A.

---

## 15. Failure categories

Every evaluated value should be assigned, where possible, to one of these categories:

### Detection failure

The correct text exists in the image, but the relevant value region was not located at all.

Experiment A does not directly solve this.

### Recognition failure

The region was found, but digits/units were read incorrectly.

This is Experiment A's primary target.

### Association failure

The OCR text is correct, but the parser associates it with the wrong nutrient or column.

Do not count this as an OCR-recognition failure.

### Basis ambiguity

Multiple legitimate value columns exist and the desired basis is ambiguous.

Do not count this as an OCR-recognition failure.

### Intrinsically unreadable

The source image does not contain enough usable visual information for a reliable human transcription.

Track separately.

Do not treat forced OCR output as success.

---

## 16. Primary metrics

### 16.1 Exact numeric accuracy

Examples:

```text
230 → 230       correct
5.5 → 5.5       correct
230 → 280       incorrect
5.5 → 55        incorrect
```

### 16.2 Exact unit accuracy

Examples:

```text
mg → mg         correct
g → g           correct
mg → mq         incorrect
mg → g          incorrect
```

### 16.3 Exact value+unit accuracy

Examples:

```text
230 mg → 230 mg     correct
230 mg → 280 mg     incorrect
230 mg → 230 g      incorrect
```

This should be the **primary recognition metric**.

### 16.4 Wrong populated values

Count cases where the final system would populate an incorrect numeric value/unit.

This is a critical safety metric.

### 16.5 Recovered values

Count values that were wrong or missing in baseline but correct in the experimental variant.

### 16.6 Regressions

Count values correct in baseline but wrong/missing in the experimental variant.

---

## 17. Secondary metrics

Measure:

- median re-recognition latency per candidate
- p95 latency per candidate
- median added latency per label
- p95 added latency per label
- number of candidate regions per label
- percentage of labels requiring re-recognition
- memory impact where measurable
- crop extraction failures
- recognition-pass failures/exceptions

If easy to obtain, also record:

- OCR confidence before/after
- crop dimensions
- source text height in pixels
- scale factor
- failure category

OCR confidence must **not** be treated as calibrated correctness.

---

## 18. Full-pipeline secondary evaluation

After recognition-only scoring, replay the experimental OCR results through the existing parser without modifying parser logic.

Compare:

- correct nutrient fields
- missing nutrient fields
- wrong nutrient fields
- correct serving fields, if affected
- wrong populated readings

This is secondary because parser behavior can mask recognition changes.

Report both:

1. **recognition-only metrics**
2. **end-to-end metrics**

---

## 19. Suggested result record

Each candidate should produce an experiment record similar to:

```json
{
  "image_id": "example-001",
  "product_id": "optional-product-id",
  "nutrient": "sodium",
  "ground_truth": {
    "value": "230",
    "unit": "mg"
  },
  "baseline": {
    "raw_text": "280 mq",
    "value": "280",
    "unit": "mq",
    "correct": false
  },
  "variant": "local_crop_2x",
  "crop": {
    "padding": 0.2,
    "scale": 2,
    "width": 146,
    "height": 52
  },
  "result": {
    "raw_text": "230 mg",
    "value": "230",
    "unit": "mg",
    "correct": true
  },
  "failure_class_before": "recognition",
  "latency_ms": 84
}
```

Use the project's existing data/reporting conventions where possible rather than introducing a parallel framework unnecessarily.

---

## 20. Diagnostics

For every evaluated candidate, make it possible to inspect:

- source image
- original OCR box
- targeted crop
- enlarged/preprocessed crop
- baseline raw OCR
- experimental raw OCR
- ground truth
- parser-selected nutrient
- correctness classification

This should be easy to review manually for surprising gains/regressions.

A simple generated HTML report, existing debug UI, or image-folder + JSON/CSV output is acceptable.

Prefer reusing current diagnostic tooling.

---

## 21. Decision rules

A variant should be considered for production only if all of the following are true on **reserved data**:

1. exact value+unit correctness improves meaningfully
2. incorrect populated nutrient values do not increase
3. previously correct readings are not materially lost
4. latency remains acceptable for real phone use
5. gains are not concentrated only in the development images
6. improvements are visible across more than one label/failure pattern

### Hard safety rule

A variant that gains more correct readings but introduces a meaningful increase in incorrect populated readings should **not** be adopted automatically.

Prefer:

```text
ambiguous → null / review
```

over:

```text
ambiguous → plausible but wrong value
```

---

## 22. Suggested minimum success threshold

Do not treat these as universal statistical guarantees; they are practical experiment gates.

For a first promising result, require:

- at least **10% relative improvement** in exact value+unit correctness among recognition-failure candidates
- **zero increase** in wrong populated values on the reserved set
- no more than a very small number of baseline-correct regressions
- median added label latency that is acceptable in the current browser workflow

If the sample is small, report raw counts prominently rather than relying on percentages.

Example:

```text
Baseline:
42 / 70 exact

Local crop 2×:
53 / 70 exact

Recovered:
13

Regressed:
2

Net gain:
+11

Wrong populated values:
baseline 3
experiment 3
```

---

## 23. Production integration is NOT part of this experiment

Experiment A should end with evidence and a recommendation.

Do not automatically:

- replace production OCR text
- merge baseline + experimental readings
- add confidence voting
- silently choose between engines/passes
- trigger re-recognition for all labels
- ship new preprocessing globally

If the experiment succeeds, create a separate implementation phase defining:

- when targeted re-recognition should trigger
- how conflicting readings are handled
- when to keep `null`
- whether users see a review warning
- latency limits
- whether crops are processed sequentially or batched

---

## 24. If localized re-recognition fails

A weak or negative result is useful.

If B/C produce little improvement:

1. do not keep adding arbitrary preprocessing combinations
2. analyze failures by text height, unit type and image condition
3. determine whether the bottleneck is:
   - insufficient source detail
   - recognizer limitations
   - detector/crop geometry
4. use the result to justify Experiment C:
   - compare a stronger/alternative recognizer on the exact same localized crops

This provides a clean baseline for evaluating another OCR engine later.

---

## 25. Recommended implementation phases

### Phase A0 — Integration audit

Document:

- image lifecycle
- coordinate systems
- OCR geometry representation
- benchmark/replay entry points
- diagnostics
- timing utilities

No behavior changes.

### Phase A1 — Candidate crop extraction

Implement:

- candidate selection
- source-coordinate mapping
- crop extraction
- padding
- diagnostic crop export

No re-recognition yet.

Validate crop correctness manually on several labels.

### Phase A2 — Baseline + localized recognition harness

Implement:

- baseline capture
- Variant B
- Variant C
- raw output logging
- timing
- exact scoring

Do not modify production output.

### Phase A3 — Benchmark run

Run on:

- development set
- reserved set

Produce:

- summary table
- per-candidate records
- diagnostics
- gain/regression list
- latency results

### Phase A4 — Error analysis

Break results down by:

- digit count
- decimals
- unit
- text height
- glare/blur/curve
- baseline failure type
- scale factor

Decide whether local preprocessing deserves a follow-up experiment.

### Phase A5 — Recommendation

Conclude one of:

1. **Promising:** targeted re-recognition is worth production design
2. **Mixed:** run one narrowly targeted follow-up
3. **Negative:** move to alternative recognizer comparison
4. **Blocked:** insufficient source image quality / geometry prevents a valid test

---

## 26. Expected final report

Generate a Markdown report with this structure:

```markdown
# Experiment A Results

## Dataset
- development labels:
- reserved labels:
- candidate value regions:
- recognition-failure candidates:

## Variants
- baseline
- local crop 1×
- local crop 2×

## Recognition results

| Variant | Exact numeric | Exact unit | Exact value+unit | Wrong populated | Regressions |
| --- | ---: | ---: | ---: | ---: | ---: |

## Reserved-set results

...

## Latency

...

## Failure analysis

### Digits
### Decimals
### Units
### Tiny text
### Glare
### Curved labels

## Representative recoveries

...

## Representative regressions

...

## Conclusion

## Recommendation
```

---

## 27. Acceptance criteria for Experiment A itself

The experiment implementation is complete when:

- [ ] original-resolution candidate crops can be generated reliably
- [ ] baseline and experimental results are directly comparable
- [ ] raw OCR is preserved
- [ ] numeric, unit and combined exact-match metrics are produced
- [ ] detection, recognition, association and basis failures are distinguishable
- [ ] development and reserved data are reported separately
- [ ] wrong populated values and regressions are explicitly counted
- [ ] latency is measured
- [ ] diagnostic crops can be inspected
- [ ] no production OCR/parser behavior changes unintentionally
- [ ] a final evidence-based recommendation is produced

---

## 28. Non-goals / guardrails

The local agent should stop and report rather than silently broadening scope if the experiment appears to require:

- rewriting the nutrient parser
- changing multi-basis behavior
- replacing PaddleOCR
- redesigning capture UI
- adding cloud OCR
- changing JSON export semantics
- adding speculative OCR corrections such as `O → 0`
- globally changing preprocessing
- tuning against the reserved set

Those are separate experiments or implementation phases.

---

## 29. Key question this experiment must answer

At the end of Experiment A, we should be able to say:

> **Given a nutrition value region that the current system already roughly located, does re-reading a high-resolution local crop materially improve digit/unit recognition while preserving the project's zero/near-zero wrong-reading standard?**

If the answer is yes, the next task is to design a safe trigger and conflict-resolution strategy for production.

If the answer is no, the next best experiment is to compare an alternative recognizer on the same localized crops rather than continuing broad preprocessing tweaks.
