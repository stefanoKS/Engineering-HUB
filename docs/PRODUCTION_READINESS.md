# Production readiness

**Release status: NOT APPROVED FOR PRODUCTION**

This is the canonical release gate for Engineering-HUB V1.1. The status may only be changed after recorded
evidence below supports it. A green local test run is **not** sufficient.

## 1. Identity

| Field | Value |
| --- | --- |
| Version | 1.2.0 (feature branch `feature/v1.2-shared-dashboard`) |
| Audited baseline SHA | `cc5b836002146632dbdfdf4f2c292082fb7573db` (V1.2 baseline) |
| Schema version | 4 (`004_shared_dashboard`, additive; approval + verified backup required) |
| Hardening commit | see the `fix/v1.1-production-hardening` branch head; recorded in the pull request |
| Date prepared | 2026-10-25 |

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
npm test          -> 105 tests, 105 pass, 0 fail (84 before hardening + 21 new)
npm run validate  -> 29 Apps Script files and manifest validated
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

## 5. Security gate status

- Role grants, self-elevation, last-admin protection, task ownership and cross-project scope are enforced
  server-side and covered by negative tests.
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
