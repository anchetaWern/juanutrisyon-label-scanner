# Phase 5: conservative parser/layout improvements

Replay the **unchanged Phase 2 OCR** through parser v2 from immutable commit `57234a0` and the current parser. This isolates extraction changes from recognition/preprocessing changes. No API key, model download, paid inference or fresh OCR is needed.

## Reproduce

Requires the local Phase 2 photos/labels, completed `evaluation/results/phase-2-pilot-2026-10-11/run.json`, and the exposed legacy corpus under `benchmark/`. The photos/full OCR remain gitignored. The seven tracked, sanitized development fixtures support portable unit tests without those local inputs.

```bash
# Use a new directory for a development iteration.
npm run phase5 -- develop --out evaluation/results/phase-5-reproduction
npm run phase5 -- freeze --out evaluation/results/phase-5-reproduction
npm run phase5 -- validate --out evaluation/results/phase-5-reproduction
```

`develop` filters to products 01/03/04/06/07/09/10/12/13/15 **before invoking either parser**, then also checks the previously exposed desktop/mobile regression cases. `freeze` requires passing development results and records hashes of parser, scoring code, dataset and saved OCR. `validate` checks the exact frozen identity and parses only products 02/05/08/11/14. It refuses to overwrite an existing validation. Failed gates exit nonzero and cannot be frozen.

Do not repeatedly validate new candidates against those five products: their Phase 5 outcomes are now exposed. Future tuning needs new reserved products. These images were already in the Phase 2 report and Phase 4 control validation; they are reserved from Phase 5 tuning, not an entirely new external blind dataset.

## Gates and outputs

- No new wrong/false-positive fields, including changes from one wrong value to a different wrong value.
- No loss of any previously correct scored field, even if another field offsets the aggregate count.
- No decrease in correct nutrient or serving counts in any cohort.
- Apply the gates to supplemental annotations as well as owner-verified fields; never count unreviewed outputs as correct.

Each group writes `report.json`, `report.md`, `fields.csv` and `comparison.json`, with before/after outcomes and source-line evidence. Pilot primary metrics use only owner-verified fields; expanded metrics retain the separately identified provisional visual supplements and negative annotations. `development.json`, `frozen.json` and `validation.json` retain the provenance needed to audit selection.

The accepted run is `evaluation/results/phase-5-release-2026-10-11/`. See the [findings](../../docs/phase-5-parser-2026-10-11.md) and [tracked compact baseline](../baselines/phase-5-2026-10-11.json). Historical OCR timings in replay reports are not new parser-speed or phone-latency measurements.
