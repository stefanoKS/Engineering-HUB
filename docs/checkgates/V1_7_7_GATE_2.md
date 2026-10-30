# V1.7.7 GATE 2 — Requests filter and import synchronization

| Field | Value |
| --- | --- |
| Release line | V1.7.7 corrective release (application version `1.7.7`) |
| Scope | `src/ManagerWebClient.html` (`requestImport`, `refreshRequestList`, the 申請一覧 import callback, `fetchView`) |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT RUN** |
| Backend impact | No server change at all — the refresh is a read-only `managerWebRead('requests')` the page already performs; the import stays idempotent and is never repeated |

## 1. Defect reproduced before the correction

The generation token and the filter key already stopped an older answer from overwriting a newer one:

```js
requestImport(syncKey).then(function (result) {
  if (revoked || generation !== requestSync.generation) return;
  requestSync.state = 'done';
  if (syncKey !== requestSyncKey() || view !== 'requests') return;   // ← the whole answer dropped
  currentData = readContract('requests', result); render();
});
```

The 申請一覧 queue read (`managerWebRead('requests')`) carries `import: false`, so it never contains rows
an import creates afterwards. Sequence that produced the defect:

1. 申請一覧 opens with 未処理 only; the page-entry import starts.
2. The manager switches to 決定済みを含む; that filtered read is dispatched and answers with the current
   queue — the request the import is about to create is not in it.
3. The import finishes and created one request. Its filter (`OPEN`) is no longer the selected one, so the
   callback returned without painting **and** without re-reading: the All list stayed incomplete until a
   manual reload.

## 2. Correction

```js
requestImport(key).then(data => {
  const imported = importedCount(data.imported);                    // authoritative server count
  const listPending = imported > 0 && inflight.has(keyOf('requests', viewFilters('requests')));
  invalidatePrefixes(afterWritePrefixes('requestSync'));            // supersedes every requests* read
  if (imported) requestChangedDerived();                            // v1.7.6 derived refresh
  return {payload: data, imported, listPending};
});
...
if (syncKey !== requestSyncKey() || view !== 'requests') {           // a filter change owns the page
  if (imported.imported) refreshRequestList(imported.listPending);   // one read, never an import
  return;
}
```

`refreshRequestList()` returns immediately when the client is revoked, when the manager has left
申請一覧, or when a read of the current filter was still running at import completion. That running read
was dispatched before the import committed, so `invalidatePrefixes()` already superseded it: its answer
is discarded and `fetchView()` re-reads the current filter once (`data === null && !retried`).

`fetchView()` keeps its existing guarantees: the page `sequence` decides which answer may paint, and the
read is keyed by the selected filter, so an older filter's answer can never be applied.

### Case matrix

| Case | Behaviour |
| --- | --- |
| A — filter changes while the import runs, import creates one | the current filter is read once and lists the new request |
| B — import completes before the filtered read answers | no extra read; the superseded read re-reads itself and stays authoritative |
| C — import creates nothing | no request-list read at all |
| D — several fast filter changes | only the answer of the current generation and filter paints |
| E — navigate away during the import | no repaint, no extra read, no navigation change |
| F — authorization revoked during the import | no rows rendered; the page is revoked |
| G — import failure | warning kept, loaded requests stay visible, no retry, no refresh |

## 3. Client round trips

Measured through the real client with the test harness (`h.calls`), task index loaded:

| Scenario | v1.7.6 | v1.7.7 |
| --- | --- | --- |
| initial bootstrap | 1 (`bootstrap`) | 1 |
| task navigation | 1 (`taskIndex`) | 1 |
| 申請一覧 entry, no new import | 2 (`requests`, `requestSync`) | 2 |
| 申請一覧 entry, one imported request | 3 (+`taskIndex`) | 3 |
| filter change during a pending import, import creates one | 4 | **5** (+1 `requests`) |
| filter change during a pending import, import creates nothing | 3 | 3 |
| request approval | 3 (`requestDecide`, `requests`, `taskIndex`) | 3 |
| request rejection | 3 | 3 |

The single added call is the correctness read of the selected filter and only occurs in that overlap.
No import is repeated, and the Sheets service work of the import itself is unchanged.

## 4. Test cases

`tests/v1_7_7-hotfix.test.js`:

- "a filter change during the import refreshes the selected filter" — FAIL on `1c3165d`.
- "an import that finishes before the filter read leaves that read authoritative" — guard (PASS both).
- "an import that created nothing refreshes nothing" — guard.
- "only the current filter is displayed after fast filter changes" — guard.
- "leaving the page during the import never repaints it" — guard.
- "a failed import keeps the queue visible and refreshes nothing" — guard.
- "a denied import never renders the rows it read" — authorization path of the import (see GATE 1).

## 5. Actual test results

```
node --test tests/v1_7_7-hotfix.test.js
ℹ tests 13   ℹ pass 13   ℹ fail 0   ℹ skipped 0
```

## 6. Known limitations

- The manual 取り込み button keeps its v1.7.6 behaviour: the write invalidates the queue payload and the
  next read shows the imported rows. This release adds no automatic re-read to that path, so it adds no
  call there either.
- The refreshed payload reports `imported: null` (a read does not import), so the import summary line
  falls back to its idle text after the refresh — exactly what any later queue read already did.

## 7. Remaining blockers

Live Workspace verification is **BLOCKED / NOT RUN**. `docs/PRODUCTION_READINESS.md` stays **NOT
APPROVED FOR PRODUCTION**.

## 8. Final gate status

Status: **PASS (local)** — **BLOCKED** for live verification. Production readiness: **NOT APPROVED FOR
PRODUCTION**.
