# V1.7.2 GATE 1 — Administration layout and the simplified editor lifecycle

| Field | Value |
| --- | --- |
| Release line | V1.7 corrective change (release version stays `1.7.0`; V1.7 has not been deployed) |
| Scope | `src/ManagerWebClient.html`, `src/ManagerWebStyles.html`, `shared/i18n.js` (and its two generated copies), `tests/v1_7_2-admin-ui.test.js`, four pre-existing UI tests |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT_RUN** |
| Backend impact | None. No schema, migration, DTO field, authorization check, publication contract or Script Property change |

## 1. What changed

### 1.1 Editor lifecycle: open → edit → save or close

The client kept a `drafts` map that preserved unfinished forms across closing, navigation and a
language switch. That behaviour is removed:

| Before | After |
| --- | --- |
| `var drafts = new Map()` in page memory, exported on `window.ManagerWebClient` | deleted; the only editor state is the open form (`currentEditor`) |
| `openEditor` reused `drafts.get(type:id)` | a new form is always built from the latest server copy (`detail(type, id, true)`) |
| `close` = `byId('editor').close()`, form preserved | `closeEditor()` drops the state and clears `#formHost` |
| separate `discard` button, `reloadDraft` / `useLatest` panel | removed with the feature they served |
| `beforeunload` warned about dirty drafts | removed; there is nothing retained to warn about |
| deletion reason and request decision note stored in the map | kept in the panel/card that is currently open |
| automation settings draft in the map | recreated on each render from the stored settings |

A confirmed save closes the form; a second submit while saving is ignored; a refused save
(`EDIT_CONFLICT`) leaves the open form untouched and sends no retry. `navigate()` closes the
editor, so leaving a screen equals closing it.

### 1.2 Publication page

`structured()` (a recursive key/value dump) is gone. `共有ダッシュボード公開` now renders cards:
state, last successful publication, automatic publication, published counts, snapshot contract and
the last error; publishing stays `act('publication', {}, true)`.

The four versions are separated on purpose:

| Value | Source |
| --- | --- |
| Database schema version | `Schema.version` through the manager `status` read |
| Application version | `ManagerWeb.read('status').version` |
| Publisher version | `SharedDashboardPublisher.status().publisherVersion` |
| Published snapshot contract | `status().snapshot.contractVersion` |
| Publisher supported contract | `status().contractVersion` |

`contractCompare()` compares component by component, so `1.10` is newer than `1.6`. A publisher
newer than the snapshot shows the informational `更新あり` banner; a snapshot newer than the
publisher shows a warning. Neither is an error. Technical metadata (slot, age, last result, interval,
destination configured) sits in a `<details>` block.

The page is a live read: `fetchPublication()` pairs `publication` with `status`, is never served from
the snapshot cache, and a superseded response never paints another screen.

### 1.3 System status and automation

`システム状態` groups database/environment, application, operational status, integrations and
errors/warnings; record counts and raw flags sit behind details; a failing consistency check, an
unreadable environment and an active emergency stop stay visible.

`自動化` keeps the exact same editable key set, payload and ADMIN/settings-revision checks, but
groups them under `メール通知`, `申請の同期`, `定期処理・レポート`, `緊急停止` and
`スナップショット公開` (the last one is read-only and points at the existing sidebar approval
procedure). Booleans carry a text badge, so state is never colour-only.

### 1.4 Hierarchy controls
`親サブプロジェクト / Parent subproject` and `親タスク / Parent task` became searchable selectors
(`searchSelect`): a search box, a `<select>` of names and an echo of the selected record with its
ancestor path. The edited record and its descendants are excluded from the choices, a task parent is
limited to the same project and subproject, and an existing parent that is not offered is kept as an
explicit choice instead of being replaced by a blank. The client still sends the stable ID and the
server keeps validating depth, cycles, archived branches and container conversion.

### 1.5 Two defects found while verifying the layout in a browser

Both were fixed because they made the requested responsive, readable result impossible:

1. `@media(max-width:1100px){.layout{grid-template-columns:200px minmax(0,1fr)}}` came **after** the
   `max-width:900px` rule that stacks the page, so at every width below 900 px both matched and the
   later one won: the navigation stayed a 200 px side column and squeezed the content to ~175 px.
   The rule is now bounded to `@media(min-width:901px) and (max-width:1100px)`, and the mobile
   navigation buttons wrap (`flex:1 1 96px`) instead of shrinking to a few pixels each.
   Verified in the local preview at 1280 px (2–3 cards per row) and at a narrow viewport (one
   column, stacked navigation, `scrollWidth === clientWidth`, no horizontal overflow).
2. The V1.7 task filter rendered two raw keys because their labels were never added:
   `web.assigneeId` (`担当者` / `Assignee`) and `web.treeScope` (`階層` / `Hierarchy`). Both are now
   in the canonical dictionary.

## 2. Requirements → evidence

