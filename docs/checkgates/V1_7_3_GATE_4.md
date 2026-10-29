# V1.7.3 GATE 4 — Experimental batchGet and safer write batching

| Field | Value |
| --- | --- |
| Release line | V1.7 corrective change (application version `1.7.3`) |
| Scope | `src/SheetReadBackend.gs` (new), `src/Database.gs`, `tests/v1_7_3-performance.test.js` |
| Result | **PASS (local equivalence)**; live Sheets-API comparison **BLOCKED / NOT_RUN** |
| Backend impact | Production read path unchanged (`SpreadsheetApp`). One opt-in Script Property for DEV |

## 1. The experimental read backend

`SheetReadBackend` is off unless **all** of the following hold, and it never becomes a production
default on its own:

| Requirement | Effect when missing |
| --- | --- |
| `DEV_SHEET_READ_BACKEND=BATCH_GET` | `SpreadsheetApp` |
| `ENVIRONMENT=DEVELOPMENT` | `SpreadsheetApp` |
| advanced Sheets service available (`typeof Sheets !== 'undefined'`) | `SpreadsheetApp` |
| spreadsheet timezone `Asia/Tokyo` | `SpreadsheetApp` (`SPREADSHEET_TIME_ZONE_UNSUPPORTED`) |
| the call succeeds | that read falls back to `SpreadsheetApp`; the experiment stops for the execution |

Requested rendering: `valueRenderOption: UNFORMATTED_VALUE` (the same values `getValues()` returns,
never the user-formatted text) and `dateTimeRenderOption: SERIAL_NUMBER` (the raw serial, converted by
the application, so no timezone drift is introduced by the API).

### Compatibility rules and how they are handled

| Concern | Handling |
| --- | --- |
| UNFORMATTED vs FORMATTED | only `UNFORMATTED_VALUE` is requested |
| Sheets serial dates vs JS `Date` | only columns whose `Schema` type is `date`/`datetime` are converted; a serial is read as a wall clock in Asia/Tokyo |
| Date-only in Asia/Tokyo | `serialDate()` reproduces the instant `SpreadsheetApp` returns, so `Domain.date()` yields the written day |
| Datetime precision / timezone | seconds precision, fixed Asia/Tokyo; an unsupported spreadsheet timezone falls back |
| Boolean checkboxes | passed through unchanged (`true`/`false`) |
| Empty strings, missing cells, trailing blanks | every row is padded to the header width with `''` |
| Formula results | `UNFORMATTED_VALUE` returns the computed value, like `getValues()` |
| Custom extra columns | preserved by position; `Schema` only decides the date conversion |
| Stable IDs / schema validation | unchanged; the header contract in `Database.data()` still fails closed |
| Existing requests and approvals | covered by the equivalence test over `TASK_REQUESTS` |
| Manual Google Sheets edits | unaffected — the reader reads the cells as they are |

**No additional OAuth scope or advanced service is requested automatically.** Enabling the advanced
Sheets service (or the `spreadsheets` scope it needs) is a manual, documented DEV decision.

## 2. Equivalence evidence (local)

`tests/v1_7_3-performance.test.js` runs a stand-in `Sheets.Spreadsheets.Values.batchGet` that returns
`UNFORMATTED_VALUE`/`SERIAL_NUMBER` values (a real `Date` cell becomes its serial) and compares the
records of `TASKS`, `PROJECTS`, `SUBPROJECTS`, `MEMBERS`, `RESPONSIBILITIES` and `TASK_REQUESTS` with
the `SpreadsheetApp` path:

| Check | Result |
| --- | --- |
| Records identical (after removing creation timestamps) | PASS |
| `Due_Date` keeps its calendar day and wall clock | PASS |
| Checkbox stays boolean, numeric stays numeric, ID stays text | PASS |
| Empty optional text stays `''` | PASS |
| API failure → fallback + recorded reason | PASS |
| Non-`Asia/Tokyo` spreadsheet → fallback + recorded reason | PASS |
| Flag absent or `ENVIRONMENT=PRODUCTION` → `SPREADSHEETAPP` | PASS |

## 3. Write batching

`Database.update()` writes one range per contiguous run of changed columns instead of one `setValue()`
per field:

| Patch | Write calls |
| --- | --- |
| `Status` + `Priority` (adjacent) | 1 |
| `Task_Name` + `Next_Action` (separated) | 2 |
| a single field | 1 |

Only the patched cells are written. A custom column and a registered formula cell survive an unrelated
save (tests). No full-row rewrite, no rewritten blank, no change to locking, revisions, audit order,
approval idempotency or recovery behaviour.

## 12. Final gate status

| Criterion | Status |
| --- | --- |
| Experimental backend is DEV-only and off by default | **PASS (local)** |
| Equivalence tests for both read methods | **PASS (local)** |
| Dates, booleans, numbers, text and blanks preserved | **PASS (local)** |
| Safe fallback on failure | **PASS (local)** |
| Write batching preserves formulas, custom columns and untouched cells | **PASS (local)** |
| Real Sheets API comparison in the DEV workbook | **BLOCKED / NOT_RUN** |
| Decision to keep `SpreadsheetApp` as the production path | **KEPT** (no measurement justifies a change) |
