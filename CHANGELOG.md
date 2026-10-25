# Changelog

## V1.2 shared dashboard (employee-facing read-only web app)

Schema version **4** — additive migration `004_shared_dashboard` (approval and verified
backup required; no existing cell, formula, custom column or ID is modified).

Shared dashboard

- New separate read-only Apps Script web app (`dashboard-app/`) for every authorised company
  viewer: Japanese-first portfolio, project drill-down, task drawer, search, filters and
  Asia/Tokyo deadline wording (`完了` / `本日期限` / `X日超過` / `期限未設定`).
- `doGet()` serves a single page; the only server functions are `dashboardPortfolio`,
  `dashboardProject` and `dashboardTask`. There is no write path, no mail, no Calendar and no
  trigger API in that project.
- Deployment restricted to the Workspace domain and executed as the deployer
  (`appsscript.json`), with read-only spreadsheet scope; `npm run validate` enforces both.

Publication

- `SharedDashboardModel` builds explicit allowlisted DTOs from operational rows; source rows
  are never forwarded and e-mail addresses, skills, HR capacity, logs and settings are
  excluded by construction.
- `SharedDashboardPublisher` copies the projection into a sanitized snapshot workbook using
  two data slots (A/B) plus `PUBLISHED_META`. Data is written to the inactive slot, verified
  (headers, row counts, SHA-256 content hash) and only then committed by one metadata write,
  so a failed publication leaves the previous snapshot readable.
- New entrypoints: `publishSharedDashboard()`, `previewSharedDashboardPublication()`,
  `sharedDashboardPublicationStatus()`, `saveSharedDashboardSettings()`,
  `initializeSharedDashboardSnapshot()`, `scheduledSharedDashboardPublish()`.
- Destination guard refuses the private master workbook and any workbook that looks
  operational (`PROJECTS`, `MEMBERS`, `AUTOMATION_SETTINGS`, `NOTIFICATION_LOG`, `AUDIT_LOG`).
- Publication is serialized with the script lock, idempotent for readers, blanks stale
  trailing rows, and records `SHARED_DASHBOARD_PUBLISHED` / `SHARED_DASHBOARD_PUBLICATION_FAILED`.

Visibility and schema

- `PROJECTS.Dashboard_Visibility` (`INTERNAL` / `RESTRICTED`, default `RESTRICTED`) and
  `PROJECTS.Dashboard_Summary`; `TASKS.Public_Note` is the only publishable task free text.
- Migrated projects keep a blank visibility and are therefore **not** published until a
  manager reviews them.

Settings and scheduling

- `AUTOMATION_SETTINGS` gains `SHARED_DASHBOARD_PUBLISH_ENABLED` (default **false**),
  `SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES` and publication status keys. Publication
  never affects the mail mode.
- The optional `scheduledSharedDashboardPublish` trigger exists only while publication is ON.

Tooling and documentation

- `npm run validate` now also validates the dashboard project: no spreadsheet writes, no mail
  / Calendar / trigger / Drive APIs, no manager modules, no `SPREADSHEET_ID` property, and a
  domain-restricted, read-only manifest.
- New `scripts/dashboard-preview.js` builds an offline static preview from fictional data for
  browser review and visual regression.
- New documentation: `docs/dashboard/*` (architecture, data contract, access and sharing,
  deployment, smoke test, visual spec) and `docs/checkgates/V1_2_GATE_1..5.md`.

## V1.1 production hardening (security fixes, release gates, documentation)

Schema version stays **3** (no migration required for this release).

Security

- Server-side authorization layer (`src/Access.gs`): identity from the verified session only; role, actor, owner
  and confirmation values supplied by the browser are data, never authority.
- Role management guarded: only ADMIN may grant/revoke `ADMIN`/`MANAGER`, self-role-change is refused, unknown role
  text is rejected, and the last active administrator cannot be demoted or deactivated.
- Task ownership enforced: MEMBER → own tasks, MANAGER → own projects/subprojects and own tasks, ADMIN → all,
  VIEWER → none.
- One-time, allowlisted, audited first-administrator bootstrap (`bootstrapFirstAdministrator`); refused on an
  operational workbook and not reusable.
- Member-scoped data visibility: MEMBER sees only own tasks/projects, a minimal member directory and own
  assessment; no other people's assessment details.
- Sidebar rendering rewritten with DOM creation and `textContent` (`src/UiSafe.html`); `innerHTML`, `outerHTML`,
  `insertAdjacentHTML` and `document.write` are rejected by `npm run validate`.

Automation

- LIVE authorization is evaluated on the **effective-state** transition, so clearing the emergency stop while
  `EMAIL_MODE=LIVE` requires ADMIN, the exact confirmation and a passing preflight. Activation/deactivation is
  audited (`EMAIL_LIVE_ACTIVATED`, `EMAIL_LIVE_DEACTIVATED`).
- Unmigrated workbooks fail closed (`OFF`, `LEGACY_CONFIGURATION_BLOCKED`); the legacy flag mapping requires the
  explicit `ALLOW_LEGACY_EMAIL_CONFIG=true` opt-in.
- Weekly report scheduling derives weekday and time from settings, detects drift through
  `MANAGED_TRIGGER_SIGNATURE`, recreates only managed triggers, and removes obsolete ones without touching
  unrelated triggers.

