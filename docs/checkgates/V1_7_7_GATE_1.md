# V1.7.7 GATE 1 — Authorization denial classification and revocation

| Field | Value |
| --- | --- |
| Release line | V1.7.7 corrective release (application version `1.7.7`; V1.7 has not been deployed) |
| Scope | `src/Roles.gs` (`DENIED`, `denied`, `isDenied`, `requireAtLeast`), `src/ManagerWeb.gs` (`authorize`, `response`), `src/ManagerWebClient.html` (`isAuthorizationDenied`, `rpc`, `handleError`, `syncTaskIndex`, write/editor/admin catch handlers) |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT RUN** |
| Backend impact | No schema change, no migration, no new Script Property, no new API operation, no authorization policy change, no publication change |

## 1. Defect reproduced before the correction

`handleError()` recognized a permission denial and called `revoke()`, but only the read paths reached it
(`bootstrapFetch`, `fetchView`, `fetchPublication`). Every other failure path reported the error itself:

| # | Path | Handler before V1.7.7 | Consequence |
| --- | --- | --- | --- |
| 1.1 | task / project / subproject / member / responsibility save | `act()` → `notice(message)` | snapshot and open form survived a refused write |
| 1.2 | request approval, rejection, return | `act()` → `notice(message)` | the queue and the cached task state survived |
| 1.3 | automatic request import | request-sync callback → `data.importError` | the private queue stayed readable |
| 1.4 | manual import, report refresh, settings save, reconciliation, ADMIN deletion | own `catch` | private snapshot stayed rendered |
| 1.5 | editor detail read, subproject and parent reads, plan preview | `notice(message)` inside the form | form stayed open with the unsaved state |
| 1.6 | background revalidation / compact index | `handleError` / inline regex in `syncTaskIndex` | read paths revoked, but the classifier was wording-based |

The classifier was also a regular expression over
`MANAGER_ACCESS_DENIED|Insufficient role|Access denied|権限`, applied to the error text only. The server
returned no stable marker, so the classification depended on message copy.

## 2. Correction

```
Roles.requireAtLeast / ManagerWeb.authorize
  → throw Roles.denied(message)              error.code = 'AUTHORIZATION_DENIED'
ManagerWeb.response()  catch
  → {ok:false, error, code:'AUTHORIZATION_DENIED'}
client rpc() done(result, error)
  → isAuthorizationDenied(error, result)     code first, message pattern only as fallback
  → revoke()                                 the one existing revocation path
  → reject(...)                              the caller sees revoked === true and paints nothing
```

`revoke()` is unchanged and remains the only revocation mechanism: it advances the page, editor,
task-index and request-sync generations, clears `api` (cache and in-flight tokens), clears the store,
discards the editor, clears the content host and shows the access-denied message.

### What must never revoke

| Outcome | Marker | Handling |
| --- | --- | --- |
| Google Sheets timeout / network failure | no code | reported; snapshot and page stay |
| `EDIT_CONFLICT` | `EDIT_CONFLICT: …` | reported in the form; entered values preserved |
| invalid form value / validation error | message only | reported; page stays |
| missing optional record (`NOT_FOUND`) | message only | reported; page stays |
| request inbox unavailable / unconfigured | `importError` warning | warning shown; queue stays |
| failed notification | message only | reported |
| ambiguous write outcome (`TIMEOUT`) | no code | reported once; never replayed |

## 3. Client calls per operation

Unchanged by this release: revocation adds no call. A denial ends the page and issues nothing further.

## 4. Test cases

`tests/v1_7_7-hotfix.test.js` — 13 tests, all PASS; 5 fail on `1c3165d` (v1.7.6).

| Case | Test | Baseline |
| --- | --- | --- |
| Server marks a refusal with a stable code | "the server marks a refused authorization with a stable code" | FAIL (code absent) |
| A — denied approval clears every cached view | "a denied approval clears every private cached view" | FAIL |
| B — denied import renders nothing | "a denied import never renders the rows it read" | FAIL |
| C — denied task save closes the editor | "a denied task save closes the editor and discards its unsaved state" | FAIL |
| D — network timeout does not revoke | "an ordinary failure is reported without revoking the page" | PASS (guard) |
| E — edit conflict keeps the editor | "an edit conflict keeps the editor and its entered values" | PASS (guard) |
| F — delayed answer after revocation | "a delayed answer never restores data or a form after revocation" | PASS (guard) |

## 5. Actual test results

```
node --test tests/v1_7_7-hotfix.test.js
ℹ tests 13   ℹ pass 13   ℹ fail 0   ℹ skipped 0
```

Against the v1.7.6 tree (`git worktree add … 1c3165d`, same test file): `tests 13 / pass 8 / fail 5`.

## 6. Known limitations

- A refusal raised **inside** a guarded UI service is re-wrapped by `ManagerWeb.unwrap()` and loses the
  code; the message fallback still recognizes it. The entrypoint check runs first, so this normally
  cannot happen.
- A server mutation that already started is not cancelled. Only its answer is discarded, and it is never
  replayed. Server-side authorization stays authoritative.

## 7. Remaining blockers

Live Workspace verification is **BLOCKED / NOT RUN**: no Google Workspace execution has been recorded for
this release. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

## 8. Final gate status

Status: **PASS (local)** — **BLOCKED** for live verification. Production readiness: **NOT APPROVED FOR
PRODUCTION**.
