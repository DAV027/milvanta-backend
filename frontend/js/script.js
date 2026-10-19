const categories = [
  { name: 'All', image: '' },
  { name: 'Fresh Milk', label: 'Pure Fresh Milk', image: 'assets/milvanta-cow-milk.jpg' },
  { name: 'Dairy Products', image: 'assets/milvanta-paneer.jpg' },
  { name: 'Baking Essentials', image: 'assets/walnut-raagi-brownie.jpg' },
  { name: 'Healthy Living', image: 'assets/raagi-cookies.jpg' },
  { name: 'Indian Pickles', image: 'assets/vegetarian-pickles-menu.jpg' }
];

// Rich fallback catalog with complete photography, dietary flags, and ratings
let products = [
  // Fresh Milk & Dairy
  {
    id: 101,
    name: 'Cow Milk',
    shortName: 'Cow Milk',
    category: 'Fresh Milk',
    price: 60,
    size: '500 ml pouch',
    quantity: '500 ml · 1 L available',
    description: '100% pure, farm-fresh whole cow milk. Milked fresh every morning, gently chilled and delivered straight from farm to family.',
    ingredients: ['100% Pure Cow Milk'],
    image: 'assets/milvanta-cow-milk.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 312,
    badge: 'Subscription Available',
    variants: [
      { size: '500 ml', price: 60 },
      { size: '1 Litre', price: 110 }
    ],
    details: 'Milked at 4:00 AM, tested for 18 purity parameters, and chilled to 3.8°C within 60 minutes.'
  },
  {
    id: 102,
    name: 'Buffalo Milk',
    shortName: 'Buffalo Milk',
    category: 'Fresh Milk',
    price: 70,
    size: '500 ml bottle',
    quantity: '500 ml · 1 L available',
    description: 'Rich, thick and creamy pure buffalo milk with natural thick malai. Perfect for thick curd, rich morning chai, and traditional homemade sweets.',
    ingredients: ['100% Pure Buffalo Milk'],
    image: 'assets/milvanta-buffalo-milk.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 240,
    badge: 'Subscription Available',
    variants: [
      { size: '500 ml', price: 70 },
      { size: '1 Litre', price: 130 }
    ],
    details: 'High natural milk-fat (7.5%+), dense nutrition, and rich texture.'
  },
  {
    id: 104,
    name: 'Paneer',
    shortName: 'Paneer',
    category: 'Dairy Products',
    price: 400,
    size: '500 g pack',
    quantity: '500 g · 1 kg available',
    description: 'Soft, melt-in-mouth cottage cheese pressed fresh every morning using pure whole milk and lemon curdling. Absolutely zero preservatives or starch.',
    ingredients: ['Pure Whole Cow Milk', 'Natural Curdling'],
    image: 'assets/milvanta-paneer.jpg',
    isVeg: true,
    rating: 4.8,
    reviewsCount: 96,
    badge: 'Made Daily',
    variants: [
      { size: '500 g', price: 400 },
      { size: '1 kg', price: 750 }
    ],
    details: 'Vacuum packed fresh daily. Consume within 4 days of delivery.'
  },
  {
    id: 105,
    name: 'Pot Curd',
    shortName: 'Pot Curd',
    category: 'Dairy Products',
    price: 49,
    size: '200 g pot',
    quantity: '200 g to 6 kg available',
    description: 'Thick, creamy set dahi prepared naturally in traditional earthen pots from pure whole milk with live cultures. Naturally sweet, probiotic-rich and velvety.',
    ingredients: ['Pure Pasteurized Whole Milk', 'Active Lactic Cultures'],
    image: 'assets/milvanta-curd.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 168,
    badge: 'Clay Pot Set',
    variants: [
      { size: '200 g', price: 49 },
      { size: '500 g', price: 99 },
      { size: '1 kg', price: 169 },
      { size: '3 kg', price: 499 },
      { size: '6 kg', price: 799 }
    ],
    details: 'Naturally fermented and set in traditional food-grade earthen pots. Keep chilled at <4°C.'
  },
  {
    id: 103,
    name: 'Pure Cow Ghee',
    shortName: 'Cow Ghee',
    category: 'Dairy Products',
    price: 1500,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Traditional Vedic bilona churned curd ghee made from pure A2 cow milk cream in earthen pots. Golden, granular texture with an intensely aromatic aroma.',
    ingredients: ['Pure A2 Cow Milk Curd Cream'],
    image: 'assets/milvanta-cow-ghee.jpg',
    isVeg: true,
    rating: 5.0,
    reviewsCount: 184,
    badge: 'A2 Vedic Bilona',
    variants: [
      { size: '500 g', price: 1500 },
      { size: '1 kg', price: 2800 }
    ],
    details: 'Slow-simmered over low flame. Naturally rich in butyric acid and gut-friendly fats.'
  },
  {
    id: 106,
    name: 'Pure Buffalo Ghee',
    shortName: 'Buffalo Ghee',
    category: 'Dairy Products',
    price: 1100,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Authentic slow-simmered pure buffalo ghee with luscious, thick ivory-white grains and authentic aroma. High natural milk fats, perfect for traditional Indian cooking and sweets.',
    ingredients: ['Pure Whole Buffalo Milk Cream'],
    image: 'assets/milvanta-buffalo-ghee.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 142,
    badge: 'Granular Bilona',
    variants: [
      { size: '500 g', price: 1100 },
      { size: '1 kg', price: 2000 }
    ],
    details: 'Crafted with slow-fire wood-stove simmering. Rich in healthy fats and dense nourishment.'
  },

  // Bakery Essentials
  {
    id: 1,
    name: 'Walnut Raagi Brownie',
    shortName: 'Walnut Brownie',
    category: 'Baking Essentials',
    price: 299,
    size: '1 Piece',
    quantity: '3 × 3 in · 1 in height',
    description: 'Made with alkaline-free cocoa sourced directly from Godavari fields, organic whole wheat flour (carrying 9 g protein in 200 g of flour), and low-glycemic brown sugar, topped with walnut slices.',
    ingredients: ['Alkaline-free Godavari cocoa', 'Organic whole wheat flour', 'Organic Raagi', 'Low-glycemic brown sugar', 'Pure butter', 'Walnut slices'],
    image: 'assets/walnut-raagi-brownie.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 145,
    badge: 'Bestseller',
    details: 'Height 1 inch, 3 × 3 inch piece. Wholesome protein-rich recipe with zero refined flour or maida.'
  },
  {
    id: 2,
    name: 'Butter Cake with Couverture Chocolate Chips',
    shortName: 'Butter Cake',
    category: 'Baking Essentials',
    price: 350,
    size: '250 g',
    quantity: '250 g cake',
    description: 'Made with organic whole wheat, butter, and rich couverture chocolate chips.',
    ingredients: ['Organic whole wheat flour', 'Pure butter', 'Couverture chocolate chips'],
    image: 'assets/butter-cake.jpg',
    isVeg: true,
    rating: 4.8,
    reviewsCount: 88,
    badge: 'Chef Special',
    details: '250 grams cake. Made with 100% organic whole wheat and pure butter.'
  },
  {
    id: 3,
    name: 'Kowa Cake',
    shortName: 'Kowa Cake',
    category: 'Baking Essentials',
    price: 150,
    size: '1 Piece',
    quantity: '3 × 3 in · 1 in height',
    description: 'Made with Kowa, organic whole wheat, butter, low-glycemic brown sugar, and fragrant elaichi, topped with almond flakes.',
    ingredients: ['Fresh Kowa', 'Organic whole wheat flour', 'Butter', 'Low-glycemic brown sugar', 'Elaichi', 'Almond flakes'],
    image: 'assets/kowa-cake.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 112,
    badge: 'Traditional',
    details: 'Height 1 inch with 3 × 3 inch piece. Traditional Kowa delicacy.'
  },

  // Healthy Living
  {
    id: 4,
    name: 'Raagi Cookies',
    shortName: 'Raagi Cookies',
    category: 'Healthy Living',
    price: 550,
    size: '250 g tin',
    quantity: '17 cookies in complete box',
    description: 'A healthy option from kids to adults. Made with pure Desi Belona ghee, organic Raagi, whole wheat flour, and organic jaggery, topped with 5 types of nuts and seeds like pumpkin seeds, cashew, almonds, sunflower, and melon seeds.',
    ingredients: ['Organic Raagi', 'Whole wheat flour', 'Pure Desi Belona ghee', 'Organic jaggery', 'Pumpkin seeds', 'Cashews', 'Almonds', 'Sunflower seeds', 'Melon seeds'],
    image: 'assets/raagi-cookies.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 204,
    badge: 'Kid Approved',
    details: '250 grams tin containing 17 cookies in complete box. Maida-free and refined sugar-free.'
  },
  {
    id: 5,
    name: 'Muesli',
    shortName: 'Muesli',
    category: 'Healthy Living',
    price: 450,
    size: '250 g',
    quantity: '250 g pack',
    description: 'Made with premium rolled oats, 5 types of nuts, seeds, and dry fruits (almonds, pumpkin seeds, flax seeds, melon seeds, raisins, cranberries, watermelon seeds, sunflower seeds), pure coconut oil, and organic jaggery or honey.',
    ingredients: ['Premium rolled oats', 'Almonds', 'Pumpkin seeds', 'Flax seeds', 'Melon seeds', 'Raisins', 'Cranberries', 'Watermelon seeds', 'Sunflower seeds', 'Pure coconut oil', 'Organic jaggery / honey'],
    image: 'assets/muesli.jpg',
    isVeg: true,
    rating: 4.7,
    reviewsCount: 76,
    badge: 'High Fibre',
    details: '250 grams pack. Wholesome breakfast rich in natural plant fiber.'
  },

  // Vegetarian Pickles
  {
    id: 6,
    name: 'Traditional Tomato Pickle',
    shortName: 'Tomato Pickle',
    category: 'Indian Pickles',
    price: 479,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Classic tangy and spiced sun-cured tomato pickle seasoned with mustard seeds, fenugreek, garlic, and cold-pressed sesame oil.',
    ingredients: ['Farm Tomatoes', 'Cold-pressed Sesame Oil', 'Red Chilli Powder', 'Mustard', 'Garlic', 'Salt'],
    image: 'assets/tomato-pickle.jpg',
    isVeg: true,
    rating: 4.8,
    reviewsCount: 114,
    badge: 'Sun Cured',
    variants: [
      { size: '500 g', price: 479 },
      { size: '1 kg', price: 899 }
    ]
  },
  {
    id: 7,
    name: 'Andhra Gongura Pickle',
    shortName: 'Gongura Pickle',
    category: 'Indian Pickles',
    price: 499,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'The legendary tangy and fiery sorrel leaf relish of Andhra. Slow cooked with whole red chillies and fragrant spices.',
    ingredients: ['Fresh Gongura Leaves', 'Cold-pressed Oil', 'Byadagi Chillies', 'Garlic', 'Fenugreek', 'Coriander Seeds'],
    image: 'assets/gongura-pickle.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 189,
    badge: 'Signature',
    variants: [
      { size: '500 g', price: 499 },
      { size: '1 kg', price: 999 }
    ]
  },
  {
    id: 8,
    name: 'Usirikaya Pickle (Amla)',
    shortName: 'Usirikaya Pickle',
    category: 'Indian Pickles',
    price: 499,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Whole Indian gooseberries packed with natural Vitamin C, slow-cured in aromatic roasted spices and cold-pressed gingelly oil.',
    ingredients: ['Wild Amla', 'Cold-pressed Sesame Oil', 'Mustard Powder', 'Red Chillies', 'Turmeric', 'Sea Salt'],
    image: 'assets/usirikaya-pickle.jpg',
    isVeg: true,
    rating: 4.8,
    reviewsCount: 82,
    badge: 'Vitamin C Rich',
    variants: [
      { size: '500 g', price: 499 },
      { size: '1 kg', price: 999 }
    ]
  },
  {
    id: 9,
    name: 'Pandu Mirchi Pickle',
    shortName: 'Pandu Mirchi Pickle',
    category: 'Indian Pickles',
    price: 489,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Vibrant and fiery ripe red pepper pickle hand-pounded with sour tamarind and toasted cumin-fenugreek powder.',
    ingredients: ['Ripe Red Chillies', 'Tamarind', 'Sesame Oil', 'Garlic', 'Fenugreek Powder', 'Salt'],
    image: 'assets/pandu-mirchi-pickle.jpg',
    isVeg: true,
    rating: 4.9,
    reviewsCount: 135,
    badge: 'Fiery Spicy',
    variants: [
      { size: '500 g', price: 489 },
      { size: '1 kg', price: 959 }
    ]
  },
  {
    id: 10,
    name: 'Avakaya Mango Pickle',
    shortName: 'Mango Avakaya',
    category: 'Indian Pickles',
    price: 449,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'The crown jewel of South Indian relishes: crisp green raw mango chunks cured with pungent mustard powder and cold-pressed oil.',
    ingredients: ['Raw Country Mangoes', 'Mustard Powder', 'Red Chilli Powder', 'Cold-pressed Sesame Oil', 'Garlic', 'Salt'],
    image: 'assets/avakaya-mango-pickle.jpg',
    isVeg: true,
    rating: 5.0,
    reviewsCount: 260,
    badge: 'Grandma Recipe',
    variants: [
      { size: '500 g', price: 449 },
      { size: '1 kg', price: 999 }
    ]
  },

  // Non-Vegetarian Pickles
  {
    id: 12,
    name: 'Chicken Pickle (Boneless)',
    shortName: 'Chicken Pickle (Boneless)',
    category: 'Indian Pickles',
    price: 849,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Tender boneless chicken in traditional spices.',
    ingredients: ['Boneless Chicken Breast', 'Cold-pressed Oil', 'Coriander-Cumin Masala', 'Ginger-Garlic', 'Red Chilli', 'Lemon'],
    image: 'assets/chicken-pickle-boneless.jpg',
    isVeg: false,
    rating: 4.9,
    reviewsCount: 295,
    badge: 'Bestseller',
    variants: [
      { size: '500 g', price: 849 },
      { size: '1 kg', price: 1499 }
    ]
  },
  {
    id: 14,
    name: 'Mutton Pickle (Boneless)',
    shortName: 'Mutton Pickle (Boneless)',
    category: 'Indian Pickles',
    price: 1149,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Succulent boneless mutton pickle.',
    ingredients: ['Boneless Mutton', 'Fresh Ginger Garlic', 'Garam Masala', 'Cold-pressed Oil', 'Lemon Juice'],
    image: 'assets/mutton-pickle-boneless.jpg',
    isVeg: false,
    rating: 5.0,
    reviewsCount: 180,
    badge: 'Royal Delicacy',
    variants: [
      { size: '500 g', price: 1149 },
      { size: '1 kg', price: 2199 }
    ]
  },
  {
    id: 15,
    name: 'Prawns Pickle',
    shortName: 'Prawns Pickle',
    category: 'Indian Pickles',
    price: 1049,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Flavorful prawns cooked in a traditional masala.',
    ingredients: ['Fresh Prawns', 'Cold-pressed Oil', 'Garlic-Fenugreek Masala', 'Red Chilli', 'Lemon'],
    image: 'assets/prawns-pickle.jpg',
    isVeg: false,
    rating: 4.9,
    reviewsCount: 165,
    badge: 'Coastal Special',
    variants: [
      { size: '500 g', price: 1049 },
      { size: '1 kg', price: 1999 }
    ]
  },
  {
    id: 16,
    name: 'Fish Pickle (Boneless)',
    shortName: 'Fish Pickle (Boneless)',
    category: 'Indian Pickles',
    price: 1049,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Delicate boneless fish fillets in a spiced pickle.',
    ingredients: ['Boneless Fish Fillets', 'Sesame Oil', 'Ginger-Garlic', 'Mustard', 'Curry Leaves', 'Spices'],
    image: 'assets/fish-pickle-boneless.jpg',
    isVeg: false,
    rating: 4.8,
    reviewsCount: 89,
    badge: 'Delicate Flavor',
    variants: [
      { size: '500 g', price: 1049 },
      { size: '1 kg', price: 1999 }
    ]
  },
  {
    id: 17,
    name: 'Gongura Chicken (Boneless)',
    shortName: 'Gongura Chicken',
    category: 'Indian Pickles',
    price: 1149,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Sour gongura leaves with boneless chicken.',
    ingredients: ['Boneless Chicken', 'Fresh Gongura Leaves', 'Cold-pressed Oil', 'Byadagi Chillies', 'Garlic'],
    image: 'assets/gongura-chicken-pickle.jpg',
    imagePosition: '50% 90%',
    modalImagePosition: '50% 95%',
    mobileModalImagePosition: '50% 82%',
    isVeg: false,
    rating: 5.0,
    reviewsCount: 228,
    badge: 'House Favorite',
    variants: [
      { size: '500 g', price: 1149 },
      { size: '1 kg', price: 1999 }
    ]
  },
  {
    id: 18,
    name: 'Gongura Mutton (Boneless)',
    shortName: 'Gongura Mutton',
    category: 'Indian Pickles',
    price: 1199,
    size: '500 g jar',
    quantity: '500 g · 1 kg available',
    description: 'Tangy gongura leaves with boneless mutton.',
    ingredients: ['Boneless Mutton', 'Fresh Gongura Leaves', 'Cold-pressed Sesame Oil', 'Coriander Seeds', 'Garlic'],
    image: 'assets/gongura-mutton-pickle.jpg',
    imagePosition: '50% 88%',
    modalImagePosition: '50% 90%',
    mobileModalImagePosition: '50% 80%',
    isVeg: false,
    rating: 5.0,
    reviewsCount: 194,
    badge: 'Gourmet',
    variants: [
      { size: '500 g', price: 1199 },
      { size: '1 kg', price: 2248 }
    ]
  }
];