Management correctness

- `Health.staleDays` returns a numeric age; thresholds moved to `thresholds`.
- Dashboard attention categories are independent (`unknownScheduleProjects`, `atRiskProjects`, `overdueTasks`,
  `blockedTasks`, `criticalIssues`, `staleProjects`).

Documentation

- Updated `README.md`, `README_JP.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `DEPLOYMENT.md`, `BACKUP_RESTORE.md`,
  `AGENTS.md`, `.github/copilot-instructions.md`, `docs/AUTOMATION_SETTINGS.md`, `docs/MANAGER_WORKFLOW.md`,
  `docs/GOOGLE_WORKSPACE_SMOKE_TEST.md`, and added post-merge audit sections to `docs/checkgates/GATE_1..6.md`.
- New: `docs/PRODUCTION_READINESS.md` (canonical gate, **NOT APPROVED FOR PRODUCTION**),
  `docs/SECURITY_MODEL.md`, `docs/OPERATIONS_RUNBOOK.md`,
  `docs/checkgates/SECURITY_HARDENING.md`, `docs/checkgates/AUTOMATION_HARDENING.md`,
  `docs/checkgates/CORRECTNESS_HARDENING.md`.

Tests: 105 local tests pass (84 before hardening + 21 new). No live Google Workspace verification is claimed.

## V1.1 — Management usability, reliability & automation controls

Schema version 3, migration `003_management_reliability` (additive; each approved migration takes its own verified
backup).

Unknown effort and approval

- `Estimated_Hours` defaults to blank (unknown) in `TASKS`/`SUBPROJECTS`; `0` is a deliberate zero. Existing values
  are never rewritten.
- Workload, dashboards, progress and the weekly report count unknown estimates separately.
- Assignment approval and schedule confirmation are separate concepts; deadline-only assignment is supported.
- `ScheduleConfirmations` records versioned confirmations per task; date/estimate changes supersede them without
  deleting history.
- Progress updates no longer require or revoke approval; material assignment changes still do.

Policy, progress and health

- `Eligibility.gs` is the single policy for active work, notifications and archived/cancelled exclusion.
- `Progress.gs` provides effort-weighted rollups with the documented fallback weight 1 and `未計算` for empty
  projects.
- `Health.gs` provides deterministic health labels, reason codes and configurable thresholds; unknown schedule is
  never green.
- Project `Last_Updated` is maintained by application changes and never by dashboard refreshes.

Views and workload

- New generated views: `PROJECT_OVERVIEW`, `TEAM_VIEW`, `AUTOMATION_STATUS`; rewritten `DASHBOARD`,
  `GANTT_OVERVIEW`, `TIMELINE_DATA`, `WORKLOAD`.
- Portfolio/detailed Gantt fallback keeps unscheduled tasks visible.
- Workload separates planned and actual hours, flags over-capacity members and excludes archived work.

Manager UI and roles

- Container-bound Japanese manager UI (`Ui.gs`, `UiMenu.html`, `UiSettings.html`, `UiSystem.html`) with menu,
  task assignment, progress, members, skills, issues, milestones, automation settings and system status.
- `Roles.gs` (`ADMIN`/`MANAGER`/`MEMBER`/`VIEWER`) enforced server-side; blank roles fail closed to `VIEWER`.
- Skill assessment metadata and advisory gap detection.
- `.claspignore` packages HTML templates; source validation enforces it.

Automation control center

- New `AUTOMATION_SETTINGS` table with validated, audited, deployment-independent manager preferences.
- OFF/PREVIEW/LIVE mail mode with a single effective-mode resolver, emergency stop and preflight.
- Per-feature, per-project and per-task notification switches with most-restrictive-wins semantics.
- Configurable reminder offsets, bounded catch-up, overdue frequency, weekday-only sending and JST execution
  window.
- Weekly management report with deduplication and empty-report suppression.
- Calendar and daily-backup switches; migration backups remain unconditional.
- Notification states include `PREVIEW` and `DELIVERY_UNCERTAIN`; ambiguous delivery is never retried
  automatically. `reconcileUncertain` records administrative reconciliation.
- Trigger diagnostics for installed, missing and duplicated handlers.

Planning

- `PROJECT_PHASES` persists versioned per-project plans; re-planning one project cannot replace another.

Repository

- New documentation: `docs/AUTOMATION_SETTINGS.md`, `docs/MANAGER_WORKFLOW.md`,
  `docs/GOOGLE_WORKSPACE_SMOKE_TEST.md`, `docs/checkgates/GATE_1.md` … `GATE_6.md`.
- `AGENTS.md` extended with V1.1 mandatory rules; `.github/copilot-instructions.md` updated.

## Unreleased — initial implementation

- Introduced a new Google Sheets / Apps Script engineering project-management implementation.
- Added environment-bound configuration, explicit empty-workbook initialization, restricted Drive backups, and approved versioned schema migrations.
- Established schema version 1 and migration `002_task_assignment_safety` to version 2 for assignment-version approval and notification baselines.
- Added conservative email/Calendar defaults and local validation tooling.
- Documented isolated deployment, manual recovery, and contributor safety requirements.

No previous prototype, production deployment, benchmark, or live Google Workspace verification is included in this
release record. The V1.1 scale measurement is a local mock benchmark, not a Workspace benchmark.