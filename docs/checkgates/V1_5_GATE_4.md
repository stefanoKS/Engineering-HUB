# V1.5 gate 4 — Manager UI and navigation

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: 63596375251c230afa11ad42cf999cd3a2f0cef9 (V1.5 implementation); review-correction commit: 309a86c17643e01235555f820a921438fe285487 (project summary freshness, deadline-only tasks, project cards).

## 1. Objective

Verify manager ui and navigation without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/ManagerWebIndex.html, ManagerWebStyles.html, ManagerWebClient.html; shared/i18n.js and generated copies

## 3. Exact acceptance criteria and result

- Five main routes, secondary administration, ja/en, reusable async API and pending/success/error states: local PASS.
- Draft preservation, stale-response suppression and duplicate pending-save suppression: automated PASS.
- 375/768/1366/1920 responsive browser UI: local PASS; HTML Service rendering NOT_RUN.
- 200% native browser zoom and complete assistive-technology navigation: NOT_RUN.

## 4. Automated tests performed

v1_5-web-ui.test.js; source localization/DOM validation. Final aggregate: **387 tests, 387 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

Local four-width overview, mobile editor/save, English labels, long task name, keyboard Tab/focus, loading/error/retry.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 689 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Mobile language control was outside modal; saved confirmation was overwritten by reload.

## 10. Corrective actions

Added dialog language control and preserved acknowledged success notice across refresh.

## 11. Remaining limitations

Native zoom commands did not apply in available browser. Actual Apps Script iframe and screen-reader audit pending.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.

## 14. Review correction — 2026-10-28 (project cards and task form usability)

- Project cards now render an accessible progress bar: `role="progressbar"`, `aria-valuemin="0"`,
  `aria-valuemax="100"`, a rounded `aria-valuenow`, an `aria-label` of “<project> の進捗 /
  Progress for <project>”, a visible percentage and a “未計算 / Not calculated” state when no task is
  countable. The percentage is always text, so colour is never the only signal.
- Each card shows exactly one health pill (順調 / 注意 / 危険 / 日程不明 …) under the 健全性 / Health
  label, the committed deadline with translated relative wording (`あと51日`, `3日超過`, `本日期限`)
  and, only when non-zero, a plain-text “{n} 件が期限超過 / {n} overdue” line. No extra badge layers.
- The task form marks only タスク名/案件/担当者/完了期限 as required. 必要期間 is optional and an
  explanatory hint states that a blank duration keeps the planned start unset. Verified in the
  preview dialog: required fields are `taskName, projectId, ownerId, deadline`.
- Japanese/English behaviour is preserved: every new label is a `web.*` key in `shared/i18n.js`
  (689 keys, copied to both projects by `npm run sync:i18n`); stored project/task names are never
  translated. The language switch keeps the current screen and state.

Screenshots (synthetic preview, no Workspace access):
[1366 overview cards](evidence/V1_5-project-cards-1366.png),
[card detail JA](evidence/V1_5-project-card-detail-1366.png),
[card EN](evidence/V1_5-project-card-en-1366.png),
[narrow 243 px pane](evidence/V1_5-project-card-narrow.png),
[task form](evidence/V1_5-task-form-duration-1366.png).
At the 243 px pane the document reports client/scroll width 243/243 (no horizontal overflow).
Screen-reader output and native 200% zoom remain NOT_RUN.
