# Codex Prompt — Phase 1.5: Automated Nutrition Label OCR Benchmark

You are working on the standalone Juan Nutrisyon Nutrition Label Scanner.

The app is already implemented as a standalone Vue 3 + TypeScript + Vuetify + Vite project. Phase 1 includes image capture/upload, manual crop, image-quality checks, an OCR abstraction, a Tesseract implementation, OCR text output, bounding boxes, and a debug view.

## Working Directory Assumption

Assume the CURRENT WORKING DIRECTORY is already the root of the existing standalone Nutrition Label Scanner Vue application.

In other words, the repository/project should already look roughly like:

```text
<scanner-app-root>/
├── package.json
├── src/
├── public/
├── vite.config.ts
├── labels/
└── ...
```

The `labels/` directory is located directly under this project root:

```text
./labels/
```

Important:

- Do NOT create a new Vue project.
- Do NOT search for or initialize another scanner app elsewhere.
- Do NOT change the working directory to the existing Juan Nutrisyon app.
- Do NOT create a nested app such as `nutrition-label-scanner/nutrition-label-scanner/`.
- Treat the current directory as the scanner application's root.
- Add benchmark files/folders directly under this project root where appropriate.
- Run project commands such as `npm run benchmark:ocr` from this root.

A set of representative nutrition-label images is available locally in:

```text
./labels/
```

Your task is to build an automated benchmark/evaluation loop and use it to improve OCR quality across the entire corpus.

## Core rule

Do NOT optimize for one image.

Do NOT add filename-specific rules, fixture-specific crop coordinates, exact-dimension checks, one-off thresholds chosen for a single label, or special cases triggered by text found in one fixture.

Every OCR/preprocessing change must be evaluated against the whole corpus.

A change should only be kept when it improves aggregate performance without unacceptable regressions.

---

## 1. Inspect the existing project and corpus first

You are already at the root of the existing standalone scanner app. Do not initialize or locate another application.

Before changing production OCR behavior:

1. Inspect the current OCR abstraction.
2. Inspect the Tesseract adapter/configuration.
3. Inspect preprocessing, crop, and image-quality utilities.
4. Inspect existing test/build tooling.
5. Inspect all images inside `labels/`.
6. Determine whether any annotations/ground-truth files already exist.
7. Do not modify the original images.

Report:

- total image count;
- image formats;
- approximate dimensions;
- whether labels are already tightly cropped or include surrounding packaging;
- obvious variation in label styles;
- whether ground-truth annotations already exist.

---

## 2. Create a benchmark structure

Keep `labels/` as the source image corpus.

Create benchmark metadata/results separately, for example:

```text
benchmark/
├── manifest.json
├── annotations/
├── results/
├── reports/
└── experiments.md
```

Each label should have a stable ID.

Example manifest entry:

```json
{
  "id": "label-001",
  "image": "../labels/001.jpg",
  "split": "development",
  "tags": ["grid-lines", "old-us-format"],
  "annotation": "./annotations/label-001.json"
}
```

Do not duplicate large images unnecessarily.

---

## 3. Ground truth format

The long-term benchmark should prioritize STRUCTURED NUTRITION VALUES, not perfect transcription of every word.

Preferred annotation format:

```json
{
  "id": "label-001",
  "serving": {
    "serving_size_text": null,
    "servings_per_container": 9
  },
  "nutrients": {
    "energy_kcal": 175,
    "total_fat_g": 6,
    "saturated_fat_g": 4,
    "trans_fat_g": 0,
    "cholesterol_mg": 0,
    "sodium_mg": 70,
    "carbohydrate_g": 31,
    "fiber_g": 0,
    "sugars_g": 11,
    "protein_g": 2
  },
  "expected_text_fragments": [
    "Nutrition Facts",
    "Calories 175",
    "Total Fat 6g",
    "Saturated Fat 4g",
    "Sodium 70mg",
    "Total Carbohydrate 31g",
    "Protein 2g"
  ],
  "tags": ["grid-lines", "old-us-format"],
  "verified": true
}
```

Rules:

- never invent missing values;
- use `null` when a value is not present or unreadable;
- keep exact nutrient values;
- expected text fragments are secondary diagnostics;
- structured nutrition values are the eventual primary metric.

If annotations do not exist:

1. inspect whether you can reliably read values from the images;
2. you may DRAFT annotations if values are visually clear;
3. mark drafted annotations as `"verified": false`;
4. never treat unverified annotations as authoritative benchmark ground truth;
5. generate a concise human-review checklist for labels needing confirmation.

Do not derive ground truth solely from Tesseract output.

---

## 4. Split the corpus

Create deterministic splits and store them in the manifest.

Target approximately:

```text
60% development
25% holdout
15% regression
```

If the corpus is small, use sensible integer counts while keeping each split useful.

### Development
May be inspected in detail while improving OCR.

### Holdout
Used to check generalization. Do not tune production behavior to individual holdout fixtures.

