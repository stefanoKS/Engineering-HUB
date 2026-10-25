# V1.2 Check Gate 3 — Visual web dashboard

| Field | Value |
| --- | --- |
| Baseline | `cc5b836002146632dbdfdf4f2c292082fb7573db` |
| Branch | `feature/v1.2-shared-dashboard` |
| Date | 2026-10-25 |
| Environment | local (mocked Google services; real Chromium for rendering) |
| Result | **PASS (local)** — Workspace rendering and ACL behaviour UNVERIFIED |

## Scope

`dashboard-app/App.gs`, `DataService.gs`, `Index.html`, `Styles.html`, `Client.html`,
`appsscript.json`.

## Checklist

| Item | Result | Evidence |
| --- | --- | --- |
| All portfolio projects are visually readable | PASS | Chromium capture at 1360 px: 3-column card grid, 6 of 7 projects shown (default status filter), indicator strip and result count. |
| Selecting project opens correct details | PASS | `tests/v1_2-dashboard.test.js` client test clicks `PX1` and asserts the detail title is `検査装置`; Chromium capture shows summary, 8 facts, counts, 3 groups and milestones. |
| Subproject grouping is correct | PASS | Server test asserts `subprojects` = `S1` with total 2; the client test asserts the `試作` group and the `全体タスク` group both render; the Chromium capture of `PX1` shows `光学系設計`, `搬送系設計` and `全体タスク` with their own tables. |
| Direct project tasks are visible | PASS | `ungrouped.total = 3` and the client renders the 全体タスク group. |
| Task detail opens correctly | PASS | Client test opens `TX2`, asserts drawer visibility, title `搬送機構の詳細設計`, public note and `2日超過`. |
| Days remaining calculation is correct | PASS | `DataService.deadline` unit assertions for 完了 / 本日期限 / X日超過 / 期限未設定 / あとN日, plus snapshot-derived task assertions (`2日超過`, `本日期限`, `期限未設定`, `完了`). |
| Search and filters work together | PASS | Search is applied server-side (name, ID, approved task names), filters client-side; server tests cover name/ID/task-name matching and the empty result, and the client applies filters to the returned payload. |
| Completed tasks are displayed correctly | PASS | `Done` maps to `完了` and `terminal` projects remain published behind the explicit status filter. |
| Mobile layout is usable | PASS | Chromium captures at 375 px (portfolio) and 360 px (detail): 2-up indicators, stacked filters, single-column cards, table collapsed to labelled card rows. |
| Empty/loading/error states exist | PASS | Client test asserts the empty state text; skeleton cards are `aria-hidden` and removed on load; error state renders a human message and 再試行. |
| Keyboard navigation works | PASS | Native buttons/selects/details; skip link; Escape closes the drawer (focus returns to the trigger) and then the detail view; drawer focus moves to the close button on open and is trapped by Tab. Verified in Chromium (`activeElement = drawer-close` after opening). |
| No unsafe innerHTML from stored data | PASS | `npm run validate` rejects the forbidden DOM APIs in `dashboard-app/*.html`; the client test renders a project named `<img src=x onerror="alert(1)">` and asserts the text is shown verbatim and no `IMG` element exists. |
| No browser-side write operations | PASS | The only server calls are `dashboardPortfolio`, `dashboardProject`, `dashboardTask`; there is no form, no save button, and `canEdit` is always `false`. |

## Screenshots actually captured (real Chromium)

| # | Viewport | State | Notes |
| --- | --- | --- | --- |
| 1 | 1360 × 1120 | Portfolio | 3-column cards, 4 indicators, search + 4 filters + due-soon chip |
| 2 | 1360 × 1120 | Project detail | Facts grid, counts line, three collapsible groups, sortable table, milestones |
| 3 | 1360 × 1120 | Task drawer | Backdrop, focused close button, 10 facts, public note, progress bar |
| 4 | 819 × 1000 | Project detail | Tablet keeps the table layout |
| 5 | 375 × 900 | Portfolio | 2-up indicators, stacked filters, single-column cards |
| 6 | 360 × 900 | Project detail | Table collapsed to labelled card rows |

Reproduction: `node scripts/dashboard-preview.js --out <file>` then open the file. The preview
uses fictional data and the **real** client script, styles and viewer service output. PNG files
are not committed; the captures above were reviewed live during this work.

These captures prove rendering and layout only. They are **not** Google Workspace evidence:
`docs/dashboard/SMOKE_TEST.md` remains UNVERIFIED.

## Design compliance

- White/light-neutral surfaces, soft gray dividers, one accent colour (`#2f5bd7`), Japanese
  font fallbacks, generous whitespace — see
  [dashboard/VISUAL_SPEC.md](../dashboard/VISUAL_SPEC.md).
- Progress bars for completion; warning colours only for `危険`/`注意`/`期限超過`.
- No giant charts, no dense spreadsheet grid, minimum 44 px tap targets.

## Known limitations

- The offline preview filters by project name only (the deployed app also searches task names).
- No automated pixel-diff regression harness; the preview script makes a future visual diff
  straightforward but none is wired into `npm test`.
- Client behaviour is exercised with a Node DOM shim and in Chromium; it is not exercised
  against a deployed Apps Script page.
