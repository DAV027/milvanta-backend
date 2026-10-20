import 'dotenv/config';
import pg from 'pg';

const rawDbUrl = (
  process.env.DATABASE_URL ||
  process.env.INTERNAL_DATABASE_URL ||
  process.env.EXTERNAL_DATABASE_URL ||
  process.env.POSTGRES_URL
)?.trim().replace(/^["']|["']$/g, '');

let normalizedDbUrl = rawDbUrl;
if (normalizedDbUrl) {
  try {
    const parsed = new URL(normalizedDbUrl);
    if (parsed.hostname.startsWith('dpg-') && !parsed.hostname.includes('.')) {
      parsed.hostname = `${parsed.hostname}.oregon-postgres.render.com`;
      normalizedDbUrl = parsed.toString();
    }
  } catch (_) {}
}

const pool = new pg.Pool({
  connectionString: normalizedDbUrl,
  ssl: { rejectUnauthorized: false }
});

async function updateDairyProducts() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update Paneer
    await client.query(`
      UPDATE products
      SET name = 'Paneer',
          price_paise = 40000,
          selling_unit = '500 g pack',
          image_url = 'assets/milvanta-paneer.jpg',
          description = 'Soft, melt-in-mouth cottage cheese pressed fresh every morning using pure whole milk and lemon curdling. Absolutely zero preservatives or starch.',
          active = TRUE,
          updated_at = NOW()
      WHERE id = 3 OR name ILIKE '%paneer%'
    `);
    console.log('✓ Updated Paneer in database to ₹400 (500 g)');

    // 2. Update Pot Curd
    await client.query(`
      UPDATE products
      SET name = 'Pot Curd',
          price_paise = 4900,
          selling_unit = '200 g pot',
          image_url = 'assets/milvanta-curd.jpg?v=2',
          description = 'Thick, creamy set dahi prepared naturally in traditional earthen pots from pure whole milk with live cultures. Naturally sweet, probiotic-rich and velvety.',
          active = TRUE,
          updated_at = NOW()
      WHERE id = 4 OR name = 'Curd' OR name ILIKE '%pot curd%'
    `);
    console.log('✓ Updated Pot Curd in database to ₹49 (200 g)');

    // 3. Update Pure Cow Ghee
    await client.query(`
      UPDATE products
      SET name = 'Pure Cow Ghee',
          price_paise = 150000,
          selling_unit = '500 g jar',
          image_url = 'assets/milvanta-cow-ghee.jpg',
          description = 'Traditional Vedic bilona churned curd ghee made from pure A2 cow milk cream in earthen pots. Golden, granular texture with an intensely aromatic aroma.',
          active = TRUE,
          updated_at = NOW()
      WHERE id = 5 OR name = 'Ghee' OR name ILIKE '%cow ghee%'
    `);
    console.log('✓ Updated Pure Cow Ghee in database to ₹1500 (500 g)');

    // 4. Ensure Pure Buffalo Ghee exists
    const bufCheck = await client.query(`SELECT id FROM products WHERE name ILIKE '%buffalo ghee%'`);
    if (bufCheck.rows.length > 0) {
      await client.query(`
        UPDATE products
        SET name = 'Pure Buffalo Ghee',
            price_paise = 110000,
            selling_unit = '500 g jar',
            image_url = 'assets/milvanta-buffalo-ghee.jpg',
            description = 'Authentic slow-simmered pure buffalo ghee with luscious, thick ivory-white grains and authentic aroma. High natural milk fats, perfect for traditional Indian cooking and sweets.',
            category = 'Dairy Products',
            active = TRUE,
            updated_at = NOW()
        WHERE id = $1
      `, [bufCheck.rows[0].id]);
      console.log('✓ Updated existing Pure Buffalo Ghee in database to ₹1100 (500 g)');
    } else {
      await client.query(`
        INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active)
        VALUES ('Pure Buffalo Ghee', 'Authentic slow-simmered pure buffalo ghee with luscious, thick ivory-white grains and authentic aroma. High natural milk fats, perfect for traditional Indian cooking and sweets.', 'Dairy Products', 110000, '500 g jar', 'assets/milvanta-buffalo-ghee.jpg', 60, TRUE)
      `);
      console.log('✓ Inserted Pure Buffalo Ghee into database at ₹1100 (500 g)');
    }

    await client.query('COMMIT');

    const res = await client.query(`
      SELECT id, name, category, price_paise, selling_unit, image_url FROM products
      WHERE category = 'Dairy Products'
      ORDER BY id
    `);
    console.log('\nVerified DB Dairy Products:');
    console.table(res.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating database:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

updateDairyProducts();

