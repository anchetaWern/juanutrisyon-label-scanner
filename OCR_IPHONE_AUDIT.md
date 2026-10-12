# iPhone OCR accuracy audit — 2026-10-12

This is the pre-implementation baseline. See [the subsequent layout release](docs/single-basis-layout-2026-10-12.md) for the implementation and its separate before/after results.

## Bottom line

The parser improvements are helping, but the app still misses many fields. The strongest next opportunity is better table/layout interpretation, alongside a targeted experiment for actual OCR digit/unit errors. A model swap is not yet justified by these scans alone.

This is an offline analysis, not a new app release. No production OCR settings, parser rules, labels, or UI were changed.

## What was checked

All 15 products in `labels/nutrition_labels_json` have a crop PNG, OCR JSON, diagnostics JSON, original smaller JPEG, and human-verified label JSON. All crops decode successfully, and their dimensions/byte sizes match diagnostics. Standalone OCR matches embedded diagnostic OCR for every scan. Replaying the frozen v3 release parser from commit `0927174` reproduces every saved extraction, including evidence and warnings. The audit script uses that frozen parser even after later app updates.

All scans use `v6-tiny-recall-v2` and `spatial-review-v3`. Fourteen use rectangle crops; palm oil (09) uses perspective correction. The exact larger phone original files are not supplied: their filenames and byte sizes differ from the existing smaller JPEGs. This does not prevent analysis of the supplied crops and saved OCR, but prevents exact original-to-crop reproduction.

## Measured results

Exact field scoring uses the unchanged owner labels and existing `field-exact-v1` metric. Correct means the nutrient/serving field and its value match, allowing only the metric's existing formatting normalization. Missing values remain failures, not zeros.

| Owner-verified fields | Correct | Wrong | Missing | Correct / expected |
| --- | ---: | ---: | ---: | ---: |
| Nutrients | 124 | 1 | 66 | 124/191 (64.9%) |
| Serving details | 18 | 0 | 12 | 18/30 (60.0%) |
| Combined | 142 | 1 | 78 | 142/221 (64.3%) |

There were no provider failures. Seven additional emitted fields are outside owner truth, so they do not inflate the primary score. Separately, the pre-existing Codex-reviewed supplements score 7/9 printed fields, with two missing calories-from-fat values (06 and 09); all seven annotated absent fields remain absent. These supplements still await independent human verification and are not a representative negative test set.

### Did Phase 5 actually help?

Yes, on these saved phone OCR outputs. Running the older parser from commit `57234a0` on **identical OCR** isolates the parser's effect:

| Same phone OCR | Older parser | Current parser |
| --- | ---: | ---: |
| Correct nutrient fields | 94/191 | 124/191 |
| Correct serving fields | 13/30 | 18/30 |
| Wrong owner-verified outputs | 6 | 1 |

No previously correct owner field was lost in this comparison. This is evidence of improvement on these scans, not proof of accuracy on unseen products. The earlier desktop rectangle result of 125/191 nutrients used different source bytes and crops; comparing that directly with 124/191 here cannot establish an app/device regression.

## What is going wrong

Visual inspection and raw OCR show mixed causes. The following are review findings, not exact counts of fields guaranteed recoverable by a single fix.

