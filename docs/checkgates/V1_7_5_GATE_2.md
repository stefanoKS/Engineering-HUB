# V1.7.5 GATE 2 — Response contracts and array access

| Field | Value |
| --- | --- |
| Release line | V1.7.5 corrective release (application version `1.7.5`; V1.7 has not been deployed) |
| Scope | `src/ManagerWebClient.html` (`readContract`, `requireArray`, `optionalArray`, `requireObject`, `requirePage`, `isContractError`), `src/UiSafe.html` (`EH.requireArray`/`optionalArray`/`requireObject`), `src/UiRequests.html`, `src/UiSystem.html`, `src/UiSettings.html`, `src/UiMenu.html`, `dashboard-app/Client.html` |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT_RUN** |
| Backend impact | None — client-side validation only; no payload shape was changed |

## 1. Why

Every field in these files arrives from `google.script.run`, i.e. from an execution the browser does
not control. The audit found direct `.length` / `.map` / `.forEach` access on fields that a broken
deployment, a partial failure or a future server change could omit or type differently:

| File | Field | Previous behaviour |
| --- | --- | --- |
| `ManagerWebClient.html` | `data.requests.length`, `data.items.length`, `data.triggers.*.length`, `detail.tasks.length` | `TypeError`, page left half-painted |
| `UiRequests.html` | `data.requests.length`, `data.history.length` | `TypeError` inside the success handler |
| `UiSystem.html` | `data.triggers.missing/obsolete/duplicates.length`, `data.errors.length` | `TypeError`, and the panel could claim "OK" |
| `UiSettings.html` | `result.warnings.length`, `result.counts.*`, `result.excluded.*` | `TypeError` |
| `UiMenu.html` | `data.members/projects/skills` lists, `taskWindow.tasks.length` | `TypeError` |
| `dashboard-app/Client.html` | `data.projects`, `data.tasks`, `detail.tasks.length` | an absent `projects` list was **silently rendered as an empty portfolio** |

## 2. Strategy

```
required field, wrong type  → INVALID_RESPONSE: expected array for <field> → readable error + retry
optional field, absent      → documented default (empty list)
valid empty array           → the normal empty state
loading response            → the loading state is kept
server error                → readable error + retry
```

- The manager application validates each read once, at the API boundary (`readContract`, called from
  `fetchView`, `bootstrapFetch`, `detail`, `loadSubprojects`, `searchParent`, `loadParentTasks`, the
  plan read and the `requestSync` result). A contract failure clears `currentData` so the page shows
  its retry state instead of painting a mismatched payload.
- The bound sidebars use the shared `EH` helpers and wrap the render callback of `call()` in
  `try/catch`, so a contract failure becomes one readable status message and never a half-rendered
  panel.
- The shared dashboard validates `projects` and `tasks`; a portfolio without a project list shows the
  existing error block (`overview-error`) instead of an empty list, and a worker payload without tasks
  reports `INVALID_RESPONSE` in `worker-error`.

`ManagerWebClient.html` also gained one targeted hardening: `invalidatePrefixes` still covers cached
payloads only (the v1.5 startup-navigation behaviour depends on that), while the task index uses
`supersedeRead` — see GATE 1.

## 3. Required / optional matrix

| Operation | Required | Optional (default) |
| --- | --- | --- |
| `bootstrap` | `projects` (page), `tasks.total` | `references`, `overviewProjects` |
| `overview` | the object | `projects`/`upcoming` (empty page) |
| `projects`, `tasks`, `parentOptions` | `items`, `total` | — |
| `requests` | `requests` | `history` (none) |
| `members`, `responsibilities`, `skills` | `items` | `assessments` |
| `project` | `record`, `progress` | `subprojects` (none) |
| `task`, `editor` | `record` | `confirmations` (none) |
| `member` | `member` | `current`, `previous`, `memberActions`, `taskHistory` (none) |
| `plan` | the object | `warnings` (none) |
| `taskIndex` | `columns`, `rows`, `total` | — (validated by `hydrateTasks`) |

## 4. Regression tests

`tests/v1_7_5-response-guards.test.js` (20 tests): a non-array `members.items`, a null
`requests.requests`, a `requests` payload without `history`, a valid empty list, a detail payload
without `record`, a bootstrap without `projects`, a `plan` answer without `warnings`, the four bound
sidebars (broken and valid payloads, including a missing trigger group and missing publication counts),
the shared dashboard portfolio (non-array, absent payload, valid empty), the dashboard worker payload,
and the guards themselves.

## 5. Evidence

```
node --test tests/v1_7_5-response-guards.test.js         # 20 tests, 20 pass
node --test                                              # 722 tests, 722 pass, 0 fail, 0 skipped
node scripts/validate-source.js                          # PASS (42 manager files, 3 dashboard files, 970 keys)
```

## 6. Final gate status

| Criterion | Status |
| --- | --- |
| No unhandled `.length` exception from a malformed or missing field | **PASS (local)** |
| A broken contract is reported, not shown as zero records | **PASS (local)** |
| Optional fields keep their documented default | **PASS (local)** |
| Valid empty lists keep the empty state | **PASS (local)** |
| No new generic validation framework | **PASS (local)** — six small helpers, one per boundary |
| Live Workspace behaviour | **BLOCKED / NOT_RUN** |
