# V1.7.4 GATE 1 — Visual refresh and project colour hierarchy

| Field | Value |
| --- | --- |
| Release line | V1.7 visual refresh (application version `1.7.4`; V1.7 has not been deployed) |
| Scope | `shared/project-colors.js`, `src/ProjectColors.html`, `dashboard-app/ProjectColors.html`, `src/ManagerWebStyles.html`, `src/ManagerWebClient.html`, `src/ManagerWebIndex.html`, `src/ManagerWeb.gs` (one added display field), `dashboard-app/Styles.html`, `dashboard-app/Client.html`, `dashboard-app/Index.html`, `scripts/sync-project-colors.js`, `scripts/validate-source.js`, `tests/v1_7_4-visual.test.js` |
| Result | **PASS (local)**; live Workspace UI verification **BLOCKED / NOT_RUN** |
| Backend impact | No schema change, no migration, no new Script Property, no new API operation, no authorization or publication change |

## 1. What was wrong

The manager application and the employee dashboard shared a palette but had no project identity at
all: every project card looked identical, subprojects were indented without a parent marker, and task
cards carried only a grey border. On the employee dashboard a red/amber left border meant "health", so
the only strong card accent available was a status colour.

## 2. Design tokens and typography

Both applications now declare the same `--ui-*` set (`#F6F8FB`, `#FFFFFF`, `#F0F4F8`, `#253449`,
`#607086`, `#DFE6EE`, `#365E80`, radius `10px`) plus a 4/8/12/16/24 px spacing scale and the
`Noto Sans JP → Yu Gothic UI → Hiragino Sans → Meiryo → system-ui` stack. The historical `--v16-*`
tokens and the dashboard's `--bg`/`--surface`/`--text`/`--accent` keep their names and resolve to the
new values, so no legacy selector was rewritten and nothing is duplicated.

Body text is 16 px at 1.55–1.6 line height, main headings 23–24 px, project titles 18 px, subproject
titles 16.5–17 px, task names 15.5–16 px and metadata 13–14 px. Controls stay at least 44 px high.

## 3. Project accent derivation

`shared/project-colors.js` is the single source of truth:

| Rule | Implementation |
| --- | --- |
| Deterministic from the stable `Project_ID` | two-lane multiplicative hash (cyrb53 style) over the trimmed ID, then `% PALETTE.length` |
| Never positional | no list index, filter state, sort order or rendered order is an input; there is no other parameter |
| Never user-supplied CSS | `colorFor` returns a palette member only; `styleFor` emits `--project-accent`, `--project-outline`, `--project-tint`; an ID is never interpolated into a colour |
| No data cost | the identifier the client already holds; no column, migration, read or API call |
| Identical in both clients | `npm run sync:colors` writes byte-identical copies to `src/ProjectColors.html` and `dashboard-app/ProjectColors.html`; `npm run validate` fails on drift |
| Independent of responsibility colours | the 16 palette values and the 12 responsibility presets share no value; a test asserts the intersection is empty |

The palette holds 16 muted accents (the eight reference values plus eight hue-gap values). A portfolio
smaller than the palette usually keeps distinct hues, but reuse is possible and is never presented as a
globally unique identity: the project name is always visible. Measured on the local preview portfolio
(6 projects) all six accents are distinct; on the 10-project manager preview 8 of 10 are.

## 4. Inheritance and health

| Element | Accent | Regression test |
| --- | --- | --- |
| Manager project card | 5 px top strip; the progress fill uses the same hue | "manager project cards, subprojects and tasks share one project accent" |
| Manager subproject card | 3 px left accent in the project hue; nested levels use the 0.45 outline of the same hue | same test (`border-left-color` computed from the inline custom properties) |
| Manager task card (including a subtask) | 3 px left accent plus a 1 px outline tinted by `--project-outline`; depth only changes indentation | "manager task cards, including nested ones, reuse the project accent" |
| Employee project card | 5 px top strip; the health pill keeps its text and semantic colour and the card border is tinted instead of a red/amber left border | "the dashboard keeps the health warning next to the stable identity colour" |
| Employee detail header | 5 px top strip for the opened project | "the dashboard card, detail blocks, task rows and worker cards share the project accent" |
| Employee subproject block | 4 px left accent; nested block uses the same hue at 0.45 | same test |
| Employee task table | 3 px marker on the task-name cell on desktop, 3 px left border on the mobile card | same test |
| Employee worker task card | 3 px left accent from the task's published `projectId` | same test |

The dashboard's health emphasis is not removed: `is-risk`/`is-caution` still tint the card border and
the health pill still renders `危機 / 要注意 / 良好 / 未計算` (or the English labels).

## 5. Behaviour that must not change

| Requirement | Evidence |
| --- | --- |
| Colour is stable across filtering and sorting | "filtering the manager list never changes a project colour", "filtering and sorting the dashboard never changes a project colour" |
| Manager and employee agree | "manager and dashboard show the same colour for the same project" (same DOM accent for `P1`) |
| No extra backend call | "the manager accent costs no extra backend call" (language re-render issues no service call), "the dashboard accent costs no extra backend call" (a local chip filter issues no service call) |
| Existing operations unaffected | "existing project and task operations are unaffected" (project create + list read, task status/deadline/progress still visible, `role="progressbar"` with `aria-valuenow`) |
| Status/approval semantics unchanged | "warning and approval states keep their own colours and their text" |
| Cache, deduplication and pagination untouched | no change to `load`, `api`, `cache`, `queue` or the server payload sizes; the only server change is one added `projectId` display field in the existing `upcoming` list |

## 6. Evidence

```
node node_modules/eslint/bin/eslint.js .                 # PASS (no findings)
node --test tests/*.test.js                              # 666 tests, 666 pass, 0 fail, 0 skipped
node --test tests/v1_7_4-visual.test.js                   # 17 tests, 17 pass
node scripts/validate-source.js                          # PASS (42 manager files, 3 dashboard files, 970 keys)
node scripts/sync-i18n.js --check                        # PASS
node scripts/sync-project-colors.js --check              # PASS
```

Version handling: `src/Config.gs` declares `APP_VERSION = '1.7.4'`, so the overview, the publication
page, システム状態 and the header badge agree. The three historical assertions that pinned `1.7.3`
(`v1_6_2-release`, `v1_7_3-correctness`, `v1_7_3-performance`) were updated to the new value; they still
assert that one constant feeds every surface. The test count assertions in the historical V1.4/V1.5
README records were left untouched.

## 7. Final gate status

| Criterion | Status |
| --- | --- |
| Shared light design language in both applications | **PASS (local + preview)** |
| Japanese-friendly typography at the specified sizes | **PASS (local + preview)** |
| Project accent deterministic from `Project_ID` | **PASS (local)** |
| Accent stable across navigation, filtering, sorting, refresh | **PASS (local)** |
| Subprojects and tasks inherit the project hue | **PASS (local + preview)** |
| Manager and employee colours identical | **PASS (local)** |
| Responsibility colours remain independent | **PASS (local)** |
| Semantic warning/approval/completion colours unchanged | **PASS (local)** |
| No new backend read, API call, storage or migration | **PASS (local)** |
| Existing project/task operations unaffected | **PASS (local)** |
| Live Workspace (HTML Service) appearance and behaviour | **BLOCKED / NOT_RUN** |
