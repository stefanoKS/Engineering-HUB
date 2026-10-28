# V1.5.1 gate 8 — Regression and security

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7
Implementation commit SHA: 6da346c (feat(manager-web): local-first navigation with an authorized snapshot)

## 1. Objective

Prove the performance work changed no data contract, no authorization rule and no operational
boundary.

## 2. Affected source files

`src/ManagerWeb.gs`, `src/ManagerWebClient.html`, `src/ManagerWebIndex.html`,
`src/ManagerWebStyles.html`, `src/Tasks.gs`, `src/SharedDashboardPublisher.gs` (version string only),
`shared/i18n.js` and its generated copies.

## 3. Exact acceptance criteria and result

- Schema V6 and employee contract 1.4 unchanged: PASS (asserted).
- Existing project/task/responsibility IDs, nested subprojects, planning, deadlines, progress and
  health calculations unchanged: PASS (existing suites unchanged and passing).
- Role authorization unchanged: PASS — `managerWebRead`/`managerWebWrite` still wrap
  `ManagerWeb.response`; every new operation runs through `ManagerWeb.authorize()`.
- Record revisions and request approval unchanged: PASS.
- Audit history unchanged: PASS (no write path was modified).
- Snapshot contract 1.4 and the employee dashboard unchanged: PASS.
- Manager sidebar unchanged: PASS (no file touched).
- Apps Script execute-as unchanged: manager `USER_ACCESSING`, employee `USER_DEPLOYING`: PASS.
- No private data exposed to MEMBER/VIEWER: PASS — they are refused by `Access.requireManager()`
  before any snapshot is built.
- No email, Calendar or trigger activation: PASS (`a.sentEmails`/`a.triggers` stay empty in tests).
- No live spreadsheet modified: PASS (no deployment or clasp push was performed).

## 4. Automated tests performed

Full suite: **406 tests, 406 pass, 0 fail, 0 skipped**, including the untouched V1.2–V1.5 suites
(dashboard publication, requests, planning, hierarchy, responsibilities, stabilization, web
authorization). New: `v1_5_1-performance.test.js` (14) and `v1_5_1-release.test.js` (5).

## 5. Manual tests performed

Preview browser with a synthetic admin: navigation, filters, language switch, form open/save, a
forced refresh failure (error banner + retry) and a revoked actor (access denied, cache cleared).

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate.

## 7. Actual results

Validator: 35 manager Apps Script files, 3 dashboard files, both manifests, 709 translation keys;
no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, no `MailApp.sendEmail` outside
`Notifications.gs`, no dashboard write surface. Authorization tests still refuse engineer, viewer,
missing identity, wrong domain and deactivated manager. Role spoofing, unknown actions, stale
revisions and cross-record edits remain refused.

## 8. Relevant logs and evidence

[V1_5_1_VALIDATION.txt](V1_5_1_VALIDATION.txt),
[SECURITY_MODEL.md](../SECURITY_MODEL.md), [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md).

## 9. Identified problems

The snapshot makes previously "server-only" summaries available in browser memory for the session,
which is a privacy trade-off that had to be justified and bounded.

## 10. Corrective actions

Only allowlisted summary fields are sent; descriptions, acceptance criteria, estimates, notes and
request text stay server-side; nothing is persisted; revocation clears memory and drafts; the
datasets are bounded and all-or-nothing. Recorded here and in the performance document.

## 11. Remaining limitations

Browser memory cannot be wiped by the server on demand — revocation only clears it when a request
fails. Google Sheets editor access is still not a security boundary (see `SECURITY_MODEL.md`).

## 12. Final gate status

**PASS** locally. **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR
PRODUCTION.**
