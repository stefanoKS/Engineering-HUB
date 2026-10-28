# V1.5 gate 1 — Architecture and compatibility

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: pending evidence seal after implementation commit.

## 1. Objective

Verify architecture and compatibility without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/ManagerWeb.gs, ManagerWebIndex.html, ManagerWebClient.html, ManagerWebStyles.html, ManagerWebApi.gs, Ui.gs, appsscript.json

## 3. Exact acceptance criteria and result

- Browser URL opens without Sheets and normal CRUD works: local preview PASS; actual HTML Service URL NOT_RUN.
- Existing src/domain/A reused; schema 6/contract 1.4 and separate dashboard-app: automated PASS.
- Original sidebar remains operational: regression PASS; live sidebar NOT_RUN.

## 4. Automated tests performed

v1_5-web.test.js, v1_5-web-ui.test.js and existing sidebar/domain suites. Final aggregate: **378 tests, 378 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

Local browser navigation, task save and hierarchy inspected. DEV deployment/sidebar not executed.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 684 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

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
