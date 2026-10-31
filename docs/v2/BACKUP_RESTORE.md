# Backup and Restore (V2)

PostgreSQL is the authoritative store, so a backup is a database backup. The V1 workbook backup
procedure stays valid for the V1 workbook and is not replaced here.

## 1. What a backup is

The worker produces two artefacts, and the operator CLI can produce the same pair on demand:

| Artefact | Producer | Purpose |
| --- | --- | --- |
| `pg_dump` custom-format archive (`--no-owner --no-privileges`) | `createDump` (needs `PG_DUMP_PATH`) | Byte-faithful restore of the whole database |
| Logical archive `eh-logical-v1` (gzip JSON, `jsonb_agg(to_jsonb(t))` per table) | `createLogicalBackup` | Portable restore **without** client tools, used for verification |

Both are encrypted with AES-256-GCM before leaving the process:

```
magic (EHBAK1) ‖ nonce (12 bytes) ‖ auth tag (16 bytes) ‖ ciphertext
```

The key is `BACKUP_ENCRYPTION_KEY` (base64 of 32 random bytes) and is never stored with the
artefact; `keyId` is a 12-hex-character fingerprint recorded in the manifest so a restore can be
matched to a key. A wrong key fails the authentication tag, so a truncated or tampered container
cannot be opened.

Encrypted artefacts are uploaded to `DRIVE_BACKUP_FOLDER_ID` and recorded in `backup_log`
(`backup_id`, `result`, `checksum`, `size_bytes`, `manifest` with row counts, `keyId`, Drive file
ID). A run that cannot upload records `FAILED` with `BACKUP_NOT_CONFIGURED` /
`DRIVE_NOT_CONFIGURED` and never claims success.

The logical archive covers every operational table (members, responsibilities, projects,
subprojects, tasks, dependencies, assignees, milestones, phases, requests, deadline history,
ledger, audit, settings, backups, deletions, outbox, idempotency keys, published slots, import
runs, calendar links). `sessions` is deliberately **excluded**: a backup must not carry session
material, and a restore must not resurrect a signed-in browser.

## 2. When it runs

* `DAILY_BACKUP_ENABLED = true` enqueues one `backup.database` job per business day (dedupe key
  `backup:<date>`). The default is **false**, like every other automation.
* `npm run --workspace @eh/worker tsx src/cli.ts backup-now` runs one backup immediately
  (uploading when Drive is configured).
* Before a risky operation (schema change, migration, bulk correction) run `backup-now` and
  record the `backup_id`.
* Retention (`BACKUP_RETENTION_DAYS`) is **reported, never enforced**: the worker lists older
  artefacts and writes an audit row `BACKUP_RETENTION_DUE`, but it never deletes a file.
  Deleting a backup is a deliberate operator action outside this codebase.

## 3. Verify a backup (required step)

```bash
npm run --workspace @eh/worker tsx src/cli.ts verify-restore
```

It creates a scratch database, runs the migrations, restores the freshly created logical archive,
compares every table's row count, prints `result: PASS|FAIL`, and drops the scratch database. It
never touches the configured database and refuses a populated target.

A `FAIL` means the backup is not a usable backup. Fix it before any migration or cut-over.

## 4. Restore procedures

### A. Ordinary restore into a new database (recommended)

```bash
createdb eh_restored
psql -d eh_restored -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'   # if the schema needs it
pg_restore --no-owner --no-privileges --dbname eh_restored backup.dump
```

Then point `DATABASE_URL` at `eh_restored`, start the API, and confirm `/readyz` and the status
screen (`schema version`, row counts). `restoreContainer` performs the same steps from code and
refuses to target the production database name.

### B. Restore without client tools (logical archive)

```ts
const plain = decrypt(container, parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY!));
await restoreLogicalBackup(targetDb, plain);      // refuses a non-empty target
```

Use a new database; `truncateExisting` exists only for verification runs.

### C. Point-in-time / partial recovery

There is no WAL archiving configured by default. A partial recovery means restoring a backup into
a scratch database and copying the affected rows forward with explicit SQL, reviewed and audited
by an operator. Never edit rows directly in the production database to "fix" a mistake.

## 5. Recovery objectives

| Objective | Value | Note |
| --- | --- | --- |
| RPO | 24 hours with the daily backup on; better if `backup-now` is run before risky work | no continuous archiving |
| RTO | Provision host + database + restore + verify: measured as **NOT_RUN** locally | depends on dump size and Drive download speed |
| Restore rehearsal | **PASS** for the logical path (`verify-restore`, 4 worker tests) | `pg_dump`/`pg_restore` path **NOT_RUN** (client tools absent in this environment) |

## 6. Failure handling

| Situation | Behaviour |
| --- | --- |
| Drive unavailable | Job `RETRY` with backoff; `backup_log` keeps the failure; the previous artefact is untouched |
| `pg_dump` missing | `backup-now` falls back to the logical archive and records `method: logical`; the scheduled job records the error |
| Wrong encryption key | Decryption fails the auth tag; restore refuses |
| Interrupted upload | No `backup_log` `OK` row is written, so the artefact is not counted as a backup |
| Full disk / temp failure | Temporary directory is removed; the job fails; nothing partial is uploaded |

## 7. What is not covered

* No WAL/continuous archiving, so no second-level RPO.
* No automatic restore. Every restore is an explicit operator action.
* Session rows are not backed up (see §1).
* Google Workspace artefacts (Gmail messages already sent, Calendar events, Drive files) are not
  part of the database backup; Gmail and Calendar remain the system of record for them.
