-- Migration 0001: Consolidated Initial Schema & Seed Data
-- Dependency order: accounts -> categories -> transactions -> seeds

-- 1. ACCOUNTS (Credit Cards & Bank Accounts)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,                       -- e.g. 'bob-scapia-visa-1953'
    type TEXT NOT NULL,                        -- 'CREDIT_CARD' | 'BANK_ACCOUNT'
    bank TEXT NOT NULL,                        -- 'BOB', 'HDFC', 'SBI', 'ICICI', 'AXIS', 'HSBC', 'KOTAK', 'IDFC', 'RBL', 'SLICE', 'INDUSIND'
    variant TEXT NOT NULL,                     -- 'Scapia', 'Regalia Gold', '811 Super', etc.
    network TEXT,                              -- 'Visa', 'RuPay', 'Mastercard', 'Amex', 'Diners Club' (or NULL)
    card_last4 TEXT,                           -- 4 digits on card (or NULL if no card)
    account_last4 TEXT,                        -- 4 digits of bank account (or NULL if credit card)
    display_name TEXT NOT NULL,                -- 'BOB Scapia - Visa (1953)'
    status TEXT NOT NULL DEFAULT 'ACTIVE'      -- 'ACTIVE' | 'ARCHIVED'
);

CREATE INDEX IF NOT EXISTS idx_accounts_bank_card ON accounts(bank, card_last4);
CREATE INDEX IF NOT EXISTS idx_accounts_bank_acc ON accounts(bank, account_last4);

-- 2. CATEGORIES (Flat list with clean slug IDs)
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,                       -- 'dining', 'groceries', 'fuel', 'utilities', etc.
    name TEXT NOT NULL UNIQUE,                 -- 'Food & Dining', 'Groceries'
    icon TEXT                                  -- '🍽️', '🛒', '⛽'
);

