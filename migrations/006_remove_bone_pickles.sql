-- Migration 006: Permanently remove pickles with bone and insert missing boneless non-veg pickles

DELETE FROM products
WHERE name IN (
  'Chicken Pickle (Bone)',
  'Mutton Pickle (Bone)'
) OR (name ILIKE '%pickle%bone%' AND name NOT ILIKE '%boneless%');

-- Ensure remaining boneless meat pickles exist with correct categories
INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active, created_at, updated_at)
SELECT 'Mutton Pickle (Boneless)', 'Succulent boneless mutton chunks slow-cured in traditional cold-pressed oil, ginger-garlic paste, and aromatic spices.', 'Indian Pickles', 69900, '250 g jar', 'assets/non-vegetarian-pickles-menu.jpg', 40, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(name) = LOWER('Mutton Pickle (Boneless)'));

INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active, created_at, updated_at)
SELECT 'Prawns Pickle', 'Juicy coastal prawns slow-cured with ground mustard, fenugreek, and cold-pressed gingelly oil.', 'Indian Pickles', 59900, '250 g jar', 'assets/non-vegetarian-pickles-menu.jpg', 35, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(name) = LOWER('Prawns Pickle'));

INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active, created_at, updated_at)
SELECT 'Fish Pickle (Boneless)', 'Delicate boneless fish fillets slow-cured in wood-pressed sesame oil, fresh ginger, garlic, and curry leaves.', 'Indian Pickles', 54900, '250 g jar', 'assets/non-vegetarian-pickles-menu.jpg', 30, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(name) = LOWER('Fish Pickle (Boneless)'));

INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active, created_at, updated_at)
SELECT 'Gongura Chicken (Boneless)', 'Signature Andhra sorrel leaves slow-cooked with tender boneless chicken chunks and byadagi chillies.', 'Indian Pickles', 44900, '250 g jar', 'assets/non-vegetarian-pickles-menu.jpg', 40, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(name) = LOWER('Gongura Chicken (Boneless)'));

INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active, created_at, updated_at)
SELECT 'Gongura Mutton (Boneless)', 'Tangy wild gongura leaves paired with tender boneless mutton cuts and fragrant wood-pressed oil.', 'Indian Pickles', 74900, '250 g jar', 'assets/non-vegetarian-pickles-menu.jpg', 30, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(name) = LOWER('Gongura Mutton (Boneless)'));

