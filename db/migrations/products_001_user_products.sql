-- products-db, 2026-11-15: products added by users (site form) and their photos.
-- Run once: npx wrangler d1 execute products-db --remote --file db/migrations/products_001_user_products.sql
-- (a full rebuild with npm run products already has these columns and the table)
ALTER TABLE products ADD COLUMN origin TEXT NOT NULL DEFAULT 'off';
ALTER TABLE products ADD COLUMN photos TEXT;
CREATE TABLE IF NOT EXISTS user_products (
    code TEXT PRIMARY KEY,            -- barcode (EAN-13, UPC-A, EAN-8 ...); user products without one: 29 + 11 digits
    name TEXT NOT NULL, generic_name TEXT, brand TEXT, quantity TEXT,
    category TEXT NOT NULL, off_category TEXT,
    markets TEXT NOT NULL,            -- ',HK,JP,' (leading/trailing comma, for LIKE '%,HK,%')
    countries TEXT,                   -- all "sold in" countries, English
    image TEXT, nutriscore TEXT, nova INTEGER,
    serving_size TEXT, serving_g REAL,
    energy_kcal REAL, protein REAL, fat REAL, carbohydrate REAL, sugars REAL, fibre REAL, sodium REAL,
    nutrients TEXT NOT NULL,          -- JSON {nutrient id: value} per 100 g / 100 ml
    has_nutrition INTEGER NOT NULL,
    ingredients TEXT, allergens TEXT, traces TEXT, labels TEXT,
    scans INTEGER NOT NULL,           -- unique scans on Open Food Facts (popularity)
    last_modified TEXT,
    search_text TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'off',
    photos TEXT,
    created TEXT NOT NULL
) WITHOUT ROWID;
