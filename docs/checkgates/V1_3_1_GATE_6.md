# V1.3.1 Gate 6 — Installation and trial documentation

Scope: the repository must be installable by a manager who has never seen it, without
inventing functions or properties.

## Result

Result: **PASS** (documents updated and cross-checked against the source) — no step has been
executed against a real Workspace.

## Files updated

| File | Change |
| --- | --- |
| `README.md` | Release status re-stated for V1.3.1 (version, 254 local tests, schema 5, new blockers), pre-trial checklist link, V1.3.1 feature section |
| `README_JP.md` | Japanese equivalent of the same changes |
| `ARCHITECTURE.md` | New "V1.3.1 — create/edit symmetry and implicit import" section (partial patches, staleness guard, visibility decision, import-on-open) |
| `DATA_SCHEMA.md` | `Dashboard_Visibility` / `Dashboard_Summary` editing and `TASKS.Last_Updated` staleness semantics (no schema change) |
| `DEPLOYMENT.md` | V1.3.1 delta section with the server entry points; `REQUEST_SUBMISSION_ENABLED` now explicit |
| `AGENTS.md` | Rules 49–56 for this release |
| `.github/copilot-instructions.md` | V1.3.1 contributor summary |
| `docs/PRODUCTION_READINESS.md` | Version/schema/test totals, V1.3.1 gate rows, new blockers |
| `docs/MANAGER_WORKFLOW.md` | Project create/edit (visibility, summary, owner default, manual publication) and task edit semantics; automatic import in the request queue |
| `docs/REQUEST_INBOX_DEPLOYMENT.md` | Explicit `REQUEST_SUBMISSION_ENABLED=true`, import-on-open, lock/idempotency |
| `docs/DEADLINE_REQUEST_WORKFLOW.md` | Automatic import step and the explicit submission flag |
| `docs/dashboard/DEPLOYMENT.md` | Submission flag default and verification call |
| `docs/dashboard/SMOKE_TEST.md` | V1.3.1 smoke items E1–E11 |
| `docs/UI_LOCALIZATION.md` | Edit forms and the typed-value preservation on a language switch |
| `docs/PRE_TRIAL_CHECKLIST.md` | **New** — 27 steps |
| `docs/checkgates/V1_3_1_GATE_1..7.md` | **New** — this release's gate records |
| `CHANGELOG.md` | V1.3.1 entry |
| `package.json` / `package-lock.json` | Version `1.3.1` |

## Coverage of the required topics

| # | Topic | Where |
| --- | --- | --- |
| 1 | Workspace prerequisites | PRE_TRIAL_CHECKLIST §1 |
| 2 | Required Drive folders | §2 |
| 3 | The three development spreadsheets | §3 |
| 4 | The two Apps Script projects | §4 |
| 5 | Spreadsheet IDs | §5 |
| 6 | Script IDs | §6 |
| 7 | Local clasp configuration | §7 |
| 8 | Script Properties per project | §8 |
| 9 | First database initialization (and the upgrade path) | §9 |
| 10 | First ADMIN bootstrap | §10 |
| 11 | Register an employee | §11 |
| 12 | Create a project | §12 |
| 13 | Mark it INTERNAL | §13 |
| 14 | Create and assign a task | §14 |
| 15 | Publish the first snapshot | §15 |
| 16 | Deploy the dashboard web app | §16 |
| 17 | Initialize the request inbox | §17 |
| 18 | Enable request submissions safely | §18 |
| 19 | Submit an extension request | §19 |
| 20 | Import / review / approve | §20 |
| 21 | Verify the changed deadline | §21 |
| 22 | Test completion reports | §22 |
| 23 | Japanese/English switching | §23 |
| 24 | Keep e-mail disabled | §24 |
| 25 | Verify Drive permissions | §25 |
| 26 | Create and verify a backup | §26 |
| 27 | Stop the trial safely | §27 |

## Accuracy checks

| Check | Result | Evidence |
| --- | --- | --- |
| Every function named in the checklist exists | PASS | Cross-checked against `^function ` in `src/*.gs` and `dashboard-app/*.gs` (`initializeNewDatabase`, `upgradeExistingDatabase`, `bootstrapFirstAdministrator`, `createDatabaseBackup`, `initializeSharedDashboardSnapshot`, `publishSharedDashboard`, `previewSharedDashboardPublication`, `sharedDashboardPublicationStatus`, `saveSharedDashboardSettings`, `initializeRequestInbox`, `importRequestInbox`, `requestSubmissionConfig`, `requestSubmissionStatus`) |
| Every Script Property named exists | PASS | `src/Config.gs`, `src/Requests.gs`, `src/SharedDashboardPublisher.gs`, `dashboard-app/App.gs`, `dashboard-app/RequestService.gs` |
| Confirmation strings match the code | PASS | `INITIALIZE <id>`, `BOOTSTRAP ADMIN <email>`, `INITIALIZE SHARED DASHBOARD <id>`, `INITIALIZE REQUEST INBOX`, `ENABLE SHARED DASHBOARD PUBLICATION` |
| New installation vs upgrade is distinguished | PASS | §9 states both paths and which property enables the upgrade |
| Outdated release-status references corrected | PASS | README/README_JP status tables; PRODUCTION_READINESS identity section |
| Production readiness is not claimed | PASS | Checklist and readiness document stay **NOT APPROVED FOR PRODUCTION** |
| No invented wrapper function without a definition | PASS | The only editor snippets are calls to real functions with their arguments |

