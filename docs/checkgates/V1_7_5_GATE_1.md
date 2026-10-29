# V1.7.5 GATE 1 — Task summaries, request synchronization and task-index recovery

| Field | Value |
| --- | --- |
| Release line | V1.7.5 corrective release (application version `1.7.5`; V1.7 has not been deployed) |
| Scope | `src/ManagerWebClient.html` (`settle`, `patchSummary`/`patchTaskSummary`, `invalidateDerivedTasks`, `supersedeRead`, `syncTaskIndex`, `hydrateTasks`, `recoverTaskIndex`, `enterRequests`, `requestSyncKey`, `requestImport`, `load`) |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT_RUN** |
| Backend impact | No schema change, no migration, no new Script Property, no new API operation, no authorization or publication change |

## 1. Defects reproduced before the correction

Each defect was reproduced with the real client and the real Apps Script modules before the fix; the
regression tests listed here failed on `98655ce` (v1.7.4) and pass afterwards.

| # | Defect | Root cause | Regression test |
| --- | --- | --- | --- |
| 1.1 | A saved task lost its container flag, its depth, its review badge and its assignee list | `patchSummary()` rebuilt the summary from the `TASKS` write row and filled unknown fields with `container:false`, `depth:0`, `reviewState:''`, dropping `assigneeIds`/`assigneeNames`/`sharedAssignment`; the task write also never invalidated the cached index | "an edited task keeps every derived field until the authoritative index answers" |
| 1.2 | Editing a multi-assignee task collapsed it to one assignee | same as 1.1 | "changing the primary owner and the additional assignees is reflected after the refresh", "removing every additional assignee produces a single-assignee summary" |
| 1.3 | A parent task stopped looking like a container, a nested task lost its indentation | same as 1.1 | "editing a parent task keeps its container flag and its subtask depth", "moving a task to another parent updates depth and container status after the refresh" |
| 1.4 | A pending or stale approval badge disappeared after an unrelated save | same as 1.1 | "a task awaiting completion approval keeps its pending review state after a save", "a stale completion-approval state survives an unrelated save" |
| 1.5 | A created task was added from a partial row and the count was guessed | `patchSummary()` appended a synthetic summary | "a created task appears from the authoritative index with its derived values" |
| 1.6 | A task save paid for a whole-snapshot refresh | `settle()` → `revalidateView('tasks')` → `bootstrapFetch()` | "a task save answers with one index read and no whole-snapshot refresh" |
| 1.7 | An index answer produced before a newer save repainted older rows | in-flight reads were not superseded, and `syncTaskIndex` had no ordering identity | "an outdated index answer never replaces a newer save result" |
| 1.8 | An abandoned 申請一覧 visit could repaint the page or overwrite its error | the callback only checked `view === 'requests'` | "an older request synchronization never overwrites a newer page entry", "a failure from an abandoned visit does not set the current error state" |
| 1.9 | A filter change during the import could narrow the list again | no filter identity on the response | "a filter change during the import keeps the newer filter result" |
| 1.10 | A changed task count left タスク loading forever | `syncTaskIndex` returned silently when `index.total !== store.tasks.total` | "an index with a changed record count is accepted instead of leaving the page loading", "a record count that shrinks is accepted as the newer authoritative index" |
| 1.11 | An unusable index also left the page loading | no validation and no recovery path | "an unusable index payload recovers through the snapshot and the paginated page", "an index without rows or columns is treated as unusable", "an index whose rows disagree with its own total is refused", "a server failure on the index is recovered by one snapshot read and one retry" |

## 2. Correction

### 2.1 Task summary (`patchTaskSummary`)

| Field | Source | Behaviour |
| --- | --- | --- |
| `name`, `projectId`, `subprojectId`, `parentId`, `ownerId`, `deadline`, `priority` | the write response | applied immediately |
| `project`, `responsibilityId` | the cached project summary / the stored value | applied only when the project is known; never blanked |
| `owner` | the reference directory | applied only when the member is known |
| `container`, `depth`, `reviewState`, `assigneeIds`, `assigneeNames`, `sharedAssignment` | server-derived | keep the previous value until the authoritative index answers |
| a task that is not in the index yet | — | not appended; the index read that follows adds it |

### 2.2 Refresh discipline

```
settle(action, …)
  patchSummary(action, payload, result)      // authoritative fields only
  invalidateDerivedTasks()                   // taskIndex payload + aggregates, rows stay
  repaintIfAllowed()                         // patched rows paint immediately
  task page  → syncTaskIndex(true)           // one narrow read
  other page → revalidateView(view)          // the view's own source
```

`invalidateDerivedTasks()` sets `store.overview = null` and `store.at.bootstrap/projects/tasks = 0`,
so the aggregates are re-read when the manager next opens a page that shows them (documented lazy
refresh), and `supersedeRead('taskIndex')` drops both the cached payload and the read in flight.

### 2.3 Ordering

`syncTaskIndex` increments `taskIndexState.generation` per dispatch and ignores an answer whose
generation is no longer current; `request()` already returned `null` for a superseded token and
`syncTaskIndex` now treats that as "discarded", not as a broken payload.

### 2.4 申請一覧 lifecycle

| Concern | Implementation |
| --- | --- |
| Page entry identity | `enterRequests()` sets `requestSync.generation += 1` on every navigation to 申請一覧 |
| Filter identity | `requestSyncKey()` (`OPEN` / `ALL`) captured at dispatch and re-checked when the answer arrives |
| Immediate feedback | the cached queue paints first; the import response repaints only when both identities still match |
| Failure | reported as a warning in `importError`, never as success |
| Concurrency | `requestImport()` is a lifecycle operation (not the record single-write guard), so an entry that follows an abandoned one is not blocked; the server import stays idempotent per inbox request ID |
| Retry | never automatic; the manual 取り込む button remains |

### 2.5 Task index recovery

| Input | Behaviour |
| --- | --- |
| valid, count changed | accepted as the newer count; `total`, `complete`, `loaded` and the rows are replaced together |
| `complete:false` (above the 3000 bound) | `complete:false`, rows dropped, the paginated list answers the page |
| missing/invalid `columns` or `rows`, bad row width, missing `id`, `rows.length !== total` | refused → recovery |
| read failure | recovery, or `revoke()` for an authorization failure |
| recovery budget | first failure: one snapshot read, then one retry; second failure: paginated list; the counter resets on success and on a user-initiated visit |

Verified scenarios: count 10→11, count 11→10, empty response, missing `rows`, missing `columns`,
invalid payload, row/total disagreement, server failure, index above the bound, failing snapshot,
rapid navigation between タスク and 案件. No scenario leaves a loading state, none issues more than one
automatic retry, and the filter bar stays usable afterwards.

## 3. Evidence

```
node node_modules/eslint/bin/eslint.js .                 # PASS (no findings)
node --test tests/v1_7_5-correctness.test.js             # 25 tests, 25 pass
node --test tests/v1_5-web-ui.test.js                    # 8 tests, 8 pass (unchanged expectations)
node --test                                              # 722 tests, 722 pass, 0 fail, 0 skipped
```

## 4. Final gate status

| Criterion | Status |
| --- | --- |
| No task display metadata corruption after a save | **PASS (local)** |
| No outdated asynchronous response replaces a newer UI state | **PASS (local)** |
| No permanent loading caused by a task-index mismatch | **PASS (local)** |
| Request approvals and synchronization remain safe and idempotent | **PASS (local)** |
| Filters, area scope and search survive a recovery | **PASS (local)** |
| Live Workspace behaviour | **BLOCKED / NOT_RUN** |
