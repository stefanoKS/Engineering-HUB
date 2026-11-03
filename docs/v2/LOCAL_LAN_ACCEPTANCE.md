# Local LAN acceptance — 2026-11-02

**NOT APPROVED FOR PRODUCTION.** This change is implemented in the local checkout; no deployment or company database migration was performed.

- Schema: additive 0007_local_accounts.sql; existing Google accounts, IDs and prior migrations retained.

## Member self-service and completion approval — 2026-11-03

- Schema: additive 0008_member_created_work.sql (`tasks.created_by_member_id`, `tasks.creation_channel`
  defaulting to `LEGACY`, `task_requests.requester_member_id`). No existing column is rewritten; 0001–0007
  are unchanged, so an existing database applies exactly one new file.
- Member task creation: owner from the session, `Not Started`/0 %, idempotent replay, strict payload
  refusal (owner/assignee/status/parent), VIEWER refusal, archived-project refusal, cross-project
  subproject refusal.
- Completion requests: a pending request leaves the task unfinished; a MANAGER approval of a
  member-created task is refused and the request stays `PENDING`; an ADMIN approval writes `Done`;
  rejection leaves the task unfinished; another member's receipt is `404`.
- Regression at this change: V1 776/776 PASS; V2 177 passed, 1 skipped (skipped test needs pg_dump);
  typecheck, lint, validation, build, `smoke:prod` and Chromium smoke PASS.
- NOT_RUN: live Google Drive upload/download with a real service account, `pg_restore` from a
  downloaded file on the host, and the physical Windows-host checks.
- Local account tests: login/leading zeros, invalid credentials/role injection, required password changes, session revocation, CSRF/origin, admin provisioning/reset, lockout, deactivation and own-task progress.
- Backup tests: encrypted persistent local files, remote outage/retry, reuse of the same artifact and corruption rejection. Google API calls use mocks.
- Chromium production-mode LAN smoke: PASS for employee-ID login, project/subproject/task flows, admin creation of employee account, required first-login password change and role-specific employee screen.
- V1 regression: 776/776 PASS; V1 application sources unchanged.
- Typecheck, lint (V1/V2), validation and production build: PASS.
- V2 regression: 154 passed, 1 skipped across 15 files before the final session-mode isolation regression; the final focused session-mode test result is recorded below. The skipped test needs unavailable pg_dump tools.
- Existing browser smoke and production local-account browser smoke: PASS; built worker processed an outbox job.
- Final focused local-auth suite: 10/10 PASS, including rejection of local sessions after switching to Google mode; lint and build rerun PASS.
- Windows supervisor: syntax/lint checked; actual Windows service/task scheduling and reboot behavior remain unverified.
- NOT_RUN: installed PostgreSQL Windows service, host reboot/task scheduler, second-PC firewall routing, real pg_dump/pg_restore recovery, Google Drive authorization/upload/download, TLS host configuration.

HTTP LAN access requires explicit ALLOW_INSECURE_LAN_HTTP=true. It is not encrypted and is not suitable for public exposure. HTTPS remains the recommended operating configuration.

## Password policy update — 2026-11-03

At the operator’s request, local account creation, reset and change-password inputs now consistently accept 4–128 characters. Japanese/English labels and setup instructions match the API policy. Existing password hashes are unchanged. Boundary regression checks 3/4/128/129 characters and four-character reset/change flows against isolated PostgreSQL; 11 local-auth tests PASS. Production build PASS. Browser verification uses synthetic four-character credentials; no real account password was changed.

Chromium local onboarding PASS with four-character temporary/new passwords. LAN host rebuilt/restarted; readiness returns 200 and served UI contains 4–128 labels and matching input limits. Other-subnet connectivity still requires a client-side test.
