# V2 Security Model

Scope: the whole V2 deployment — the web application, the API, the worker, PostgreSQL, the
Google integrations and the network path. This document states what is enforced, what is not,
and what has not been verified live.

## 1. Trust boundaries

```
browser ──TLS──► reverse proxy ──► API (stateless, same origin) ──► PostgreSQL
                                        │
                                        └──► outbox ──► worker ──► Google APIs
```

* The browser is untrusted. Every field it sends is data: role, actor, owner, confirmation,
  timestamp, revision and identifier.
* The API is the only writer to PostgreSQL, and the only component that decides authorization.
* The worker holds the Google credentials. The API never sends mail and never calls Google on
  behalf of a request.
* PostgreSQL is never published to the host network. Only the API and the worker reach it.

## 2. Identity

* Sign-in accepts a **Google ID token** and verifies: signature against Google's keys (fetched
  through Google's public JWKS endpoint), `iss` in `accounts.google.com` /
  `https://accounts.google.com`, `aud` equals `GOOGLE_CLIENT_ID`, `exp`/`iat` inside tolerance,
  `email_verified === true`, and the e-mail domain inside `MANAGER_WEB_ALLOWED_DOMAINS`
  (mandatory, fails closed when unset).
* The verified e-mail is mapped to exactly one `members` row. An unknown, inactive or
  role-less identity is refused with `AUTHORIZATION_DENIED`; no record is created implicitly.
* The role comes from the database at session start **and** is re-read on every request
  (`loadActorRole`), so a role change or deactivation takes effect without a new sign-in;
  deactivation also revokes the sessions.
* The deployment never accepts an identity from a header, a cookie other than the session
  token, or a query parameter.

**Development fixture.** `DEV_AUTH_ENABLED=true` is refused when `NODE_ENV=production`; it
requires an explicit `DEV_AUTH_EMAILS` allowlist and is refused for an unknown address. It
exists only for local and test runs.

## 3. Sessions

* The cookie is an opaque 32-byte random token, `HttpOnly`, `SameSite=Lax`, `Secure` in
  production, `Path=/`, and it expires after `SESSION_TTL_MINUTES` (default 720 minutes).
  Only the SHA-256 hash is stored, so a database reader cannot replay a token.
* Every unsafe request must send `x-csrf-token` matching the session's CSRF token (constant-time
  compare). A missing or wrong token is `AUTHORIZATION_DENIED`.
* When a browser supplies `Origin`, it must equal `PUBLIC_ORIGIN` or an entry in
  `ALLOWED_ORIGINS`; otherwise the request is refused, which blocks a cross-site form post.
* Sign-out revokes the row and clears the cookie. A refused request returns
  `AUTHORIZATION_DENIED`; the browser then clears its cache and shows the access-denied screen
  instead of continuing to repaint.

## 4. Authorization matrix

| Area | ADMIN | MANAGER | MEMBER | VIEWER |
| --- | --- | --- | --- | --- |
| Projects, subprojects, tasks: create/edit/archive/delete | yes | yes | no | no |
| Reports, workload, member profile, automation, publication, status | yes | read; changes need ADMIN for live activation | no | no |
| Own task update (sidebar-equivalent screen) | yes | yes | own tasks only | no |
| Role / activation change | yes, never self, never the last active admin | no | no | no |
| Responsibility owner change | yes | no | no | no |
| Completion override | yes (+ reason + `COMPLETE <id>`) | no | no | no |
| Request decision (deadline / completion) | yes | yes | no | no |
| Employee snapshot, submit request | yes | yes | yes | yes (read; submission follows the switch) |

Ownership (`projects.owner_member_id`, `subprojects.owner_id`,
`responsibilities.owner_member_id`) is accountability, never permission. There are no
per-project, per-responsibility or per-subproject ACLs.

Rules that are enforced in code **and** re-checked by a database trigger where a mistake would
be destructive: task/subproject hierarchy limits and cycles, container tasks cannot be `Done`,
`audit_log` and `deadline_history` are append-only, a project delete requires an empty
dependency graph.

