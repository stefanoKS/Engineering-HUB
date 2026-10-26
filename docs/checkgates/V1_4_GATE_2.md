# V1.4 gate 2 — responsibilities and authorization

Status: **PASS (local only, superseded)** — replaced by [V1_4_1_GATE_2.md](V1_4_1_GATE_2.md)

This file records the V1.4 local result and is kept as history. V1.4.1 replaced the owner-scoped
MANAGER policy described here with a department-wide role policy, so the rows below about
"only the areas they own" and "ADMIN-only retired destination" no longer describe the
implementation. See [V1_4_1_GATE_2.md](V1_4_1_GATE_2.md) for the current behaviour.

Scope: the responsibility lifecycle, the unique-name rule, ordering, retirement/reactivation,
project transfer and the server-side permission policy.

## What was checked

| Check | Evidence |
| --- | --- |
| Stable, generated, immutable ID (`RESP_<uuid>`) | "a responsibility gets a stable ID and can be renamed without touching projects" |
| Renaming does not rewrite a project row linked by ID | same test |
| Name required, ≤ 60 characters, unique among active rows | "a name must be present, bounded and unique among active responsibilities" |
| A retired name may be reused without touching history | same test |
| Only ADMIN may change the owner | "only ADMIN may change the responsibility owner" |
| A MANAGER administers only the areas they own; MEMBER is refused | "a manager may only administer the responsibility they own" |
| Owning an area grants no project access | "responsibility ownership never grants access to the projects inside it" |
| Re-order is one step, keeps every record and is audited | "reordering changes the display order only" |
| Retirement reports the remaining open projects, keeps them visible and marks them for reassignment | "retiring keeps every project visible and marks it for reassignment" |
| Retirement requires confirmation, is not repeatable, and blocks new project selection | "retiring without confirmation is refused, and reactivation restores selectability" |
| A transfer changes only `Responsibility_ID` (+ timestamp) and audits both IDs, the actor and the reason | "a project transfer changes only the responsibility and is audited with both values" |
| A transfer requires confirmation and the target project's authorization | "a transfer requires confirmation and the authorization of the target project" |
| Moving into a retired area is ADMIN-only with an extra confirmation | "a retired responsibility is only a destination for an ADMIN with an extra confirmation" |
| Blank responsibility stays 未分類 rather than being invented | "projects without a responsibility stay unassigned rather than invented" |
| The sidebar bridges create, rename, retire and reactivate | `tests/v1_4-ui.test.js` → "a manager creates, renames and retires a responsibility through the sidebar bridges" |
| The project form requires a confirmation for a responsibility change and keeps the owner | "changing a project responsibility asks for confirmation and keeps the owner" |
| The panel shows owners, open/at-risk counts and the retired state | "the responsibility list shows owners, counts and retired state" |

## Policy as implemented

`Access.canManageResponsibility` is the single source of truth:

```text
ADMIN   -> every responsibility
MANAGER -> only the responsibilities they own (create + administer); no owner change
MEMBER  -> none
VIEWER  -> none
```

Preserved boundaries: project ownership is still the only project permission, a responsibility
transfer never rewrites `Project_Owner_ID`, `Committed_Deadline`, `Original_Deadline`, `Status` or
progress, and no write is reachable from the browser without a server-side role check.

## Not verified here

Role behaviour against real Google identities, and the actual `Session.getActiveUser()` result in
a Workspace domain, were not exercised. Verify in a development deployment with at least one
ADMIN, one MANAGER, one MEMBER and one VIEWER account.
