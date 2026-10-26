# 試験運用前チェックリスト / Pre-trial checklist (V1.3.1)

This is the **primary first-time installation guide** for Engineering-HUB **設計・開発課 管理**.
It installs a Google Workspace **DEVELOPMENT** trial. `DEPLOYMENT.md`,
`docs/dashboard/DEPLOYMENT.md` and `docs/REQUEST_INBOX_DEPLOYMENT.md` are the reference
chapters for each area; where they differ, follow this checklist.

Three situations must not be mixed:

| Situation | Use | Never |
| --- | --- | --- |
| **New DEV installation** (empty workbook) | This checklist, steps 1–27 | migrations, production IDs |
| **Existing database upgrade** | [DEPLOYMENT.md §8.7](../DEPLOYMENT.md) + `upgradeExistingDatabase()` | `initializeNewDatabase`, re-seeding members |
| **Production deployment** | [DEPLOYMENT.md §5–8](../DEPLOYMENT.md) after the DEV trial is signed off | reusing DEV IDs, "Anyone" web-app access |

First-trial safety defaults: **e-mail OFF**, **Calendar OFF**, **scheduled publication OFF**,
**worker request submission OFF** until step 18, and no production resource touched.

Read the rules first: [AGENTS.md](../AGENTS.md).

## What you need

| Item | Detail |
| --- | --- |
| Google Workspace edition | Business/Enterprise with Apps Script, Sheets and Drive. Personal `@gmail.com` accounts cannot use the `access: DOMAIN` web app deployment. |
| Accounts | One **operator** account that owns the Apps Script projects and the Drive folders, plus one **manager** and one **employee** test account inside the same domain. |
| Local tools | Node.js **22.13 or newer**, `npm`, `git`, and optionally `clasp` (`npm run clasp -- --version`). |
| Browser | Chrome. The manager sidebars only render inside the bound spreadsheet. |
| Time | About 60–90 minutes for a first installation. |

Two separate Apps Script projects and three separate spreadsheets are required. Never merge
them.

| Resource | Purpose | Who can open it |
| --- | --- | --- |
| Spreadsheet A — private management database | Operational data (`PROJECTS`, `TASKS`, `MEMBERS`, …) | Managers only |
| Spreadsheet B — sanitized snapshot | Published, allowlisted dashboard data | Deployment account only |
| Spreadsheet C — restricted request inbox | Appended employee requests | Deployment account only |
| Project 1 — manager (container-bound to A) | Sidebars, domain services, automation, publication | Managers (by spreadsheet access) |
| Project 2 — shared dashboard (standalone web app) | Read-only employee dashboard + request form | Everyone in the domain |

---

## 1. Google Workspace prerequisites

Google Workspace (not a personal account), Apps Script enabled, and Drive available to the
operator. Confirm the Apps Script admin setting allows **web apps deployed to the domain**
(`Apps Script → Settings → Web app access`) together with your organisation's Drive sharing
policy. Nothing in this repository changes those settings for you.

## 2. Required Drive folders

1. In Drive, create `EH-DEV` (folder for this trial).
2. Inside it create `EH-DEV-BACKUP` and share it **only** with the operator and the deployment
   account. Backups are written there by `createDatabaseBackup()`.
