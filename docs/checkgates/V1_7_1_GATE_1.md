# V1.7.1 GATE 1 — Request date typing correction

| Field | Value |
| --- | --- |
| Release line | V1.7 corrective change (release version stays `1.7.0`; V1.7 has not been deployed) |
| Scope | `src/Schema.gs`, `tests/v1_7_1-request-date-types.test.js` |
| Result | **PASS (local)**; live Workspace re-verification **BLOCKED / NOT_RUN** |

## Defect

`TASK_REQUESTS.Due_Date_At_Submission` was implicitly typed `string` (it does not match the
`_Date$` / `_At$` naming rules). Google Sheets materializes a date cell as a JavaScript `Date`, and
`Database.update` re-validates the **whole** stored row, so:

```
Invalid text: Due_Date_At_Submission
```

was raised by every path that rewrites the request row — completion approval, deadline-change
approval, reject, return, and the recovery/staleness writes that set `Status`.

## Fix

```js
// The task revision is an opaque digest, not a timestamp: it is never re-typed as a date.
set('TASK_REQUESTS', 'Task_Revision_At_Submission', { type: 'string', defaultValue: '' });
// V1.7.1: a Sheets date cell is a Date object; this deadline is a calendar date.
set('TASK_REQUESTS', 'Due_Date_At_Submission', { type: 'date', defaultValue: '' });
```

Both overrides now coexist. `Task_Revision_At_Submission` stays `string`: it is an opaque revision
digest, and typing it as a date would break revision-based staleness detection.

Application-side validation only: **no** sheet column, migration, publication contract, API or
Script Property change. The already planned `008_task_and_responsibility_members` (schema 7 → 8)
migration is unaffected and remains the only migration for this release line.

## Field audit of `TASK_REQUESTS`

Every field was checked; only one had a demonstrated problem.

| Field | Type | Verdict |
| --- | --- | --- |
| `Submitted_At`, `Decided_At`, `Reported_Completion_At`, `Accepted_Completion_At`, `Imported_At` | datetime | OK (matched by the `_At` rule) |
| `Original_Due_Date`, `Requested_Due_Date` | date | OK (matched by the `_Date` rule) |
| `Due_Date_At_Submission` | **date** | **Fixed** — was `string` |
| `Task_Revision_At_Submission` | string | OK and must stay string |
| `Request_ID`, `Request_Type`, `Task_ID`, `Project_ID`, `Requester_Name`, `Reason`, `Explanation`, `Completion_Note`, `Status`, `Reviewer`, `Decision_Note`, `Inbox_Request_ID`, `Snapshot_Version` | string | OK — never holds a `Date` |

`PROJECTS.Actual_Completion` has the same *shape* of risk (`_Completion` is not matched by the date
rule) but **no demonstrated failure**: it is written only as a validated `yyyy-MM-dd` string by the
application. It is left unchanged and recorded here as an observation rather than fixed speculatively.

## Evidence

`tests/v1_7_1-request-date-types.test.js` — 11 tests, 11 pass. A real `Date` object is placed
directly in the sheet cell (bypassing application validation), exactly as Sheets returns it.

| Requirement | Test | Result |
| --- | --- | --- |
| Schema contract, both overrides | `TASK_REQUESTS types every date as a date and keeps the revision digest as text` | PASS |
| Row rewrite is unblocked | `a Date in the deadline cell no longer blocks rewriting the request row` | PASS |
| Field audit | `every date-typed request cell survives being returned by Sheets as a Date object` | PASS |
| 1–5 completion approval | `a completion approval works when the deadline cell is a Date and writes one clean journal` | PASS — task `Done`/100 %, request `APPROVED`, journal `PREPARED → EFFECT_APPLIED → DECIDED` |
| 6 deadline change | `a deadline-change approval works when the deadline cell is a Date and records the history once` | PASS — `Due_Date` 2026-12-22, one history row |
| 7 reject / return | `reject and return work when the deadline cell is a Date and never touch the task` | PASS |
| 8 no duplicate effect | `a repeated decision with a Date cell applies no second effect and writes no second decision` | PASS — second call refused, counts stay 1 |
| 9 text date | `a yyyy-MM-dd text value keeps working for the same field` | PASS |
| 10 blank dates | `blank optional dates remain valid` | PASS |
| 11 revision + staleness | `the revision digest stays text and staleness protection still refuses a changed task` | PASS — `STALE`, no `DECIDED`, task untouched |
| 11 (stale path itself) | `the stale decision itself works when the deadline cell is a Date` | PASS — newer deadline preserved |

### Proof the tests catch the regression

With the `date` override temporarily removed, **8 of 11** tests fail and the reported message is
reproduced verbatim:

```
actual: Error: Invalid text: Due_Date_At_Submission
```

The three that still pass are the ones that never involve a `Date` cell (schema-independent text and
blank paths), which confirms the suite is targeted rather than accidentally green.

## Suite results

| Command | Result |
| --- | --- |
| `npm run lint` | PASS — 0 findings |
| `npm test` | PASS — **603 tests, 603 pass, 0 fail, 0 skipped** (592 before, +11) |
| `npm run validate` | PASS — 40 manager Apps Script files, 3 dashboard files, both manifests, 892 translation keys |

## Remaining BLOCKED (live)

- Re-running a completion approval and a deadline approval against a real DEV workbook whose
  `TASK_REQUESTS` date cells are genuine Sheets dates. **NOT_RUN.**
- `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.
