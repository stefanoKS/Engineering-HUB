# V1.5 DEVELOPMENT Workspace verification plan

**Status: NOT_RUN. NOT APPROVED FOR PRODUCTION.** No step below was executed against Workspace by this implementation task. Use the existing DEVELOPMENT A/B/C and existing separate manager/employee projects. Follow [DEV deployment](MANAGER_WEB_APP_DEPLOYMENT.md) first; do not initialize existing sheets, run migrations, install triggers or activate mail/Calendar. Use synthetic test records and preserve audit/history. Record deployment version/SHA and restricted backup reference privately.

For each numbered test record date, account role, operation, expected result, actual result, measured duration, PASS/FAIL, evidence and corrective action. Do not put real emails, private records or resource IDs into public Git evidence. A real failure reopens the relevant checkgate.

| Test | Account | Steps | Expected result | Actual / duration / status / evidence |
| --- | --- | --- | --- | --- |
| 1 | ADMIN | Open manager /exec with Sheets closed | Correct active actor and ADMIN; overview only; no external effects | Not executed / — / NOT_RUN / — |
| 2 | MANAGER | Open from a separate Workspace account/profile | Correct MANAGER actor, departmental records accessible | Not executed / — / NOT_RUN / — |
| 3 | Denied accounts | Try MEMBER, VIEWER, unregistered, inactive, outside-domain and unavailable identity; attempt direct RPC and spoofed actor/role | No management data or writes; fail closed | Not executed / — / NOT_RUN / — |
| 4 | MANAGER | Create, rename, reorder, retire/reactivate a responsibility | Stable ID and audit; owner change remains ADMIN-only | Not executed / — / NOT_RUN / — |
| 5 | MANAGER | Create/edit a project; transfer responsibility and change deadline with confirmations | Default RESTRICTED; same ID/tasks; validation before changes | Not executed / — / NOT_RUN / — |
| 6 | MANAGER | Create root/nested subprojects; try level three, invalid parent; reparent and archive/reactivate | Two-level validation; task records preserved; rollup counted once | Not executed / — / NOT_RUN / — |
| 7 | MANAGER | Assign task with owner/deadline/duration, preview working/calendar-day and holiday schedules, approve and confirm | Existing backward schedule; separate approval/confirmation and actual actor | Not executed / — / NOT_RUN / — |
| 8 | MANAGER | Edit progress/actual hours/status and move task | Untouched fields preserved; schedule/approval invalidated only when required | Not executed / — / NOT_RUN / — |
| 9 | Two managers | Load same project/task, save one, then save the stale draft | Conflict; second draft preserved; review/reload available | Not executed / — / NOT_RUN / — |
| 10 | ADMIN/MANAGER | Add/edit member; test role grants, last-admin/self-change protection | Directory preserved; role changes ADMIN-only and audited | Not executed / — / NOT_RUN / — |
| 11 | MANAGER | Open stored request queue, then explicit import twice | Read has no mutation; import idempotent; unavailable inbox reported | Not executed / — / NOT_RUN / — |
| 12 | Two managers | Approve pending deadline request; race/retry; reject/return another; approve completion | At most one decision effect/history; stale requests do not overwrite changes | Not executed / — / NOT_RUN / — |
| 13 | MANAGER | Manual DEV publication then open employee app | ISO dates survive B read-back/hash, prior slot survives forced failure; only INTERNAL data; employee contract 1.4 | Not executed / — / NOT_RUN / — |
| 14 | MANAGER | Refresh reports explicitly | Generated reports update; operational columns/formulas preserved | Not executed / — / NOT_RUN / — |
| 15 | MANAGER | Open original Sheets sidebar and edit a synthetic DEV record | Fallback functional and reads same A | Not executed / — / NOT_RUN / — |
| 16 | ADMIN/MANAGER | Measure initial/warm overview, project, search, create/update, request approval, publish/report | Record p50/p95 with dataset, browser/Apps Script/service timing; compare goals honestly | Not executed / — / NOT_RUN / — |
| 17 | MANAGER | Use slow connection, navigate during reads, double Save, interrupt connection and force conflict | Responsive loading; sequence safety; no duplicate pending save; draft retained; uncertain outcome reviewed before retry | Not executed / — / NOT_RUN / — |
| 18 | ADMIN | Inspect mail/Calendar logs and safe settings after tests | No unexpected emails/events; OFF/emergency-stop and DRY_RUN remain effective | Not executed / — / NOT_RUN / — |
| 19 | ADMIN | Review audit for CRUD, approval, settings and publication | Actual visiting actor, never deployer substituted | Not executed / — / NOT_RUN / — |
| 20 | Employee/security reviewer | Attempt access to A; use B/C employee app only | A denied; employee sees sanitized B and request controls only | Not executed / — / NOT_RUN / — |

## Review correction checks (2026-10-28)

Added by the project-summary/deadline-only/card correction; also NOT_RUN in DEV.

| Test | Account | Steps | Expected result | Actual / duration / status / evidence |
| --- | --- | --- | --- | --- |
| R1 | MANAGER | Note a project card's progress/health, save a task progress or status change, return to the overview without refreshing reports | Card, KPI counts and health reflect the new values immediately; no generated sheet is rewritten by the task save | Not executed / — / NOT_RUN / — |
| R2 | MANAGER | Create a task with a deadline and no required duration, then one with a duration | First keeps an empty planned start; second back-plans the start; non-working deadlines still require acknowledgement | Not executed / — / NOT_RUN / — |
| R3 | MANAGER | At 375 px and with a screen reader, inspect a project card and switch 日本語 / English | Progress bar announced with its percentage and project name; health, deadline wording and overdue count read as text; labels translate, stored names do not | Not executed / — / NOT_RUN / — |

## Browser and recovery checks

At 375, 768, 1366 and 1920 CSS pixels, inspect Japanese/English labels, long names, task forms, requests, administration, empty lists, keyboard-only navigation, skip link, modal focus and focus visibility. Test actual browser **200% zoom**, screen-reader announcements and reduced-motion OS preference. Local screenshots and synthetic tests are supporting evidence, not proof of Google HTML Service behavior.

On a rejected save, retain and review the draft. On transport failure, check current record and audit before manual retry; creation is not durably idempotent. Test quota errors and partial request recovery without claiming spreadsheet transactions. Verify private custom columns/formulas survive edits, phantom checkbox rows are ignored and insertion positions remain correct.

The earlier reported Workspace defect was “Snapshot value mismatch in PUBLISHED_PROJECTS_B row 2 column 10” (committedDeadline). The new canonical Date normalization passes local regression; specifically retest publication with existing Sheets date-formatted cells, JST midnight Date values, multi-date fields and employee read/hash. **Live fix remains UNVERIFIED** until this test has evidence.

Do not approve production until identity, authorization, A isolation, end-to-end workflows, publication, concurrency, sidebar fallback, accessibility and latency evidence have been reviewed. If execute-as-user cannot resolve reliable identity, keep gate 2 BLOCKED and do not switch to deployer identity.
