-- 0006: stable Google identity binding and crash-safe delivery attempts.
--
-- Additive only. Existing members keep working: a member is linked to its Google subject on the
-- first verified sign-in, and the link is recorded in AUDIT_LOG. No existing value is rewritten.

ALTER TABLE members ADD COLUMN google_subject text;

CREATE UNIQUE INDEX members_google_subject_idx
  ON members (google_subject)
  WHERE google_subject IS NOT NULL;

-- A worker lease now carries an unguessable token. Complete/fail/renew only affect the job while
-- that token still owns the lease, so a worker whose lease expired cannot overwrite a newer one.
ALTER TABLE outbox_jobs ADD COLUMN lease_token text NOT NULL DEFAULT '';

-- Delivery attempts are durable before the external call, so a crash is distinguishable from a
-- definitely-not-sent failure and an ambiguous acceptance is never retried automatically.
ALTER TABLE notification_ledger
  ADD COLUMN attempt_id text NOT NULL DEFAULT '',
  ADD COLUMN attempt_started_at timestamptz,
  ADD COLUMN attempt_owner text NOT NULL DEFAULT '',
  ADD COLUMN uncertain_at timestamptz;

CREATE INDEX notification_ledger_attempt_idx
  ON notification_ledger (result, attempt_started_at);

-- SENDING is the durable attempt state: written before Gmail is contacted, so an interrupted
-- attempt is reconciled to DELIVERY_UNCERTAIN instead of being retried blindly.
ALTER TABLE notification_ledger DROP CONSTRAINT notification_ledger_result_check;
ALTER TABLE notification_ledger
  ADD CONSTRAINT notification_ledger_result_check
  CHECK (result IN ('PENDING','SENDING','SENT','PREVIEW','DELIVERY_UNCERTAIN','FAILED','SKIPPED'));