| Requirement | Test | Result |
| --- | --- | --- |
| Open, change, close, reopen → the stored value appears | `closing an editor discards the change and reopening loads the stored record` | PASS |
| Open, save, reopen → the new value appears | `a confirmed save closes the form and reopening shows the new value` | PASS |
| A new-record form closed without saving reopens empty | `closing a new-record form discards it and reopening starts empty` | PASS |
| Navigate away → the unsaved change is discarded | `navigating away from an unfinished editor has the same result as closing` | PASS |
| A deletion panel close discards the reason | `closing the deletion panel discards the reason and reopening starts empty` | PASS |
| Request decision notes are not retained | `an unsent request decision note is not retained after leaving the page` | PASS |
| No duplicate write after closing | `one save is one write and a second submit after closing sends nothing`, `a refused save keeps the open form and sends no second write` | PASS |
| Publication status rendering (cards, counts, versions) | `the publication page shows status cards, counts and every distinct version` | PASS |
| Publisher/snapshot version mismatch is informational | `a newer publisher contract than the published snapshot is an informational update` | PASS |
| Error and disabled states | `an unconfigured destination and a broken snapshot are shown as states, never as raw data` | PASS |
| System status rendering | `the system status page groups database, application, health and integration facts` | PASS |
| Grouped automation and unchanged save path | `the automation page groups the settings and keeps the save path intact` | PASS |
| Subproject parent selection by name, self excluded | `a subproject parent is chosen by name and the record can never be its own parent`, `the parent selector filters by name and never asks for an internal ID` | PASS |
| Task parent limited to project/subproject, self excluded | `a task parent is limited to the same project and subproject without the task itself` | PASS |
| Japanese/English labels | `the administration pages follow the language switch` | PASS |
| Responsive layout and touch targets | `the administration layout is responsive and keeps touch-sized controls` | PASS |
| Approvals, request receipts and audit rows intact | `the editor lifecycle leaves approvals, request records and audit rows intact` | PASS — the approval stamp survives an unrelated edit, `TASK_REQUESTS` count is unchanged, `AUDIT_LOG` grows by the save |

The four pre-existing tests that encoded the old draft behaviour were rewritten, not removed:

| Test file | Old expectation | New expectation |
| --- | --- | --- |
| `tests/v1_5-web-ui.test.js` | a draft survived closing, navigation and a language switch | a close discards it and reopening shows the stored record; one save is one write; only `eh.lang` is persisted |
| `tests/v1_5-web-ui.test.js` | "conflicting saves retain draft" | a conflicting save keeps the open form and shows `EDIT_CONFLICT`; the form is not discarded |
| `tests/v1_5_1-performance.test.js` | `drafts.size === 1` after a refused save | the open form still exists |
| `tests/v1_5_1-performance.test.js` | `drafts.size === 0` after revocation | the editor is `null` and the dialog is closed |
| `tests/v1_6_2-color-picker.test.js` | closing kept the unsaved colour, discarding restored it | closing writes nothing and reopening already shows the stored colour |

## 3. Suite results

| Command | Result |
| --- | --- |
| `npm run lint` | PASS — 0 findings |
| `npm test` | PASS — **622 tests, 622 pass, 0 fail, 0 skipped** (603 before, +19) |
| `npm run validate` | PASS — 40 manager Apps Script files, 3 dashboard files, both manifests, **956 translation keys** |
| `node scripts/manager-web-benchmark.js` (`BENCHMARK_OUTPUT=V1_7_2_PERFORMANCE.json`) | PASS — see [V1_7_2_PERFORMANCE.json](V1_7_2_PERFORMANCE.json) |

`npm ci` was not re-run: no dependency was added, removed or upgraded and the lockfile is unchanged.

## 4. Performance (local mock)

| Projects / Tasks | bootstrap p50 | task index p50 | bootstrap payload | first detail open | cached navigation p50 |
| --- | --- | --- | --- | --- | --- |
| 10 / 100 | 5.62 ms | 2.45 ms | 11,318 B | 1.27 ms | 0.84 ms |
| 100 / 1,000 | 47.84 ms | 19.06 ms | 58,078 B | 5.23 ms | 1.53 ms |
| 300 / 3,000 | 139.64 ms | 64.07 ms | 153,491 B | 12.63 ms | 1.17 ms |

The editor now issues one fresh record read when a screen opens a form without an already
authorized copy (the task editor, for example), and reuses the record the current authorized
snapshot just returned when one is passed. The benchmark's `firstDetailOpenMs` / `cachedDetailOpenMs`
measure the project *page* (`navigate('project')`), which this release does not change; cached
navigation and local filtering are likewise unchanged. Real Workspace latency is not measured here.

## 5. Deliberate non-changes

- No change to `ManagerWeb.gs`, `ManagerWebApi.gs`, `Ui.gs`, `AutomationSettings.gs`,
  `SharedDashboardPublisher.gs` or any domain service. Publication, automation and status are read
  through the existing authorized operations only.
- No schema, migration, publication contract, Script Property or clasp target change.
- No new browser persistence. The interface language remains the only `localStorage` entry.
- No live deployment, trigger, mail or publication activation was performed.

## 6. Outstanding (BLOCKED / NOT_RUN)

- Real Google Workspace rendering of the new cards, badges and searchable selectors. The layout was
  inspected in the **local synthetic preview** at 1280 px and at a narrow viewport (both with
  `scrollWidth === clientWidth`), which is not Workspace evidence. **NOT_RUN** on Workspace.
- A real publication run observed through the page (live destination, A/B commit, error banner).
  **NOT_RUN.**
- Screen-reader review of the new `details` blocks and selector echoes. **NOT_RUN.**
- `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.
