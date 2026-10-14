-- Migration 0005: Add Clothing & Fashion category

INSERT OR IGNORE INTO categories (id, name, icon) VALUES
    ('clothing', 'Clothing & Fashion', '👗');

