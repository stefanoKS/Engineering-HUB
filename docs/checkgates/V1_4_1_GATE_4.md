# V1.4.1 gate 4 — manager UI, accessibility and task scale

Status: **PASS (local browser preview only)** — the real Sheets sidebar remains UNVERIFIED.

Scope: `src/UiMenu.html`, `src/Ui.gs`, `shared/i18n.js` and the task selector.

## Visual checks performed

Environment: Chromium (Playwright) against a static preview assembled from the real
`UiMenu.html` template plus the real `Ui.context()` payload for a fictional department
(2 projects, 3 subprojects including one archived and one nested, 14 tasks, 2 responsibilities
including one 廃止). Nothing was run inside Google Sheets.

| Check | Result |
| --- | --- |
| 300px sidebar — 案件 section | No page-level horizontal scroll (`scrollWidth 285` = `clientWidth 285`); only the `<select>` popup content is wider, which is native behaviour |
| 300px sidebar — タスク section | No horizontal scroll |
| 300px sidebar — 管理 section | No horizontal scroll; 廃止 badge, 廃止にする and 再有効化 render |
| 200% text zoom (font sizes doubled) | No horizontal scroll after `.tabs` was allowed to wrap (`min-width: 0`, `flex-wrap: wrap`, `overflow-wrap: anywhere`). Before the fix the tab strip overflowed by 19px |
| English UI at 300px | No horizontal scroll; long translations fit |
| Long Japanese project name | `新型検査装置の設計・製作（量産立ち上げ対応）` renders without clipping |
| Task search flow | Typing 「詳細設計タスク 11」 narrows the picker to that task, selecting it loads it (`taskName` filled, 現在の進捗 shown), clearing the search restores the full list and keeps the selection |
| Archived subproject as a task destination | Not offered in サブプロジェクト; a task already in one keeps its value, labelled アーカイブ済み |
| Palette | Tokens unchanged (`#F4F6F8`, `#FFFFFF`, `#27333E`, `#526170`, `#365F7D`, `#D7DEE5`, `#287348`, `#8C5A15`, `#A83E3A`) |

## Task scale

| Check | Evidence |
| --- | --- |
| 10 tasks | `tests/v1_4-ui.test.js` sidebar bridges |
| 300 tasks | window equals the visible set, `tasksTruncated` false |
| More than 300 tasks (320) | `tests/v1_4_1-stabilization.test.js` → "a task outside the sidebar window stays reachable by searching": `taskTotal 320`, 300 items loaded, the hint reports 320, and task `TB-319` is selectable and loadable through `uiTaskOptions` |
| Selected task identity survives a re-render / language switch | `allTaskItems()` merges the search result with the context window and `captureForms`/`applyForms` keep the picker value |

Read cost: one `Database.read('TASKS')` per `Ui.context` call, unchanged; the search endpoint adds
one read per query, debounced at 250 ms.

## Not verified here

The Sheets sidebar sandbox (real 300px iframe), keyboard traversal inside Sheets, and screen
reader output. Verify in a development deployment.
