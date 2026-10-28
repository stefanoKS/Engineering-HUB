# V1.5.1 gate 1 — Analysis and baseline

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7 (main, V1.5 review-correction + documentation seal)
Implementation commit SHA: recorded in the delivery commit for this release.

## 1. Objective

Record the actual starting state and the measured causes of per-navigation latency before
changing any code, so later claims rest on a recorded baseline rather than on impressions.

## 2. Affected source files

None. This gate records analysis only.

## 3. Exact acceptance criteria and result

- Baseline commands run and recorded: PASS.
- Latency causes identified from code and from the mock benchmark: PASS.
- Reported live baseline acknowledged as *reported*, not reproduced locally: PASS.

## 4. Automated tests performed

`npm test` on the untouched working tree: 387 tests, 387 pass, 0 fail, 0 skipped.
`npm run lint`, `npm run validate`: exit 0, 35 manager Apps Script files, 3 dashboard files,
689 translation keys.

## 5. Manual tests performed

Synthetic preview pages (`?scenario=normal|large|slow|error|empty`) opened in the embedded
browser; navigation timings collected with `performance.now()` around clicks.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate; node scripts/manager-web-benchmark.js;
npm run preview:manager-web.

## 7. Actual results

Reported live baseline supplied with the task (not reproduced here): overview 6.9 s, projects
6.9 s, tasks 3.8 s, project detail 4.0 s, references 4.6 s. Google Sheets reads dominate that
time; the local mock cannot reproduce Workspace latency, so this gate makes no claim about it.

Actual starting state, measured locally:

- The page issued one RPC per view and two sequential RPCs for 案件 (`references`, then
  `projects`): **4 read RPCs** to show overview → projects → tasks.
- Every read execution re-read its tables from Sheets; `Tasks.list` read PROJECTS and SUBPROJECTS
  even when the ancestor-aware filter was not used, so the paginated `tasks` operation read 4
  tables.
- Browser reads were cached for 30 seconds only, and every successful write cleared the entire
  cache (`generation++; cache.clear()`), forcing a full reload of all views.
- `openEditor` always requested `references` again and requested the record with `fresh = true`,
  so opening a form always cost a round trip.
- The startup view, the list page and the editor each re-requested data already on screen.

## 8. Relevant logs and evidence

[baseline record](V1_5_1_BASELINE.md), [raw V1.5 measurements](V1_5_PERFORMANCE.json),
[pre-change test count in the V1.5 gates](V1_5_GATE_10.md).

## 9. Identified problems

Sequential RPCs per navigation, unbatched reference lookups, a whole-cache invalidation policy,
`fresh = true` detail reads, and redundant table reads inside one execution.

## 10. Corrective actions

Planned and executed in gates 2–6: an authorized snapshot, a compact task index, a client-side
store with stale-while-revalidate, selective invalidation and a lazy project/subproject read.

## 11. Remaining limitations

No live Workspace measurement was taken in this session; the reported seconds remain unverified
in this repository.

## 12. Final gate status

**PASS** for analysis. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION
PENDING**. **NOT APPROVED FOR PRODUCTION.**
