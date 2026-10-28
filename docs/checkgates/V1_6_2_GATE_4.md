# V1.6.2 gate 4 — Member history and responsibility UX

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `40c3ed6c422074b801056b96c04769051d14ca53`
Branch: `fix/v1.6.2-reliability`

## 1. Objective

Two small usability corrections without redesigning the dashboard: present a member's own actions apart from the
task's change history, and make the first visit to a responsibility overview no slower than necessary — without
approximating a KPI.

## 2. Confirmed root cause

1. `ManagerWeb.memberProfile` returned a single `activity` array containing every `AUDIT_LOG` /
   `TASK_DEADLINE_HISTORY` row that touched a task the member owned or had owned — including rows written by
   managers, by other people, and rows whose `Actor` was blank. The client rendered all of it under one
   `履歴 / History` heading, so a manager edit looked like the member's own activity.
2. `ManagerWeb.overview(actor, input)` always appended `responsibilities` and `responsibilityCards`. The
   `responsibilityCards` value is the result of `responsibilitySummaries()`, which walks every project, every task
   and one `Progress.rollup` per area. Every area switch therefore recomputed and reshipped data the browser already
   held from `bootstrap`, which is why the first visit to an area cost noticeably more than switching between the
   fully cached Projects and Tasks views.
3. `load('overview')` left the previous area's KPIs on screen while the scoped payload was in flight, so the new
   heading was briefly shown over the old area's numbers.

## 3. Before behavior

| Scenario | V1.6.1 |
| --- | --- |
| Manager edits a member's task | Appears in that member's "activity" as if the member acted |
| Blank actor | Presented without any attribution label |
| First visit to an area | Recomputes every area rollup and reships ~1.1 KB of duplicate payload |
| Area switch while loading | Previous area's KPIs remain visible under the new area heading |

## 4. Corrected behavior

- Every history entry carries `attribution` (`MEMBER` / `OTHER` / `UNVERIFIED`) and `verified`. A blank actor is
  `UNVERIFIED`; only an exact, case-insensitive match with the member's stored e-mail is `MEMBER`. Verification
  uses the server-recorded `AUDIT_LOG.Actor`, never a typed requester name.
- The profile returns `memberActions` (verified member only) and `taskHistory` (everything that touched the work)
  with their totals. `activity` remains the documented alias of `taskHistory`, so existing consumers keep working.
  Pagination stays bounded (50 rows each).
- The client renders four sections: `現在の作業` (current work), `過去の作業` (previous work), `本人の操作履歴`
  (member actions) and `担当業務の変更履歴` (task history), the latter showing the recorded actor and its
  attribution label.
- `overview(actor, {areas:false})` omits `responsibilities` and `responsibilityCards`, and the client sends that
  flag once it holds the bootstrap snapshot (`store.at.bootstrap`). The default (no flag) is unchanged for every
  other caller, so the unscoped overview and the tests that read it keep the area snapshot.
- `renderAreaLoading()` paints the title, the area heading, the strip and a scoped loading message — no number at
  all — while the authoritative payload is fetched. The stale-response guard (`sequence`, cache tokens) is
  untouched.

## 5. Source files modified

`src/ManagerWeb.gs` (`overview` with the `areas` option, `memberProfile` attribution, `memberActions` /
`taskHistory` / totals, `overviewCore` version `1.6.2`), `src/ManagerWebClient.html` (`memberProfileView` sections,
`attributionText`, `renderAreaLoading`, `load`, `viewFilters`), `shared/i18n.js` (`web.memberActions`,
`web.taskHistory`, `web.attribution`, `web.attributionMember`, `web.attributionOther`,
`web.attributionUnverified`, `web.noMemberActions`, `web.areaLoading`) and the generated `I18n.html` copies,
`tests/v1_6_2-member-area.test.js` (new).

## 6. Test cases

`tests/v1_6_2-member-area.test.js` — 8 cases:

- A. A member edit is a `MEMBER` action with `verified: true`.
- B/C. A reassignment keeps the work in the previous owner's `previous` list and is nobody's verified action.
- D. A manager edit appears in `taskHistory` only, labelled `OTHER`.
- E. An event affecting the member's task by another actor is not counted in `memberActions`.
- F. A blank actor is `UNVERIFIED` and never claimed as the member.
- G. `overview({responsibilityId, areas:false})` returns identical `kpis`, `counts` and `upcoming`, omits
  `responsibilityCards`, and ships a smaller payload.
- H. A revisited area is answered from the local cache (one `overview` RPC, `payload.areas === false`).
- I. During the first visit no KPI element is rendered, only the scoped loading message; the navigation stays usable.
- J. An older area response that lands after a newer selection is discarded.

## 7. Actual test results

PASS locally — `tests/v1_6_2-member-area.test.js`: 8 tests, 8 pass, 0 fail. Full suite **543 tests, 543 pass**.
The existing V1.6/V1.6.1 history and responsibility tests still pass unchanged.

## 8. Security implications

- Attribution is derived from the server-verified `AUDIT_LOG.Actor`; a typed requester name is still never used to
  attribute work (`v1_6-member-history.test.js` keeps that assertion).
- The member profile continues to return only allowlisted task fields (no description, acceptance criteria or next
  action), and the history stays bounded.
- Omitting the area snapshot from a scoped overview removes no authorization check: the project list is still
  scoped server-side by `scoped(projectList(), scope)`.

## 9. Performance implications

`responsibilitySwitch` (same scoped overview, with and without the snapshot), p50:

| Projects | before | after | payload before | payload after |
| --- | --- | --- | --- | --- |
| 10 | 5.13 ms | 3.92 ms | 3 704 B | 2 596 B |
| 100 | 44.24 ms | 35.67 ms | 9 976 B | 8 860 B |
| 300 | 137.34 ms | 110.80 ms | 9 990 B | 8 868 B |

Cached navigation and local filtering are unchanged (0.75–1.39 ms and 0.07–1.40 ms p50), and the number of
background RPCs after the initial load is unchanged (2–3), so no prefetch was added.

## 10. Known limitations

- An unverified actor cannot be turned into a member action later; the label is what the records support.
- The area loading state is text, not a skeleton with placeholder numbers, because a placeholder number is still a
  number.
- `activity` is kept as an alias for compatibility; it is not deprecated in this release.

## 11. Remaining blockers

Live rendering and perceived latency in a real browser (Workspace) are **BLOCKED**; the harness measures Node/vm
render time, not browser paint.

## 12. Final gate status

**PASS** locally (implementation, 8 gate tests, lint, validation, benchmark) — **BLOCKED** for live Workspace
verification.

Implementation commit SHA: sealed in the release-sealing commit of `fix/v1.6.2-reliability`.

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
