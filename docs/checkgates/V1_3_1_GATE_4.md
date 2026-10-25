# V1.3.1 Gate 4 — Safety and trial configuration

Scope: a focused review of the existing implementation. No architecture change was made.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

### A. Database

| Check | Result | Evidence |
| --- | --- | --- |
| Existing operational tables are never cleared | PASS | `npm run validate` rejects destructive APIs; only `Database.writeGenerated` clears a generated sheet |
| Schema migration 005 remains non-destructive | PASS | `Migrations.registry` add-only; `verifyPreserved` compares every pre-existing cell and formula |
| Existing data is retained during upgrades | PASS | `tests/core.test.js`, `tests/gate-c-test` preservation suites unchanged and passing |
| Unknown custom columns and formulas are preserved | PASS | `Database.update` writes only the supplied columns |
| IDs remain stable | PASS | `Database.update` rejects an id change; V1.3.1 never recreates a record |
| Initialization still refuses populated workbooks | PASS | `initializeNewDatabase` guard unchanged and tested |
| Backups remain mandatory for migrations | PASS | `Migrations.upgrade` calls `Backup.create()` before any write |

### B. Email

| Check | Result | Evidence |
| --- | --- | --- |
| Default email mode is OFF | PASS | `Notifications.effectiveStatus().mode === 'OFF'` asserted in `tests/v1_3_1-stabilization.test.js` |
| PREVIEW sends no real mail | PASS | Existing OFF/PREVIEW/LIVE matrix suites |
| LIVE requires the existing approval/preflight | PASS | Unchanged `Notifications` gate |
| Emergency stop works | PASS | Existing automation suites |
| No notification is sent because code changed | PASS | 5 files were edited; no send path runs on load |
| No old assignment is re-sent | PASS | Ledger and dedupe keys unchanged |
| Worker request import cannot bypass mail controls | PASS | `notifyRequestSubmitted` still goes through `Notifications.gs`; import succeeds even if mail fails |
| Editing a project or task sends no mail | PASS | test "project edits send no mail and never touch another project" (`app.sentEmails.length === 0`) |

### C. Dashboard

| Check | Result | Evidence |
| --- | --- | --- |
| Snapshot stays separate from the master workbook | PASS | `assertSnapshotDestination`; publication refuses the master |
| Only `INTERNAL` projects are published | PASS | test "a new project stays hidden until a manager publishes it deliberately" |
| Restricted records are excluded | PASS | `SharedDashboardModel.build` exclusions |
| Publication OFF remains OFF | PASS | Scheduled publication returns `PUBLICATION_DISABLED`; manual publication is a separate, explicit manager action |
| Failed publication preserves the previous snapshot | PASS | A/B commit + `verifySlot`; existing `tests/v1_2-publisher.test.js` |
| Snapshot contract compatibility | PASS | Contract `1.3` unchanged |
| Dashboard shows the last-published time | PASS | `PUBLISHED_META` / `最終同期` unchanged |

### D. Requests

| Check | Result | Evidence |
| --- | --- | --- |
| Request inbox stays separate | PASS | `Requests.openInbox` refuses the master workbook |
| The dashboard cannot modify the master database | PASS | `npm run validate` rejects manager modules in `dashboard-app/` |
| Request submissions validate the target task | PASS | `RequestService` validates against the published snapshot |
| Duplicate-request controls remain | PASS | Unchanged rate limit / duplicate guard + new lock in the import |
| Completion/extension changes require manager approval | PASS | `Requests.decide` |

### E. Access

| Check | Result | Evidence |
| --- | --- | --- |
| No new login/password system | PASS | test "no login, password or browser write path was introduced" |
| Existing domain restrictions remain | PASS | `SHARED_DASHBOARD_ALLOWED_DOMAIN` + `access: DOMAIN` unchanged |
| The dashboard is not public/anonymous | PASS | Deployment guidance unchanged; `validate` requires `access: DOMAIN` |
| Employee viewers get no master workbook access | PASS | Dashboard holds only the snapshot/inbox ids |
| No claim of a factory LAN-only deployment | PASS | Documentation unchanged on this point |

### F. Trial safety

| Check | Result | Evidence |
| --- | --- | --- |
| `REQUEST_SUBMISSION_ENABLED` is explicitly OFF until enabled | PASS (changed) | `dashboard-app/RequestService.gs`: `enabled()` now requires the exact value `true`, so a configured inbox alone accepts nothing |
| Configuration and user-visible state match | PASS | `requestSubmissionConfig()` returns the same `enabled` value the page renders; a disabled submission fails with `REQUEST_DISABLED` |
| Production settings are not changed | PASS | Only repository files were edited; no deployment, Script Property or spreadsheet was touched |

## Evidence

* `npm test` — 254 pass.
* `npm run lint` / `npm run validate` — pass.
* `git status` — working-tree changes only; no commit, no push, no deployment.

## Notes and limits

The V1.3.1 change to `REQUEST_SUBMISSION_ENABLED` is a deliberate safety tightening: an
operator must now set `true` explicitly (see `docs/REQUEST_INBOX_DEPLOYMENT.md`). A trial
that previously relied on the implicit default must add the property.
