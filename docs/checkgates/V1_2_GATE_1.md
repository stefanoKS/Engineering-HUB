# V1.2 Check Gate 1 — Architecture and data contract

| Field | Value |
| --- | --- |
| Baseline | `cc5b836002146632dbdfdf4f2c292082fb7573db` |
| Branch | `feature/v1.2-shared-dashboard` |
| Date | 2026-10-25 |
| Environment | local (mocked Google services only) |
| Result | **PASS (local)** — live Workspace behaviour UNVERIFIED |

## Scope

Two isolated applications, schema version 4, and an explicit sanitized data contract:

- Manager application (`src/`) unchanged in responsibility; publication services added
  (`src/SharedDashboardModel.gs`, `src/SharedDashboardPublisher.gs`).
- New separate read-only web app in `dashboard-app/` with its own manifest
  (`access: DOMAIN`, `executeAs: USER_DEPLOYING`, `spreadsheets.readonly`).
- Migration `004_shared_dashboard` (3 → 4): `PROJECTS.Dashboard_Visibility`,
  `PROJECTS.Dashboard_Summary`, `TASKS.Public_Note`.

## Checklist

| Item | Result | Evidence |
| --- | --- | --- |
| Existing tests pass | PASS | `npm test`: 148 tests, 148 pass, 0 fail, including all 105 pre-existing V1.0/V1.1 tests. See [V1_2_GATE_5.md](V1_2_GATE_5.md). |
| V4 migration is non-destructive | PASS | `tests/core.test.js` "approved upgrade preserves project, task ownership, skill records and existing cell positions", `tests/gate-c-correctness.test.js`, `tests/gate6-release.test.js` assert every pre-existing cell, formula, custom column and ID after the 3 → 4 step. |
| Manager and dashboard deployments are isolated | PASS (local) | `npm run validate` compiles both projects separately and asserts that `dashboard-app/` contains no manager module, no `SPREADSHEET_ID` property, no write/mail/Calendar/Drive/trigger API. `DEPLOYMENT.md` documents the separate `rootDir` clasp targets. |
| Public snapshot uses allowlisted fields only | PASS | `tests/v1_2-model.test.js` "public DTOs use the explicit allowlist…" compares each DTO key set with `PROJECT_PUBLIC_FIELDS` / `SUBPROJECT_PUBLIC_FIELDS` / `TASK_PUBLIC_FIELDS` / `MILESTONE_PUBLIC_FIELDS`; `tests/v1_2-publisher.test.js` scans the written workbook. |
| Restricted projects are excluded | PASS | `tests/v1_2-model.test.js` covers `RESTRICTED`, blank and unknown values; `tests/v1_2-publisher.test.js` asserts `excluded.projects = 1` and that only `P1` is written. |
| Employees do not need access to the private workbook | PASS (design) / UNVERIFIED (live) | The dashboard project reads only `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`. Drive ACL inspection is a smoke-test step ([dashboard/SMOKE_TEST.md](../dashboard/SMOKE_TEST.md) A7–A8). |
| No private information is exposed through the API | PASS | `tests/v1_2-model.test.js` and `tests/v1_2-publisher.test.js` assert no `@example.test`, no description/criteria/next-action text and no private column names in the payload; `tests/v1_2-dashboard.test.js` asserts the same for viewer responses. |

## Architecture decision record

| Decision | Alternative rejected | Reason |
| --- | --- | --- |
| Sanitized snapshot spreadsheet | Give employees read access to the management workbook | Members would otherwise see e-mail addresses, skills, capacity, logs and every project regardless of visibility. |
| Separate App Sheet copy via A/B slots | Publish into the management workbook | Would mix derived and operational data in one file and risk destructive edits. |
| Explicit DTO allowlist | "Copy all columns, drop the sensitive ones" | A new column would leak by default; an allowlist fails closed. |
| Viewer computes deadlines server-side | Compute in the browser | Keeps Asia/Tokyo arithmetic in one tested place. |
| No per-user filtering | Filter by viewer identity | `Session.getActiveUser()` is unreliable for execute-as-deployer web apps, and hiding rows client-side is not security. |
| Derived aggregates in the snapshot | Ship all tasks with the portfolio | Keeps the initial payload small and bounded. |

## Evidence

```text
npm test          -> tests/v1_2-model.test.js, tests/v1_2-publisher.test.js, tests/v1_2-dashboard.test.js
npm run validate  -> validates 31 manager files, 2 dashboard files, both manifests
```

## Not verified here

Deployment ACLs, Drive sharing, OAuth consent, real payload size and any Workspace restriction.
All remain UNVERIFIED in [docs/PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md).