## Notes and limits

Documentation accuracy is verified by reading the source and by the automated checks above.
No installation step was executed; see
[V1_3_1_GATE_7.md](V1_3_1_GATE_7.md) for the live-verification status.

## Installation review corrections (same release)

A focused review of the installation documentation found and corrected seven issues. No
application code, schema or Script Property name changed.

| # | Correction | Where |
| --- | --- | --- |
| 1 | Two clasp targets with explicit `rootDir` (`src`, `dashboard-app`), target selection through `.clasp.json`, `npx clasp status`, `"rootDir": "."` prohibited, never both apps in one project | `PRE_TRIAL_CHECKLIST.md` §7, `DEPLOYMENT.md` §2/§8.2, `docs/dashboard/DEPLOYMENT.md` §2 |
| 2 | The editor Run button cannot pass arguments: `initializeDevelopmentFromEditor()` documented, with the `INITIALIZATION_SPREADSHEET_ID` match rule, the version-5 outcome, wrapper deletion and the never-rerun rule | checklist §9, `DEPLOYMENT.md` §4/§8.5 |
| 3 | The first operator member is created through `Members.create` (`createFirstOperatorFromEditor()`), the generated `Member_ID` is verified, then `bootstrapFromEditor()`; allowlist removed and wrappers deleted afterwards | checklist §10, `DEPLOYMENT.md` §4/§8.6 |
| 4 | `SHARED_DASHBOARD_REQUIRE_EMAIL` documented as optional with the employee-lockout risk; deployment ACL is primary; "Anyone" never recommended | checklist §8/§16, `docs/dashboard/ACCESS_AND_SHARING.md`, `docs/dashboard/DEPLOYMENT.md` §4/§10 |
| 5 | No-argument wrappers for the snapshot and inbox initialization; three different spreadsheets restated; properties, first publication, web-app deployment, `REQUEST_SUBMISSION_ENABLED=true` and the submission/approval test documented | checklist §15–§22, `docs/REQUEST_INBOX_DEPLOYMENT.md` §3, `docs/dashboard/DEPLOYMENT.md` §1 |
| 6 | `BACKUP_LOG` success is `Result = VERIFIED` (`Backup.createVerified`), `FAILED` on error, with the copy-verification steps | checklist §26, `DEPLOYMENT.md` §8.8 |
| 7 | One primary guide with the new-installation / existing-database / production distinction, cross-referenced from `DEPLOYMENT.md` and both READMEs | checklist header, `DEPLOYMENT.md` header, `README.md`, `README_JP.md` |

Verification for this correction round:

* Every function referenced by the installation documents exists as a global in `src/*.gs` or
  `dashboard-app/*.gs`, or is defined as a wrapper inside the same document (checked
  mechanically).
* Every documented Script Property name is read by the code (`Config.get`/`Config.require`/
  `getProperty`) and every documented `AUTOMATION_SETTINGS` key exists in
  `AutomationSettings.gs`.
* `npx clasp`, `clasp push` and `clasp status` were checked against the pinned clasp 3.4.1;
  the `--project` option exists in that version and is documented as an alternative.
* The six documented editor wrappers were **extracted verbatim from the checklist** and executed
  against the mocked Google services in installation order:
  `initializeDevelopmentFromEditor` → `5` (and `INITIALIZATION_SPREADSHEET_ID` deleted),
  `createFirstOperatorFromEditor` → `MEMBER_<uuid>` with `Role = MEMBER`,
  `bootstrapFromEditor` → role becomes `ADMIN`,
  `initializeSnapshotFromEditor` → `{initialized: true, contractVersion: '1.3'}`,
  `initializeInboxFromEditor` → `{initialized: true, fields: 15}`,
  `backupFromEditor` → `BACKUP_LOG` `Result = VERIFIED`.
  This is a mock-level execution, not Workspace evidence.
* `tests/v1_3_1-ui.test.js` now asserts the two `rootDir` values, the absence of
  `"rootDir": "."`, the wrapper names, `Result = VERIFIED`/`FAILED` and the
  `SHARED_DASHBOARD_REQUIRE_EMAIL` wording, so the recipe cannot regress silently.
* Live Workspace execution remains **UNVERIFIED**.