## 5. Write safety

* Every manager route loads the actor, checks the role server-side and then calls one domain
  service. The body never carries an actor, a role or an owner.
* A mutation carries the `revision` the editor loaded. The update is a conditional
  `UPDATE … WHERE revision = $n`; zero rows affected produces `EDIT_CONFLICT` and the browser
  keeps the draft.
* Immutable fields (`Project_ID`, `Task_ID`, `created_at`, `original_deadline`, audit and
  migration identifiers) are rejected as `IMMUTABLE_FIELD` rather than ignored.
* Create commands require `idempotencyKey`; the key is stored with the result so a retry returns
  the first result and never creates a second record.
* One logical operation is one transaction. Confirmations (`confirmed`, typed phrases) are
  validated before the first write.
* The delete path (ADMIN only) requires an empty dependency preflight, a typed
  `DELETE <id>`, a reason, a verified backup, and it writes `RECORD_DELETE_PREPARED` before the
  row disappears and `RECORD_DELETED` after, so a crash is detectable and reconcilable.

## 6. Employee boundary and privacy

* The employee reader receives only the published contract (18 allowlisted headers). Member
  names are display names; no e-mail address, role, skill, capacity, private description,
  acceptance criterion, note or identifier of another member is published.
* A project is published only when its visibility is exactly `INTERNAL`; blank or unknown is
  treated as `RESTRICTED`.
* Any authenticated internal identity may submit a request for any published task. There is no
  login form, password, personal token or owner-match check — the requirement is deliberately
  not an identity proof, and the UI says so.
* Submission fails closed: while the switch is loading or on error, the form is disabled.
  `REQUEST_SUBMISSION_ENABLED` must be exactly `true`.
* The browser may persist only receipt metadata (task, type, time, state, request ID). No
  explanation text and no manager data is written to `localStorage`, `sessionStorage` or
  IndexedDB; `scripts/validate-v2.js` rejects additional keys.

## 7. Notifications

* Only the worker sends mail, and only through the Gmail adapter. Defaults are `EMAIL_MODE=OFF`
  and `EMERGENCY_STOP=true`; the worker re-reads the settings inside the job, so a mid-run change
  is honoured.
* LIVE requires ADMIN, the exact typed phrase and a passing preflight; the change is audited.
* Recipients are limited to `ALLOWED_RECIPIENT_DOMAINS` and `MAX_EMAILS_PER_RUN` per run.
* Every send is a ledger row: `PENDING`/`PREVIEW`/`SENT`/`DELIVERY_UNCERTAIN`/`FAILED`/`SKIPPED`.
  A dedupe key prevents a second send for the same event. `DELIVERY_UNCERTAIN` is never
  retried automatically and is surfaced for a human decision.
* Bodies are rendered from a fixed template from allowlisted fields; no stored text is
  interpolated as HTML and no spreadsheet content is used as a sender.

## 8. Secrets and configuration

| Secret | Location | Notes |
| --- | --- | --- |
| `DATABASE_URL` | environment / Compose secret file | never logged |
| `GOOGLE_CLIENT_ID` | environment | public value |
| Google service-account JSON (Gmail, Calendar, Drive, Sheets) | mounted file or environment | worker only; domain-wide delegation scoped to the four APIs |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | environment | ≥32 bytes; rotate by restarting with a new value (sessions are then invalidated) |
| `BACKUP_ENCRYPTION_KEY` | environment | AES-256-GCM key for every backup artifact |

`.env.example` contains placeholders only. `scripts/validate-v2.js` fails on a committed
`.env`, on a real Google identifier pattern and on `.clasp.json`. Configuration is validated by
zod at boot and the process exits when a required value is missing; there is no silent default
for the database URL, allowed domains or Google client ID.

## 9. Network and hosting

* TLS terminates at Caddy (automatic certificates) or at the Cloudflare tunnel. The API binds
  `127.0.0.1` inside the Compose network; PostgreSQL has no published port.