// Session token handling
let authToken = (() => { try { return sessionStorage.getItem('milvanta-auth-token') || localStorage.getItem('milvanta-auth-token') || ''; } catch { return ''; } })();
function setAuthToken(token) {
  authToken = token || '';
  try {
    if (authToken) {
      sessionStorage.setItem('milvanta-auth-token', authToken);
      localStorage.setItem('milvanta-auth-token', authToken);
    } else {
      sessionStorage.removeItem('milvanta-auth-token');
      localStorage.removeItem('milvanta-auth-token');
    }
  } catch (error) {
    console.error('Unable to persist the sign-in token:', error);
  }
}

// App State
const state = {
  selectedCategory: 'Baking Essentials',
  viewMode: 'carousel',
  dietaryFilter: 'all',
  sortBy: 'featured',
  searchTerm: '',
  cart: readCart(),
  activeProductId: null,
  modalQty: 1,
  carouselIndex: 1,
  returnFocus: null,
  selectedVariant: null,
  catalogConnected: false,
  customer: null,
  csrfToken: '',
  accountMode: 'login',
  accountTab: 'orders',
  savedAddresses: [],
  adminOrders: [],
  checkoutStep: 1,
  checkoutBusy: false,
  checkoutNotice: '',
  addressDraft: {},
  purchaseMode: 'onetime',
  subPlanType: 'month',
  pincode: (() => { try { return localStorage.getItem('milvanta-pincode') || '500049'; } catch { return '500049'; } })(),
  area: (() => { try { return localStorage.getItem('milvanta-area') || 'Hafeezpet'; } catch { return 'Hafeezpet'; } })(),
  checkoutKey: (() => { try { return sessionStorage.getItem('milvanta-checkout-key') || ''; } catch { return ''; } })(),
  checkoutFingerprint: (() => { try { return sessionStorage.getItem('milvanta-checkout-fingerprint') || ''; } catch { return ''; } })()
};

const $ = (selector) => document.querySelector(selector);
const API_URL = (window.MILVANTA_API_URL || '').replace(/\/$/, '');
window.state = state;
window.products = products;

// Milk Subscription Dynamic Pricing & Planner Utilities
function isFreshMilkProduct(p) {
  if (!p) return false;
  return p.category === 'Fresh Milk' || p.id === 101 || p.id === 102 || /cow milk|buffalo milk/i.test(p.name);
}

const MILK_PACK_SIZES = [
  { size: '500 ml', litres: 0.5, label: '500 ml' },
  { size: '1 Litre', litres: 1.0, label: '1 Litre' },
  { size: '1.5 Litre', litres: 1.5, label: '1.5 Litre' },
  { size: '2 Litre', litres: 2.0, label: '2 Litre' },
  { size: '2.5 Litre', litres: 2.5, label: '2.5 Litre' },
  { size: '3 Litre', litres: 3.0, label: '3 Litre' },
  { size: '3.5 Litre', litres: 3.5, label: '3.5 Litre' },
  { size: '4 Litre', litres: 4.0, label: '4 Litre' },
  { size: '4.5 Litre', litres: 4.5, label: '4.5 Litre' },
  { size: '5 Litre', litres: 5.0, label: '5 Litre' }
];

function parseLitresFromSize(sizeStr) {
  const s = String(sizeStr || '').toLowerCase().trim();
  if (s.includes('500') || s.includes('1/2') || s.includes('half')) return 0.5;
  const match = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match) return parseFloat(match[1]);
  return 1.0;
}

function getMilkSubscriptionRates(product, variantSize) {
  const isBuffalo = product.id === 102 || /buffalo/i.test(product.name);
  const litres = parseLitresFromSize(variantSize || product.size || '1 Litre');

  // Base rates:
  // Buffalo: 500ml sub = 65, ot = 70; 1L sub = 125, ot = 130
  // Cow: 500ml sub = 55, ot = 60; 1L sub = 105, ot = 110
  const subRate500 = isBuffalo ? 65 : 55;
  const otRate500 = isBuffalo ? 70 : 60;
  const subRate1L = isBuffalo ? 125 : 105;
  const otRate1L = isBuffalo ? 130 : 110;

  let dailyRate;
  let oneTimeRate;

  if (litres === 0.5) {
    dailyRate = subRate500;
    oneTimeRate = otRate500;
  } else {
    const fullL = Math.floor(litres);
    const hasHalf = (litres % 1) >= 0.45;
    dailyRate = (fullL * subRate1L) + (hasHalf ? subRate500 : 0);
    oneTimeRate = (fullL * otRate1L) + (hasHalf ? otRate500 : 0);
  }

  const label = `${isBuffalo ? 'Buffalo Milk' : 'Cow Milk'} ${litres === 0.5 ? '500 ml' : litres + ' Litre'}`;

  return {
    dailyRate,
    oneTimeRate,
    base30Rate: dailyRate * 30,
    label,
    litres
  };
}

function populateMilkPackSizeDropdown(product, selectedSize = '1 Litre') {
  const select = $('#subPackSizeSelect');
  if (!select || !product) return;

  const currentLitres = parseLitresFromSize(selectedSize);

  select.innerHTML = MILK_PACK_SIZES.map((item) => {
    const rates = getMilkSubscriptionRates(product, item.size);
    const isSelected = Math.abs(item.litres - currentLitres) < 0.05;
    const saveAmt = rates.oneTimeRate - rates.dailyRate;
    return `<option value="${item.size}" ${isSelected ? 'selected' : ''}>${item.label} (₹${rates.dailyRate}/day · save ₹${saveAmt}/day)</option>`;
  }).join('');
}

function getContinuousMonthsDetails(startOffset = 0, count = 1) {
  const now = new Date();
  let totalDays = 0;
  const monthList = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + startOffset + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const shortName = d.toLocaleString('en-IN', { month: 'short' });
    const longName = d.toLocaleString('en-IN', { month: 'long' });
    monthList.push({
      year: y,
      month: m,
      shortName,
      longName,
      days: daysInMonth
    });
    totalDays += daysInMonth;
  }

  const firstMonth = monthList[0];
  const lastMonth = monthList[monthList.length - 1];

  let rangeLabel = '';
  if (count === 1) {
    rangeLabel = `${firstMonth.longName} ${firstMonth.year} (${totalDays} Days)`;
  } else {
    rangeLabel = `${firstMonth.shortName} ${firstMonth.year} – ${lastMonth.shortName} ${lastMonth.year} (${count} Mos · ${totalDays} Days)`;
  }

  const breakdownText = monthList.map((m) => `${m.shortName} (${m.days}d)`).join(' + ');

  return {
    totalDays,
    rangeLabel,
    breakdownText,
    monthList,
    firstMonth,
    lastMonth
  };
}

function formatSubscriptionDates(startOffset = 0, days = 30) {
  const now = new Date();
  let startDate;

  if (startOffset === 0) {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth() + startOffset, 1);
  }

  const endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + (days - 1));

  const startFormatted = startDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const endFormatted = endDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return {
    startDate,
    endDate,
    startLabel: startOffset === 0 ? `Tomorrow, ${startFormatted}` : startFormatted,
    endLabel: endFormatted
  };
}

function populateSubscriptionMonths(selectElem) {
  if (!selectElem) return;
  const now = new Date();
  selectElem.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const monthName = d.toLocaleString('en-IN', { month: 'long' });
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = i === 0 ? `${monthName} ${y} (Current Month)` : `${monthName} ${y}`;
    if (i === 0) opt.selected = true;
    selectElem.appendChild(opt);
  }
}

function findProductById(id) {
  const numId = Number(id);
  const found = products.find((item) => {
    const itemId = Number(item.id);
    if (itemId === numId) return true;
    if ((numId === 101 && itemId === 1) || (numId === 1 && itemId === 101)) return true;
    if ((numId === 102 && itemId === 2) || (numId === 2 && itemId === 102)) return true;
    return false;
  });
  return found || products.find((item) => String(item.id) === String(id));
}
window.findProductById = findProductById;

function updateSubscriptionSummary() {
  const p = findProductById(state.activeProductId);
  if (!p || !isFreshMilkProduct(p)) return;

  const variantSize = state.selectedVariant ? state.selectedVariant.size : (p.size || '500 ml');
  const rates = getMilkSubscriptionRates(p, variantSize);

  let days = 30;
  let planLabel = '';
  let startOffset = 0;
  let breakdownText = '';

  const startSelect = $('#subStartMonthSelect') || $('#subMonthSelect');
  startOffset = parseInt(startSelect?.value || '0', 10) || 0;
  const monthsCount = Math.max(1, Math.min(12, state.subMonthsCount || 1));
  state.subMonthsCount = monthsCount;
  state.subStartMonthOffset = startOffset;

  const details = getContinuousMonthsDetails(startOffset, monthsCount);
  days = details.totalDays;
  planLabel = details.rangeLabel;
  breakdownText = details.breakdownText;

  const valElem = $('#subMonthsVal');
  const unitElem = $('#subMonthsUnit');
  if (valElem) valElem.textContent = monthsCount;
  if (unitElem) unitElem.textContent = monthsCount === 1 ? 'Month' : 'Months';

  // Update active quick pills
  document.querySelectorAll('#subMonthQuickPills .sub-quick-pill').forEach((pill) => {
    const pMonths = parseInt(pill.dataset.months, 10);
    pill.classList.toggle('active', pMonths === monthsCount);
  });

  // Update prominent Subscription Delivery Period Card
  const dateInfo = formatSubscriptionDates(startOffset, days);
  const periodDaysBadge = $('#subPeriodDaysBadge');
  const periodStartDate = $('#subPeriodStartDate');
  const periodEndDate = $('#subPeriodEndDate');

  if (periodDaysBadge) periodDaysBadge.textContent = `${days} Mornings`;
  if (periodStartDate) periodStartDate.textContent = dateInfo.startLabel;
  if (periodEndDate) periodEndDate.textContent = dateInfo.endLabel;

  const subTotal = days * rates.dailyRate;
  const regularTotal = days * rates.oneTimeRate;
  const savings = days * (rates.oneTimeRate - rates.dailyRate);

  const planLabelElem = $('#subSummaryPlanLabel');
  const rateElem = $('#subSummaryRate');
  const strikeElem = $('#subRegularStrike');
  const savingsElem = $('#subSavingsBadge');
  const finalPriceElem = $('#subFinalPrice');
  const addBtn = $('#modalAddToCart');

  if (planLabelElem) planLabelElem.textContent = planLabel;
  if (rateElem) rateElem.textContent = `₹${rates.dailyRate} / day`;
  if (strikeElem) strikeElem.textContent = `₹${regularTotal.toLocaleString('en-IN')}`;
  if (savingsElem) savingsElem.textContent = `Save ₹${savings.toLocaleString('en-IN')}`;
  if (finalPriceElem) finalPriceElem.textContent = `₹${subTotal.toLocaleString('en-IN')}`;

  if (addBtn && state.purchaseMode === 'subscription') {
    addBtn.innerHTML = `<span>Add to cart · ₹${subTotal.toLocaleString('en-IN')}</span>`;
  }
}

function getModalUnitPrice() {
  if (state.selectedVariant) return state.selectedVariant.price;
  const p = findProductById(state.activeProductId);
  return p ? p.price : 0;
}

function updateModalAddToCartBtn() {
  const addBtn = $('#modalAddToCart');
  if (!addBtn) return;
  const p = findProductById(state.activeProductId);
  const stock = p?.stockQuantity !== undefined ? p.stockQuantity : 50;
  if (stock <= 0) {
    addBtn.disabled = true;
    addBtn.innerHTML = '<span>Out of stock</span>';
    return;
  }
  addBtn.disabled = false;
  if (state.purchaseMode === 'subscription' && isFreshMilkProduct(p)) {
    updateSubscriptionSummary();
    return;
  }
  const unitPrice = getModalUnitPrice();
  const qty = state.modalQty || 1;
  const total = unitPrice * qty;
  addBtn.innerHTML = `<span>Add to cart · ₹${total.toLocaleString('en-IN')}</span>`;
}

function setPurchaseMode(mode) {
  state.purchaseMode = mode;
  const p = findProductById(state.activeProductId);
  const isMilk = isFreshMilkProduct(p);
  const modeSwitch = $('#modalPurchaseModeWrap');
  const subPlanner = $('#modalSubscriptionPlanWrap');
  const qtyRow = $('.modal-action-bar .quantity-row');
  const actionBar = $('.modal-action-bar');
  const variantChips = $('#variantChips');
  const subPackDropdownWrap = $('#subPackSizeDropdownWrap');

  if (modeSwitch) {
    modeSwitch.querySelectorAll('.purchase-mode-tab').forEach((tab) => {
      const isAct = tab.dataset.mode === mode;
      tab.classList.toggle('active', isAct);
    });
  }

  if (mode === 'subscription' && isMilk) {
    if (subPlanner) subPlanner.classList.remove('hidden');
    if (qtyRow) qtyRow.style.display = 'none';
    if (actionBar) actionBar.style.justifyContent = 'flex-end';
    $('.ingredients-block')?.classList.add('hidden');
    $('#modalExtra')?.classList.add('hidden');
    $('#modalViewRecipe')?.classList.add('hidden');

    if (variantChips) variantChips.classList.add('hidden');
    if (subPackDropdownWrap) subPackDropdownWrap.classList.remove('hidden');

    const defaultSize = state.selectedVariant?.size || '1 Litre';
    populateMilkPackSizeDropdown(p, defaultSize);

    const select = $('#subPackSizeSelect');
    const chosenSize = select?.value || defaultSize;
    const rates = getMilkSubscriptionRates(p, chosenSize);
    state.selectedVariant = {
      size: chosenSize,
      price: rates.dailyRate,
      dailyRate: rates.dailyRate,
      oneTimeRate: rates.oneTimeRate,
      litres: rates.litres
    };
    $('#modalPrice').textContent = `₹${rates.dailyRate} / day`;
    updateSubscriptionSummary();
  } else {
    if (subPlanner) subPlanner.classList.add('hidden');
    if (qtyRow) qtyRow.style.display = '';
    if (actionBar) actionBar.style.justifyContent = 'space-between';
    if (variantChips) variantChips.classList.remove('hidden');
    if (subPackDropdownWrap) subPackDropdownWrap.classList.add('hidden');

    if (p?.ingredients?.length) $('.ingredients-block')?.classList.remove('hidden');
    if (p?.details) $('#modalExtra')?.classList.remove('hidden');
    if (hasRecipe(p)) $('#modalViewRecipe')?.classList.remove('hidden');

    if (p && p.variants && p.variants.length) {
      const curSize = state.selectedVariant?.size || p.variants[0].size;
      const matched = p.variants.find((v) => v.size === curSize) || p.variants[0];
      state.selectedVariant = matched;
      $('#modalPrice').textContent = `₹${matched.price}`;
      if (variantChips) {
        variantChips.querySelectorAll('.variant-chip').forEach((c, idx) => {
          const isAct = p.variants[idx] === matched;
          c.classList.toggle('is-active', isAct);
          c.setAttribute('aria-checked', String(isAct));
        });
      }
    } else if (p) {
      state.selectedVariant = null;
      $('#modalPrice').textContent = `₹${p.price}`;
    }

    updateModalAddToCartBtn();
  }
}

function handleContinuousMonthsAddToCart(p) {
  const variantSize = state.selectedVariant ? state.selectedVariant.size : (p.size || '500 ml');
  const rates = getMilkSubscriptionRates(p, variantSize);

  const startSelect = $('#subStartMonthSelect') || $('#subMonthSelect');
  const startOffset = parseInt(startSelect?.value || '0', 10) || 0;
  const monthsCount = Math.max(1, Math.min(12, state.subMonthsCount || 1));
  const details = getContinuousMonthsDetails(startOffset, monthsCount);
  const days = details.totalDays;
  const totalAmount = days * rates.dailyRate;
  const savings = days * (rates.oneTimeRate - rates.dailyRate);

  const continuousPlanVariant = {
    size: `${variantSize} (${details.rangeLabel} · ₹${rates.dailyRate}/day)`,
    price: totalAmount,
    monthsCount: monthsCount,
    days: days,
    dailyRate: rates.dailyRate,
    oneTimeRate: rates.oneTimeRate,
    savings: savings,
    startOffset: startOffset,
    rangeLabel: details.rangeLabel,
    planLabel: details.rangeLabel,
    isContinuousMonthsPlan: true,
    isSubscriptionPlan: true,
    subscriptionPlan: {
      planType: 'month',
      productName: p.name,
      productId: p.id,
      size: variantSize,
      monthsCount: monthsCount,
      days: days,
      dailyRate: rates.dailyRate,
      rangeLabel: details.rangeLabel,
      startOffset: startOffset,
      frequency: 'Daily (Every Morning)',
      timeSlot: '6:00 AM - 7:00 AM'
    }
  };

  addToCart(p.id, 1, continuousPlanVariant);
  closeProductModal();
  setCartOpen(true);
  showStoreToast(`Added ${monthsCount}-Month Continuous Subscription (${details.rangeLabel}) to Cart!`);
}

