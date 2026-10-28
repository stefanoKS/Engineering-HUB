# V1.6 gate 12 — Final integration and release assessment

Status: **PASS** (local delivery) — **BLOCKED** for DEV migration and Workspace verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: sealed in the delivery header (see §13)

## 1. Objective

Integrate the V1.6 work, prove the end-to-end scenario locally and record an honest release status.

## 2. Relevant source files

All V1.6 changes: `src/Schema.gs`, `src/Migrations.gs`, `src/TaskTree.gs`, `src/Completion.gs`,
`src/Deletion.gs`, `src/Responsibilities.gs`, `src/Subprojects.gs`, `src/Eligibility.gs`, `src/Progress.gs`,
`src/Tasks.gs`, `src/Ui.gs`, `src/Requests.gs`, `src/ManagerWeb.gs`, `src/ManagerWebApi.gs`,
`src/ManagerWebClient.html`, `src/ManagerWebStyles.html`, `src/ManagerWebIndex.html`,
`src/SharedDashboardModel.gs`, `src/SharedDashboardPublisher.gs`, `dashboard-app/DataService.gs`,
`dashboard-app/Client.html`, `dashboard-app/Styles.html`, `shared/i18n.js`, `scripts/validate-source.js`,
`scripts/manager-web-benchmark.js`, `tests/*`, documentation.

## 3. Final integration scenario (local, synthetic)

製品設計 → 5Q45 → 納入部品図作成 → フロント部品 → 図面作成 → 断面図作成 / 寸法確認 / 最終提出.

| # | Step | Result |
| --- | --- | --- |
| 1 | Responsibility visible on the dashboard | PASS (`v1_6-responsibilities`) |
| 2 | Selecting the area filters projects | PASS (no RPC) |
| 3 | Creating 5Q45 requires a responsibility | PASS |
| 4 | Subprojects and nested tasks display | PASS (`v1_6-hierarchy`) |
| 5 | Tasks assignable to members | PASS |
| 6 | Employee sees only published projects | PASS (`v1_2-dashboard`, `v1_4-hierarchy`) |
| 7 | Employee submits a completion report | PASS (request model + inbox import) |
| 8 | Manager sees the pending request | PASS (`v1_6-completion`) |
| 9 | Manager approves | PASS |
| 10 | Task becomes Done / 100 % | PASS |
| 11 | Member history records the approved completion | PASS (`v1_6-member-history`) |
| 12 | Parent progress updates correctly | PASS (leaf-only rollup) |
| 13 | Task sorting/filtering works | PASS |
| 14 | Safe deletion handles mistaken records | PASS (`v1_6-deletion`) |
| 15 | No restricted information leaks | PASS (DTO allowlists, publication tests) |
| 16 | Navigation stays responsive from the cache | PASS (benchmark) |

Steps 6–8 exercise the domain model and the sanitized snapshot; the real browser round trip in DEV is **NOT_RUN**.

## 4. Acceptance criteria

- Full gate sequence green: `npm ci`, `npm run lint`, `npm test`, `npm run validate`,
  `node scripts/manager-web-benchmark.js`.
- Twelve checkgates exist with an explicit status and evidence.
- Documentation updated: README/README_JP, ARCHITECTURE, DATA_SCHEMA, DEPLOYMENT, CHANGELOG,
  PRODUCTION_READINESS, dashboard contract, runbook.
- No automatic deployment, migration, initialization, trigger, mail or Calendar activation.

## 5. Actual test results

`npm ci` exit 0; `npm run lint` exit 0; `npm test` **462 tests, 462 pass, 0 fail, 0 skipped**; `npm run validate`
exit 0 (38 manager Apps Script files, 3 dashboard files, both manifests, 779 translation keys); benchmark exit 0.
Outputs: [V1_6_VALIDATION.txt](V1_6_VALIDATION.txt), [V1_6_PERFORMANCE.json](V1_6_PERFORMANCE.json).

## 6. Security review summary

Authorization, revision checks, actor/role spoofing refusal, lock-based writes, deletion preflight, completion
enforcement and snapshot sanitization are covered by the suites listed in gate 11 §8. The one intentional policy
change (narrow ADMIN deletion) is documented in AGENTS.md rule 78 and gate 7 §9.

## 7. Problems found and corrective actions

1. Historical tests asserted the V1.4/V1.5 schema, contract and direct-completion behaviour; each was retargeted to
   the V1.6 contract and the change is recorded in gates 3, 4 and 6.
2. Task-index performance regression from per-task lookups (gate 1 §10, gate 11 §9).
3. Cascade deletion blocked by sibling references (gate 7 §10).
4. Publisher date normalisation missed `completedAt` (gate 9 §10).

## 8. Remaining blockers

- DEV migration of a real workbook (gate 3).
- Live ADMIN/MANAGER/employee identity matrix, request inbox round trip, publication flip and rollback rehearsal
  (gates 6, 7, 9, 11).
- Real browser rendering, zoom and assistive-technology checks (gate 10).
- Live latency and long-session memory measurement (gate 11).

## 9. Deployment

Only the procedure in [docs/V1_6_DEPLOYMENT_RUNBOOK.md](../V1_6_DEPLOYMENT_RUNBOOK.md). Nothing was deployed.

## 11. Release status

**V1.6 IMPLEMENTED — DEV MIGRATION AND WORKSPACE VERIFICATION PENDING.**
`docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

## 12. Final gate status

**PASS** for local implementation, tests, validation and benchmarks. **BLOCKED** for live verification.
Twelve gates recorded: 1–12 PASS locally; every gate marks its live criterion BLOCKED / NOT_RUN.

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA sealed in the delivery commit.
