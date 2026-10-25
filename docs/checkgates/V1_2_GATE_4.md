# V1.2 Check Gate 4 — Security and integration

| Field | Value |
| --- | --- |
| Baseline | `cc5b836002146632dbdfdf4f2c292082fb7573db` |
| Branch | `feature/v1.2-shared-dashboard` |
| Date | 2026-10-25 |
| Environment | local (mocked Google services) |
| Result | **PASS (local) / WORKSPACE UNVERIFIED** |

Real Google Workspace access behaviour has **not** been executed. Every live item below is
marked UNVERIFIED and must be recorded in
[dashboard/SMOKE_TEST.md](../dashboard/SMOKE_TEST.md).

## Checklist

| Item | Result | Evidence |
| --- | --- | --- |
| Separate dashboard app deployment exists | PASS (design) / UNVERIFIED (live) | `dashboard-app/appsscript.json` is a standalone web app manifest; `DEPLOYMENT.md` §8 and [dashboard/DEPLOYMENT.md](../dashboard/DEPLOYMENT.md) define a separate clasp target with `rootDir: dashboard-app`. No deployment has been created. |
| Dashboard has no master workbook access | PASS (code) | The only workbook reference is `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`; `npm run validate` rejects the master property name and manager modules; `DataService.openTab()` refuses a workbook containing `PROJECTS`, `MEMBERS` or `AUTOMATION_SETTINGS`. Drive ACL must still be restricted by the operator (UNVERIFIED). |
| External/anonymous access is refused | PASS (manifest) / UNVERIFIED (live) | `webapp.access = "DOMAIN"` and `executeAs = "USER_DEPLOYING"` are asserted by `npm run validate` and `tests/v1_2-release.test.js`. Google's enforcement is untested. |
| Internal employee can open the dashboard | UNVERIFIED | Requires a real deployment and a real employee account. |
| Manager can open the same dashboard | UNVERIFIED | Same portfolio for every authorised viewer by design; requires a live check. |
| A member cannot edit private operational data | PASS (code) | The viewer project has no write path at all (`npm run validate` rejects write APIs; the client exposes no mutation controls; `canEdit` is always `false`). |
| Restricted project information is never returned | PASS | Model/publication filtering tests plus viewer tests (`dashboardProject('P3')` → `NOT_FOUND`, search for a restricted task name returns nothing). |
| All server endpoints are read-only | PASS | Exactly three client-callable functions (`dashboardPortfolio`, `dashboardProject`, `dashboardTask`), asserted in `tests/v1_2-dashboard.test.js`; `DashboardData` exports no mutation verb. |
| Confidential member data is excluded | PASS | E-mail addresses, capacity, position, manager chain, skills and assessments never enter the snapshot or the viewer payload (asserted in model, publication and viewer tests). |

## Access decisions

| Decision | Detail |
| --- | --- |
| Enforcement point | Deployment ACL (`access: DOMAIN`, execute as deployer) is the primary control. |
| Viewer identity | `Session.getActiveUser().getEmail()` is treated as best effort; when present it must match `SHARED_DASHBOARD_ALLOWED_DOMAIN`. `SHARED_DASHBOARD_REQUIRE_EMAIL=true` fails closed when it is absent. Tests cover allowed, refused and unresolved cases. |
| Address exposure | The viewer's address never leaves the server; responses contain no identifier. |
| Scopes | `spreadsheets.readonly` + `userinfo.email`, asserted by validation and the release test. |
| No fake per-user tier | The same approved portfolio is shown to every authorised viewer. Client-side hiding is never presented as security. |
| Deployment account | Documented as minimally privileged (snapshot read only, no master edit). Operationally unverified. |

## Negative tests

- `VIEWER_NOT_ALLOWED` for an out-of-domain account and for an unresolved address when required.
- `DASHBOARD_NOT_CONFIGURED` without the snapshot property.
- `SNAPSHOT_NOT_PUBLISHED`, `SNAPSHOT_UNREADABLE`, `SNAPSHOT_CONTRACT_UNSUPPORTED` for an
  uninitialized, operational-looking or header-tampered snapshot.
- `NOT_FOUND` for a restricted project and for a cross-project task lookup.
- Publication refuses the master workbook, ADMIN is required to enable, and a manager cannot
  enable publication.

## Explicitly unverified (must be closed before any employee use)

| # | Item | Where to record |
| --- | --- | --- |
| 1 | Deployment created with domain access, execute as deployer | SMOKE_TEST A4 |
| 2 | Signed-out and out-of-domain access refused | SMOKE_TEST A5, A6 |
| 3 | Deployment account has no master-workbook edit rights | SMOKE_TEST A7, A8 |
| 4 | Employee and manager can both open the page | SMOKE_TEST C1, C2 |
| 5 | Snapshot Drive sharing matches the documented intent | SMOKE_TEST A8 |

The release status stays **NOT APPROVED FOR PRODUCTION** until these are recorded with
evidence.
