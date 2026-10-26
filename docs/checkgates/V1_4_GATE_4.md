# V1.4 gate 4 — manager UI and accessibility

Status: **PASS locally for structure, colours, contrast and wiring; BLOCKED for live sidebar fit**

Scope: the 案件 / タスク / 管理 navigation, the responsibility panel, the subproject tree, menu
routing, typography, colour tokens and keyboard behaviour.

## What was checked locally

| Check | Evidence |
| --- | --- |
| Every Sheets menu entry maps to its own defined handler | `tests/v1_4-ui.test.js` → "every Sheets menu entry opens a distinct, known sidebar handler" |
| The initial section is a template value, not a global | "the requested section is passed as a template value, not a mutable global" |
| Three top-level sections only, each with its own panel | same test (`tab-project`/`tab-task`/`tab-admin`, `view-*`) |
| Rarely used fields live in collapsed `詳細設定` panels and keep their IDs | "the sidebar keeps collapsed detail sections so stored values survive an edit" |
| The project form offers 未分類 + active areas and preselects the stored one | "the sidebar form sends only the responsibility the manager selected" |
| Saving without a change creates no transfer; clearing it does | same test |
| Nested subprojects can be created, archived, reactivated and tasks moved through the bridges | "nested subprojects are created, archived and moved through the sidebar bridges" |
| The context exposes `level` and `parentId` for the tree | "the sidebar context exposes the nested level and parent of every subproject" |
| The approval queue leads with type, project, task, dates, difference, reason and requester; IDs are secondary | "the request queue leads with the type, the dates and the difference" |
| No template builds markup from data | `tests/gate-a-security.test.js` → "no sidebar template builds markup from data" |
| Hostile spreadsheet text stays text | "stored spreadsheet text is rendered as text, never as markup" |
| Element ids stay unique and the single-control-per-action rule holds | `tests/v1_3_1-ui.test.js` → "the manager sidebar keeps a single control per action" |
| Every referenced translation key exists in both languages | `npm run validate` (529 keys, ja/en parity) |

## Colour and typography

The manager sidebars and the dashboard now share one token set
(see [docs/UI_UX_GUIDELINES.md](../UI_UX_GUIDELINES.md)). Contrast was measured in a real browser
(Chromium via the VS Code browser tools) against the rendered dashboard:

```text
--text on --surface         12.89:1
--text-soft on --surface     6.36:1
--text-soft on --surface-soft 6.07:1
white on --accent            5.6:1
```

Secondary text was raised to a 12–12.5px minimum. `prefers-reduced-motion` disables transitions.
Colour is never the only indicator: mode, emergency stop, status, deadline and retirement all
carry a text label.

## Not verified here (BLOCKED)

- The real Google Sheets sidebar width and scroll behaviour at 300px. The templates are designed
  for that width, but only a bound deployment can confirm it.
- Whether `setWidth(460)` is honoured for this container (it is not expected to be).
- Screen-reader behaviour in the Workspace sandbox, and 200% browser zoom inside the sidebar.
- Keyboard-only traversal of the real sidebar iframe.

These items must be recorded with live evidence before this gate can be raised above BLOCKED for
deployment purposes. Local results do not substitute for that evidence.
