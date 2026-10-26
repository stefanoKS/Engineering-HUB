# V1.4.1 gate 2 — responsibilities, project edit and subproject consistency

Status: **PASS (local only)** — live Google Workspace behaviour remains UNVERIFIED.

Scope: `src/Responsibilities.gs`, `src/Ui.gs` (`updateProject`, `transferProject`,
`moveResponsibility`), `src/Subprojects.gs` and the matching regression tests.

## Reordering

`Responsibilities.reorder` now:

1. rejects an empty list, duplicate IDs and unknown IDs before anything is written;
2. runs under the script lock so two managers cannot interleave;
3. preserves `Responsibility_ID`, `Name`, `Description`, `Owner_Member_ID`, `Status` and
   `Retired_At`;
4. keeps rows that were not submitted in their previous relative order after the submitted block;
5. writes only the `Sort_Order` values that actually change (plus `Updated_At` for those rows), so
   a repeated identical call writes nothing;
6. records `RESPONSIBILITY_REORDERED` with the resulting order and the number of changed rows.

| Check | Evidence |
| --- | --- |
| Duplicate and unknown IDs are refused and change nothing | `tests/v1_4_1-stabilization.test.js` → "reordering validates every id and preserves identity, owners and status" |
| A manager reorders the complete list | same test |
| Retired rows keep their status and retirement timestamp | same test |
| A repeated reorder is deterministic and writes nothing | same test (`updated === 0`) |
| Every accepted reorder is audited | same test (2 audit rows) |
| The sidebar "up / down" bridge still works | `tests/v1_4-responsibilities.test.js` → "reordering changes the display order only" |

## Coordinated project edit

`Ui.updateProject` validates in this order and only then performs one `Projects.update`:

1. verified manager role and the project's existence;
2. optimistic-concurrency marker (`Last_Updated`);
3. name / owner / status / category / priority / description / summary / visibility;
4. responsibility destination (exists, retired confirmation, transfer confirmation);
5. committed-deadline confirmation;
6. `Completed` status only when every task is at 100 %.

The responsibility destination is folded into the same patch, and the audit trail records
`RESPONSIBILITY_TRANSFERRED` (previous ID, new ID, actor, reason) plus `UI_PROJECT_UPDATED`.

| Check | Evidence |
| --- | --- |
| A refused transfer leaves the ordinary fields untouched | "a project edit and its responsibility transfer commit together or not at all" |
| A stale concurrency marker is refused with no write | same test |
| A committed save writes both changes and audits the transfer once | same test |
| Owner, original deadline, deadline, tasks and subprojects are preserved | same test and "a coordinated edit keeps subprojects, tasks and request history" |

## Subproject authorization consistency

| Operation | Server check |
| --- | --- |
| `createSubproject` / `saveSubproject` / `archiveSubproject` / `reactivateSubproject` | `Access.requireManager` (UI) and `Access` in the global wrapper |
| `reparentSubproject` / `updateSubproject` | `Access.requireSubprojectWrite` in the global wrapper |
| `moveTask` | `Access.requireManager` + `Access.requireTaskWrite` |
| `createProject` / `updateProject` / `archiveProject` | `Access.requireManager` / `Access.requireProjectWrite` |
| `transferProject` | `Access.requireProjectWrite` |

No project-ownership comparison remains in any of these paths; MEMBER and VIEWER are refused with
`Insufficient role: MANAGER required`.

## Not verified here

Sidebar rendering and the exact Japanese error surface in a real Sheets sidebar.
