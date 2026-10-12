-- Migration 0004: Rebuild transactions table with strict NOT NULL constraints and remove status column

-- 1. Create transactions_new with strict NOT NULL constraints
CREATE TABLE transactions_new (
    id TEXT PRIMARY KEY,
    source_user TEXT NOT NULL DEFAULT 'unknown',
    sender TEXT NOT NULL,
    raw_message TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL DEFAULT 'DEBIT',
    merchant TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    category TEXT NOT NULL DEFAULT 'others' REFERENCES categories(id),
    method TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copy parsed records into transactions_new
INSERT INTO transactions_new (
    id, source_user, sender, raw_message, transaction_date,
    amount, type, merchant, account_id, category, method, created_at
)
SELECT 
    id, 
    COALESCE(source_user, 'unknown'), 
    sender, 
    raw_message, 
    transaction_date,
    amount, 
    COALESCE(type, 'DEBIT'), 
    merchant, 
    account_id, 
    COALESCE(category, 'others'), 
    method, 
    created_at
FROM transactions
WHERE amount IS NOT NULL AND merchant IS NOT NULL;

-- 3. Swap tables
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- 4. Rebuild indexes
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_date ON transactions(merchant, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, transaction_date);

