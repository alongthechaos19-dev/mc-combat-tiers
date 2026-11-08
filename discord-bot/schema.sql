-- One row per /tier result. Peak tiers and cooldowns are worked out from this.
CREATE TABLE IF NOT EXISTS tier_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  mode       TEXT    NOT NULL,
  tier       INTEGER NOT NULL,  -- 0 = tier removed
  prev_tier  INTEGER,           -- what they had before (null = none)
  tester_id  TEXT,
  at         INTEGER NOT NULL   -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_history_user_mode ON tier_history (user_id, mode);

-- Minecraft usernames players set with /username set
CREATE TABLE IF NOT EXISTS usernames (
  user_id  TEXT PRIMARY KEY,
  mc_name  TEXT NOT NULL,
  set_by   TEXT,
  at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usernames_mc ON usernames (mc_name COLLATE NOCASE);

-- One row per finished cooldown we already DMed about
CREATE TABLE IF NOT EXISTS retest_reminders (
  user_id  TEXT    NOT NULL,
  mode     TEXT    NOT NULL,
  test_at  INTEGER NOT NULL,
  sent_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, mode, test_at)
);

-- Small key/value settings (the website announcement)
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Which tester /requesttest assigned to each ticket
CREATE TABLE IF NOT EXISTS test_requests (
  channel_id  TEXT PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  mode        TEXT    NOT NULL,
  tester_id   TEXT    NOT NULL,
  at          INTEGER NOT NULL
);
