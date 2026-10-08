# Nutrition extraction accuracy baseline

Metric: `field-exact-v1`. Parser: `spatial-review-v2`. Mode: frozen OCR replay.

## Field-level results

Exact recall counts correct field/value pairs over readable annotated fields. Precision counts correct outputs over scored outputs (including wrong and false-positive outputs). Unreviewed fields are excluded.

| Cohort / fields | Readable | Correct | Wrong | Missing | Exact recall | Precision | Coverage | False positives / negative fields |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy-desktop-replay / nutrients | 371 | 176 | 0 | 195 | 47.44% | 100.00% | 47.44% | 0 / 0 |
| legacy-desktop-replay / serving | 59 | 19 | 4 | 36 | 32.20% | 79.17% | 38.98% | 1 / 1 |
| mobile-replay / nutrients | 124 | 121 | 0 | 3 | 97.58% | 100.00% | 97.58% | 0 / 1 |
| mobile-replay / serving | 10 | 8 | 0 | 2 | 80.00% | 100.00% | 80.00% | 0 / 0 |

## OCR presence proxies and recorded runtime

These bounded matches search recognized lines across the panel. They do not prove detection, correct row association, or correct nutrition basis. No OCR character repair is applied by the metric.

| Cohort | Name presence | Amount/string presence | Provider failures | Recorded desktop processing mean / p95 | Timing samples | Unscored outputs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy-desktop-replay | 323/430 | 260/430 | 0/30 | 1486 / 2205 ms | 30 | 8 |
| mobile-replay | 127/134 | 96/134 | 0/8 | N/A | 0 | 0 |

Detection recall: **N/A** — No independently annotated text regions; presence proxies do not measure detector recall.

## Historical splits

| Cohort / split | Cases | Correct / readable fields | Exact recall | Wrong | Missing |
| --- | ---: | ---: | ---: | ---: | ---: |
| legacy-desktop-replay/development | 18 | 122/248 | 49.19% | 1 | 125 |
| legacy-desktop-replay/holdout | 8 | 62/117 | 52.99% | 1 | 54 |
| legacy-desktop-replay/regression | 4 | 11/65 | 16.92% | 2 | 52 |
| mobile-replay/regression | 8 | 129/134 | 96.27% | 0 | 5 |

Known overlap: **label-030** (IMG_3584: regression; label-030: holdout). Historical holdout product is exposed in another cohort. Do not treat this as a blind holdout.

## Ranked review queue

Counts are affected fields, not independent images. Categories identify observable symptoms; detection versus recognition needs image/region review.

| Triage category | Fields | Examples |
| --- | ---: | --- |
| expected-name-and-value-not-found-in-ocr | 65 | new-1:serving.serving_size, label-002:serving.serving_size, label-002:trans_fat, label-003:cholesterol, label-003:potassium |
| expected-value-not-found-in-ocr | 59 | IMG_3585:carbohydrate, IMG_3585:saturated_fat, new-2:serving.servings_per_container, new-3:total_fat, label-003:serving.serving_size |
| expected-name-not-found-in-ocr | 41 | label-002:saturated_fat, label-002:serving.servings_per_container, label-002:sodium, label-003:carbohydrate, label-003:energy |
| abstention-with-name-and-value-somewhere-in-ocr | 37 | label-002:potassium, label-002:vitamin_d, label-005:energy, label-006:energy, label-007:energy |
| unsupported-nutrition-basis | 22 | label-001:calcium, label-001:carbohydrate, label-001:cholesterol, label-001:energy, label-001:fiber |
| duplicate-row-abstention | 12 | label-002:sugars, label-008:calcium, label-008:carbohydrate, label-008:cholesterol, label-008:energy |
| wrong-value-or-association | 4 | label-001:serving.serving_size, label-008:serving.serving_size, label-009:serving.serving_size, label-014:serving.serving_size |
| value-on-unreadable-field | 1 | label-019:serving.serving_size |

## Per-case results

