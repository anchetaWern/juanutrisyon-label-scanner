# Phase 2 pilot

This adds fresh browser OCR to the Phase 1 field evaluator. It uses the supplied 15 image/JSON pairs in `labels/nutrition_labels_json`, the production PaddleOCR engine, and the Phase 3 quality/geometry services. No OpenAI API key is needed.

## Reproduce

Install dependencies and Chrome/Chromium. Set `CHROME_PATH` only if the executable is outside the known macOS/Linux locations. Use a **new** output directory for each experiment:

```sh
npm run phase2:prepare -- --out evaluation/results/my-pilot-run
```

Preparation validates every pair, freezes input SHA-256 digests and split assignments, and generates 45 lossless PNGs: original, rectangle, and perspective. It measures capture quality and records optional edge suggestions, without applying them. Open the generated `review.html` and inspect full-size images; `review/crops-1.png` through `crops-5.png` provide compact comparisons. If a corner needs correction, edit the reviewed manifest and prepare a fresh directory before OCR.

```sh
npm run phase2:run -- --out evaluation/results/my-pilot-run
npm run phase2:report -- --out evaluation/results/my-pilot-run
```

The first command launches a temporary headless Chrome profile, loads the production models, processes all crops sequentially, and writes the reports. The second only replays saved OCR through the current parser and evaluator. Images remain local. The first OCR session needs network access to download Paddle/ONNX assets. The runner does not send expected nutrient values to the browser OCR jobs.

Completed OCR cases are checkpointed to `run.json`. Following an interruption, continue with:

```sh
npm run phase2:run -- --out evaluation/results/my-pilot-run --resume
```

Resume requires the same dataset, runtime source digests, configuration, and PNG digests; it skips completed cases, including explicitly recorded provider failures, and logs a new initialization session. A new experiment requires a fresh output directory. A completed run can be rescored with `phase2:report` after parser/evaluation changes; those current scoring sources are recorded separately from the OCR sources. Preparation itself is not resumable: use a fresh directory after an interrupted preparation.

## Annotation and split policy

`../datasets/phase-2-pilot.json` contains product IDs, split, normalized original-image corners (clockwise TL/TR/BR/BL), intended-panel notes, condition tags, and separately identified supplemental fields. These were selected by Codex from original photos before OCR. The owner's JSON files are never rewritten.

The primary comparison scores only the owner's **191 nutrient and 30 serving values**. The expanded audit includes nine clearly printed calories-from-fat values and seven confirmed-absent fields from the visual review. These supplements, geometry, and condition tags still need independent human review. Missing fields remain unreviewed. Do not label failed OCR as unreadable when the source photo remains legible. Readability is image-specific; this pilot contains no verified unreadable nutrient fields.

The development products are 01, 03, 04, 06, 07, 09, 10, 12, 13, and 15. Validation products are 02, 05, 08, 11, and 14. All variants of a product share the same split. Validation was frozen before recognition; images were visible for annotation, and the set comes from the same supplied collection. It is not an independent capture-source or large blind test. No assertion of product independence from every historical image collection is made.

The blue tub and sandwich crackers contain multiple nutrition panels with different values. The selected upper panels match the supplied JSON. The original-photo variants intentionally retain the distracting panels. SPAM retains both per-56g and per-100g columns; the owner target is per 56g. Comparing these cases measures panel selection as well as geometry. Do not remove a difficult column just to improve a score.

## Outputs

- `dataset.json`: resolved annotations, supplements, tags, split, input hashes, and provenance.
- `prepared.json`: output PNG hashes, exact geometry, quality measurements, edge suggestions, and runtime source hashes.
- `crops/`, `review.html`, `review/`: local visual-review artifacts.
- `run.json`: raw OCR, per-case processing times, provider failures, configuration, initialization sessions, and source hashes.
- `comparison.md` / `comparison.json`: primary owner-only metrics, expanded audit, paired per-image results, quality/error associations, and edge-suggestion assessment.
- `report.md` / `report.json` / `fields.csv`: expanded field-level audit using Phase 1's strict metric, with original OCR evidence and triage hints.
- `calibration.json`: warning confusion counts and development-only threshold exploration against provisional visual tags. Unknown measurements and failed quality checks remain explicit.

Input photos, original JSON, generated PNGs, OCR, and full reports remain gitignored under `labels/` and `evaluation/results/`. The code, reviewed manifest, dated summary, and compact baseline are tracked. A clean checkout requires the original paired files to reproduce this local pilot; the regular portable `npm run evaluate` still works without them.

## Interpreting results

The score keeps fractions, amounts, units, qualifiers, and punctuation. `1.06 oz (30g)` and `1.06 oz. (30g)` are strict mismatches and should be adjudicated separately from wrong quantities. The human-readable findings identify these cases without relaxing the scorer after seeing results. Unsupported keys and units are retained as targets. Presence probes now recognize IU, µg RE, Omega-3, and Unicode D₃ without changing extraction behavior or converting units.

Quality tags are qualitative observations of the intended panel, not verified unreadability or OCR error labels. The original image can trigger a warning from background packaging. Suggestion closeness uses a maximum corner error of 5% of the reference panel diagonal; it is not text-region recall or proof that no row was cut off. There are no independent ground-truth text regions in this pilot.

All 45 observations share 15 photographs. Report each variant and split separately; do not treat them as 45 independent photos. Runtime comes from desktop Chrome/WASM, with initialization measured separately. Keep production thresholds until a larger independently reviewed set includes blur, obscured text, severe glare, and real-phone measurements.

See [the initial findings](../../docs/phase-2-pilot-2026-10-11.md).
