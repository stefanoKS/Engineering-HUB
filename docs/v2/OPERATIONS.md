# Operations Runbook (V2)

## Manager recoverable removal, deleted items and restoration — 2026-11-12

No migration is part of this change: schema 12 stays as applied, no column, table or Script-style
setting is added, and the operational database is not touched by the release itself.

* **A manager may now remove a task or a subproject recoverably.** The removal is offered only inside
  a division where that manager holds a `WORK` membership, and the server refuses a read-only
  division, a foreign division and every non-manager role. A user who reports "the delete option is
  missing" is usually looking at a record in a division where they hold only `READ` access.
* **Nothing is physically removed.** The row keeps its identifier, status, dates, assignments,
  requests, approvals, notifications and history; only `deleted_at` is stamped and the revision moves.
  A record that still has children, dependants, pending requests or queued notification work is
  refused with the blockers listed.
* **削除した記録 / Deleted items is the recovery screen.** An ADMIN finds every recoverably removed
  task and subproject there, searches by name or project, and restores one with a single button. The
  list is paged and shows the deletion time, the recorded deleting manager (or 記録なし when the audit
  row is missing), the recorded reason and whether a restoration is currently possible.
* **A restoration returns the same record.** The identifier, status, dates, assignments and history
  are preserved and `RECORD_RESTORED` is appended. A removed parent, an archived or cancelled project
  or a hierarchy that no longer fits is reported as a blocker; nothing is repaired, moved or restored
  automatically. A completed task comes back completed — reopening it is a separate ADMIN action.
* **A permanent erasure is still separate and irreversible.** Only an ADMIN may erase a demonstrably
  mistaken, empty record, the preflight and tombstone are unchanged, and an erased record is not
  listed on 削除した記録 and cannot be restored. Treat it as a last resort, not as "delete".
* **Confirmations no longer ask for typing.** A removal, a restoration, a reopening and a permanent
  task/subproject erasure ask for one clearly labelled button in a red panel that names the record.
  Project and responsibility erasure keep their typed `DELETE <id>` confirmation. If an operator asks
  "what do I type?", the answer is nothing: review the named record and the stated consequence.
* **An unclear outcome is not a failure and is not retried automatically.** Reload the screen and the
  list to see the actual state; a repeated delivery of the same attempt replays the stored answer
  rather than applying a second effect.

## Division corrections and V2 branding — 2026-11-11

No migration is part of this change: schema 12 stays as applied, and the operational database was not
touched by the release itself.

* **The product name is `シゴトモ` / `SHIGOTOMO`.** It appears in the authenticated header, the
  sign-in title, the browser tab and the accessible application name. A division named `設計・開発課`
  keeps that name; branding never renames stored data. A user who reports "the old name" is looking
  at a stale browser bundle, not at a data problem.
* **A refused action now names the real reason.** A demotion (`MANAGER` → `MEMBER`/`VIEWER`) or a
  deactivation while a write was in flight answers `403 AUTHORIZATION_DENIED`; a membership change
  that an active relation still needs answers `DIVISION_MEMBERSHIP_BLOCKED`; a retired division
  answers `INVALID_TRANSITION`. Nothing is half-written when one of these is returned.
* **A division transfer can now refuse a change that arrived while it waited.** If an assignment was
  added in the meantime and the assignee would be ineligible, the transfer refuses and the project's
  division and every assignment stay as they were.
* **Reordering is scoped.** A division move stays inside the active or retired group, and an area
  move stays inside its division and status group. If the list changed, the move answers
  `EDIT_CONFLICT`; reload and retry. Equal sort orders no longer make a row un-movable.
* **A retired division is history, not a destination.** It stays visible to a reader who may already
  read it, is never offered for new work, and a retained grant survives an unrelated member edit.
  A *new* grant in a retired division is refused; reactivate the division first (再有効化) if the
  grant is genuinely needed.
* **A rollback is an authorization regression, not a schema question.** Follow
  [DIVISIONS.md](./DIVISIONS.md) §9: keep the current build serving, preserve every division row and
  audit record, restrict exposure if an older build must run, and revert forward. Never drop the
  division tables, columns or history.

## Task assignee filter — 2026-11-10

