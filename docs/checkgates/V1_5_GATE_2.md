# V1.5 gate 2 — Identity and authorization

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: pending evidence seal after implementation commit.

## 1. Objective

Verify identity and authorization without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/ManagerWeb.gs, ManagerWebApi.gs, appsscript.json; docs/MANAGER_WEB_APP_DEPLOYMENT.md

## 3. Exact acceptance criteria and result

- ADMIN/MANAGER active identity and departmental access: mocked PASS; separate real Google accounts NOT_RUN.
- MEMBER/VIEWER/unregistered/inactive/outside-domain/blank identity refusal; direct RPC and actor/role spoof protection: automated PASS; live account matrix NOT_RUN.
- Sensitive writes ADMIN-only; no private data before auth: automated PASS.
- DOMAIN + USER_ACCESSING deployment and actual audit actor/A sharing: manifest/local PASS; actual deployment/sharing NOT_RUN.

## 4. Automated tests performed

v1_5-web.test.js plus existing Access/Roles/notification safety tests. Final aggregate: **378 tests, 378 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

Official Google execution-mode and Session documentation reviewed; no live login/deployment.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 684 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Web execution context cannot inherit the sidebar identity assumption.

## 10. Corrective actions

Mandatory domain property plus active-user role checks; no effective-user fallback; explicit execute-as-user guide.

## 11. Remaining limitations

Reliable visiting identity and A isolation are release blockers until DEV evidence.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.
