# V1.7.4 GATE 2 — Responsive, zoom, language and accessibility evidence

| Field | Value |
| --- | --- |
| Release line | V1.7 visual refresh (application version `1.7.4`) |
| Scope | `src/ManagerWebStyles.html`, `dashboard-app/Styles.html`, both clients; local preview builds only |
| Result | **PASS (local preview)**; live Workspace (HTML Service) verification **BLOCKED / NOT_RUN** |
| Data | Synthetic preview data only (`scripts/manager-web-preview.js`, `scripts/dashboard-preview.js`); no workbook was opened, no deployment, no production data |

## 1. Method

Both applications were assembled from the real templates and opened in a local Chromium session at the
viewport sizes below. After each resize the document was measured with
`document.documentElement.scrollWidth - clientWidth`; a non-zero value means horizontal scrolling.
Zoom was emulated with `documentElement.style.zoom` at 125 / 150 / 200 % (CSS zoom is close to but not
identical to browser zoom; native zoom on a real HTML Service page remains **NOT_RUN**).

The "before" build is the `v1.7.3` commit in a separate worktree served on a second port, so both
versions could be compared with the same synthetic data.

## 2. Horizontal scrolling

| Viewport | Manager application | Employee dashboard |
| --- | --- | --- |
| 375 px | 0 px | 0 px |
| 768 px | 0 px | 0 px |
| 1366 px | 0 px | 0 px |
| 1920 px | 0 px | 0 px |
| 2560 px | 0 px | 0 px |
| 1366 px @ 125 % | 0 px | 0 px |
| 1366 px @ 150 % | 0 px | 0 px |
| 1366 px @ 200 % | 0 px | 0 px |

At 375 px the manager layout still spans the full viewport (header 360 px, `.layout` 360 px,
`main` 360 px, project grid 312 px) and the dashboard switches its task tables to stacked cards. No
`overflow-x: hidden` was added, so an overflow would be visible rather than masked.

## 3. Before / after comparison

| Screen | Before (v1.7.3) | After (v1.7.4) |
| --- | --- | --- |
| Manager overview | grey project cards, 15 px body text, active nav as a bordered box | accent strip per project, 16 px body text, active nav as a soft surface with a 3 px indicator |
| Manager project detail | indented subproject cards without a parent marker | subproject cards carry the project hue (lighter when nested) |
| Manager task list | grey task cards | 3 px project accent plus a tinted outline; subtasks keep the same hue |
| Employee portfolio | red/amber left border meant "health", no project identity | 5 px project accent strip, health in the pill and a tinted border |
| Employee detail | plain head, grey group blocks | accent strip on the head, accent left border per subproject block, 3 px row marker per task row |

No regression was found in the after-build: every previously visible fact (status, health, deadline,
owner, progress, approval badge, counts, milestone list) is still rendered, and the summary bars and
`role="progressbar"` semantics are unchanged.

## 4. Language

Japanese (default) and English were both rendered at 375 px and 1366 px. Switching the language
re-renders the same screen, project, filters and scroll position; no horizontal scrolling appeared in
either language and no label overflowed its card (the detail title measured 0 px overflow at 375 px).

## 5. Keyboard and focus

Tabbing from the top of the manager page reaches the navigation toggle first; the computed style of the
focused control is `outline: 3px solid rgb(54, 94, 128)` (`--ui-primary`), i.e. a visible focus ring on
every control, not only on inputs. Skip links, the dialog, the `aria-live` notice region and the
reduced-motion rules are unchanged from V1.7.3.

## 6. Colour and non-colour signals

- Every project card shows the project name as text next to its accent, so colour is never the only way
  to identify a project.
- Every status, health and approval state keeps a text label inside its pill (`危機`, `要注意`, `良好`,
  `進行中`, `承認待ち`, `2日超過`, …), so a colour-blind viewer loses no information.
- The accent is additive: an observer who cannot distinguish two palette entries still reads the name,
  the owner and the deadline.
- Contrast of the new tokens and of all 16 accents is recorded in
  [../UI_UX_GUIDELINES.md](../UI_UX_GUIDELINES.md); the lowest accent-to-white ratio is 3.23:1 and all
  text pairs used for content are at or above 4.5:1.

## 7. Honest limitations

- Native browser zoom (Ctrl +/-) on a real deployed HTML Service page, real screen-reader behaviour and
  the Workspace sandbox rendering are **NOT_RUN**; only the local preview build was measured.
- Hash-derived accents can repeat when two project IDs map to the same palette entry (measured: 8
  distinct accents for 10 preview projects, 6 of 6 for the employee portfolio). Reuse is expected and
  never presented as a unique identity; the project name is always visible.
- The worker view has no local preview data, so its accent is verified by
  `tests/v1_7_4-visual.test.js` against the real `dashboardWorkerTasks` response, not by a screenshot.

## 8. Final gate status

| Criterion | Status |
| --- | --- |
| No horizontal scrolling at 375 / 768 / 1366 / 1920 / 2560 px | **PASS (local preview)** |
| No horizontal scrolling at 125 / 150 / 200 % zoom | **PASS (local, CSS zoom emulation)** |
| Japanese and English labels fit | **PASS (local preview)** |
| Long project/task names wrap inside the card | **PASS (local preview, 0 px overflow)** |
| Visible keyboard focus | **PASS (local preview)** |
| Non-colour identification of project and status | **PASS (local)** |
| Contrast targets for new tokens | **PASS (computed)** |
| Native browser zoom and live Workspace rendering | **BLOCKED / NOT_RUN** |
| Screen-reader verification | **BLOCKED / NOT_RUN** |
