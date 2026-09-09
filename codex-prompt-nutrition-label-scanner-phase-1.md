# Codex Prompt — Nutrition Label Scanner Phase 1

You are implementing Phase 1 of a **standalone Nutrition Label Scanner web application** for the Juan Nutrisyon project.

Read the attached implementation spec carefully:

`juan-nutrisyon-nutrition-label-scanner-standalone-spec.md`

## Critical architecture decision

This scanner is a SEPARATE APPLICATION.

Do NOT implement it inside the existing Juan Nutrisyon frontend.

Create a standalone project with its own:

- source code;
- package.json;
- build;
- development server;
- deployment configuration;
- application entry point.

Use:

- Vue 3
- Composition API
- TypeScript
- Vuetify
- Vite

Prefer `<script setup lang="ts">`.

Do not import or depend on the existing Juan Nutrisyon frontend codebase.

The only relationship to Juan Nutrisyon is:

1. the scanner's future structured nutrition output should be compatible with Juan Nutrisyon;
2. later phases may integrate through a Juan Nutrisyon API.

Do NOT implement that API integration in Phase 1.

## Your task

Implement ONLY:

**Phase 1 — Standalone Scanner Skeleton**

Do not implement the nutrition parser, nutrient extraction, review workflow, persistence, benchmark system, barcode scanning, Juan Nutrisyon API integration, or custom ML training yet.

## Step 1 — Inspect the workspace first

Before creating or changing files:

- inspect the current workspace;
- determine whether a scanner project already exists;
- if a suitable existing standalone scanner project exists, continue using it;
- otherwise create a new standalone Vue 3 project for the scanner;
- do not modify the existing Juan Nutrisyon frontend unless absolutely necessary for workspace configuration.

If this is a monorepo, place the scanner cleanly as a separate app/package.

If this is not a monorepo and you are working in an empty/new repository, initialize the standalone app normally.

Do not turn the Juan Nutrisyon app itself into the scanner project.

## Suggested project identity

Use a clear project name such as:

`nutrition-label-scanner`

or:

`juan-nutrisyon-label-scanner`

Possible future deployment:

`scan.juanutrisyon.info`

Do not hard-code that hostname.

## Phase 1 Scope

### 1. Application skeleton

Create/configure a standalone application using:

- Vue 3
- Vite
- TypeScript
- Vuetify

Include:

- application shell;
- scanner page;
- basic routing if appropriate;
- responsive/mobile-first layout.

A single primary scanner route is sufficient for Phase 1.

### 2. Image capture and upload

Allow the user to:

- take a photo;
- upload an existing image;
- preview the image;
- replace it;
- remove it.

Prefer the rear-facing camera where supported.

Use behavior equivalent to:

```html
<input
  type="file"
  accept="image/*"
  capture="environment"
/>
```

Wrap this in a reasonable Vuetify UI.

### 3. Capture guidance

Show concise guidance:

- Fill the frame with the nutrition label.
- Avoid glare.
- Keep the label as flat as possible.
- Hold the phone steady.
- Make sure the text is readable.

### 4. Manual nutrition-panel crop

Support:

- rectangular crop;
- rotate;
- reset crop;
- confirm crop.

Requirements:

- preserve the original image;
- keep crop coordinates/state;
- generate a cropped image/blob suitable for OCR.

Choose a lightweight, maintained Vue-compatible cropper.

### 5. Lightweight image-quality checks

Implement advisory browser-side warnings for:

- image dimensions too small;
- likely blur;
- image too dark;
- image too bright/blown out;
- likely glare.

Warnings must NOT hard-block scanning.

Possible techniques:

- edge/Laplacian variance or equivalent;
- average luminance;
- clipped highlight percentage;
- minimum dimensions.

Do not use an ML model for these checks.

### 6. OCR abstraction

OCR must not be implemented directly inside Vue page components.

Create a provider-independent interface conceptually similar to:

```ts
interface NutritionLabelOcrEngine {
  recognize(image: Blob | File): Promise<OcrResult>
}
```

Use normalized types conceptually similar to:

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

Bounding-box information is important.

Do NOT expose only a flat OCR string.

### 7. Initial OCR provider

Integrate one working OCR implementation behind the abstraction.

Preferred direction:

**PaddleOCR-compatible browser implementation**

However:

- first verify compatibility with Vue/Vite/browser execution;
- do not force PaddleOCR if integration requires unreasonable hacks;
- keep the adapter provider-independent;
- if another OCR engine is substantially simpler and still returns geometry, it may be used for Phase 1;
- document the choice and tradeoffs.

Critical requirement:

```text
selected/cropped image
→ OCR
→ text + lines + bounding boxes
```

Do not perform nutrition parsing yet.

### 8. Recommended Vue architecture

