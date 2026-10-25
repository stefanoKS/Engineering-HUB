# Gate 6 — Validation, security & release readiness

Status: **PASS (local automation) / LIVE VERIFICATION REQUIRED (Google Workspace smoke test)**

## 6.1 Regression and new tests

Commands (Node.js 22, PowerShell):

```powershell
npm ci
npm run lint
npm test
npm run validate
```

Results for this branch (`feature/v1.1-management-reliability`):

```text
npm ci            -> lockfile install, 0 vulnerabilities
npm run lint      -> pass (eslint, no warnings)
npm test          -> 84 tests, 84 pass, 0 fail
npm run validate  -> Validated 28 Apps Script files and manifest
```

Test files:

| File | Purpose |
| --- | --- |
| `tests/core.test.js` | Environment binding, initialization, migrations, backups, header-based updates |
| `tests/domain.test.js` | Projects/subprojects/tasks/issues/milestones/skills/planning rules |
| `tests/automation.test.js` | Activation, approval, dry-run, dedupe, summaries, Calendar, triggers |
| `tests/gate1-safety.test.js` | Unknown estimates, deadline-only approval, schedule confirmation, eligibility, freshness |
| `tests/gate2-progress.test.js` | Effort-weighted progress, health, staleness, plan persistence |
| `tests/gate3-views.test.js` | Portfolio/attention metrics, Gantt fallback, workload, generated protection |
| `tests/gate4-ui.test.js` | Role enforcement, UI domain delegation, skills, deactivation, HTML packaging |
| `tests/gate5-automation.test.js` | Every automation toggle, mode matrix, reminders, weekly report, reliability, triggers |
| `tests/gate6-release.test.js` | Data preservation, scale benchmark, security scan, safe defaults |

The original 41 tests were kept and still pass. Three assertions were updated for the deliberate schema change:
the schema version is now 3, both migrations are approved in the fixture, and two verified backups are expected
because each approved migration takes its own backup. No test was removed or weakened.

## 6.2 Data preservation

`tests/gate6-release.test.js` builds a fictional workbook with projects, subprojects, direct project tasks,
assigned members, skill assessments, completed tasks, an archived project, notification history, a custom column
and a formula. It then emulates a version-2 workbook, snapshots every cell, runs the approved version-3 upgrade
and compares every pre-existing value and formula.

Result: **PASS** — no operational value changed; only the intended schema elements and the migration/backup logs
differ. Existing members are not silently promoted (blank role → `VIEWER`).

## 6.3 Scale benchmark (local mock only)

Fictional data: 100 projects, 500 subprojects, 5,000 tasks, 100 members, 100 milestones, 50 issues.

The test prints measured timings for dashboard refresh, analysis, workload, progress rollup and notification scan,
and asserts generous ceilings (no live performance claim). Observed locally in the mock runtime on the development
machine:

| Operation | Observed | Ceiling asserted |
| --- | --- | --- |
| Dashboard refresh | ~738 ms | < 30 s |
| Management analysis | ~721 ms | < 20 s |
| Workload calculation | ~519 ms | < 15 s |
| Progress rollup | ~30 ms | < 15 s |
| Notification scan (OFF mode, baseline reconciliation) | ~114 ms | < 30 s |

These numbers describe the in-memory mocks only.

**Not verified:** real Apps Script execution limits (6-minute execution, 30 s script lock, Sheets read/write
latency), mail quotas, trigger delays. Measure these in development before enabling automation.

## 6.4 Security review

| Check | Result | Evidence |
| --- | --- | --- |
| No hardcoded credentials | PASS | `tests/gate6-release.test.js` scans `src/` for keys, tokens, API keys |
| No committed OAuth tokens / clasp config | PASS | same test, `.gitignore` |
| No private employee data in tests | PASS | fictional `@example.test` identities only |
| No automatic external sends | PASS | defaults OFF, activation required, test matrix |
| No unvalidated manager settings | PASS | typed validation + audit, `tests/gate5-automation.test.js` |
| No direct public UI write endpoint | PASS | `google.script.run` bridges call validated domain services and role checks |
| No arbitrary recipient domains | PASS | `ALLOWED_RECIPIENT_DOMAINS` checked at save and send |
| No unrestricted Calendar modifications | PASS | dedicated secondary calendar, ownership marker, hash, no deletion |
| No unapproved destructive operations | PASS | `npm run validate` destructive-API scan; no reset/restore path |

Repository visibility: this repository may be publicly accessible. Moving it to a private repository is a manual,
reviewed operation performed by the owner, not something this code changes:

