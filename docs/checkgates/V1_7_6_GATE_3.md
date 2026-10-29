# V1.7.6 GATE 3 — Response contracts, performance and release consistency

| Field | Value |
| --- | --- |
| Release line | V1.7.6 corrective release (application version `1.7.6`; V1.7 has not been deployed) |
| Scope | `src/ManagerWebClient.html` (`readContract` → `automation`), `src/UiSettings.html` (`render`), `src/Config.gs`, `src/ManagerWebIndex.html`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, `README_JP.md`, `ARCHITECTURE.md`, `AGENTS.md` |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT RUN** |
| Backend impact | None — client-side validation and release metadata only; schema 8 and employee contract 1.6 unchanged |

## 1. Remaining unvalidated response access

| File | Access | Previous behaviour | Now |
| --- | --- | --- | --- |
| `ManagerWebClient.html` `renderAutomation` | `data.settings`, `data.status.emergencyStop`, `data.status.mode`, `data.revision` | a payload without `status` threw `TypeError` inside `handleError`, which re-entered `render` and threw again (unhandled rejection) | `readContract('automation')` requires `settings` (array) and `status` (object), normalizes `history`, and reports `INVALID_RESPONSE: expected object for automation.status` with a retry |
| `UiSettings.html` `render` | `data.settings.forEach`, `data.status.mode` | `TypeError: data.settings.forEach is not a function` / `Cannot read properties of undefined (reading 'mode')` shown as a raw message | `EH.requireObject(data, 'settings')`, `EH.requireArray(data.settings, 'settings.settings')`, `EH.requireObject(data.status, 'settings.status')`, `EH.optionalArray(data.history, 'settings.history')` |

No other `.length` / `.map` / `.forEach` / `.join` access on remote data was found in the manager
application, the four bound sidebars or the shared dashboard: the remaining accesses run on locally
built arrays or on values already normalized by the boundary helpers.

## 2. Response contracts that stay unchanged

`bootstrap`, `overview`, `projects`, `tasks`, `parentOptions`, `requests`, `members`,
`responsibilities`, `skills`, `project`, `task`, `editor`, `member` and `plan` keep their existing
required/optional field matrix. No server payload shape was changed in this release.

## 3. Performance

`node scripts/manager-web-benchmark.js` (BENCHMARK_OUTPUT=`V1_7_6_PERFORMANCE.json`), local mocks,
100 / 1,000 / 3,000 tasks:

| Operation | v1.7.5 range reads | v1.7.6 range reads | v1.7.5 writes | v1.7.6 writes |
| --- | --- | --- | --- | --- |
| task update | 17 | 17 | 6.33 | 6.33 |
| task create | 13 | 13 | 4 | 4 |
| request approval | 19 | 19 | 14 | 14 |
| bootstrap | 10 | 10 | 0 | 0 |
| compact index | 6 | 6 | 0 | 0 |
| scoped overview | 10 | 10 | 0 | 0 |

Cells written per call and payload sizes are unchanged. UI metrics: `rpcAfterInitialLoad` = 2,
`taskIndexLoaded` = true at every dataset size; cached navigation p50 1.17 / 1.78 / 3.50 ms.

Client-side calls added by this release (measured by the tests, not by the Sheets benchmark):

| Operation | Added |
| --- | --- |
| decision with the index loaded | +1 compact-index read (the same policy a task save already uses) |
| decision with the index not loaded | 0 |
| import that created a request | +1 compact-index read |
| import that created nothing | 0 |
| first paint, タスク, 申請一覧 without new rows | 0 |

The experimental Sheets API reader stays inactive and no global server cache was added.

## 4. Version consistency

| Place | Value |
| --- | --- |
| `src/Config.gs` `APP_VERSION` | `1.7.6` |
| `src/ManagerWebIndex.html` header badge | `V1.7.6` |
| `package.json` / `package-lock.json` | `1.7.6` |
| `CHANGELOG.md` | `## V1.7.6 — request consistency and asynchronous-state safety` |
| `README.md` / `README_JP.md` | current release V1.7.6, V1.7.5 kept as history |
| schema version | 8 (unchanged) |
| employee publication contract | 1.6 (unchanged) |
| publisher version | 1.7.0 (unchanged) |

## 5. Actual validation results

```
npm ci            → up to date, 0 vulnerabilities reported by the local install
npm run lint      → eslint . (no findings)
npm test          → tests 752 / pass 752 / fail 0 / cancelled 0 / skipped 0
npm run validate  → 42 manager Apps Script files, 3 dashboard files, both manifests, 970 translation keys
node scripts/manager-web-benchmark.js → docs/checkgates/V1_7_6_PERFORMANCE.json (liveWorkspace NOT_RUN)
```

## 6. Known limitations

- `npm ci` was executed against the existing lockfile; the dependency set is unchanged by this
  release (no new package), so the install result is identical to v1.7.5.
- Benchmarks run against local mocks. They prove the absence of extra Sheets work, not Workspace
  behaviour.

## 7. Remaining blockers

No DEV Workspace evidence exists for V1.7.6. The deployment, migration, initialization, trigger,
publication and notification configuration were not touched by this release, and no deployment was
performed.

## 8. Final gate status

Status: **PASS (local)** — **BLOCKED** for live verification. Production readiness: **NOT APPROVED
FOR PRODUCTION**.
