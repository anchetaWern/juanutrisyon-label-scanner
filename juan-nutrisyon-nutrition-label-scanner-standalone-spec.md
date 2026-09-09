# Juan Nutrisyon Nutrition Label Scanner — Standalone App Implementation Spec

## 1. Purpose

Build a **standalone nutrition label scanner web application** that can:

1. capture or upload a photo of a nutrition label;
2. detect/crop the nutrition panel;
3. extract text with OCR;
4. interpret the OCR result into structured nutrition data;
5. validate and flag suspicious values;
6. let the user review/correct results;
7. produce structured output compatible with Juan Nutrisyon;
8. later integrate with Juan Nutrisyon through an API.

This scanner is a **separate application**, not a feature inside the existing Juan Nutrisyon frontend.

## 2. Core Architecture Decision

Build this as a separate deployable application.

Suggested architecture:

```text
nutrition-label-scanner/
├── Vue 3
├── Vuetify
├── TypeScript
├── Vite
│
├── Camera / Upload
├── Image Crop
├── Image Quality
├── OCR Engine
├── Layout Reconstruction
├── Nutrition Parser
├── Validation
├── Review
└── Future Juan Nutrisyon API Integration
```

The app should:

- have its own source code;
- have its own package.json;
- have its own build;
- have its own deployment;
- not depend on the Juan Nutrisyon frontend;
- not import components/services from the Juan Nutrisyon app;
- remain compatible with Juan Nutrisyon's nutrition schema;
- later communicate with Juan Nutrisyon via API rather than shared frontend code.

Possible future deployment:

```text
scan.juanutrisyon.info
```

The exact hostname is not required for the MVP.

## 3. Technology Stack

Use:

- Vue 3
- Composition API
- TypeScript
- Vuetify
- Vite

Prefer:

- `<script setup lang="ts">`
- composables for feature logic;
- service/adaptor interfaces for OCR;
- small reusable components;
- browser-first processing where practical.

Do not introduce a backend unless required.

## 4. Product Strategy

The app should be web-first / PWA-friendly.

Do not create native iOS or Android apps for the MVP.

The scanner should be designed so a native client could later use the same parsing/validation concepts.

## 5. Core Pipeline

Treat the app as a modular pipeline:

```text
Camera / Upload
    ↓
Image Quality Checks
    ↓
Nutrition Panel Crop
    ↓
Image Preprocessing
    ↓
OCR
    ↓
Layout Reconstruction
    ↓
Nutrition Parser
    ↓
Validation / Confidence
    ↓
Review & Correction
    ↓
Structured Nutrition JSON
    ↓
Future Juan Nutrisyon API
```

Each stage should be replaceable independently.

## 6. MVP Scope

Build:

- standalone Vue application;
- image capture;
- image upload;
- preview / replace / remove;
- manual nutrition-panel crop;
- image rotation;
- lightweight image-quality checks;
- OCR adapter abstraction;
- one working OCR provider;
- OCR text + bounding boxes;
- geometry-aware layout reconstruction;
- nutrient alias matching;
- serving-size extraction;
- per-serving / per-100g basis detection;
- numeric/unit parsing;
- plausibility validation;
- per-field confidence;
- editable review screen;
- structured JSON output;
- correction logging;
- benchmark/evaluation harness.

## 7. Explicitly Out of Scope for Initial MVP

Do not build yet:

- custom OCR model training;
- OCR fine-tuning;
- learned nutrition-table model;
- real-time continuous video OCR;
- fully automatic panel detection;
- curved-label dewarping;
- native mobile apps;
- public food contribution directly into Juan Nutrisyon;
- authentication unless later required;
- barcode integration unless specifically added in a later phase;
- mandatory LLM/VLM extraction.

## 8. Suggested Project Structure

```text
src/
├── components/
│   ├── scanner/
│   │   ├── ScannerImagePicker.vue
│   │   ├── ScannerCropper.vue
│   │   ├── ScannerQualityWarnings.vue
│   │   ├── ScannerOcrDebug.vue
│   │   ├── ScannerReview.vue
│   │   └── ScannerResult.vue
│   └── common/
├── composables/
│   ├── useNutritionLabelScanner.ts
│   ├── useImageQuality.ts
│   └── useImageCrop.ts
├── services/
│   ├── ocr/
│   │   ├── types.ts
│   │   ├── NutritionLabelOcrEngine.ts
│   │   └── PaddleOcrEngine.ts
│   ├── parser/
│   ├── validation/
│   └── export/
├── data/
│   └── nutrient-aliases.ts
├── types/
├── views/
│   └── ScannerView.vue
├── router/
└── main.ts
```

