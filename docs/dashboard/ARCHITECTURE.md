# Shared dashboard architecture (V1.2)

## Two applications, one source of operational data

```text
┌────────────────────────────┐        ┌──────────────────────────────┐
│ Manager application        │ reads  │ Private management workbook  │
│ src/ (container-bound)     │───────▶│ PROJECTS, TASKS, MEMBERS,    │
│ menu, sidebars, automation │        │ ISSUES, AUTOMATION_SETTINGS… │
└─────────────┬──────────────┘        └──────────────────────────────┘
              │ publishes (write, one sanitized projection)
              ▼
┌────────────────────────────┐        ┌──────────────────────────────┐
│ Snapshot workbook          │ reads  │ Shared dashboard web app     │
│ PUBLISHED_*_A / _B + META  │───────▶│ dashboard-app/ (READ ONLY)   │
└────────────────────────────┘        └──────────────────────────────┘
```

- The management workbook remains the single source of operational data. There is no second
  project-management database and no second task editor.
- The snapshot is a projection, not a copy: only allowlisted public fields are written.
- The dashboard project has no code path to the management workbook.

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| `SharedDashboardModel` | `src/SharedDashboardModel.gs` | Pure transformation from operational rows to allowlisted DTOs. Visibility, reference integrity, aggregates, content hash. |
| `SharedDashboardPublisher` | `src/SharedDashboardPublisher.gs` | Destination guard, serialized publication, A/B slot write + verification, `PUBLISHED_META` commit, status, preview, settings, snapshot initialization. |
| Schema + migration | `src/Schema.gs`, `src/Migrations.gs` | `Dashboard_Visibility`, `Dashboard_Summary`, `Public_Note`; migration `004_shared_dashboard` (3 → 4). |
| Publication settings | `AUTOMATION_SETTINGS` | `SHARED_DASHBOARD_PUBLISH_ENABLED` (default **false**), interval, last result/version/error, approved-by. |
| Scheduler | `src/Triggers.gs`, `scheduledSharedDashboardPublish()` | Optional cadence trigger, installed only while publication is ON. |
| Viewer app | `dashboard-app/` | `doGet`, three read-only server functions, HTML/CSS/client controller. |

## Publication flow

1. `Config.get()` validates `ENVIRONMENT` / `BOUND_ENVIRONMENT` / `SPREADSHEET_ID`.
2. The destination ID is read from Script Properties (`SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`).
3. `assertSnapshotDestination` refuses the master workbook and any workbook containing
   `PROJECTS`, `MEMBERS`, `AUTOMATION_SETTINGS`, `NOTIFICATION_LOG` or `AUDIT_LOG`.
4. `SHARED_DASHBOARD_PUBLISH_ENABLED` is checked for scheduled runs (manual runs stay available).
5. Source tables are read once per table (`Database.read`, one bounded `getDataRange` per table).
6. `SharedDashboardModel.build` applies `Dashboard_Visibility = INTERNAL`.
7. Only allowlisted fields become rows.
8. Cross-project and unknown subproject references are resolved before publication.
9. The sanitized payload is written into the **inactive** slot (`_A` or `_B`).
10. Row counts, headers and the SHA-256 content hash are re-read and verified.
11. `PUBLISHED_META` is rewritten in one contiguous write – this is the commit.
12. `AUTOMATION_SETTINGS` status keys and an `AUDIT_LOG` row (`SHARED_DASHBOARD_PUBLISHED`
    or `SHARED_DASHBOARD_PUBLICATION_FAILED`) record the outcome.

Runs are serialized with the script lock (`Database.withLock`). Publication is idempotent
from a reader's point of view: repeating it produces the same rows under a new monotonic
version and never duplicates tasks. Stale trailing rows are blanked, so removing a task
removes it from the next snapshot.

## Failure behaviour

| Failure | Effect |
| --- | --- |
| Write/verification error in the inactive slot | The active slot and `PUBLISHED_META` stay untouched; failure is recorded and audited. |
| Publication disabled | Scheduled runs return `PUBLICATION_DISABLED`; nothing is written. Manual publication still runs. |
| Destination missing or uninitialized | Error before any write. |
| Destination looks operational | Refused before any write. |
| Snapshot contract mismatch at the reader | `SNAPSHOT_CONTRACT_UNSUPPORTED`; the page shows a friendly message. |

## Why regenerate instead of patching

The snapshot is derived output. Every run rebuilds the projection from source, so a
manager's visibility change, task rename or archive takes effect on the next publication
without any incremental-update bookkeeping. Because only the inactive slot is rebuilt, a
reader never sees a half-written projection.

## Related documents

- [Data contract](DATA_CONTRACT.md)
- [Access and sharing](ACCESS_AND_SHARING.md)
- [Dashboard deployment](DEPLOYMENT.md)
- [Smoke test](SMOKE_TEST.md)
- [Visual specification](VISUAL_SPEC.md)
- [Manager application architecture](../../ARCHITECTURE.md)
- [Security model](../SECURITY_MODEL.md)
