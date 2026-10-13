# Experiment B: explicit nutrition basis selection

Isolated saved-OCR replay. Production remains `spatial-review-v5`; no OCR, preprocessing, normalization, serving parser, scanner UI or nutrition JSON schema changes. The production module only exports a frozen set of its existing pure primitives for experiment reuse.

The [implementation plan](../../docs/experiment-b-implementation-plan.md) records the audit and user decisions. The [development findings](../../docs/experiment-b-results-2026-10-12.md) do **not** recommend adoption: scoped association helps Spam, but detection/automatic selection fails regression gates.

## Reproduce

With dependencies installed, the portable run requires no ignored photos or pilot directory:

```sh
npm run experiment:b -- prepare --out evaluation/results/experiment-b-portable
npm run experiment:b -- develop --out evaluation/results/experiment-b-portable
```

To reproduce the reported 41-case local run, add the existing, exposed pilot OCR:

```sh
npm run experiment:b -- prepare --out evaluation/results/experiment-b-local --pilot evaluation/results/phase-2-pilot-2026-10-11
npm run experiment:b -- develop --out evaluation/results/experiment-b-local
```

Use a new output directory for each iteration. Optional `--config path/to/config.json` accepts overrides of the documented defaults in `types.ts` during preparation; the effective config and source hashes are frozen in `plan.json`. V5's reused recognition and ordered-alignment safeguards retain their original fixed thresholds and are versioned by the baseline source hash. Geometry parameters introduced for detection/header matching are configurable.

Outputs: `plan.json`, `records.json`, `report.json`, `report.md`, `fields.csv`, `development.json`, `review.html` and available diagnostic images. Open `review.html` locally to inspect actual OCR boxes and select/correct a context. Alternatives are precomputed from OCR alone. Switching cases clears the selection. This is experiment tooling, not production export or measured phone UX.

Missing source photos do not prevent replay of prior reviewed annotations. The gallery uses a blank OCR coordinate plane when images are unavailable, and keeps images separate when dimensions do not establish a common coordinate space. Available reviewed source image hashes are checked. Re-encoded mobile photos are identified as such.

## Modes and provenance

- A: unchanged v5. A separate candidate inventory describes the OCR, not v5's internal ranking.
- B: oracle basis geometry/membership and selected identity, with no expected field values or row-to-value answers supplied to association.
- C: detector only; unique credible quantity context or abstention. No per-serving preference.
- D: ideal explicit choice among detected candidates only, using scorer-side geometric correspondence. An undetected intended column remains a miss.

Basis instance IDs, denominator/category and quantity/percentage representation are separate. Two columns with the same semantic category remain distinct when they compete for the same rows. Repeated explicitly equal contexts in disjoint nutrient sections may be linked. Unknown columns retain raw examples rather than invented labels.

Value eligibility precedes association. Foreign, damaged, ambiguous and unreadable cells cannot become fallback values. Inline, complete ordered, local row and verified separate-unit association use unchanged v5 primitives/guards. A single-context baseline association can be reused only after its actual value sources pass the scope audit; multi-context extraction cannot use an unscoped baseline fallback. Unsupported layouts abstain.

The user approved genuine percent-only micronutrients in the selected context. Percentage references remain distinct and cannot be primary quantity selections. Percentage-only rows need selected-context ownership and no quantity/damaged-quantity cell; their real source indexes are retained separately. Header/label/unit support must not be mistaken for value-column provenance. Cross-column scoring checks membership even when values are equal.

Owner truth remains primary; pilot supplements are separately scored. Structured spatial truth currently covers Spam phone/pilot, bread and one oil control. These are Codex source-image reviews, not independent human review. Other cases remain exposed regressions with unverified basis attribution. Detection/selection metrics must be read with those small denominators. Historical holdouts are exposed development data, never new reserved evidence. Product counts avoid treating multiple crops as independent products.

## Freeze and reserved validation

```sh
npm run experiment:b -- freeze --out evaluation/results/experiment-b-local
npm run experiment:b -- validate --out evaluation/results/experiment-b-local --reserved path/to/reserved-manifest.json --validation-out evaluation/results/experiment-b-reserved
```

**These commands intentionally reject the current candidate**, because the development gate failed. A passed gate, unchanged source/config/OCR/truth/results, a successful freeze and a new validation output directory are required before any reserved OCR is opened. Validation attempts are consumed even if later checks fail. Repeated attempts, duplicate/exposed OCR, exposed product IDs and stale results are rejected. The exposure registry also includes historical products outside this experiment's replay subset.

A future reserved manifest contains `provenance` and `cases`, each with `annotation` (existing evaluation schema), `ocrFile`, `ocrSha256`, reviewed `truth` (the `BasisTruth` sidecar schema), and optional `image`. It must contain both fresh multi-basis and single-context products. Expected values belong only in the annotation/scorer. Agree capture ownership, sufficient product counts, reference phone/browser and phone UX/runtime gates before this phase. Reserved replay alone never establishes a passed production gate.

Meaningful tests cover scoped ownership, equal-valued foreign columns, damaged/missing cells, genuine and invalid percent-only cases, shared units, repeated panels, header fragments, unknowns, same-category instances, geometric matching, frozen baseline parity, source/input changes, output overwrite rejection and reserved-data barriers.
