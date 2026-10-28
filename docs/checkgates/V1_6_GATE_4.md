# V1.6 gate 4 — Subproject hierarchy

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: sealed in the delivery header (see §13)

## 1. Objective

Allow up to four subproject levels beneath a project, with one central limit, bounded traversal and unchanged
meaning for existing two-level data.

## 2. Relevant source files

`src/Subprojects.gs` (`MAX_DEPTH = 4`, level/height bounds, reparent validation, descendants),
`src/Eligibility.gs` (ancestor chain bound follows the configured depth), `src/Progress.gs` (subtree rollup),
`src/SharedDashboardModel.gs` (`subprojectLevels` guard, nested DTOs), `src/ManagerWeb.gs` (project detail),
`src/ManagerWebClient.html` (collapsible tree), `dashboard-app/DataService.gs` (bounded published tree).

## 3. Required functionality

1. Four levels accepted, a fifth refused with a documented error.
2. Stable parent IDs, same-project parent, no self parent, no cycle, no orphan, no move into an archived branch.
3. Reparenting validates the whole affected subtree.
4. Progress, archive eligibility, reports, the manager tree and the published snapshot all follow the same rule.
5. Existing two-level data unchanged.

## 4. Acceptance criteria

- `Subprojects.MAX_DEPTH` is the single limit; no module hardcodes 2 or 4.
- Walks are bounded (visited set + depth guard) and raise on malformed data instead of recursing.
- The published hierarchy renders nested after one publication.

## 5. Automated test cases

`tests/v1_6-hierarchy.test.js` (four levels, fifth refused, self/cycle/cross-project, subtree reparent validation,
legacy data, published nested rollup), `tests/v1_4-hierarchy.test.js`, `tests/v1_4_1-stabilization.test.js`,
`tests/v1_4-ui.test.js`, `tests/v1_4-release.test.js` (contract parity).

## 6. Actual test results

PASS locally. Historical tests that asserted the V1.4 two-level limit were retargeted to the V1.6 four-level limit
(the boundary itself is still asserted), and the tree rendering gained a depth-bounded, collapsible walk.

## 7. Manual test cases (DEV, not executed)

1. Create four levels in DEV; confirm the fifth is refused with the Japanese message.
2. Collapse and expand a branch; confirm the selected project context is preserved.
3. Reparent a branch that would overflow; confirm nothing is written.
4. Publish and confirm the nested hierarchy in the employee app.

## 8. Performance results

`Project` detail p50 11.71 ms at 300 projects (V1.5.1 13.8 ms). The published `subprojects` payload grows only by
the existing fields; level computation is one bounded pass.

## 9. Security review

Hierarchy writes still pass `Access.requireSubprojectWrite`/`requireManager`. A cross-project parent, a cycle and an
archived destination are refused server-side; malformed stored data cannot cause unbounded recursion.

## 10. Problems found

The V1.4 published-level guard (`> 4`) silently flattened a five-level chain to level 1. It now tolerates up to the
configured depth and only reacts to genuinely malformed data.

## 11. Corrective actions

Guard widened to 8 (malformed-data detection only); the employee tree walk is depth-bounded and cycle-safe.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live rendering of a four-level tree is **BLOCKED** (no DEV deployment in this session).

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA sealed in the delivery commit.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
