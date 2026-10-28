# DEVELOPMENT Workspace verification plan

**Status: NOT_RUN. NOT APPROVED FOR PRODUCTION.** No step below was executed against Workspace by this implementation task. Use the existing DEVELOPMENT A/B/C and existing separate manager/employee projects. Follow [DEV deployment](MANAGER_WEB_APP_DEPLOYMENT.md) and the [V1.6 runbook](V1_6_DEPLOYMENT_RUNBOOK.md) first; do not initialize existing sheets, run migrations without approval, install triggers or activate mail/Calendar. Use synthetic test records and preserve audit/history. Record deployment version/SHA and restricted backup reference privately.

V1.6 adds cases 28–38 at the end of this document (responsibility section and filter, required responsibility, four
subproject levels, nested tasks and containers, the completion lifecycle, the ADMIN correction, member history, safe
deletion, contract 1.5 and desktop rendering). The V1.5 and V1.5.1 cases remain valid; cases 21–27 are the only steps
that can confirm a real perceived-speed improvement, because the local benchmark uses mocked Google services.

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

## Local-first checks (V1.5.1)

Added by the snapshot/local-navigation release; also NOT_RUN in DEV. These are the only steps that
can confirm the perceived-speed improvement: the repository benchmark uses mocked Google services.

| Test | Account | Steps | Expected result | Actual / duration / status / evidence |
| --- | --- | --- | --- | --- |
| 21 | MANAGER | Open the app, then open 概要 → 案件 → タスク → 概要 with the devtools network panel visible | First load makes one `bootstrap` (plus a background `taskIndex` under 1,000 tasks); later navigation makes **no** Apps Script request and paints immediately | Not executed / — / NOT_RUN / — |
| 22 | MANAGER | Record the real durations of first load, cached navigation, first and second project open, and typing in the task filter | Cached navigation and filtering are visibly faster than in V1.5; record actual values rather than assuming the local targets | Not executed / — / NOT_RUN / — |
| 23 | MANAGER | Type a task name fragment, then press 検索 for a term that exists only in a task description | Typing narrows instantly; the explicit search returns the description-only match | Not executed / — / NOT_RUN / — |
| 24 | MANAGER | Leave the app idle several minutes, edit a record in another browser tab, then return to the first tab and switch views | 最終更新 is shown, 更新中… appears on return, and the newer value becomes visible without a manual reload | Not executed / — / NOT_RUN / — |
| 25 | Two managers | Open the same task from the cache, have the other manager save it, then save the first manager's draft | The stale save is refused; the draft is preserved; Review latest record shows the server version | Not executed / — / NOT_RUN / — |
| 26 | ADMIN | Revoke the signed-in manager's MANAGER role (or remove the account from the allowed domains), then use the open page | Requests fail closed, cached views and unsent drafts are cleared, and the access-denied message is shown | Not executed / — / NOT_RUN / — |
| 27 | MANAGER | Open 計測 / Diagnostics after the scenarios above | RPC count, local reuse, discarded stale responses, p50/p95 and sheet reads match what the devtools panel recorded; no private record text is displayed | Not executed / — / NOT_RUN / — |

## Browser and recovery checks

At 375, 768, 1366 and 1920 CSS pixels, inspect Japanese/English labels, long names, task forms, requests, administration, empty lists, keyboard-only navigation, skip link, modal focus and focus visibility. Test actual browser **200% zoom**, screen-reader announcements and reduced-motion OS preference. Local screenshots and synthetic tests are supporting evidence, not proof of Google HTML Service behavior.

On a rejected save, retain and review the draft. On transport failure, check current record and audit before manual retry; creation is not durably idempotent. Test quota errors and partial request recovery without claiming spreadsheet transactions. Verify private custom columns/formulas survive edits, phantom checkbox rows are ignored and insertion positions remain correct.

The earlier reported Workspace defect was “Snapshot value mismatch in PUBLISHED_PROJECTS_B row 2 column 10” (committedDeadline). The new canonical Date normalization passes local regression; specifically retest publication with existing Sheets date-formatted cells, JST midnight Date values, multi-date fields and employee read/hash. **Live fix remains UNVERIFIED** until this test has evidence.

Do not approve production until identity, authorization, A isolation, end-to-end workflows, publication, concurrency, sidebar fallback, accessibility and latency evidence have been reviewed. If execute-as-user cannot resolve reliable identity, keep gate 2 BLOCKED and do not switch to deployer identity.

## V1.6 additional smoke cases (DEV, NOT_RUN)

Record each with date, account, dataset, deployment version, execution ID and observed result. Use synthetic
records only.

28. **Responsibility section.** Open the dashboard as ADMIN. Expect one card per area above the KPIs with colour,
    owner, project/open/overdue counts and progress; `すべての担当領域` and `+ 担当領域を追加` are present.
29. **Area filter.** Select an area as 製品設計. Expect the project list, task list, KPIs and upcoming deadlines to
    narrow while the network panel shows **no** additional read. Select `すべての担当領域` and expect the full
    overview to return. Rename the area and confirm the filter still matches by ID.
