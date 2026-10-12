-- Migration 0003: Move existing unparsed records from transactions to unparsed_transactions

INSERT OR IGNORE INTO unparsed_transactions (id, source_user, sender, raw_message, transaction_date, created_at)
SELECT id, COALESCE(source_user, 'unknown'), sender, raw_message, transaction_date, created_at
FROM transactions
WHERE status = 'UNPARSED';

DELETE FROM transactions WHERE status = 'UNPARSED';

