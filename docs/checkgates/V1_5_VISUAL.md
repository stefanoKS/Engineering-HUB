# V1.5 local browser evidence

Date: 2026-10-28. Windows in-app Chromium browser; loopback synthetic preview only. No Workspace deployment was opened. Code version 1.5.0.

| Check | Actual result | Status |
| --- | --- | --- |
| 375 / 768 / 1366 / 1920 CSS-pixel overview | document client/scroll widths 360/360, 753/753, 1351/1351, 1905/1905 respectively (15px scrollbar); body font 15px; adaptive navigation/cards | PASS |
| Mobile English task editor | 324px dialog at 375px viewport; no horizontal overflow; long mixed Japanese/English task name retained; Save confirmed in list | PASS |
| Keyboard Tab in task dialog | Focus moved from Task name to Description; computed outline solid and visible in screenshot | PASS |
| Japanese and English switch | Labels change, stored names unchanged; edit draft preserved (also automated regression) | PASS |
| 3,000-task query | Search 2999 returned task 2999 with 1–1 / 1; 300 project options and paginated default list | PASS |
| Empty overview / requests | Zero KPI counts and No records found; empty request queue/history visible | PASS |
| Error/retry | Synthetic first RPC error visible; Retry produced authorized overview | PASS |
| Slow RPC | Loading visible immediately; Administration navigation remained usable; stale response regression automated | PASS |
| Contrast tokens | Calculated separately in V1_5_CONTRAST.json; text >=4.5 and control/focus >=3 | PASS |
| Reduced motion | CSS disables animation/transitions under preference; actual OS preference/screen reader not exercised | NOT_RUN (manual behavior) |
| Native 200% zoom | Ctrl-plus browser commands did not change devicePixelRatio or innerWidth; no successful zoom established | NOT_RUN |
| Full keyboard/screen-reader audit in HTML Service | Requires deployed DEV app and assistive technology | NOT_RUN |

Saved screenshots: [375 overview](evidence/V1_5-overview-375.png), [768 overview](evidence/V1_5-overview-768.png), [1366 overview](evidence/V1_5-overview-1366.png), [1920 overview](evidence/V1_5-overview-1920.png), [1366 task list](evidence/V1_5-tasks-1366.png), [mobile task/focus](evidence/V1_5-mobile-task.png), [error](evidence/V1_5-error.png). Some viewport-transition captures are scaled/cropped by the embedded browser capture surface; DOM dimensions above were separately verified. Use the settled task/mobile captures for detailed typography review.

## Review correction capture (2026-10-28)

Re-checked after the project-card and task-form correction, same synthetic preview and in-app
Chromium browser:

| Check | Actual result | Status |
| --- | --- | --- |
| Progress bar semantics | First card exposes `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=100`, rounded `aria-valuenow`, `aria-label="検査装置の設計・製作 0 の進捗"` and the visible text `25%` | PASS |
| Health and overdue wording | Health pill 注意 under 健全性; deadline reads `2026-12-18 · あと51日`; overdue projects render `1 件が期限超過` as text (`is-overdue`, no colour-only signal) | PASS |
| English switch | Same card renders `Health / Caution`, `Deadline 2026-12-18 · in 51 days`, `Progress for …`; stored project and member names stay untranslated | PASS |
| Narrow pane | Document client/scroll width 243/243 CSS px — no horizontal overflow; card stacks to one column with the bar and percentage visible | PASS |
| Task form required fields | `required` is `taskName, projectId, ownerId, deadline`; 必要期間 is optional with the explanatory hint | PASS |
| Deadline-only save through the preview | Created row: `Due_Date=2026-12-18`, `Planned_Start=''`, `Planned_Duration_Value=''`, `Planned_Start_Source=''` | PASS |
| Immediate freshness after a save | Creating that task changed the P0 card from 25% to 24.94% and health 注意 → 順調 on the next read, with no report refresh | PASS |
| 375 px emulation | The in-app pane could not be resized back to 375 px in this session (window fixed at 258 px inner width); the narrower 243 px check above is recorded instead | PARTIAL |
| Screen reader / native 200% zoom / deployed HTML Service | Not exercised | NOT_RUN |

Saved screenshots: [1366 overview cards](evidence/V1_5-project-cards-1366.png), [card detail JA](evidence/V1_5-project-card-detail-1366.png), [card EN](evidence/V1_5-project-card-en-1366.png), [narrow 243 px card](evidence/V1_5-project-card-narrow.png), [task form](evidence/V1_5-task-form-duration-1366.png).

Installed standalone Edge/Chrome headless processes crashed in this environment (exit 3221225477); the in-app browser supplied successful DOM and visual evidence. No static preview is counted as Apps Script deployment verification. All temporary viewport overrides were reset.
