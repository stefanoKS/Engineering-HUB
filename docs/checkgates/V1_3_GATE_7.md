# V1.3 Gate 7 — Tests and documentation

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

## Evidence

Commands run in this repository:

```
npm ci
npm run lint
npm test
npm run validate
```

New regression suites:

| Suite | Covers |
| --- | --- |
| `tests/v1_3-planning.test.js` | duration/deadline calculation, working vs calendar days, holidays, off-by-one, warnings, legacy rows, no hour conversion, project deadline preservation, allowed overlap, additive migration preservation |
| `tests/v1_3-requests.test.js` | any-worker request, restricted filtering, invalid input, duplicates, rate limit, approval once, rejection/return, staleness, interrupted recovery, completion reporting, import idempotency, mail OFF, inbox initialisation |
| `tests/v1_3-automation.test.js` | OFF/PREVIEW/LIVE matrix, per-feature toggles, emergency stop, dedupe, recipient validation, pending reminder |
| `tests/v1_3-i18n.test.js` | Japanese default, English selection, label switching without losing state, stored text untouched, reasons stored canonically, switch on every screen, request forms, no login UI, no-storage fallback |
| `tests/v1_3-ui.test.js` | manager planning preview (no write), duration assignment, invalid duration, manager-only queue/import/decision, no secret exposure in sidebars |
| `tests/v1_3-release.test.js` | documentation and gate presence, no credentials, manifests and scopes, generated dictionary sync |

Documentation delivered:

* Updated: `README.md`, `README_JP.md`, `AGENTS.md`, `.github/copilot-instructions.md`,
  `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `DEPLOYMENT.md`, `CHANGELOG.md`,
  `docs/SECURITY_MODEL.md`, `docs/PRODUCTION_READINESS.md`, `docs/MANAGER_WORKFLOW.md`,
  `docs/AUTOMATION_SETTINGS.md`, `docs/dashboard/ARCHITECTURE.md`,
  `docs/dashboard/VISUAL_SPEC.md`, `docs/dashboard/ACCESS_AND_SHARING.md`,
  `docs/dashboard/DEPLOYMENT.md`, `docs/dashboard/SMOKE_TEST.md`,
  `docs/dashboard/DATA_CONTRACT.md`.
* Created: `docs/UI_LOCALIZATION.md`, `docs/TASK_DURATION_POLICY.md`,
  `docs/DEADLINE_REQUEST_WORKFLOW.md`, `docs/REQUEST_INBOX_DEPLOYMENT.md`,
  `docs/checkgates/V1_3_GATE_1..7.md`.

## Live tests still required

1. Migration `005` on a copy of the production workbook (backup, preservation, no rewrite).
2. Dashboard scope re-authorisation and domain-restricted access check.
3. One real request end to end: submit → import → approve → publish → view.
4. Notification OFF/PREVIEW/LIVE with a real mailbox and an allowed domain.
5. Language switch in a real browser for both roles.
6. Trigger reinstallation check after the deployment changes.

No production data was changed while producing this gate.
