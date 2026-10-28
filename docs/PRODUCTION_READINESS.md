# Production readiness

## Current assessment — V1.6 (2026-10-28)

**IMPLEMENTED — DEV MIGRATION AND WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

Version 1.6.0; schema **7** (`007_responsibility_hierarchy_and_lifecycle`); employee contract **1.5**. Starting SHA:
`c769cb5006b13130e1358df3cbad436068a3c3f8`. The delivery SHA is recorded in
[V1_6_GATE_12.md](checkgates/V1_6_GATE_12.md).

| Field | Value |
| --- | --- |
| Version | 1.6.0 |
| Schema version | 7 |
| Employee contract | 1.5 |
| Local tests | **462 tests, 462 pass, 0 fail, 0 skipped** (`npm test`); `npm run lint` and `npm run validate` green |
| Google Workspace verification | **UNVERIFIED** — nothing in this repository has been run against a real Workspace |

V1.6 makes responsibilities the top organisational level (colour, owner, counts, weighted progress, a global filter
that stays local), nests subprojects to four levels and tasks to three (a container is never counted as extra work),
routes every completion through a manager approval (with a separately audited ADMIN correction), adds a narrow
ADMIN-only deletion of mistaken empty records, adds member current/previous/activity views, and publishes contract
1.5. Schema, authorization, revisions, audit, publication safety, the sidebar and the employee app are otherwise
unchanged.

All twelve V1.6 checkgates record local PASS results and the release stays **BLOCKED** for live verification. Required
remaining work: the DEV migration of a real workbook with its verified backup and preservation checks; the real
ADMIN/MANAGER/denied-account identity matrix; A sharing isolation; the complete DEV CRUD/request/publication/audit
workflow including the employee→manager completion round trip and the request inbox; a live rollback rehearsal; the
actual 200 % browser zoom and assistive-technology checks; and real Workspace latency plus long-session memory
measurement. **No live Workspace run of any kind was performed in this repository session, no workbook was migrated
and nothing was deployed.** The measured numbers in [MANAGER_WEB_APP_PERFORMANCE.md](MANAGER_WEB_APP_PERFORMANCE.md)
are mock values; the raw file records `liveWorkspace: NOT_RUN`.

Use the existing DEVELOPMENT resources described by the operator; their actual creation/sharing/deployment state was
not inspected here. No code was uploaded with clasp, no live deployment/data/migration/trigger/email/Calendar action
was performed. Follow [the V1.6 runbook](V1_6_DEPLOYMENT_RUNBOOK.md), [DEV installation](MANAGER_WEB_APP_DEPLOYMENT.md)
and [the smoke plan](MANAGER_WEB_APP_SMOKE_TEST.md). No production activation without reviewed evidence.

## Historical V1.5.1 assessment

Version 1.5.1; schema 6; employee contract 1.4. Starting SHA: adde446e856f992d16aca18b116489126b9a57c7. Local
results at that release: 406 tests, 406 pass, 0 fail, 0 skipped. Its ten checkgates record local PASS results and the
release stayed BLOCKED for live verification.

V1.5.1 changed only how the manager page obtains and refreshes data: one authorized snapshot (`bootstrap`) plus a
compact task index, an in-memory store with stale-while-revalidate, local filtering with an authoritative server
search, selective invalidation after writes, and revocation handling. Its measured speed figures are mock values; no
live Workspace latency was measured.

## Historical V1.5 assessment

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

Version 1.5.0; schema 6; employee contract 1.4. Starting SHA: 5c1143edef3f8ba74ce92219a59ea58723847941. Final source/evidence SHA is recorded in [V1_5_GATE_10.md](checkgates/V1_5_GATE_10.md).

Actual local results: 387 tests, 387 pass, 0 fail, 0 skipped; npm ci/lint/validate exit 0; validator covers 35 manager files, 3 employee files and 689 translation keys.

After the review correction described in [V1_5_GATE_10.md](checkgates/V1_5_GATE_10.md) §14 the browser derives project progress/health from current rows, a deadline-only task keeps an unknown planned start and the project cards expose an accessible progress bar. Those are local results only; nothing about the live Workspace assessment changed.

All ten V1.5 checkgates are **BLOCKED** because their complete acceptance criteria include unexecuted real Workspace or accessibility/timing verification.

Use the existing DEVELOPMENT resources described by the operator; their actual creation/sharing/deployment state was not inspected here. No code was uploaded with clasp, no live deployment/data/migration/trigger/email/Calendar action was performed. Follow [DEV installation](MANAGER_WEB_APP_DEPLOYMENT.md) and [20 live tests](MANAGER_WEB_APP_SMOKE_TEST.md). No production activation without reviewed evidence.

## Historical V1.4.1 assessment

The following sections are retained historical evidence; environment statuses and counts were not reverified for V1.5.


