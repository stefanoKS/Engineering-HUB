# V1.6 gate 3 — Schema migration and data preservation

Status: **PASS** (local) — migration **NOT APPLIED** to any workbook
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: sealed in the delivery header (see §13)

## 1. Objective

Extend the schema for nested tasks, a validated area colour and explicit deletion markers without destroying a
Schema V6 workbook, and without applying anything automatically.

## 2. Relevant source files

`src/Schema.gs` (version 7, new fields and defaults), `src/Migrations.gs` (registry entry
`007_responsibility_hierarchy_and_lifecycle`, `initializeNewDatabase` records `INITIALIZE_V7`),
`DATA_SCHEMA.md`, `docs/V1_6_DEPLOYMENT_RUNBOOK.md`, `tests/core.test.js`,
`tests/v1_4-responsibilities.test.js`, `tests/v1_4_2-checkbox-rows.test.js`.

## 3. Required functionality

1. A reviewed, additive migration `007` from V6 to V7 adding `TASKS.Parent_Task_ID`, `TASKS.Deleted_At`,
   `PROJECTS.Deleted_At`, `SUBPROJECTS.Deleted_At` and `RESPONSIBILITIES.Color_Hex`.
2. No renamed, reordered or rewritten existing column; no automatic assignment, conversion or colouring.
3. Each approved migration creates its own verified backup and is idempotent.
4. A fresh workbook initializes at 7 and records `INITIALIZE_V7`.
5. Documented DEV procedure, pre/post checks and rollback; schema-7 writes must not be run against a V6 workbook.

## 4. Acceptance criteria

- The migration appends only missing columns; every legacy cell, formula and custom column survives.
- Repeating the upgrade changes nothing and creates no extra backup.
- Existing task/project/subproject/responsibility IDs stay valid.
- Running without approval fails before any backup or write.

## 5. Automated test cases

`tests/v1_2-model.test.js` (registry and version), `tests/v1_4-responsibilities.test.js` (additive preservation,
repeat, per-migration approval, fresh initialization), `tests/core.test.js` (full chain 1 → 7, repeated upgrade,
missing columns restored), `tests/gate-c-correctness.test.js`, `tests/gate6-release.test.js`,
`tests/v1_4_2-checkbox-rows.test.js`, `tests/v1_3-planning.test.js`, `tests/gate5-automation.test.js`
(each migration takes a backup independently of the daily backup switch).

## 6. Actual test results

PASS locally: the chain 1 → 7 runs each migration with its own backup, the repeat is a no-op, and the preformatted
checkbox rows survive. **No workbook was migrated.** Live migration is part of the DEV runbook (§1).

## 7. Manual test cases (DEV, not executed)

Full runbook: [docs/V1_6_DEPLOYMENT_RUNBOOK.md](../V1_6_DEPLOYMENT_RUNBOOK.md) steps 1.1–1.7 (backup, approval,
single upgrade, cell spot-check, repeat, audit of settings/triggers).

## 8. Performance results

Not applicable: a migration runs once. The added columns are blank, so read volume is unchanged (+0 rows).

## 9. Security review

The migration requires the exact approved ID, creates a restricted backup first, verifies preservation cell by
cell and records success or failure in `SCHEMA_MIGRATIONS`. It enables no automation, publishes nothing and cannot
initialize an existing workbook.

## 10. Problems found

Applying the new schema in code made several historical release tests assert the old version numbers. They were
retargeted to the current release (schema 7, contract 1.5) and recorded here rather than silently deleted.

## 11. Corrective actions

Documentation updated (`DATA_SCHEMA.md` compatibility section, runbook); the tests assert the new state explicitly.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

A DEV migration with live data is **NOT_RUN** (no credentials). `docs/PRODUCTION_READINESS.md` stays unapproved.
Known limitation: schema-7 domain writes against a still-V6 workbook fail closed with a missing-column error; the
migration must be applied first.

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA sealed in the delivery commit.
**IMPLEMENTED — DEV MIGRATION PENDING. NOT APPROVED FOR PRODUCTION.**
