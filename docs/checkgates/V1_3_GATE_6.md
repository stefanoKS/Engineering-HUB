# V1.3 Gate 6 — Automation and dashboard

Scope: request notification switches, the centralized send gate and what the published
snapshot exposes.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| Email OFF sends no messages | PASS | `AutomationSettings` defaults; `tests/v1_3-automation.test.js` |
| PREVIEW sends no real mail | PASS | mailer preview path; ledger result `PREVIEW` |
| Request notifications can be disabled independently | PASS | `DEADLINE_REQUEST_EMAIL_ENABLED`, `COMPLETION_REPORT_EMAIL_ENABLED`, `PENDING_REQUEST_REMINDER_ENABLED`, all default `false` |
| Emergency stop, allowed domains, dedupe ledger, per-run cap and uncertain delivery preserved | PASS | unchanged `Notifications.gs` gate; existing automation suites pass |
| Published deadlines match authoritative records | PASS | publication reads `TASKS` through `SharedDashboardModel` after the decision |
| A pending request cannot masquerade as an approval | PASS | pending state never writes `Due_Date`; the dashboard shows a pending indicator next to the unchanged deadline |
| No private request text leaks to the public dashboard | PASS | the snapshot publishes only the boolean `pendingRequest`; `TASK_PUBLIC_FIELDS` allowlist asserted by tests |
| `MailApp.sendEmail` stays centralized | PASS | `npm run validate` rejects it outside `src/Notifications.gs` |

## Evidence

* `node --test tests/v1_3-automation.test.js`
* `npm run validate` (send-gate and allowlist checks)
* Snapshot contract `1.3` adds `revision` and `pendingRequest` to the published task
  allowlist; no other field is added.

## Notes and limits

Real mail delivery, scheduling and Workspace ACL behaviour are UNVERIFIED locally. Exactly
once delivery is never promised; ambiguous deliveries are recorded and require manual
reconciliation.
