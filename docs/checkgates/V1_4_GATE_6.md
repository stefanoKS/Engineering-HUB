# V1.4 gate 6 — release review and live status

Status: **PASS for the local release review; BLOCKED for Google Workspace verification**

## A. Repository

| Item | Value |
| --- | --- |
| Branch | `main` (no new branch, no pull request) |
| Base commit | `e147e52` (V1.3.1 documentation and installation fix) |
| Commit | the single V1.4 commit on `main` |
| Push | not performed (no credentials in this environment); see the final report |
| Deployment | none. No `clasp push`, no deployment, no trigger installation |
| Data | nothing initialized, migrated, restored or written in Google Workspace |
| Mail | nothing sent; `MailApp` is still only referenced in `src/Notifications.gs` |

## B. Local validation

```text
npm ci            # reproducible install
npm run lint      # clean, no warnings
npm test          # 302 tests / 302 pass / 0 fail / 0 skipped
npm run validate  # 33 manager .gs files, 3 dashboard .gs files, both manifests, 529 keys
npm run preview:dashboard  # static preview built and inspected in a real browser
```

Baseline before V1.4: 257 tests passing. V1.4 adds 45 tests and updates only the assertions that
encode the schema version, the migration list, the backup count, the published counts and the
contract version.

## C. Architecture review

- No new deployment, no new Google Cloud service, no new library, no framework.
- The manager project stays container-bound; the dashboard stays a separate standalone read-only
  web app. `npm run validate` still rejects a spreadsheet write, `MailApp`, `CalendarApp`,
  `ScriptApp`, `UrlFetchApp` or `DriveApp` in the dashboard.
- All rollups go through one helper, so the management dashboard, the Gantt fallback, the workload
  check and the published snapshot cannot disagree.
- Tables are read once per refresh and the hierarchy is built in memory.

## D. Security review

- No `MailApp.sendEmail` outside `src/Notifications.gs`.
- Every new write path (`Responsibilities.*`, `Subprojects.reparent`, `Subprojects.moveTask`,
  `Ui.*`) calls `Access`/`Roles` on the server. A browser-supplied role, actor or owner is data.
- Responsibility ownership is not a project permission; project ownership is unchanged.
- The snapshot publishes only the responsibility label, the hierarchy and the progress; the
  description, the owner, private descriptions, e-mails and logs stay private.
- Destructive APIs remain prohibited in both projects; archiving and retirement never delete rows.
- No secret, spreadsheet ID, calendar ID or employee address was added to the source.

## E. Database integrity review

- Migration 006 is additive and re-verified cell by cell, including formulas and custom columns.
- Stable IDs are never regenerated; `Project_ID`, `Task_ID`, `Original_Deadline`, `Created_At` and
  the migration/audit identifiers stay immutable.
- A repeat run changes nothing and duplicates no column.
- Initialization still refuses a non-empty workbook and is never used to upgrade.

## F. UI/UX review

Structure, colours, contrast and wiring were verified locally (browser rendering of the real
dashboard client and the template harness for the sidebars). See gates 4 and 5. Live sidebar
width, sandbox screen-reader behaviour and real Workspace zoom remain **BLOCKED**.

## BLOCKED — required before production readiness

| Item | Owner action |
| --- | --- |
| Bind the manager script to a development workbook and confirm the 300px sidebar layout and each menu entry | development deployment |
| Run migration 006 against a copy of a V1.3.1 workbook and confirm the backup, `SCHEMA_MIGRATIONS`, `BACKUP_LOG` and `validateSystem()` | development deployment |
| Publish a real snapshot and open the deployed dashboard with a domain account | development deployment |
| Exercise `REQUEST_SUBMISSION_ENABLED` enabled/disabled/unset/failing in the real dashboard project | development deployment |
| Confirm ADMIN / MANAGER / MEMBER / VIEWER behaviour with real Google identities | development deployment |

`docs/PRODUCTION_READINESS.md` remains **NOT APPROVED** until that evidence exists.
