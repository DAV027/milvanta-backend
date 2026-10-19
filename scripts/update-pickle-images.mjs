import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function updateDbImages() {
  await pool.query(`
    UPDATE products SET image_url = 'assets/tomato-pickle.jpg' WHERE name ILIKE '%tomato%pickle%';
    UPDATE products SET image_url = 'assets/pandu-mirchi-pickle.jpg' WHERE name ILIKE '%pandu%mirchi%';
    UPDATE products SET image_url = 'assets/gongura-pickle.jpg' WHERE name ILIKE '%andhra%gongura%';
    UPDATE products SET image_url = 'assets/usirikaya-pickle.jpg' WHERE name ILIKE '%usirikaya%';
    UPDATE products SET image_url = 'assets/avakaya-mango-pickle.jpg' WHERE name ILIKE '%avakaya%';
    UPDATE products SET image_url = 'assets/chicken-pickle-boneless.jpg' WHERE name ILIKE '%chicken%pickle%';
    UPDATE products SET image_url = 'assets/mutton-pickle-boneless.jpg' WHERE name ILIKE '%mutton%pickle%';
    UPDATE products SET image_url = 'assets/prawns-pickle.jpg' WHERE name ILIKE '%prawn%';
    UPDATE products SET image_url = 'assets/fish-pickle-boneless.jpg' WHERE name ILIKE '%fish%pickle%';
    UPDATE products SET image_url = 'assets/gongura-chicken-pickle.jpg' WHERE name ILIKE '%gongura%chicken%';
    UPDATE products SET image_url = 'assets/gongura-mutton-pickle.jpg' WHERE name ILIKE '%gongura%mutton%';
  `);

  const { rows } = await pool.query(`
    SELECT id, name, image_url FROM products WHERE category = 'Indian Pickles' ORDER BY id ASC
  `);
  console.log('Updated Pickles in DB:');
  rows.forEach(r => console.log(`  id: ${r.id} | ${r.name} -> ${r.image_url}`));
  await pool.end();
}

updateDbImages().catch(err => {
  console.error(err);
  process.exit(1);
});

