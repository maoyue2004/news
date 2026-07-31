// Logical D1 schema used by Codex Sites. Runtime queries stay in the
// self-contained Worker because this project intentionally has no framework.
export const readerStateTableSql = `
CREATE TABLE IF NOT EXISTS reader_state (
  user_email TEXT NOT NULL,
  item_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_email, item_id)
)`;