On All Work, 担当者 / Assignee starts at すべて / All. Search for a name or member ID and choose
an option; duplicate names include their IDs and inactive people are labelled. The options contain
only people with retained assignments in work you may read, including inactive people. The filter
matches the primary owner or a non-removed additional assignee, combines with the other filters,
and does not change access. A hierarchy-context badge marks a parent included only to reach a
match. The matching-task total and the paged top-level branch total are separate; neither is a
workload KPI. Choosing another assignee returns to the first page and closes expanded branches.
The selection remains in page memory during navigation and language changes, not browser storage.

## Project sections — 2026-11-10

Projects are grouped by 分野 when all areas are selected. Each heading can be collapsed, shows the
total in the current filtered authorized scope, and indicates when projects continue on other pages.
Selecting one area returns the responsibility column. Edit remains visible; archive and, for ADMIN,
delete are under その他. The existing confirmations and deletion preflight still apply.
The area selector remains in place; no additional filter-chip list has been introduced.

## Project status, new-project visibility and date rollover — 2026-11-05

* **Nothing runs at midnight.** A project's displayed status is calculated at read time from its
  start date, finish date and the current Asia/Tokyo date. There is no scheduled job, no nightly
  write and no audit row produced by time passing; restarting a service or leaving a tab open all
  show the same rule. Opening or focusing a page (and the next Tokyo midnight while it stays open)
  re-reads the date-dependent projections.
* **Only lifecycle decisions are stored.** "Mark completed", "Cancel project" and "Reactivate" are
  the only ordinary status changes, each confirmed in the UI and validated on the server (a project
  can still only be completed when every task is done or cancelled). Archive keeps its own
  confirmed action. A stored `On Hold`/`Planned`/`Active` value is historical data: it is never
  rewritten, and it no longer overrides the derived badge. There is no migration and no bulk
  status update.
* **A new V2 project is `INTERNAL`.** The visibility selector defaults to INTERNAL and still offers
  RESTRICTED; an omitted value on the API also defaults to INTERNAL. Existing projects keep their
  stored visibility - including RESTRICTED - and a change appears at the next publication run, not
  immediately. Publication stays OFF by default and is unchanged by this default.
* **Deadlines follow the task lifecycle.** A done or cancelled task is never shown as overdue; a
  completion after its deadline is labelled "completed late" ("期限後に完了"). The workload
  drill-down returns the display state next to the stored status, so the report and the task list
  agree.
* **Timeline marks.** Each row draws one bar 12 px tall; a deadline-only or same-day record is a
  3 px point mark centred in its day, and work outside the selected window is simply absent rather
  than pinned to an edge. The row's Details control shows the exact dates.

The timeline's subproject arrow expands or collapses that folder's task tree without changing
stored task or subproject relationships. Project-direct tasks are not controlled by that arrow.

## Local LAN update — 2026-11-02

[LOCAL_LAN.md](LOCAL_LAN.md) specifies the employee-ID/password mode, schema 7, optional email, first-login change, administrator reset, employee-owned progress editing, Windows launcher, durable local backup and optional Shared Drive upload. It supersedes Google-only or Linux-only assumptions below for this mode. [Verification record](LOCAL_LAN_ACCEPTANCE.md).

## Member self-service and backup status — 2026-11-03

* A member files their own work in 自分の担当タスク. The task is created unapproved, owned by the
  verified member and starts as `Not Started`; managers see it immediately.
* A completion report is only accepted while `REQUEST_SUBMISSION_ENABLED` is exactly `true`. A task
  the member created is completed by an **ADMIN** decision; older work keeps the manager decision.
  A refused decision leaves the request `PENDING`.
* Backup health is reported per destination: last local backup, last Drive upload and the latest
  failure (`GET /api/manager/status`, or `cli.ts backup-status` on the host). A Drive failure never
  removes the local artefact, and a retry never uploads the same artefact twice.

## Calendar and reminder changes — 2026-11-01

The opt-in hourly Calendar scan includes tasks and milestones. Events use deterministic identities and ownership/ETag checks; missing or foreign linked events require investigation and are not silently replaced. Pending-request reminders use an independent switch and recheck status before delivery. See [compatibility and release gates](RELEASE_HARDENING.md). All existing activation gates remain required.


Day-to-day operation of a self-hosted V2 installation. The V1 Apps Script runbook stays valid for
the V1 project while it is still deployed.

## 1. Services

| Service | Role | Fails how |
| --- | --- | --- |
| `api` | HTTP API + built web bundle | `/healthz` fails; the proxy returns 502 |
| `worker` | outbox: notifications, reminders, Calendar, backups, exports, publication, maintenance | jobs pile up in `outbox_jobs`; no user-visible outage |
| `db` | PostgreSQL, the authoritative store | everything fails; restore from backup |
| `caddy` / `cloudflared` | TLS and ingress | the site is unreachable; the stack keeps running |

