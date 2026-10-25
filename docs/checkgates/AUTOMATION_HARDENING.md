# Gate B — Automation safety & scheduling hardening

Status: **PASS (local tests)** — live Workspace behaviour remains UNVERIFIED.

## B1. LIVE email reactivation

Root cause: `AutomationSettings.save` only demanded the LIVE authorization when the *stored* `EMAIL_MODE` changed
to `LIVE`. Clearing `EMERGENCY_STOP` while `EMAIL_MODE` was already `LIVE` therefore re-activated delivery with no
ADMIN check, no confirmation and no preflight — and a MANAGER could do it.

Corrections:

- `AutomationSettings.resolve(config, values, isConfigured)` is the single effective-state resolver. `save` now
  evaluates the state *before* and *after* the change (plus the stored-mode change) and requires the LIVE
  authorization when:
  - the effective mode becomes `LIVE` (including clearing the emergency stop), or
  - the stored mode is being switched to `LIVE` for the first time.
- LIVE authorization = exact `ENABLE LIVE EMAIL` confirmation + verified ADMIN + passing preflight
  (`EMAIL_ENABLED`, `DRY_RUN`, allowed domains, notification activation, spreadsheet binding, execution window,
  emergency stop off).
- `EMAIL_LIVE_ACTIVATED` / `EMAIL_LIVE_DEACTIVATED` audit records are written with actor, previous/effective mode.
- OFF and emergency stop remain unconfirmed, single-step operations for any manager.

Tests: `tests/gate-b-automation-hardening.test.js`.

| Scenario | Result |
| --- | --- |
| LIVE → emergency stop → MANAGER restart | rejected (confirmation, then `Insufficient role: ADMIN`) |
| LIVE → emergency stop → ADMIN restart | allowed with confirmation + preflight; audited |
| OFF → LIVE with missing preflight requirements | rejected with the specific reason (`DRY_RUN`, domains, activation) |
| PREVIEW → LIVE without confirmation | rejected |
| Legacy flags conflicting with saved settings | saved settings win; legacy flags can only block, never enable |
| Repeated scans after restart | no duplicate delivery, ledger unchanged |

## B2. Legacy configuration handling

Root cause: a workbook without persisted automation settings fell back to `EMAIL_ENABLED`/`DRY_RUN`, so an
unmigrated workbook could send mail as soon as the legacy flags said so.

Corrections:

- Default: an unconfigured workbook resolves to `OFF` with reason `LEGACY_CONFIGURATION_BLOCKED` and every feature
  toggle off.
- Backward compatibility is an explicit, documented opt-in: `ALLOW_LEGACY_EMAIL_CONFIG=true`
  (`reason: LEGACY_CONFIGURATION_OPT_IN`). Only then do the legacy flags map to OFF/PREVIEW/LIVE.
- A version-3 migration still seeds safe `OFF` defaults, so an upgraded workbook cannot be activated by legacy
  flags.
- Legacy toggles are `false` while blocked, so no code path can send.

## B3. Weekly report scheduling

Root cause: `Triggers.install` hardcoded `atHour(8)` for the weekly handler, ignored `WEEKLY_REPORT_TIME`, never
recreated a trigger when the weekday changed, and never removed a weekly trigger after the feature was disabled.

Corrections:

- `Triggers.expectedSchedule()` derives the full schedule from settings: hourly scan, hourly management refresh,
  daily backup at 02:00, and — only when `WEEKLY_MANAGER_REPORT_ENABLED` — a weekly trigger on
  `WEEKLY_REPORT_DAY` at `WEEKLY_REPORT_TIME` (`nearMinute` is used because Apps Script fires approximately).
- The desired schedule is serialised into `MANAGED_TRIGGER_SIGNATURE` (Script Property). `install` compares the
  stored signature plus installed handlers and recreates **all managed triggers** when the schedule drifted, a
  duplicate exists, a managed handler is obsolete, or one is missing. Only the four managed handlers are ever
  deleted; unrelated triggers are preserved.
- `Triggers.diagnostics()` reports `scheduleMatches`, the expected and installed signatures, `missing` and
  `obsolete` handlers, plus a note that triggers run as their creator and fire approximately.
- Disabling the weekly report removes its trigger on the next installation and the handler itself returns
  `WEEKLY_REPORT_DISABLED` if it still fires.

Tests: day change, time change, enabled → disabled, unrelated trigger preserved, no duplicates, `scheduleMatches`
transitions, disabled report sends nothing.

## B4. Existing protections preserved

Unchanged and still covered by the pre-existing suite: OFF/PREVIEW/LIVE semantics, per-feature toggles,
per-project/per-task switches, domain allowlists, per-run cap, ledger states (`PENDING`/`SENT`/`PREVIEW`/
`DELIVERY_UNCERTAIN`), no automatic retry of uncertain delivery, no historical replay after re-enabling.

The two pre-existing tests that assumed the previous legacy behaviour were updated to opt into the documented
compatibility path (they assert the same delivery behaviour, now under an explicit flag); the default fail-closed
path is covered by new tests.

## Gate B acceptance

| Criterion | Result |
| --- | --- |
| All automation matrix tests pass | PASS (84 pre-existing + 7 new) |
| Unauthorized LIVE reactivation impossible | PASS |
| Weekly configuration reflects installed triggers | PASS |
| No unapproved or duplicated email generated | PASS |

## Remaining live verification

- Actual mail delivery, quota and trigger timing — UNVERIFIED.
- `nearMinute` behaviour and trigger drift detection against the real Triggers API — UNVERIFIED.
