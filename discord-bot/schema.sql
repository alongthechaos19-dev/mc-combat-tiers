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