The API never contacts Google. The worker never serves HTTP. Only the worker holds the service
account.

## 2. Daily checks

| Check | How | Expected |
| --- | --- | --- |
| API alive | `curl -fsS https://<APP_DOMAIN>/api/version` | version JSON |
| API ready | `curl -fsS https://<APP_DOMAIN>/readyz` | database ok, schema version current |
| Worker progress | `docker compose logs --since 1h worker \| grep 'job failed'` | no permanent failures |
| Outbox backlog | 状態 screen, or `SELECT count(*) FROM outbox_jobs WHERE status IN ('PENDING','LEASED')` | small and draining |
| Backup | `backup_log` latest row and **Status** (local / Drive / failure) | local `OK`, checksum present, `verify-restore` PASS monthly |
| Ledger | `notification_ledger` for `DELIVERY_UNCERTAIN` / `FAILED` | reviewed, not silently retried |
| Disk | `df -h` | above 20 % free |
| Certificate | browser / `curl -vI` | valid, renewed |

## 3. Routine tasks

**Create or change members.** ADMIN on メンバー. Role changes are ADMIN-only, cannot be applied
to yourself, and cannot demote or deactivate the last active administrator.

**Change automation settings.** ADMIN on 自動化. Every change is revision-checked and audited.
Turning e-mail to LIVE requires the exact phrase and a passing preflight; the emergency stop
always wins.

**Approve a deadline change or a completion report.** 申請一覧 → review → decide. The decision is
applied once; a second decision is refused. A request whose task changed after submission becomes
`STALE` and is never applied over the newer value.

**Publish the shared dashboard.** ADMIN → 公開 → publish (confirm). The inactive slot is written
and verified, then committed with one metadata write. A failure leaves the previous snapshot
readable and is recorded.

**Delete a mistaken, empty project/subproject/task.** ADMIN only, 削除: the preflight must show no
dependencies, the reason is required, the confirmation is a single Yes/No dialog and the server
derives `DELETE <id>`. A record with history is refused and must be archived instead.

## 4. Incident playbooks

### The site is down
1. `docker compose ps` — is `api` running?
2. `docker compose logs --tail 200 api` — configuration error or database failure?
3. `curl -fsS http://127.0.0.1:8080/healthz` — is the process alive behind the proxy?
4. `docker compose exec db pg_isready` — is the database up?
5. If the database is corrupt or lost, follow the restore procedure in
   [BACKUP_RESTORE.md](./BACKUP_RESTORE.md), then restart `api` and `worker`.

### Mail is being sent when it should not be
1. 自動化 → 緊急停止 (ADMIN). This forces `EMAIL_MODE=OFF` and is audited.
2. Inspect `notification_ledger` for the affected window: `SENT`, `PREVIEW`,
   `DELIVERY_UNCERTAIN`.
3. Fix the cause (mode, switch, recipients, template), then re-enable LIVE only with the phrase.
4. Never delete ledger rows: they are the evidence.

### A job keeps failing
1. `SELECT job_id, kind, attempts, last_error FROM outbox_jobs WHERE status = 'FAILED'`.
2. `NOT_CONFIGURED` means a missing credential — fix the environment, not the job.
3. A permanently failing job stays `FAILED`; it is never retried forever.
4. `tsx src/cli.ts run-once` drains the outbox once for a controlled retry.

### An ambiguous delivery
`DELIVERY_UNCERTAIN` is never retried automatically. Check the mailbox/calendar for the item, then
either record the reconciliation or enqueue a fresh, distinct message. Do not "resend the job".

### A stale edit conflict
The browser keeps the draft and reports `EDIT_CONFLICT`. Reload the record, review the newer
values, re-apply the intended changes. Never overwrite blindly and never bypass the revision
check.

### Unexpected authorization failures after a role change
Authorization is re-read per request, so a role change takes effect immediately. Confirm the
member row (`role`, `active`) in the database and the `audit_log` entry for the change.

### The sign-in screen reports that it cannot load the sign-in configuration
1. `Invoke-RestMethod http://localhost:8050/readyz`. A `503 DATABASE_MIGRATION_REQUIRED` with
   `schemaVersion` **is** the cause: the running build needs the schema the database does not have.
   Do not change `AUTH_MODE`, and do not reset accounts, passwords or sessions.