### Regression
Contains difficult or historically important cases. Once they work, later changes should not silently break them.

Do not reshuffle the split just to improve reported scores.

---

## 5. Tag useful label characteristics

Where reasonably inferable, use tags such as:

```text
clean-flat
grid-lines
no-grid-lines
old-us-format
new-us-format
philippine-format
per-serving
per-100g
multi-column
glossy
curved
bottle
can
sachet
box
low-light
glare
slight-blur
perspective
small-text
colored-background
```

Only apply tags you can support from the image.

These tags should later allow accuracy breakdowns by category.

---

## 6. Build an automated OCR benchmark runner

Create:

```bash
npm run benchmark:ocr
```

The runner must automatically discover/run the corpus without manually opening the scanner UI.

Reuse the SAME production OCR/preprocessing modules where practical.

For each image:

1. load image;
2. apply production preprocessing;
3. run the production OCR adapter;
4. collect raw text, lines, tokens if available, confidence, bounding boxes, and processing time;
5. compare against verified expectations where available;
6. save per-image results.

Do not create a completely separate OCR pipeline only for benchmarking.

---

## 7. Cropped vs original images

Some images may already be cropped to the nutrition panel while others may include surrounding packaging.

Support optional crop metadata:

```json
{
  "crop": {
    "x": 100,
    "y": 80,
    "width": 1200,
    "height": 1700
  }
}
```

If no crop metadata exists, do not fabricate precise crop coordinates.

For this Phase 1.5 benchmark it is acceptable to benchmark already-cropped nutrition panels directly.

Keep these questions separate:

```text
How good is OCR when given a usable nutrition-panel image?
```

versus:

```text
Can the app automatically find the nutrition panel?
```

Automatic panel detection is not part of this task.

---

## 8. OCR-level metrics

Implement useful diagnostics where annotations support them.

At minimum:

- target text fragment recall;
- nutrient keyword recall;
- numeric/unit recognition;
- per-image OCR processing time.

Normalize harmless differences in whitespace and punctuation.

Do not require perfect full-page transcription.

Track important nutrient terms such as:

```text
Calories
Total Fat
Saturated Fat
Trans Fat
Cholesterol
Sodium
Total Carbohydrate
Dietary Fiber
Sugars
Protein
```

Design the benchmark so Phase 2 can later add true structured field accuracy.

---

## 9. Reports

Print a concise terminal summary and save machine-readable results.

Example:

```text
Nutrition Label OCR Benchmark
=============================

Images: 32
Verified annotations: 28

Development
-----------
Target text recall:       86.4%
Nutrient keyword recall:  91.2%
Average OCR time:         2.4s

Holdout
-------
Target text recall:       82.1%
Nutrient keyword recall:  88.7%

Regression
----------
Target text recall:       79.3%

By category
-----------
clean-flat:               95.1%
grid-lines:               81.5%
glare:                    72.0%
curved:                   68.4%
```

Save something like:

```text
benchmark/results/latest.json
benchmark/reports/latest.md
```

---

## 10. Failure categories

Classify recurring failures where possible:

```text
TEXT_DETECTION_MISS
LINE_MERGE
LINE_SPLIT
CHARACTER_CONFUSION
NUMERIC_CONFUSION
UNIT_CONFUSION
GRID_LINE_INTERFERENCE
LOW_CONTRAST
BLUR
GLARE
PERSPECTIVE
SMALL_TEXT
OCR_PROVIDER_FAILURE
UNKNOWN
```

Do not overclaim a root cause when uncertain.

---

## 11. Establish a baseline before improving anything

Run the current Tesseract implementation across the entire corpus first.

Preserve the baseline:

```text
benchmark/results/baseline-tesseract.json
```

Report development, holdout, and regression metrics.

Identify common failure patterns.

No production OCR/preprocessing change should be accepted without comparison to this baseline.

---

## 12. Controlled experiment loop

After the harness works, test improvements systematically.

For each experiment:

1. state the hypothesis;
2. change one major factor at a time where practical;
3. run the full benchmark;
4. compare development score;
5. compare holdout score;
6. inspect regression impact;
7. compare runtime;
8. decide KEEP or REJECT;
9. document the result in `benchmark/experiments.md`.

Example:

```text
Experiment:
2x image upscaling

Hypothesis:
Small nutrition-table text is below Tesseract's preferred scale.

Baseline:
Development 76.4%
Holdout     74.8%

Experiment:
Development 82.1%
Holdout     81.0%

Decision:
KEEP
```

Reject changes that improve development but materially hurt holdout.

---

## 13. Candidate experiments

Do not blindly apply all of these. Treat each as a hypothesis:

- 1.5x / 2x / 3x upscaling;
- original vs grayscale;
- moderate contrast normalization;
- light sharpening;
- adaptive thresholding;
- Otsu thresholding if appropriate;
- deskew;
- grid-line/horizontal-line suppression;
- Tesseract page segmentation modes;
- other meaningful Tesseract parameters.

