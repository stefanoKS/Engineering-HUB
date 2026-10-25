# V1.3.1 Gate 7 — Final automated verification

Run from the repository root on 2026-10-26 (Windows 11, Node.js v24.21.0, npm 11).

## Result

Result: **PASS** (local) — Google Workspace verification: **UNVERIFIED**

```text
npm ci            -> added 364 packages, audited 365, 0 vulnerabilities
npm run lint      -> clean (eslint 10.13.0, no output)
npm test          -> tests 256 / pass 256 / fail 0 / duration 3513.6 ms
npm run validate  -> Validated 32 manager Apps Script files, 3 dashboard files,
                     both manifests and 452 translation keys
npm run preview:dashboard -> 7 projects, 7 details, 13 tasks, stale=false,
                     publishedAt 2026/10/26 07:35
```

Test totals: **256 tests, 256 pass, 0 fail, 0 skipped**. No test was deleted, skipped or
weakened for this release.

## Regression coverage added for V1.3.1

`tests/v1_3_1-stabilization.test.js` (24 tests)

| Area | Test |
| --- | --- |
| Project visibility selection | "a new project stays hidden until a manager publishes it deliberately" |
| Child visibility | "subprojects and tasks disappear with their project" |
| Snapshot field allowlisting | "the dashboard summary is published while private text never leaves the workbook" |
| Manager ownership default | "a manager owns a new project by default and can then edit it" |
| Unauthorized visibility edits | "a manager cannot edit a project owned by somebody else", "a member cannot create or publish a project" |
| Project edit | "a project edit patches only the supplied fields and keeps the identity" |
| Invalid input | "an invalid visibility or an empty patch is refused" |
| Committed deadline | "a committed deadline change needs an explicit confirmation" |
| Project status guard | "project status changes stay explicit and consistent with the tasks" |
| Partial-field preservation | "a task edit preserves the fields it does not address" |
| Approval invalidation | "renaming a task invalidates the stale assignment approval but keeps the data" |
| Derived start recalculation | "editing the deadline or duration recalculates the derived planned start" |
| Cross-project move | "a task cannot be moved into a project outside the manager scope" |
| Stale edit | "a stale task edit is refused instead of overwriting newer data" |
| Task scope | "a manager cannot edit a task in a project they neither own nor are assigned to" |
| No mail from edits | "project edits send no mail and never touch another project" |
| Automatic request import | "opening the request queue imports new inbox rows and is idempotent" |
| Concurrent request import | "a concurrent import collision is counted as skipped, not as a failure" |
| Import failure | "an unavailable inbox is reported and the stored queue stays readable" |
| Manual import fallback | "the queue can be opened without an import attempt when asked" |
| Notifications remain OFF | "notification switches stay off by default and no edit path sends mail" |
| No login/password | "no login, password or browser write path was introduced" |
| OAuth scopes | "the manager manifest keeps its existing scopes only" |

`tests/v1_3_1-ui.test.js` (15 tests) executes the real `src/UiMenu.html` and
`src/UiRequests.html` client scripts against the real manager modules in a DOM mock that
throws on `innerHTML`:

| Area | Test |
| --- | --- |
| Visibility + summary + owner default | "the create form defaults to hidden and sends the chosen visibility and summary" |
| No reset before success | "a rejected save keeps every entered value and shows the error" |
| Project edit round trip | "editing a project loads its values and keeps the immutable identity" |
| Stale edit UX | "an edit refused as stale keeps the typed text and asks for a reload" |
| Unselectable owner | "editing a project without a selectable owner keeps the stored owner" |
| Task edit round trip | "editing a task preserves the fields the manager did not touch" |
| Duration → start | "changing the duration on an existing task recalculates the derived start" |
| Double submission | "a double click submits one task only" |
| Language switching | "switching language keeps typed text and translates generated labels" |
| Automatic import UI | "the request queue imports automatically and reports the import" |
| Import failure UI | "a failing inbox import never hides the requests already imported" |
| Wiring | "the sidebars reference only script functions that exist on the server", "every onclick handler … is defined", "the manager sidebar keeps a single control per action" |
| Documentation | "the trial documentation describes the visibility and edit workflow" |

Existing suites affected by the release were updated only where behaviour intentionally
changed:

* `tests/v1_3-i18n.test.js` compares generated dictionaries newline-insensitively (Windows
  CRLF checkout), matching the new `scripts/sync-i18n.js` behaviour.
* `tests/v1_3-requests.test.js` sets `REQUEST_SUBMISSION_ENABLED: 'true'`, because an absent
  property now means "closed" (Gate 4F).

## Browser rendering actually performed

`npm run preview:dashboard` produced `%TEMP%\engineering-hub-dashboard-preview.html`, which
was opened in Chromium through the integrated browser:

| Observed | Result |
| --- | --- |
| Japanese default render, title/heading `設計・開発課 管理` | PASS |
| `日本語 | English` switch translates every label immediately | PASS |
| Stored project/task names and public notes remain untranslated | PASS |
| Project card list, progress bars, KPI tiles, filter row | PASS |
| Project detail drill-down (counts, grouped task table, sorting, progress) | PASS |
| Task detail drawer (ID, project, assignee, status, dates, 残り, progress, public note, read-only notice) | PASS |
| No write control in the viewer | PASS |

Not covered by this: the **manager sidebars** were not rendered in a real browser (only in
the DOM harness), and no Google Workspace page was executed.

## Not verified (unchanged by this release)

* Live Apps Script execution of any kind: sidebar rendering inside a real spreadsheet,
  OAuth consent, property binding, trigger timing, quota behaviour.
* Real `LockService` contention during the automatic import.
* Mail delivery (mail stays OFF; nothing was sent).
* Drive ACLs, domain-restricted web app access, snapshot publication against a real file.
* Visual layout of the new manager controls (CSS/focus order).

## Production readiness

**NOT APPROVED FOR PRODUCTION.** See
[../PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md). No production resource was created,
changed or inspected; no deployment, commit or push was performed.
