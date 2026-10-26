# V1.4.1 gate 6 — documentation, installation and release assessment

Status: **PASS (local files and automated checks only)** — Workspace behavior remains UNVERIFIED.
Production readiness stays **NOT APPROVED FOR PRODUCTION**.

## Installation documentation

| Check | Result |
| --- | --- |
| A new development workbook documents `initializeNewDatabase()` at schema **6** and `INITIALIZE_V6` | PASS — `DEPLOYMENT.md` §4 and §8.5, `docs/PRE_TRIAL_CHECKLIST.md` §9 |
| A fresh V6 workbook is documented as *not* running migration 006 | PASS — both documents state it explicitly |
| An existing V5 (V1.3.1) workbook documents approving exactly `006_responsibilities_and_nested_subprojects` | PASS — `docs/PRE_TRIAL_CHECKLIST.md` §9, `DEPLOYMENT.md` §V1.4 upgrade |
| Older workbook upgrade paths list every required migration ID | PASS — V1.1/V1.2/V1.3.1 → V1.4 chains in `docs/PRE_TRIAL_CHECKLIST.md` |
| `clasp push` is documented as code-only (no database, migration, property, trigger or deployment step) | PASS — `DEPLOYMENT.md` |
| The two clasp targets stay separate (`rootDir = src` / `dashboard-app`) | PASS — `DEPLOYMENT.md`, `docs/dashboard/DEPLOYMENT.md`, `npm run validate` |
| Function names, Script Property names, backup result values and the bootstrap wrapper match the code | PASS — reviewed against `src/Migrations.gs`, `src/Config.gs`, `src/Access.gs` |

## Documentation consistency

| Document | Update |
| --- | --- |
| `README.md` / `README_JP.md` | Release table moved to V1.4.1 / schema 6 / 328 local tests, plus a V1.4.1 section |
| `AGENTS.md` | Rule 27 and rule 60 rewritten for the department-wide policy; rules 68–77 added |
| `ARCHITECTURE.md` | V1.4.1 section (policy, callable surface, single write, bounded walks, eligibility, sidebar scale) |
| `DATA_SCHEMA.md` | Responsibility/owner semantics updated; no schema change |
| `DEPLOYMENT.md` | `INITIALIZE_V6` replaces the stale `INITIALIZE_V5` text |
| `CHANGELOG.md` | V1.4.1 entry |
| `docs/PRE_TRIAL_CHECKLIST.md` | V6 initialization and the corrected upgrade chains |
| `docs/PRODUCTION_READINESS.md` | Version 1.4.1, 328 local tests, new gate rows and blocker 12; still NOT APPROVED |
| `docs/RESPONSIBILITIES.md` | Policy table, 廃止 / 再有効化 naming, reorder contract, limitation text |
| `docs/SECURITY_MODEL.md` | Role matrix, responsibility scope, direct callable surface |
| `docs/MANAGER_WORKFLOW.md` | Role table, 廃止 / 再有効化, task search hint |
| `docs/UI_UX_GUIDELINES.md`, `docs/dashboard/SMOKE_TEST.md` | （廃止）label |
| `docs/checkgates/V1_4_GATE_2.md` | Marked as superseded by this release |

## Automated verification

```text
npm ci            -> 0 vulnerabilities
npm run lint      -> pass
npm test          -> 328 tests, 328 pass, 0 fail, 0 skipped
npm run validate  -> 33 Apps Script files, 3 dashboard files, both manifests, 532 translation keys
npm run preview:dashboard -> static preview written (not Workspace evidence)
```

## Issue classification

**BLOCKER (fixed in this release, before the trial)**

1. MANAGER ownership checks made collaboration impossible and produced spurious permission
   errors. Fixed: department-wide role policy.
2. `Ui.updateProject` could commit ordinary fields before a failing responsibility transfer.
   Fixed: one validated, coordinated write.
3. `Responsibilities.reorder` wrote rows it had not validated and depended on an ownership policy.
   Fixed: full validation, changed-rows-only write, deterministic result.
4. Global Apps Script write functions were reachable without a role check. Fixed: `Access` in
   every record-mutating and manager-read global.
5. Malformed hierarchy data could recurse without bound. Fixed: visited/path guards.
6. A task could be created or moved beneath an archived ancestor. Fixed: `archivedChain` check.
7. Reminder eligibility checked only the immediate subproject. Fixed: one ancestor-aware rule.
8. The sidebar silently truncated the task list at 300 rows. Fixed: reported total + server search.
9. Installation documentation described `INITIALIZE_V5`. Fixed: V6 with the correct upgrade chain.

**NON-BLOCKER (can be investigated during the DEV trial)**

- The `<select>` popup extends past 300px for a very long project name; the page itself does not
  scroll. Cosmetic and native to the browser control.
- `Ui.context` still reads whole tables; fine at the current scale, measurable later.
- Health classification still considers tasks in archived subprojects; it is a project-level
  heuristic, not an active-work indicator.

**LIVE-ONLY (cannot be verified locally)**

- Session identity, sidebar iframe size, menu routing, OAuth scopes.
- Drive backup/restore permissions and the snapshot workbook ACL.
- Scheduled triggers, mail/Calendar delivery and quota behaviour.
- Migration of a copy of a real workbook.

## Verdict

**READY FOR DEVELOPMENT TRIAL.** All automated checks pass, no confirmed blocking code defect
remains that can be resolved locally, and the installation documentation matches the code.

**NOT APPROVED FOR PRODUCTION** — no live Google Workspace evidence exists.