async function handleStartSubscription(p) {
  // Delegate safely to cart-based subscription flow
  handleContinuousMonthsAddToCart(p);
}

function showStoreToast(msg, linkUrl) {
  let toast = $('#storeToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'storeToast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #0d2137;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 9999px;
      font-size: 0.9rem;
      font-weight: 600;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      z-index: 99999;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 90vw;
    `;
    document.body.appendChild(toast);
  }
  const linkHtml = linkUrl ? `<a href="${linkUrl}" style="color: #60a5fa; text-decoration: underline; font-weight: 700; white-space: nowrap;">View in Account →</a>` : '';
  toast.innerHTML = `<span>✓</span> <span style="flex:1;">${escapeHtml(msg)}</span> ${linkHtml}`;
  toast.style.transform = 'translateX(-50%) translateY(0)';
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
  }, 6000);
}
window.showToast = showStoreToast;

// Policy contents for compliance modals
const POLICIES = {
  terms: {
    title: 'Terms & Conditions',
    html: `<p>Welcome to <strong>Milvanta</strong>. By accessing our platform or placing an order, you agree to these Terms.</p>
      <h4>1. Products & Availability</h4>
      <p>Milvanta supplies fresh dairy, bakery items, and traditional pickles. Daily fresh milk orders are fulfilled between 6:00 AM and 7:00 AM. In case of unexpected farm stock shortages, refunds are processed within 24 hours.</p>
      <h4>2. Orders & Payment</h4>
      <p>Orders are placed via Razorpay's secure checkout. Prices shown are in Indian Rupees (INR) and are inclusive of GST. Orders cannot be modified once dispatched from the packing facility.</p>
      <h4>3. Serviceable Areas</h4>
      <p>Certain perishable items (such as raw milk) are only serviceable within designated morning delivery pin codes.</p>`
  },
  privacy: {
    title: 'Privacy Policy',
    html: `<p>Milvanta respects your privacy and is committed to protecting your personal data.</p>
      <h4>1. Information We Collect</h4>
      <p>We collect your name, delivery address, phone number, and email address solely to process and deliver your grocery orders.</p>
      <h4>2. Payment Security</h4>
      <p>We do not store your credit/debit card numbers or UPI MPINs. All transactions are securely processed through Razorpay using PCI-DSS compliant encryption.</p>
      <h4>3. Data Sharing</h4>
      <p>We never sell or rent your personal information to third parties. Information is only shared with logistics partners to complete doorstep delivery.</p>`
  },
  shipping: {
    title: 'Shipping & Delivery Policy',
    html: `<p>We take pride in our direct-from-farm cold-chain logistics.</p>
      <h4>1. Fresh Dairy Delivery</h4>
      <p>Fresh milk and cottage cheese are dispatched in temperature-controlled bags maintained under 4°C and delivered directly to your doorstep between <strong>6:00 AM and 7:00 AM</strong>.</p>
      <h4>2. Bakery & Pantry Pickles</h4>
      <p>Bakery treats and jarred pickles are dispatched within 24 hours of ordering. Standard courier delivery takes 2–4 business days depending on location.</p>
      <h4>3. Delivery Charges</h4>
      <p>Delivery charges apply to all order and subscription types: <strong>₹50</strong> for deliveries within 5 km of Hafeezpet hub, and <strong>₹80</strong> for deliveries 6–10 km and Hyderabad Core City (500001–500096).</p>`
  },
  refund: {
    title: 'Refund & Cancellation Policy',
    html: `<p>Your satisfaction and food safety are our highest priorities.</p>
      <h4>1. Damaged or Spoiled Goods</h4>
      <p>If any product arrives damaged, unsealed, or compromised in temperature, please notify us within 24 hours of delivery with a photo. We will immediately dispatch a replacement or issue a 100% refund.</p>
      <h4>2. Cancellations</h4>
      <p>Orders for morning dairy can be paused or cancelled up to 8:00 PM on the evening prior to scheduled delivery.</p>
      <h4>3. Refund Timeline</h4>
      <p>Approved refunds are credited back to the original payment source (UPI/Card/Bank) via Razorpay within 3–5 working days.</p>`
  }
};

// API Client
async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.csrf && state.csrfToken ? { 'X-CSRF-Token': state.csrfToken } : {}),
    ...options.headers
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      credentials: 'omit',
      ...options,
      headers,
      signal: options.signal || controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && ['/api/v1/auth/signup', '/api/v1/auth/login'].includes(path) && typeof data.token === 'string') {
      setAuthToken(data.token);
    }
    if (response.status === 401) setAuthToken('');
    if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError' && !options.signal?.aborted) throw new Error('Store server took too long to respond. Please try again.');
    if (error.message === 'Failed to fetch') {
      throw new Error('Unable to connect to store server. Backend may be offline, waking up, or database unconfigured on Render.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Live Catalog Loader
async function loadCatalog() {
  if (!API_URL) {
    state.catalogConnected = false;
    renderCategories();
    renderCatalog();
    renderCart();
    return;
  }
  try {
    const data = await apiRequest('/api/v1/products');
    if (!Array.isArray(data.products) || data.products.length === 0) throw new Error('Live catalog empty');
    
    // Merge live DB products with rich client metadata (excluding any bone-in pickles)
    const liveProducts = data.products
      .filter((product) => {
        const pName = String(product.name || '').toLowerCase();
        return !pName.includes('(bone)') || pName.includes('boneless');
      })
      .map((product) => {
        const id = Number(product.id);
        const pricePaise = Number(product.price_paise);
        const stockQuantity = Number(product.stock_quantity);
        const pName = String(product.name || '').trim().toLowerCase();
        const existing = products.find((item) => {
          const iName = item.name.toLowerCase();
          return iName === pName || iName.includes(pName) || pName.includes(iName);
        }) || {};
      
      return {
        ...existing,
        id,
        name: product.name,
        shortName: existing.shortName || product.name,
        category: product.category || existing.category || 'Fresh Milk',
        price: pricePaise ? pricePaise / 100 : existing.price,
        size: product.selling_unit || existing.size,
        quantity: product.selling_unit || existing.quantity,
        description: product.description || existing.description || '',
        ingredients: existing.ingredients || [],
        image: existing.image || product.image_url || 'assets/milvanta-cow-milk.jpg',
        stockQuantity: isNaN(stockQuantity) ? 50 : stockQuantity,
        variants: existing.variants || null,
        isVeg: existing.isVeg !== undefined ? existing.isVeg : true,
        rating: existing.rating || 4.8,
        reviewsCount: existing.reviewsCount || 80,
        badge: (product.category === 'Fresh Milk' || pName.includes('milk')) ? 'Subscription Available' : (existing.badge || 'Artisanal'),
        details: existing.details || ''
      };
    });

    const liveNames = new Set(liveProducts.map(p => p.name.toLowerCase()));
    const missingFallbacks = products.filter(p => !liveNames.has(p.name.toLowerCase()));

    state.catalogConnected = true;
    products = [...liveProducts, ...missingFallbacks];
    window.products = products;
    $('#storeNotice')?.classList.add('hidden');
    renderCategories();
    renderCatalog();
    renderCart();
    updateBadge();
  } catch (error) {
    state.catalogConnected = false;
    console.warn('Backend catalog offline; using rich local artisanal catalog:', error.message);
    renderCategories();
    renderCatalog();
    renderCart();
  }
}

// Storage & Cart
function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
    return Array.isArray(saved) ? saved.filter((item) => Number.isSafeInteger(item.id) && item.id > 0 && Number.isSafeInteger(item.quantity) && item.quantity > 0) : [];
  } catch {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem('milvanta-cart', JSON.stringify(state.cart));
  } catch {}
}

function updateBadge() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartBadge = $('#cartCount');
  if (cartBadge) {
    cartBadge.textContent = count;
    cartBadge.setAttribute('aria-label', `${count} items in cart`);
  }
}

function getCartItemQuantity(productId, variantSize = '') {
  const item = state.cart.find((entry) => entry.id === productId && (entry.variant?.size || '') === variantSize);
  return item ? item.quantity : 0;
}

// Filtered Catalog
function visibleProducts() {
  const term = state.searchTerm.trim().toLowerCase();
  let list = products.filter((p) => {
    const matchesCat = state.selectedCategory === 'All' || p.category === state.selectedCategory;
    const matchesDiet = state.dietaryFilter === 'all' || (state.dietaryFilter === 'veg' && p.isVeg) || (state.dietaryFilter === 'non-veg' && !p.isVeg);
    const searchString = `${p.name} ${p.shortName || ''} ${p.category} ${p.description || ''} ${(p.ingredients || []).join(' ')}`.toLowerCase();
    const matchesSearch = !term || searchString.includes(term);
    return matchesCat && matchesDiet && matchesSearch;
  });

  // Sorting
  if (state.sortBy === 'price-asc') {
    list.sort((a, b) => a.price - b.price);
  } else if (state.sortBy === 'price-desc') {
    list.sort((a, b) => b.price - a.price);
  } else if (state.sortBy === 'rating') {
    list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  return list;
}

// Render Category Strip
function renderCategories() {
  const categoryRow = $('#categoryRow');
  if (!categoryRow) return;
  categoryRow.innerHTML = '';

  categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    const isActive = state.selectedCategory === category.name;
    button.className = `category-card${isActive ? ' is-active' : ''}`;
    button.setAttribute('aria-pressed', String(isActive));

    const thumbMarkup = category.image
      ? `<span class="category-thumb"><img src="${category.image}" alt="${category.name}"></span>`
      : `<span class="category-thumb" style="background:#edf4fa;color:#0a3d66;font-weight:700;font-size:1.1rem;">✦</span>`;

    const isMilkCategory = category.name === 'Fresh Milk' || (category.label && category.label.includes('Milk'));
    const badgeMarkup = isMilkCategory
      ? `<span class="category-card-badge">Subscription Available</span>`
      : '';

    button.innerHTML = `${badgeMarkup}${thumbMarkup}<span>${category.label || category.name}</span>`;
    button.addEventListener('click', () => {
      state.selectedCategory = category.name;
      if (category.name === 'All') {
        state.viewMode = 'grid';
      } else {
        state.viewMode = 'carousel';
        state.carouselIndex = 1;
      }
      renderCategories();
      renderCatalog();
    });
    categoryRow.append(button);
  });

  // Sync active state in header category strip and mobile nav
  document.querySelectorAll('[data-category-nav]').forEach((link) => {
    const isAct = (link.dataset.categoryNav || 'All') === state.selectedCategory;
    link.classList.toggle('active', isAct);
  });
}

// Category Titles & Descriptions
const CATEGORY_META = {
  'All': {
    title: 'Our Complete Collection',
    subtitle: 'Farm-fresh dairy, nourishing wholesome bakes, and authentic heritage pickles.'
  },
  'Fresh Milk': {
    title: 'Pure Fresh Milk',
    subtitle: '100% pure whole milk chilled under 4°C and delivered fresh every morning before 7:00 AM.'
  },
  'Dairy Products': {
    title: 'Artisanal Dairy',
    subtitle: 'Vedic bilona cow & buffalo ghee, fresh morning malai paneer, and thick probiotic pot curd.'
  },
  'Baking Essentials': {
    title: 'Baking Essentials',
    subtitle: 'Wholesome bakes crafted with natural ingredients for healthier, happier moments.'
  },
  'Healthy Living': {
    title: 'Healthy Living',
    subtitle: 'Nutrient-dense sprouted millets, organic ragi treats, and wholesome breakfast granola.'
  },
  'Indian Pickles': {
    title: 'Heritage Indian Pickles',
    subtitle: 'Authentic sun-cured pickles prepared with wood-cold-pressed oils and stone-ground spices.'
  }
};

// 3 Feature Pills per Product (Matching Reference Image)
function getProductFeatures(p) {
  if (p.features && p.features.length) return p.features;
  const name = String(p.name || '').toLowerCase();

  // Fresh Milk
  if (name.includes('buffalo milk')) {
    return [
      { icon: '🥛', text: '7.5%+ Natural Fat' },
      { icon: '🛡️', text: 'No Preservatives' },
      { icon: '❄️', text: 'Chilled Under 4°C' }
    ];
  }
  if (name.includes('cow milk') || p.category === 'Fresh Milk') {
    return [
      { icon: '🌱', text: 'Farm Fresh' },
      { icon: '🛡️', text: 'No Preservatives' },
      { icon: '🧪', text: 'Lab Tested' }
    ];
  }

  // Dairy Products
  if (name.includes('buffalo ghee')) {
    return [
      { icon: '🏺', text: 'Traditional Bilona' },
      { icon: '🥛', text: 'Pure Buffalo Cream' },
      { icon: '✨', text: 'Dense Ivory Grain' }
    ];
  }
  if (name.includes('cow ghee') || name.includes('ghee')) {
    return [
      { icon: '🏺', text: 'Vedic Bilona' },
      { icon: '🌾', text: 'Pure A2 Cow' },
      { icon: '✨', text: 'Golden Granular' }
    ];
  }
  if (name.includes('paneer')) {
    return [
      { icon: '🍋', text: 'Lemon Curdled' },
      { icon: '🧈', text: '100% Whole Milk' },
      { icon: '🛡️', text: 'Zero Starch' }
    ];
  }
  if (name.includes('curd')) {
    return [
      { icon: '🏺', text: 'Clay Pot Set' },
      { icon: '✨', text: 'Live Cultures' },
      { icon: '🥛', text: 'Naturally Thick' }
    ];
  }

  // Baking Essentials
  if (name.includes('brownie')) {
    return [
      { icon: '🍫', text: 'Godavari Cocoa' },
      { icon: '🌾', text: '9g Protein Flour' },
      { icon: '🥜', text: 'Toasted Walnuts' }
    ];
  }
  if (name.includes('butter cake')) {
    return [
      { icon: '🧈', text: 'Pure Farm Butter' },
      { icon: '🍫', text: 'Couverture Chips' },
      { icon: '🌾', text: 'Organic Wheat' }
    ];
  }
  if (name.includes('kowa cake')) {
    return [
      { icon: '🥛', text: 'Pure Fresh Kowa' },
      { icon: '🌾', text: 'Organic Wheat' },
      { icon: '✨', text: 'Low Glycemic' }
    ];
  }

  // Healthy Living
  if (name.includes('cookie') || name.includes('raagi')) {
    return [
      { icon: '🌾', text: 'Organic Raagi' },
      { icon: '🥜', text: '5 Seeds & Nuts' },
      { icon: '🍯', text: 'Pure Jaggery' }
    ];
  }
  if (name.includes('muesli')) {
    return [
      { icon: '🥣', text: 'Rolled Oats' },
      { icon: '🥥', text: 'Pure Coconut Oil' },
      { icon: '🌰', text: '5 Nuts & Seeds' }
    ];
  }

  // Indian Pickles
  if (name.includes('chicken') || name.includes('mutton') || !p.isVeg) {
    return [
      { icon: '🍗', text: 'Succulent Meat' },
      { icon: '🫒', text: 'Wood-Pressed Oil' },
      { icon: '🌶️', text: 'Andhra Spiced' }
    ];
  }

  return [
    { icon: '🏺', text: 'Sun Cured' },
    { icon: '🫒', text: 'Cold Pressed Oil' },
    { icon: '🛡️', text: 'Preservative Free' }
  ];
}

// Default Recipes strictly for the 5 Homemade Food & Artisanal Bakery Items
const defaultRecipes = {
  'walnut-raagi-brownie': {
    name: 'Walnut Raagi Brownie',
    prepTime: '15 mins',
    cookTime: '25 mins',
    servings: '4–6 pieces (3×3 in)',
    ingredients: [
      '100g Godavari alkaline-free pure cocoa',
      '200g Organic whole wheat flour (carrying 9g protein)',
      '80g Organic Raagi flour',
      '120g Low-glycemic brown sugar',
      '100g Pure churned farm butter (Milvanta)',
      '60g Crunchy toasted walnut slices',
      '1 tsp Pure vanilla extract & pinch of sea salt'
    ],
    instructions: [
      'Gently melt butter and whisk together with Godavari alkaline-free cocoa until silky smooth.',
      'Whisk in low-glycemic brown sugar until completely dissolved and glossy.',
      'Sift organic whole wheat flour and raagi flour together, then gently fold into cocoa-butter base.',
      'Pour into lined 3×3 inch baking moulds and scatter toasted walnut slices evenly over top.',
      'Bake at 170°C for 22–25 minutes until edges are set and center is fudgy. Cool completely before slicing.'
    ]
  },
  'butter-cake': {
    name: 'Butter Cake with Couverture Chocolate Chips',
    prepTime: '20 mins',
    cookTime: '35 mins',
    servings: '250 g artisanal loaf',
    ingredients: [
      '150g Organic whole wheat flour',
      '100g Pure churned farm butter (Milvanta)',
      '90g Unrefined cane sugar',
      '75g Rich dark couverture chocolate chips',
      '60ml Fresh farm whole cow milk (Milvanta)',
      '1 tsp Baking powder & 1/2 tsp vanilla extract'
    ],
    instructions: [
      'Cream softened pure farm butter and unrefined sugar together for 5 minutes until fluffy and pale.',
      'Pour in fresh whole cow milk and vanilla, whisking gently to combine.',
      'Fold in sifted organic whole wheat flour and baking powder in batches until smooth batter forms.',
      'Toss couverture chocolate chips in a dusting of flour, then fold 3/4 into batter.',
      'Pour into a 250g lined loaf tin, scatter remaining chocolate chips on top, and bake at 165°C for 35 minutes until golden.'
    ]
  },
  'kowa-cake': {
    name: 'Heritage Kowa Cake',
    prepTime: '15 mins',
    cookTime: '30 mins',
    servings: '1 Piece (3×3 in)',
    ingredients: [
      '120g Fresh slow-reduced milk kowa (mawa)',
      '80g Organic whole wheat flour',
      '50g Pure churned butter (Milvanta)',
      '60g Low-glycemic brown sugar',
      '1/2 tsp Freshly pounded green cardamom (elaichi)',
      '25g Slivered almonds and pistachios',
      '40ml Fresh farm cow milk (Milvanta)'
    ],
    instructions: [
      'Lightly roast crumbled fresh kowa in a heavy pan on low flame for 3 minutes until aromatic. Cool to room temperature.',
      'Whisk softened butter and brown sugar until light and creamy.',
      'Blend in roasted kowa, pounded elaichi, and farm cow milk.',
      'Gently fold in organic whole wheat flour until dense cake batter forms.',
      'Transfer to 3×3 inch mould, top generously with almond flakes, and bake at 170°C for 28–30 minutes.'
    ]
  },
  'raagi-cookies': {
    name: 'Nutrient-Dense Raagi Cookies',
    prepTime: '15 mins',
    cookTime: '18 mins',
    servings: '17 cookies (250g tin)',
    ingredients: [
      '120g Organic Raagi (finger millet) flour',
      '60g Organic whole wheat flour',
      '75g Pure Desi Belona Ghee (Milvanta)',
      '80g Organic powdered jaggery',
      '45g 5-Nut & Seed Mix (pumpkin, cashew, almond, sunflower, melon seeds)',
      '1/2 tsp Fragrant cardamom powder',
      '2 tbsp Fresh whole cow milk (Milvanta)'
    ],
    instructions: [
      'Dry roast organic raagi flour on low heat for 4 minutes until warm, nutty aroma emerges.',
      'Whisk warm Desi Belona Ghee and organic powdered jaggery together until smooth and emulsified.',
      'Combine roasted raagi flour, whole wheat flour, and cardamom; mix into ghee-jaggery base with farm milk to form dough.',
      'Divide into 17 equal portions and press 5 types of nuts and seeds firmly across top.',
      'Bake at 160°C for 16–18 minutes. Allow to crisp on a wire rack before packaging.'
    ]
  },
  'muesli': {
    name: 'Artisanal Sprouted Millet Muesli',
    prepTime: '10 mins',
    cookTime: '15 mins',
    servings: '250 g pack',
    ingredients: [
      '130g Premium rolled whole oats',
      '60g 5-Nuts & Seeds (almonds, pumpkin, flax, melon, sunflower seeds)',
      '35g Sun-dried fruits (raisins, cranberries, watermelon seeds)',
      '2 tbsp Pure cold-pressed coconut oil',
      '2 tbsp Organic raw honey or jaggery syrup',
      '1/4 tsp Ground cinnamon & pinch of rock salt'
    ],
    instructions: [
      'Mix rolled oats, almonds, and raw seeds in a large bowl with cinnamon and pinch of salt.',
      'Warm coconut oil and organic honey/jaggery syrup slightly, then drizzle evenly over dry ingredients.',
      'Spread evenly across a baking tray lined with parchment paper.',
      'Bake at 150°C for 15 minutes, stirring halfway, until golden and fragrant.',
      'Cool completely until crunchy, then toss in cranberries and raisins. Enjoy with chilled Milvanta milk or curd!'
    ]
  }
};

function getRecipeForProduct(idOrProduct) {
  const p = typeof idOrProduct === 'object' && idOrProduct 
    ? idOrProduct 
    : products.find((item) => item.id === Number(idOrProduct));
  if (!p) return null;
  const name = String(p.name || '').toLowerCase();

  // Strictly match only the 5 homemade food / bakery products
  if (name.includes('brownie')) return defaultRecipes['walnut-raagi-brownie'];
  if (name.includes('butter cake')) return defaultRecipes['butter-cake'];
  if (name.includes('kowa cake')) return defaultRecipes['kowa-cake'];
  if (name.includes('cookie') || name.includes('raagi cookie')) return defaultRecipes['raagi-cookies'];
  if (name.includes('muesli')) return defaultRecipes['muesli'];

  // All other products (Milk, Curd, Paneer, Ghee, and all 8 Pickles) have NO recipe
  return null;
}

function hasRecipe(idOrProduct) {
  return Boolean(getRecipeForProduct(idOrProduct));
}

// Render 3D Interactive Carousel or All-Products Grid View
function renderCatalog() {
  const container = $('#productCarousel');
  const dotsContainer = $('#carouselDots');
  const wrapper = $('#carouselWrapper');
  const prevBtn = $('#prevBtn');
  const nextBtn = $('#nextBtn');
  const viewAllBtn = $('#viewAllBtn');

  if (!container) return;
  const list = visibleProducts();

  const titleElem = $('#sectionTitle');
  const subtitleElem = $('#sectionSubtitle');

  // Toggle View All button text and state
  if (viewAllBtn) {
    if (state.viewMode === 'grid') {
      viewAllBtn.innerHTML = 'View As Carousel <span aria-hidden="true">⟲</span>';
      viewAllBtn.classList.add('is-active');
    } else {
      viewAllBtn.innerHTML = 'View All <span aria-hidden="true">→</span>';
      viewAllBtn.classList.remove('is-active');
    }
  }

  // Toggle grid container layout vs carousel layout
  if (state.viewMode === 'grid') {
    if (wrapper) wrapper.classList.add('is-grid-view');
    container.classList.add('is-grid-view');
    container.style.transform = 'none';
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (dotsContainer) dotsContainer.style.display = 'none';
  } else {
    if (wrapper) wrapper.classList.remove('is-grid-view');
    container.classList.remove('is-grid-view');
    if (prevBtn) prevBtn.style.display = '';
    if (nextBtn) nextBtn.style.display = '';
    if (dotsContainer) dotsContainer.style.display = '';
  }

  if (state.searchTerm) {
    if (titleElem) titleElem.textContent = `Search results for "${state.searchTerm}"`;
    if (subtitleElem) subtitleElem.textContent = `Showing products matching "${state.searchTerm}"`;
  } else if (state.viewMode === 'grid' && state.selectedCategory === 'All') {
    if (titleElem) titleElem.textContent = 'All Products';
    if (subtitleElem) subtitleElem.textContent = 'Explore our full artisanal collection of pure dairy, wholesome bakery, and authentic pickles.';
  } else {
    const meta = CATEGORY_META[state.selectedCategory] || {
      title: state.selectedCategory,
      subtitle: 'Pure farm-fresh artisanal goods from Milvanta.'
    };
    if (titleElem) titleElem.textContent = meta.title;
    if (subtitleElem) subtitleElem.textContent = meta.subtitle;
  }

  container.innerHTML = '';

  if (!list.length) {
    container.style.transform = 'none';
    container.innerHTML = `
      <div style="width: 100%; min-width: 320px; padding: 48px 20px; text-align: center; color: var(--text-muted); margin: 0 auto; grid-column: 1 / -1;">
        <h3 style="font-family: var(--serif); font-size: 1.6rem; color: var(--text); margin-bottom: 8px;">No items match your selection</h3>
        <p style="font-size: 0.88rem;">Try clearing your search or choosing another category.</p>
        <button class="card-add-btn" type="button" data-reset-filter style="margin-top: 14px;">View All Products</button>
      </div>`;
    if (dotsContainer) dotsContainer.innerHTML = '';
    return;
  }

  // Clamp carousel index
  if (state.carouselIndex >= list.length) state.carouselIndex = Math.max(0, list.length - 1);
  if (state.carouselIndex < 0) state.carouselIndex = 0;

  list.forEach((p, index) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.dataset.id = p.id;
    card.dataset.index = index;
    card.tabIndex = 0;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${p.name}, ₹${p.price}.`);

    const dietClass = p.isVeg ? 'veg' : 'non-veg';
    const dietTitle = p.isVeg ? 'Vegetarian' : 'Non-Vegetarian';
    const features = getProductFeatures(p);

    const pricePrefix = p.variants && p.variants.length > 1 ? '<span class="price-from" style="font-size:0.76rem;color:var(--text-muted);font-weight:600;margin-right:2px;">From </span>' : '';
    const unitText = p.size ? p.size.replace(/pouch|bottle|jar|pack|tin/i, '').trim() : '';
    const unitLabel = unitText ? `<span class="card-size-label">/ ${escapeHtml(unitText)}</span>` : '';

    const featuresHtml = features.map(f => `
      <span class="card-pill-tag">
        <span class="pill-icon">${f.icon}</span>
        <span>${escapeHtml(f.text)}</span>
      </span>
    `).join('');

    const isMilkProduct = p.category === 'Fresh Milk' || (p.name && p.name.toLowerCase().includes('milk'));
    const displayBadge = isMilkProduct ? 'Subscription Available' : p.badge;
    const badgeClass = isMilkProduct ? 'product-card-badge sub-badge' : 'product-card-badge';

    card.innerHTML = `
      <div class="product-image">
        ${displayBadge ? `<span class="${badgeClass}">${escapeHtml(displayBadge)}</span>` : ''}
        <span class="fssai-indicator ${dietClass}" title="${dietTitle}"></span>
        <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" decoding="async" loading="lazy"${p.imagePosition ? ` style="object-position: ${p.imagePosition};"` : ''}>
      </div>
      <div class="card-body">
        <h3 class="product-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
        <div class="card-price-row">
          <div class="card-price-left">
            <span class="card-price-val">${pricePrefix}₹${Number(p.price).toFixed(0)}</span>
            ${unitLabel}
          </div>
          <button type="button" class="card-round-cart-btn" data-card-cart="${p.id}" aria-label="Add ${escapeHtml(p.name)} to cart" title="Add to cart">
            <svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>
        </div>
        <div class="card-feature-pills">
          ${featuresHtml}
        </div>
      </div>
    `;

    // Clicking anywhere on product card opens product detail modal
    card.addEventListener('click', (event) => {
      if (event.target.closest('.card-round-cart-btn')) return;
      const idx = Number(card.dataset.index);
      if (!isNaN(idx)) {
        state.carouselIndex = idx;
        updateCarouselPositions();
      }
      openProductModal(p.id);
    });

    container.append(card);
  });

  if (state.viewMode !== 'grid') {
    requestAnimationFrame(() => {
      updateCarouselPositions();
    });
  }
}

