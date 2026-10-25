# UI localization (日本語 / English)

V1.3 ships one bilingual interface for both deployments:

| Deployment | Screens | Default language |
| --- | --- | --- |
| Manager application (container-bound, `src/`) | manager sidebar (project create/edit, task assign/edit, progress, members, skills), request queue, automation settings, system status | 日本語 |
| Shared dashboard (`dashboard-app/`) | project dashboard, project detail, task detail, deadline change request, completion report | 日本語 |

The official application name is **設計・開発課 管理** and is identical in every language.
It is never translated, abbreviated or re-branded.

## 1. Architecture

```
shared/i18n.js            canonical dictionary + helpers (single source of truth)
   │  npm run sync:i18n
   ├── src/I18n.html              generated copy (manager project)
   └── dashboard-app/I18n.html    generated copy (dashboard project)
```

Apps Script cannot share files between two script projects, so the dictionary is copied
into both projects by `node scripts/sync-i18n.js`. `npm run validate` fails when a copy
differs from `shared/i18n.js`; the copies are never edited by hand.

`EH_I18N` exposes:

| Function | Purpose |
| --- | --- |
| `t(lang, key, vars)` | one translated string with `{placeholder}` substitution |
| `has(key)` | key existence check (used by validation and tests) |
| `status/health/priority(lang, value)` | localization of controlled enum values only |
| `deadline(lang, kind, days, completed)` | 完了 / 本日期限 / X日超過 / あとX日 / 期限未設定 and their English equivalents |
| `serverMessage(lang, message)` | translation of known server validation messages |
| `errorMessage(lang, error)` | translation of a request error `{code, message}` |
| `read()/write(lang)` | browser-local preference |
| `apply(lang, root)` | applies `data-i18n`, `data-i18n-aria`, `data-i18n-title`, `data-i18n-placeholder` |

No third-party translation API, no network call and no runtime AI translation is used.

## 2. What is translated

* Navigation, headings and legends
* Field labels, placeholders, hints and tooltips
* Buttons and confirmation prompts
* Validation and error messages (known server messages plus all client-side messages)
* Status, health, priority, deadline and request-status labels
* Loading, empty and error states
* Date countdown wording and day differences

## 3. What is never translated

Stored spreadsheet text is displayed exactly as stored, in both languages:

* project, subproject, task and member names
* descriptions, acceptance criteria, next actions and public notes
* request reasons (stored canonical value), explanations and completion notes
* self-reported requester/reporter names
* audit, history and notification content

Database identifiers, worksheet names, enum values and stable IDs are never translated.
Only their display labels come from the dictionary. Changing the interface language never
writes to the workbook.

Example:

```
stored project name : AI外観検査設備
Japanese UI         : プロジェクト: AI外観検査設備
English UI          : Project: AI外観検査設備
```

Request reasons are a controlled list. The form shows the localized label but submits the
canonical Japanese value, so a request created from the English UI stores exactly the same
value as one created from the Japanese UI.

## 4. Language switch and persistence

* The switch is labelled `日本語 | English` and appears on every screen listed above.
* First visit: **Japanese**.
* Selecting English re-renders every visible label immediately (`renderAll()`), without a
  server round trip, without reloading the page and without losing the current project,
  task, filter, drawer or scroll position.
* In the manager sidebar (V1.3.1) the switch also preserves **unsaved form input**: the
  template captures every field value, re-renders the generated labels and the select
  options, then restores what the manager typed. An edit form keeps the record selected.
* The choice is stored per browser under the `eh.lang` key in `localStorage`.
* If storage is unavailable (private mode, restricted browser), the UI falls back to
  Japanese on the next session and never raises an application error.
* No account, password or login form is introduced, and nothing is stored in
  `UserProperties` (the dashboard executes as the deployer and has no per-user storage).

## 5. Adding or changing a string

1. Add the key to `shared/i18n.js` under **both** `ja` and `en`.
2. Use it in the template (`data-i18n="key"`) or in the client script (`T('key')`).
3. Run `npm run sync:i18n`, then `npm run lint`, `npm test` and `npm run validate`.

`npm run validate` rejects a key that only exists in one language, an empty translation and
a template that references an unknown key.

## 6. Verification status

Local tests cover the dictionary, the default language, the switch behaviour and the
guarantee that stored text is not translated. Browser rendering with a real Google
Workspace account remains **UNVERIFIED** until it is recorded in
[`docs/checkgates/V1_3_GATE_7.md`](checkgates/V1_3_GATE_7.md); local output is not
Workspace evidence.
