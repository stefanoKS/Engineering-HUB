# V1.5 gate 3 — Backend API and performance

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: pending evidence seal after implementation commit.

## 1. Objective

Verify backend api and performance without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/Database.gs, ManagerWeb.gs, ManagerWebApi.gs, Ui.gs; scripts/manager-web-benchmark.js, manager-web-preview.js

## 3. Exact acceptance criteria and result

- Compact authorized bootstrap, on-demand views, bounded lists and request-local reads: automated PASS.
- 10/100, 100/1000, 300/3000 representative fixtures and baseline/final call-count/payload timings: PASS with raw JSON.
- Ordinary task saves skip full report regeneration; no persisted private cache: PASS.
- Actual warm Workspace goals and separately attributed browser/remote service/calculation timings: NOT_RUN; residual applicationMs is not pure calculation time.

## 4. Automated tests performed

v1_5-performance.test.js, v1_5-web.test.js; benchmark runner. Final aggregate: **387 tests, 387 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

3,000-task search and 2-second synthetic loading scenario checked.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 689 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Repeated source-table/workbook reads dominated service calls; mock overview CPU did not improve.

## 10. Corrective actions

Per-execution reuse, small DTOs, client cache, write invalidation, explicit report refresh.

## 11. Remaining limitations

Mock p50/p95 exclude Google latency. All-task scans remain. Live goals and fine-grained timing pending.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.

## 14. Review correction — 2026-10-28 (fresh project summary cost measured)

The stale-summary correction moves work from the task-save path to the read path.

| Projects/tasks | Operation | Warm p50 ms | Range reads | Opens | Payload bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| 10/100 | overview | 3.82 | 10 | 1 | 3787 |
| 10/100 | projectList | 3.09 | 8 | 1 | 3445 |
| 10/100 | taskUpdate | 2.51 | 20 | 2 | 915 |
| 300/3000 | overview | 93.76 | 10 | 1 | 7126 |
| 300/3000 | projectList | 21.58 | 8 | 1 | 16769 |
| 300/3000 | taskUpdate | 45.84 | 20 | 2 | 917 |
| 300/3000 | reportRefresh (avoided on save) | 278.3 | 16.7 | 1 | 1516 |

- Every table is still read at most once per request (asserted per sheet in `v1_5-web.test.js` and
  `v1_5-project-metrics.test.js`). Fresh health needs MILESTONES, ISSUES and AUTOMATION_SETTINGS in
  addition to the former six/seven reads.
- The normal task save is unchanged at 20 reads / 2 opens and never calls `Dashboard.refresh`
  (regression stubs `Dashboard.refresh` and `Database.writeGenerated` to throw).
- Overview warm local p50 rose 17.59 → 93.76 ms at 300 projects because `Health.classify` now runs
  for every project (`Utilities.formatDate` in `Health.staleDays`). This is disclosed, not hidden;
  the paginated list classifies only its page (21.58 ms instead of 86.6 ms).
- Payload budget `< 10000` bytes still holds (`v1_5-performance.test.js`); `rangeReadsPerCall` is now
  asserted as 10 with the reason recorded next to the assertion.

Evidence: [raw performance](V1_5_PERFORMANCE.json) regenerated from the current source,
[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt). No live Workspace latency claim is made.