A reasonable structure may look like:

```text
src/
├── components/
│   └── scanner/
│       ├── ScannerImagePicker.vue
│       ├── ScannerCropper.vue
│       ├── ScannerQualityWarnings.vue
│       └── ScannerOcrDebug.vue
├── composables/
│   ├── useNutritionLabelScanner.ts
│   ├── useImageCrop.ts
│   └── useImageQuality.ts
├── services/
│   └── ocr/
│       ├── types.ts
│       ├── NutritionLabelOcrEngine.ts
│       └── PaddleOcrEngine.ts
├── views/
│   └── ScannerView.vue
└── main.ts
```

This is illustrative, not mandatory.

Do not introduce Pinia unless shared application state actually justifies it.

### 9. OCR debug view

Add a temporary debug interface showing:

- original image;
- cropped image;
- raw OCR text;
- OCR lines;
- OCR confidence where available;
- bounding-box data;
- bounding-box overlay if reasonably practical.

### 10. Loading and error states

Handle:

- OCR engine/model initialization;
- OCR processing;
- unsupported image;
- no readable text found;
- OCR failure;
- image-processing failure;
- crop failure.

Use Vuetify components and avoid unhandled errors.

### 11. Tests

Add tests where practical for:

- OCR normalization;
- image-quality utilities;
- scanner state flow;
- crop/image utilities;
- OCR adapter behavior using mocks/fixtures.

Do not make routine tests load a heavyweight OCR model if avoidable.

## Do NOT implement yet

Do not implement:

- nutrient aliases;
- nutrient recognition;
- fuzzy nutrient matching;
- table reconstruction;
- numeric OCR correction;
- serving-size parsing;
- per-serving detection;
- per-100g detection;
- nutrition basis parsing;
- %DV extraction;
- nutrition validation;
- per-field nutrition confidence;
- editable nutrition review;
- persistence;
- local scan history;
- backend;
- barcode scanning;
- product matching;
- Juan Nutrisyon API integration;
- benchmark CLI;
- dataset tooling;
- custom OCR training;
- model fine-tuning;
- LLM extraction;
- VLM extraction;
- native mobile application.

## Important constraints

- Standalone application.
- Separate from the existing Juan Nutrisyon frontend.
- Vue 3.
- Composition API.
- TypeScript.
- Vuetify.
- Vite.
- Mobile-first.
- Preserve original image.
- Keep OCR provider replaceable.
- Preserve OCR geometry.
- Avoid unnecessary backend work.
- Avoid unnecessary global state.
- Avoid premature abstractions.
- Do not add an LLM/VLM.
- Do not train/fine-tune a model.
- Do not integrate with Juan Nutrisyon yet.
- Do not proceed to Phase 2.

## Implementation order

1. Inspect workspace/repository.
2. Confirm where the standalone app should live.
3. Initialize/configure Vue 3 + TypeScript + Vuetify + Vite if needed.
4. Establish clean project structure.
5. Implement scanner page.
6. Implement take/upload image.
7. Implement preview/remove/replace.
8. Implement crop/rotate/reset.
9. Implement lightweight image-quality warnings.
10. Define normalized OCR types.
11. Define OCR abstraction.
12. Integrate initial OCR provider.
13. Add OCR debug output.
14. Add loading/error handling.
15. Add relevant tests.
16. Run lint/typecheck/tests/build.
17. Fix problems caused by your changes.

Do not ask me to choose trivial implementation details if you can make a reasonable engineering decision.

## Phase 1 Completion Criteria

Phase 1 is complete when I can run the standalone scanner app and:

- take a photo on a supported mobile device;
- upload a photo;
- preview it;
- replace/remove it;
- crop the nutrition panel;
- rotate/reset the crop;
- see image-quality warnings;
- start OCR;
- see an OCR processing state;
- see extracted text;
- inspect OCR lines;
- retain/access bounding boxes;
- inspect OCR debug information;
- recover gracefully from OCR errors;
- build the app successfully.

Expected Phase 1 flow:

```text
Standalone Vue Scanner
        ↓
Take / Upload Photo
        ↓
Crop Nutrition Panel
        ↓
Image Quality Warnings
        ↓
OCR
        ↓
Text + Lines + Bounding Boxes
        ↓
Debug View
```

Stop there.

## Final response after implementation

When finished, report:

1. what you implemented;
2. project structure created/changed;
3. files added;
4. files modified;
5. OCR provider used;
6. dependencies added;
7. why the OCR provider was chosen;
8. how the OCR adapter can be replaced later;
9. known limitations;
10. tests/checks/build commands run;
11. anything that should be manually tested on Android/iPhone;
12. anything discovered that should influence Phase 2.

Do not begin Phase 2 unless I explicitly request it.
