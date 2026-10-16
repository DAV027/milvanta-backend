-- Migration 007: Update non-vegetarian pickle base prices (500 g jar) and selling units
UPDATE products
SET price_paise = 84900,
    selling_unit = '500 g jar',
    updated_at = NOW()
WHERE LOWER(name) = LOWER('Chicken Pickle (Boneless)');

UPDATE products
SET price_paise = 114900,
    selling_unit = '500 g jar',
    updated_at = NOW()
WHERE LOWER(name) = LOWER('Mutton Pickle (Boneless)');

UPDATE products
SET price_paise = 104900,
    selling_unit = '500 g jar',
    updated_at = NOW()
WHERE LOWER(name) IN (LOWER('Prawns Pickle'), LOWER('Prawn Pickle'));

UPDATE products
SET price_paise = 104900,
    selling_unit = '500 g jar',
    updated_at = NOW()
WHERE LOWER(name) IN (LOWER('Fish Pickle (Boneless)'), LOWER('Fish Pickle'));

UPDATE products
SET price_paise = 114900,
    selling_unit = '500 g jar',
    updated_at = NOW()
WHERE LOWER(name) = LOWER('Gongura Chicken (Boneless)');

UPDATE products
SET price_paise = 119900,
    selling_unit = '500 g jar',
    updated_at = NOW()
WHERE LOWER(name) = LOWER('Gongura Mutton (Boneless)');

