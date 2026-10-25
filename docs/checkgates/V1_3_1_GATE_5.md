# V1.3.1 Gate 5 — Final UI polish

Scope: the manager sidebar and the request queue. No cosmetic redesign; the dashboard
screens were not changed.

## Result

Result: **PASS** (local) — real-browser and Workspace rendering: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| No broken buttons | PASS | Test "every onclick handler in the manager sidebar is defined in the template"; every `call('…')` target exists as a server bridge (test "the sidebars reference only script functions that exist on the server") |
| No duplicate action controls | PASS | Test "the manager sidebar keeps a single control per action": unique element ids, one submit button per form; manual publication lives on the project panel, the scheduled-publication controls stay in 自動化設定 |
| No missing translations | PASS | `npm run validate` rejects a `data-i18n` key that does not exist in both languages; the client harness asserts English labels after switching |
| No misleading success messages | PASS | A plain load no longer reports `完了しました` (quiet context load); a project/task save reports the real result; a visibility change says the snapshot updates later; an import failure never shows a success message |
| No outdated application name | PASS | `npm run validate` rejects the obsolete brand and asserts the official name |
| No empty dropdowns caused by avoidable bugs | PASS | The project/task pickers are filled from `context`, with an explicit `新規作成` blank option; subproject options follow the selected project |
| No form reset before a successful save | PASS | Test "a rejected save keeps every entered value and shows the error" |
| No accidental double submission | PASS | Submit buttons are disabled while the request runs; test "a double click submits one task only" |
| Clear loading and error states | PASS | `call()` sets `loading`, `error` (with the translated server message) and `ok`; the queue shows an import warning separately from its list |
| Responsive dashboard | PASS (unchanged) | No dashboard layout change in this release; the V1.2 responsive rules and their tests are untouched |
| Safe rendering of stored text | PASS | All updates use `textContent`/DOM creation; `npm run validate` rejects `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` |
| No mutation of manually entered text on a language switch | PASS | `captureForms()`/`applyForms()` restore every field; test "switching language keeps typed text and translates generated labels" |
| Manager screens understandable without schema knowledge | PASS | Japanese legends, hints for visibility, summary, ownership default and the publication delay |
| Existing components and translation keys reused | PASS | `EH.fillSelect`, `EH.setStatus`, `EHLang.label`, existing `common.*` keys; only the new labels were added to `shared/i18n.js` |

## Evidence

* `tests/v1_3_1-ui.test.js` runs the real `UiMenu.html` and `UiRequests.html` client scripts in
  a DOM mock whose `innerHTML` setter throws, against the real manager modules.
* `npm run validate` — markup, partials, manifests, dictionary coverage.
* `npm run lint` — clean.

## Notes and limits

The sidebar client is exercised in a mock DOM, not a Chromium session; CSS layout, focus order
and the visual appearance of the new controls are **not** verified. The dashboard screens were
not modified in V1.3.1.
