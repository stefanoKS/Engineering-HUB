# V1.5 gate 1 — Architecture and compatibility

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: 63596375251c230afa11ad42cf999cd3a2f0cef9 (V1.5 implementation); review-correction commit: 309a86c17643e01235555f820a921438fe285487 (project summary freshness, deadline-only tasks, project cards).

## 1. Objective

Verify architecture and compatibility without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/ManagerWeb.gs, ManagerWebIndex.html, ManagerWebClient.html, ManagerWebStyles.html, ManagerWebApi.gs, Ui.gs, appsscript.json

## 3. Exact acceptance criteria and result

- Browser URL opens without Sheets and normal CRUD works: local preview PASS; actual HTML Service URL NOT_RUN.
- Existing src/domain/A reused; schema 6/contract 1.4 and separate dashboard-app: automated PASS.
- Original sidebar remains operational: regression PASS; live sidebar NOT_RUN.

## 4. Automated tests performed

v1_5-web.test.js, v1_5-web-ui.test.js and existing sidebar/domain suites. Final aggregate: **387 tests, 387 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

Local browser navigation, task save and hierarchy inspected. DEV deployment/sidebar not executed.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 689 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Original sidebar bootstrap was too broad for a browser homepage.

## 10. Corrective actions

Added focused DTOs and lazy client views while retaining domain services and sidebar.

## 11. Remaining limitations

No real HTML Service deployment evidence.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.

## 14. Review correction — 2026-10-28 (project summary freshness, deadline-only tasks, card usability)

`ManagerWeb.projectList` no longer returns the stored `PROJECTS.Progress_Percent` / `PROJECTS.Health`
columns. The new pure function `Dashboard.projectMetrics(asOf, only)` derives progress
(`Progress.rollup`), health (`Health.classify`), task counts and the neutral deadline state from the
current operational rows, grouping tasks by project once and reading each table at most once per
request. A task save still skips `Dashboard.refresh`, so the overview and cards now change
immediately after a save without any report regeneration. `Health.daysBetween` is exported and the
paginated list recalculates only its visible page.

Compatibility unchanged and re-asserted: Schema 6, employee contract 1.4, the Sheets sidebar, the
separate `dashboard-app` project and its snapshot contract. No migration, no schema change, no new
persistence. The sidebar keeps its default behaviour because `Ui.assignTask`/`Tasks` are untouched;
only the web DTO layer and the web form changed.

Evidence: [V1_5_VALIDATION.txt](V1_5_VALIDATION.txt) (npm ci, npm run lint, npm test = 387 pass /
0 fail, npm run validate = 35 manager .gs, 3 dashboard .gs, both manifests, 689 keys,
npm run preview:manager-web GET 200 plus an authorized overview RPC), [raw performance](V1_5_PERFORMANCE.json),
[visual checks](V1_5_VISUAL.md). Live Workspace verification remains NOT_RUN.
