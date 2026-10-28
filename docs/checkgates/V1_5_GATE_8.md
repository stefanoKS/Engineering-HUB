# V1.5 gate 8 — Automated tests and accessibility

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: 63596375251c230afa11ad42cf999cd3a2f0cef9 (V1.5 implementation); review-correction commit: 309a86c17643e01235555f820a921438fe285487 (project summary freshness, deadline-only tasks, project cards).

## 1. Objective

Verify automated tests and accessibility without treating local mock evidence as Workspace proof.

## 2. Affected source files

tests/v1_5-*.test.js, tests/support/manager-web-harness.js, repository.js; scripts/validate-source.js; ManagerWebStyles.html

## 3. Exact acceptance criteria and result

- npm ci/lint/test/validate complete; all prior passing tests preserved; focused new suites: PASS (387/387, no skips).
- Four responsive widths, contrast tokens, labelled controls, modal and keyboard focus: local PASS.
- Native 200% zoom, real reduced-motion preference and screen-reader/HTML Service accessibility: NOT_RUN.
- No fake browser/deployment claim: evidence explicitly distinguishes local vs live.

## 4. Automated tests performed

npm ci; npm run lint; npm test; npm run validate; v1_5-performance fixtures. Final aggregate: **387 tests, 387 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

See V1_5_VISUAL.md and screenshots; contrast calculation 5.33–11.90 text ratios, control boundary 4.37.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 689 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Four baseline test-environment assertions failed; standalone headless browsers crashed; in-app zoom controls did not apply.

## 10. Corrective actions

Tracked-path secret guards, existing scope allowance, quota mock adaptation; in-app browser for successful visual checks.

## 11. Remaining limitations

No complete WCAG certification. Native zoom and assistive technology remain required manual checks.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.

## 14. Review correction — 2026-10-28 (tests and accessibility evidence)

- Aggregate: **387 tests, 387 pass, 0 fail, 0 skipped** (378 before this correction; 9 added, none
  removed, skipped or weakened).
- New suites: `tests/v1_5-project-metrics.test.js` (fresh progress/health after a task save, counts
  and deadline state, project save, deadline-only versus duration creation, hierarchy/role/revision
  regressions, per-request read-once and no-write checks) and three UI tests in
  `tests/v1_5-web-ui.test.js` (deadline-only form, progress-bar/health/deadline card semantics in
  both languages, overdue text).
- Two existing budget assertions were corrected rather than deleted: `tableReads <= 9` plus a
  per-sheet “read once” assertion, and `rangeReadsPerCall === 10` with the reason in a comment.
- Accessibility: the progress bar is a labelled `progressbar` with a visible percentage; health has
  a text label as well as colour; the overdue count is text. Focus, dialog, skip link and
  reduced-motion rules are unchanged.
- Still NOT_RUN: screen-reader output, native 200% zoom and the deployed HTML Service URL.

Evidence: [V1_5_VALIDATION.txt](V1_5_VALIDATION.txt) (full `npm test` output),
[visual checks](V1_5_VISUAL.md).
