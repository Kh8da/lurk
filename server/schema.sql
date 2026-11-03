-- Lurk report server. Apply with:
--   npx wrangler d1 execute lurk --remote --file server/schema.sql

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- 'report' (sent by a person) or 'crash' (sent by the app)
  install_id TEXT NOT NULL,
  version TEXT,
  platform TEXT,
  description TEXT,
  contact TEXT,
  accounts TEXT,                   -- JSON list of Twitch logins, only when the reporter agreed
  summary TEXT,                    -- JSON: app state at the time (no secrets)
  error TEXT,                      -- crash message and stack
  has_log INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new', -- new, seen, fixed, ignored
  note TEXT,                       -- admin's private note
  reply TEXT,                      -- admin's answer, shown in the reporter's app
  replied_at INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS reports_created ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS reports_install ON reports (install_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  secret_hash TEXT,                -- proves later requests come from the same install
  first_seen INTEGER,
  last_seen INTEGER,
  version TEXT,
  platform TEXT,
  accounts INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS installs_seen ON installs (last_seen DESC);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
