-- Calendar synchronisation links (one row per externally projected entity).

CREATE TABLE calendar_links (
  entity_type text NOT NULL CHECK (entity_type IN ('TASK','MILESTONE')),
  entity_id text NOT NULL,
  event_id text NOT NULL,
  sync_hash text NOT NULL DEFAULT '',
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);