2. Compare the ledger: `SELECT version, name FROM schema_migrations ORDER BY version;`. The last
   reviewed migration for this release is `0012_divisions.sql`.
3. Apply the reviewed upgrade in the documented order — verified encrypted backup
   (`Backup-Now.cmd`), then the one-shot migration (`Migrate-Lan.cmd`), then verify the ledger,
   `/readyz` and the preserved row counts (see [MIGRATION.md](./MIGRATION.md) §9.1). This is a
   separate, explicitly authorized operation; the application never migrates at startup.
4. After the migration, record the initial divisions once and run the reviewed mapping
   ([DIVISIONS.md](./DIVISIONS.md) §5). Until then every existing project is unmapped and therefore
   ADMIN-only.
5. If `/readyz` says `ready` and the sign-in screen still fails, the failure is the browser's
   request: run `curl -i http://localhost:8050/api/public-config`. That endpoint is answered without
   a session and without a division scope, so a 500 there is a build/proxy problem, not an
   authentication problem.

### Shared-dashboard publication is refused
`503 NOT_CONFIGURED` with "cannot enforce per-division isolation" is the intended state: the
company-wide snapshot cannot scope rows to a reader's divisions. Do not work around it by disabling
the check; a per-division reader is a separate release. A snapshot that was published by an earlier
build stays readable until an operator deliberately replaces or removes it.

## 5. Change management

1. Branch, implement, run `npm ci`, `npm run lint`, `npm test`, `npm run validate`.
2. For a behavioural change, update the docs (`docs/v2/*`, the operating docs) and record the
   check gate.
3. Before deploying a migration: `backup-now`, `verify-restore` PASS, then the one-shot `migrate`.
4. Deploy code after the migration, then verify `/readyz` and the 状態 screen.
5. Record what was deployed, when, by whom, and the backup ID.

## 6. Data hygiene

* Never edit rows in production to fix a mistake without a recorded reason and an audit note.
* Never delete audit, ledger, deadline-history, request or backup rows.
* Never clear a table; `verify-restore` creates and drops its own scratch database only.
* Exports and snapshots are outputs; they are regenerated, never edited by hand.

## 7. Scheduled jobs

| Job | Trigger | Setting |
| --- | --- | --- |
| `backup.database` | every `BACKUP_INTERVAL_MINUTES` (default 60) when enabled | `DAILY_BACKUP_ENABLED`, `BACKUP_INTERVAL_MINUTES` |
| `notification.reminder-scan` | hourly (sending window and catch-up need several attempts a day) | `DEADLINE_REMINDER_ENABLED`, `OVERDUE_REMINDER_ENABLED`, `REMINDER_OFFSETS`, `REMINDER_CATCHUP_DAYS`, `OVERDUE_FREQUENCY_DAYS`, `WEEKDAY_ONLY_SENDING`, `EXECUTION_WINDOW_START/END` |
| `notification.request` | on a submitted request | `DEADLINE_REQUEST_EMAIL_ENABLED` / `COMPLETION_REPORT_EMAIL_ENABLED` |
| `notification.request-decision` | on a decision | master mode and the ledger |
| `publication.run` | every `SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES` while enabled | `SHARED_DASHBOARD_PUBLISH_ENABLED` |
| `calendar.task` | on a task create or a deadline/planned-start change | `CALENDAR_SYNC_ENABLED` |
| `report.weekly` | configured day and hour | `WEEKLY_MANAGER_REPORT_ENABLED`, `WEEKLY_REPORT_DAY`, `WEEKLY_REPORT_TIME`, `MANAGEMENT_REPORT_RECIPIENTS` |
| `export.sheets` | daily when enabled | `EXPORT_SHEETS_ENABLED`, `EXPORT_SPREADSHEET_ID` |
| `maintenance.sessions` | daily | — (expired session cleanup and interrupted-delivery reconciliation) |

Milestone calendar synchronisation has **no producer yet**; only task deadlines are synchronised.

Dedupe keys make a duplicate enqueue harmless. Every job is claimed with a lease **token**; only
the worker holding that token can complete it, fail it or renew it, and a long job renews the lease
while it runs. An expired worker's outcome is discarded (`LEASE_LOST`), never applied over the newer
owner.

### Uncertain email delivery

1. A `SENDING` attempt row is written before Gmail is contacted.
2. A definite success records `SENT`; a definite transient failure returns the row to `PENDING` for
   a bounded retry (at most three attempts).
