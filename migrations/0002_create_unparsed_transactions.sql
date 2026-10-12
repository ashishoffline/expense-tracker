-- Migration 0002: Create unparsed_transactions table (Quarantine / Dead-Letter Queue)

CREATE TABLE IF NOT EXISTS unparsed_transactions (
    id TEXT PRIMARY KEY,
    source_user TEXT NOT NULL DEFAULT 'unknown',
    sender TEXT NOT NULL,
    raw_message TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_unparsed_created ON unparsed_transactions(created_at DESC);