## 9. App Flow

```text
1. User opens scanner
2. User chooses:
   - Take Photo
   - Upload Image
3. Image quality is checked
4. User crops the nutrition panel
5. OCR runs
6. OCR geometry is preserved
7. Parser creates structured nutrition data
8. Validation flags suspicious values
9. Review screen appears
10. User corrects values
11. App produces confirmed JSON
```

## 10. Capture Requirements

Use rear-facing camera where supported.

```html
<input
  type="file"
  accept="image/*"
  capture="environment"
/>
```

Requirements:

- mobile-friendly;
- image preview;
- replace image;
- remove image;
- preserve original image separately from crop.

## 11. Capture Guidance

Show concise instructions:

- Fill the frame with the nutrition label.
- Avoid glare.
- Keep the label as flat as possible.
- Hold the phone steady.
- Make sure the text is readable.

## 12. Image Quality Checks

Before OCR, perform advisory checks for:

- image too small;
- severe blur;
- extreme darkness;
- extreme brightness;
- likely glare;
- nutrition panel too small in frame.

Warnings should not hard-block scanning.

Possible techniques:

- Laplacian variance / edge sharpness;
- mean luminance;
- percentage of near-white clipped pixels;
- minimum image dimensions.

Keep checks lightweight and browser-side.

## 13. Nutrition Panel Crop

MVP:

- rectangular crop;
- rotate;
- reset;
- confirm crop;
- preserve original image;
- retain crop coordinates/state.

Later:

- automatic panel detection;
- perspective correction;
- curved surface dewarping.

## 14. Image Preprocessing

Create optional preprocessing variants:

```text
original
grayscale
contrast-enhanced
deskewed
perspective-corrected
```

Preserve original image.

## 15. OCR Layer

Create a provider-independent interface.

```ts
interface NutritionLabelOcrEngine {
  recognize(image: Blob | File): Promise<OcrResult>
}
```

Suggested normalized types:

```ts
interface OcrBoundingBox {
  x: number
  y: number
  width: number
  height: number
}

interface OcrToken {
  text: string
  confidence?: number
  bbox: OcrBoundingBox
}

interface OcrLine {
  text: string
  confidence?: number
  bbox: OcrBoundingBox
  tokens?: OcrToken[]
}

interface OcrResult {
  text: string
  lines: OcrLine[]
  engine: string
  engineVersion?: string
}
```

Bounding boxes are mandatory where available.

Do not flatten OCR into plain text only.

## 16. Initial OCR Provider

Preferred starting point:

```text
PaddleOCR-compatible implementation
```

Keep the OCR provider replaceable.

Possible future providers:

- PaddleOCR
- ML Kit
- Apple Vision
- Tesseract
- cloud OCR
- custom OCR
- VLM fallback

Do not leak provider-specific structures outside the OCR adapter.

## 17. Layout Reconstruction

Nutrition labels are structured tables.

Typical patterns:

```text
Nutrient | Amount | %DV
```

```text
Nutrient | Per Serving | Per 100 g
```

Use coordinates to associate nutrient names with amounts and preserve the detected basis/column.

## 18. Normalized Nutrition Schema

Output should be compatible with Juan Nutrisyon.

```json
{
  "serving": {
    "description": "1 pack",
    "quantity": 1,
    "unit": "pack",
    "grams": 60
  },
  "basis": "per_serving",
  "nutrients": {
    "energy_kcal": {
      "value": 230,
      "unit": "kcal"
    },
    "total_fat_g": {
      "value": 9,
      "unit": "g"
    },
    "saturated_fat_g": {
      "value": 4,
      "unit": "g"
    },
    "sodium_mg": {
      "value": 620,
      "unit": "mg"
    },
    "carbohydrate_g": {
      "value": 34,
      "unit": "g"
    },
    "total_sugars_g": {
      "value": 8,
      "unit": "g"
    },
    "protein_g": {
      "value": 5,
      "unit": "g"
    }
  }
}
```