3. An interrupted or ambiguous attempt is reconciled to `DELIVERY_UNCERTAIN` by the worker loop and
   by `maintenance.sessions`. It is **never** retried automatically.
4. An operator who verifies that the message was not delivered authorizes a retry explicitly:
   `node apps/worker/dist/cli.js authorize-delivery-retry <notificationId> <actorEmail>`.
   That command is the only path from `DELIVERY_UNCERTAIN` back to a claimable attempt.

Do not claim exactly-once Gmail delivery. The guarantee is "no automatic duplicate after an
ambiguous outcome".

## 8. What this runbook does not cover

Live Google Workspace setup (see [GOOGLE_WORKSPACE.md](./GOOGLE_WORKSPACE.md)), the DNS/tunnel
setup (see [REMOTE_ACCESS.md](./REMOTE_ACCESS.md)) and the V1 → V2 cut-over (see
[MIGRATION.md](./MIGRATION.md)). None of those has been executed against a live environment.

## Corrective update rollout (2026-11-03)

No new migration accompanies this update. Keep schema 8; installations older than schema 8 must
follow the existing reviewed backup/migration procedure. With a verified backup, build using
`npm ci` and `npm run build`, then restart the API and worker together via the Windows launcher.
Refresh browser tabs to load the updated My Work contract. Confirm two successive member task
creates, restricted-project completion review, ADMIN-only approval for member-created work, and
local/Drive status. Retain protected `BAK-*.upload.json` checkpoints beside the encrypted artifacts.
A checkpoint is private upload state, never a document to attach to support tickets.

## Logical removal and smart Back rollout (2026-11-04)

This update changes source and web assets only. Schema 8 and migrations 0001–0008 are unchanged:
do **not** run `Migrate-Lan.cmd` for this update. On the Windows LAN host:

```powershell
Set-Location C:\path\to\Engineering-HUB
npm ci
npm run typecheck
npm run lint
npm test
npm run validate
npm run build
```

In the existing `Start-Lan.cmd` supervisor window press `Ctrl+C` and wait for both the API and
worker to stop. Then start the rebuilt pair:

```powershell
.\deploy\windows\Start-Lan.cmd
```

Verify `http://127.0.0.1:8050/healthz` and `/readyz`, then reload employee browsers so they receive
the rebuilt web bundle. Confirm an ADMIN can remove one disposable empty task/subproject, a MANAGER
has no delete icon, the audit view contains `RECORD_REMOVED`, and Back returns Project detail →
Task detail → Project detail without collapsing the branch. Do not initialize, migrate, deploy to
production, or alter the operational database outside the reviewed application command.

## Divisions (課): first-run and maintenance checklist

1. **Create the divisions once.** Run the approved bootstrap (`bootstrapDivisions`) against the
   environment, or create them from `課の管理` as ADMIN. The migration seeds nothing and sets no
   default, so a fresh database has no division until this step.
2. **Map existing work deliberately, projects before areas.** Read the unmapped view as ADMIN
   (`課の管理` → 未分類の割り当て, or `GET /api/admin/divisions/unmapped`), which reports unmapped
   projects, unmapped areas, inconsistent area/project pairs, the proposed target with its rule and
   the assignment evidence; then apply the reviewed mapping with a verified backup, which performs
   the constraint-compatible order of [DIVISIONS.md](./DIVISIONS.md) §5 (projects while their area is
   still unmapped, then the area) in one transaction. Grant memberships separately (step 3) and
   verify that identifiers and rows are preserved. Unmapped work stays ADMIN-only.
3. **Grant membership, not roles, for eligibility.** A person can be assigned only where they hold
   `WORK` membership. `ADMIN` status and 次長 oversight never qualify anybody.
4. **Removing a membership is preflighted.** Unresolved active work blocks the removal with
   `DIVISION_MEMBERSHIP_BLOCKED`; complete or reassign that work first. Nothing is silently
   unassigned, moved or archived.
5. **Retirement is 廃止.** A retired division keeps its rows and history, accepts no new work or
   assignment and can be reactivated (再有効化). Never delete a division.
6. **A project's division changes only through the ADMIN transfer command**, which refuses the whole
   move when an owner or assignee would become ineligible and audits both divisions.
7. **Publication stays OFF.** `publishNow` skips unmapped work; the V1 workbook remains a
   company-wide allowlisted `INTERNAL` portfolio, and per-division isolation there is BLOCKED
   pending a separate release. Nothing here activates mail, Calendar or publication.