**Release status: NOT APPROVED FOR PRODUCTION**

This is the canonical release gate for Engineering-HUB V1.4. The status may only be changed after recorded
evidence below supports it. A green local test run is **not** sufficient.

## 1. Identity

| Field | Value |
| --- | --- |
| Version | 1.4.1 (simplified authorization and pre-trial hardening on `main`) |
| Audited baseline SHA | `eda32ee` (V1.4 responsibilities, hierarchy and UI refinement) |
| Schema version | 6 (`006_responsibilities_and_nested_subprojects`, additive; approval + verified backup required) |
| Dashboard contract | 1.4 (unchanged by V1.4.1) |
| Hardening commit | see the local V1.4.1 working-tree changes recorded in the V1.4.1 check gates |
| Date prepared | 2026-10-27 |

V1.4.1 was verified with local mocks and a static browser preview only. Nothing was initialized,
migrated, published, deployed or e-mailed against Google Workspace, so the release status remains
**NOT APPROVED FOR PRODUCTION** and every live item stays **UNVERIFIED**. The open items are listed
in [checkgates/V1_4_1_GATE_6.md](checkgates/V1_4_1_GATE_6.md).

## 2. Deployment environment

| Environment | Apps Script project | Spreadsheet | Status |
| --- | --- | --- | --- |
| Development | to be created (container-bound) | to be created | NOT CREATED |
| Production | to be created (container-bound) | to be created | NOT CREATED |

No real Google Workspace resource was created, changed or inspected while preparing this document.

## 3. Local validation

```text
npm ci            -> lockfile install, 0 vulnerabilities
npm run lint      -> pass
npm test          -> 328 tests, 328 pass, 0 fail, 0 skipped
                     (V1.4.1 adds 18 stabilization tests; the 310 V1.4 tests still run)
npm run validate  -> 33 Apps Script files, 3 dashboard files, both manifests and 532 translation keys validated
npm run preview:dashboard -> static preview written (browser-only, not Workspace evidence)
```

Local validation covers mocked Google services only. It does not prove OAuth consent, permission inheritance,
quota behaviour, trigger timing, or mail delivery.

## 4. Gate status

| Gate | Scope | Result | Evidence |
| --- | --- | --- | --- |
| A | Security and authorization | PASS (local) | [SECURITY_HARDENING.md](checkgates/SECURITY_HARDENING.md) |
| B | Automation safety and scheduling | PASS (local) | [AUTOMATION_HARDENING.md](checkgates/AUTOMATION_HARDENING.md) |
| C | Management correctness | PASS (local) | [CORRECTNESS_HARDENING.md](checkgates/CORRECTNESS_HARDENING.md) |
| D | Documentation | PASS (files updated/created, none verified live) | this document and the linked guides |
| E | Final release assessment | LOCAL PASS / LIVE UNVERIFIED | below |
| V1.2-1 | Architecture and data contract | PASS (local) | [V1_2_GATE_1.md](checkgates/V1_2_GATE_1.md) |
| V1.2-2 | Snapshot publication | PASS (local) | [V1_2_GATE_2.md](checkgates/V1_2_GATE_2.md) |
| V1.2-3 | Visual web dashboard | PASS (local) / LIVE UNVERIFIED | [V1_2_GATE_3.md](checkgates/V1_2_GATE_3.md) |
| V1.2-4 | Security and integration | LOCAL PASS / WORKSPACE UNVERIFIED | [V1_2_GATE_4.md](checkgates/V1_2_GATE_4.md) |
| V1.2-5 | Tests, documentation and deployment | PASS (local) | [V1_2_GATE_5.md](checkgates/V1_2_GATE_5.md) |
| V1.3-1 … V1.3-7 | Planning, requests, localization, release | PASS (local) | `checkgates/V1_3_GATE_1..7.md` |
| V1.3.1-1 | Project creation and visibility | PASS (local) | [V1_3_1_GATE_1.md](checkgates/V1_3_1_GATE_1.md) |
| V1.3.1-2 | Project and task editing | PASS (local) | [V1_3_1_GATE_2.md](checkgates/V1_3_1_GATE_2.md) |
| V1.3.1-3 | Request import simplification | PASS (local) | [V1_3_1_GATE_3.md](checkgates/V1_3_1_GATE_3.md) |
| V1.3.1-4 | Safety and trial configuration | PASS (local) / LIVE UNVERIFIED | [V1_3_1_GATE_4.md](checkgates/V1_3_1_GATE_4.md) |
| V1.3.1-5 | UI polish | PASS (local) / browser-unverified | [V1_3_1_GATE_5.md](checkgates/V1_3_1_GATE_5.md) |
| V1.3.1-6 | Installation and trial documentation | PASS (files updated) | [V1_3_1_GATE_6.md](checkgates/V1_3_1_GATE_6.md) |
| V1.3.1-7 | Final automated verification | PASS (local) / Workspace UNVERIFIED | [V1_3_1_GATE_7.md](checkgates/V1_3_1_GATE_7.md) |
| V1.4-1 … V1.4-6 | Responsibilities, hierarchy, UI, dashboard, release | PASS (local) | `checkgates/V1_4_GATE_1..6.md` |
| V1.4.1-1 | Simplified authorization policy | PASS (local) / Workspace UNVERIFIED | [V1_4_1_GATE_1.md](checkgates/V1_4_1_GATE_1.md) |
| V1.4.1-2 | Responsibilities, coordinated project edit, subproject consistency | PASS (local) | [V1_4_1_GATE_2.md](checkgates/V1_4_1_GATE_2.md) |
| V1.4.1-3 | Hierarchy safety, eligibility and calculations | PASS (local) | [V1_4_1_GATE_3.md](checkgates/V1_4_1_GATE_3.md) |
| V1.4.1-4 | UI, accessibility and task scale | PASS (local) / Sheets-unverified | [V1_4_1_GATE_4.md](checkgates/V1_4_1_GATE_4.md) |
| V1.4.1-5 | Dashboard contract, requests and reliability | PASS (local) / LIVE UNVERIFIED | [V1_4_1_GATE_5.md](checkgates/V1_4_1_GATE_5.md) |
| V1.4.1-6 | Documentation, installation and release assessment | PASS (files updated) / Workspace UNVERIFIED | [V1_4_1_GATE_6.md](checkgates/V1_4_1_GATE_6.md) |

