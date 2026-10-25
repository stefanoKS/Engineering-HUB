# V1.3 Gate 1 — Application branding and Japanese/English UI

Scope: the official application name **設計・開発課 管理**, the visible language switch and
the translation architecture.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| Dashboard browser title and heading use the official name | PASS | `dashboard-app/App.gs` `DashboardApp.TITLE`; `dashboard-app/Index.html`; asserted by `tests/v1_3-i18n.test.js` and `scripts/validate-source.js` |
| Manager sidebar, request queue, automation settings and system status use the official name | PASS | `src/Ui.gs` `Ui.MENU`, `src/Ui*.html`; `Ui.MENU` is the Sheets menu name |
| Obsolete "Engineering HUB" brand removed from user-visible templates | PASS | `scripts/validate-source.js` rejects the string in `src/*.html` and `dashboard-app/*.html` |
| No internal identifier renamed | PASS | Repository name, module names, worksheet names, Script Properties, function names and migration history are unchanged; `tests/v1_3-release.test.js` |
| Translation dictionary exists in both languages with identical keys | PASS | `shared/i18n.js`; `npm run validate` compares `ja` and `en` key sets; `tests/v1_3-i18n.test.js` |
| Generated dictionary copies match the source | PASS | `node scripts/sync-i18n.js --check` |
| Default language is Japanese | PASS | `EH_I18N.DEFAULT_LANGUAGE === 'ja'`; `tests/v1_3-i18n.test.js` |
| Language switch present on dashboard, project detail, task detail, request forms, manager sidebar, approval queue, automation settings and system status | PASS | `data-lang` buttons in `dashboard-app/Index.html`, `src/UiLang.html` (included by every sidebar) |
| No database schema change for branding | PASS | Migration `005` adds planning and request columns only |
| Existing tests still pass | PASS | `npm test` |

## Evidence

* `npm run lint` — clean.
* `npm test` — all suites pass, including the new `tests/v1_3-*.test.js` files.
* `npm run validate` — validates both manifests, the generated dictionaries and every
  translation key referenced by a template.

## Notes and limits

The brand change is a display change only. Nothing in the workbook, the deployment, the
GitHub repository or the Script Properties is renamed, so an existing deployment keeps
working without re-initialisation or re-migration.

Live verification (menu refresh in a real spreadsheet, browser tab title) must be recorded
separately by an operator; local results are not Workspace evidence.
