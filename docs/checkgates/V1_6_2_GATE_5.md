# V1.6.2 gate 5 — Security, performance and final regression

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `40c3ed6c422074b801056b96c04769051d14ca53`
Branch: `fix/v1.6.2-reliability`

## 1. Objective

Verify that the V1.6.2 corrections preserve the V1.6.1 architecture, authorization model, counting rules and
performance envelope, and that every gate records honest evidence separated from live Workspace verification.

## 2. Confirmed root cause

Not applicable — this gate verifies the four corrective gates (1–4) rather than introducing a defect. The release
was triggered by the request-attribution, audit-finalization and date-conversion defects confirmed in gates 1 and 2
and the receipt and attribution gaps in gates 3 and 4.

## 3. Before behavior

Baseline `40c3ed6` (V1.6.1): 500 automated tests passing, `npm run lint` and `npm run validate` clean, benchmark
recorded in `V1_6_1_PERFORMANCE.json`.

## 4. Corrected behavior

No architectural change was made in this release:

- Schema **7**, employee contract **1.5** (reader accepts **1.4** and **1.5**), startup schema 6 → `006`/`007`
  migrations, `CONTRACT_VERSION = '1.5'`, `Migrations.gs` still contains no `008_`.
- Manager web app runs as **USER_ACCESSING**; the employee app runs as **USER_DEPLOYING**; the domain restriction
  stays. Spreadsheets A (manager), B (published snapshot) and C (request inbox) remain separate.
- Four subproject levels, three task levels, responsibility-based selection, the ADMIN deletion journal, the
  reviewed completion workflow and the V1.5.1 local-first state management are untouched.
- The new endpoints are additive: `previewRequestDecisionReconciliation`, `reconcileRequestDecision`,
  `previewCompletionOverrideReconciliation`, `reconcileCompletionOverrides`,
  `previewRequestInboxReconciliation`, `reconcileRequestInbox`, `uiRequestInboxPreview`, `uiRequestInboxReconcile`.

## 5. Source files modified

`src/Requests.gs`, `src/Completion.gs`, `src/ManagerWeb.gs`, `src/ManagerWebClient.html`, `src/Ui.gs`,
`src/UiRequests.html`, `src/ManagerWebIndex.html` (version), `src/SharedDashboardPublisher.gs` (version),
`shared/i18n.js` + generated copies, `package.json`, `README.md`, `README_JP.md`, `CHANGELOG.md`,
`scripts/manager-web-benchmark.js`, five V1.6.2 checkgates plus `V1_6_2_VALIDATION.txt` /
`V1_6_2_PERFORMANCE.json`, and the tests listed below.

## 6. Test cases

- New: `tests/v1_6_2-requests.test.js` (14), `tests/v1_6_2-completion.test.js` (5),
  `tests/v1_6_2-inbox.test.js` (9), `tests/v1_6_2-member-area.test.js` (8),
  `tests/v1_6_2-release.test.js` (release agreement, gates, evidence, boundaries).
- Replaced unsafe expectations, with their rationale recorded in the files themselves:
  `tests/v1_3-requests.test.js` (automatic approval from a matching deadline) and
  `tests/v1_6_1-requests.test.js` (two `REQUEST_DECIDED` rows for one decision).
- Version-agreement tests (`v1_4_1`, `v1_5_1`, `v1_6`, `v1_6_1` release tests) now point at 1.6.2 while keeping
  their own historical numbers.
- Security regression retained from earlier releases: `tests/gate-a-security.test.js`,
  `tests/v1_3_1-stabilization.test.js`, `tests/v1_4_1-stabilization.test.js`,
  `tests/v1_6_1-compatibility.test.js` (ADMIN/MANAGER/MEMBER/VIEWER, unregistered and out-of-domain identity,
  forged `actor`/`actorEmail`/`role`/`confirmed`/`reviewer`/`requestId`/`taskId`).

## 7. Actual test results

Local, `2026-10-28` (Windows, Node.js per `npm`/`node --version`):

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | **543 tests, 543 pass, 0 fail, 0 skipped** |
| `npm run validate` | exit 0 — 39 manager files, 3 dashboard files, both manifests, 812 translation keys |
| `node scripts/manager-web-benchmark.js` | exit 0 — `V1_6_2_PERFORMANCE.json` |

Raw output: `docs/checkgates/V1_6_2_VALIDATION.txt`; measurements: `docs/checkgates/V1_6_2_PERFORMANCE.json`.

## 8. Security implications

- Every new mutating entrypoint calls `Access` (`requireManager` / `requireAdmin`) before delegating, and the
  domain service re-checks `Roles` with the verified `Session.getActiveUser()` identity (AGENTS.md rules 26, 69).
- No browser-supplied `actor`, `actorEmail`, `role`, `confirmed`, `reviewer`, `requestId` or `taskId` becomes
  authority; the existing `ManagerWebApi` spoofing guard is unchanged.
- Optimistic concurrency is preserved: `Ui.updateProject` / `Ui.assignTask` revision checks are untouched, and the
  request path still refuses a stale revision instead of overwriting it.
- No private data was added to any published DTO, and the reconciliation payloads expose only request IDs and
  receipt states.
- The employee application still cannot read spreadsheet A and has no write path to the snapshot.

## 9. Performance implications

- Cached navigation p50 0.75 / 1.39 / 1.03 ms and local filtering p50 0.07 / 0.39 / 1.40 ms for 10/100/300
  projects — within the <100 ms / <50 ms cached targets, and unchanged versus V1.6.1.
- `bootstrap` p50 5.12 / 45.27 / 142.02 ms and 11.0 / 57.8 / 153.2 KB — unchanged within noise.
- `requestApproval` p50 2.74 / 12.45 / 34.12 ms (V1.6.1: 2.34 / 11.34 / 31.94 ms) — the disclosed cost of two extra
  durable journal rows and one extra bounded `AUDIT_LOG` read per decision.
- New measurements: `requestReconciliation` 4.43 / 37.13 / 111.93 ms p50 and `auditFinalization`
  1.07 / 4.12 / 11.09 ms p50; both are rare administrative operations.
- Area switching improves from 137.34 ms / 9 990 B to 110.80 ms / 8 868 B at 300 projects.
- No full-table scan was added to a navigation path; no extra background RPC was added (`rpcAfterInitialLoad`
  unchanged at 2–3).

## 10. Known limitations

- Google Sheets provides no cross-sheet transaction. Ambiguous request and override outcomes are surfaced and
  reviewable; they are not automatically resolved and no exactly-once guarantee is claimed.
- Local mocks are not Workspace verification.
- The benchmark measures Node/vm execution of the real client, not browser paint or network time.

## 11. Remaining blockers

All live criteria are **BLOCKED / NOT_RUN**: DEV deployment, `Session.getActiveUser()` behaviour inside the
Workspace domain, the real request round trip (inbox → import → decision → receipt), a real Sheets date cell, a
real audit-write failure, publication against a real snapshot spreadsheet and browser paint timings.

## 12. Final gate status

**PASS** locally (implementation, 543 tests, lint, validation, benchmark) — **BLOCKED** for live Workspace
verification. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

Implementation commit SHA: `bae3897650ed2a85cdd144b8c2476a6abab5c2c3` (recorded by this evidence commit).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
