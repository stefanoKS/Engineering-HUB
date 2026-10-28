# V1.5.1 gate 4 — Background synchronization and stale safety

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7

## 1. Objective

Show cached results immediately, refresh them safely in the background, and never let an outdated
response — or a revoked identity — overwrite or expose newer data.

## 2. Affected source files

`src/ManagerWebClient.html` (`request`/`invalidatePrefixes`/`applyBootstrap`/`revalidateView`/
`revalidateCurrent`/`handleError`/`revoke`/`renderSync`), `src/ManagerWebStyles.html` (`#sync`).

## 3. Exact acceptance criteria and result

- Cached data renders first, refresh happens asynchronously: PASS.
- Last-updated timestamp and refreshing indicator: PASS — every view shows 最終更新: hh:mm:ss and
  appends 更新中… while a refresh is unanswered.
- Clear server-error state with retry while cached data stays visible: PASS.
- Manual force refresh: PASS (再読み込み).
- Stale responses never overwrite newer data or user edits: PASS — per-key dispatch tokens plus a
  write-triggered invalidation; a superseded read resolves to `null`.
- Parallel refreshes are deduplicated: PASS (one `bootstrap` request regardless of callers).
- Revalidation after tab focus, visibility change and relevant mutations: PASS (30 s freshness
  window per dataset; writes invalidate affected entries and revalidate).
- Revocation fails closed and clears private cached views: PASS.

## 4. Automated tests performed

`v1_5_1-performance.test.js`: "identical in-flight reads share one RPC and stale responses never
repopulate the cache", "stale data renders instantly, refreshes in the background and keeps a
draft", "a revoked manager loses cached views and unsent drafts"; `v1_5-web-ui.test.js`:
"older startup response cannot replace newer navigation and reads retry explicitly".

## 5. Manual tests performed

`?scenario=slow` (2 s per RPC): cached overview 0.8 ms, manual refresh shows 更新中… with the
cached KPIs still on screen, navigation during the pending request 6 ms, refreshed timestamp after
2.6 s. `?scenario=error`: first load fails with the synthetic error and 再試行 recovers.

## 6. Test commands

npm test; npm run preview:manager-web.

## 7. Actual results

In-flight navigation p50 in the harness (one refresh deliberately left unanswered): 0.60 / 1.31 /
0.02 ms at 10/100/300 projects, with exactly one pending request during the measurement. A
response dispatched before `api.clear()` resolves to `null` and leaves the cache empty. After
`setActor('viewer@example.test')` the refresh returns `Insufficient role`, the store, the drafts
and the request queue are dropped and no further request is issued (asserted).

## 8. Relevant logs and evidence

[raw performance](V1_5_1_PERFORMANCE.json), [validation output](V1_5_1_VALIDATION.txt).

## 9. Identified problems

A background refresh that repainted while the manager was typing in a filter would steal focus,
and repainting during an open form could disturb a draft.

## 10. Corrective actions

`canRepaint()` blocks a full repaint while an editor is open or an input/select/textarea has focus;
the sync line is updated in place instead. Filters repaint only the result list.

## 11. Remaining limitations

Revalidation depends on the browser delivering `focus`/`visibilitychange`; a browser that does not
focus the page again keeps the last snapshot until the next navigation or manual refresh. Live
network behaviour (offline, token expiry) is NOT_RUN.

## 12. Final gate status

**PASS** locally. **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR
PRODUCTION.**
