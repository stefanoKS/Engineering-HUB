# Changelog

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