* Security headers (from `@fastify/helmet`): a CSP that allows only same-origin assets plus the
  Google Identity host (`script-src`/`connect-src`/`frame-src`), `frame-ancestors 'none'`,
  `object-src 'none'`, HSTS, `X-Content-Type-Options: nosniff`, a Referrer-Policy, and
  `no-store` on API responses.
* Rate limiting (300 requests/minute/address by default), a 256 KB body limit and request
  timeouts bound abuse.
* The server holds no VPN dependency; exposure is controlled by the reverse proxy and, for the
  tunnel option, by a Cloudflare Access policy. See [REMOTE_ACCESS.md](./REMOTE_ACCESS.md).

## 10. Data protection

* Backups are AES-256-GCM containers with a per-artifact random nonce; the key is supplied at
  runtime and never stored with the artifact. A restore verifies the authentication tag before
  writing anything into a staging schema.
* `pg_dump` uses `--no-owner --no-privileges`; the archive is encrypted and only then uploaded.
* Retention keeps at least the most recent verified backup; a failed backup never deletes the
  previous one.
* Logs redact cookies, authorization, CSRF headers and connection strings. Metrics carry
  timings, call counts and payload sizes only.

## 11. Threat summary

| Threat | Control |
| --- | --- |
| Stolen cookie | HttpOnly, Secure, 12-hour expiry, hashed at rest, CSRF token required |
| Cross-site request | Origin allowlist + CSRF header + SameSite=Lax |
| Forged identity | ID-token signature/audience/domain verification, database role lookup |
| Privilege escalation from the browser | No role/actor/owner field is trusted; role re-read per request |
| Stale overwrite / lost update | Revision-checked conditional update, `EDIT_CONFLICT` |
| Duplicate submission | Idempotency key with stored result; inbox request ID is the permanent key |
| Container marked done | Domain refusal, request-import refusal, database trigger |
| Injection | Parameterised SQL everywhere; no string-built query; ESLint/validate check |
| Stored XSS | React text rendering; no `innerHTML`; `validate-v2` rejects sinks |
| Accidental destructive operation | Tombstone + backup + typed confirmation; no cascading delete |
| Mail storm | OFF default, emergency stop, per-run cap, dedupe, domain restriction |
| Release of private data | One allowlisted publication contract, tested in `contracts.test` |
| Backup theft | AES-256-GCM with an external key |

## 12. Limitations (stated, not hidden)

1. **Live Workspace behaviour is not verified here.** Google sign-in, Gmail, Calendar, Drive and
   Sheets were exercised against local doubles only. `docs/v2/ACCEPTANCE.md` records those rows
   as BLOCKED.
2. **The deployment ACL is the reverse proxy.** There is no per-user network rule; identity is
   the Google sign-in. A user with a valid company account can reach the login page.
3. **CSRF relies on a same-origin browser.** A non-browser client holding the session cookie and
   the CSRF token can act, exactly as in any cookie-based application.
4. **The employee receive path is authenticated but not ownership-matched.** Any internal
   account may submit a request for any published task; this is a product requirement.
5. **PostgreSQL row-level security is not used.** Authorization is enforced in one application
   layer plus triggers for destructive invariants. Direct database access is a trusted operator
   capability.
6. **Rate limiting is per process.** A multi-instance deployment should move the limit to the
   reverse proxy.
7. **No penetration test has been performed.** Local mocks are not a security verification.

## 13. Security-relevant test coverage (local, real PostgreSQL)

* `apps/api/test/api.test.ts`: unauthenticated refusal, wrong-CSRF refusal, MEMBER refusal on a
  manager read, role change taking effect, idempotent create, stale edit conflict, container
  completion refusal, publication allowlist, submission switch fail-closed.
* `packages/db/test/integration.test.ts`: append-only audit and deadline history, container
  `Done` refusal, hierarchy depth/cycle refusals, revision conflict, soft relationship removal.
* `packages/contracts/test/contracts.test.ts`: the publication contract exposes exactly the
  allowlisted fields.
