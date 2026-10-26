# V1.4 gate 5 — shared dashboard contract and request UX

Status: **PASS locally; BLOCKED for live Workspace verification**

Scope: snapshot contract 1.4, responsibility publication, nested hierarchy rendering, the
`REQUEST_SUBMISSION_ENABLED` behaviour and unsent request data.

## What was checked

| Check | Evidence |
| --- | --- |
| The publisher and the viewer agree on the published contract | `tests/v1_2-dashboard.test.js` → "the publisher and the viewer agree on the published contract" (updated to 1.4) |
| A snapshot written with contract 1.3 is rejected, not misread | `tests/v1_4-hierarchy.test.js` → "a snapshot from an older contract is rejected instead of being read as the new one" |
| Responsibilities are published with the hierarchy and hierarchical progress | "the snapshot publishes the responsibility label, the hierarchy and hierarchical progress" |
| A responsibility description and its owner are never published | "the snapshot never publishes a responsibility description or owner" |
| An unknown responsibility publishes no label and warns | "a project whose responsibility is unknown is published without a label and warns" |
| The viewer filters by responsibility and marks a retired area | `tests/v1_4-ui.test.js` → "the dashboard offers a responsibility filter and marks a retired one" |
| A nested subproject is indented and the parent reports the descendant count | "a nested subproject is indented and its parent reports the descendant count" |
| A disabled configuration offers no active submission button | "the request form is not offered while submission is disabled" |
| A configuration failure fails closed | "a configuration failure fails closed and never claims requests are open" |
| An enabled configuration offers both request types | "an enabled configuration offers both request types" |
| A language switch keeps an unsent draft and never submits | "switching language keeps an unsent request draft and never submits it" |
| A/B slots, verification and the single-commit flip are unchanged | `tests/v1_2-publisher.test.js` (updated counts only) |
| No private field reaches the snapshot | "publication writes only allowlisted fields, excludes restricted projects and leaves the source untouched" |

## Manual browser verification (local static preview)

`npm run preview:dashboard` was rendered in a real browser (Chromium through the VS Code browser
tools) against the real client script and the real publisher/viewer pipeline:

- The responsibility filter listed `すべて`, `研究開発（旧） (retired)`, `自動化・工程設計`, `製品設計`.
- Project cards showed `担当領域 · カテゴリ · 状態`.
- Opening a project showed `担当領域` as the first detail fact and the hierarchy
  `機構設計` (level 1, 40%, 「配下を含む 3 件」) with indented `光学系設計` (level 2, 70%) and
  `搬送系設計` (level 2, 24%).
- The request drawer restored the typed deadline, explanation, requester and reason after
  switching 日本語 → English → 日本語, and no submission was triggered.
- No element overlap and no horizontal scrolling at 375px and 1366px.

This is a static-file preview of the real client code, **not** a deployed Apps Script
environment: the request configuration was stubbed for the enabled path.

## BLOCKED — still requires live evidence

- `REQUEST_SUBMISSION_ENABLED` read from the real dashboard project's Script Properties, in the
  enabled, disabled, unset, delayed and failing states.
- The deployed viewer at `access: DOMAIN` with a real domain-restricted account.
- Whether the published snapshot workbook and the request inbox workbook keep their separate
  identities and permissions after a real publication.

Record these in [SMOKE_TEST.md](SMOKE_TEST.md); it must stay UNVERIFIED until they are executed.
