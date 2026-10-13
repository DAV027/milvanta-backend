import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const products = [
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
    description: 'Golden, tender sliced artisan butter cake loaf with organic whole wheat, pure butter, and rich couverture chocolate chips.',
    category: 'Baking Essentials',
    price_paise: 35000,
    selling_unit: '250 g cake',
    image_url: 'assets/butter-cake.jpg',
    stock_quantity: 40
  },
  {
    name: 'Kowa Cake',
    description: 'Height 1 inch, 3×3 inch piece. Made with fresh Kowa, organic whole wheat, butter, low-glycemic brown sugar, and fragrant Elaichi, topped with slivered almond flakes.',
    category: 'Baking Essentials',
    price_paise: 15000,
    selling_unit: '1 Piece (3×3 in)',
    image_url: 'assets/kowa-cake.jpg',
    stock_quantity: 45
  },
  {
    name: 'Raagi Cookies',
    description: 'Healthy option from kids to adults. Made with pure A2 Bilona ghee, organic Raagi, whole wheat flour, and organic jaggery, topped with 5 types of nuts and seeds (pumpkin seeds, cashew, almonds, sunflower, melon seeds). 17 cookies in complete box.',
    category: 'Healthy Living',
    price_paise: 55000,
    selling_unit: '250 g tin',
    image_url: 'assets/raagi-cookies.jpg',
    stock_quantity: 55
  },
  {
    name: 'Artisanal Muesli',
    description: 'Made with premium rolled oats, 5 types of nuts, seeds, and dry fruits (almonds, pumpkin seeds, flax seeds, melon seeds, raisins, cranberries, watermelon seeds, sunflower seeds), pure coconut oil, and organic jaggery or honey.',
    category: 'Healthy Living',
    price_paise: 45000,
    selling_unit: '250 g',
    image_url: 'assets/artisanal-muesli.jpg',
    stock_quantity: 65
  },
  {
    name: 'Avakaya Mango Pickle',
    description: 'Traditional authentic Andhra Avakaya pickle made with hand-cut raw mangoes, freshly ground mustard, fiery red chillies, and cold-pressed gingelly oil.',
    category: 'Indian Pickles',
    price_paise: 25000,
    selling_unit: '300 g jar',
    image_url: 'assets/vegetarian-pickles-menu.jpg',
    stock_quantity: 70
  },
  {
    name: 'Gongura Pickle',
    description: 'Traditional Andhra Gongura Pachadi prepared with fresh organic sorrel leaves, roasted spices, and wood-pressed oil.',
    category: 'Indian Pickles',
    price_paise: 22000,
    selling_unit: '300 g jar',
    image_url: 'assets/vegetarian-pickles-menu.jpg',
    stock_quantity: 70
  },
  {
    name: 'Boneless Chicken Pickle',
    description: 'Succulent boneless chicken chunks marinated in aromatic spices, fried to perfection, and pickled in cold-pressed oil with curry leaves and garlic.',
    category: 'Indian Pickles',
    price_paise: 45000,
    selling_unit: '250 g jar',
    image_url: 'assets/boneless-chicken-mutton-pickle.jpg',
    stock_quantity: 40
  },
  {
    name: 'Mutton Pickle',
    description: 'Tender mutton boneless cubes slow-cooked in traditional heritage spices, ginger-garlic paste, and aromatic gingelly oil.',
    category: 'Indian Pickles',
    price_paise: 58000,
    selling_unit: '250 g jar',
    image_url: 'assets/boneless-chicken-mutton-pickle.jpg',
    stock_quantity: 35
  }
];

export async function seedProducts(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
           SET description = $2, category = $3, price_paise = $4, selling_unit = $5, image_url = $6, stock_quantity = $7, active = TRUE, updated_at = NOW()
           WHERE id = $1`,
          [existing.rows[0].id, p.description, p.category, p.price_paise, p.selling_unit, p.image_url, p.stock_quantity]
        );
        console.log(`Updated product: ${p.name}`);
      }
    }
    await client.query('COMMIT');
    console.log(`Seeding complete: ${products.length} products verified in database.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await seedProducts(pool);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    await pool.end();
    process.exit(1);
  }
}

