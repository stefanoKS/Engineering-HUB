# Shared dashboard visual specification (V1.2)

## 1. Design intent

A calm internal business dashboard for employees who do not use Sheets, GitHub or
Apps Script. One page, one accent colour, generous whitespace, no decorative charts and no
grids that look like a spreadsheet.

| Principle | Implementation |
| --- | --- |
| Japanese first | All visible copy is Japanese; `lang="ja"` on the document. |
| One accent | `--accent: #2f5bd7` used for progress, links and focus. Risk colours are reserved for genuine risk. |
| Neutral surfaces | `--bg: #f6f7f9`, `--surface: #ffffff`, dividers `--border: #e5e7eb`. |
| Readable type | 15 px base, 1.6 line-height, system Japanese stack (`Hiragino Sans`, `Yu Gothic UI`, `Meiryo`). |
| Touch targets | `--tap: 44px` minimum height on every interactive control. |
| Motion | Short transitions only; `prefers-reduced-motion` disables shimmer and transitions. |

## 2. Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ HUB  Engineering HUB — 案件進捗              最終同期: …      │  header (white, 1px divider)
├──────────────────────────────────────────────────────────────┤
│ stale / information notices (only when relevant)             │
│ ┌────────┬────────┬────────┬────────┐                        │  4 indicators (2 on mobile)
│ │進行中   │要注意   │7日以内  │期限超過 │                        │
│ └────────┴────────┴────────┴────────┘                        │
│ [ search ……………………………… ] [状態][カテゴリ][責任者][リスク][期限7日以内] │
│ 6 件を表示（全 7 件）                              条件をクリア  │
│ ┌─────────┬─────────┬─────────┐                              │  project cards
│ │ project │ project │ project │                              │  1 / 2 / 3 columns
│ └─────────┴─────────┴─────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

Project detail replaces the portfolio (no separate app, no new tab):

```text
← 案件一覧へ戻る
┌ project title + public summary + 8 facts ────────────────┐
│ 責任者 / 状態 / 進捗 / 健全性 / 確定期限 / 予測完了 / 残り / 最終更新 │
└──────────────────────────────────────────────────────────┘
タスク 5 · 未完了 5 · 期限超過 1 · ブロック 1 · 完了 0
▾ 光学系設計  担当 … · 進行中 · 進捗 70% · 期限 … · 1 件
   [ task table ]
▾ 搬送系設計 …
▾ 全体タスク  サブプロジェクト未割当 · 2 件
マイルストーン
```

## 3. Components

| Component | Rules |
| --- | --- |
| Project card | Whole card is a `<button>`; title, category · status, health pill, progress bar with %, owner, committed deadline, forecast, last update, and one counts line. `is-risk` adds a red left border, `is-caution` amber. |
| Health pill | 順調 green, 注意 amber, 危険 red, 日程不明/その他 grey. Never used for anything that is not health. |
| Progress bar | 8 px rounded track, accent fill, `role="progressbar"` with `aria-valuenow`; `—` when progress is unknown. |
| Task table | タスク / 担当 / 状態 / 優先度 / 期限 / 残り / 進捗. Header cells with sortable columns render a `<button>` with the current direction (▲/▼). |
| Deadline emphasis | `1日超過` red + bold, `本日期限` and `あとn日` (≤7) amber, `完了` and `期限未設定` neutral. |
| Task drawer | Right-hand modal (`role="dialog"`, `aria-modal`), backdrop, close button focused on open, Escape closes, focus returns to the task row. Read-only badge, no mutation controls. |
| Empty state | Dashed card with an intentional message; distinguishes "nothing published" from "filters hid everything". |
| Loading state | Three shimmer cards; `aria-hidden` so assistive technology skips placeholders. |
| Error state | Solid red-tinted card, human sentence, 再試行 button; the page never shows a stack trace. |
| Stale banner | Amber notice with the last sync time and age in hours. |

## 4. Breakpoints