## 5. Security gate status

- Role grants, self-elevation, last-admin protection, the MEMBER own-task boundary and the
  department-wide ADMIN/MANAGER scope are enforced server-side and covered by negative tests.
- Ownership columns (`Project_Owner_ID`, `Subproject.Owner_ID`, `Responsibility.Owner_Member_ID`)
  are accountability labels only; no write is gated by them. Only a responsibility owner change is
  reserved to ADMIN.
- Every record-mutating top-level Apps Script function re-checks the verified role, so a direct
  `google.script.run` or editor call cannot bypass a sidebar guard.
- Operational text is rendered with `textContent`; `npm run validate` rejects `innerHTML`/`insertAdjacentHTML`/
  `document.write` in any template.
- First-administrator bootstrap is one-time, allowlisted, audited and refused on an operational workbook.
- No secrets, OAuth tokens, real spreadsheet/script IDs or employee data exist in the source or tests.

## 6. Data integrity gate status

- Version 2 → 3 upgrade preserves every pre-existing operational cell, ID, skill record, notification row,
  custom column and formula (asserted cell by cell, twice: wide fixture and populated fixture).
- Version 3 → 4 (`004_shared_dashboard`) is additive and is covered by the same cell-by-cell preservation
  assertions in `tests/core.test.js`, `tests/gate-c-correctness.test.js`, `tests/gate6-release.test.js` and
  `tests/v1_2-model.test.js`. It publishes nothing: migrated projects stay `RESTRICTED` until reviewed.
- Only generated sheets are replaceable; operational tables are never cleared. The V1.2 snapshot workbook is a
  separate spreadsheet and is written only through the A/B publication path.
- Migration backups remain unconditional and cannot be bypassed by the daily-backup switch.
- V1.3.1 editing is additive: `Ui.updateProject` and `Ui.assignTask` write partial patches through the validated
  domain services, keep every ID and the original deadline, and refuse a save when the record changed after the
  form was loaded. No new table, column or migration was added.

## 7. Automation gate status

- Effective mail mode is resolved once, fail-closed: an unmigrated workbook stays `OFF` unless the deployment
  sets `ALLOW_LEGACY_EMAIL_CONFIG=true`.
- LIVE activation (including clearing the emergency stop) requires ADMIN, confirmation and preflight.
- Emergency stop and OFF remain immediately available to managers without confirmation.
- Weekly report day/time/enabled state drive the installed trigger; drift is detected and managed triggers are
  recreated without touching unrelated triggers or creating duplicates.
- Ledger, deduplication, per-run cap, per-project/per-task switches and no-blind-retry behaviour are unchanged.

## 8. Live Google Workspace status

**UNVERIFIED.** No live test has been executed or claimed. Follow
[GOOGLE_WORKSPACE_SMOKE_TEST.md](GOOGLE_WORKSPACE_SMOKE_TEST.md) in the development environment and record the
results there. Every item starts as UNVERIFIED.

### 8.1 Shared dashboard (V1.2)

The dashboard is designed, unit-tested with mocked Google services and rendered in a real
Chromium session from a static preview. **No Workspace behaviour is verified:**

