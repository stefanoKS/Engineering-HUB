# Shared dashboard smoke test (V1.2)

Record the environment, date, operator and evidence for each item. Every row starts as
**UNVERIFIED**. Local `npm test` results are **not** evidence for any item here.

Environment: `DEVELOPMENT` only. Never run this against production data.

## A. Deployment and isolation

| # | Check | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| A1 | Dashboard project exists and is separate from the manager project | Two different script IDs | UNVERIFIED | |
| A2 | `clasp push` used `rootDir: dashboard-app` for the dashboard project and `rootDir: src` for the manager project | No manager file in the dashboard project | UNVERIFIED | |
| A3 | Dashboard project Script Properties contain no `SPREADSHEET_ID` | Only `SHARED_DASHBOARD_*` keys | UNVERIFIED | |
| A4 | Web app deployment: Execute as deployer, access = company domain | Deployment dialog matches | UNVERIFIED | |
| A5 | Opening the URL from a signed-out/incognito window is refused | Google sign-in page or access denied | UNVERIFIED | |
| A6 | Opening the URL from outside the domain is refused | Access denied | UNVERIFIED | |
| A7 | The deployment account has no edit access to the management workbook | Drive sharing inspection | UNVERIFIED | |
| A8 | The deployment account can read only the snapshot workbook | Drive sharing inspection | UNVERIFIED | |

## B. Snapshot lifecycle

| # | Check | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| B1 | `initializeSharedDashboardSnapshot` on an empty, configured workbook | Returns `initialized: true` | UNVERIFIED | |
| B2 | Initialization on a workbook with any content | Refused | UNVERIFIED | |
| B3 | Setting the destination to the management workbook | Refused before any write | UNVERIFIED | |
| B4 | `publishSharedDashboard()` with all projects `RESTRICTED`/blank | Published, `PROJECT_COUNT = 0` | UNVERIFIED | |
| B5 | One project set to `INTERNAL`, republished | Project appears in `PUBLISHED_PROJECTS_*` | UNVERIFIED | |
| B6 | Second publication immediately after | Version increments, active slot flips A→B, previous slot still readable | UNVERIFIED | |
| B7 | `PUBLISHED_META.SNAPSHOT_VERSION` / `PUBLISHED_AT` / `CONTENT_HASH` | Consistent with the status output | UNVERIFIED | |
| B8 | Scan the snapshot for e-mail addresses and private text | None found | UNVERIFIED | |
| B9 | Manager workbook unchanged after publication | Spot-check a project, task, formula and custom column | UNVERIFIED | |

## C. Viewer behaviour

| # | Check | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| C1 | Employee account opens the dashboard | Portfolio renders in Japanese | UNVERIFIED | |
| C2 | Manager account opens the same dashboard | Same portfolio | UNVERIFIED | |
| C3 | Restricted project | Not visible in list, search or direct URL parameters | UNVERIFIED | |
| C4 | `最終同期` line | Shows the last publication time (JST) | UNVERIFIED | |
| C5 | Stop publishing for longer than `SHARED_DASHBOARD_STALE_HOURS` | Stale-data banner appears | UNVERIFIED | |
| C6 | Project detail | Subproject groups, 全体タスク, counts, milestones | UNVERIFIED | |
| C7 | Task detail drawer | Title, ID, project, subproject, owner, status, priority, dates, 残り, 進捗, public note | UNVERIFIED | |
| C8 | Done / due today / overdue / no due date tasks | 完了 / 本日期限 / X日超過 / 期限未設定 | UNVERIFIED | |
| C9 | Search with a project name, a project ID and a task name | Matching projects only | UNVERIFIED | |
| C10 | Filters combined with search | Consistent narrowing, no stale results | UNVERIFIED | |
| C11 | Rapidly select different projects | No flicker of a previous project's data | UNVERIFIED | |
| C12 | Smartphone width (≈375 px) via device emulation | Cards instead of table columns, usable tap targets | UNVERIFIED | |
| C13 | Keyboard only | Tab reaches search, filters, cards; Escape closes the drawer; focus returns | UNVERIFIED | |
| C14 | No write controls anywhere | No edit/save/delete/assign buttons | UNVERIFIED | |
| C15 | Response payload in the browser network/console trace | No task rows on initial load, no e-mail addresses | UNVERIFIED | |

## D. Failure handling

| # | Check | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| D1 | Dashboard project with no snapshot property | Friendly "not configured" message | UNVERIFIED | |
| D2 | Invalid snapshot ID | Friendly error, no stack trace | UNVERIFIED | |
| D3 | Destination with a mismatched contract version | "format not supported" message | UNVERIFIED | |
| D4 | Simulated publication failure (revoke the deployment account's read access temporarily) | Previous snapshot still readable; failure recorded in `AUTOMATION_SETTINGS` and `AUDIT_LOG` | UNVERIFIED | |
| D5 | Publication disabled | Scheduled trigger performs no write; manual publish still works | UNVERIFIED | |

## E. Sign-off

| Role | Name | Decision | Date | Evidence location |
| --- | --- | --- | --- | --- |
| Deployment owner | _not assigned_ | — | — | |
| Reviewer | _not assigned_ | — | — | |

Completing this checklist updates [../PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md)
evidence only when the recorded results and screenshots are attached. Passing local tests
never changes the release status.

## V1.3 smoke test

1. Open the dashboard in a company account: the title and heading read `設計・開発課 管理`.
2. Switch to English and back: every label changes, the open project stays open and project
   and task names remain exactly as stored.
3. Open a published task and submit a deadline change with a different date and a reason.
   A request ID is shown; the deadline on the dashboard does not change.
4. Submit a completion report for another task.
5. In the manager application open **申請一覧**, import, and approve the deadline change.
   Confirm the task deadline changed once, the planned start recalculated and the deadline
   history contains one row.
6. Reject the completion report and confirm the task stays open.
7. Re-open the dashboard after the next publication: the approved deadline is visible and a
   pending request shows only the `納期変更申請中` badge.
8. Record the result in `docs/checkgates/V1_3_GATE_7.md`. Nothing here is verified until it
   has actually been run.

