# V1.6 gate 2 — Project creation and organisation filters

Status: **PASS** (local) — **BLOCKED** for live Workspace verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: sealed in the delivery header (see §13)

## 1. Objective

A new project in the manager dashboard must state its responsibility, and the dashboard must offer the documented
project and task filters without breaking existing work.

## 2. Relevant source files

`src/Ui.gs` (`createProject` + `requireResponsibility`, `updateProject` partial patch, `saveResponsibility` colour),
`src/ManagerWebApi.gs` (`projectCreate` sets the requirement server-side), `src/ManagerWebClient.html`
(field order, active-only options, filter bar), `src/Projects.gs`, `src/Responsibilities.gs`.

## 3. Required functionality

1. Create-project field order: 担当領域 → 案件名 → 案件責任者 → 説明 → 確定期限 → 優先度 → 状態 → 公開範囲.
2. Responsibility is required for a new project created in the dashboard, and the active area is preselected (and
   clearly changeable). Only active areas are offered.
3. A clear action creates an area when none exists (`+ 担当領域を追加`).
4. Existing blank projects stay intact, display 未分類, and keep every unrelated field editable.
5. Filters: responsibility, project owner, status, priority, deadline range and free text; persisted in page memory.
6. Responsibility transfers stay explicit, confirmed and audited.

## 4. Acceptance criteria

- The dashboard refuses a project without an active responsibility; the refusal names the missing field.
- A project created from a selected area stores that area's stable ID.
- Existing projects are never auto-assigned, and their IDs/columns are unchanged.
- Filters work in both languages and never persist private data in the browser.

## 5. Automated test cases

`tests/v1_6-responsibilities.test.js` (required responsibility, retired area refused, unassigned project editable,
priorities/areas rendered), `tests/v1_4-responsibilities.test.js` (transfer audit), `tests/v1_4-ui.test.js`
(partial patch), `tests/v1_5-web.test.js` (filter parity).

## 6. Actual test results

PASS locally. The legacy Sheets sidebar keeps the V1.4 behaviour (blank = 未分類) by design; the requirement is
enforced server-side for the dashboard path (`ManagerWebApi` sets `requireResponsibility`), so a browser payload
cannot omit it.

## 7. Manual test cases (DEV, not executed)

1. With no area defined, open 案件 → 新規作成: the refusal and the `担当領域を追加` action are visible.
2. Create an area, then create a project with the area preselected; confirm the stored ID in the sheet.
3. Edit an existing blank project: 未分類 is shown and unrelated fields save.
4. Transfer the project to another area; confirm the confirmation prompt and the `RESPONSIBILITY_TRANSFERRED` row.
5. Filter projects by priority and deadline range in both languages.

## 8. Performance results

Filters run locally from the in-memory snapshot: local filtering p50 0.07 / 0.42 / 1.50 ms (10/100/300 projects),
well inside the 50 ms target. Two extra fields (`priority`, `category`) add ≤ 1 % to the project payload.

## 9. Security review

`requireResponsibility` is set by the server action, not by the browser. Every write still passes
`ManagerWeb.authorize()` → `Access.requireManager()` and the revision check. Area, owner and status values from the
browser are data only.

## 10. Problems found

Requiring the field in `Ui.createProject` for every caller broke 14 historical tests that intentionally create an
unassigned project through the sidebar bridge. Enforcing it at the dashboard boundary keeps the V1.4 contract for
existing tooling while satisfying the V1.6 requirement; documented here and in AGENTS.md rule 79.

## 11. Corrective actions

The requirement is explicit, server-set and covered by tests; the sidebar path is documented as legacy.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live verification that the requirement is visible in the DEV deployment is **BLOCKED** (no credentials).

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA sealed in the delivery commit.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