- Deployment ACL (`access: DOMAIN`), execute-as-deployer behaviour and viewer identity
  resolution: UNVERIFIED.
- Drive ACLs for the snapshot workbook and the deployment account: UNVERIFIED.
- Scheduled publication trigger, publication latency and CacheService behaviour: UNVERIFIED.
- Real payload size and latency at 100 projects / 5 000 tasks: UNVERIFIED (mock measurements
  are not evidence).
- Emergency disable, rollback and failure recovery in a live deployment: UNVERIFIED.

Record each item in [dashboard/SMOKE_TEST.md](dashboard/SMOKE_TEST.md).

## 9. Unresolved blockers

| # | Blocker | Owner | Resolution |
| --- | --- | --- | --- |
| 1 | No live Workspace execution (UI, roles, mail, triggers, Calendar, backup, restore) | Deployment owner | Complete the smoke test; attach results |
| 2 | Development and production projects/spreadsheets do not exist yet | Deployment owner | Create per [DEPLOYMENT.md](../DEPLOYMENT.md) §2 |
| 3 | Roles are blank after migration (`VIEWER` by default) | Deployment owner | Bootstrap the first ADMIN, then assign roles |
| 4 | Scale/quota behaviour on real Sheets is unmeasured | Deployment owner | Measure dashboard refresh and notification scan in development |
| 5 | Repository visibility not reviewed | Repository owner | Decide public/private; see [SECURITY_MODEL.md](SECURITY_MODEL.md) |
| 6 | Snapshot workbook, dashboard project and dashboard deployment do not exist | Deployment owner | Create per [dashboard/DEPLOYMENT.md](dashboard/DEPLOYMENT.md) |
| 7 | No project has been reviewed for `Dashboard_Visibility = INTERNAL` | Manager | Review each project and its `Dashboard_Summary` before enabling publication |
| 8 | Dashboard access model (domain ACL, execute-as-deployer identity) unverified | Deployment owner | Complete [dashboard/SMOKE_TEST.md](dashboard/SMOKE_TEST.md) sections A and C |
| 9 | Publication failure/recovery drill not executed live | Deployment owner | Execute smoke test section D |
| 10 | Request submissions are closed by default (`REQUEST_SUBMISSION_ENABLED` absent) | Operator | Enable submissions only after the inbox is initialized and reviewed |
| 11 | V1.3.1 sidebar behaviours (visibility controls, edit modes, auto-import) unverified in a real Workspace | Deployment owner | Execute `dashboard/SMOKE_TEST.md` E1–E11 and record evidence |
| 12 | V1.4.1 authorization, sidebar fit and task search unverified against a real Sheets sidebar | Deployment owner | Re-run the gate 1 and gate 4 checklist items in the development deployment with all four roles |

## 10. Backup and rollback readiness

- Backup creation requires a restricted Drive folder; the code verifies contents and formulas of the copy.
- No live backup has been created or restored.
- Rollback is manual: deploy the previous commit to the Apps Script project and, if data must move, restore into
  a new workbook and rebind configuration. `clasp push` never reverses a migration.
- See [BACKUP_RESTORE.md](../BACKUP_RESTORE.md) for the drill and sign-off record.

## 11. Approval

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Release owner | _not assigned_ | — | — |
| Operations owner | _not assigned_ | — | — |
| Security reviewer | _not assigned_ | — | — |

## 12. Go / No-Go

**NO-GO.** The application is locally validated but has no live Google Workspace evidence. Do not enable LIVE
email, publish the shared dashboard, install triggers against production, or migrate a production workbook until
the blockers above are resolved and this document is updated with recorded evidence.

Changing this document's status requires: a completed smoke test with results, a verified backup reference, a
completed restore drill, and a named approver.

## V1.3 status

Status: **NOT APPROVED FOR PRODUCTION** — V1.3 local gates pass, live verification is
**UNVERIFIED**.

| Area | Local | Live |
| --- | --- | --- |
| Branding `設計・開発課 管理` | PASS | UNVERIFIED |
| Deadline + duration planning | PASS | UNVERIFIED |
| Request submission (dashboard → inbox) | PASS (mocks) | UNVERIFIED |
| Manager import/approval/staleness | PASS (mocks) | UNVERIFIED |
| Completion reporting | PASS (mocks) | UNVERIFIED |
| Request notification switches (OFF/PREVIEW/LIVE) | PASS (mocks) | UNVERIFIED |
| Japanese/English UI | PASS (dictionary + client harness) | UNVERIFIED |
| Schema 5 migration and preservation | PASS (mocks) | UNVERIFIED |

Before any production use, an operator must record live evidence for: the migration on a
copy of the production workbook, the dashboard scope re-authorisation and domain
restriction, one real request end to end, the manager decision, the published snapshot with
contract `1.3`, and the language switch in a real browser. Local mock results are not
Workspace evidence.

