# V1.7.6 GATE 1 — Request decisions, imports and derived task state

| Field | Value |
| --- | --- |
| Release line | V1.7.6 corrective release (application version `1.7.6`; V1.7 has not been deployed) |
| Scope | `src/ManagerWebClient.html` (`afterWritePrefixes`, `requestImport`, `importedCount`, `invalidateRequestDerived`, `requestChangedDerived`, `refreshLoadedTaskIndex`, `settle`, `fetchView`) |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT RUN** |
| Backend impact | No schema change, no migration, no new Script Property, no new API operation, no authorization or publication change |

## 1. Defects reproduced before the correction

Each defect was reproduced with the real client and the real Apps Script modules before the fix; the
regression tests in `tests/v1_7_6-consistency.test.js` failed on `75ff25c` (v1.7.5) and pass
afterwards.

| # | Defect | Root cause | Regression test |
| --- | --- | --- | --- |
| 1.1 | An approved completion request left the task `Assigned` at its old progress | `requestDecide` invalidated only `['bootstrap', 'requests']`; the compact index kept its rows | "approving a completion request shows the authoritative completion state" |
| 1.2 | An approved deadline change showed the old deadline | same as 1.1 | "approving a deadline extension shows the new deadline" |
| 1.3 | A rejected request kept its 承認待ち badge | the derived index was never invalidated | "a rejected request clears its review state without touching the task" |
| 1.4 | A returned request kept its 承認待ち badge | same as 1.3 | "a returned request clears its review state without touching the task" |
| 1.5 | A stale decision left the previous deadline on screen | same as 1.1 | "a stale decision reports itself and never overwrites the newer deadline" |
| 1.6 | An imported completion report never showed a pending review | the import path ignored `imported.imported` and invalidated only the queue | "importing a new completion request updates the pending badge" |
| 1.7 | A decision left the task page stale after the manager navigated away | the derived invalidation did not exist, so the abandoned answer owned the rows | "leaving the page during a decision keeps the abandoned answer off the screen" |

Guards that must not regress: "repeating an approval mutates the task and the audit log once",
"an ambiguous decision is reported and never replayed", "an import that changes nothing never
refreshes the task index", "a failed index refresh after a decision uses the bounded recovery path",
"a broken queue payload after a decision reports a contract error".

## 2. Correction

### 2.1 What a decision invalidates

```
afterWritePrefixes('requestDecide') → bootstrap, requests, task, project, overview
settle('requestDecide')             → invalidateRequestDerived()
                                       invalidatePrefixes(['task', 'project', 'overview'])
                                       invalidateDerivedTasks()   (index payload + store aggregates)
                                    → revalidateView('requests')            one queue read
                                    → refreshLoadedTaskIndex()              one index read, only if loaded
```

| Derived value | Source of truth | Behaviour |
| --- | --- | --- |
| task status, progress, completion state | `TASKS` row via the compact index | re-read, never guessed |
| task deadline | `TASKS.Due_Date` via the compact index | re-read, never guessed |
| pending / stale approval indicator | `Requests.pendingCompletionStates()` in the index | re-read |
| project progress and KPI aggregates | snapshot + scoped overview payloads | invalidated, re-read by the next page that shows them |
| request status and pending count | the queue payload | re-read (one read) |
| assignees and hierarchy | the compact index | re-read |

### 2.2 What an import invalidates

```
requests read  → data.imported.imported  ─┐
requestSync    → data.imported.imported  ─┴→ importedCount() > 0 → requestChangedDerived()
                                              invalidateRequestDerived() + refreshLoadedTaskIndex()
                                           = 0            → no extra call at all
```

### 2.3 Special cases

| Case | Behaviour |
| --- | --- |
| `APPROVED` | task mutation, one queue read, one index read when loaded |
| `REJECTED` / `RETURNED` | no task mutation, review indicator dropped, one queue read, one index read when loaded |
| `STALE` | no task mutation, the newer stored deadline wins, `requestStale` notice instead of "saved" |
| `PROCESSING` | stays an open card; the decision is not repeated automatically |
| already decided | the card offers no decision buttons; a repeated submission is refused by the server |
| server error | readable error; no derived invalidation and no retry |
| ambiguous transport outcome | the answer is discarded and the mutation is never replayed |

Approval idempotency, revision checks, the request journal and the reconciliation safeguards are
untouched: this release changes only what the browser re-reads, never what the server writes.

## 3. Client calls per operation

Measured with the test harness (`h.calls`), first paint excluded:

| Operation | v1.7.5 | v1.7.6 |
| --- | --- | --- |
| first paint + タスク | 2 (bootstrap, taskIndex) | 2 |
| 申請一覧, no new inbox rows | 2 (requests, requestSync) | 2 |
| 申請一覧, one imported request | 2 | 3 (+1 taskIndex) |
| decision, index not loaded | 1 (requests) | 1 (requests) |
| decision, index loaded | 1 (requests) | 2 (requests, taskIndex) |
| task save | 2 (write + taskIndex) | 2 |

## 4. Test cases

`tests/v1_7_6-consistency.test.js` — 17 tests, all PASS; 11 fail on `75ff25c`.
`tests/v1_7_6-release.test.js` — 13 tests, all PASS (version, migrations, entrypoints, gates, readiness).

## 5. Actual test results

```
node --test tests/v1_7_6-consistency.test.js
ℹ tests 17   ℹ pass 17   ℹ fail 0   ℹ skipped 0
```

Against the v1.7.5 client (`git show 75ff25c:src/ManagerWebClient.html` via a require hook):
`tests 17 / pass 6 / fail 11`.

## 6. Known limitations

- The store aggregates (`store.overview`, a scoped `overview` payload) are re-read lazily, when the
  manager next opens a page that shows them. A KPI number is therefore not refreshed while the
  manager stays on 申請一覧.
- An import that created a request costs one extra compact-index read on a page that already holds
  the index. This is deliberate: the pending-review indicator lives in the index.

## 7. Remaining blockers

Live Workspace verification is **BLOCKED / NOT RUN**: no Google Workspace execution has been recorded
for this release. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

## 8. Final gate status

Status: **PASS (local)** — **BLOCKED** for live verification. Production readiness: **NOT APPROVED
FOR PRODUCTION**.
