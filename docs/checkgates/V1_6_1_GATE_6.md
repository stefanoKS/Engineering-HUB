# V1.6.1 gate 6 — Performance, security and release evidence

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-29
Starting commit SHA: `ea3fbc9`
Branch: `fix/v1.6.1-stabilization`

## 1. Objective

Prove that the corrective release did not trade correctness for responsiveness, did not widen the security
surface, and left release evidence that separates local results from live verification.

## 2. Findings (audit of the V1.6 delivery)

1. The V1.6 gate records claimed PASS for figures that a correctness bug made wrong (area cards, KPIs, upcoming),
   and the deployment runbook contained two errors. Evidence must now be re-derived from the corrected code.
2. No release document recorded the difference between the local mock benchmark and live Workspace latency.

## 3. Required functionality

1. Re-run the full gate chain on the corrected code and record the real output.
2. Re-run the manager web benchmark and record the comparison with V1.6.
3. Keep the historical V1.6 evidence untouched and state live criteria as BLOCKED / NOT_RUN.

## 4. Relevant source files

`docs/checkgates/V1_6_1_GATE_1..6.md`, `docs/checkgates/V1_6_1_VALIDATION.txt`,
`docs/checkgates/V1_6_1_PERFORMANCE.json`, `docs/MANAGER_WEB_APP_PERFORMANCE.md`,
`docs/PRODUCTION_READINESS.md`, `CHANGELOG.md`, `README.md`, `README_JP.md`, `AGENTS.md`.

## 5. Automated test cases

The whole suite: `tests/*.test.js` (500 cases), including the five new V1.6.1 files
(`v1_6_1-counting`, `v1_6_1-requests`, `v1_6_1-deletion`, `v1_6_1-history`, `v1_6_1-compatibility`) and
`tests/v1_6_1-release.test.js` (this evidence).

## 6. Actual results

| Gate | Command | Result |
| --- | --- | --- |
| install | `npm ci` | exit 0, 364 packages, 0 vulnerabilities |
| lint | `npm run lint` | exit 0, no findings |
| validate | `npm run validate` | exit 0, 39 manager files, 3 dashboard files, 789 translation keys |
| unit/integration | `npm test` | exit 0, **500 tests, 500 pass, 0 fail, 0 skipped** |
| benchmark | `node scripts/manager-web-benchmark.js` | exit 0, `liveWorkspace: NOT_RUN` |

Raw output: [V1_6_1_VALIDATION.txt](V1_6_1_VALIDATION.txt).

### Benchmark versus V1.6 (local mock, same script, same baseline commit)

| Dataset | V1.6 bootstrap p50 / bytes | V1.6.1 bootstrap p50 / bytes | V1.6 nav / filter | V1.6.1 nav / filter |
| --- | --- | --- | --- | --- |
| 10 projects / 100 tasks | 4.43 ms / 10.5 KB | 5.87 ms / 11.0 KB | 0.77 / 0.07 ms | 0.81 / 0.08 ms |
| 100 / 1,000 | 43.40 ms / 57.3 KB | 46.48 ms / 57.8 KB | 1.45 / 0.39 ms | 1.42 / 0.40 ms |
| 300 / 3,000 | 115.55 ms / 152.7 KB | 140.35 ms / 153.2 KB | 1.13 / 2.19 ms | 1.11 / 2.05 ms |

`taskIndex` 47.37 ms p95 81.75 ms and 509.8 KB at 3,000 tasks (V1.6: 49.07 ms / 509.8 KB). Cached navigation
(< 100 ms target) and local filtering (< 50 ms target) are met with a wide margin.

**Disclosed regression.** The warm `bootstrap` grew +2 to +21 % because every displayed figure now derives from one
counting rule: `TaskScope.create()` costs 24.8 ms p50 at 3,000 tasks and each area rollup re-derives leaf work. The
first implementation was O(areas × tasks) with a per-call active list and an O(n²) area membership test; it was
replaced by one grouped pass (`summariseBy`) and leaf-only rollups before this document was written. The remaining
cost is the price of the correctness fix and is recorded rather than hidden. No live latency target is claimed.

## 7. Security review

- No new entrypoint, scope, Script Property or manifest change. `src/appsscript.json` and
  `dashboard-app/appsscript.json` are unchanged (still `DOMAIN` + `USER_ACCESSING` for the manager app, deployer-
  executed read-only for the employee app).
- New write paths: the `deletionReconcile` API action (ADMIN + `confirmed` + `RECONCILE DELETIONS`) and the
  recovery block inside `Requests.decideLocked` (manager, request row + audit only). Both are covered by
  `Access` checks that run on the server before any mutation.
- `npm run validate` still rejects `innerHTML`/`document.write` in `src/*.html`, dashboard access to
  `MailApp`/`DriveApp`/`ScriptApp` and non-allowlisted mail senders: 0 findings.
- Stored text remains untrusted: the new i18n keys are labels only, and every rendered value uses `textContent`.

## 8. Manual test cases (DEV, not executed)

1. Warm Workspace overview, project detail and a common save, recorded with account, dataset, timestamp, execution
   ID and deployment version (targets: overview < 3 s, detail < 2 s, save < 3 s).
2. Browser performance panel for first load and cached navigation in DEV.
3. Re-run the 20-case manager web smoke plan.

## 9. Problems found

- `npm run validate` failed once because `src/I18n.html` had not been regenerated after the dictionary change; the
  i18n sync is part of the release chain and is now run before validation in every check.
- The three historical release tests asserted the *current* release version in `package.json`, the publisher and
  the README headings; they were retargeted to 1.6.1 (their historical numbers, such as "406 tests", are kept).

## 10. Corrective actions

Documentation updated with the measured figures and the disclosed regression; the checkgates record the local PASS
and every live criterion as BLOCKED / NOT_RUN.

## 11. Remaining blockers

- Live Workspace latency, browser rendering, the DEV migration, the deployment versions, the request round trip and
  the shared-dashboard smoke test are **BLOCKED** (nothing was deployed, migrated, triggered or published in this
  session).
- `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation, benchmark) — **BLOCKED** for live Workspace verification.

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
