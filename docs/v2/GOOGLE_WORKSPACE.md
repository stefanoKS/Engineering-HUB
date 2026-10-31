# Google Workspace Integration

V2 talks to Google over REST with a **service account** (worker only) and to sign-in with a
**Google ID token** (browser → API). There is no Apps Script, no `MailApp`, no
`SpreadsheetApp`.

> Live Workspace behaviour has **not** been verified in this environment. Gmail, Calendar,
> Drive and Sheets were exercised against local transport doubles only. See
> [ACCEPTANCE.md](./ACCEPTANCE.md).

## 1. What uses what

| Capability | Component | Credential | Scope |
| --- | --- | --- | --- |
| Sign-in | browser + API | public OAuth client ID | `openid email profile` (implicit in ID token) |
| Notification e-mail | worker | service account with domain-wide delegation | `https://www.googleapis.com/auth/gmail.send` |
| Calendar events | worker | same service account | `https://www.googleapis.com/auth/calendar.events` |
| Backup upload | worker | same service account | `https://www.googleapis.com/auth/drive.file` |
| Report / publication export | worker | same service account | `https://www.googleapis.com/auth/spreadsheets` |

Nothing else is requested. The API holds no Google credential at all, so a compromised API
process cannot send mail or read a spreadsheet.

## 2. OAuth client for sign-in

1. Google Cloud console → **APIs & Services → Credentials → Create credentials → OAuth client
   ID → Web application**.
2. Authorised JavaScript origins: `https://<APP_DOMAIN>` (no trailing slash).
3. Copy the client ID into `GOOGLE_CLIENT_ID` (API) and `VITE_GOOGLE_CLIENT_ID` (build-time for
   the web bundle). Both must be the **same** client ID; the API verifies `aud`.
4. No client secret is used and none may be stored.

The API verifies signature, issuer, audience, expiry, `email_verified` and the e-mail domain.
A token from another Google project fails with `AUTHORIZATION_DENIED`.

## 3. Service account (worker)

1. Create a service account in the same Google Cloud project; generate a **JSON key**.
2. Enable the Gmail, Calendar, Drive and Sheets APIs for the project.
3. In the Google Workspace Admin console → **Security → API controls → Domain-wide
   delegation**, add the service account's client ID with exactly the four scopes above.
4. Put the key in `GOOGLE_SERVICE_ACCOUNT_JSON` (one line, or a mounted file referenced by the
   same variable in your secret store). It is never committed and never served to a browser.
5. The delegated mailbox is `GMAIL_SENDER` (a real Workspace user, for example
   `no-reply@example.co.jp`). Gmail sends **as** that user; a send for another address is
   refused before the request leaves the worker.
6. `CALENDAR_ID` is the shared calendar (`primary` for the delegated user, or a calendar ID the
   user can write to).
7. `DRIVE_BACKUP_FOLDER_ID` is a folder shared with the delegated user with edit rights.

A missing or incomplete credential makes the affected job fail with `NOT_CONFIGURED` and an
audit/ledger row. It never falls back to another mailbox or folder.

## 4. Notification paths

```
domain event ──► outbox row ──► worker claim ──► settings gate ──► ledger row ──► Gmail
```

The settings gate is re-read inside the job:

| Setting | Effect |
| --- | --- |
| `EMAIL_MODE` = `OFF` | nothing is sent; the ledger row is `SKIPPED` |
| `EMAIL_MODE` = `PREVIEW` | the ledger row is `PREVIEW`, no API call is made |
| `EMAIL_MODE` = `LIVE` | send, subject to the emergency stop and the per-run cap |
| `EMERGENCY_STOP` = `true` | forces OFF regardless of `EMAIL_MODE` |
| `ASSIGNMENT_EMAIL_ENABLED`, `DEADLINE_REMINDER_ENABLED`, `OVERDUE_REMINDER_ENABLED`, per-project and per-task switches | each must be on for that message class |
| `ALLOWED_RECIPIENT_DOMAINS` | recipient must match, otherwise `SKIPPED` |
| `MAX_EMAILS_PER_RUN` | hard cap per worker run |

Transition to `LIVE` requires ADMIN, the exact typed phrase and a passing preflight; every
change is audited (`SETTING_CHANGED`, `LIVE_PREFLIGHT_FAILED`, `EMERGENCY_STOP_ENGAGED`).

Delivery semantics: a transport error that proves the message was **not** accepted is retried
with backoff. An ambiguous outcome (timeout, 5xx after the request was written) becomes
`DELIVERY_UNCERTAIN`, is **never** retried automatically, and is surfaced in the ledger and the
status screen for a human decision.

## 5. Calendar

* One event per task, keyed by `calendar_links(entity_type = 'TASK', entity_id = task_id)` with
  the stored `event_id` and a `sync_hash` of the title, planned start and deadline. An unchanged
  task produces no API call; a changed one updates the same event instead of creating a second.
* Events are all-day and are created only while `CALENDAR_SYNC_ENABLED` is on and a due date
  exists.
* A Calendar failure never blocks a task write. The outbox job fails and is retried on its own
  schedule; a permanently failing job is recorded as `FAILED`.

## 6. Sheets (report and publication export)

* The worker appends to a dedicated sheet (`EXPORT_SPREADSHEET_ID` / `EXPORT_SHEET_NAME`) and
  writes the publication slots to `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`.
* These are **outputs only**. Nothing in V2 reads a spreadsheet as a data source (except the
  optional transition request inbox below), and the publication destination is never accepted
  from a browser.
* The publication write is A/B: write the inactive slot, verify headers, row count and content
  hash, then commit with a single metadata write. A failure leaves the previously published
  slot readable.

## 7. Optional transition request inbox

`REQUEST_INBOX_SPREADSHEET_ID` + `REQUEST_INBOX_RANGE` + `REQUEST_INBOX_SERVICE_ACCOUNT` let the
API import requests that the V1 employee dashboard appended. It is:
* off unless all three are set (`configured: false` otherwise, and the UI says so),
* import-only (the API never writes to it),
* idempotent on the inbox request ID,
* superseded by direct submission — remove the configuration once V1 is retired.

## 8. Local development without Google

* `DEV_AUTH_ENABLED=true` + `DEV_AUTH_EMAILS` allows e-mail sign-in for named seeded members.
  It is refused when `NODE_ENV=production`.
* A transport is `configured: false` when its credential is missing, and the affected job records
  `NOT_CONFIGURED` instead of calling Google. Tests use recording transports
  (`apps/worker/test/backup.test.ts`, `apps/api/test/api.test.ts`); there is no environment
  variable that turns on a fake transport in production.

## 9. Setup checklist (operator)

- [ ] OAuth client created, origins set, both client-ID variables filled.
- [ ] APIs enabled: Gmail, Calendar, Drive, Sheets.
- [ ] Service account created, key stored as a secret, domain-wide delegation granted with the
      four scopes only.
- [ ] `GMAIL_SENDER` is a real, monitored mailbox; `CALENDAR_ID` and `DRIVE_BACKUP_FOLDER_ID`
      are reachable by that user.
- [ ] Domain-wide delegation reviewed by an administrator; the client ID recorded.
- [ ] A test notification in `PREVIEW` mode reviewed, then `LIVE` enabled with the phrase.
- [ ] A test Calendar event created and deleted.
- [ ] A backup uploaded, downloaded, decrypted and verified.
- [ ] `docs/production` evidence recorded with date, actor and message ID.

Every checkbox above is **NOT_RUN** in this repository until that evidence exists.
