# V1.5.1 gate 5 — Fast editing and post-save consistency

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7
Implementation commit SHA: 6da346c (feat(manager-web): local-first navigation with an authorized snapshot)

## 1. Objective

Open forms immediately, never lose draft text, keep the authoritative revision check, and show the
result of a save without reloading the page.

## 2. Affected source files

`src/ManagerWebClient.html` (`openEditor`, `detail`, `refreshDetail`, `settle`, `patchSummary`,
`afterWritePrefixes`, editor submit path), `src/ManagerWebApi.gs` (unchanged revision gate).

## 3. Exact acceptance criteria and result

- Forms open from a cached record without an RPC: PASS — one detail read the first time, none
  afterwards (asserted; measured 0 extra RPCs).
- Missing details are fetched asynchronously and the draft is never discarded: PASS.
- Server revision checking stays authoritative: PASS — `payload.revision = d.original._revision`
  unchanged, `ManagerWebApi.check` still compares the stored revision under the lock.
- Only an untouched draft adopts a newer revision: PASS (`refreshDetail` requires `!draft.dirty`).
- Successful save updates local records, invalidates only related aggregates, keeps unrelated
  caches and avoids a full reload: PASS.
- "Saved" only after server confirmation: PASS.
- Failed writes keep the draft, show the error, allow retry and never duplicate a create: PASS.
- Optimistic concurrency preserved: PASS (EDIT_CONFLICT still refuses a stale save).

## 4. Automated tests performed

`v1_5_1-performance.test.js`: "a save patches summaries, keeps unrelated caches and revalidates
aggregates", "a failed save keeps the draft, shows the error and never retries by itself",
"existing writes still go through the validated domain path from cached forms";
`v1_5-web-ui.test.js`: draft preservation across close/navigation/language switch, partial patch,
EDIT_CONFLICT draft retention, duplicate-write refusal.

## 5. Manual tests performed

Preview browser: project form opened from the loaded detail with no RPC; task rename saved and
rendered from the patched summary; a stale save refused with the draft intact.

## 6. Test commands

npm test.

## 7. Actual results

A save issues exactly one write RPC (asserted), keeps an unrelated cached member list, drops the
edited detail (asserted `peek('task',{id}) === null`) and repaints the list from the patched summary
before the background revalidation. A refused save produces one write attempt, keeps
`drafts.size === 1`, and shows `EDIT_CONFLICT` in the form while the store keeps the other
manager's value.

## 8. Relevant logs and evidence

[validation output](V1_5_1_VALIDATION.txt), [performance document](../MANAGER_WEB_APP_PERFORMANCE.md).

## 9. Identified problems

The write response does not carry a recomputed revision, and a Sheets date arrives as an instant.

## 10. Corrective actions

The client invalidates the edited detail instead of inventing a revision, so reopening fetches the
authoritative `_revision`; `dayText()` normalizes a returned date for the local summary display
only, and the next `taskIndex` refresh replaces the row with the server value.

## 11. Remaining limitations

A partial patch means the local summary can briefly show pre-save derived values (project
progress/health) until the background revalidation lands; the sync indicator shows 更新中… during
that window. Multi-row atomicity is still not available in Sheets.

## 12. Final gate status

**PASS** locally. **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR
PRODUCTION.**