3. Copy the folder ID from the URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`.

## 3. Create the three development spreadsheets

Create all three in `EH-DEV`. They must be empty for a new installation.

| # | Name suggestion | Never |
| --- | --- | --- |
| A | `設計・開発課 管理 - DEV DB` | never used as the snapshot or the inbox |
| B | `設計・開発課 管理 - DEV 共有ダッシュボード` | never used as the database |
| C | `設計・開発課 管理 - DEV 申請受信箱` | never shared with employees |

A, B and C must be **three different files**: publication refuses the management workbook as a
destination, and the inbox refuses the management workbook as well. Creating one spreadsheet and
"reusing" it for another role is the most common installation mistake.

## 4. Create the two Apps Script projects

| # | Kind | How to create |
| --- | --- | --- |
| 1 | Container-bound manager project | Open spreadsheet A → **Extensions → Apps Script**. Rename it `EH-管理-DEV`. |
| 2 | Standalone dashboard project | <https://script.google.com/home> → **New project**, rename `EH-ダッシュボード-DEV`. |

Do not create the dashboard as a bound script, do not push `src/` into it, and never upload both
applications into the same Apps Script project (step 7 selects the target through `rootDir`).

## 5. Obtain spreadsheet IDs

For each spreadsheet: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.
Record A, B and C in a scratch note (never in the repository).

## 6. Obtain script IDs

* Manager project: Apps Script editor → **Project Settings (⚙)** → *IDs* → **Script ID**, or
  from the editor URL `.../projects/<SCRIPT_ID>/edit`.
* Dashboard project: same.

## 7. Local clasp configuration

Two Apps Script projects means two clasp targets. `.clasp.json` is git-ignored (`.gitignore`
covers `.clasp.json` and `.clasp.*.json`) and stays local; the repository deliberately ships no
example clasp file.

The **active** `.clasp.json` in the repository root decides which project the next
`npx clasp push` updates. Keep one named file per target and copy the one you want over
`.clasp.json` before every push.

| Target | `rootDir` | Contents |
| --- | --- | --- |
| Manager (container-bound) | `src` | `src/*.gs`, `src/*.html`, `src/appsscript.json` |
| Shared dashboard (standalone) | `dashboard-app` | `dashboard-app/*.gs`, `dashboard-app/*.html`, `dashboard-app/appsscript.json` |

```powershell
Set-Location C:\Users\<you>\Documents\Engineering-HUB
npm ci

# 1. Manager target (rootDir = src). Never use "." here.
@'
{ "scriptId": "MANAGER_DEV_SCRIPT_ID", "rootDir": "src" }
'@ | Set-Content -Encoding ascii .clasp.manager-dev.json

# 2. Dashboard target (rootDir = dashboard-app)
@'
{ "scriptId": "DASHBOARD_DEV_SCRIPT_ID", "rootDir": "dashboard-app" }
'@ | Set-Content -Encoding ascii .clasp.dashboard-dev.json

# 3. Push the manager project
Copy-Item .clasp.manager-dev.json .clasp.json -Force
Get-Content .clasp.json                # rootDir must read "src"
npx clasp login                        # once per machine
npx clasp status                       # lists the files about to be uploaded
npx clasp push

# 4. Push the dashboard project
Copy-Item .clasp.dashboard-dev.json .clasp.json -Force
Get-Content .clasp.json                # rootDir must read "dashboard-app"
npx clasp status                       # only dashboard-app files may appear
npx clasp push
```

Rules that prevent the usual installation failure:

* `rootDir: "src"` for the manager project; **never** `"."`. With `"."` clasp would expose
  both `src/` and `dashboard-app/` (each contains `appsscript.json` and `I18n.html`), so the
  upload either fails or mixes the two applications into one project.
* Never upload both applications into the same Apps Script project. The manager project is
  container-bound to spreadsheet A; the dashboard project is standalone.
* Replace `MANAGER_DEV_SCRIPT_ID` / `DASHBOARD_DEV_SCRIPT_ID` with the real script IDs from
  step 6 and never commit them.
* Read the `rootDir` line printed by `Get-Content .clasp.json` before each `clasp push`.
  `clasp status` is the last check: it must list only the expected source files.
* `npm run clasp -- push` is equivalent to `npx clasp push` if you prefer the npm script.
* If PowerShell blocks `npx` (execution policy), use `npx.cmd clasp ...` or `npm run clasp -- ...`.
* `clasp push` uploads code only. It does not set Script Properties, initialize data,
  authorize scopes, or deploy the web app.

## 8. Required Script Properties for each project

**Manager project (bound to spreadsheet A)** — *Project Settings → Script Properties*:

| Property | Value for the trial |
| --- | --- |
| `ENVIRONMENT` | `DEVELOPMENT` |
| `BOUND_ENVIRONMENT` | `DEVELOPMENT` (must equal `ENVIRONMENT`) |
| `SPREADSHEET_ID` | spreadsheet **A** ID |
| `INITIALIZATION_SPREADSHEET_ID` | spreadsheet **A** ID — only while initializing, remove afterwards |
| `BACKUP_FOLDER_ID` | `EH-DEV-BACKUP` folder ID |
| `ALLOWED_RECIPIENT_DOMAINS` | **your real Workspace domain** (e.g. `example.co.jp`) or empty. A member e-mail whose domain is not listed is refused, so `example.test` would block step 10. |
| `MAX_EMAILS_PER_RUN` | `1` while testing |
| `EMAIL_ENABLED` / `DRY_RUN` | `false` / `true` — leave at the defaults |
| `ADMIN_BOOTSTRAP_ALLOWLIST` | the operator e-mail address (remove after the bootstrap) |
| `APPROVED_MIGRATIONS` | empty for a new installation |
| `CALENDAR_ENABLED` / `CALENDAR_ID` | `false` / empty |
| `REQUEST_INBOX_SPREADSHEET_ID` | spreadsheet **C** ID |
| `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` | spreadsheet **B** ID |
| `ALLOW_MEMBER_SELF_SERVICE` | leave unset (managers only) |

**Dashboard project (standalone)** — *Project Settings → Script Properties*:

| Property | Value for the trial |
| --- | --- |
| `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` | spreadsheet **B** ID |
| `SHARED_DASHBOARD_ALLOWED_DOMAIN` | your Workspace domain, e.g. `example.co.jp` |
| `SHARED_DASHBOARD_REQUIRE_EMAIL` | **leave unset for the trial** — see the warning below |
| `SHARED_DASHBOARD_STALE_HOURS` | optional, default `24` |
| `REQUEST_INBOX_SPREADSHEET_ID` | spreadsheet **C** ID |
| `REQUEST_SUBMISSION_ENABLED` | leave **unset** until step 18 |

Never place a spreadsheet ID into source code or documentation. The sidebars never display
these values.

> **Viewer e-mail caution.** The web app runs as its **deploying account**, so
> `Session.getActiveUser().getEmail()` may legitimately return an empty address for an employee
> viewer. The primary access control is the deployment ACL (**Who has access: anyone within your
> domain**), not the e-mail check. `SHARED_DASHBOARD_REQUIRE_EMAIL=true` fails closed, so enabling
> it before you have verified that the address actually resolves can lock legitimate employees
> out of the dashboard. Enable it only after step 16.4 has proved the address resolves for an
> employee account, and remove the property again if it blocks access. Never widen the
> deployment to "Anyone" as a workaround.

## 9. First database initialization (new DEV installation only)

The Apps Script **Run** button cannot pass arguments, so a one-off editor wrapper is required.
Paste this at the end of `src/Main.gs` (or any `src/*.gs` file) in the manager project, save,
and run it with the **Run** button:

```javascript
function initializeDevelopmentFromEditor() {
  var id = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID');
  return initializeNewDatabase('INITIALIZE ' + id);
}
```

Before running:

1. `SPREADSHEET_ID` and `INITIALIZATION_SPREADSHEET_ID` must both hold spreadsheet **A**'s ID.
   `initializeNewDatabase` refuses the run when they differ, because that mismatch is how a
   wrong workbook gets initialized.
2. Spreadsheet **A** must contain no value and no formula in any sheet.
3. `ENVIRONMENT` and `BOUND_ENVIRONMENT` must both be `DEVELOPMENT`.

Run it once and approve the OAuth consent for the operator account. On success it:

* sets the spreadsheet time zone to `Asia/Tokyo`,
* creates the schema tables and automation defaults,
* writes `SETTINGS` = `DATABASE_ENVIRONMENT / DEVELOPMENT`,
* writes `SCHEMA_MIGRATIONS` = `INITIALIZE_V6` (schema version **6**),
* deletes `INITIALIZATION_SPREADSHEET_ID` automatically,
* returns `6`.

A fresh V1.4 workbook is created at schema **6**, so it never records `006_responsibilities_and_nested_subprojects`.
That migration only upgrades an existing V5 workbook.

Then:

4. Delete `initializeDevelopmentFromEditor` from the source before the next `clasp push`.
5. Reload spreadsheet **A**; the menu **設計・開発課 管理** appears (via `onOpen`).
6. Never rerun initialization. It is refused against any workbook that already holds data or
   formulas, and it is never the tool for an existing database — use the migration path below.

**Existing database instead?** Do not create or run this wrapper. Take a verified backup, list
only reviewed IDs in `APPROVED_MIGRATIONS` and run `upgradeExistingDatabase()` from an editor
wrapper:

* V1.3.1 (schema 5) → V1.4: approve exactly `006_responsibilities_and_nested_subprojects`.
* V1.2 (schema 4) → V1.4: approve `005_task_planning_and_requests,006_responsibilities_and_nested_subprojects`.
* V1.1 (schema 3) → V1.4: approve `004_shared_dashboard,005_task_planning_and_requests,006_responsibilities_and_nested_subprojects`.

Each approved step takes its own verified backup. See [DEPLOYMENT.md §8.7](../DEPLOYMENT.md).

## 10. Create the first operator member and bootstrap ADMIN

A `MEMBERS` row needs a real `Member_ID`; do not hand-type a row with only Name/Email/Active.
The first member is created through `Members.create`, which generates `MEMBER_<uuid>`.

**10a. Create the operator member** (temporary editor wrapper, new empty DEV database only):

```javascript
function createFirstOperatorFromEditor() {
  var email = String(
    Session.getActiveUser().getEmail() || ''
  ).trim().toLowerCase();

  if (!email) throw new Error('Operator email unavailable');

  var allowed = String(
    PropertiesService.getScriptProperties()
      .getProperty('ADMIN_BOOTSTRAP_ALLOWLIST') || ''
  ).toLowerCase().split(',').map(function (x) {
    return x.trim();
  });

  if (allowed.indexOf(email) < 0) {
    throw new Error('Operator not on bootstrap allowlist');
  }

  if (Database.read('MEMBERS').length !== 0) {
    throw new Error('Members already exist; do not seed twice');
  }

  var member = Members.create({
    Name: 'DEV Operator',
    Email: email,
    Active: true,
    Role: 'MEMBER'
  });

  return {memberId: member.Member_ID, email: member.Email};
}
```

It needs `ENVIRONMENT`, `BOUND_ENVIRONMENT` and `SPREADSHEET_ID` (already set in step 8), the
operator address in `ADMIN_BOOTSTRAP_ALLOWLIST`, and a domain that `ALLOWED_RECIPIENT_DOMAINS`
accepts. It refuses to run when any member row already exists, so it cannot seed a second time.

**10b. Verify the generated row** before bootstrapping. Open spreadsheet **A** → `MEMBERS` and
confirm exactly one row with a generated `Member_ID` (for example `MEMBER_1a2b…`), your e-mail,
`Active = TRUE`, `Role = MEMBER`.

**10c. Bootstrap the administrator** (temporary editor wrapper):

```javascript
function bootstrapFromEditor() {
  var email = String(
    Session.getActiveUser().getEmail() || ''
  ).trim().toLowerCase();

  if (!email) throw new Error('Operator email unavailable');

  return bootstrapFirstAdministrator(
    email,
    'BOOTSTRAP ADMIN ' + email
  );
}
```

It requires the active member row above, the allowlist entry, an initialized workbook at the
current schema, no active administrator and no notification history. It is one-time and audited
(`ADMIN_BOOTSTRAPPED`); the member row becomes `Role = ADMIN`.

**10d. Clean up.** Remove the address from `ADMIN_BOOTSTRAP_ALLOWLIST` and delete both temporary
wrappers (`createFirstOperatorFromEditor`, `bootstrapFromEditor`) before the next
`clasp push`. Never run either wrapper against an existing operational system — the member
wrapper refuses a non-empty `MEMBERS` table and the bootstrap refuses an already-bootstrapped
workbook, but do not rely on that as an upgrade path.

**10e. Check the UI.** Open **設計・開発課 管理 → ダッシュボード**; the sidebar shows your e-mail
and `ADMIN`.

## 11. Register an employee

Manager sidebar → **メンバー** panel:

1. `氏名` = employee name, `メール` = the employee test address, `役割` = `MEMBER`,
   `週容量` = e.g. `40`, then **保存** (`uiSaveMember` → `Members.create`).
2. Add a manager colleague with role `MANAGER` if you want to test scopes.
3. Server-side calls, if you prefer the editor: `createMember({Name, Email, Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 40})`.

Only an ADMIN can grant `ADMIN`/`MANAGER`; self-elevation is refused.

## 12. Create a project

Manager sidebar → **プロジェクト作成 / 編集**:

1. `編集するプロジェクト` stays on `新規作成`.
2. Enter `プロジェクト名`, choose `責任者` (leave it empty to become the owner yourself),
   optional `カテゴリ`, `確定期限`, `状態`.
3. Choose `社内ダッシュボードに表示する` → **表示しない（社内のみ）** for the first pass.
4. Enter `共有用概要` (public) and `説明（社内のみ）` (private).
5. Press **作成** (`uiCreateProject` → `Projects.create`).

Equivalent editor call:
`createProject({Project_Name: '試作案件', Status: 'Active', Project_Owner_ID: '<member id>', Committed_Deadline: '2026-12-31', Dashboard_Visibility: 'RESTRICTED'})`.

## 13. Mark it INTERNAL (publish to the shared dashboard)

1. Same panel: `編集するプロジェクト` → select the project (values load, button becomes **保存**).
2. `社内ダッシュボードに表示する` → **表示する（社内ダッシュボード）**.
3. Press **保存** (`uiUpdateProject` → `Projects.update`). A note appears:
   「変更内容は次回のダッシュボード公開時に反映されます。」
4. Nothing is live yet — visibility only takes effect at the next publication (step 15).

## 14. Create and assign a task

Manager sidebar → **タスク割当 / 編集**:

1. `編集するタスク` stays on `新規作成`.
2. `プロジェクト`, optional `サブプロジェクト`, `タスク名`, `担当者`.
3. `完了期限` and `必要期間` (+ `単位`, `計算方法`). The panel previews the derived start
   (`uiPlanPreview`). Do **not** type a start date: it is derived from deadline + duration.
4. Optional: `見積工数（時間）`, `完了条件`, `優先度`.
5. Leave `メール通知を有効にする` unchecked and `割当を承認する` / `日程を確定する` unchecked
   for the first trial.
6. Press **登録して確認** (`uiAssignTask` → `Tasks.create`).

To change a task later, select it in `編集するタスク`: the button becomes **保存** and the
update is a partial patch (`Tasks.update`). Editing the name invalidates a previous assignment
approval by design; the deadline history and IDs are preserved.

## 15. Publish the first dashboard snapshot

1. Initialize the snapshot **once**. Spreadsheet **B** must be a different file from A and C.
   Add a temporary editor wrapper to the **manager** project and run it (ADMIN account):

```javascript
function initializeSnapshotFromEditor() {
  var id = PropertiesService.getScriptProperties()
    .getProperty('SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID');
  return initializeSharedDashboardSnapshot(
    'INITIALIZE SHARED DASHBOARD ' + id
  );
}
```

   It refuses a destination equal to the management workbook, a destination that already holds
   any value or formula, and one that contains operational tables. It writes `PUBLISHED_META`
   with `RESULT = INITIALIZED` and never touches spreadsheet A. Delete the wrapper afterwards.
2. Publish: manager sidebar → **共有ダッシュボードを今すぐ公開**
   (`uiPublishPublicationNow` → `SharedDashboardPublisher.publish`), or this editor wrapper:

```javascript
function publishFromEditor() {
  return publishSharedDashboard();
}
```

3. Confirm the publication in spreadsheet **B**: `PUBLISHED_META` now shows `RESULT = SUCCESS`,
   a `SNAPSHOT_VERSION` of 1 and a `PUBLISHED_AT` time, and the active slot
   (`PUBLISHED_PROJECTS_A` or `_B`) contains only the `INTERNAL` projects you approved.
4. Read-only checks: `previewSharedDashboardPublication()` (writes nothing) and
   `sharedDashboardPublicationStatus()`.

Scheduled publication stays **OFF** for the trial. Turning it ON additionally requires ADMIN,
the exact confirmation `ENABLE SHARED DASHBOARD PUBLICATION`, an initialized snapshot and an
interval.

## 16. Deploy the dashboard web app and verify viewer access

1. Dashboard project → **Deploy → New deployment → Web app**.
2. Description `EH-DEV trial`; **Execute as: Me (the deploying account)**;
   **Who has access: Anyone within <your domain>** — never "Anyone" / "Anyone with the link".
3. Authorise the two scopes (`https://www.googleapis.com/auth/spreadsheets`,
   `https://www.googleapis.com/auth/userinfo.email`).
4. Open the web app URL **as the employee test account** and confirm the portfolio, a project
   and a task detail render. Share the URL with the trial members.
5. `SHARED_DASHBOARD_ALLOWED_DOMAIN` refuses a resolved address outside your domain. The
   deployment ACL is the primary control: the app runs as the deployer, so an employee's
   address may be unavailable and an empty address is accepted while
   `SHARED_DASHBOARD_REQUIRE_EMAIL` is unset (the trial default).
6. Only after step 4 works for a real employee account may you optionally set
   `SHARED_DASHBOARD_REQUIRE_EMAIL=true` (fail closed). Re-test the employee account; if it is
   refused, remove the property — do not loosen the deployment access instead.

## 17. Initialize the request inbox (spreadsheet C)

Spreadsheet **C** must be a third, separate file. Set `REQUEST_INBOX_SPREADSHEET_ID` in **both**
projects first (step 8), then add a temporary editor wrapper to the **manager** project and run
it as an ADMIN:

```javascript
function initializeInboxFromEditor() {
  return initializeRequestInbox('INITIALIZE REQUEST INBOX');
}
```

It creates the `REQUESTS` sheet with the fixed 15-column header, refuses content that already
exists, refuses the management workbook, and writes an audit row
(`REQUEST_INBOX_INITIALIZED`). Both projects fail closed on a header mismatch. Delete the
wrapper afterwards; re-running it on an already initialized inbox is not needed.

## 18. Safely enable request submissions

Submissions are **OFF** until you say otherwise: the dashboard requires the exact value
`true`.

1. Dashboard project → Script Properties → add `REQUEST_SUBMISSION_ENABLED` = `true`.
2. In the dashboard project editor run `requestSubmissionConfig()` and confirm it returns
   `enabled: true`.
3. In the dashboard page, the request button becomes available on a task detail. Before this
   step it is unavailable and any submission fails with `REQUEST_DISABLED`.
4. To close submissions again: set the property to `false` or delete it.

## 19. Submit an extension request (employee)

1. As the employee test account open the dashboard web app.
2. Open an `INTERNAL` project → task detail → request form.
3. Choose **納期変更**, enter the requester name (self-reported), the requested date, a reason
   and optional details, then submit.
4. The page shows a receipt with a request ID; nothing in the private workbook changes yet.
5. Keep the receipt ID for `requestSubmissionStatus('<request id>')`.

## 20. Import, review and approve (manager)

1. Manager sidebar → **申請一覧** (`uiRequests`). Opening the screen imports new inbox rows
   automatically and reports `{imported, skipped, rejected}`.
2. If the inbox cannot be read, a warning appears and previously imported requests stay
   visible. Use **申請を取り込む** (`uiImportRequests`) to retry.
3. Review the card (project, task, current deadline, requested deadline, difference, reason).
4. Press **承認** and confirm. `uiDecideRequest` → `Requests.decide` applies the change once,
   recalculates the derived start, invalidates stale approval/confirmation and writes
   `TASK_DEADLINE_HISTORY`.
5. **却下** and **差戻し** never change a deadline. A task that changed after submission is
   shown as `STALE` and must be reviewed instead of overwriting the newer value.

## 21. Verify the changed deadline

1. Spreadsheet A → `TASKS`: `Due_Date` shows the approved date once, and
   `Planned_Start` was recalculated when a duration exists; `TASK_DEADLINE_HISTORY` has one
   row; `TASK_REQUESTS.Status` = `APPROVED`.
2. Sidebar **タスク割当 / 編集** → select the task: `完了期限` and `必要期間` show the current
   values.
3. Editor check: `listTasks({projectId: '<project id>'})`.

## 22. Test a completion report

1. Employee: dashboard → task detail → **完了報告**, add the completion note, submit.
2. Manager: **申請一覧** → review → **承認**. The task becomes `Status = Done`,
   `Progress_Percent = 100` and `Accepted_Completion_At` is filled; the reported timestamp is
   kept separately.
3. Rejecting leaves the task untouched.

## 23. Test the Japanese / English switch

1. Every screen shows `日本語 | English` at the top right: dashboard list, project detail, task
   detail, request form, manager sidebar, request queue, automation settings, system status.
2. Switching keeps the current screen, filters, selected project/task and any text you typed.
   Stored spreadsheet text (names, reasons) is never translated.
3. The choice is stored in the browser (`localStorage`), not in the workbook. A fresh browser
   profile starts in Japanese.

## 24. Keep all e-mail delivery disabled

1. Manager sidebar → **自動化設定** → the effective mode must read `OFF`.
2. `EMAIL_MODE` stays `OFF`, `EMERGENCY_STOP` stays on, and no feature switch is turned on.
3. Do **not** run `activateNotifications(...)` and do not type `ENABLE LIVE EMAIL`. Without
   those steps every notification path is a no-op.
4. The request workflow works entirely inside the spreadsheet: importing, approving and
   rejecting never require mail.

## 25. Verify Drive permissions

| File/folder | Expected |
| --- | --- |
| Spreadsheet A | operator + trial managers only |
| Spreadsheet B (snapshot) | operator/deployment account only (the web app reads it as the deployer) |
| Spreadsheet C (inbox) | operator/deployment account only |
| `EH-DEV-BACKUP` | operator + deployment account only |

Right-click each file → **Share**: no "Anyone with the link", no domain-wide edit access.
The web app is the only surface for employees.

## 26. Create and verify a backup

1. Manager project → **Run** `createDatabaseBackup()` (add a no-argument wrapper if you prefer
   the Run button):

```javascript
function backupFromEditor() {
  return createDatabaseBackup();
}
```

2. It requires `BACKUP_FOLDER_ID`; the folder must be private (no public/domain link sharing).
3. Confirm a new file `HK-DEVELOPMENT-v5-<timestamp>` exists in `EH-DEV-BACKUP`.
4. Confirm spreadsheet **A** → `BACKUP_LOG` has a new row with `Result = VERIFIED` and the copy's
   file ID in `Backup_Reference`. A failed attempt logs `Result = FAILED` with
   `Error_Details`, and the function throws — do not continue past a failure.
   (`VERIFIED` is the success value for `Backup.createVerified()`; `SUCCESS` belongs to
   `SCHEMA_MIGRATIONS` and to the publication `PUBLISHED_META`, not to `BACKUP_LOG`.)
5. Open the copy yourself and check that the expected sheets, rows and formulas are present and
   that sharing is restricted (the code already compares every cell and formula of the copy
   against the source before logging `VERIFIED`).
6. Backups are never deleted automatically. Restore is a manual procedure: see
   [BACKUP_RESTORE.md](../BACKUP_RESTORE.md). Never test a restore against the trial workbook
   in place.

## 27. Stop the trial safely

1. Close submissions: dashboard project → `REQUEST_SUBMISSION_ENABLED` = `false` (or delete).
2. Turn publication off: sidebar **自動化設定** → shared dashboard publication OFF, or
   `saveSharedDashboardSettings({SHARED_DASHBOARD_PUBLISH_ENABLED: false}, '')` as an
   administrator (disabling needs no confirmation string; enabling does).
3. Keep e-mail `OFF`; do not activate notifications.
4. Archive the dashboard deployment: dashboard project → **Deploy → Manage deployments** →
   select the trial deployment → **Archive**. Employees then lose access.
5. Keep spreadsheets A, B and C and every backup. **Do not delete rows, sheets or backup
   files** — the application never does, and neither should you.
6. Record what you observed (see below) before any further change.

---

## Record the result

| Check | Result | Evidence (screenshot / note) |
| --- | --- | --- |
| Database initialized (or upgraded) — `SCHEMA_MIGRATIONS` shows `INITIALIZE_V6` (fresh) or the approved `006_…` row (upgrade) | PASS / FAIL / BLOCKED | |
| Operator member created with a generated `Member_ID` | | |
| ADMIN bootstrap | | |
| Employee registered | | |
| Project created, then marked INTERNAL | | |
| Task created with deadline + duration | | |
| Snapshot published and visible in the dashboard | | |
| Dashboard deployed with `DOMAIN` access | | |
| Request inbox initialized, submissions enabled | | |
| Extension request approved once | | |
| Completion report accepted → Done 100% | | |
| Japanese/English switch keeps state | | |
| Mail mode stayed OFF | | |
| Drive permissions reviewed | | |
| Backup created and verified | | |
| Trial stopped safely | | |

Local `npm ci`, `npm run lint`, `npm test` and `npm run validate` are **not** Workspace
evidence. Record live results in [docs/dashboard/SMOKE_TEST.md](dashboard/SMOKE_TEST.md) and
[docs/checkgates/V1_3_1_GATE_7.md](checkgates/V1_3_1_GATE_7.md). Production readiness remains
**NOT APPROVED** until that evidence exists.

## Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Explicit spreadsheet and matching environment binding required` | `ENVIRONMENT`, `BOUND_ENVIRONMENT` or `SPREADSHEET_ID` missing/unequal | fix the Script Properties |
| `Workbook is not initialized; …` | wrong spreadsheet bound to the project | check `SPREADSHEET_ID` |
| `Explicit empty spreadsheet confirmation required` | `INITIALIZATION_SPREADSHEET_ID` ≠ `SPREADSHEET_ID`, or the confirmation text is wrong | set both to spreadsheet A and rerun the wrapper |
| `Initialization refuses any existing content` | spreadsheet A already has a value or formula | use a new empty workbook; never clear an existing one to force it |
| `Member email domain is not allowed` | `ALLOWED_RECIPIENT_DOMAINS` does not contain the operator's domain | set your real domain, or leave the property empty |
| `Members already exist; do not seed twice` | the operator wrapper ran on a workbook that already has members | stop; use the existing row instead of re-seeding |
| `This account is not in the deployment administrator allowlist` | `ADMIN_BOOTSTRAP_ALLOWLIST` missing the address | add it, rerun, then remove it |
| `Create an active member record for this account before bootstrap` | the member row was not created through `Members.create` | run step 10a and verify the generated `Member_ID` |
| `Admin bootstrap has already been used …` | the bootstrap marker exists | the installation is already bootstrapped; do not re-seed |
| Sidebar does not open | script is not container-bound, or the account is not a manager | open spreadsheet A → Extensions → Apps Script |
| `clasp status` lists `dashboard-app/` files for the manager project (or the reverse) | `.clasp.json` points at the wrong `rootDir` | copy the correct `.clasp.*.json` over `.clasp.json` (step 7) |
| `Member self-service is disabled` | account is `MEMBER`/`VIEWER` without `ALLOW_MEMBER_SELF_SERVICE` | use a manager account (the trial assumes trusted managers) |
| Employee is refused although they are in the domain | `SHARED_DASHBOARD_REQUIRE_EMAIL=true` while the viewer address cannot be resolved | remove the property; the deployment ACL is the primary control |
| Dashboard shows no projects | nothing published, or every project is `RESTRICTED` | set `INTERNAL`, save, publish |
| `Snapshot workbook is not initialized` | step 15.1 not done | run the snapshot initialization wrapper |
| `この案件は…再読み込み` on save | somebody saved the record after you loaded it | reload the project/task and re-apply your change |
| Request form is unavailable | `REQUEST_SUBMISSION_ENABLED` is not `true` | step 18 |
| `申請を取り込めませんでした` | inbox property wrong, spreadsheet unshared, header drifted | check C, the 15-column header and both projects |
| `DASHBOARD_NOT_CONFIGURED` | snapshot property missing in the dashboard project | step 8 |
| `Backup folder must not allow public/domain link sharing` | the Drive folder is shared too widely | restrict `EH-DEV-BACKUP` to the operator and deployment account |

## V1.4 trial additions

Before a V1.4 trial, additionally verify in the **development** deployment:

1. `APPROVED_MIGRATIONS = 006_responsibilities_and_nested_subprojects` was the only value present
   while upgrading, and it was removed afterwards.
2. `SCHEMA_MIGRATIONS` holds one `SUCCESS` row for version 6 and `BACKUP_LOG` shows the verified
   pre-migration backup.
3. The `RESPONSIBILITIES` sheet is empty except for the header row: no example area was seeded.
4. Existing projects show 未分類 and existing subprojects are root-level.
5. The sidebar fits a 300px pane, the three sections switch, and each Sheets menu entry lands on
   the right section.
6. The shared dashboard shows the responsibility label, the 担当領域 filter (including a retired
   area) and the indented nested subproject, and refuses a V1.3.1 snapshot with a friendly message.
7. `REQUEST_SUBMISSION_ENABLED` still decides whether the employee request form is offered.

`npm run lint`, `npm test` (328 tests) and `npm run validate` must all pass before pushing to
development. Local results are not Workspace verification.
