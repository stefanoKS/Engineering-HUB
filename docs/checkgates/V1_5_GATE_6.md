# V1.5 gate 6 — Data integrity and concurrency

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: pending evidence seal after implementation commit.

## 1. Objective

Verify data integrity and concurrency without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/Database.gs, Requests.gs, ManagerWebApi.gs, Ui.gs, ManagerWebClient.html

## 3. Exact acceptance criteria and result

- Stable IDs, custom columns/formulas, phantom-checkbox rows, safe inserts and migration guards: regression PASS.
- Edit hash checked after lock acquisition, actor rechecked, stale drafts retained: PASS.
- Request decision claim/effect/history under one lock with no nested acquisition, repeated decision refused: PASS.
- Real simultaneous managers, interrupted/quota-limited Workspace writes and recovery: NOT_RUN.

## 4. Automated tests performed

v1_5-web.test.js lock-interleaving/request-lock tests; existing data, migration, request recovery and UI conflict suites. Final aggregate: **387 tests, 387 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

Synthetic task save and draft/focus verified; no live failure injection.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 689 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Request validation/claim previously preceded the inner task write lock; shared context needed mutation invalidation.

## 10. Corrective actions

Hold/reuse one execution lock across decision; clear cache on lock entry and table changes; preserve check/draft on failure.

## 11. Remaining limitations

Sheets is not transactional. Transport failure may have committed a create; review record/audit before retry. No exactly-once promise.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.

## 14. Review correction — 2026-10-28 (no new write path, no new state)

- The correction adds **no write path**: `Dashboard.projectMetrics` only reads `PROJECTS`, `TASKS`,
  `MILESTONES`, `ISSUES` and `AUTOMATION_SETTINGS`. A regression test spies on
  `Database.writeGenerated` and asserts an overview plus a project list write nothing.
- `PROJECTS.Progress_Percent` / `PROJECTS.Health` keep their existing single writer
  (`Dashboard.refresh` / `Progress.refresh`). A task save leaves both stale on purpose; the read
  path derives the truth instead of adding a second stored copy or a partial refresh write.
- Edit safety is unchanged: every `taskSave`/`projectSave` still compares the SHA-256 revision
  inside `Database.withMutationCheck` after acquiring the existing script lock; a stale revision is
  refused with `EDIT_CONFLICT` and no partial write occurs.
- No schema change, no migration ID, no new table, no Script Property, no trigger. Schema stays 6.
- Reads still reuse one execution-local cache and never interact with the lock; nested domain calls
  keep reusing a held lock rather than acquiring a second one.

Evidence: [V1_5_VALIDATION.txt](V1_5_VALIDATION.txt) (387 tests pass, validator passes).
