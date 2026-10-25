# 試験運用前チェックリスト / Pre-trial checklist (V1.3.1)

This checklist installs Engineering-HUB **設計・開発課 管理** in a Google Workspace
**DEVELOPMENT** environment for the first trial. It is written for a manager who has never
installed it.

Read the rules first: [AGENTS.md](../AGENTS.md). Do not install the trial in the production
project, do not reuse production data and never enable LIVE mail for the trial.

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

A and B must be different files: publication refuses the management workbook as a
destination.

## 4. Create the two Apps Script projects

| # | Kind | How to create |
| --- | --- | --- |
| 1 | Container-bound manager project | Open spreadsheet A → **Extensions → Apps Script**. Rename it `EH-管理-DEV`. |
| 2 | Standalone dashboard project | <https://script.google.com/home> → **New project**, rename `EH-ダッシュボード-DEV`. |

Do not create the dashboard as a bound script and do not push `src/` into it.

## 5. Obtain spreadsheet IDs

For each spreadsheet: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.
Record A, B and C in a scratch note (never in the repository).

## 6. Obtain script IDs

* Manager project: Apps Script editor → **Project Settings (⚙)** → *IDs* → **Script ID**, or
  from the editor URL `.../projects/<SCRIPT_ID>/edit`.
* Dashboard project: same.

## 7. Local clasp configuration

`.clasp.json` is git-ignored and must stay local. One configuration per project, in separate
folders — never commit it, never share one file between the two projects.

```powershell
npm ci
```

`.clasp.json` is git-ignored (`.gitignore` covers `.clasp.json` and `.clasp.*.json`). Create it
by hand — the repository deliberately ships no example clasp file.

Create `.clasp.json` next to the repository root for the **manager** project:

```json
{ "scriptId": "<manager script id>", "rootDir": "." }
```