// Calculate 3D Slider Positions & Active State
function updateCarouselPositions() {
  if (state.viewMode === 'grid') return;
  const container = $('#productCarousel');
  const wrapper = $('#carouselWrapper');
  if (!container || !wrapper) return;

  const cards = container.querySelectorAll('.product-card');
  if (!cards.length) return;

  if (state.carouselIndex < 0) state.carouselIndex = 0;
  if (state.carouselIndex >= cards.length) state.carouselIndex = cards.length - 1;

  const currentIdx = state.carouselIndex;
  const activeCard = cards[currentIdx];
  if (!activeCard) return;

  const wrapperWidth = wrapper.clientWidth;
  const cardLeft = activeCard.offsetLeft;
  const cardWidth = activeCard.offsetWidth;
  const targetX = (wrapperWidth / 2) - (cardLeft + (cardWidth / 2));

  container.style.transform = `translate3d(${Math.round(targetX)}px, 0, 0)`;

  cards.forEach((card, i) => {
    card.classList.remove('is-center', 'is-adjacent', 'is-far', 'is-edge');
    const delta = Math.abs(i - currentIdx);
    if (delta === 0) {
      card.classList.add('is-center');
      card.setAttribute('aria-current', 'true');
    } else if (delta === 1) {
      card.classList.add('is-adjacent');
      card.removeAttribute('aria-current');
    } else if (delta === 2) {
      card.classList.add('is-far');
      card.removeAttribute('aria-current');
    } else {
      card.classList.add('is-edge');
      card.removeAttribute('aria-current');
    }
  });

  renderCarouselDots(cards.length, currentIdx);
}

// Carousel Dots Navigation
function renderCarouselDots(total, current) {
  const dotsContainer = $('#carouselDots');
  if (!dotsContainer) return;
  if (total <= 1) {
    dotsContainer.innerHTML = '';
    return;
  }

  dotsContainer.innerHTML = Array.from({ length: total }).map((_, i) => `
    <button type="button" class="carousel-dot${i === current ? ' active' : ''}" data-dot-index="${i}" aria-label="Go to product ${i + 1} of ${total}"></button>
  `).join('');
}

// Product Detail Modal
function openProductModal(id, initialMode = 'onetime') {
  const p = findProductById(id);
  if (!p) return;
  state.activeProductId = p.id;
  state.modalQty = 1;

  $('#modalQty').textContent = '1';
  $('#modalTitle').textContent = p.name;
  $('#modalDescription').textContent = p.description || '';
  $('#modalImage').src = p.image;
  $('#modalImage').alt = p.name;
  if (p.modalImagePosition) {
    $('#modalImage').style.objectPosition = window.innerWidth <= 768 ? (p.mobileModalImagePosition || '50% 82%') : p.modalImagePosition;
  } else if (p.imagePosition) {
    $('#modalImage').style.objectPosition = p.imagePosition;
  } else {
    $('#modalImage').style.objectPosition = '';
  }

  // Stock availability badge & Add to Cart button state
  const stock = p.stockQuantity !== undefined ? p.stockQuantity : 50;
  const stockBadge = $('#modalStock');
  const addBtn = $('#modalAddToCart');

  if (stock <= 0) {
    if (stockBadge) {
      stockBadge.innerHTML = '<span class="stock-dot out">●</span> <span id="modalStockText">Out of Stock · Available Tomorrow</span>';
    }
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.innerHTML = '<span>Out of stock</span>';
    }
  } else {
    if (stockBadge) {
      stockBadge.innerHTML = '<span class="stock-dot">●</span> <span id="modalStockText">In Stock · Farm Fresh Daily</span>';
    }
    if (addBtn) {
      addBtn.disabled = false;
    }
  }

  // View Recipe button visibility strictly for the 5 homemade bakery items
  const recipeBtn = $('#modalViewRecipe');
  if (recipeBtn) {
    if (hasRecipe(p)) {
      recipeBtn.classList.remove('hidden');
      recipeBtn.dataset.productId = p.id;
    } else {
      recipeBtn.classList.add('hidden');
      delete recipeBtn.dataset.productId;
    }
  }

  const variantWrap = $('#variantWrap');
  const variantChips = $('#variantChips');
  const singleSizeWrap = $('#modalSingleSizeWrap');
  let currentPrice = p.price;

  if (p.variants && p.variants.length) {
    if (variantWrap) variantWrap.classList.remove('hidden');
    if (singleSizeWrap) singleSizeWrap.classList.add('hidden');
    state.selectedVariant = p.variants[0];
    currentPrice = p.variants[0].price;
    $('#modalPrice').textContent = `₹${currentPrice}`;

    if (variantChips) {
      variantChips.innerHTML = p.variants.map((v, idx) => `
        <button type="button" class="variant-chip${idx === 0 ? ' is-active' : ''}" data-index="${idx}" role="radio" aria-checked="${idx === 0}">
          <span class="chip-size">${escapeHtml(v.size)}</span>
          <span class="chip-price">₹${v.price}</span>
        </button>
      `).join('');

      variantChips.querySelectorAll('.variant-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const idx = Number(chip.dataset.index);
          state.selectedVariant = p.variants[idx];
          variantChips.querySelectorAll('.variant-chip').forEach((c) => {
            const isAct = c === chip;
            c.classList.toggle('is-active', isAct);
            c.setAttribute('aria-checked', String(isAct));
          });
          const price = state.selectedVariant.price;
          $('#modalPrice').textContent = `₹${price}`;
          if (state.purchaseMode === 'subscription') {
            updateSubscriptionSummary();
          } else {
            updateModalAddToCartBtn();
          }
        });
      });
    }
  } else {
    if (variantWrap) variantWrap.classList.add('hidden');
    if (singleSizeWrap) singleSizeWrap.classList.remove('hidden');
    state.selectedVariant = null;
    const singlePrice = $('#modalSinglePrice');
    if (singlePrice) singlePrice.textContent = `₹${p.price}`;
    $('#modalSize').textContent = p.size || '';
    $('#modalPrice').textContent = `₹${p.price}`;
  }

  // Setup Subscription vs Buy Once UI for Fresh Milk
  const isMilk = isFreshMilkProduct(p);
  const modeSwitch = $('#modalPurchaseModeWrap');
  const subPlanner = $('#modalSubscriptionPlanWrap');
  const qtyRow = $('.modal-action-bar .quantity-row');

  if (isMilk) {
    if (modeSwitch) modeSwitch.classList.remove('hidden');
    state.subMonthsCount = 1;
    populateSubscriptionMonths($('#subStartMonthSelect') || $('#subMonthSelect'));
    setPurchaseMode(initialMode === 'subscription' ? 'subscription' : 'onetime');
  } else {
    if (modeSwitch) modeSwitch.classList.add('hidden');
    if (subPlanner) subPlanner.classList.add('hidden');
    if (qtyRow) qtyRow.style.display = '';
    state.purchaseMode = 'onetime';
    updateModalAddToCartBtn();
  }

  const ingBlock = $('.ingredients-block');
  if (p.ingredients && p.ingredients.length) {
    ingBlock.classList.remove('hidden');
    $('#modalIngredients').innerHTML = p.ingredients.map((x) => `<li>${x}</li>`).join('');
  } else {
    ingBlock.classList.add('hidden');
  }

  $('#modalExtra').textContent = p.details || '';

  const modal = $('#productModal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  const scrollArea = $('#modalScrollBody') || modal.querySelector('.modal-scroll-body') || modal;
  if (scrollArea) scrollArea.scrollTop = 0;
}