Avoid arbitrary hard-coded thresholds chosen because one fixture improved.

---

## 14. Compare OCR providers early

Do not spend unlimited effort tuning Tesseract.

Once the benchmark is working, investigate at least one credible alternative OCR provider if technically feasible.

Preferred candidate:

```text
PaddleOCR
```

Keep Tesseract as an adapter.

If PaddleOCR or another provider is feasible, implement it through the SAME normalized OCR abstraction and benchmark it on the exact same corpus.

Compare:

- target text recall;
- numeric recognition;
- bounding-box quality;
- runtime;
- browser compatibility;
- mobile feasibility;
- bundle/model size.

Do not replace Tesseract based on reputation alone. Replace/change the default only if benchmark evidence supports it.

---

## 15. Anti-overfitting rules

The following are prohibited unless there is a strong generalizable reason:

```text
if filename === ...
if imageWidth === exactKnownFixtureWidth ...
if OCR contains exact phrase from one fixture then use special settings ...
hard-coded crop for a single image ...
one-off threshold selected for one fixture ...
injecting expected text into OCR results ...
```

The production OCR pipeline must not know which benchmark fixture it is processing.

---

## 16. Regression policy

Normally reject an experiment when:

- holdout performance materially decreases;
- previously correct core nutrient lines become incorrect;
- runtime becomes impractically slow;
- mobile/browser compatibility gets worse;
- model/bundle size becomes unreasonable without meaningful accuracy gains.

If accepting a tradeoff, document it explicitly.

---

## 17. Optional browser-level benchmark

After the fast benchmark works, add a secondary E2E benchmark if practical.

Preferred tool:

```text
Playwright
```

Possible command:

```bash
npm run benchmark:e2e
```

It may automate:

```text
launch scanner
→ upload fixture
→ use predetermined crop/already-cropped image
→ run OCR through actual UI path
→ collect normalized OCR result
```

This is secondary. Do not make the main iteration loop unnecessarily slow.

---

## 18. Production/benchmark separation

Good:

```text
benchmark runner
    ↓
imports production OCR adapter
```

Bad:

```text
production OCR adapter
    ↓
contains benchmark fixture logic
```

Benchmark-specific code must not leak into production behavior.

---

## 19. Do not build Phase 2 yet

Do NOT implement the full nutrition parser.

Do NOT implement:

- full nutrient alias normalization;
- serving-size parsing;
- table row/column nutrition reconstruction;
- nutrition validation;
- editable review UI;
- Juan Nutrisyon API integration;
- custom OCR training;
- OCR fine-tuning;
- LLM/VLM extraction.

This task is strictly:

```text
Phase 1.5
Benchmark + OCR evaluation + controlled OCR improvement
```

---

## 20. Stopping criteria

Do not iterate forever.

For this pass:

1. build the benchmark harness;
2. establish Tesseract baseline;
3. run roughly 5–8 high-value controlled experiments at most;
4. compare at least one credible alternative OCR provider if feasible;
5. choose the best generalizing setup;
6. stop and report.

---

## 21. Final report

When finished, report:

### Corpus
- image count;
- verified annotation count;
- development/holdout/regression sizes;
- major label categories.

### Infrastructure
- files added;
- benchmark commands;
- annotation format;
- result/report format.

### Baseline
- Tesseract baseline metrics.

### Experiments
For each experiment:

```text
hypothesis
change
development score
holdout score
regression impact
runtime impact
KEEP / REJECT
```

### Provider comparison
If another OCR engine was tested, compare it directly with Tesseract.

### Final recommendation
State:

- preferred OCR provider/configuration;
- preprocessing to keep;
- preprocessing/settings to reject;
- biggest remaining failure categories;
- whether OCR is ready to proceed to Phase 2.

### Manual work needed
List only genuinely human-dependent tasks, especially:

- annotations that still need verification;
- unreadable/ambiguous nutrient values;
- mobile behaviors that cannot be tested locally.

---

# Definition of Done

This task is complete when:

- [ ] all images in `labels/` can be discovered automatically;
- [ ] a stable manifest exists;
- [ ] deterministic development/holdout/regression splits exist;
- [ ] annotation files/templates exist;
- [ ] verified vs unverified ground truth is tracked;
- [ ] `npm run benchmark:ocr` runs without manual UI interaction;
- [ ] per-image results are saved;
- [ ] aggregate metrics are reported by split;
- [ ] useful category breakdowns are possible;
- [ ] Tesseract baseline is preserved;
- [ ] experiments are documented;
- [ ] no image-specific hacks were introduced;
- [ ] an alternative OCR provider is evaluated if technically feasible;
- [ ] final OCR/preprocessing choices are evidence-based;
- [ ] the production app still builds/tests successfully.

The guiding principle is:

> Improve the scanner against the corpus, not against a screenshot.
