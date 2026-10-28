# V1.6 gate 9 — Employee snapshot compatibility

Status: **PASS** (local) — **BLOCKED** for live publication verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: 34a2bf1

## 1. Objective

The employee dashboard supports the nested hierarchy and the completion review state through a versioned,
additive snapshot contract, without weakening A/B publication safety or leaking private data.

## 2. Relevant source files

`src/SharedDashboardModel.gs` (contract 1.5, colour, nested task DTO, review state, leaf-only aggregates,
deletion-marker exclusion), `src/SharedDashboardPublisher.gs` (publisher 1.6, review states, colour fallback,
`completedAt` date normalization), `dashboard-app/DataService.gs` (contract 1.5 headers, nested ordering, review
labels), `dashboard-app/Client.html`, `dashboard-app/Styles.html`, `docs/dashboard/DATA_CONTRACT.md`,
`tests/dashboard-fixtures.js`.

## 3. Required functionality

1. Additive contract 1.5: `responsibility.color`, `task.parentTaskId`, `container`, `reviewState`, `completedAt`.
2. Publisher and reader updated together; header/hash/count verification and A/B slots unchanged.
3. A failed run leaves the previous snapshot readable; a restricted project and request text never publish.
4. An older deployed employee app must fail closed rather than misread the new snapshot.
5. The previous `App.gs` meta-tag fix stays untouched.

## 4. Acceptance criteria

- `PUBLISHED_META.CONTRACT_VERSION` is `1.5` and provider/reader field lists match exactly.
- Nested subprojects and subtasks render nested; containers show derived progress.
- `RESTRICTED` projects, descriptions, acceptance criteria, effort and request text never appear.
- The manager's change remains private until the next publication.

## 5. Automated test cases

`tests/v1_4-release.test.js` (provider/reader parity, contract agreement), `tests/v1_2-publisher.test.js`
(meta contract, independence from mail mode), `tests/v1_2-dashboard.test.js` (header mismatch fails closed),
`tests/v1_5-publication.test.js` (Date normalization before hash), `tests/v1_4-hierarchy.test.js`
(published hierarchy), `tests/v1_6-completion.test.js` (review state without report text),
`tests/v1_6-release.test.js` (field-list parity, rendering hooks).

## 6. Actual test results

PASS locally, including the hash verification with Sheets-materialized `Date` values. Live publication is
**NOT_RUN**.

## 7. Manual test cases (DEV, not executed)

Runbook steps 4–6: contract mismatch message with the old reader, new deployment, publication flip, nested
rendering, restricted exclusion, privacy of unsaved changes.

## 8. Performance results

Publication p50 2.60 / 6.66 / 15.91 ms (300 projects: one `INTERNAL` project). The employee payload grows by the
five new columns only.

## 9. Security review

`isPublicFieldSet` and the explicit DTO constructor still list every published field; no source row is forwarded.
The review state is a state string, never the note or the reporter. Rows with a deletion marker are excluded, and
the viewer never learns why a record disappeared.

## 10. Problems found

The publisher's date normalisation list did not include the new `completedAt`; a Sheets-materialized `Date` would
have broken the hash comparison.

## 11. Corrective actions

`completedAt` added to both normalisation lists and to the parity test.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live A/B publication and the old-reader rejection are **BLOCKED** (no DEV snapshot workbook). Contract rollout is
documented in `docs/dashboard/DATA_CONTRACT.md`.

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA 34a2bf1.
**IMPLEMENTED — DEV PUBLICATION VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
