# V1.6 gate 8 — Filtering, sorting and member history

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: 34a2bf1

## 1. Objective

Make work findable by responsibility, project, subproject, task hierarchy, member, status, deadline and priority,
and give each member an honest current/previous/activity view.

## 2. Relevant source files

`src/ManagerWeb.gs` (`memberProfile`, task filters, task index columns), `src/ManagerWebClient.html`
(member list, member profile view, filter bar, hierarchy indentation), `shared/i18n.js` (labels),
`src/ManagerWebStyles.html`, `dashboard-app/DataService.gs` (employee sorting/filtering source),
`dashboard-app/Client.html`.

## 3. Required functionality

1. Manager views: by responsibility, by project and by member.
2. Member profile: current work, previous (completed) work with original/actual dates and acceptance, and activity.
3. History uses immutable IDs and the existing append-only records; no event is invented.
4. A typed requester name never attributes work; unverified identity stays labelled.
5. The employee dashboard can sort/filter published projects and tasks and shows a sanitized task history.

## 4. Acceptance criteria

- Completed, approved work appears in previous work with `completedAt`/`acceptedAt`.
- A pending or unapproved report never appears as history.
- Filtering uses the local snapshot and stays inside the performance targets.
- Nothing private (audit detail, e-mail, capacity) is published.

## 5. Automated test cases

`tests/v1_6-member-history.test.js` (profile sections, real audit rows, approved completion, typed-name refusal,
member view reachable), `tests/v1_6-responsibilities.test.js` (filters), `tests/v1_6-hierarchy.test.js`
(task index), `tests/v1_5-web.test.js` (local filter parity), `tests/v1_2-dashboard.test.js` (published fields).

## 6. Actual test results

PASS locally. Activity entries are `AUDIT_LOG` (`TASK`/`TASKS`) and `TASK_DEADLINE_HISTORY` rows only; the view
states when no record exists instead of reconstructing one.

## 7. Manual test cases (DEV, not executed)

1. Open メンバー → a member: current work, previous work and history render.
2. Filter tasks by priority and by top-level only; confirm counts.
3. In the employee app, sort by deadline and filter by responsibility/status.
4. Confirm a completion note never appears in the employee history.

## 8. Performance results

Member profile is a bounded server read (one member, cached tables). Task filters run locally: local filtering p50
0.07–1.50 ms. Adding `priority`/`treeScope` filters costs no extra RPC.

## 9. Security review

The profile is manager-only (`ManagerWeb.authorize`). It reads audit rows but never returns e-mail addresses,
capacity or Script Properties. The employee app publishes only the allowlisted history fields
(`completedAt`, `reviewState`).

## 10. Problems found

`AuditLog.record` stores the table name (`TASKS`) while explicit actions store `TASK`; the profile originally
filtered only `TASK` and showed no activity. Both are now accepted.

## 11. Corrective actions

Filter widened and covered by a test that asserts the recorded actor is the verified account.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live member-history verification is **BLOCKED** (no DEV data). Historical attribution older than the audit log is
reported as unavailable, never guessed.

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA 34a2bf1.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
