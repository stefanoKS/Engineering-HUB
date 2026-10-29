# V1.7.3 GATE 1 — Request validation, editor lifecycle and release version

| Field | Value |
| --- | --- |
| Release line | V1.7 corrective change (application version `1.7.3`; V1.7 has not been deployed) |
| Scope | `src/Schema.gs`, `src/Database.gs`, `src/ManagerWeb.gs`, `src/ManagerWebClient.html`, `src/Config.gs`, `src/TaskTree.gs`, `tests/v1_7_3-correctness.test.js`, three pre-existing tests |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT_RUN** |
| Backend impact | No schema change, no migration, no new Script Property, no authorization change, no publication-contract change |

## 1. `Invalid text: Snapshot_Version`

**Cause.** `Database.update()` re-validates the whole stored row before writing a single field. Google
Sheets returns a cell containing `1.5` as the number `1.5`, so a `TASK_REQUESTS` row whose
`Snapshot_Version` was typed as a number failed validation on every decision path (approve, reject,
return, stale, reconciliation).

**Fix.** `Schema` marks the two opaque identifiers `TASK_REQUESTS.Snapshot_Version` and
`TASK_REQUESTS.Task_Revision_At_Submission` with `coerceText: true`. `Database.declaredText()` converts
a number/boolean cell of exactly those fields to text when a row is read (`read()` and the
`updateMany` row build). Nothing else is coerced:

| Property | Result |
| --- | --- |
| `Snapshot_Version` numeric cell (`1.5`, `1.6`) | read as `'1.5'` / `'1.6'`; the cell is not rewritten |
| `Task_Revision_At_Submission` numeric cell | read as text (opaque digest) |
| `Due_Date_At_Submission` | stays a date (V1.7.1 behaviour) |
| Any other string field (e.g. `Reason`) | still strict — a numeric cell is `Invalid text: Reason` |
| Stored request rows | never rewritten just for a read |
| Request IDs, decisions, audit history | unchanged |

## 2. Editor-open race, Escape and fresh data

| Behaviour | Implementation | Regression test |
| --- | --- | --- |
| Navigate away before the server answers | `closeEditor()` increments `drawerSequence`, `openEditor` keeps its own sequence after `discardEditor()` | "an editor response that arrives after navigating away never opens a form" |
| Native dialog close (Escape) | `dialog#editor` `close` event calls `discardEditor()` (no re-entry) | "a native dialog close (Escape) discards the form and writes nothing" |
| Edit from the latest row | an edit always reads `detail(type, id, true)`; the list row is never used | "reopening an editor reads the latest stored row instead of the list row" |
| Member / responsibility / subproject editors | narrow allowlisted read `editor` (`EDITOR_TABLES` map, `_revision` included) | "member, responsibility and subproject editors load through the allowlisted editor read" |
| No drafts | nothing is written to `localStorage`; only `eh.lang` may exist | same close/navigation tests |

`EDIT_CONFLICT` handling is unchanged: the save path still re-checks the revision under the script
lock, the open form keeps its values and nothing is retried automatically.

## 3. Release version

`src/Config.gs` declares `var APP_VERSION = '1.7.3'`. `ManagerWeb.overviewCore()` and the `status`
read both return it, so `共有ダッシュボード公開`, `システム状態` and the overview payload agree. The
four versions stay separate: database schema `8`, application `1.7.3`, publisher `1.7.0`, snapshot
contract `1.6`.

## 4. Parent task above one page

`GET parentOptions` (read operation) applies the same rules as the save path — same project and
subproject, never the task itself, never one of its descendants (`TaskTree.isAncestor`, now exported),
never a task already at the deepest level — and pages the matches (`PARENT_OPTION_LIMIT = 200`,
`total`/`complete` reported). The client asks the server while the offered page is known to be
incomplete and repaints only the selector, so the typed query is not lost.

## 5. Evidence

```
node --test tests/v1_7_3-correctness.test.js   # 14 tests, 14 pass
node --test tests/*.test.js                    # see GATE 5 for the full count
node scripts/validate-source.js                # PASS
node node_modules/eslint/bin/eslint.js .       # PASS (no findings)
```

## 12. Final gate status

| Criterion | Status |
| --- | --- |
| Numeric `Snapshot_Version` no longer blocks a decision | **PASS (local)** |
| Decisions remain idempotent and stale-safe | **PASS (local)** |
| Editor never opens after the manager left; Escape discards | **PASS (local)** |
| Edit starts from the latest authorized row | **PASS (local)** |
| Release version displayed consistently | **PASS (local)** |
| Parent beyond one page discoverable, bounded | **PASS (local)** |
| Live Workspace behaviour of the fixed paths | **BLOCKED / NOT_RUN** |