function closeProductModal() {
  const modal = $('#productModal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

// Recipe Detail Modal
function openRecipeModal(productId) {
  const recipe = getRecipeForProduct(productId);
  if (!recipe) return;

  $('#recipeTitle').textContent = recipe.name;

  const metaBadges = $('#recipeMetaBadges');
  if (metaBadges) {
    metaBadges.innerHTML = `
      <span class="recipe-meta-pill">⏱️ Prep: ${escapeHtml(recipe.prepTime || '15 mins')}</span>
      <span class="recipe-meta-pill">🔥 Cook: ${escapeHtml(recipe.cookTime || '25 mins')}</span>
      <span class="recipe-meta-pill">👥 Servings: ${escapeHtml(recipe.servings || '4–6 portions')}</span>
    `;
  }

  const ingList = $('#recipeIngredients');
  if (ingList) {
    ingList.innerHTML = recipe.ingredients.map((ing) => `<li>${escapeHtml(ing)}</li>`).join('');
  }

  const instList = $('#recipeInstructions');
  if (instList) {
    instList.innerHTML = recipe.instructions.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  }

  const relatedGrid = $('#recipeRelatedGrid');
  if (relatedGrid) {
    const relatedProducts = products.filter((p) => {
      const n = (p.name || '').toLowerCase();
      return n.includes('ghee') || n.includes('cow milk') || n.includes('paneer') || n.includes('butter');
    }).slice(0, 2);

    if (relatedProducts.length) {
      relatedGrid.innerHTML = relatedProducts.map((rel) => `
        <div class="recipe-related-card">
          <img src="${escapeHtml(rel.image)}" alt="${escapeHtml(rel.name)}" loading="lazy">
          <div class="recipe-related-name">${escapeHtml(rel.name)}</div>
          <div class="recipe-related-price">₹${rel.price} <span style="font-weight:400;font-size:0.75rem;color:var(--text-muted);">· ${escapeHtml(rel.size || '')}</span></div>
          <button type="button" class="recipe-related-add" data-add-related="${rel.id}">+ Add to Cart</button>
        </div>
      `).join('');
    } else {
      relatedGrid.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Pure Milvanta farm dairy ingredients recommended.</p>';
    }
  }

  const modal = $('#recipeModal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  const scrollBody = $('#recipeScrollBody');
  if (scrollBody) scrollBody.scrollTop = 0;
}

function closeRecipeModal() {
  const modal = $('#recipeModal');
  modal?.classList.add('hidden');
  modal?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

// Cart Management
function addToCart(id, quantity = 1, variant = null) {
  const p = findProductById(id);
  if (!p) return;
  const numId = Number(p.id);

  // Prevent adding out-of-stock items
  const stock = p.stockQuantity !== undefined ? p.stockQuantity : 50;
  if (stock <= 0) {
    state.checkoutNotice = `${p.name} is currently out of stock.`;
    renderCart();
    setCartOpen(true);
    return;
  }

  const existing = state.cart.find((entry) => Number(entry.id) === numId && (entry.variant?.size || entry.size || '') === (variant?.size || ''));
  if ((existing?.quantity || 0) + quantity > 25) {
    state.checkoutNotice = 'You can add up to 25 units per item.';
    renderCart();
    return;
  }
  state.checkoutNotice = '';
  if (existing) {
    existing.quantity += quantity;
    if (!existing.name) existing.name = p.name;
    if (!existing.price) existing.price = variant?.price || p.price;
    if (!existing.image) existing.image = p.image;
    if (!existing.size) existing.size = variant?.size || p.size;
    if (variant?.isContinuousMonthsPlan) {
      existing.isContinuousMonthsPlan = true;
      existing.isSubscriptionPlan = true;
      existing.subscriptionPlan = variant.subscriptionPlan;
    }
  } else {
    state.cart.push({
      id: numId,
      name: p.name,
      price: variant?.price || p.price,
      size: variant?.size || p.size,
      image: p.image,
      quantity,
      ...(variant ? { variant } : {}),
      ...(variant?.isContinuousMonthsPlan ? { isContinuousMonthsPlan: true, isSubscriptionPlan: true, subscriptionPlan: variant.subscriptionPlan } : {})
    });
  }
  saveCart();
  updateBadge();
  renderCatalog();
  renderCart();
}

function updateCart(id, amount, variantSize = '') {
  const numId = Number(id);
  const item = state.cart.find((entry) => Number(entry.id) === numId && (entry.variant?.size || '') === variantSize);
  if (!item) return;

  if (amount > 0 && item.quantity + amount > 25) {
    state.checkoutNotice = 'Maximum 25 units per item.';
  } else {
    state.checkoutNotice = '';
    item.quantity += amount;
    if (item.quantity <= 0) {
      state.cart = state.cart.filter((e) => e !== item);
    }
  }
  saveCart();
  updateBadge();
  renderCatalog();
  renderCart();
}

// Render Cart Drawer
function renderCart() {
  const valid = state.cart.filter((entry) => Boolean(findProductById(entry.id)));
  state.cart = valid;
  const content = $('#cartContent');
  if (!content) return;

  if (!valid.length) {
    content.innerHTML = `
      <div style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
        <p style="font-size: 2.4rem; margin: 0 0 10px;">🧺</p>
        <h4 style="font-family: var(--serif); font-size: 1.5rem; color: var(--text); margin: 0 0 6px;">Your cart is empty</h4>
        <p style="font-size: 0.82rem; margin: 0 0 20px;">Pure farm goodness is just a browse away.</p>
        <button class="primary-cart" type="button" data-browse-more style="max-width: 220px; margin: 0 auto;">Start Shopping</button>
      </div>`;
    updateBadge();
    return;
  }

  // Subtotal & Total Count
  const subtotal = valid.reduce((sum, entry) => {
    const p = findProductById(entry.id);
    const price = entry.variant?.price || entry.price || p?.price || 0;
    return sum + price * entry.quantity;
  }, 0);
  const totalItems = valid.reduce((sum, entry) => sum + entry.quantity, 0);

  // Item Rows
  const itemsHtml = valid.map((entry) => {
    const p = findProductById(entry.id) || { name: 'Item', price: 0, image: 'assets/milvanta-cow-milk.jpg', size: '' };
    const size = entry.variant?.size || entry.size || p.size;
    const price = entry.variant?.price || entry.price || p.price;
    const key = encodeURIComponent(size || '');

    const isContinuous = entry.isContinuousMonthsPlan || entry.variant?.isContinuousMonthsPlan || entry.isSubscriptionPlan || entry.variant?.isSubscriptionPlan;

    let subBadgeHtml = '';
    if (isContinuous) {
      subBadgeHtml = `<div style="margin-top: 4px;"><span style="display:inline-flex; align-items:center; gap:4px; font-size:0.7rem; font-weight:700; color:#0369a1; background:#e0f2fe; border:1px solid #bae6fd; border-radius:4px; padding:2px 6px;">🥛 Daily Milk Subscription</span></div>`;
    }

    return `
      <div class="cart-item">
        <img class="cart-image" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">
        <div class="cart-details">
          <h4>${escapeHtml(p.name)}</h4>
          <p>${escapeHtml(size)}</p>
          ${subBadgeHtml}
          <button class="remove-item" type="button" data-remove="${p.id}" data-variant="${key}">Remove</button>
        </div>
        <div class="cart-amount">
          <strong>₹${(price * entry.quantity).toFixed(0)}</strong>
          <div class="cart-quantity">
            <button type="button" data-cart-minus="${p.id}" data-variant="${key}" aria-label="Decrease quantity">−</button>
            <span>${entry.quantity}</span>
            <button type="button" data-cart-plus="${p.id}" data-variant="${key}" aria-label="Increase quantity">+</button>
          </div>
        </div>
      </div>`;
  }).join('');

  const deliveryHelper = window.MilvantaDelivery;
  const pin = localStorage.getItem('milvanta-pincode') || '500049';
  const info = deliveryHelper ? deliveryHelper.getDeliveryInfo(pin) : { fee: 50 };
  const deliveryFee = (info && info.fee) ? Number(info.fee) : 50;
  const grandTotal = subtotal + deliveryFee;

  const hasContinuousSub = valid.some((entry) => entry.isContinuousMonthsPlan || entry.variant?.isContinuousMonthsPlan);
  const checkoutBtnText = hasContinuousSub 
    ? `Proceed to Subscription Checkout · ₹${grandTotal.toFixed(0)}` 
    : `Place order · ₹${grandTotal.toFixed(0)}`;
  const checkoutSubNote = hasContinuousSub
    ? `<div style="font-size:0.75rem; color:#0369a1; text-align:center; margin-bottom:8px; font-weight:600;">Includes Continuous Months Subscription payment</div>`
    : '';

  content.innerHTML = `
    <div class="cart-items-list">${itemsHtml}</div>
    <div class="cart-drawer-footer" style="margin-top: auto; padding: 14px 0 6px; border-top: 1px solid var(--border); background: var(--card-bg); position: sticky; bottom: 0;">
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 0.85rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Items Subtotal (${totalItems} ${totalItems === 1 ? 'item' : 'items'})</span>
          <span style="font-weight: 600; color: var(--text);">₹${subtotal.toFixed(0)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Delivery charges</span>
          <span style="font-weight: 700; color: #0f172a;">₹${deliveryFee}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px;">
          <span style="font-size: 0.95rem; font-weight: 700; color: var(--text);">Total Amount</span>
          <span style="font-size: 1.25rem; font-weight: 800; color: #0a3d66;">₹${grandTotal.toFixed(0)}</span>
        </div>
      </div>
      ${checkoutSubNote}
      <button class="primary-cart place-order-btn" id="cartPlaceOrderBtn" type="button" data-place-order style="width: 100%; font-size: 1rem; padding: 14px 20px; font-weight: 700; border-radius: var(--radius-sm); border: none; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 8px;">
        ${checkoutBtnText}
      </button>
    </div>
  `;
  updateBadge();
}

function setCartOpen(open) {
  const drawer = $('#cartDrawer');
  if (!drawer) return;
  drawer.classList.toggle('open', open);
  document.body.classList.toggle('cart-open', open);
  $('#cartToggle')?.setAttribute('aria-expanded', String(open));
}
window.addToCart = addToCart;
window.setCartOpen = setCartOpen;
window.openProductModal = openProductModal;
window.state = state;

// Account Authentication Modal & Forgot Password Flow
let forgotState = {
  email: '',
  resetToken: ''
};

function setForgotStep(step) {
  $('#accountMessage').textContent = '';
  $('#forgotStepEmailForm')?.classList.toggle('hidden', step !== 'email');
  $('#forgotStepOtpForm')?.classList.toggle('hidden', step !== 'otp');
  $('#forgotStepResetForm')?.classList.toggle('hidden', step !== 'reset');

  if (step === 'email') {
    $('#accountTitle').textContent = 'Reset Your Password';
    const emailInput = $('#forgotEmailInput');
    const loginEmail = $('#accountForm input[name="email"]')?.value?.trim();
    if (emailInput && loginEmail && !emailInput.value) {
      emailInput.value = loginEmail;
    }
    setTimeout(() => emailInput?.focus(), 50);
  } else if (step === 'otp') {
    $('#accountTitle').textContent = 'Enter Verification Code';
    if ($('#forgotOtpDesc')) {
      const emailDisplay = forgotState.email ? `<strong>${escapeHtml(forgotState.email)}</strong>` : 'your registered email';
      $('#forgotOtpDesc').innerHTML = `Enter the 6-digit verification OTP sent to ${emailDisplay}.`;
    }
    const otpInput = $('#forgotOtpInput');
    if (otpInput) {
      otpInput.value = '';
      setTimeout(() => otpInput.focus(), 50);
    }
  } else if (step === 'reset') {
    $('#accountTitle').textContent = 'Create New Password';
    const newPass = $('#forgotNewPassword');
    const confPass = $('#forgotConfirmPassword');
    if (newPass) newPass.value = '';
    if (confPass) confPass.value = '';
    setTimeout(() => newPass?.focus(), 50);
  }
}

function setAccountMode(mode) {
  state.accountMode = mode;
  const registering = mode === 'register';
  const isForgot = mode === 'forgot';

  if (isForgot) {
    $('#accountTitle').textContent = 'Reset Your Password';
    $('#accountForm')?.classList.add('hidden');
    $('#accountSwitch')?.classList.add('hidden');
    $('#forgotPasswordContainer')?.classList.remove('hidden');
    setForgotStep('email');
    $('#accountMessage').textContent = '';
    return;
  }

  // Normal Sign-In or Register
  $('#forgotPasswordContainer')?.classList.add('hidden');
  $('#accountForm')?.classList.remove('hidden');
  $('#accountSwitch')?.classList.remove('hidden');
  $('#forgotPasswordLinkWrap')?.classList.toggle('hidden', registering);

  $('#accountTitle').textContent = registering ? 'Create your account' : 'Sign in to your account';
  $('#accountSubmit').textContent = registering ? 'Create Account' : 'Sign In';
  $('#accountSwitch').textContent = registering ? 'Already have an account? Sign in' : 'New to Milvanta? Create an account';
  
  document.querySelectorAll('.signup-field').forEach((field) => {
    field.classList.toggle('hidden', !registering);
    const input = field.querySelector('input');
    if (input) {
      if (input.name === 'name' || input.name === 'confirmPassword') {
        input.required = registering;
      }
    }
  });
  $('#accountMessage').textContent = '';
}

function openAccount() {
  $('#accountModal')?.classList.remove('hidden');
  $('#accountModal')?.setAttribute('aria-hidden', 'false');
  $('#accountForm')?.classList.toggle('hidden', Boolean(state.customer));
  $('#accountSwitch')?.classList.toggle('hidden', Boolean(state.customer));
  $('#forgotPasswordContainer')?.classList.add('hidden');
  $('#accountProfile')?.classList.toggle('hidden', !state.customer);

  if (state.customer) {
    $('#accountTitle').textContent = 'My Account';
    $('#accountGreeting').textContent = `Signed in as ${state.customer.full_name || state.customer.name || ''} · ${state.customer.email}`;
    $('#tabAdminBtn')?.classList.toggle('hidden', !Boolean(state.customer.is_admin));
    switchAccountTab(state.accountTab || 'orders');
  } else {
    setAccountMode(state.accountMode || 'login');
  }
}

function closeAccount() {
  $('#accountModal')?.classList.add('hidden');
  $('#accountModal')?.setAttribute('aria-hidden', 'true');
}

function switchAccountTab(tab) {
  state.accountTab = tab;
  $('#tabProfileBtn')?.classList.toggle('active', tab === 'profile');
  $('#tabOrdersBtn')?.classList.toggle('active', tab === 'orders');
  $('#tabAddressesBtn')?.classList.toggle('active', tab === 'addresses');
  $('#tabAdminBtn')?.classList.toggle('active', tab === 'admin');

  $('#profileDetailsSection')?.classList.toggle('hidden', tab !== 'profile');
  $('#profileOrdersSection')?.classList.toggle('hidden', tab !== 'orders');
  $('#profileAddressesSection')?.classList.toggle('hidden', tab !== 'addresses');

  if (tab === 'orders') {
    loadOrderHistory();
  } else if (tab === 'addresses') {
    loadSavedAddresses();
  } else if (tab === 'admin') {
    closeAccount();
    openAdminOrders();
  }
}

async function loadOrderHistory() {
  const history = $('#orderHistory');
  if (!history) return;
  history.textContent = 'Loading your orders…';
  try {
    const { orders } = await apiRequest('/api/v1/orders');
    if (!orders || !orders.length) {
      history.textContent = 'You have not placed any orders yet.';
      return;
    }
    history.innerHTML = orders.map((order) => `
      <article class="order-card" style="padding:14px; border:1px solid var(--border); border-radius:var(--radius-sm); margin-bottom:12px; background:#fff;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; align-items:center;">
          <strong>Order #${escapeHtml(order.order_number || 'N/A')}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted);">${new Date(order.created_at).toLocaleDateString()}</span>
        </div>
        <p style="font-size:0.8rem; margin:6px 0; color:var(--text-muted);">${(order.items || []).map((x) => `${escapeHtml(x.name)} × ${x.quantity}`).join(', ')}</p>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
          <div>
            <span class="status-badge ${escapeHtml(order.order_status || 'placed')}">${escapeHtml(order.order_status || 'placed')}</span>
            <strong style="margin-left:8px; font-size:0.88rem;">₹${(Number(order.total_paise) / 100).toFixed(0)}</strong>
          </div>
          <button type="button" class="address-action-btn" data-track-order="${escapeHtml(order.order_number)}" style="background:var(--primary-light); color:var(--primary); border-color:var(--primary-border);">
            📍 Track Order
          </button>
        </div>
      </article>
    `).join('');
  } catch (error) {
    history.textContent = error.message;
  }
}

async function loadSavedAddresses() {
  const container = $('#savedAddressesList');
  if (!container) return;
  container.textContent = 'Loading delivery addresses…';
  try {
    const { addresses } = await apiRequest('/api/v1/addresses');
    state.savedAddresses = Array.isArray(addresses) ? addresses : [];
    
    // Auto populate address draft if available and default exists
    if (!state.addressDraft.name && state.savedAddresses.length > 0) {
      const def = state.savedAddresses.find((a) => a.is_default) || state.savedAddresses[0];
      state.addressDraft = { ...def };
    }

    if (!state.savedAddresses.length) {
      container.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted);">No saved addresses found. Add one below for faster checkout!</p>';
      return;
    }

    container.innerHTML = state.savedAddresses.map((addr) => `
      <div class="address-card ${addr.is_default ? 'is-default' : ''}">
        <div class="address-card-header">
          <span class="address-card-name">${escapeHtml(addr.name)}</span>
          ${addr.is_default ? '<span class="address-card-badge">Default</span>' : ''}
        </div>
        <p class="address-card-text">
          📞 ${escapeHtml(addr.phone)}<br>
          ${escapeHtml(addr.house)}, ${escapeHtml(addr.building)}, ${escapeHtml(addr.street)}${addr.landmark ? `, Near ${escapeHtml(addr.landmark)}` : ''}<br>
          ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} - <strong>${escapeHtml(addr.pincode)}</strong>
        </p>
        <div class="address-card-actions">
          ${!addr.is_default ? `<button type="button" class="address-action-btn" data-set-default="${addr.id}">Set as Default</button>` : ''}
          <button type="button" class="address-action-btn btn-danger" data-delete-address="${addr.id}">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    container.textContent = error.message;
  }
}

// Order Tracking Modal & Progress Stepper
async function openTrackingModal(orderNumber) {
  const modal = $('#orderTrackingModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  $('#trackingTitle').textContent = `Order #${orderNumber}`;
  $('#trackingOrderMeta').textContent = 'Loading tracking details…';
  $('#trackingAuditLog').innerHTML = '';

  try {
    const data = await apiRequest(`/api/v1/orders/${encodeURIComponent(orderNumber)}/track`);
    const order = data.order;
    const history = data.history || [];

    $('#trackingTitle').textContent = `Order #${order.orderNumber}`;
    $('#trackingOrderMeta').textContent = `Placed on ${new Date(order.createdAt).toLocaleDateString()} at ${new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    
    const badge = $('#trackingStatusBadge');
    if (badge) {
      badge.textContent = order.orderStatus;
      badge.className = `status-badge ${order.orderStatus}`;
    }

    // Update 6-stage Stepper
    const stages = ['placed', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
    const currentIdx = stages.indexOf(order.orderStatus);
    
    document.querySelectorAll('.tracking-step').forEach((step) => {
      const stepName = step.dataset.step;
      const stepIdx = stages.indexOf(stepName);
      step.classList.remove('done', 'current');
      if (order.orderStatus === 'cancelled') {
        // Special case
      } else if (stepIdx < currentIdx) {
        step.classList.add('done');
      } else if (stepIdx === currentIdx) {
        step.classList.add('current');
      }
    });

    // Courier Details
    $('#trackingCourierName').textContent = order.courierName || 'Milvanta Cold-Chain Fleet';
    $('#trackingNumberCode').textContent = order.trackingNumber || `MV-ROUTE-${order.orderNumber.slice(-6)}`;
    if (order.estimatedDelivery) {
      $('#trackingEstDelivery').textContent = new Date(order.estimatedDelivery).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } else {
      $('#trackingEstDelivery').textContent = 'Next Morning by 7:00 AM';
    }

    // Audit logs
    if (history.length > 0) {
      $('#trackingAuditLog').innerHTML = history.map((h) => `
        <div class="audit-entry">
          <div style="font-weight:700; color:var(--text); text-transform:capitalize;">${escapeHtml(h.new_status)}</div>
          <div style="color:var(--text-muted);">${escapeHtml(h.note || 'Status updated')}</div>
          <div class="audit-timestamp">${new Date(h.created_at).toLocaleString()}</div>
        </div>
      `).join('');
    } else {
      $('#trackingAuditLog').innerHTML = `
        <div class="audit-entry">
          <div style="font-weight:700;">Order Created</div>
          <div class="audit-timestamp">${new Date(order.createdAt).toLocaleString()}</div>
        </div>`;
    }

    // Items & Address Summary
    $('#trackingTotalAmount').textContent = `₹${(Number(order.totalPaise) / 100).toFixed(0)}`;
    $('#trackingItemsList').textContent = (order.items || []).map((x) => `${x.name} (${x.unit}) × ${x.quantity}`).join(' · ');
    const addr = order.address || {};
    $('#trackingAddressText').textContent = `${addr.name}, ${addr.house}, ${addr.building}, ${addr.street}, ${addr.city} - ${addr.pincode} (Ph: ${addr.phone})`;
  } catch (error) {
    $('#trackingOrderMeta').textContent = `Could not load tracking: ${error.message}`;
  }
}

function closeTrackingModal() {
  $('#orderTrackingModal')?.classList.add('hidden');
  $('#orderTrackingModal')?.setAttribute('aria-hidden', 'true');
}

// Admin Portal Logic
async function openAdminOrders() {
  const modal = $('#adminOrdersModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  await refreshAdminOrders();
}

function closeAdminOrders() {
  $('#adminOrdersModal')?.classList.add('hidden');
  $('#adminOrdersModal')?.setAttribute('aria-hidden', 'true');
  $('#adminUpdateDrawer')?.classList.add('hidden');
}

async function refreshAdminOrders() {
  const tbody = $('#adminOrdersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">Fetching latest orders…</td></tr>';
  
  try {
    const [ordersData, statsData] = await Promise.all([
      apiRequest('/api/v1/admin/orders'),
      apiRequest('/api/v1/admin/stats')
    ]);

    state.adminOrders = ordersData.orders || [];

    // Stats
    $('#adminStatTotal').textContent = statsData.totalOrders || 0;
    $('#adminStatActive').textContent = statsData.activeOrders || 0;
    $('#adminStatDelivered').textContent = statsData.deliveredOrders || 0;
    $('#adminStatRevenue').textContent = `₹${((statsData.totalRevenuePaise || 0) / 100).toLocaleString('en-IN')}`;

    renderAdminOrdersTable(state.adminOrders);
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#b91c1c;">Error: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderAdminOrdersTable(orders) {
  const tbody = $('#adminOrdersTableBody');
  if (!tbody) return;

  const search = ($('#adminSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = $('#adminStatusFilter')?.value || 'all';

  const filtered = orders.filter((o) => {
    const matchesStatus = statusFilter === 'all' || o.order_status === statusFilter;
    const searchStr = `${o.order_number} ${o.customer_name || ''} ${o.customer_email || ''} ${o.courier_name || ''} ${o.tracking_number || ''}`.toLowerCase();
    const matchesSearch = !search || searchStr.includes(search);
    return matchesStatus && matchesSearch;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">No orders match the selected filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((o) => `
    <tr>
      <td><strong>${escapeHtml(o.order_number)}</strong><br><span style="font-size:0.7rem; color:var(--text-muted);">${new Date(o.created_at).toLocaleDateString()}</span></td>
      <td><strong>${escapeHtml(o.customer_name || 'Customer')}</strong><br><span style="font-size:0.7rem; color:var(--text-muted);">${escapeHtml(o.customer_email)}</span></td>
      <td style="max-width:180px;"><span style="font-size:0.75rem;">${(o.items || []).map((x) => `${x.name} × ${x.quantity}`).join(', ')}</span></td>
      <td><strong>₹${(Number(o.total_paise) / 100).toFixed(0)}</strong></td>
      <td><span class="status-badge ${escapeHtml(o.order_status)}">${escapeHtml(o.order_status)}</span></td>
      <td><span class="status-badge ${o.payment_status === 'paid' ? 'delivered' : 'pending'}">${escapeHtml(o.payment_status)}</span></td>
      <td><span style="font-size:0.75rem;">${escapeHtml(o.courier_name || 'Standard Cold-Chain')}<br><small style="color:var(--text-muted);">${escapeHtml(o.tracking_number || 'N/A')}</small></span></td>
      <td>
        <button type="button" class="address-action-btn" data-admin-manage="${escapeHtml(o.order_number)}" style="background:var(--primary-light); color:var(--primary); border-color:var(--primary-border);">
          Manage
        </button>
      </td>
    </tr>
  `).join('');
}

function openAdminUpdateDrawer(orderNumber) {
  const order = (state.adminOrders || []).find((o) => o.order_number === orderNumber);
  if (!order) return;

  const drawer = $('#adminUpdateDrawer');
  if (!drawer) return;
  drawer.classList.remove('hidden');

  $('#updateDrawerOrderNum').textContent = order.order_number;
  $('#adminStatusForm').dataset.orderNumber = order.order_number;
  $('#adminUpdateStatusSelect').value = order.order_status;
  $('#adminUpdateCourier').value = order.courier_name || 'Milvanta Cold-Chain Fleet';
  $('#adminUpdateTracking').value = order.tracking_number || '';
  $('#adminUpdateNote').value = '';
  $('#adminUpdateMessage').textContent = '';
  drawer.scrollIntoView({ behavior: 'smooth' });
}

async function restoreSession() {
  if (!API_URL || !authToken) {
    updateAccountButton();
    return;
  }
  try {
    const data = await apiRequest('/api/v1/auth/me');
    state.customer = data.customer || data.user;
    if (state.customer && !state.customer.full_name) state.customer.full_name = state.customer.name || '';
    state.csrfToken = data.csrfToken || '';
    updateAccountButton();
    renderCart();
  } catch {
    state.customer = null;
    updateAccountButton();
  }
}

function updateAccountButton() {
  const btn = $('#accountToggle');
  const loggedOutIcon = $('#accountLoggedOutIcon');
  const label = $('#accountBtnText');
  const avatar = $('#accountAvatarCircle');
  const chevron = $('#accountChevronIcon');
  const dropdown = $('#userAccountDropdown');
  const dropdownName = $('#userDropdownName');
  const dropdownSub = $('#userDropdownSub');
  const userMenuAdmin = $('#userMenuAdmin');

  if (state.customer) {
    const fullName = (state.customer.full_name || state.customer.name || 'Akhil').trim();
    const initial = fullName ? fullName.charAt(0).toUpperCase() : 'A';
    const phone = state.customer.phone || '';
    const email = state.customer.email || '';

    btn?.classList.add('is-logged-in');
    loggedOutIcon?.classList.add('hidden');
    label?.classList.add('hidden');
    
    if (avatar) {
      avatar.textContent = initial;
      avatar.classList.remove('hidden');
    }
    chevron?.classList.remove('hidden');

    if (dropdownName) dropdownName.textContent = fullName;
    if (dropdownSub) dropdownSub.textContent = phone || email;
    if (userMenuAdmin) userMenuAdmin.classList.toggle('hidden', !Boolean(state.customer.is_admin));

    const profileAvatarLarge = $('#profileAvatarLarge');
    const profileFullName = $('#profileFullName');
    const profilePhone = $('#profilePhone');
    const profileEmail = $('#profileEmail');
    if (profileAvatarLarge) profileAvatarLarge.textContent = initial;
    if (profileFullName) profileFullName.textContent = fullName;
    if (profilePhone) profilePhone.textContent = phone || 'Not provided';
    if (profileEmail) profileEmail.textContent = email;
  } else {
    btn?.classList.remove('is-logged-in', 'is-open');
    dropdown?.classList.add('hidden');
    loggedOutIcon?.classList.remove('hidden');
    if (label) {
      label.textContent = 'Sign In';
      label.classList.remove('hidden');
    }
    avatar?.classList.add('hidden');
    chevron?.classList.add('hidden');
  }
}

function toggleAccountMenu(e) {
  if (e) e.stopPropagation();
  if (state.customer) {
    const dropdown = $('#userAccountDropdown');
    const btn = $('#accountToggle');
    const isHidden = dropdown?.classList.contains('hidden');
    if (isHidden) {
      dropdown?.classList.remove('hidden');
      btn?.classList.add('is-open');
      btn?.setAttribute('aria-expanded', 'true');
    } else {
      closeUserDropdown();
    }
  } else {
    openAccount();
  }
}

function closeUserDropdown() {
  const dropdown = $('#userAccountDropdown');
  const btn = $('#accountToggle');
  dropdown?.classList.add('hidden');
  btn?.classList.remove('is-open');
  btn?.setAttribute('aria-expanded', 'false');
}

window.updateAccountButton = updateAccountButton;
window.toggleAccountMenu = toggleAccountMenu;

function updatePincodeDisplays(pin) {
  const delivery = window.MilvantaDelivery;
  const info = delivery ? delivery.getDeliveryInfo(pin) : { shortArea: 'Hafeezpet', fee: 50 };
  const areaName = (info.inHyderabad && info.shortArea) ? info.shortArea : (state.area || 'Hafeezpet');

  const headerLocEl = $('#currentLocationText');
  if (headerLocEl) {
    headerLocEl.textContent = areaName;
  }
  const headerBtn = $('#headerLocationBtn');
  if (headerBtn) {
    headerBtn.title = `Delivering to ${info.area || areaName}, Hyderabad (${pin}) · Click to change`;
  }

  const drawerLocEl = $('#currentLocationDrawer') || $('#mobileLocationCity');
  if (drawerLocEl) {
    drawerLocEl.textContent = areaName;
  }
  document.querySelectorAll('#currentPincodeText, #currentPincodeHeader, #currentPincodeDrawer').forEach((el) => {
    if (el) el.textContent = pin;
  });
}

// Razorpay Script Injection
async function ensureRazorpayScript() {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Razorpay Checkout failed to load.'));
    document.head.append(script);
  });
}

// Checkout initiation
async function beginCheckout(form) {
  if (!state.customer) {
    openAccount();
    throw new Error('Please sign in before placing an order.');
  }
  state.checkoutNotice = '';
  state.checkoutBusy = true;
  renderCart();

  try {
    await ensureRazorpayScript();
    const values = Object.fromEntries(new FormData(form).entries());
    state.addressDraft = values;

    const delivery = window.MilvantaDelivery;
    const deliveryInfo = delivery ? delivery.getDeliveryInfo(values.pincode) : { serviceable: true };
    if (!deliveryInfo.inHyderabad) {
      throw new Error(`Milvanta delivers across Hyderabad (500001–500096). PIN code ${values.pincode} is outside Hyderabad.`);
    }
    if (!deliveryInfo.serviceable) {
      throw new Error(deliveryInfo.message || `Delivery is currently available across Hyderabad (500001–500096).`);
    }

    const orderBody = {
      address: values,
      items: state.cart.map((entry) => ({
        productId: Number(entry.id) === 101 ? 1 : (Number(entry.id) === 102 ? 2 : Number(entry.id)),
        quantity: Number(entry.quantity) || 1,
        size: entry.variant?.size || entry.size || '',
        customPricePaise: entry.variant?.price ? Math.round(Number(entry.variant.price) * 100) : (entry.price ? Math.round(Number(entry.price) * 100) : undefined),
        notes: entry.variant?.subscriptionPlan ? `${entry.variant.subscriptionPlan.durationLabel} @ ₹${entry.variant.subscriptionPlan.dailyRate}/day` : undefined
      }))
    };
    const fingerprint = JSON.stringify(orderBody);

    if (!state.checkoutKey || fingerprint !== state.checkoutFingerprint) {
      state.checkoutKey = crypto.randomUUID();
      state.checkoutFingerprint = fingerprint;
      try {
        sessionStorage.setItem('milvanta-checkout-key', state.checkoutKey);
        sessionStorage.setItem('milvanta-checkout-fingerprint', fingerprint);
      } catch {}
    }

    const order = await apiRequest('/api/v1/orders', {
      method: 'POST',
      csrf: true,
      headers: { 'Idempotency-Key': state.checkoutKey },
      body: JSON.stringify(orderBody)
    });

    state.checkoutStep = 3;
    renderCart();

    const deliveryFee = deliveryInfo.fee || 50;
    const cartSubtotal = state.cart.reduce((sum, item) => {
      const p = state.products?.find((prod) => Number(prod.id) === Number(item.id)) || {};
      const price = Number(item.variant?.price || item.price || p.price || 0);
      return sum + price * (Number(item.quantity) || 1);
    }, 0);
    const expectedTotalPaise = Math.round((cartSubtotal + deliveryFee) * 100);
    const razorpayAmount = (order && Number(order.amount) >= expectedTotalPaise)
      ? Number(order.amount)
      : (Number(order?.amount) || expectedTotalPaise);

    const checkout = new window.Razorpay({
      key: order.keyId || window.RAZORPAY_KEY_ID || 'rzp_test_TMT4s342RfwceX',
      amount: razorpayAmount,
      currency: order.currency || 'INR',
      name: 'Milvanta',
      // Only bind order_id if server amount includes full total; otherwise omit order_id so Razorpay charges expectedTotalPaise
      ...(order.orderId && Number(order.amount) >= expectedTotalPaise ? { order_id: order.orderId } : {}),
      handler: async (payment) => {
        try {
          const result = await apiRequest('/api/v1/payments/verify', { method: 'POST', csrf: true, body: JSON.stringify(payment) });
          if (result.status === 'captured') {
            state.cart = [];
            state.addressDraft = {};
            state.checkoutStep = 1;
            saveCart();
          }
          state.checkoutNotice = `Payment confirmed! Order ${order.orderNumber} is in your order history.`;
          renderCart();
          updateBadge();
        } catch (error) {
          const target = $('#checkoutMessage');
          if (target) target.textContent = `Payment verification: ${error.message}`;
        }
      },
      modal: {
        ondismiss: () => {
          const target = $('#checkoutMessage');
          if (target) target.textContent = 'Payment cancelled. Reserved items will be restored.';
        }
      }
    });

    checkout.open();
  } catch (error) {
    throw error;
  } finally {
    state.checkoutBusy = false;
    renderCart();
  }
}

// Helpers
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Pincode Checker Modal
function openPincodeModal() {
  const modal = $('#pincodeModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  $('#pincodeInput').value = state.pincode;
  $('#pincodeFeedback').textContent = '';
  $('#pincodeInput')?.focus();
}

function closePincodeModal() {
  $('#pincodeModal')?.classList.add('hidden');
}

// Policy Modal
function openPolicyModal(key) {
  const policy = POLICIES[key];
  if (!policy) return;
  $('#policyTitle').textContent = policy.title;
  $('#policyContent').innerHTML = policy.html;
  $('#policyModal')?.classList.remove('hidden');
}

function closePolicyModal() {
  $('#policyModal')?.classList.add('hidden');
}

function checkSubscriptionReturn() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('subscription') === 'success' || urlParams.get('sub_success') === '1' || urlParams.get('sub_success') === 'true') {
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    setTimeout(() => {
      showStoreToast('🥛 Morning Milk Subscription Activated! Your fresh delivery starts tomorrow at 6:00 AM.', 'profile.html?tab=subscription');
    }, 500);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  renderCategories();
  renderCatalog();
  renderCart();
  updateBadge();
  loadCatalog();
  restoreSession();
  updatePincodeDisplays(state.pincode);
  updateAccountButton();
  checkSubscriptionReturn();

  // Search
  $('#searchInput')?.addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    renderCatalog();
  });

  $('#clearSearch')?.addEventListener('click', () => {
    $('#searchInput').value = '';
    state.searchTerm = '';
    renderCatalog();
  });

  // Cart open / close
  $('#cartToggle')?.addEventListener('click', () => setCartOpen(true));
  $('#closeCart')?.addEventListener('click', () => setCartOpen(false));
  $('#cartScrim')?.addEventListener('click', () => setCartOpen(false));
  if (window.location.hash === '#cart') {
    setCartOpen(true);
  }

  // Account & User Dropdown
  $('#accountToggle')?.addEventListener('click', toggleAccountMenu);
  $('#accountClose')?.addEventListener('click', closeAccount);
  $('#accountSwitch')?.addEventListener('click', () => setAccountMode(state.accountMode === 'login' ? 'register' : 'login'));
  $('#btnForgotPassword')?.addEventListener('click', () => setAccountMode('forgot'));
  $('#btnBackToSignIn')?.addEventListener('click', () => setAccountMode('login'));
  $('#tabProfileBtn')?.addEventListener('click', () => switchAccountTab('profile'));

  // User Dropdown Item Actions
  $('#userMenuProfile')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeUserDropdown();
    window.location.href = 'profile.html?tab=profile';
  });
  $('#userMenuOrders')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeUserDropdown();
    window.location.href = 'profile.html?tab=orders';
  });
  $('#userMenuAddresses')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeUserDropdown();
    window.location.href = 'profile.html?tab=addresses';
  });
  $('#userMenuSubscription')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeUserDropdown();
    window.location.href = 'profile.html?tab=subscription';
  });
  $('#userMenuAdmin')?.addEventListener('click', () => {
    closeUserDropdown();
    openAdminOrders();
  });
  $('#userMenuLogout')?.addEventListener('click', async () => {
    closeUserDropdown();
    try { await apiRequest('/api/v1/auth/logout', { method: 'POST' }); } catch {}
    setAuthToken('');
    state.customer = null;
    state.savedAddresses = [];
    updateAccountButton();
    closeAccount();
    renderCart();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const wrapper = $('#accountMenuWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      closeUserDropdown();
    }
  });

  // Modals close
  $('#modalClose')?.addEventListener('click', closeProductModal);
  $('#recipeClose')?.addEventListener('click', closeRecipeModal);
  $('#policyClose')?.addEventListener('click', closePolicyModal);
  $('#pincodeClose')?.addEventListener('click', closePincodeModal);
  $('#headerLocationBtn')?.addEventListener('click', openPincodeModal);
  $('#mobileLocBtn')?.addEventListener('click', () => {
    setNavOpen(false);
    openPincodeModal();
  });

  // View Recipe trigger from product modal
  $('#modalViewRecipe')?.addEventListener('click', () => {
    const id = Number($('#modalViewRecipe').dataset.productId || state.activeProductId);
    closeProductModal();
    openRecipeModal(id);
  });

  // Carousel Arrow Controls
  $('#prevBtn')?.addEventListener('click', () => {
    const list = visibleProducts();
    if (list.length <= 1) return;
    state.carouselIndex = (state.carouselIndex - 1 + list.length) % list.length;
    updateCarouselPositions();
  });

  $('#nextBtn')?.addEventListener('click', () => {
    const list = visibleProducts();
    if (list.length <= 1) return;
    state.carouselIndex = (state.carouselIndex + 1) % list.length;
    updateCarouselPositions();
  });

  // Mobile Swipe Gestures on Carousel
  let touchStartX = 0;
  let touchStartY = 0;
  let isTouching = false;
  const carouselWrapper = $('#carouselWrapper');
  if (carouselWrapper) {
    carouselWrapper.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isTouching = true;
      }
    }, { passive: true });

    carouselWrapper.addEventListener('touchend', (e) => {
      if (!isTouching || !e.changedTouches || !e.changedTouches[0]) return;
      isTouching = false;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;
      if (Math.abs(diffX) > 35 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
        const list = visibleProducts();
        if (list.length > 1) {
          if (diffX < 0) {
            state.carouselIndex = (state.carouselIndex + 1) % list.length;
          } else {
            state.carouselIndex = (state.carouselIndex - 1 + list.length) % list.length;
          }
          updateCarouselPositions();
        }
      }
    }, { passive: true });
  }

  window.addEventListener('resize', () => {
    updateCarouselPositions();
  });

  // Close modals when clicking on background backdrop
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeProductModal();
        closeRecipeModal();
        closeAccount();
        closePolicyModal();
        closePincodeModal();
      }
    });
  });


  // Variant change
  $('#variantSelect')?.addEventListener('change', (e) => {
    const p = products.find((item) => item.id === state.activeProductId);
    if (!p || !p.variants) return;
    state.selectedVariant = p.variants[Number(e.target.value)];
    $('#modalPrice').textContent = `₹${state.selectedVariant.price}`;
    if (state.purchaseMode === 'subscription') {
      updateSubscriptionSummary();
    } else {
      updateModalAddToCartBtn();
    }
  });

  // Modal Add To Cart
  $('#modalAddToCart')?.addEventListener('click', () => {
    if (state.activeProductId) {
      const p = products.find((item) => item.id === state.activeProductId);
      if (p && state.purchaseMode === 'subscription' && isFreshMilkProduct(p)) {
        handleContinuousMonthsAddToCart(p);
        return;
      }
      addToCart(state.activeProductId, state.modalQty, state.selectedVariant);
      closeProductModal();
      setCartOpen(true);
    }
  });

  // Pack Size Dropdown (Daily Subscription)
  $('#subPackSizeSelect')?.addEventListener('change', (e) => {
    const p = findProductById(state.activeProductId);
    if (!p) return;
    const chosenSize = e.target.value;
    const rates = getMilkSubscriptionRates(p, chosenSize);
    state.selectedVariant = {
      size: chosenSize,
      price: rates.dailyRate,
      dailyRate: rates.dailyRate,
      oneTimeRate: rates.oneTimeRate,
      litres: rates.litres
    };
    $('#modalPrice').textContent = `₹${rates.dailyRate} / day`;
    updateSubscriptionSummary();
  });

  // Milk Subscription Mode Switching & Planner Event Listeners
  $('#btnModeOneTime')?.addEventListener('click', () => {
    setPurchaseMode('onetime');
  });

  $('#btnModeSub')?.addEventListener('click', () => {
    setPurchaseMode('subscription');
  });

  $('#subMonthSelect')?.addEventListener('change', () => {
    updateSubscriptionSummary();
  });

  $('#subStartMonthSelect')?.addEventListener('change', () => {
    updateSubscriptionSummary();
  });

  $('#subMonthsDec')?.addEventListener('click', () => {
    state.subMonthsCount = Math.max(1, (state.subMonthsCount || 1) - 1);
    updateSubscriptionSummary();
  });

  $('#subMonthsInc')?.addEventListener('click', () => {
    state.subMonthsCount = Math.min(12, (state.subMonthsCount || 1) + 1);
    updateSubscriptionSummary();
  });

  document.querySelectorAll('#subMonthQuickPills .sub-quick-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      state.subMonthsCount = parseInt(pill.dataset.months, 10) || 1;
      updateSubscriptionSummary();
    });
  });

  // Modal Stepper
  document.querySelectorAll('.qty-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.modalQty = Math.min(25, Math.max(1, state.modalQty + (btn.dataset.action === 'increase' ? 1 : -1)));
      $('#modalQty').textContent = state.modalQty;
      updateModalAddToCartBtn();
    });
  });

  // Dietary filter buttons
  document.querySelectorAll('.diet-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diet-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.dietaryFilter = btn.dataset.diet;
      state.carouselIndex = 1;
      renderCatalog();
    });
  });

  // Sort dropdown
  $('#sortSelect')?.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    state.carouselIndex = 1;
    renderCatalog();
  });

  // View All Button
  const handleViewAllAction = () => {
    if (state.viewMode === 'grid') {
      state.viewMode = 'carousel';
      state.selectedCategory = 'Baking Essentials';
      state.dietaryFilter = 'all';
      state.carouselIndex = 1;
      document.querySelectorAll('.diet-filter-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.diet === 'all');
      });
    } else {
      state.viewMode = 'grid';
      state.selectedCategory = 'All';
      state.searchTerm = '';
      if ($('#searchInput')) $('#searchInput').value = '';
    }
    renderCategories();
    renderCatalog();
  };
  $('#viewAllBtn')?.addEventListener('click', handleViewAllAction);
  $('.view-all')?.addEventListener('click', handleViewAllAction);

  // Navigation category links
  document.querySelectorAll('[data-category-nav]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const cat = link.dataset.categoryNav;
      if (cat) {
        state.selectedCategory = cat;
        if (cat === 'All') {
          state.viewMode = 'grid';
        } else {
          state.viewMode = 'carousel';
          state.carouselIndex = 1;
        }
        renderCategories();
        renderCatalog();
      }
    });
  });

  // Policy links
  document.querySelectorAll('.policy-btn').forEach((btn) => {
    btn.addEventListener('click', () => openPolicyModal(btn.dataset.policy));
  });

  // Pincode Form
  $('#pincodeForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = $('#pincodeInput').value.trim();
    const delivery = window.MilvantaDelivery;
    const info = delivery ? delivery.getDeliveryInfo(pin) : { valid: /^\d{6}$/.test(pin), inHyderabad: true, serviceable: true, shortArea: 'Hafeezpet', fee: 50 };

    if (!info.valid) {
      $('#pincodeFeedback').style.color = '#a8382c';
      $('#pincodeFeedback').textContent = 'Please enter a valid 6-digit PIN code.';
      return;
    }

    if (!info.inHyderabad) {
      $('#pincodeFeedback').style.color = '#a8382c';
      $('#pincodeFeedback').textContent = `❌ Milvanta delivers across Hyderabad (500001–500096). PIN code ${pin} is outside Hyderabad.`;
      return;
    }

    if (!info.serviceable) {
      $('#pincodeFeedback').style.color = '#d97706';
      $('#pincodeFeedback').textContent = info.message || `⚠️ PIN code ${pin} is outside our direct delivery zone.`;
      return;
    }

    state.pincode = pin;
    state.area = info.shortArea || info.area;
    localStorage.setItem('milvanta-pincode', pin);
    localStorage.setItem('milvanta-area', state.area);
    updatePincodeDisplays(pin);
    renderCart();

    $('#pincodeFeedback').style.color = '#15803d';
    $('#pincodeFeedback').textContent = `✓ Delivering to ${info.area} (~${info.distanceKm} km from Hafeezpet hub) · ₹${info.fee} delivery · 6:00 AM – 7:00 AM drop!`;
    setTimeout(closePincodeModal, 1400);
  });

  // Quick Pincode selection pills
  document.querySelectorAll('#quickPinPills .quick-pin-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pin = btn.dataset.pin;
      const input = $('#pincodeInput');
      if (input) {
        input.value = pin;
        $('#pincodeForm')?.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
  });

  // Account Tabs
  $('#tabOrdersBtn')?.addEventListener('click', () => switchAccountTab('orders'));
  $('#tabAddressesBtn')?.addEventListener('click', () => switchAccountTab('addresses'));
  $('#tabAdminBtn')?.addEventListener('click', () => switchAccountTab('admin'));
  $('#refreshOrdersBtn')?.addEventListener('click', loadOrderHistory);

  // Address Form toggle
  $('#toggleAddAddressBtn')?.addEventListener('click', () => {
    const form = $('#newAddressForm');
    if (form) form.classList.toggle('hidden');
  });

  $('#cancelAddAddressBtn')?.addEventListener('click', () => {
    $('#newAddressForm')?.classList.add('hidden');
  });

  // Add Address Form Submit
  $('#newAddressForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    $('#newAddressMessage').textContent = '';
    
    try {
      const formData = new FormData(form);
      const values = Object.fromEntries(formData.entries());
      values.is_default = Boolean(formData.get('is_default'));
      
      await apiRequest('/api/v1/addresses', {
        method: 'POST',
        body: JSON.stringify(values)
      });

      form.reset();
      form.classList.add('hidden');
      await loadSavedAddresses();
    } catch (err) {
      $('#newAddressMessage').textContent = err.message;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Tracking Modal Close
  $('#trackingClose')?.addEventListener('click', closeTrackingModal);

  // Admin Modal Controls
  $('#adminClose')?.addEventListener('click', closeAdminOrders);
  $('#adminRefreshBtn')?.addEventListener('click', refreshAdminOrders);
  $('#adminCancelUpdateBtn')?.addEventListener('click', () => {
    $('#adminUpdateDrawer')?.classList.add('hidden');
  });

  $('#adminSearchInput')?.addEventListener('input', () => {
    renderAdminOrdersTable(state.adminOrders || []);
  });

  $('#adminStatusFilter')?.addEventListener('change', () => {
    renderAdminOrdersTable(state.adminOrders || []);
  });

  // Admin Status Update Form
  $('#adminStatusForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const orderNumber = form.dataset.orderNumber;
    if (!orderNumber) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const msg = $('#adminUpdateMessage');
    if (msg) {
      msg.style.color = 'var(--primary)';
      msg.textContent = 'Saving status update…';
    }

    try {
      const formData = new FormData(form);
      const payload = {
        status: formData.get('status'),
        courierName: formData.get('courierName') || '',
        trackingNumber: formData.get('trackingNumber') || '',
        estimatedDelivery: formData.get('estimatedDelivery') || null,
        note: formData.get('note') || ''
      };

      await apiRequest(`/api/v1/admin/orders/${encodeURIComponent(orderNumber)}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });

      if (msg) {
        msg.style.color = 'var(--veg-color)';
        msg.textContent = '✓ Order status updated and recorded in tracking timeline!';
      }

      await refreshAdminOrders();
      setTimeout(() => {
        $('#adminUpdateDrawer')?.classList.add('hidden');
      }, 1000);
    } catch (err) {
      if (msg) {
        msg.style.color = '#b91c1c';
        msg.textContent = `Error: ${err.message}`;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Global click delegator
  document.addEventListener('click', async (event) => {
    // Round cart button from card
    const cardCartBtn = event.target.closest('[data-card-cart]');
    if (cardCartBtn) {
      event.stopPropagation();
      const id = Number(cardCartBtn.dataset.cardCart);
      addToCart(id, 1);
      return;
    }

    // Add related product from recipe modal
    const addRelatedBtn = event.target.closest('[data-add-related]');
    if (addRelatedBtn) {
      const id = Number(addRelatedBtn.dataset.addRelated);
      addToCart(id, 1);
      const originalText = addRelatedBtn.textContent;
      addRelatedBtn.textContent = '✓ Added';
      setTimeout(() => { addRelatedBtn.textContent = originalText; }, 1400);
      return;
    }

    // Track Order click
    const trackBtn = event.target.closest('[data-track-order]');
    if (trackBtn) {
      const orderNum = trackBtn.dataset.trackOrder;
      if (orderNum) openTrackingModal(orderNum);
      return;
    }

    // Address Set Default
    const setDefaultBtn = event.target.closest('[data-set-default]');
    if (setDefaultBtn) {
      const id = Number(setDefaultBtn.dataset.setDefault);
      try {
        await apiRequest(`/api/v1/addresses/${id}/default`, { method: 'PUT' });
        await loadSavedAddresses();
      } catch (err) {
        alert(`Could not set default address: ${err.message}`);
      }
      return;
    }

    // Address Delete
    const deleteAddrBtn = event.target.closest('[data-delete-address]');
    if (deleteAddrBtn) {
      const id = Number(deleteAddrBtn.dataset.deleteAddress);
      if (confirm('Are you sure you want to delete this address?')) {
        try {
          await apiRequest(`/api/v1/addresses/${id}`, { method: 'DELETE' });
          await loadSavedAddresses();
        } catch (err) {
          alert(`Could not delete address: ${err.message}`);
        }
      }
      return;
    }

    // Checkout Select Saved Address
    const selectSavedAddr = event.target.closest('[data-select-saved-addr]');
    if (selectSavedAddr) {
      const addrId = Number(selectSavedAddr.dataset.selectSavedAddr);
      const selected = (state.savedAddresses || []).find((a) => a.id === addrId);
      if (selected) {
        state.addressDraft = { ...selected };
        const form = $('#checkoutForm');
        if (form) {
          if (form.elements['name']) form.elements['name'].value = selected.name || '';
          if (form.elements['phone']) form.elements['phone'].value = selected.phone || '';
          if (form.elements['house']) form.elements['house'].value = selected.house || '';
          if (form.elements['building']) form.elements['building'].value = selected.building || '';
          if (form.elements['street']) form.elements['street'].value = selected.street || '';
          if (form.elements['landmark']) form.elements['landmark'].value = selected.landmark || '';
          if (form.elements['city']) form.elements['city'].value = selected.city || '';
          if (form.elements['state']) form.elements['state'].value = selected.state || '';
          if (form.elements['pincode']) {
            form.elements['pincode'].value = selected.pincode || '';
            form.elements['pincode'].dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }
      return;
    }

    // Admin Manage Order
    const adminManageBtn = event.target.closest('[data-admin-manage]');
    if (adminManageBtn) {
      const orderNum = adminManageBtn.dataset.adminManage;
      if (orderNum) openAdminUpdateDrawer(orderNum);
      return;
    }

    // Carousel dot click
    const dotBtn = event.target.closest('[data-dot-index]');
    if (dotBtn) {
      state.carouselIndex = Number(dotBtn.dataset.dotIndex);
      updateCarouselPositions();
      return;
    }

    // Add direct from card
    const addDirect = event.target.closest('[data-add-direct]');
    if (addDirect) {
      const id = Number(addDirect.dataset.addDirect);
      addToCart(id, 1);
      return;
    }

    // Card stepper plus / minus
    const cardPlus = event.target.closest('[data-card-plus]');
    if (cardPlus) {
      const id = Number(cardPlus.dataset.cardPlus);
      addToCart(id, 1);
      return;
    }

    const cardMinus = event.target.closest('[data-card-minus]');
    if (cardMinus) {
      const id = Number(cardMinus.dataset.cardMinus);
      updateCart(id, -1);
      return;
    }

    // Open modal from card
    const openModalBtn = event.target.closest('[data-open-modal]');
    if (openModalBtn) {
      openProductModal(Number(openModalBtn.dataset.openModal));
      return;
    }

    // Cart Drawer plus / minus / remove
    const cartPlus = event.target.closest('[data-cart-plus]');
    if (cartPlus) {
      updateCart(Number(cartPlus.dataset.cartPlus), 1, decodeURIComponent(cartPlus.dataset.variant || ''));
      return;
    }

    const cartMinus = event.target.closest('[data-cart-minus]');
    if (cartMinus) {
      updateCart(Number(cartMinus.dataset.cartMinus), -1, decodeURIComponent(cartMinus.dataset.variant || ''));
      return;
    }

    const remove = event.target.closest('[data-remove]');
    if (remove) {
      updateCart(Number(remove.dataset.remove), -999, decodeURIComponent(remove.dataset.variant || ''));
      return;
    }

    // Reset filters
    if (event.target.closest('[data-reset-filter]')) {
      state.selectedCategory = 'All';
      state.dietaryFilter = 'all';
      state.searchTerm = '';
      state.carouselIndex = 1;
      if ($('#searchInput')) $('#searchInput').value = '';
      renderCategories();
      renderCatalog();
      return;
    }

    // Browse more from empty cart
    if (event.target.closest('[data-browse-more]')) {
      setCartOpen(false);
      window.location.hash = '#products';
      return;
    }

    // Place order - require login before allowing into checkout page
    if (event.target.closest('[data-place-order]') || event.target.closest('#cartPlaceOrderBtn')) {
      const isLogged = Boolean(authToken || state.customer || localStorage.getItem('milvanta-user'));
      if (!isLogged) {
        sessionStorage.setItem('milvanta-pending-checkout', 'true');
        setCartOpen(false);
        openAccount();
        const msg = $('#accountMessage');
        if (msg) {
          msg.textContent = 'Please sign in or create an account to proceed to checkout.';
          msg.style.color = '#0a3d66';
        }
        return;
      }
      window.location.href = 'checkout.html';
      return;
    }
  });

  // Checkout address submit
  document.addEventListener('submit', (event) => {
    if (event.target.id === 'checkoutForm') {
      event.preventDefault();
      beginCheckout(event.target).catch((error) => {
        const msg = $('#checkoutMessage');
        if (msg) msg.textContent = error.message;
      });
    }
  });

  // Account submit with password confirmation validation
  $('#accountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#accountSubmit');
    btn.disabled = true;
    $('#accountMessage').textContent = 'Authenticating…';
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget).entries());
      if (state.accountMode === 'register') {
        if (!values.password || values.password.length < 8) {
          throw new Error('Password must be at least 8 characters long.');
        }
        if (values.password !== values.confirmPassword) {
          throw new Error('Passwords do not match. Please re-enter identical passwords.');
        }
        const { confirmPassword, ...signupPayload } = values;
        await apiRequest('/api/v1/auth/signup', { method: 'POST', body: JSON.stringify(signupPayload) });
      } else {
        await apiRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(values) });
      }
      const session = await apiRequest('/api/v1/auth/me');
      state.customer = session.customer || session.user;
      if (state.customer) {
        try {
          localStorage.setItem('milvanta-user', JSON.stringify(state.customer));
        } catch {}
      }
      $('#accountMessage').textContent = '';
      updateAccountButton();
      closeAccount();
      renderCart();

      // If user was attempting to place order, navigate directly to checkout
      if (sessionStorage.getItem('milvanta-pending-checkout') === 'true') {
        sessionStorage.removeItem('milvanta-pending-checkout');
        window.location.href = 'checkout.html';
        return;
      }
    } catch (err) {
      $('#accountMessage').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Forgot Password: Step 1 - Send OTP
  $('#forgotStepEmailForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btnSendForgotOtp');
    const email = $('#forgotEmailInput')?.value?.trim().toLowerCase();
    if (!email) return;

    btn.disabled = true;
    btn.textContent = 'Generating OTP…';
    $('#accountMessage').textContent = '';

    try {
      const res = await apiRequest('/api/v1/auth/forgot-password/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      forgotState.email = email;
      setForgotStep('otp');
      $('#accountMessage').textContent = res.message || 'OTP sent! Please check your registered email.';
    } catch (err) {
      $('#accountMessage').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate OTP';
    }
  });

  // Forgot Password: Step 2 - Resend OTP
  $('#btnResendForgotOtp')?.addEventListener('click', async () => {
    if (!forgotState.email) return;
    const resendBtn = $('#btnResendForgotOtp');
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending…';
    $('#accountMessage').textContent = '';

    try {
      const res = await apiRequest('/api/v1/auth/forgot-password/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email: forgotState.email })
      });
      $('#accountMessage').textContent = res.message || 'A fresh OTP has been sent to your email!';
      showStoreToast('New OTP sent to your registered email.');
    } catch (err) {
      $('#accountMessage').textContent = err.message;
    } finally {
      setTimeout(() => {
        if (resendBtn) {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend OTP';
        }
      }, 5000);
    }
  });

  // Forgot Password: Step 2 - Verify OTP
  $('#forgotStepOtpForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btnVerifyForgotOtp');
    const otp = $('#forgotOtpInput')?.value?.trim();
    if (!otp || otp.length !== 6) {
      $('#accountMessage').textContent = 'Please enter a valid 6-digit verification code.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Verifying OTP…';
    $('#accountMessage').textContent = '';

    try {
      const res = await apiRequest('/api/v1/auth/forgot-password/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: forgotState.email, otp })
      });
      forgotState.resetToken = res.resetToken;
      setForgotStep('reset');
      $('#accountMessage').textContent = 'OTP verified! Now create your new password.';
    } catch (err) {
      $('#accountMessage').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify OTP';
    }
  });

  // Forgot Password: Step 3 - Set New Password & Re-enter Password -> Back to Sign-in
  $('#forgotStepResetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btnSubmitNewPassword');
    const newPassword = $('#forgotNewPassword')?.value;
    const confirmPassword = $('#forgotConfirmPassword')?.value;

    if (!newPassword || newPassword.length < 8) {
      $('#accountMessage').textContent = 'Password must be at least 8 characters long.';
      return;
    }
    if (newPassword !== confirmPassword) {
      $('#accountMessage').textContent = 'Passwords do not match. Please re-enter identical passwords.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Resetting Password…';
    $('#accountMessage').textContent = '';

    try {
      const res = await apiRequest('/api/v1/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({
          email: forgotState.email,
          resetToken: forgotState.resetToken,
          newPassword
        })
      });

      const savedEmail = forgotState.email;
      forgotState = { email: '', resetToken: '' };

      // Return back to sign-in
      setAccountMode('login');

      // Pre-fill email and clear/focus password field
      const emailField = $('#accountForm input[name="email"]');
      if (emailField) emailField.value = savedEmail;
      const passField = $('#accountPassword');
      if (passField) {
        passField.value = '';
        passField.focus();
      }

      $('#accountMessage').textContent = '✅ ' + (res.message || 'Password reset successfully! Please sign in with your new password.');
      showStoreToast('Password reset successfully! Please sign in.');
    } catch (err) {
      $('#accountMessage').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Reset Password';
    }
  });

  // Logout
  $('#logoutButton')?.addEventListener('click', async () => {
    try { await apiRequest('/api/v1/auth/logout', { method: 'POST' }); } catch {}
    setAuthToken('');
    state.customer = null;
    state.savedAddresses = [];
    updateAccountButton();
    closeAccount();
    renderCart();
  });

  // Mobile off-canvas navigation
  function setNavOpen(open) {
    const nav = $('#mainNav');
    const scrim = $('#navScrim');
    if (!nav) return;
    nav.classList.toggle('mobile-open', open);
    if (scrim) scrim.classList.toggle('visible', open);
    document.body.classList.toggle('nav-open', open);
    $('#menuToggle')?.setAttribute('aria-expanded', String(open));
  }

  $('#menuToggle')?.addEventListener('click', () => setNavOpen(true));
  $('#menuClose')?.addEventListener('click', () => setNavOpen(false));
  $('#navScrim')?.addEventListener('click', () => setNavOpen(false));

  $('#mainNav')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      setNavOpen(false);
    }
  });

  $('#mobileSearchToggle')?.addEventListener('click', () => {
    const searchContainer = $('.header-search-container') || $('.search-box');
    searchContainer?.classList.toggle('mobile-search-open');
    $('#searchInput')?.focus();
  });

  // Live checkout pincode typing feedback
  document.addEventListener('input', (e) => {
    if (e.target.id === 'checkoutPincodeInput') {
      const pin = e.target.value.trim();
      const delivery = window.MilvantaDelivery;
      const fb = $('#checkoutPincodeFeedback');
      if (!delivery || !fb) return;
      if (pin.length === 6) {
        const info = delivery.getDeliveryInfo(pin);
        if (!info.inHyderabad) {
          fb.style.color = '#a8382c';
          fb.textContent = `❌ Milvanta delivers across Hyderabad (500001–500096). PIN code ${pin} is outside Hyderabad.`;
        } else if (!info.serviceable) {
          fb.style.color = '#d97706';
          fb.textContent = info.message || `⚠️ PIN code ${pin} is outside our direct delivery zone.`;
        } else {
          fb.style.color = '#15803d';
          fb.textContent = `📍 ${info.area} (~${info.distanceKm} km from Hafeezpet hub · ₹${info.fee} delivery)`;
          state.pincode = pin;
          state.area = info.shortArea || info.area;
          state.addressDraft.pincode = pin;
          updatePincodeDisplays(pin);

          const billRowDelivery = document.querySelector('.bill-summary-card .bill-row:nth-child(2)');
          const billRowTotal = document.querySelector('.bill-summary-card .bill-row.total');
          const submitBtn = document.querySelector('#checkoutForm button[type="submit"]');
          if (billRowDelivery && billRowTotal) {
            const subtotal = state.cart.reduce((sum, entry) => {
              const p = products.find((item) => item.id === entry.id);
              if (!p) return sum;
              return sum + (entry.variant?.price || p.price) * entry.quantity;
            }, 0);
            const fee = subtotal >= 499 ? 0 : info.fee;
            const tot = subtotal + fee;
            billRowDelivery.innerHTML = `<span>Morning Delivery (${escapeHtml(info.shortArea || 'Hafeezpet')} · ${info.distanceKm} km)</span><span>${fee === 0 ? `<span class="free-tag"><s style="opacity:0.6;font-weight:400;margin-right:4px;">₹${info.fee}</s>FREE</span>` : `₹${fee}`}</span>`;
            billRowTotal.innerHTML = `<span>Total Payable</span><span>₹${tot.toFixed(0)}</span>`;
            if (submitBtn) submitBtn.textContent = `Pay ₹${tot.toFixed(0)} via Razorpay →`;
          }
        }
      }
    }
  });

  // Escape key closes all modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setNavOpen(false);
      closeProductModal();
      closeRecipeModal();
      closeAccount();
      closeTrackingModal();
      closeAdminOrders();
      closePolicyModal();
      closePincodeModal();
      setCartOpen(false);
    }
  });

  // Close modals on clicking background backdrop
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeProductModal();
        closeRecipeModal();
        closeAccount();
        closeTrackingModal();
        closeAdminOrders();
        closePolicyModal();
        closePincodeModal();
      }
    });
  });

  // Deep-link direct product modal open (?product=16) or login prompt (?auth=login)
  const urlParams = new URLSearchParams(window.location.search);
  const openModalId = urlParams.get('product') || urlParams.get('modal');
  if (openModalId) {
    setTimeout(() => openProductModal(Number(openModalId)), 150);
  }
  if (urlParams.get('auth') === 'login') {
    sessionStorage.setItem('milvanta-pending-checkout', 'true');
    setTimeout(() => {
      openAccount();
      const msg = $('#accountMessage');
      if (msg) {
        msg.textContent = 'Please sign in or create an account to proceed to checkout.';
        msg.style.color = '#0a3d66';
      }
    }, 150);
  }
});
