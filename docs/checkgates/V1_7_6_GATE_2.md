# V1.7.6 GATE 2 — Revocation and in-flight read ordering

| Field | Value |
| --- | --- |
| Release line | V1.7.6 corrective release (application version `1.7.6`; V1.7 has not been deployed) |
| Scope | `src/ManagerWebClient.html` (`revoke`, `invalidatePrefixes`, `request`, `render`, `repaintIfAllowed`, `success`, `settle`, `act`, `fetchView`, `bootstrapFetch`, `fetchPublication`, `syncTaskIndex`, the 申請一覧 callbacks, `openEditor`, `loadSubprojects`, `loadParentTasks`, the admin write handlers) |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT RUN** |
| Backend impact | None — client-side ordering only; no server change, no new Script Property |

## 1. Defects reproduced before the correction

| # | Defect | Root cause | Regression test |
| --- | --- | --- | --- |
| 2.1 | A delayed import repainted private request rows after access was revoked and replaced the access-denied message | `revoke()` did not advance `requestSync.generation`, and the callback checked only the page generation | "a delayed request synchronization never repaints after access is revoked" |
| 2.2 | A snapshot read that started before a save was applied and cached over the newer state | `invalidatePrefixes()` iterated `cache.keys()` only, so an in-flight read with no cached entry stayed valid; the newer refresh then joined it instead of re-reading | "a snapshot read started before a save can never overwrite the newer state" |
| 2.3 | A late snapshot could repaint a revoked page | `bootstrapFetch`/`repaintIfAllowed` had no revocation guard | "a delayed snapshot never restores data after access is revoked" |

## 2. Correction

### 2.1 Revocation advances every generation

| State | Change | Effect |
| --- | --- | --- |
| `revoked` | `true` | every guard below short-circuits |
| `sequence` | `+1` | pending `fetchView`/`fetchPublication` answers are dropped |
| `drawerSequence` | `+1` | a pending editor-open answer cannot open a form |
| `taskIndexState.generation` | `+1` | a pending index answer cannot replace rows |
| `requestSync.generation` | `+1`, state `failed` | a pending import cannot paint or start another |
| `api.clear()` | cached payloads and in-flight tokens | every in-flight read resolves as superseded |
| store, `currentEditor`, `pending`, notice | cleared | no private data and no form survive |
| `content`, `actor` | cleared | only the access-denied message remains |

### 2.2 Guarded asynchronous entry points

```
render, repaintIfAllowed, success, settle, act
fetchView, bootstrapFetch, fetchPublication, syncTaskIndex
requestImport callback, requestSync failure callback
openEditor, loadSubprojects, loadParentTasks, skill-assess read
automationSave, deletionReconcile
```

Each verifies `revoked` (or the generation the revocation advanced) before it paints, caches,
notifies or reopens a form. A rejected identity also stops `handleError` from re-entering `revoke`
recursively.

### 2.3 In-flight read ordering

```
invalidatePrefixes(prefixes)
  keys = union(cache.keys(), inflight.keys())
  for each key with a matching prefix:  tokens[key] += 1; cache.delete; inflight.delete
```

A read whose token is stale resolves `null`; `fetchView` reads the current generation once instead of
staying on a loading state, and every other caller either returns early or ignores the answer. In-flight
deduplication is preserved per generation: two callers that ask for the same key in the same
generation still share one RPC.

### 2.4 What a late answer can no longer do

- restore task, project or request data;
- update the active view or repaint another screen;
- replace the access-denied message;
- show a success notification;
- reopen an editor;
- repopulate a private cache.

A server mutation already in flight is never cancelled and never replayed: the guard is client-side
presentation only, and server-side `Access`/`Roles` stays authoritative.

## 3. Test cases

`tests/v1_7_6-consistency.test.js`:

| Test | Expectation | v1.7.5 |
| --- | --- | --- |
| a delayed request synchronization never repaints after access is revoked | empty content, access-denied message, no store data, no editor | FAIL |
| a delayed snapshot never restores data after access is revoked | empty content, access-denied message | PASS (guard existed for the snapshot path only) |
| a snapshot read started before a save can never overwrite the newer state | the newer save starts its own read; the old answer is neither cached nor rendered | FAIL |
| the latest request import wins over an overlapping older one | the newest entry paints; the abandoned answer paints nothing | PASS (page-entry generation) |
| leaving the page during a decision keeps the abandoned answer off the screen | the task page stays, the index still receives the authoritative result | FAIL |

## 4. Actual test results

```
node --test tests/v1_7_6-consistency.test.js
ℹ tests 17   ℹ pass 17   ℹ fail 0   ℹ skipped 0
```

Full suite: `npm test` → `tests 752 / pass 752 / fail 0 / skipped 0`.

## 5. Known limitations

- A delayed *write* answer is discarded in the browser without confirming the server outcome. An
  ambiguous delivery therefore stays ambiguous, exactly as the approval journal documents; the
  manager resolves it through the existing reconciliation entry points.
- The generation guards are per page session. A second browser tab has its own generation space;
  revocation in one tab does not revoke another (the server refuses its reads independently).

## 6. Remaining blockers

Live Workspace verification is **BLOCKED / NOT RUN**. `docs/PRODUCTION_READINESS.md` stays
**NOT APPROVED FOR PRODUCTION**.

## 7. Final gate status

Status: **PASS (local)** — **BLOCKED** for live verification. Production readiness: **NOT APPROVED
FOR PRODUCTION**.
