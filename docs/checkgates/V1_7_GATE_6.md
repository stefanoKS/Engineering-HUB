# V1.7 GATE 6 — Release verification

| Field | Value |
| --- | --- |
| Release | V1.7 |
| Result | **PASS (local)**; production readiness **BLOCKED** (no live evidence) |

## Gate results

| Command | Result |
| --- | --- |
| `npm ci` | NOT RUN in this environment; the lockfile is unchanged and no dependency was added or removed |
| `npm run lint` | PASS — 0 findings |
| `npm test` | PASS — **592 tests, 592 pass, 0 fail, 0 skipped** |
| `npm run validate` | PASS — 40 manager Apps Script files, 3 dashboard files, both manifests, 892 translation keys |
| `node scripts/manager-web-benchmark.js` (via `BENCHMARK_OUTPUT=V1_7_PERFORMANCE.json`) | PASS — see [V1_7_PERFORMANCE.json](V1_7_PERFORMANCE.json) |

## Performance (local mock, `V1_7_PERFORMANCE.json`)

| Projects / Tasks | bootstrap p50 | task index p50 | bootstrap payload |
| --- | --- | --- | --- |
| 10 / 100 | 6.68 ms | 2.33 ms | 11,320 B |
| 100 / 1,000 | 46.31 ms | 19.21 ms | 58,079 B |
| 300 / 3,000 | 165.79 ms | 53.79 ms | 153,493 B |

Bootstrap still reads each source table at most once (`rangeReadsPerCall = 10` for the interactive
overview). Adding member membership did not add a per-task read: the relationship index is built once
per execution. `liveWorkspace` is recorded as **NOT_RUN** in the evidence file.

## Documentation updated

`README.md`, `README_JP.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `DEPLOYMENT.md`,
`AGENTS.md`, `docs/PRODUCTION_READINESS.md`, `docs/dashboard/DATA_CONTRACT.md`,
`docs/RESPONSIBILITIES.md`, `docs/MANAGER_WORKFLOW.md`,
`docs/MANAGER_WEB_APP_PERFORMANCE.md`, `docs/UI_LOCALIZATION.md`, plus the three new documents
[docs/MULTI_ASSIGNEE.md](../MULTI_ASSIGNEE.md),
[docs/dashboard/EMPLOYEE_WORKER_VIEW.md](../dashboard/EMPLOYEE_WORKER_VIEW.md) and
[docs/V1_7_DEPLOYMENT_RUNBOOK.md](../V1_7_DEPLOYMENT_RUNBOOK.md).

## Historical records

Every earlier gate file (`GATE_1..6`, `V1_2_*`, `V1_3_*`, `V1_4_*`, `V1_5_*`, `V1_6_*`) is kept
unchanged as a historical local record. `V1_6_2_PERFORMANCE.json` was restored after an accidental
benchmark overwrite, so the V1.7 measurements live only in `V1_7_PERFORMANCE.json`.

## Outstanding (BLOCKED / NOT_RUN)

- Live Google Workspace verification of any kind: identity matrix, real Sheets timings, deployment
  ACLs, inbox round trip, publication A/B commit, deletion backup.
- `docs/PRODUCTION_READINESS.md` therefore stays **NOT APPROVED FOR PRODUCTION**.