| Product | Correct nutrients | Correct serving | Main observations |
| --- | ---: | ---: | --- |
| 01 Shrimp snack | 8/11 | 2/2 | OCR has `tal Fat 3g` and `Total Proten 2g`; the crop ends at protein and excludes the verified vitamin A row. |
| 02 Yellow snack | 11/15 | 1/2 | The image shows **160 kcal**, but OCR supplies **60**, which the parser accepts. Other missing fields need association/recognition review. |
| 03 Tang | 6/13 | 2/2 | Side-by-side sections; energy `20 kcal` is recognized but not extracted. Several gram/microgram tokens are damaged; sublabels `-Trans` and `-Saturated` lack supported context. |
| 04 Blue tub | 12/15 | 1/2 | Bullet-prefixed calcium/potassium are recognized but unsupported. Serving-size fragments are ordered awkwardly; vitamin D has a damaged amount token. |
| 05 Spam | 0/10 | 0/2 | Per-56g and per-100g columns trigger deliberate multi-basis abstention. The printed owner-target values are present in OCR. Serving text sits beside, not above, the table. |
| 06 Fried sardines | 6/18 | 2/2 | Joined labels/amounts, spelling errors, `Cal` units, unsupported DHA/omega-3, and damaged vitamin D text. |
| 07 CDO sardines | 10/12 | 2/2 | Core table succeeds; DHA/omega-3 amounts occur in a sentence below the table and are unsupported. |
| 08 Mega sardines | 9/9 | 2/2 | All owner-verified fields are correct. |
| 09 Palm oil | 9/15 | 2/2 | Calories and calories-from-fat share one OCR line; plural `Fats/Lipids`, unsaturated fat, and omega rows are unsupported; carbohydrate label is misspelled. |
| 10 Sandwich crackers | 10/15 | 0/2 | Three sections: serving block is below the top nutrient row, carbohydrate amount is detached, and four micronutrients share one OCR line. |
| 11 Coconut wafer | 8/10 | 0/2 | Serving block is beside nutrient sections. `Total Calories` is unsupported; carbohydrate `13 g` becomes `139` in OCR. |
| 12 Potato snack | 11/11 | 0/2 | All owner nutrients succeed; `Seving`/`Sevings` spelling errors block serving extraction. |
| 13 Green biscuit | 15/15 | 1/2 | Detached nutrient columns succeed. The visible serving-count text/value `20` is absent from OCR; it is not cropped out. |
| 14 Yellow milk | 0/10 | 1/2 | Separate name, unit, amount, and daily-value columns defeat extraction. Many correct digits are already recognized, but some tokens are missing/misread too. |
| 15 Cream milk | 9/12 | 2/2 | Missing trans-fat zero; damaged sugar label and vitamin A unit. Vitamin D3/owner `vitamin_d` naming remains a previously documented annotation caveat. |

Important distinction: absent output does **not** necessarily mean OCR failed. The existing presence checks search complete strings across OCR lines; separate unit cells can fail that check even when the relevant number and unit were recognized. They cannot supply a reliable OCR-versus-parser failure percentage.

## Recommended next implementation

1. **Improve structural extraction on frozen OCR first.** Handle side-by-side sections, separate unit columns, detached serving fragments, bullet-prefixed names, and multiple nutrients in one line. Add carefully scoped vocabulary support. Preserve evidence, qualifiers, units, and ambiguity safeguards. Do not infer missing digits.
2. **Handle multiple bases explicitly.** For a table like Spam, introduce a clearly selected basis (for example per serving versus per 100g) rather than removing abstention and silently choosing a column. Evaluate this separately from simpler single-basis fixes.
3. **Run a focused OCR-region experiment.** Inspect detector boxes and recognition around dropped digits (`160` → `60`), lost serving counts, and damaged units. Compare targeted row/region re-reading with the current pipeline on the same crops. Do not repair numeric strings based on expected product values or nutrition arithmetic. Keep the crop-completeness issue separate.

Before calling a candidate an accuracy improvement, require more correct fields without newly wrong values, unit/basis mistakes, or losses of previously correct fields. Keep the current and historical scans as regression sets. All 15 products, including the former five holdout products, have now been exposed; obtain additional unseen labeled products for fresh validation. New originals are needed only for full capture reproduction, not for starting parser experiments on these saved scans.

## Reproduction and artifacts

Run from the project root, using a new output directory each time:

```sh
node --import tsx evaluation/phone/audit.ts --out evaluation/results/iphone-audit-2026-10-12-complete
```

The local result directory contains `report.json` (every field/evidence/warning), `fields.csv` (review worksheet), `comparison.json` (same-OCR older/current parser comparison), `audit.json` (pairing checks, hashes, timing), and `supplemental.json` (separate supplemental scoring). Raw exports and generated results remain gitignored. The script validates all inputs before writing and refuses to overwrite an existing result directory.

Input fingerprint, including manifest and all 75 supplied files:
`a96f941a046d45f2fcbd9614a35488d5f4df9988644fd54532d526d017ab6ba5`.

Recorded phone OCR total time averages **4.42 seconds**, p95 **7.82 seconds**, including initialization. Recognition alone averages **2.59 seconds**, p95 **4.21 seconds**. Every request reports initialization; these timings do not establish warm-scan performance or a fair desktop comparison. None includes a new OCR run during this audit.

Harness caveat: the older Phase 2 loader requires exactly the original JPEG/label pairs and currently rejects the additional export files in that directory. This audit uses explicit file suffixes without changing that loader; address the inventory rule before rerunning the old Phase 2/5 CLI against this expanded folder.
