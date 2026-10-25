# Request inbox deployment (V1.3)

The request inbox is a **third, separate spreadsheet**. Employees never touch the private
management workbook and the dashboard deployment never receives its ID. For a first
installation follow [PRE_TRIAL_CHECKLIST.md](PRE_TRIAL_CHECKLIST.md) steps 17–22; this page is
the reference chapter.

The management workbook, the published snapshot and the inbox must be **three different files**.
The manager application refuses the master workbook as an inbox, and the dashboard cannot open
the master at all.

```
dashboard-app (web app, domain-restricted)
   reads  : sanitized snapshot workbook           SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID
   appends: request inbox workbook                REQUEST_INBOX_SPREADSHEET_ID

manager application (container-bound)
   reads  : private management workbook           SPREADSHEET_ID
   imports: request inbox workbook                REQUEST_INBOX_SPREADSHEET_ID
   writes : private management workbook only
```

## 1. Create the spreadsheet

1. Create a new Google Sheets file, for example `設計・開発課 管理 - 申請受信箱`.
2. Share it only with the deployment accounts that need it. Do not share it with every
   employee: employees submit through the web app, not the file.
3. Do not reuse the private management workbook or the published snapshot workbook.

## 2. Configure Script Properties

Manager project (`src/`):

| Property | Value |
| --- | --- |
| `REQUEST_INBOX_SPREADSHEET_ID` | inbox spreadsheet ID |

Dashboard project (`dashboard-app/`):

| Property | Value |
| --- | --- |
| `REQUEST_INBOX_SPREADSHEET_ID` | same inbox spreadsheet ID |
| `REQUEST_SUBMISSION_ENABLED` | **`true` to accept submissions**. Since V1.3.1 anything other than an explicit `true` (including an unset property) keeps submissions closed, and the dashboard shows the request form as unavailable. |
| `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` | unchanged (read-only snapshot) |
| `SHARED_DASHBOARD_ALLOWED_DOMAIN` | unchanged |

Never commit these values. They are not returned to any browser.

The configured inbox and the user-visible state always agree: `requestSubmissionConfig()` in
the dashboard project reports `{enabled:false}` until the property is exactly `true`, and the
submission functions fail with `REQUEST_DISABLED` rather than silently accepting a row.

## 3. Initialise the sheet layout

As an administrator with a verified account, add this temporary wrapper to the **manager**
project and run it once (the editor Run button cannot pass arguments):

```javascript
function initializeInboxFromEditor() {
  return initializeRequestInbox('INITIALIZE REQUEST INBOX');
}
```

This creates the `REQUESTS` sheet with the exact header contract, refuses content that already
exists, refuses the management workbook, and writes an audit row. Delete the wrapper afterwards.
The header is:

```
Request_ID, Request_Type, Task_ID, Project_ID, Requester_Name, Submitted_At,
Current_Due_Date, Requested_Due_Date, Reason, Explanation, Completion_Note,
Task_Revision, Snapshot_Version, Client_Token, Inbox_State
```

Both applications validate the header and fail closed if it drifts.

## 4. OAuth scopes

The dashboard project gains `https://www.googleapis.com/auth/spreadsheets` (it needs to
append a row) and keeps `userinfo.email`. It has no Drive, Gmail, Calendar or trigger
scope. `npm run validate` rejects any other scope, any structural write
(`insertSheet`, `setFormula`, `delete…`) and any write outside
`dashboard-app/RequestService.gs`.

Re-authorise the dashboard deployment after changing the scopes, and re-check the
deployment:

* Execute as: **the deploying account**
* Who has access: **the Workspace domain** (never "Anyone" / "Anyone with the link")

## 5. Review after enabling write access

Because the dashboard can now write one row per submission, confirm:

1. The web app is still domain-restricted; anonymous access would allow anyone to append.
2. The inbox spreadsheet is not shared broadly.
3. The request rate limit and duplicate guard are in place (they are always on).
4. `npm run validate` passes and the dashboard manifest lists exactly two scopes.
5. The inbox contains only `REQUESTS` data the manager expects.

## 6. Operations

| Task | How |
| --- | --- |
| Import new requests | manager sidebar **申請一覧**: opening the screen imports automatically; **申請を取り込む** retries manually; `importRequestInbox()` is the same import |
| Review and decide | manager sidebar **申請一覧 / 承認待ち** |
| Close submissions temporarily | set `REQUEST_SUBMISSION_ENABLED=false` (or delete the property) in the dashboard project |
| Re-open submissions | set `REQUEST_SUBMISSION_ENABLED=true` in the dashboard project |
| Inspect a worker's receipt | `requestSubmissionStatus('<request id>')` in the dashboard project |

The import is serialized with the script lock and keyed by the inbox `Request_ID`, so two
managers opening the queue at the same moment cannot create a duplicate request row. When the
inbox cannot be read, the sidebar shows a warning and keeps listing the requests that were
already imported; it never claims the import succeeded.

The inbox is append-only from the dashboard side. The manager application only writes the
`Inbox_State` cell to mirror a decision; it never deletes or rewrites request content.

## 7. Limitations

* Delivery between the two projects is eventually consistent: an inbox row is only visible
  to managers after an import.
* Exactly-once *mail* delivery is not promised; the decision itself is applied at most once.
* Local tests use mocks and do not prove Workspace behaviour. Record live verification in
  [`docs/checkgates/V1_3_GATE_7.md`](checkgates/V1_3_GATE_7.md) before relying on it in
  production.