| Case | Correct / readable | Wrong | Missing | False positives | Unscored outputs |
| --- | ---: | ---: | ---: | ---: | ---: |
| IMG_3584 | 15/15 | 0 | 0 | 0 | 0 |
| IMG_3585 | 15/17 | 0 | 2 | 0 | 0 |
| IMG_3586 | 16/16 | 0 | 0 | 0 | 0 |
| IMG_3587 | 13/13 | 0 | 0 | 0 | 0 |
| IMG_3588 | 17/17 | 0 | 0 | 0 | 0 |
| new-1 | 16/17 | 0 | 1 | 0 | 0 |
| new-2 | 22/23 | 0 | 1 | 0 | 0 |
| new-3 | 15/16 | 0 | 1 | 0 | 0 |
| label-001 | 0/23 | 1 | 22 | 0 | 0 |
| label-002 | 8/16 | 0 | 8 | 0 | 0 |
| label-003 | 10/16 | 0 | 6 | 0 | 0 |
| label-004 | 6/12 | 0 | 6 | 0 | 1 |
| label-005 | 11/16 | 0 | 5 | 0 | 1 |
| label-006 | 9/13 | 0 | 4 | 0 | 1 |
| label-007 | 10/12 | 0 | 2 | 0 | 0 |
| label-008 | 6/17 | 1 | 10 | 0 | 0 |
| label-009 | 7/13 | 1 | 5 | 0 | 1 |
| label-010 | 0/12 | 0 | 12 | 0 | 0 |
| label-011 | 9/12 | 0 | 3 | 0 | 0 |
| label-012 | 8/17 | 0 | 9 | 0 | 0 |
| label-013 | 6/7 | 0 | 1 | 0 | 1 |
| label-014 | 1/16 | 1 | 14 | 0 | 0 |
| label-015 | 7/16 | 0 | 9 | 0 | 0 |
| label-016 | 6/18 | 0 | 12 | 0 | 0 |
| label-017 | 5/17 | 0 | 12 | 0 | 0 |
| label-018 | 5/12 | 0 | 7 | 0 | 0 |
| label-019 | 7/11 | 0 | 4 | 1 | 1 |
| label-020 | 4/12 | 0 | 8 | 0 | 1 |
| label-021 | 8/12 | 0 | 4 | 0 | 1 |
| label-022 | 0/12 | 0 | 12 | 0 | 0 |
| label-023 | 9/15 | 0 | 6 | 0 | 0 |
| label-024 | 7/12 | 0 | 5 | 0 | 0 |
| label-025 | 1/12 | 0 | 11 | 0 | 0 |
| label-026 | 9/14 | 0 | 5 | 0 | 0 |
| label-027 | 14/19 | 0 | 5 | 0 | 0 |
| label-028 | 2/12 | 0 | 10 | 0 | 0 |
| label-029 | 10/17 | 0 | 7 | 0 | 0 |
| label-030 | 10/17 | 0 | 7 | 0 | 0 |

## Wrong, false-positive, and unscored outputs

| Case | Field | Expected/status | Output | Outcome |
| --- | --- | --- | --- | --- |
| label-001 | serving.serving_size | (1 pc) 50g | (1 pc) | wrong |
| label-004 | energy_from_fat | unreviewed | 36kcal | unscored |
| label-005 | energy_from_fat | unreviewed | 35kcal | unscored |
| label-006 | energy_from_fat | unreviewed | 70kcal | unscored |
| label-008 | serving.serving_size | about 8 pieces (40g) | AJout 8 pieces (40g) | wrong |
| label-009 | energy_from_fat | unreviewed | 0kcal | unscored |
| label-009 | serving.serving_size | 5-6 cups (25g) | 5-6 cu15 | wrong |
| label-013 | energy_from_fat | unreviewed | 0kcal | unscored |
| label-014 | serving.serving_size | 1 Tbsp (15mL) | 1 Tbsp (15mI) | wrong |
| label-019 | energy_from_fat | unreviewed | 0kcal | unscored |
| label-019 | serving.serving_size | unreadable | 1 Tbsp (1 | false-positive |
| label-020 | energy_from_fat | unreviewed | 15kcal | unscored |
| label-021 | energy_from_fat | unreviewed | 43kcal | unscored |

## Scope and limitations

- Frozen OCR replay, not a fresh recognition run. No capture or preprocessing changes are evaluated.
- All mobile cases were used in parser development and are regression cases; their accuracy is not a generalization estimate.
- Missing annotations and legacy nulls are unreviewed, not absent or unreadable. Unscored outputs are reported separately.
- Five older mobile annotations inherit prior image review; three September 18 images were rechecked on 2026-10-08.
- Negative examples are sparse; false-positive counts must be read with their denominators. There is no representative unreadable-image negative set or independently annotated text-region boxes.
- OCR name/value presence is a whole-panel proxy: matches can come from another row or column. Error categories are triage hints, not proven causes.
- Serving matches preserve parentheses and household measures; semantically equivalent but differently formatted strings may need annotation review.
- Legacy development/holdout/regression splits are preserved. The holdout was inspected in earlier work and is not a new blind test.
- Legacy metrics are provisional: targeted image review covers the correction overlay and five serving outputs; remaining inherited annotations still need a full image audit.
- Label 019 serving size is marked unreadable because glare obscures a digit; a populated partial string counts as an unsupported output. This single field does not establish performance on unreadable photos.
- Stored desktop processing times exclude initialization and are not current phone latency. Mobile fixtures contain no timing.
- The supplemental re-encoded label-030 desktop run is excluded to avoid counting the same product/crop repeatedly.

Full field outcomes, original OCR evidence indexes, parser warnings, source SHA-256 digests, and results by field/tag are in report.json. fields.csv provides a review worksheet. No confidence score is interpreted as calibrated correctness.