The scanner should work independently even when Juan Nutrisyon is unavailable.

## 19. Nutrient Alias Dictionary

Use configurable aliases such as sodium, total fat, saturated fat, carbohydrate, fiber, sugar, and protein. Store aliases as data/configuration, not buried in parsing code.

## 20. Fuzzy Nutrient Matching

Suggested configurable thresholds:

```text
>= 0.90 → high confidence
0.75–0.89 → review
< 0.75 → unknown
```

## 21. Numeric Parsing

Support context-aware OCR confusions such as:

```text
O.5 → 0.5
65O → 650
l20 → 120
I20 → 120
```

Lower confidence when corrections are ambiguous.

## 22. Units

Support at minimum:

```text
kcal
kJ
g
mg
mcg
µg
%
mL
ml
```

Retain source OCR text for debugging.

## 23. Serving Size Parsing

Support examples such as:

```text
Serving size 1 pack (60 g)
Serving size 30 g
Serving size 2 pieces (45 g)
Serving size 1 cup (240 mL)
```

Count-based servings must work even without gram weight.

## 24. Nutrition Basis

Detect and preserve:

```text
per serving
per 100 g
per 100 mL
per package
```

Support multiple simultaneous columns.

## 25. % Daily Value

Store `%DV` separately from nutrient amounts.

## 26. Validation Rules

Flag questionable data rather than silently changing it.

Examples:

```text
saturated fat <= total fat
trans fat <= total fat
sugars <= total carbohydrate
dietary fiber <= total carbohydrate
```

Also flag unexpected units, negative values, missing units, extreme values, and ambiguous OCR characters.

## 27. Per-Field Confidence

```ts
interface ParsedNutritionField {
  value: number | null
  unit: string | null
  confidence: number
  status: "high" | "review" | "uncertain"
  sourceText?: string
  sourceBBox?: OcrBoundingBox
  warnings?: string[]
}
```

## 28. Review UI

Show:

- original/cropped label;
- serving size;
- detected basis;
- nutrient rows;
- amount;
- unit;
- %DV;
- confidence;
- warnings.

Allow editing, deleting false positives, and adding missed nutrients.

## 29. Correction Data

Retain:

```text
raw OCR
parser prediction
final user-confirmed values
```

This becomes future training data.

## 30. Local Persistence for MVP

Initial persistence may be browser-local using IndexedDB or equivalent.

Do not require Juan Nutrisyon API connectivity for scanning.

## 31. Future Juan Nutrisyon Integration

Later integration should happen through an API.

```text
scanner app
    ↓
confirmed nutrition JSON
    ↓
Juan Nutrisyon API
    ↓
create/update contribution
```

For MVP, JSON download/copy is sufficient.

## 32. Dataset Strategy

Do not train OCR initially.

Build a benchmark dataset first.

Target:

```text
200–500 nutrition label photos
```

Include varied Philippine and imported labels, packaging types, lighting, glare, curved labels, and multi-column layouts.

## 33. Ground Truth Format

```json
{
  "image": "label_001.jpg",
  "nutrition_panel": {
    "bbox": [220, 140, 1420, 1940]
  },
  "ground_truth": {
    "serving": {
      "description": "1 pack",
      "grams": 60
    },
    "basis": "per_serving",
    "nutrients": {
      "energy_kcal": 230,
      "total_fat_g": 9,
      "saturated_fat_g": 4,
      "sodium_mg": 620,
      "carbohydrate_g": 34,
      "total_sugars_g": 8,
      "protein_g": 5
    }
  }
}
```

## 34. Evaluation Metrics

Primary metric:

```text
structured field accuracy
```

Also track serving accuracy, nutrition basis accuracy, unit accuracy, row/column association, false positives, recall, and correction rate per field.

## 35. Benchmark Runner

Create a standalone-project command such as:

```bash
npm run benchmark
```

It should load fixtures, run OCR/parser, compare with ground truth, calculate metrics, and optionally output JSON/CSV results.

## 36. Error Categories

