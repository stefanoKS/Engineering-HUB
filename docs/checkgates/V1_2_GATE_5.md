# V1.2 Check Gate 5 — Tests, documentation and deployment

| Field | Value |
| --- | --- |
| Baseline | `cc5b836002146632dbdfdf4f2c292082fb7573db` |
| Branch | `feature/v1.2-shared-dashboard` |
| Date | 2026-10-25 |
| Environment | local (mocked Google services; real Chromium for screenshots) |
| Result | **PASS (local)** — production untouched, Workspace UNVERIFIED |

## Checklist

| Item | Result | Evidence |
| --- | --- | --- |
| Existing tests pass | PASS | All 105 V1.1 tests still run and pass; only their emulated starting schema version was updated to include `004_shared_dashboard` (the migration path now has one more reviewed step, and each approved migration still takes its own verified backup). |
| New dashboard tests pass | PASS | `tests/v1_2-model.test.js`, `tests/v1_2-publisher.test.js`, `tests/v1_2-dashboard.test.js`, `tests/v1_2-release.test.js`. |
| Lint passes | PASS | `npm run lint` (eslint over `src/**/*.gs`, `dashboard-app/**/*.gs`, `*.js`, `*.mjs`). |
| Source validation passes | PASS | `npm run validate` → "Validated 31 manager Apps Script files, 2 dashboard files and both manifests". |
| Deployment targets are separate | PASS (static) | Different `rootDir` (`src` vs `dashboard-app`), different manifests, different scopes; `npm run validate` asserts the dashboard has no manager modules and no master property. |
| V3 → V4 migration tested | PASS | Cell-by-cell preservation asserts in `tests/core.test.js`, `tests/gate-c-correctness.test.js`, `tests/gate6-release.test.js`; schema/default assertions in `tests/v1_2-model.test.js`; the migration-seeds-nothing property in `tests/v1_2-publisher.test.js` (a migrated project stays `RESTRICTED`). |
| Private source data preserved | PASS | Publication compares the full manager workbook before/after; migration tests compare every cell and formula. |
| Documentation matches actual implementation | PASS | See the file list below; `tests/v1_2-release.test.js` asserts the documents exist and describe the implemented surface. |
| Development smoke-test plan exists | PASS | [dashboard/SMOKE_TEST.md](../dashboard/SMOKE_TEST.md) (5 sections, all items UNVERIFIED). |
| Production remains unmodified | PASS | No deployment, no Workspace resource created or inspected, no production property changed. Status remains **NOT APPROVED FOR PRODUCTION**. |

## Test totals

```text
npm ci            -> lockfile install
npm run lint      -> pass (src + dashboard-app)
npm test          -> 149 tests, 149 pass, 0 fail
npm run validate  -> 31 manager files, 2 dashboard files, both manifests
```

Breakdown: 105 pre-existing tests (V1.0/V1.1) plus 44 new V1.2 tests:

| File | Tests | Covers |
| --- | --- | --- |
| `tests/v1_2-model.test.js` | 9 | schema 4, visibility, DTO allowlisting, private-field exclusion, cross-project references, aggregates, sibling isolation, health, content hash |
| `tests/v1_2-publisher.test.js` | 13 | initialization guards, destination guards, allowlisted snapshot, A/B alternation, idempotency, interruption, OFF suppression, approval flow, status/preview, mail independence, manager sidebar controls, role requirement |
| `tests/v1_2-dashboard.test.js` | 14 | contract parity, portfolio, search, grouping, deadline wording, bounded responses, staleness, viewer restrictions, fail-closed snapshots, read-only surface, client rendering/safety, stale and error states, empty state, 100 projects / 5 000 tasks scale |
| `tests/v1_2-release.test.js` | 8 | documentation and gate presence, doc coverage, release status, ignored deployment files, no write/mail surface, validation run, no credentials, honest preview tooling |

## Scale measurement (mock only)

```text
V1.2 viewer timings (mock, not Workspace): {"portfolioMs":14,"projectDetailMs":7,
  "portfolioChars":38071,"publishedTasks":4000}
V1.2 scale timings (mock, not Workspace): {"dashboardRefresh":…,"notificationScan":…}
```

These numbers come from an in-memory mock, not from Sheets. Real latency, quote usage and
CacheService behaviour are UNVERIFIED.

## Documentation updated

| File | Change |
| --- | --- |
| `README.md`, `README_JP.md` | V1.2 status, two-application model, dashboard links |
| `ARCHITECTURE.md` | Two applications, publication projection, new modules |
| `DATA_SCHEMA.md` | Version 4, new columns and their publication rules, new audit actions |
| `DEPLOYMENT.md` | `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`, separate dashboard deployment |
| `AGENTS.md` | Rules 34–41 (V1.2 mandatory rules) |
| `.github/copilot-instructions.md` | Shared dashboard constraints |
| `docs/SECURITY_MODEL.md` | Section 10: dashboard controls and residual risks |
| `docs/PRODUCTION_READINESS.md` | V1.2 identity, gates, dashboard status, blockers |
| `docs/AUTOMATION_SETTINGS.md` | Publication settings and audit actions |
| `CHANGELOG.md` | V1.2 entry |
| `docs/dashboard/ARCHITECTURE.md` | Component map and publication flow |
| `docs/dashboard/DATA_CONTRACT.md` | Sheet layout, field provenance, prohibitions, bounds |
| `docs/dashboard/VISUAL_SPEC.md` | Design tokens, layout, breakpoints, accessibility, captured screenshots |
| `docs/dashboard/ACCESS_AND_SHARING.md` | Deployment ACL model, Drive ACLs to record |
| `docs/dashboard/DEPLOYMENT.md` | Snapshot init, activation, schedule, disable, rollback |
| `docs/dashboard/SMOKE_TEST.md` | Unverified live checklist |
| `docs/checkgates/V1_2_GATE_1..5.md` | These gates |

## Production-readiness decision

**NOT APPROVED FOR PRODUCTION.** Local tests, lint, validation and browser captures are not
Workspace evidence. The blockers in [docs/PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md)
remain open, including every dashboard deployment and ACL item.