| Width | Behaviour |
| --- | --- |
| ≥ 1140 px | 3 project columns, 4 indicators, 4 fact columns, table tasks. |
| 720–1139 px | 2 project columns, 4 indicators, table tasks. |
| 641–719 px | 1 project column, 2 indicators, table tasks. |
| ≤ 640 px | 2 indicator columns, full-width search, 2-up filter selects, 1 project column; task table becomes stacked card rows with a visible label per cell; drawer takes the full width. |

Minimum supported width: **375 px**.

## 5. Accessibility

- Landmarks: `banner`, `main`, headings; a skip link to `#main`.
- Every control is a native `<button>`, `<a>`, `<select>` or `<input>`; no click-only `div`.
- Labelled search input (visually hidden label), labelled selects, `aria-pressed` on the
  due-soon chip, `aria-label` on cards and task buttons.
- `aria-live="polite"` on the result count, notices and toast.
- Escape closes the drawer, then the detail view; focus is restored to the trigger.
- Focus is always visible (`:focus-visible` 3 px accent outline).
- Table semantics are kept on mobile (`<table>`, `<thead>`, `<th scope="col">`); only the
  CSS display changes, and each cell carries a label for the stacked layout.
- Colour is never the only signal: labels accompany every pill and deadline state.

## 6. Browser safety

Stored text is inserted with `textContent` or by creating elements. No markup string is
ever assigned. `npm run validate` rejects the forbidden DOM APIs in `dashboard-app/*.html`,
and `tests/v1_2-dashboard.test.js` renders a project named
`<img src=x onerror="alert(1)">` and asserts that no element is created from it.

## 7. Screenshots actually captured

Captured in a real Chromium session against the local preview
(`node scripts/dashboard-preview.js`, then open the generated file). The browser viewport
was emulated; the page under test is the real `dashboard-app/Index.html` with the real
Styles/Client partials and the real viewer service output.

| # | Viewport | State | What the capture verified |
| --- | --- | --- | --- |
| 1 | 1360 × 1120 | Portfolio | 3-column card grid, 4 indicators, sort (risk → deadline → name), health pills, progress bars, counts line |
| 2 | 1360 × 1120 | Project detail | Summary, 4×2 facts, task counts, three collapsible groups (光学系設計 / 搬送系設計 / 全体タスク), sortable table, milestones |
| 3 | 1360 × 1120 | Task drawer | Backdrop, focused close button, 10 facts, public note, progress bar, read-only note |
| 4 | 819 × 1000 | Project detail | Tablet layout keeps the table, still readable |
| 5 | 375 × 900 | Portfolio | 2-up indicators, stacked search/filters, single-column cards |
| 6 | 360 × 900 | Project detail | Table collapsed to labelled card rows |

PNG files are **not committed** to this repository. Reproduce them with:

```powershell
node scripts/dashboard-preview.js --out $env:TEMP\eh-dashboard-preview.html
Start-Process $env:TEMP\eh-dashboard-preview.html
```

These captures prove rendering and layout, not Google Workspace behaviour. Live verification
remains [UNVERIFIED](SMOKE_TEST.md).

## V1.3 additions

* Header: the official name `設計・開発課 管理` with the subtitle `案件進捗ダッシュボード`, and a
  `日本語 | English` switch on the right of the sync label. The switch keeps its position and
  never moves the rest of the layout.
* Task rows and the task drawer show a compact `納期変更申請中` badge when a request is
  pending. The deadline itself is unchanged.
* Task drawer actions: `納期変更を申請` (primary) and `完了報告`, followed by the read-only facts,
  the public note and the request status lookup.
* Request forms are inline panels with a read-only context block (project, task, current
  assignee, current deadline), the editable fields, an explicit self-reported-name note and
  a green receipt block containing the request ID and state.
* English labels are longer: keep the drawer scrollable and never truncate stored values.
* Screenshots produced by `npm run preview:dashboard` are local review artefacts, not Google
  Workspace behaviour, and stay **UNVERIFIED** until recorded.

