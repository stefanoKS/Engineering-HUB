# V1.6 gate 1 — Responsibility-centered architecture

Status: **PASS** (local) — **BLOCKED** for live Workspace verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: sealed in the header of the delivery commit (see §13)

## 1. Objective

Responsibilities (担当領域) are the top organisational level of the manager dashboard. The data model stays
`RESPONSIBILITIES → PROJECTS → SUBPROJECTS → TASKS` and `PROJECTS.Responsibility_ID` remains the only project link.

## 2. Relevant source files

`src/ManagerWeb.gs` (`responsibilitySummaries`, overview/bootstrap payloads), `src/ManagerWebApi.gs`
(no new area-specific authorization), `src/ManagerWebClient.html` (responsibility section, area cards, global
filter), `src/ManagerWebStyles.html` (V1.6 desktop tokens), `src/Responsibilities.gs` (palette, colour, order),
`shared/i18n.js`, `src/I18n.html`, `dashboard-app/I18n.html` (generated).

## 3. Required functionality

1. A prominent responsibility section at the top of the manager home with one card per area, `すべての担当領域`
   and `+ 担当領域を追加`.
2. Each card shows name, colour, owner, active project count, open task count, overdue task count and progress.
3. Clicking a card selects the area as the global organisation filter; `すべて` restores the full overview.
4. The selection filters overview project summaries, the project list, the task list, the KPIs and upcoming
   deadlines, using the stable `Responsibility_ID` (never the name).
5. Create, edit, reorder, retire and reactivate stay available; retirement keeps every record.
6. No new authorization level: ADMIN and MANAGER keep department-wide access.

## 4. Acceptance criteria

- Selecting an area changes the rendered project/task lists without any `google.script.run` call.
- Renaming an area never breaks a project link.
- A retired area stays visible with its projects and is no longer a destination for new work.
- The area filter is page memory only (no `localStorage`/`sessionStorage`/IndexedDB).

## 5. Automated test cases

`tests/v1_6-responsibilities.test.js`: card content and counts, per-area overdue counting, stable ID through
rename/reorder/retire, colour validation and palette default, required responsibility for a new dashboard project,
legacy unassigned project stays editable, browser filtering without an RPC, rendered section above the KPIs.
Supporting: `tests/v1_4-responsibilities.test.js`, `tests/v1_4-ui.test.js`, `tests/v1_5-web.test.js`.

## 6. Actual test results

All of the above PASS locally on 2026-10-28 (see §8). No live Workspace run was performed.

## 7. Manual test cases (DEV, not executed)

1. Open the manager app as ADMIN with three areas; confirm the cards and their counts.
2. Select an area, then open 案件: only its projects are listed; the network panel shows no read RPC.
3. Rename the area in 管理 → 担当領域; confirm the selection and the project links survive.
4. Retire an area; confirm its projects remain listed and marked, and it cannot be chosen for a new project.
5. Switch to English; confirm the section, labels and the selected area are preserved.

## 8. Performance results

`bootstrap` (the payload that carries the area cards) measures p50 4.40 / 37.86 / 115.34 ms and
10.5 / 57.3 / 152.7 KB for 10/100/300 projects — +2 to +7 % latency and +15 to +17 % payload versus V1.5.1,
explained by the area cards and the new task fields. Cached navigation and local filtering are unchanged
(0.78–2.01 ms / 0.07–1.50 ms). Raw data: [V1_6_PERFORMANCE.json](V1_6_PERFORMANCE.json).

## 9. Security review

Area selection is a display filter. It grants no access and removes no role check: every read still passes
`ManagerWeb.authorize()` and `Access`. No area-specific ACL was added (V1.4.1 rule 68). The area name is rendered
with `textContent`, and the colour is a validated `#RRGGBB` string, never raw markup.

## 10. Problems found

The first implementation called the completion-review lookup once per task, which doubled the task-index time
(48 → 114 ms p50). It is now computed once per request.

## 11. Corrective actions

Review states are computed once per response; the navigation is refreshed when a bootstrap arrives so the area
section is populated on first paint.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live Workspace verification of the section, the ownership wording and the Japanese labels is **BLOCKED** (no DEV
credentials in this session).

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; the implementation SHA is sealed in the delivery commit.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
