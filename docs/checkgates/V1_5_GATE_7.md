# V1.5 gate 7 — Employee dashboard and request compatibility

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: 63596375251c230afa11ad42cf999cd3a2f0cef9 (V1.5 implementation); review-correction commit: 309a86c17643e01235555f820a921438fe285487 (project summary freshness, deadline-only tasks, project cards).

## 1. Objective

Verify employee dashboard and request compatibility without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/SharedDashboardPublisher.gs, Requests.gs; dashboard-app/DataService.gs; shared/generated i18n

## 3. Exact acceptance criteria and result

- Schema 6, contract 1.4, A/B/C isolation and INTERNAL-only snapshot: local PASS.
- Date/numeric/Boolean canonical round-trip, hashes/slot fallback and employee reader: regression PASS.
- Request import/approval/history/completion/recovery: local PASS.
- Retest reported PUBLISHED_PROJECTS_B committedDeadline mismatch in actual Sheets and employee app: NOT_RUN.

## 4. Automated tests performed

v1_5-publication.test.js; existing publisher/dashboard/request/isolation suites. Final aggregate: **387 tests, 387 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

No actual B publication or employee deployment accessed.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 689 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Sheets may coerce ISO date strings into Date objects before read-back/hash.

## 10. Corrective actions

Plain-text date column format plus explicit known-field canonical date normalization on both sides; verification retained.

## 11. Remaining limitations

Earlier Workspace bug is locally fixed but live fix UNVERIFIED. Mock request receipt mirroring warning is expected without C.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.

## 14. Review correction — 2026-10-28 (employee application untouched)

- `dashboard-app/` source, its manifest, the sanitized snapshot sheets and contract 1.4 are
  unchanged by this correction. `SharedDashboardModel.CONTRACT_VERSION` is still asserted as `1.4`
  in `v1_5-web.test.js`.
- The shared dictionary gained four `web.*` labels plus `web.health`; `npm run sync:i18n` copied the
  canonical file to `src/I18n.html` and `dashboard-app/I18n.html`, so both projects stay identical
  and no employee label can drift.
- The employee reader is unaffected: the manager web app never reads the snapshot and the publisher
  never reads the manager web DTOs.
- Request workflows are untouched; the request-decision, staleness and inbox-import suites still
  pass (387 tests, 0 failures).

This correction provides no new live evidence for the employee deployment; the DEV smoke plan and
`docs/dashboard/SMOKE_TEST.md` remain unverified.
