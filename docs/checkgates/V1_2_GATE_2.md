# V1.2 Check Gate 2 — Snapshot publication

| Field | Value |
| --- | --- |
| Baseline | `cc5b836002146632dbdfdf4f2c292082fb7573db` |
| Branch | `feature/v1.2-shared-dashboard` |
| Date | 2026-10-25 |
| Environment | local (mocked Google services only) |
| Result | **PASS (local)** — live publication UNVERIFIED |

## Scope

`src/SharedDashboardPublisher.gs`, `src/SharedDashboardModel.gs`, publication settings in
`AUTOMATION_SETTINGS`, and the optional publication trigger.

## Checklist

| Item | Result | Evidence |
| --- | --- | --- |
| Sanitized snapshots are valid | PASS | `tests/v1_2-publisher.test.js` "publication writes only allowlisted fields…" asserts the exact 18-column project row, header order and the absence of private text. Read-back verification checks headers, row counts and the SHA-256 content hash before committing. |
| Hidden projects and tasks never appear | PASS | Same test: `PROJECT_COUNT = 1`, `excluded.projects = 1`, only `T1`/`T2` written. Model tests cover blank/unknown visibility and cross-project references. |
| Source data remains unchanged | PASS | The test snapshots the whole manager workbook before/after and compares cell by cell (excluding `AUTOMATION_SETTINGS` and `AUDIT_LOG`, which are the intentional status records). |
| Publish OFF suppresses scheduled publishing | PASS | "publication OFF suppresses scheduled publishing but never blocks a manual run": `scheduledSharedDashboardPublish()` returns `PUBLICATION_DISABLED`, `ACTIVE_SLOT` stays empty, manual publish still succeeds and no publication trigger is expected. |
| Failed publish preserves previous snapshot | PASS | "a failed publication preserves the committed snapshot and is recorded": a throwing write leaves `ACTIVE_SLOT = A`, `SNAPSHOT_VERSION = 1`, identical task rows, `LAST_SHARED_DASHBOARD_PUBLISH_RESULT = FAILED` and one `SHARED_DASHBOARD_PUBLICATION_FAILED` audit row. |
| Repeated publish does not create duplicate tasks | PASS | "repeating a publication never duplicates tasks": three publications leave exactly `T1`, `T2` in both slots with the version at 3. |
| Snapshot version and timestamp are correct | PASS | "publication alternates A/B slots…": `ACTIVE_SLOT`, `SNAPSHOT_VERSION`, `PREVIOUS_SLOT`, `CONTENT_HASH` (64 hex characters) and `PUBLISHED_AT` asserted. |
| No sensitive fields enter the snapshot | PASS | The serialized snapshot is asserted not to match `@example.test`, `社外秘`, `Description`, `Acceptance_Criteria`, `Next_Action`, `Owner_Member_ID` or `Estimated_Hours`. |

## Additional properties verified

| Property | Evidence |
| --- | --- |
| Destination may not be the master workbook | "the master workbook can never be used as the publication destination" |
| A workbook that looks operational is refused | "a workbook that looks like the master is refused even when used as the destination" (`PROJECTS`, `AUTOMATION_SETTINGS`) |
| Initialization is ADMIN-only, confirmed and empty-only | "snapshot initialization needs administrator rights, an exact confirmation and an empty workbook" |
| Enabling needs ADMIN + exact confirmation + initialized destination | "enabling publication requires ADMIN, the exact confirmation and an initialized destination" |
| Status/preview never expose the destination ID | "publication status and preview never expose the destination spreadsheet id" |
| Preview writes nothing and reports drift | same test (`unchanged` true, then false after a task rename) |
| Publication is independent of mail mode | "publication settings stay independent of the mail mode…": effective mail mode stays `OFF`, no mail, no Calendar event, no trigger |
| Only a manager/admin session can publish | "publication requires a manager or administrator session" |
| The manager sidebar uses the validated domain functions only | "the manager sidebar exposes publication controls only through validated domain functions": status without the destination ID, interval-only save never enables publication, enabling without the confirmation is refused, publish/preview work, and a MEMBER is refused every publication surface |
| Cadence rounding | `Triggers.publicationCadence()` returns 30 minutes for the default setting |

## Implementation notes

- Runs take the script lock (`Database.withLock`); overlapping publications cannot interleave.
- The inactive slot is fully rewritten, and stale trailing rows are blanked, so a removed
  task disappears from the next snapshot.
- Metadata (`PUBLISHED_META`) is rewritten in one contiguous write; that write is the commit.
- Publication status keys are application-written and cannot be set through
  `AutomationSettings.save`.

## Not verified here

Real Sheets write latency, the 30-minute trigger under Workspace quotas, and failure
behaviour during a live Google outage. See
[dashboard/SMOKE_TEST.md](../dashboard/SMOKE_TEST.md) sections B and D.
