-- Migration 0006: Add exclude column to transactions table

ALTER TABLE transactions ADD COLUMN exclude INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_transactions_exclude ON transactions(exclude);