30. **Required responsibility.** Open 案件 → 新規作成 with no area defined; expect the refusal plus the create-area
    action. Create an area, then create a project and confirm the stored `Responsibility_ID` in the sheet.
31. **Four subproject levels.** Build 5Q45 → 納入部品図作成 → フロント部品 → 断面検討 → 最終確認. Expect the fifth
    level to be refused, a collapse/expand control on parents, and no change to existing two-level data.
32. **Nested tasks and containers.** Under 図面作成 create 断面図作成 → 寸法確認 and confirm a fourth level is
    refused. Try to add a child under a task that already has recorded hours; expect the refusal. Confirm the
    parent card shows derived progress and that its stored spreadsheet cells were not rewritten.
33. **Completion lifecycle.** From the employee app submit 作業完了を報告. Expect the task to remain open with
    承認待ち, the manager to see it in 申請, and the approval to set Done / 100 % once. Return and reject a second
    report and expect the task to stay open. Confirm the sidebar and the web form refuse Done.
34. **ADMIN correction.** As ADMIN record one completion correction with a reason and the exact confirmation.
    Expect Done / 100 % plus a `COMPLETION_OVERRIDDEN` audit row distinct from an approval.
35. **Member history.** メンバー → a member with one approved completion. Expect current work, previous work with
    original/actual dates and acceptance, and the recorded activity. A report typed under another name must not
    create history for that member.
36. **Safe deletion.** Create an empty mistaken project, then delete it as ADMIN with `DELETE <id>` and a reason.
    Expect the dependency panel to be empty, a backup reference, a `RECORD_DELETED` row and the record gone.
    Repeat on a project with tasks (expect refusal) and as MANAGER (expect refusal).
37. **Contract 1.5.** Publish with one `INTERNAL` project containing a nested subproject and a subtask. Expect the
    employee app to show the nesting, the approval badge and `completedAt`, to hide the `RESTRICTED` project and
    every completion note, and an old 1.4 reader to report `SNAPSHOT_CONTRACT_UNSUPPORTED`.
38. **Desktop rendering.** At 1366×768, 1920×1080 and 150 % zoom confirm the responsibility cards, filter bar,
    tree and deletion panel are usable with no clipped actions, and that status is readable without colour alone.

## V1.6.1 additional smoke cases (DEV, NOT_RUN)

Record each with date, account, dataset, deployment version, execution ID and observed result. Use synthetic
records only.

39. **Scoped figures.** Create 25 projects in one area and 2 in another. Select the large area: the header KPI row,
    the project list **and** the upcoming list must describe that area, and the project total must be 25 while 20
    cards are rendered. Select the small area and confirm the numbers switch to 2 with no stale row.
40. **Upcoming scope.** Give the small area no near deadlines. Expect 近日締切 to be empty with a total of 0 while the
    large area still lists its own items.
41. **Container counting.** Add a parent task with two children to an area. Expect 未完了タスク to increase by 2 (not
    3), 作業項目 to be the leaf count, and 集計タスク to show 1.
42. **Conversion guard.** Give a task an approved assignment (or a confirmed schedule), then try to add a subtask
    under it. Expect the refusal message. Repeat with a task that has no history and expect success.
43. **Reparent invalidation.** Move an approved task under another task. Expect `Assignment_Version` to increase, the
    approval to clear, and the task to show 承認待ちが解除 in the audit log.
44. **Container completion refusal.** Open a container task in the employee app: no 完了報告 action, the reason is
    shown. Craft an inbox row naming the container, import it, and expect the row to be refused, the queue unchanged
    and `REQUEST_CONTAINER_REFUSED` recorded.
45. **Approval recovery.** Interrupt an approval (close the tab or drop the network), then reload 申請. Expect the
    request to still be decidable with a retry note and a `REQUEST_APPROVAL_FAILED` audit row, and one further
    approval to apply the effect exactly once.
46. **Deletion ordering.** Delete an empty mistaken task as ADMIN. In `AUDIT_LOG`, `RECORD_DELETE_PREPARED` must be
    earlier than `RECORD_DELETED`. Expect no cascade option anywhere and no delete control for MANAGER.
47. **Deletion recovery.** In a DEV copy, remove the `RECORD_DELETED` row and run 削除記録の確定（管理者）with
    `RECONCILE DELETIONS`. Expect exactly one appended record, `DELETION_RECONCILED`, and no data change.
48. **Member history after reassignment.** Reassign an approved completion to another member. Expect it to stay in
    the original member's 過去の作業 with 以前の担当 and the current owner, and to appear in the new owner's 現在の作業.
49. **Dual contract.** Publish contract 1.5, then redeploy the employee app and confirm the snapshot is still
    readable with `contractVersion 1.5`. Point a V1.5 employee deployment at it and record
    `SNAPSHOT_CONTRACT_UNSUPPORTED`.

Until these are recorded, the six V1.6.1 gates remain **BLOCKED** for live verification.