For the dashboard project create a second folder (outside the repository, for example
`C:\eh-dashboard-clasp\`) with `.clasp.json` pointing to the dashboard script ID, then copy
the three `.gs` files, the HTML partials, `appsscript.json` and `.claspignore` from
`dashboard-app/` there before pushing:

```powershell
npm run clasp -- login
npm run clasp -- push
```

The manager push uses `.claspignore` from the repository root. Always push `dashboard-app/`
into the standalone project and `src/` into the bound project.

## 8. Required Script Properties for each project

**Manager project (bound to spreadsheet A)** — *Project Settings → Script Properties*:

| Property | Value for the trial |
| --- | --- |
| `ENVIRONMENT` | `DEVELOPMENT` |
| `BOUND_ENVIRONMENT` | `DEVELOPMENT` (must equal `ENVIRONMENT`) |
| `SPREADSHEET_ID` | spreadsheet **A** ID |
| `INITIALIZATION_SPREADSHEET_ID` | spreadsheet **A** ID — only while initializing, remove afterwards |
| `BACKUP_FOLDER_ID` | `EH-DEV-BACKUP` folder ID |
| `ALLOWED_RECIPIENT_DOMAINS` | your development domain only |
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
| `SHARED_DASHBOARD_ALLOWED_DOMAIN` | your workspace domain, e.g. `example.co.jp` |
| `SHARED_DASHBOARD_REQUIRE_EMAIL` | `true` (fail closed when the viewer identity is unavailable) |
| `REQUEST_INBOX_SPREADSHEET_ID` | spreadsheet **C** ID |
| `REQUEST_SUBMISSION_ENABLED` | leave **unset** until step 18 |

Never place a spreadsheet ID into source code or documentation. The sidebars never display
these values.

## 9. First database initialization (new installation)

Only for an explicitly identified, **empty** workbook (spreadsheet A):

1. Manager project → editor → choose the function `initializeNewDatabase`.
2. Run it with the exact confirmation string `INITIALIZE <spreadsheet A id>`:

```js
initializeNewDatabase('INITIALIZE <spreadsheet A id>');
```

3. Approve the OAuth consent for the operator account.
4. It refuses to run when `INITIALIZATION_SPREADSHEET_ID` differs from `SPREADSHEET_ID`, when
   the workbook is not empty, or when the confirmation does not match. It removes
   `INITIALIZATION_SPREADSHEET_ID` after success and writes a `SETTINGS` row
   `DATABASE_ENVIRONMENT`.
5. Reload the spreadsheet: the menu **設計・開発課 管理** appears (via `onOpen`).

**Upgrade instead of installation?** Do not run `initializeNewDatabase`. Set
`APPROVED_MIGRATIONS` to the reviewed IDs (for V1.2 → V1.3 the list is
`002_task_assignment_safety,003_management_reliability,004_shared_dashboard,005_task_planning_and_requests`)
and run `upgradeExistingDatabase()`. It takes a verified backup first and refuses without the
approval entry. See [DEPLOYMENT.md §8.7](../DEPLOYMENT.md).

## 10. First ADMIN bootstrap

1. Create the operator's member row **before** the bootstrap. In the spreadsheet A sheet
   `MEMBERS`, add one row: `Email` = the operator address, `Active` = `TRUE`, `Name` = any
   name. Leave `Role` blank for now.
2. Run, in the manager project:

```js
bootstrapFirstAdministrator('<operator email>', 'BOOTSTRAP ADMIN <operator email>');
```

3. It requires the member row, the `ADMIN_BOOTSTRAP_ALLOWLIST` entry, a current schema and an
   unused marker. It refuses a workbook that already has an active administrator or
   notification history.
4. Remove the address from `ADMIN_BOOTSTRAP_ALLOWLIST`.
5. Open **設計・開発課 管理 → ダッシュボード**. The sidebar shows your e-mail and `ADMIN`.

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

1. Initialize the snapshot **once**, as an administrator, in the manager project editor:
   `initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD <spreadsheet B id>')`.
   It refuses a non-empty or operational workbook and never touches spreadsheet A.
2. Publish: manager sidebar → **共有ダッシュボードを今すぐ公開** (`uiPublishPublicationNow` →
   `SharedDashboardPublisher.publish`) or, in the editor, `publishSharedDashboard()`.
3. Check `共有ダッシュボードを今すぐ公開` reported counts, and confirm in spreadsheet B that
   the `PUBLISHED_META` sheet has `RESULT = SUCCESS` and the active slot contains only
   `INTERNAL` projects.
4. Preview without writing: `previewSharedDashboardPublication()`; status:
   `sharedDashboardPublicationStatus()`.

Scheduled publication stays OFF. Turning it ON additionally requires ADMIN, the exact
confirmation `ENABLE SHARED DASHBOARD PUBLICATION`, and an interval.

## 16. Deploy the dashboard web app

1. Dashboard project → **Deploy → New deployment → Web app**.
2. Description `EH-DEV trial`; **Execute as: Me (the deploying account)**;
   **Who has access: Anyone within <your domain>** (never "Anyone").
3. Authorise the two scopes (`spreadsheets`, `userinfo.email`).
4. Open the web app URL as the employee test account. Share the URL with the trial members.
5. `doGet` refuses a viewer outside `SHARED_DASHBOARD_ALLOWED_DOMAIN`.

## 17. Initialize the request inbox (spreadsheet C)

1. Set `REQUEST_INBOX_SPREADSHEET_ID` in **both** projects (manager and dashboard).
2. In the **manager** project editor run, as an administrator:

```js
initializeRequestInbox('INITIALIZE REQUEST INBOX');
```

3. It creates the `REQUESTS` sheet with the fixed 15-column header and refuses content that
   already exists. Both projects fail closed on a header mismatch.

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

1. Manager project editor → `createDatabaseBackup()` (requires `BACKUP_FOLDER_ID`).
2. Confirm a new file `HK-DEVELOPMENT-v5-<timestamp>` exists in `EH-DEV-BACKUP`.
3. Confirm spreadsheet A's `BACKUP_LOG` has a new row with `Result = SUCCESS`.
4. Backups are never deleted automatically. Restore is a manual procedure: see
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
| Database initialized (or upgraded) | PASS / FAIL / BLOCKED | |
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
| `Explicit empty spreadsheet confirmation required` | wrong confirmation text | copy the ID exactly |
| Sidebar does not open | script is not container-bound, or the account is not a manager | open spreadsheet A → Extensions → Apps Script |
| `Member self-service is disabled` | account is `MEMBER`/`VIEWER` without `ALLOW_MEMBER_SELF_SERVICE` | use a manager account (the trial assumes trusted managers) |
| Dashboard shows no projects | nothing published, or every project is `RESTRICTED` | set `INTERNAL`, save, publish |
| `Snapshot workbook is not initialized` | step 15.1 not done | run the snapshot initialization |
| `この案件は…再読み込み` on save | somebody saved the record after you loaded it | reload the project/task and re-apply your change |
| Request form is unavailable | `REQUEST_SUBMISSION_ENABLED` is not `true` | step 18 |
| `申請を取り込めませんでした` | inbox property wrong, spreadsheet unshared, header drifted | check C, the 15-column header and both projects |
| `DASHBOARD_NOT_CONFIGURED` | snapshot property missing in the dashboard project | step 8 |