1. Confirm that no credentials, real spreadsheet/script/calendar IDs, employee data or exported logs exist in the
   current history (not only the working tree).
2. GitHub → **Settings → General → Danger Zone → Change visibility → Make private**; confirm the repository name.
3. Review forks, deploy keys, webhooks, Actions secrets and installed GitHub Apps for the repository.
4. Notify collaborators, then rotate anything that may have been exposed while public.

If the repository stays public, keep all real IDs, employee data and configuration out of Git.

## 6.5 Live integration checklist

See [GOOGLE_WORKSPACE_SMOKE_TEST.md](../GOOGLE_WORKSPACE_SMOKE_TEST.md). It covers the development project and
spreadsheet, clasp target, Script Properties, execution account, manager UI, data preservation, protected columns,
email preview, one authorized test email, notification triggers, Calendar sync, backup creation and a backup
restore drill. Email and Calendar are never enabled by setup.

## 6.6 Documentation

Created: [AUTOMATION_SETTINGS.md](../AUTOMATION_SETTINGS.md), [MANAGER_WORKFLOW.md](../MANAGER_WORKFLOW.md),
[GOOGLE_WORKSPACE_SMOKE_TEST.md](../GOOGLE_WORKSPACE_SMOKE_TEST.md), `docs/checkgates/GATE_1.md` … `GATE_6.md`.

Updated: `README.md`, `README_JP.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `DEPLOYMENT.md`,
`BACKUP_RESTORE.md`, `AGENTS.md`, `CHANGELOG.md`, `.github/copilot-instructions.md`.

## 6.7 Repository instructions

`AGENTS.md` and `.github/copilot-instructions.md` gained the V1.1 mandatory rules: safe feature defaults,
settings persisted outside source, centralized send authorization, no private configuration in the UI, audit
records for automation activation, regression tests for notification changes, validated UI operations, no
overwrite of operational data, and mandatory check gates for future large upgrades.

## Gate 6 checklist

| Check | Result |
| --- | --- |
| All existing tests pass | PASS (41 original) |
| All new tests pass | PASS |
| Lint passes | PASS |
| Source validation passes | PASS |
| Data-preservation comparisons pass | PASS |
| No unauthorized external side effects | PASS (mocks prove zero mail/Calendar/trigger effects by default) |
| UI architecture is deployable | PASS (design) / LIVE VERIFICATION REQUIRED |
| Configuration defaults are safe | PASS |
| Deployment instructions are complete | PASS (plus new settings and smoke-test docs) |
| Google Workspace smoke tests are documented | PASS |
| Unverified live behaviour is clearly identified | PASS (this document and every gate report) |

## Known limitations

- No live Google Workspace execution, permission inheritance, OAuth consent, quota or trigger timing has been
  verified. All functional evidence is from local mocks.
- The scale benchmark is a mock measurement, not a Workspace benchmark.
- Health, progress and workload are documented heuristics, not forecasting or resource-constrained scheduling.
- Email delivery is at-most-once from the application's perspective and never promises exactly-once.
- Installed triggers run as their creator; another editor may not see or repair them.
- A bound spreadsheet shared with untrusted editors cannot separate roles securely; V1.1 assumes trusted managers.
- Native Google Sheets Timeline is not created automatically.

## Post-merge audit (production hardening)

The local PASS results recorded above are unchanged, but they describe **local mocks only**. They were never, and
must not be presented as, live Google Workspace acceptance.

Previously undiscovered issues: the security defects in Gate 4 (role escalation, task ownership, unsafe HTML,
member visibility), the automation defects in Gate 5 (unauthorized LIVE reactivation, fail-open legacy
configuration, hardcoded weekly schedule), and the correctness defects in Gates 2–3 (`Health.staleDays`,
`projectsUnknownSchedule`).

Corrections shipped with regression tests (105 passing locally, 84 before):

- `src/Access.gs`, `src/Members.gs`, `src/Ui.gs`, `src/UiSafe.html`, template inclusion and source validation.
- `src/AutomationSettings.gs` effective-state resolver, `src/Triggers.gs` schedule derivation and drift detection.
- `src/Health.gs` result structure, `src/Dashboard.gs` attention categories.
- New suites: `tests/gate-a-security.test.js`, `tests/gate-b-automation-hardening.test.js`,
  `tests/gate-c-correctness.test.js`.

Release status: [docs/PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) remains **NOT APPROVED FOR PRODUCTION**.
Remaining requirement: execute [docs/GOOGLE_WORKSPACE_SMOKE_TEST.md](../GOOGLE_WORKSPACE_SMOKE_TEST.md) and record
evidence; no live test has been performed.
