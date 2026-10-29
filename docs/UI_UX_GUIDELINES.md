# UI/UX guidelines

## V1.7.4 visual refresh and project identity colours

A restrained, light design language for both applications. This is a visual release: no migration, no
new Script Property, no new backend read, no change to authorization, publication, notification or
request logic.

### Design tokens

Both applications declare the same tokens (`--ui-*`). The historical names (`--v16-*` in the manager
application, `--bg`/`--surface`/`--text`/`--accent` in the dashboard) stay in place and resolve to the
shared values, so no legacy selector had to be rewritten.

| Token | Value | Use |
| --- | --- | --- |
| `--ui-bg` | `#F6F8FB` | Page background |
| `--ui-surface` | `#FFFFFF` | Cards, dialog, inputs |
| `--ui-sidebar` | `#F0F4F8` | Manager navigation rail, table headers |
| `--ui-text` | `#253449` | Primary text |
| `--ui-text-muted` | `#607086` | Metadata, hints (and `--text-soft`/`--muted`) |
| `--ui-border` | `#DFE6EE` | Card and section separators |
| `--ui-primary` | `#365E80` | Primary action, active navigation, focus ring |
| `--ui-neutral-ink` | `#55657A` | Muted text on a tinted chip/pill surface (5.2:1) |
| `--ui-radius` | `10px` | Cards, panels, dialog |
| `--ui-font` | Noto Sans JP → Yu Gothic UI → Hiragino Sans → Meiryo → system-ui | Every text surface |
| `--ui-space-1…6` | 4 / 8 / 12 / 16 / 24 px | Spacing scale |

Semantic colours are unchanged and never borrowed by a project accent: `--ui-done` `#287348`,
`--ui-warn` `#8C5A15`, `--ui-danger` `#A83E3A` (with their `-soft` surfaces). Measured contrast
(AA): `--ui-text` on white 12.60:1, `--ui-text-muted` on white 5.05:1, `--ui-text-muted` on `--ui-bg`
4.75:1, `--ui-text-muted` on `--ui-sidebar` 4.57:1, `--ui-primary` on white 6.84:1, white on
`--ui-primary` 6.84:1, done 5.13:1, warning 5.31:1, danger 5.34:1 on their soft surfaces, and
`--ui-neutral-ink` 5.25:1 on the neutral chip surface (`#EEF1F4`). The control
border (`--ui-control-border` `#7B8CA0`) stays at 3.44:1 against white, above the 3:1 non-text
requirement, so a field boundary never depends on colour alone. Every project accent stays at or above
3:1 against white and `--ui-bg` (lowest: ochre-gold `#949257` at 3.23:1 / 3.03:1) and is always paired
with the project name.

### Typography

Body 16 px, line height 1.55–1.6; main heading 23–24 px; project title 18 px; subproject title
16.5–17 px; task name 15.5–16 px; metadata 13–14 px. No metadata label is smaller than 13 px, buttons,
selects and text inputs stay at least 44 px high, and the font stack is a system stack with no web-font
request.

### Project identity colours

- One shared helper (`shared/project-colors.js`, copied to `src/ProjectColors.html` and
  `dashboard-app/ProjectColors.html` by `npm run sync:colors`) derives the accent from the stable
  `Project_ID`: a two-lane multiplicative hash, then an index into a curated 16-entry muted palette.
  The same ID therefore produces the same accent in the manager application and the employee
  dashboard.
- The accent never depends on a list position, a filtered index, a sort order or a refresh. It needs no
  spreadsheet column, no migration and no extra read.
- Only palette values can be returned, and only as CSS custom properties
  (`--project-accent`, `--project-outline`, `--project-tint`). A project ID or name is never
  interpolated into a CSS colour.
- A project card carries a 5 px top strip; every subproject of the project inherits the same hue
  (a 3 px left accent, lighter for a nested level); every task card inherits the same hue as a 3 px
  left accent plus a tinted 1 px outline. Depth changes indentation and strength, never the hue.
- Reuse beyond the palette size is expected and is never presented as a globally unique identity: the
  project name is always visible, so colour is never the only way to tell two projects apart.
- These values are unrelated to `RESPONSIBILITIES.Color_Hex`. A responsibility colour is manager-chosen
  data; a project accent is a derived display value, and the two palettes share no value.

### Health, status and priority

Project identity is not project health. The employee dashboard no longer uses a red/amber left border
for health: the health pill keeps its text and semantic colour, the card border is tinted, and the
project strip stays stable. Status, priority and approval keep red = urgent/overdue, amber =
attention, green = done, neutral = inactive, always with a readable label.

### Layout details

The active navigation item is a soft surface with a 3 px vertical indicator; card padding is 16 px;
hover uses a 1 px shadow and a slightly stronger neutral border (the top accent keeps its colour);
`prefers-reduced-motion` still disables transitions. Form behaviour is unchanged: one form per record
type, partial patches, no draft, no autosave.

## V1.7.2 administration layout

- **Cards, not payload dumps.** An administration page presents each fact as a `.card.admin-card`
  inside a responsive `.admin-grid` (`repeat(auto-fit, minmax(min(100%, 300px), 1fr))`, one column
  below 640 px). A server object is never rendered as a nested key/value tree; a page that shows a
  collection (record counts, row counts) lists it as labelled values instead.
