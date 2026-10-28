# V1.6.1 gate 5 — Migration, snapshot and deployment compatibility

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-29
Starting commit SHA: `ea3fbc9`
Branch: `fix/v1.6.1-stabilization`

## 1. Objective

Let an already published snapshot stay readable after an application update, keep a mismatched contract failing
closed, publish every contract date in one format, and document a deployment order that keeps users unaffected.

## 2. Findings (audit of the V1.6 delivery)

1. `dashboard-app/DataService.openTab` rejected any `CONTRACT_VERSION` other than `1.5`, so updating the employee
   app blanked a snapshot published before the manager upgrade — for a purely additive contract change.
2. `SharedDashboardPublisher.snapshotDate` normalized `completedAt`, but `writeSlotSheet` did not set the text
   format for that column, so a locale could render it as a serial number.
3. `docs/V1_6_DEPLOYMENT_RUNBOOK.md` ran the migration before pushing the code (the migration only exists in the new
   code) and named `createBackup()`, which does not exist; the exported entry point is `createDatabaseBackup()`.
4. The runbook described the employee app as failing closed against a newer contract but not that the new reader
   accepts both.

## 3. Required functionality

1. Contracts **1.4** and **1.5** are readable, each validated against its own exact header row.
2. An unknown or mixed contract still fails closed with `SNAPSHOT_CONTRACT_UNSUPPORTED`.
3. `completedAt` is normalized to `yyyy-MM-dd` and written into a text-formatted column.
4. The runbook documents the real entry points and the safe order: push head → verify backup → migrate → verify →
   create a new deployment version.
5. Schema 7 and contract 1.5 are unchanged; no new migration is introduced.

## 4. Relevant source files

`dashboard-app/DataService.gs` (`CONTRACTS`, `SUPPORTED_CONTRACTS`, `DEFAULT_CONTRACT`, `openTab`,
`metaPayload`, `requestTarget`), `src/SharedDashboardPublisher.gs` (`DATE_FIELDS`, `snapshotDate`,
`writeSlotSheet`, `PUBLISHER_VERSION = '1.6.1'`), `docs/V1_6_DEPLOYMENT_RUNBOOK.md`, `docs/dashboard/DATA_CONTRACT.md`,
`DEPLOYMENT.md`.

## 5. Acceptance criteria

- A 1.4-shaped snapshot (13 task columns, no responsibility colour) is read successfully and reports
  `contractVersion 1.4`; `container` is `false` and `parentTaskId`/`completedAt` are empty.
- A 1.5 snapshot is read through the 1.5 header row.
- `1.3` and a 1.4 header carrying 1.5 columns are refused.
- The published `completedAt` cell matches `^\d{4}-\d{2}-\d{2}$` and the reader returns the same shape.
- The runbook contains `createDatabaseBackup()`, `reconcileDeletions('RECONCILE DELETIONS')`, the dual-contract
  statement, and pushes the code before the migration runs.

## 6. Automated test cases

`tests/v1_6_1-compatibility.test.js` — 6 cases: 1.4 readable; 1.5 read through its own row; unknown/mixed refused;
`completedAt` normalization and text storage; the container flag reaching the employee request service; the runbook
content and ordering. `tests/v1_5-publication.test.js` and `tests/v1_4-hierarchy.test.js` keep the earlier
contract-fail-closed and date-normalization evidence.

## 7. Actual test results

PASS locally: 6/6 new cases; full suite **500 tests, 500 pass**, `npm run validate` passes (39 manager files, 3
dashboard files, 789 translation keys).

## 8. Manual test cases (DEV, not executed)

1. Publish contract 1.5, then redeploy the employee app and confirm the snapshot stays readable.
2. Put an old employee deployment in front of a 1.5 snapshot and record `SNAPSHOT_CONTRACT_UNSUPPORTED`.
3. Follow the runbook order in DEV and record each step, execution ID and deployment version.
4. Open the snapshot sheet and confirm `completedAt` is text, not a serial number.

## 9. Performance results

The dual-contract reader parses only the active slot and only the selected contract's tables; the cost is identical
to the single-contract reader (three `PUBLISHED_*` reads per snapshot open, unchanged).

## 10. Security review

No new scope, property or entrypoint; the employee project stays read-only and the allowlisted DTOs are unchanged.
A mixed or unknown contract fails closed rather than being interpreted, which keeps the "never read an older
contract as the new one" rule (AGENTS.md rule 65) intact.

## 11. Problems found

- The test that fabricated a 1.4 snapshot spliced the header array twice (row 0 is the header), which removed two
  columns per field; the helper now shifts the header once.
- `dashboardProject` takes a project id, not an object; the test was written against the wrong signature first.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

The DEV migration, the deployment versions and the real snapshot workbook are **BLOCKED** (nothing was deployed,
migrated, triggered or published in this session).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
