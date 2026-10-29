# V1.7 GATE 3 — Employee publication contract 1.6

| Field | Value |
| --- | --- |
| Release | V1.7 |
| Scope | `src/SharedDashboardModel.gs`, `src/SharedDashboardPublisher.gs`, `dashboard-app/DataService.gs`, `docs/dashboard/DATA_CONTRACT.md` |
| Result | **PASS (local)**; real A/B publication in Workspace **BLOCKED / NOT_RUN** |

## What changed

- `CONTRACT_VERSION` **1.5 → 1.6**.
- One appended task field, `assigneeNames`, serialized as JSON text so a display name containing a
  separator character can never be mis-split.
- `ownerName` keeps its exact previous meaning, so a 1.5 reader stays correct.
- The reader accepts **1.4**, **1.5** and **1.6**, each validated against its own exact header row and
  failing closed on anything else.
- No member identifier, e-mail address, role, department or other member field is published, and the
  private `MEMBERS` table is never published to support worker filtering.

## Preserved publication safety

- A/B slot publication is unchanged: the inactive slot is written in full, headers/counts/content
  hash are verified, and a single `PUBLISHED_META` write commits.
- A failed run leaves the previously committed snapshot readable.
- Publication still defaults OFF, requires ADMIN plus the exact confirmation, and the destination ID
  is never returned to a browser.

## Evidence

| Check | Result |
| --- | --- |
| `contract 1.6 publishes an allowlisted display-name list and never a private member field` | PASS — the published cell parses to the ordered names and the sheet contains no `@example.test` / `M-` identifier |
| `a 1.5 snapshot stays readable when only 1.6 publishes the assignee list` | PASS — a 1.5 header row is read by the 1.5 field list and `workers` falls back to the primary owner |
| `the publisher and the employee reader agree on contract 1.6 fields` | PASS |
| `the viewer exposes no write path and caches only the bounded portfolio` | PASS |
| `an unknown or mixed contract still fails closed` | PASS |
| `snapshot Date objects normalize to contract date strings before hash verification` | PASS |
| `npm run validate` (header/allowlist checks) | PASS |

## Live items that remain BLOCKED

- Publishing to a real snapshot workbook and confirming `PUBLISHED_META.CONTRACT_VERSION = 1.6`, the
  extra `PUBLISHED_TASKS` column, the row counts and the content hash. **NOT_RUN.**
- Reading a 1.5 snapshot with the deployed 1.6 employee app. **NOT_RUN.**
