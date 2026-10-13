import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const products = [
  // 1. Fresh Milk
  {
    name: 'Cow Milk',
    description: '100% pure, farm-fresh whole cow milk. Milked fresh every morning, gently chilled and delivered straight from farm to family.',
    category: 'Fresh Milk',
    price_paise: 6000,
    selling_unit: '500 ml',
    image_url: 'assets/milvanta-cow-milk.jpg',
    stock_quantity: 150
  },
  {
    name: 'Buffalo Milk',
    description: 'Rich, thick and creamy pure buffalo milk with natural thick malai. Perfect for thick curd, rich morning chai, and traditional homemade sweets.',
    category: 'Fresh Milk',
    price_paise: 7000,
    selling_unit: '500 ml',
    image_url: 'assets/milvanta-buffalo-milk.jpg',
    stock_quantity: 120
  },

  // 2. Dairy Products
  {
    name: 'Paneer',
    description: 'Soft, melt-in-mouth cottage cheese pressed fresh every morning using pure whole milk and lemon curdling. Absolutely zero preservatives or starch.',
    category: 'Dairy Products',
    price_paise: 14000,
    selling_unit: '200 g',
    image_url: 'assets/milvanta-paneer.jpg',
    stock_quantity: 80
  },
  {
    name: 'Curd',
    description: 'Thick, creamy set dahi prepared naturally from pure whole milk with traditional live cultures. Naturally sweet and velvety.',
    category: 'Dairy Products',
    price_paise: 6500,
    selling_unit: '400 g',
    image_url: 'assets/milvanta-curd.jpg',
    stock_quantity: 90
  },
  {
    name: 'Ghee',
    description: 'Traditional Vedic bilona churned curd ghee made from pure cow milk cream in earthen pots. Golden, granular texture with an intensely aromatic aroma.',
    category: 'Dairy Products',
    price_paise: 110000,
    selling_unit: '500 ml',
    image_url: 'assets/milvanta-ghee.jpg',
    stock_quantity: 60
  },

  // 3. Baking Essentials
  {
    name: 'Walnut Raagi Brownie',
    description: 'Height 1 inch, 3×3 inch piece. Made with alkaline-free cocoa sourced directly from Godavari fields, organic whole wheat flour (carrying 9 g protein in 200 g of flour), and low-glycemic brown sugar, topped with walnut slices.',
    category: 'Baking Essentials',
    price_paise: 29900,
    selling_unit: '1 Piece (3×3 in)',
    image_url: 'assets/walnut-raagi-brownie.jpg',
    stock_quantity: 50
  },
  {
    name: 'Butter Cake with Couverture Chocolate Chips',
    description: 'Made with organic whole wheat, butter, and rich couverture chocolate chips. 250 grams artisan loaf with pure farm butter.',
    category: 'Baking Essentials',
    price_paise: 35000,
    selling_unit: '250 g cake',
    image_url: 'assets/butter-cake.jpg',
    stock_quantity: 40
  },
  {
    name: 'Kowa Cake',
    description: 'Height 1 inch with 3×3 inch piece. Made with fresh Kowa, organic whole wheat, butter, low-glycemic brown sugar, and fragrant elaichi, topped with almond flakes.',
    category: 'Baking Essentials',
    price_paise: 15000,
    selling_unit: '1 Piece (3×3 in)',
    image_url: 'assets/kowa-cake.jpg',
    stock_quantity: 45
  },

  // 4. Healthy Living
  {
    name: 'Raagi Cookies',
    description: 'Healthy option from kids to adults. Made with pure A2 Belona ghee, organic Raagi, whole wheat flour, and organic jaggery, topped with 5 types of nuts and seeds (pumpkin seeds, cashew, almonds, sunflower, melon seeds). 250 grams tin containing 17 cookies in complete box.',
    category: 'Healthy Living',
    price_paise: 55000,
    selling_unit: '250 g tin (17 cookies)',
    image_url: 'assets/raagi-cookies.jpg',
    stock_quantity: 55
  },
  {
    name: 'Muesli',
    description: 'Made with premium rolled oats, 5 types of nuts, seeds, and dry fruits (almonds, pumpkin seeds, flax seeds, melon seeds, raisins, cranberries, watermelon seeds, sunflower seeds), pure coconut oil, and organic jaggery or honey. 250 grams.',
    category: 'Healthy Living',
    price_paise: 45000,
    selling_unit: '250 g',
    image_url: 'assets/muesli.jpg',
    stock_quantity: 65
  },

  // 5. Vegetarian Pickles
  {
    name: 'Traditional Tomato Pickle',
    description: 'Classic tangy and spiced sun-cured tomato pickle seasoned with mustard seeds, fenugreek, garlic, and cold-pressed sesame oil.',
    category: 'Indian Pickles',
    price_paise: 47900,
    selling_unit: '500 g jar',
    image_url: 'assets/vegetarian-pickles-menu.jpg',
    stock_quantity: 60
  },
  {
    name: 'Andhra Gongura Pickle',
    description: 'The legendary tangy and fiery sorrel leaf relish of Andhra. Slow cooked with whole red chillies, garlic, and fragrant spices in wood-pressed oil.',
    category: 'Indian Pickles',
    price_paise: 49900,
    selling_unit: '500 g jar',
    image_url: 'assets/vegetarian-pickles-menu.jpg',
    stock_quantity: 60
  },
  {
    name: 'Usirikaya Pickle (Amla)',
    description: 'Whole Indian gooseberries packed with natural Vitamin C, slow-cured in aromatic roasted spices and cold-pressed gingelly oil.',
    category: 'Indian Pickles',
    price_paise: 49900,
    selling_unit: '500 g jar',
    image_url: 'assets/vegetarian-pickles-menu.jpg',
    stock_quantity: 50
  },
  {
    name: 'Pandu Mirchi Pickle',
    description: 'Vibrant and fiery ripe red pepper pickle hand-pounded with sour tamarind and toasted cumin-fenugreek powder.',
    category: 'Indian Pickles',
    price_paise: 48900,
    selling_unit: '500 g jar',
    image_url: 'assets/vegetarian-pickles-menu.jpg',
    stock_quantity: 55
  },
  {
    name: 'Avakaya Mango Pickle',
    description: 'The crown jewel of South Indian relishes: crisp green raw mango chunks cured with pungent mustard powder, fiery chillies, and cold-pressed oil.',
    category: 'Indian Pickles',
    price_paise: 44900,
    selling_unit: '500 g jar',
    image_url: 'assets/vegetarian-pickles-menu.jpg',
    stock_quantity: 70
  },

  // 6. Non-Vegetarian Pickles
  {
    name: 'Chicken Pickle (Bone)',
    description: 'Classic spicy bone-in chicken pickle slow-fried in cold-pressed oil with freshly roasted whole spices, garlic, and curry leaves.',
    category: 'Indian Pickles',
    price_paise: 35900,
    selling_unit: '250 g jar',
    image_url: 'assets/non-vegetarian-pickles-menu.jpg',
    stock_quantity: 45
  },
  {
    name: 'Chicken Pickle (Boneless)',
    description: 'Tender succulent boneless chicken chunks marinated in aromatic spices, fried to perfection, and pickled in cold-pressed oil with curry leaves and garlic.',
    category: 'Indian Pickles',
    price_paise: 39900,
    selling_unit: '250 g jar',
    image_url: 'assets/milvanta-meat-pickles-menu.png',
    stock_quantity: 50
  },
  {
    name: 'Mutton Pickle (Bone)',
    description: 'Rich, aromatic bone-in mutton pickle prepared with selected tender mutton cuts, cloves, cinnamon, garlic, and wood-pressed oil.',
    category: 'Indian Pickles',
    price_paise: 54900,
    selling_unit: '250 g jar',
    image_url: 'assets/non-vegetarian-pickles-menu.jpg',
    stock_quantity: 35
  }
];