- **Status badges always carry text.** `有効 / On`, `無効 / Off`, the mail mode, `公開先が未設定` or
  `前回の公開に失敗しました` are rendered as a `.pill` with a label, so colour is never the only
  signal and the state is readable as text.
- **Versions are never interchangeable.** The database schema version, the application version, the
  publisher version and the snapshot contract are separate labelled rows. A publisher that supports
  a newer contract than the published snapshot is an informational `.info-banner` (`更新あり`), not
  an error; a snapshot newer than the publisher is a warning.
- **Technical metadata is secondary.** Internal values (slot, age, last result, record counts) sit
  in a `<details class="admin-details">` block. Failures, an active emergency stop and a failing
  consistency check are never hidden there.
- **Settings are grouped.** The automation page groups the unchanged keys under Mail notifications,
  Request synchronization, Scheduled reports, Snapshot publication and Emergency stop, each group a
  card, each boolean a control plus an on/off badge.
- **Hierarchy is chosen by name.** `親サブプロジェクト / Parent subproject` and `親タスク / Parent task`
  use a searchable selector (`.search-select`): a search box, a `<select>` of record names and an
  echo of the selected record with its ancestor path. The record itself and its own descendants are
  never offered, the stored value stays the stable ID, and the server keeps validating depth and
  cycles.
- **Editor lifecycle.** A form is `開く → 編集 → 保存 または 閉じる`. Closing (or navigating away)
  discards everything, reopening always starts from the stored record, and there is no draft
  indicator, "keep draft" wording or close confirmation.

## V1.6 desktop design

The application is desktop-first (1366–2560 px) and must stay usable with normal window resizing and 125–150 %
browser zoom. No mobile-specific layout is required.

- **Tokens.** Background `#F4F6F8`, surfaces `#FFFFFF`, primary text `#27333E`, secondary text `#526170`, borders
  `#D7DEE5`; accents: navigation `#304E70`, product design `#357C9B`, automation `#6A65A8`, completed `#328568`,
  pending approval `#C38A39`, overdue/critical `#A74646`.
- **Responsibility colours** come from a validated palette (`Responsibilities.PALETTE`, twelve muted presets) or a
  manager-chosen custom colour; no area name is hardcoded and the number of areas is never assumed. The manager
  picks a colour visually: swatches with a check mark and `aria-pressed` state, the native colour input, an optional
  HEX field in an advanced section, arrow/Home/End keyboard support, and a live preview card. Colour is never the
  only signal — the stored `#RRGGBB` text is always shown next to it.
- **Typography.** Noto Sans JP / Inter when available, otherwise the system UI font. Page titles are strong, project
  names bold, subproject headings medium, descriptions normal, metadata small and muted. Status is never conveyed by
  font weight or colour alone: every state has a text label plus a chip/pill.
- **Navigation.** The responsibility section sits at the top (all areas, one button per area, 未分類 when needed),
  followed by 概要 / 案件 / タスク / 申請 / メンバー / 管理. The active area is marked with `aria-current` in the
  navigation and `aria-pressed` on its card.
- **Hierarchy.** Subprojects render as a collapsible tree (max four levels) and tasks indent by depth (max three)
  with a `↳` marker, a container chip and review chips. Branches render only what is visible; long lists paginate.
- **Filter order.** The task filter bar starts with 担当領域 (the organisation scope), then search, 案件, 担当者,
  状態, 優先度, 階層, 期限 and 並べ替え. The 案件 choices are limited to the selected area; a project that cannot
  belong to it is reset to すべて rather than silently returning an empty list. Changing the area resets paging and
  shows a loading state instead of the previous area's rows.
- **Deletion.** The ADMIN panel is visually distinct (critical border): dependency summary, reason, typed
  confirmation, then one action. A blocked record explains why and points at archive.
- **Accessibility.** Visible focus ring, ≥44 px targets, `role="progressbar"` with a value, status as text, skip
  link, `aria-live` notice region. No colour-only meaning.
- **No framework.** Plain CSS/DOM only; no large UI dependency and no blocking web-font request.

## V1.5 web UI (historical)

ManagerWebStyles uses the existing calm palette, Japanese-friendly 15px body type, 44px controls, visible focus, skip link, labelled native controls and dialog, live status messages and reduced-motion rules. Five main navigation choices adapt to a horizontal wrapped row below 900px; forms use one column below 480px. The rail can collapse. Content is rendered with DOM/textContent only.

Local browser evidence covers widths 375/768/1366/1920, Japanese and English labels, a long mixed-language task name, mobile save, keyboard focus, empty queues, loading/retry and 3,000-task search. Native browser 200% zoom did not apply through the available automation controls and remains NOT_RUN; screen-reader behavior and real HTML Service UI remain live/manual checks. See [visual evidence](checkgates/V1_5_VISUAL.md). Do not claim full WCAG certification.


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
Progress is a bar (`role="progressbar"`, `aria-valuenow`, a visible percentage and an
`aria-label` naming the project) and is reported as 未計算 / Not calculated when the project has
no countable task. Health is one pill in the fixed colour vocabulary, and the committed deadline
carries translated relative wording (あと10日 / 3日超過 / 本日期限) plus a plain-text overdue-task
count, so no state relies on colour alone and the card does not accumulate badge clutter.
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
