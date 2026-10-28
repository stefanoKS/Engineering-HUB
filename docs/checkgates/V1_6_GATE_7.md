# V1.6 gate 7 — Safe deletion

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: sealed in the delivery header (see §13)

## 1. Objective

Let an ADMIN remove a genuinely mistaken, empty project/subproject/task while archive stays the default and no
operational history can be destroyed.

## 2. Relevant source files

`src/Deletion.gs` (preflight, dependency scan, tombstone, row removal), `src/ManagerWebApi.gs`
(`projectDelete`/`subprojectDelete`/`taskDelete`, ADMIN + confirmation + revision), `src/ManagerWeb.gs`
(`deletion` read operation), `src/ManagerWebClient.html` (dependency panel, reason, typed confirmation),
`scripts/validate-source.js` (single reviewed destructive exception), `AGENTS.md` rule 78.

## 3. Required functionality

1. Archive remains the default removal and keeps every row.
2. Permanent deletion: ADMIN only, empty dependency preflight, exact `DELETE <id>` confirmation, required reason,
   verified backup, script lock, immutable `RECORD_DELETED` tombstone.
3. Dependent records, audit history, effort, progress, completion, approvals, notifications, dependencies,
   published visibility and archived rows refuse deletion.
4. Optional cascade only when every descendant independently passes the same checks.
5. A deleted ID is never reused; the next publication excludes the record; the committed snapshot is untouched.

## 4. Acceptance criteria

- A safe empty record is removed and a tombstone exists.
- Any history-linked record is refused with the archive alternative named.
- Non-ADMIN, missing reason or wrong confirmation are refused before any write.
- Headers, formulas, custom columns and unrelated rows survive.

## 5. Automated test cases

`tests/v1_6-deletion.test.js` (history refusal, empty removal + backup + tombstone, confirmation/reason,
non-ADMIN, project cascade, published/archived refusal, dependency summary, ID reuse, manager-web action,
role spoofing), `tests/core.test.js` (no sheet-reset API elsewhere), `tests/v1_6-release.test.js`
(single reviewed destructive surface).

## 6. Actual test results

PASS locally. `tests/mocks/google.js` gained a faithful `deleteRow` so the reviewed path can be exercised offline;
no other module may call a destructive Sheets API (`npm run validate` enforces it).

## 7. Manual test cases (DEV, not executed)

1. Create an empty project by mistake, then delete it as ADMIN with the typed confirmation; confirm the backup
   reference and the audit row.
2. Try the same on a project with tasks: refused, archive offered.
3. Try as MANAGER: refused.
4. Publish; confirm the deleted record is gone from the new snapshot and the old one stayed readable beforehand.

## 8. Performance results

Deletion is an occasional ADMIN action; the preflight reads are bounded and use the existing read context.

## 9. Security review

Documented narrow exception to rules 25/59 (AGENTS.md rule 78). `validate-source.js` allows exactly one
`deleteRow` call, in `Deletion.gs`, and still rejects every other destructive API in every other module. The
browser cannot supply authority: ADMIN, confirmation, reason and revision are verified server-side.

## 10. Problems found

Cascade initially refused every child because the children referenced each other. The preflight now ignores only
references to records that are being removed in the same operation.

## 11. Corrective actions

`blockingOutside` added; dependency lists are also reported for `Dependency_IDs`, which is not a declared ref.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live deletion and republication are **BLOCKED** (no DEV workbook). The Sheets limitation is documented: the row
removal is one write and the tombstone is a second, non-transactional write whose failure is logged and reported.

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA sealed in the delivery commit.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
