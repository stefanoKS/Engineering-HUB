-- Local LAN identities; existing Google bindings and member IDs remain unchanged.
ALTER TABLE members ALTER COLUMN email DROP NOT NULL;
CREATE TABLE local_accounts (
 member_id text PRIMARY KEY REFERENCES members(member_id),
 employee_id text NOT NULL UNIQUE CHECK (employee_id ~ '^[A-Za-z0-9_-]{1,32}$'),
 password_hash text NOT NULL,
 must_change_password boolean NOT NULL DEFAULT true,
 password_version integer NOT NULL DEFAULT 1,
 failed_attempts integer NOT NULL DEFAULT 0,
 locked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ADD COLUMN local_password_version integer;
