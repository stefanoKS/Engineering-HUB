# V1.7 deployment runbook (DEV first, no automatic activation)

V1.7 changes schema **7 → 8** and the employee publication contract **1.5 → 1.6**. Nothing in this
release is applied, published, mailed or migrated automatically. Follow the order below; every step is
reversible and none of them deletes data.

## 0. Preconditions

- Node.js 22 tools: `npm ci`, `npm run lint`, `npm test`, `npm run validate` all pass locally.
- You have the two **separate** clasp targets (`manager-dev` for `src/`, `dashboard-dev` for
  `dashboard-app/`), and you are **not** pointed at production.
- `ENVIRONMENT` and `BOUND_ENVIRONMENT` are `DEVELOPMENT` on the manager project.
- The existing workbook is schema 7. Confirm with `Migrations.currentVersion()` before you start.

## 1. Back up the manager workbook

Run the existing backup entry point from the Apps Script editor and record the reference:

```js
createDatabaseBackup()
```

A migration also takes its own verified pre-flight backup; this one is the independent copy you keep.

## 2. Migrate the manager workbook (schema 7 → 8)

```js
// Script Properties, temporarily:
//   APPROVED_MIGRATIONS = 008_task_and_responsibility_members
upgradeExistingDatabase()
```

Expected: returns `8`, `SCHEMA_MIGRATIONS` gains one `008_task_and_responsibility_members` row with
`Result = SUCCESS`, and two new empty sheets exist: `TASK_ASSIGNEES`, `RESPONSIBILITY_MEMBERS`.

The migration is additive only: it creates the two relationship tables and never copies an owner into
them, never assigns anyone, never renames a column and never republishes the snapshot. The
cell-by-cell preservation check must pass; if it does not, the migration stops, records
`..._FAILED_...` and leaves the workbook intact.

Remove `APPROVED_MIGRATIONS` afterwards.

## 3. Deploy the manager project

Push `src/` to the manager DEV target and redeploy the manager web app. Verify:

1. Members page shows **Position / 職位** (blank renders as `—`).
2. Opening a task with no additional assignees shows an empty "追加担当者" multi-select plus the primary
   owner field; saving without touching it changes nothing.
3. Adding an additional assignee saves, shows a chip on the task card and clears any existing
   assignment approval (Assignment_Version increases by one).
4. Opening 申請一覧 performs exactly one import and reports `取込: 新規 n 件 / 取込済 n 件 / 拒否 n 件`.
5. An ADMIN deletion shows one Yes/No dialog; **No** performs no write.

## 4. Publish the snapshot (contract 1.6)

Only if publication is already enabled in this environment and an ADMIN is doing it:

1. Set `SHARED_DASHBOARD_PUBLISH_ENABLED = true` (it is OFF by default).
2. `publishSharedDashboard()` with the exact confirmation string used by your deployment.
3. Verify: `PUBLISHED_META.CONTRACT_VERSION = 1.6`, `PUBLISHED_TASKS_A/B` has an extra trailing
   column `assigneeNames`, `TASK_COUNT` matches, and the content hash verified without an error.
   A failed publication leaves the previous slot readable.

## 5. Deploy the employee dashboard

Push `dashboard-app/` to the dashboard DEV target and redeploy. Verify:

1. `作業担当者別タスク / Tasks by Worker` lists published work; choosing a worker used by a shared task
   shows that task once.
2. `REQUEST_SUBMISSION_ENABLED` is exactly `true`; otherwise the form stays closed and the UI says so.
3. Submitting a request: the form closes immediately, `送信中` appears, then `受付完了` with a request ID.
   The 申請履歴 panel keeps the receipt after a language switch.
4. Reloading the page keeps the receipt list and turns any interrupted `送信中` entry into
   `送信結果不明` — it is never reported as success.

## 6. Rollback

1. **Employee app**: redeploy the previous dashboard version. It reads contract 1.5 snapshots; if the
   snapshot is already 1.6 the old reader stops with `SNAPSHOT_CONTRACT_UNSUPPORTED` and shows the
   documented message. To go back fully, republish with the previous manager code.
2. **Manager app**: redeploy the previous `src/` version. Schema 8 is forward compatible for reads (the
   two new tables are simply unused), so no data restoration is needed.
3. **Workbook**: restore the backup from step 1 only if the migration itself must be undone. Restoring
   loses anything written after the backup, so prefer rolling the code back instead.

## 7. What is still unverified

Live Google Workspace behaviour (real Sheets timings, deployment ACLs, Workspace browser behaviour)
remains **NOT_RUN** here. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION** until
recorded live evidence exists. Complete `docs/dashboard/SMOKE_TEST.md` and
`docs/MANAGER_WEB_APP_SMOKE_TEST.md` in a real Workspace before any production activation.
