# Phase 4 preprocessing experiments

This harness compares a frozen control with five preprocessing alternatives on the Phase 2 paired images. Every run uses the production PaddleOCR adapter and unchanged nutrition parser. Selection uses only owner-verified fields. Source photos, labels, supplemental annotations and panel corners are preserved.

```sh
npm run phase4 -- prepare --out evaluation/results/my-phase4-run
npm run phase4 -- develop --out evaluation/results/my-phase4-run
npm run phase4 -- validate --out evaluation/results/my-phase4-run
```

Preparation freezes the corpus fingerprint, configurations, selection policy, runtime source hashes, and scoring source hashes in `plan.json`, and creates the 45 original/rectangle/perspective PNGs and review gallery. Chrome/Chromium and the local paired files are required. Set `CHROME_PATH` for a nonstandard executable location. The first recognition session downloads Paddle/ONNX assets; image pixels stay local.

Development processes only the ten development products under all six configurations. Each has a separate `development/<configuration>/run.json` checkpoint, report and field CSV; interrupted recognition resumes automatically with identical source code, data and configuration. The five validation products are excluded from those OCR jobs. The six runs contain 180 paired observations of ten photos, not 180 independent images.

The frozen control is `v6-tiny-recall-v2` with grayscale, contrast stretch, sharpening 0.32, scale 1, maximum dimension 2400, and detector box threshold 0.45. Candidates preserve the OCR models and detector settings while testing color, contrast without sharpening, 2× scale, contrast without sharpening at 2×, and color at 2×. Scaling stays within 2400 pixels on the longest side. It interpolates available pixels and cannot recover information absent from the original photo.

The development gate requires at least three additional correct nutrient fields on rectangles, no increase in wrong nutrient values or serving strings on any input variant, no loss of total correct nutrients across variants, zero provider failures, and bounded desktop runtime (rectangle mean ≤2.5× control, p95 ≤3×). Eligible candidates rank by rectangle nutrient recovery, fewer wrong fields, then lower mean time. If none qualifies, control remains selected. The gate is intentionally conservative for incorrect nutrition values; exact serving-string mismatches include punctuation.

`selection.json` freezes the choice before validation. Validation evaluates only control and that selected candidate on the five reserved products. It rejects a loss of correct rectangle nutrient or serving fields, additional wrong fields on any variant, or provider failures. Validation writes `validation.json`; later development/rescoring in that directory is blocked. Do not tune a replacement against validation outcomes. A later development study needs a fresh output directory and an untouched validation set if the current holdout becomes tuning data.

Before validation, saved development OCR can be rescored without recognition:

```sh
npm run phase4 -- report --out evaluation/results/my-phase4-run
```

The frozen experiment rejects changes to source code, corpus, configuration, or selection policy. Use a fresh directory for a changed experiment; retain the source revision with the original artifact hashes to reproduce a completed study. A production configuration update changes runtime hashes, so it requires fresh preparation. Completed Phase 2 artifacts remain readable, while resuming old checkpoints requires their matching runtime sources.

Primary reports exclude Codex supplemental transcriptions and unreviewed predictions. Incorrect values, missing fields and provider failures remain explicit. Image-wide presence probes are diagnostic only. Desktop timing is measured separately from initialization and does not establish real-phone performance. The five-product validation set is small and shares the original capture collection.
