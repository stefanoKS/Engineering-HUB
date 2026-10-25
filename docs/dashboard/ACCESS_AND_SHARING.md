# Dashboard access and sharing (V1.2)

**Status: designed and unit-tested locally. Every Google Workspace step below is UNVERIFIED
until it is executed and recorded in [SMOKE_TEST.md](SMOKE_TEST.md).**

## 1. Access model

| Layer | Control | Where it is enforced |
| --- | --- | --- |
| Deployment ACL | Web app published with **Execute as: the deployer** and **Who has access: anyone within `<company domain>`** | Google (deployment settings) |
| OAuth scopes | `spreadsheets.readonly` + `userinfo.email` only | `dashboard-app/appsscript.json`, checked by `npm run validate` |
| Viewer identity (defence in depth) | `SHARED_DASHBOARD_ALLOWED_DOMAIN`, optional `SHARED_DASHBOARD_REQUIRE_EMAIL=true` | `DashboardApp.requireViewer()` |
| Data | Only allowlisted snapshot columns | `SharedDashboardModel`, `DataService.readTable` |
| Data location | Snapshot workbook reachable read-only by the deployment account | Drive sharing |

The primary access control is the **deployment ACL**. `Session.getActiveUser().getEmail()`
is not guaranteed to return the viewer's address for a web app that runs as its deployer,
so the server-side domain check is deliberately best-effort:

- When an address is available, it must match `SHARED_DASHBOARD_ALLOWED_DOMAIN` (if set).
- When no address is available, the page is still served; the deployment ACL is the control.
- Set `SHARED_DASHBOARD_REQUIRE_EMAIL=true` to fail closed instead. Verify in your domain
  whether the address resolves before relying on this.

The viewer address is never returned to the browser. The API returns only `{ok: true|false}`.

## 2. What employees need

| Requirement | Needed? |
| --- | --- |
| Company Google account | **Yes** (deployment ACL) |
| Access to the private management workbook | No |
| Access to the snapshot workbook | No (the deployment account reads it) |
| Apps Script editor access | No |
| GitHub access | No |
| Permission to change automation settings | No |

If a manual fallback is desired, the snapshot workbook may be shared with staff as
**Viewer**. It contains only the sanitized columns, but the web dashboard is the supported
experience; a spreadsheet fallback does not get the Japanese labels, filters or stale-data
banner.

## 3. Deployment account

Use a dedicated, minimally privileged account:

- It reads the **snapshot** workbook and nothing else.
- It should not be an editor of the private management workbook.
- It owns the web app deployment. If it is also the account that runs the manager triggers,
  document that choice; ideally use separate accounts.
- Do not publish with a personal account that may leave the organisation.

## 4. Drive ACLs to configure and record

| Resource | Intended ACL | Verified? |
| --- | --- | --- |
| Snapshot workbook | Deployment account: read (or owner); company staff: no direct access, or Viewer if the fallback is used | UNVERIFIED |
| Private management workbook | Managers/admins only; never the deployment account as editor | UNVERIFIED |
| Backup folder | Restricted (private) — enforced by `Backup.createVerified()` | UNVERIFIED |
| Web app deployment | Domain-restricted, execute as deployer | UNVERIFIED |

`npm test` cannot verify Drive ACLs. Record the actual ACL inspection (who can open each
resource) in the smoke-test record.

## 5. Explicit non-goals

- The dashboard does **not** implement per-user filtering. The same approved portfolio is
  shown to every authorised viewer. Hiding records in the browser would not be security, and
  the published snapshot is a single shared projection.
- The dashboard is **not** an anonymous site. Publishing with "Anyone" access would expose
  the projection to the internet; the manifest is checked to prevent that.
- Hidden HTML, disabled buttons or client-side checks are never used as access control.
