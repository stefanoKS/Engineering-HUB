-- Member-created work and requester identity.
--
-- Additive only: existing rows keep their meaning (LEGACY channel, no recorded requester), no
-- column is rewritten, and a member-created task is distinguished so its completion can require
-- an administrator decision.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by_member_id text REFERENCES members(member_id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS creation_channel text NOT NULL DEFAULT 'LEGACY'
  CHECK (creation_channel IN ('LEGACY','MANAGER','MEMBER'));

ALTER TABLE task_requests ADD COLUMN IF NOT EXISTS requester_member_id text REFERENCES members(member_id);

CREATE INDEX IF NOT EXISTS tasks_creation_channel_idx ON tasks (creation_channel) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_requests_requester_idx ON task_requests (requester_member_id, submitted_at DESC);
