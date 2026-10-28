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

Installed standalone Edge/Chrome headless processes crashed in this environment (exit 3221225477); the in-app browser supplied successful DOM and visual evidence. No static preview is counted as Apps Script deployment verification. All temporary viewport overrides were reset.