export async function seedProducts(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clean up outdated product names from earlier draft seeds
    await client.query(`
      DELETE FROM products
      WHERE name IN (
        'Artisanal Muesli',
        'Gongura Pickle',
        'Boneless Chicken Pickle',
        'Mutton Pickle'
      )
    `);

    for (const p of products) {
      const existing = await client.query('SELECT id FROM products WHERE LOWER(name) = LOWER($1)', [p.name]);
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO products (name, description, category, price_paise, selling_unit, image_url, stock_quantity, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())`,
          [p.name, p.description, p.category, p.price_paise, p.selling_unit, p.image_url, p.stock_quantity]
        );
        console.log(`Inserted product: ${p.name}`);
      } else {
        await client.query(
          `UPDATE products
           SET description = $2,
               category = $3,
               price_paise = $4,
               selling_unit = $5,
               image_url = $6,
               stock_quantity = $7,
               active = TRUE,
               updated_at = NOW()
           WHERE id = $1`,
          [existing.rows[0].id, p.description, p.category, p.price_paise, p.selling_unit, p.image_url, p.stock_quantity]
        );
        console.log(`Updated product: ${p.name}`);
      }
    }

    await client.query('COMMIT');
    console.log(`Seed completed: ${products.length} products verified in database.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to seed products:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
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

  const isRender = Boolean(normalizedDbUrl && normalizedDbUrl.includes('render.com'));
  const testPool = new Pool({
    connectionString: normalizedDbUrl,
    ssl: isRender ? { rejectUnauthorized: false } : (process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false })
  });

  try {
    await seedProducts(testPool);
    await testPool.end();
    process.exit(0);
  } catch (err) {
    await testPool.end();
    process.exit(1);
  }
}
