# V1.4 gate 1 — schema and migration

Status: **PASS (local only)**

Scope: schema version 6, `006_responsibilities_and_nested_subprojects`, preservation of every
existing cell, formula, custom column and stable ID.

## What was checked

| Check | Evidence |
| --- | --- |
| `Schema.version === 6` with `RESPONSIBILITIES`, `PROJECTS.Responsibility_ID`, `SUBPROJECTS.Parent_Subproject_ID` | `tests/v1_4-responsibilities.test.js` → "schema version 6 adds the responsibility table and project link with a blank default" |
| New columns default to blank, so nothing is assigned automatically | same test (`defaultValue === ''` for both links) |
| `PROJECTS.Category` is preserved as a separate concept | same test |
| Migration registry lists 002…006 in order | `tests/v1_2-model.test.js` → "schema version 6 adds responsibilities, nested subprojects and the V1.2/V1.3 fields" |
| The migration refuses to run without its exact approval and takes no backup when refused | "migration 006 refuses to run without explicit approval and takes a verified backup" |
| A verified backup is created before the schema change | same test (`app.backups.length === 1` after the approved run) |
| Every pre-existing cell, formula and custom column survives | "migration 006 is additive and preserves every legacy cell, formula and custom column" |
| Existing projects stay 未分類 and existing subprojects stay root-level | same test |
| No example responsibility is seeded | same test and "a new database initializes with the responsibility table and no seed rows" |
| Repeating the migration changes nothing and duplicates no column | "repeating migration 006 changes nothing and duplicates no column" |
| A fresh empty workbook initializes directly at version 6 | "a new database initializes with the responsibility table and no seed rows" |
| Earlier releases still pass their migration preservation gates | `tests/core.test.js`, `tests/gate-c-correctness.test.js`, `tests/gate5-automation.test.js`, `tests/gate6-release.test.js`, `tests/v1_3-planning.test.js` (updated only for the version/backup counts) |

## Commands run

```text
npm ci
npm run lint      # clean
npm test          # 302 tests, 302 pass, 0 fail
npm run validate  # 33 manager files, 3 dashboard files, both manifests, 529 keys
```

## Not verified here

No workbook was initialized, migrated, backed up or deployed against Google Workspace. The
backup, Drive permissions, sheet quotas and migration timing must be verified in a development
deployment. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED**.
