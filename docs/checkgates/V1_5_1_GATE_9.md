# V1.5.1 gate 9 — Tests and documentation

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7
Implementation commit SHA: 6da346c (feat(manager-web): local-first navigation with an authorized snapshot)

## 1. Objective

Cover the new behaviour with regression tests and update every document that describes it.

## 2. Affected source files

Tests: `tests/v1_5_1-performance.test.js` (new), `tests/v1_5_1-release.test.js` (new),
`tests/v1_5-web-ui.test.js` (startup operation renamed to `bootstrap`), `tests/v1_4_1-release.test.js`
(current-version agreement updated to 1.5.1), `tests/support/manager-web-harness.js` (optional
client source for the previous-release comparison).
Scripts: `scripts/manager-web-benchmark.js` (bootstrap/taskIndex, UI timings, previous-client
comparison, `V1_5_1_PERFORMANCE.json`).
Docs: `README.md`, `README_JP.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `docs/MANAGER_WEB_APP.md`,
`docs/MANAGER_WEB_APP_PERFORMANCE.md`, this gate set.

## 3. Exact acceptance criteria and result

| Required coverage | Test |
| --- | --- |
| Cache hit and expiration | "stale data renders instantly, refreshes in the background and keeps a draft" |
| Navigation without RPC | "navigation between overview, projects and tasks never calls the server" |
| Search completeness | "typing filters locally while an explicit search still queries every field" |
| Background revalidation | same as cache expiration, plus the slow-scenario manual run |
| Out-of-order RPC responses | "identical in-flight reads share one RPC and stale responses never repopulate the cache"; UI test with a late startup response |
| Concurrent manager edits | "a failed save keeps the draft, shows the error and never retries by itself" |
| Selective invalidation | "a save patches summaries, keeps unrelated caches and revalidates aggregates" |
| Save failure recovery | same test pair as concurrent edits |
| Role changes and denied users | "a revoked manager loses cached views and unsent drafts" |
| Large datasets | "large datasets keep the first payload bounded and the local list complete"; "an oversized task set is reported incomplete…" |
| Existing business functionality | V1.1–V1.5 suites unchanged, plus "existing writes still go through the validated domain path from cached forms" |

## 4. Automated tests performed

Full suite: **406 tests, 406 pass, 0 fail, 0 skipped**. The release started from 387 passing
tests; this release adds 14 performance/behaviour tests and 5 release-record assertions, and no
existing test was deleted or weakened.

## 5. Manual tests performed

`npm run preview:manager-web` with `normal`, `large`, `slow`, `error` and `empty` scenarios.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate; node scripts/manager-web-benchmark.js;
npm run preview:manager-web.

## 7. Actual results

All commands exit 0. `npm ci` installed 364 packages with 0 vulnerabilities. Validator reports
35 manager Apps Script files, 3 dashboard files, both manifests and **709** translation keys (689
before this release; the 20 new `web.*` labels exist in Japanese and English). No test was deleted
or weakened: the one edited UI test keeps its original intent (a late response must not replace a
newer navigation) and now uses the `bootstrap` startup operation; the version assertions moved
from 1.5.0 to 1.5.1 as the previous release did.

## 8. Relevant logs and evidence

[V1_5_1_VALIDATION.txt](V1_5_1_VALIDATION.txt), [baseline](V1_5_1_BASELINE.md),
[raw performance](V1_5_1_PERFORMANCE.json).

## 9. Identified problems

The new repository screenshots could not be captured through element screenshots in the embedded
browser (stability timeout), and the panel clamps the viewport to ~719 px.

## 10. Corrective actions

Evidence is the DOM measurement (375/768/1366 widths, no horizontal overflow, 180 px + 1,171 px
grid at 1366) plus full-page screenshots at 375 and 768. 1366/1920 screenshots and native zoom are
recorded as NOT_RUN rather than silently omitted.

## 11. Remaining limitations

Live Workspace verification and browser paint profiling remain NOT_RUN.

## 12. Final gate status

**PASS** locally. **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR
PRODUCTION.**