## Mapping unmapped legacy work (ADMIN, 2026-11-11)

Unmapped work is invisible to everybody but `ADMIN`, so this is the only way it becomes work again.
Nothing below happens automatically, and no step is scheduled.

1. **Take a verified backup**: `deploy\windows\Backup-Now.cmd` on the local Windows host, or
   `node --env-file=<worker env> apps/worker/dist/cli.js backup-now` (Compose:
   `docker compose exec worker node apps/worker/dist/cli.js backup-now`). The apply refuses to run
   without a `backup_log` row with `result = 'OK'` and a checksum that is younger than 24 hours
   (`409 MAPPING_BACKUP_REQUIRED`). A backup that failed is not a backup.
2. **Open 課の管理 → 未分類の割り当て** (ADMIN). The panel lists the counts, one page of records with
   the proposal state, the rule that produced it, the blockers and every assignment, plus the backup
   status. Add `保管・廃止も表示` to include archived records, and use the division filter to see the
   work one division claims.
3. **Review every record you intend to write.** A `SUGGESTED` record is not an approval; check the
   evidence (an inactive former owner is shown as 履歴 and is never a blocker), then select the
   record and confirm the target division. Change the target where the proposal is wrong; a
   `CONFLICT` or `UNRESOLVED` record needs a decision, and the tool never guesses one.
4. **Type the phrase and apply.** The phrase is `MAP <n> RECORD(S)` for the selected batch, and the batch
   is limited to 100 records. Review the selection once more, then apply. The answer reports how many
   areas and projects were mapped and which backup was used; `PROJECT_DIVISION_MAPPED`,
   `RESPONSIBILITY_DIVISION_MAPPED` and `DIVISION_MAPPING_APPLIED` appear in the audit log.
5. **If it is refused, read the reason and re-read the view** - the apply is all-or-nothing, so a
   refusal means nothing was written:
   * `MAPPING_BACKUP_REQUIRED` - take a backup (step 1) and reopen the view so the banner clears.
   * `EDIT_CONFLICT` - a record changed after the preview; refresh and review it again. Do not widen
     the batch to "get past" a conflict.
   * `INVALID_TRANSITION` - the record is already mapped, or the area's projects still disagree. Map
     the projects first (they can be in the same batch, projects are written first).
   * `400 VALIDATION_FAILED` / `DIVISION_MEMBERSHIP_REQUIRED` - an active owner or assignee would be
     ineligible in the target division. Decide the assignment first; the tool never reassigns.
6. **Verify.** The record leaves the unmapped list and appears in the division for the members who
   hold it. Counts, identifiers, owners, deadlines, statuses and history are unchanged apart from the
   mapped columns; a responsibility scope change touches `RESPONSIBILITIES.division_id` only.
7. **Do not** disable a trigger, edit the spreadsheet or the database directly, or grant a
   membership "so it becomes visible". Granting access stays the reviewed membership path.

Restoring a backup after a failed or unwanted mapping is a separate, explicit operation
([BACKUP_RESTORE.md](../BACKUP_RESTORE.md)); the mapping tool never restores and has no undo
command. Live execution of this procedure and its Workspace behaviour are **NOT_RUN** here.


## Member collaboration and manager recovery — 2026-11-13

This user-approved policy supersedes earlier statements that members cannot edit/remove existing
tasks or subprojects, and that restoration is ADMIN-only. MEMBER may edit ordinary task and
subproject fields and recoverably delete either record regardless of owner, within a WORK division
and an INTERNAL, non-archived project they may see. READ-only grants never allow a write.
MANAGER may restore tasks/subprojects in WORK divisions; ADMIN retains cross-division recovery.
Projects/responsibilities, approvals, direct completion, notification settings, permanent erasure
and completed-task reopening retain their existing separate permissions. Members do not restore.

The member opens a task detail to edit/delete it, or a project hierarchy to edit/delete a
subproject. Editors fetch fresh narrow records and revisions; saves are partial patches. A red
confirmation panel requires one explicit button and no typing. Deletion retains the row/history,
children/dependencies and existing blockers; recovery restores the same ID and status. Completed
work stays completed. Managers reach Deleted Items through the management navigation.

Server authorization is repeated under the existing division/role advisory locks. Deleted Items
filters both records and totals by writable divisions before pagination. Member edit APIs retain
project visibility and field allowlists and do not expose manager-only history or settings.
No schema change, operational migration, deployment or outbound activation is required or performed.