```text
OCR_TEXT_ERROR
NUTRIENT_ALIAS_ERROR
NUMBER_PARSE_ERROR
UNIT_PARSE_ERROR
ROW_ASSOCIATION_ERROR
COLUMN_ASSOCIATION_ERROR
SERVING_SIZE_ERROR
NUTRITION_BASIS_ERROR
VALIDATION_FALSE_POSITIVE
UNKNOWN_LAYOUT
```

## 37. Analytics

Suggested events:

```text
scanner_opened
scanner_photo_selected
scanner_quality_warning
scanner_crop_completed
scanner_ocr_completed
scanner_parse_completed
scanner_review_opened
scanner_field_corrected
scanner_confirmed
scanner_failed
```

Never send full label images to analytics.

## 38. Privacy

- do not expose uploaded images publicly;
- avoid image URLs in analytics;
- support clearing local scan history if implemented;
- distinguish local history from future Juan Nutrisyon submissions.

## 39. Rule-Based First

Start with:

```text
layout rules
+
nutrient aliases
+
fuzzy matching
+
numeric/unit parsing
+
validation
```

Do not make an LLM/VLM mandatory.

## 40. Active Learning

Prioritize labels where OCR confidence is low, parser confidence is low, validation fails, the user corrected fields, or layout/columns are ambiguous.

## 41. Recommended Implementation Phases

### Phase 1 — Standalone Scanner Skeleton

Build:

- new Vue 3 + Vuetify + TypeScript project;
- camera/upload;
- image preview;
- crop/rotate/reset;
- quality warnings;
- OCR abstraction;
- one working OCR implementation;
- raw OCR debug view.

Deliverable:

```text
photo → crop → OCR text + bounding boxes
```

### Phase 2 — Nutrition Parser

Build aliases, row/column reconstruction, serving parser, unit parser, numeric parser, and basis parser.

### Phase 3 — Validation & Review

Build validation, confidence, editable review UI, and warnings.

### Phase 4 — Local Persistence / Export

Build optional local scan history, correction storage, JSON export, and clipboard copy.

### Phase 5 — Benchmark Harness

Build dataset loader, fixtures, benchmark command, metrics, and error classification.

### Phase 6 — Scanner Improvements

Use benchmark results to guide preprocessing, OCR provider comparison, automatic panel detection, and OCR fine-tuning if justified.

### Phase 7 — Juan Nutrisyon API Integration

Only after scanner accuracy is acceptable.

## 42. Definition of Done — MVP

- [ ] standalone app runs independently;
- [ ] user can take/upload a photo;
- [ ] user can crop/rotate/reset;
- [ ] basic quality warnings work;
- [ ] OCR returns text + boxes;
- [ ] parser extracts structured nutrition data;
- [ ] serving sizes work with or without gram weight;
- [ ] per-serving/per-100g basis is preserved;
- [ ] units normalize;
- [ ] %DV is separate;
- [ ] suspicious fields are flagged;
- [ ] confidence exists per field;
- [ ] user can correct fields;
- [ ] result can be serialized/exported;
- [ ] scanner does not require the Juan Nutrisyon app to function;
- [ ] OCR provider can be replaced independently;
- [ ] benchmark fixtures can be evaluated.

## 43. Recommended Success Targets

```text
Calories          >= 97% exact field accuracy
Protein           >= 97%
Total Fat         >= 95%
Carbohydrate      >= 95%
Sodium            >= 97%
Serving Size      >= 90%
Nutrition Basis   >= 90%
```

Early practical target:

```text
<= 1 corrected core field per clean label scan
```

## 44. Guiding Principle

Optimize for:

```text
correct nutrient
+
correct amount
+
correct unit
+
correct serving basis
```

not perfect transcription of every character.

## 45. Future ML Roadmap

### Stage A
Existing OCR + rules + human correction.

### Stage B
Automatic nutrition-panel detector.

### Stage C
Fine-tune OCR only if benchmark evidence shows it is necessary.

### Stage D
Learned structured extraction using OCR tokens + coordinates + confidence.

## 46. Final Technical Guidance

Favor:

```text
simple
modular
benchmarkable
replaceable
standalone
API-ready
```

Architecture:

```text
Standalone Vue 3 app
+
manual crop
+
existing OCR
+
geometry-aware parser
+
nutrition rules
+
human review
+
benchmark dataset
+
future Juan Nutrisyon API integration
```

Do not couple the application to the existing Juan Nutrisyon frontend.