-- 3. TRANSACTIONS (Ingested SMS & expense records)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,                       -- Deterministic SHA-256 fingerprint
    source_user TEXT,                          -- 'ashish' | 'wife'
    sender TEXT NOT NULL,                      -- e.g. 'VK-HDFCBK', 'AD-SBIINB'
    raw_message TEXT NOT NULL,                 -- Immutable raw SMS text
    transaction_date TEXT NOT NULL,            -- Timestamp from phone / bank SMS
    amount REAL,                               -- Numeric amount (2 decimal places)
    type TEXT DEFAULT 'DEBIT',                 -- 'DEBIT' | 'CREDIT'
    merchant TEXT,                             -- 'Swiggy', 'Amazon', etc.
    account_id TEXT REFERENCES accounts(id),   -- Linked account id
    category TEXT REFERENCES categories(id) DEFAULT 'others', -- Category slug
    method TEXT,                               -- 'CARD' | 'UPI' | 'NETBANKING'
    status TEXT NOT NULL DEFAULT 'UNPARSED',   -- 'UNPARSED' | 'PARSED' | 'ERROR'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_date ON transactions(merchant, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_unparsed ON transactions(status) WHERE status = 'UNPARSED';

-- =========================================================================
-- INITIAL SEEDS
-- =========================================================================

-- Seed Categories (Clean Slugs)
INSERT OR IGNORE INTO categories (id, name, icon) VALUES
    ('dining', 'Food & Dining', '🍽️'),
    ('groceries', 'Groceries', '🛒'),
    ('utilities', 'Bills & Utilities', '💡'),
    ('fuel', 'Fuel', '⛽'),
    ('travel', 'Travel & Transit', '✈️'),
    ('shopping', 'Shopping', '🛍️'),
    ('entertainment', 'Entertainment & Movies', '🎬'),
    ('healthcare', 'Health & Medical', '💊'),
    ('personal_care', 'Personal Care', '💈'),
    ('education', 'Education', '📚'),
    ('rent', 'Rent & Housing', '🏠'),
    ('investments', 'Investments', '📈'),
    ('cc_bill', 'Credit Card Bill', '💳'),
    ('others', 'Others', '📦');

-- Seed Credit Cards (17 cards, Bank = BOB, clean slugs)
INSERT OR IGNORE INTO accounts (id, type, bank, variant, network, card_last4, account_last4, display_name) VALUES
    ('bob-scapia-visa-1953', 'CREDIT_CARD', 'BOB', 'Scapia', 'Visa', '1953', NULL, 'BOB Scapia - Visa (1953)'),
    ('bob-scapia-rupay-6576', 'CREDIT_CARD', 'BOB', 'Scapia', 'RuPay', '6576', NULL, 'BOB Scapia - RuPay (6576)'),
    ('sbi-bpcl-rupay-7978', 'CREDIT_CARD', 'SBI', 'BPCL', 'RuPay', '7978', NULL, 'SBI BPCL - RuPay (7978)'),
    ('hdfc-marriott-diners-4015', 'CREDIT_CARD', 'HDFC', 'Marriott Bonvoy', 'Diners Club', '4015', NULL, 'HDFC Marriott Bonvoy - Diners (4015)'),
    ('hdfc-regalia-gold-visa-2537', 'CREDIT_CARD', 'HDFC', 'Regalia Gold', 'Visa', '2537', NULL, 'HDFC Regalia Gold - Visa (2537)'),
    ('hsbc-live-plus-visa-9832', 'CREDIT_CARD', 'HSBC', 'Live+', 'Visa', '9832', NULL, 'HSBC Live+ - Visa (9832)'),
    ('hdfc-tata-neu-rupay-3907', 'CREDIT_CARD', 'HDFC', 'Tata Neu', 'RuPay', '3907', NULL, 'HDFC Tata Neu - RuPay (3907)'),
    ('indusind-tiger-visa-8987', 'CREDIT_CARD', 'INDUSIND', 'Tiger', 'Visa', '8987', NULL, 'IndusInd Tiger - Visa (8987)'),
    ('sbi-cashback-visa-4126', 'CREDIT_CARD', 'SBI', 'Cashback', 'Visa', '4126', NULL, 'SBI Cashback - Visa (4126)'),
    ('axis-neo-rupay-7966', 'CREDIT_CARD', 'AXIS', 'Neo', 'RuPay', '7966', NULL, 'Axis Neo - RuPay (7966)'),
    ('sbi-irctc-rupay-7080', 'CREDIT_CARD', 'SBI', 'IRCTC', 'RuPay', '7080', NULL, 'SBI IRCTC - RuPay (7080)'),
    ('idfc-first-wealth-visa-1638', 'CREDIT_CARD', 'IDFC', 'First Wealth', 'Visa', '1638', NULL, 'IDFC First Wealth - Visa (1638)'),
    ('icici-sapphiro-amex-3005', 'CREDIT_CARD', 'ICICI', 'Sapphiro', 'Amex', '3005', NULL, 'ICICI Sapphiro - Amex (3005)'),
    ('icici-sapphiro-mc-6003', 'CREDIT_CARD', 'ICICI', 'Sapphiro', 'Mastercard', '6003', NULL, 'ICICI Sapphiro - Mastercard (6003)'),
    ('icici-amazon-pay-visa-0002', 'CREDIT_CARD', 'ICICI', 'Amazon Pay', 'Visa', '0002', NULL, 'Amazon Pay ICICI - Visa (0002)'),
    ('axis-myzone-visa-9376', 'CREDIT_CARD', 'AXIS', 'MyZone', 'Visa', '9376', NULL, 'Axis MyZone - Visa (9376)'),
    ('hdfc-swiggy-mc-9010', 'CREDIT_CARD', 'HDFC', 'Swiggy', 'Mastercard', '9010', NULL, 'Swiggy HDFC - Mastercard (9010)');

-- Seed Bank Accounts & Debit Cards (6 accounts)
INSERT OR IGNORE INTO accounts (id, type, bank, variant, network, card_last4, account_last4, display_name) VALUES
    ('kotak-811-0695', 'BANK_ACCOUNT', 'KOTAK', '811 Super', 'Visa', '2848', '0695', 'Kotak 811 (Acc: 0695 / Debit: 2848)'),
    ('hdfc-bank-0509', 'BANK_ACCOUNT', 'HDFC', 'Savings', 'Mastercard', '5008', '0509', 'HDFC Bank (Acc: 0509 / Debit: 5008)'),
    ('rbl-bank-1799', 'BANK_ACCOUNT', 'RBL', 'Savings', 'Visa', '6719', '1799', 'RBL Bank (Acc: 1799 / Debit: 6719)'),
    ('idfc-first-bank-4870', 'BANK_ACCOUNT', 'IDFC', 'Savings', 'Visa', '2493', '4870', 'IDFC First Bank (Acc: 4870 / Debit: 2493)'),
    ('sbi-bank-6619', 'BANK_ACCOUNT', 'SBI', 'Savings', 'Visa', '5795', '6619', 'SBI Bank (Acc: 6619 / Debit: 5795)'),
    ('slice-account-8007', 'BANK_ACCOUNT', 'SLICE', 'Account', NULL, NULL, '8007', 'Slice Account (8007)');
