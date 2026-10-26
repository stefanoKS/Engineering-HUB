# UI/UX guidelines

The visual language of `設計・開発課 管理` and the shared dashboard. These rules are for both
applications; they describe what is implemented, not an aspiration.

Priority order when rules conflict:

DATA INTEGRITY > CORRECT FUNCTIONALITY > SECURITY > USABILITY > READABILITY > VISUAL APPEARANCE

## 1. Design tokens

Both applications define the same tokens. The manager sidebars declare them in each template's
`:root`; the dashboard declares them in `dashboard-app/Styles.html`.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#F4F6F8` | Page background |
| `--surface` | `#FFFFFF` | Cards, sidebars, inputs |
| `--surface-soft` | `#F8FAFB` | Secondary panels, list rows |
| `--text` | `#27333E` | Primary text |
| `--text-soft` / `--muted` | `#526170` | Secondary text and hints |
| `--accent` | `#365F7D` | Navigation, selected controls, primary actions |
| `--accent-hover` | `#294D68` | Hover for primary actions |
| `--accent-soft` | `#EAF1F6` | Selected row, plan preview, information |
| `--border` | `#D7DEE5` | Separators and input borders |
| `--green` / `--green-soft` | `#287348` / `#EAF4ED` | Completed / success |
| `--amber` / `--amber-soft` | `#8C5A15` / `#FBF3E6` | Caution, approaching deadlines, stale |
| `--red` / `--red-soft` | `#A83E3A` / `#F9ECEB` | Overdue, errors, destructive actions |

Colour meaning is fixed: blue = navigation and primary action, green = done, amber = caution,
red = overdue/error/destructive, gray = inactive or secondary. Colour is never the only signal —
every state also has a text label («進行中», «2日超過», «承認待ち», «廃止»).

## 2. Contrast

Measured in a real browser against the rendered pages (WCAG AA targets: 4.5:1 normal text,
3:1 large text and essential non-text indicators):

| Pair | Ratio |
| --- | --- |
| `--text` on `--surface` | 12.89:1 |
| `--text-soft` on `--surface` | 6.36:1 |
| `--text-soft` on `--surface-soft` | 6.07:1 |
| `--accent` on `--surface` (buttons and links) | 5.6:1 |
| White on `--accent` | 5.6:1 |
| `--green` on `--green-soft` | 4.9:1 |
| `--amber` on `--amber-soft` | 4.7:1 |
| `--red` on `--red-soft` | 5.3:1 |

`--border` is a decorative separator (1.3:1) and is never the only indicator of a state; focus
rings use `--accent` at 2px with a 2px offset.

## 3. Typography

Japanese-first font stack in both applications:

```text
"Hiragino Sans", "Yu Gothic UI", "Yu Gothic", "Meiryo", system-ui, sans-serif
```

| Context | Size |
| --- | --- |
| Dashboard base text | 15px |
| Dashboard project title | 16–18px |
| Dashboard section heading | 18–20px |
| Dashboard KPI number | 24–28px |
| Dashboard secondary text | 12.5px minimum |
| Manager sidebar base text | 13px |
| Manager input text | 14px |
| Manager form label | 13px |
| Manager section heading | 14–15px |
| Manager hint | 12px minimum |

Line height is 1.45–1.65. Bold is reserved for titles, KPI values and active states.

## 4. Spacing and targets

Spacing follows 4 / 8 / 12 / 16 / 24 px: 4 within a control group, 8 between small elements,
12 between fields, 16 between sections, 24 between major blocks. Buttons and select controls are
at least 38–44px tall so the 300px manager sidebar stays comfortable with a mouse or a touch
screen.

## 5. Google Sheets sidebar reality

The bound sidebar is roughly **300px** wide. `setWidth(460)` does not widen it. Every manager
template is therefore designed for 300px:

- one top-level section visible at a time: 案件 / タスク / 管理;
- rarely used fields live inside a collapsed `詳細設定` panel, which keeps its stored values when
  left closed;
- the subproject hierarchy is a compact tree with `level`-based indentation, not drag and drop;
- no horizontal scrolling, no wide tables, no nested menus deeper than one level.

`Ui.show(fileName, {view, action})` passes the initial section as a template value
(`initialView` / `initialAction`), never as a mutable global, so two managers opening different
menu entries cannot interfere with each other.

## 6. Navigation (manager)

| Menu entry | Section | Landing control |
| --- | --- | --- |
| ダッシュボード | 案件 | project picker |
| 新規プロジェクト | 案件 | project name |
| 担当領域の管理 | 管理 | responsibility list |
| 新規サブプロジェクト | 案件 | subproject name |
| 新規タスク / タスク割当 | タスク | task name |
| 進捗更新 | タスク | progress value |
| 課題 | タスク | task picker |
| マイルストーン | 案件 | project picker |
| メンバー / スキル | 管理 | member / skill panel |
| 自動化設定 | separate sidebar | — |
| 申請一覧 | separate sidebar | — |
| システム状態 | separate sidebar | — |

## 7. Dashboard structure

Header → KPIs → filters → project cards → project detail → task drawer. Always visible filters:
search, status, responsibility, 期限7日以内. Secondary filters (category, owner, risk) live under
`詳細フィルター`. Active filters are shown as tags so a filtered list is never mistaken for the
whole portfolio.

Cards prioritise project name, responsibility, owner, committed deadline, progress and health.
Forecast dates, last update and detailed counts stay available in the detail view. The layout is
1 column on mobile, 1–2 on tablet, 2 on desktop and 3 only when there is enough width.

## 8. Accessibility

- Every control has a visible focus ring; the drawer traps focus and Escape closes it, restoring
  the previous focus.
- Tabs use `role="tab"` / `aria-selected` / `aria-controls`; live regions (`aria-live`) announce
  loading, result counts and toasts.
- Tables keep a `<caption>` (visually hidden where repeating the group title) and sortable
  headers are buttons with `aria-label`.
- Empty, loading and error states are explicit; the request form fails closed with a text
  explanation instead of a disabled-looking button.
- `prefers-reduced-motion` disables transitions and animations.
- Tested viewports: 375px, 768px, 1366px, 1920px plus 200% zoom; long Japanese and English labels
  must wrap without overlap or horizontal scrolling.

## 9. Localization

Japanese is the default; English is optional. Only interface labels are translated. Stored text
(responsibility, project, subproject, task and member names, notes, explanations) is always shown
exactly as stored. 未分類 is a label and may be translated; a user-defined responsibility name
never is. Switching 日本語 | English preserves the current screen, project, task, filters, scroll
position and any unsent request draft.
