const categories = [
  { name: 'Fresh Milk', image: 'assets/milvanta-cow-milk.jpg' },
  { name: 'Dairy Products', image: 'assets/milvanta-buffalo-milk.jpg' },
  { name: 'Indian Pickles', image: 'assets/pickle-jar.svg' },
  { name: 'Baking Essentials', image: 'assets/butter-cake.jpg' },
  { name: 'Snacks & Beverages', image: 'assets/muesli.jpg' },
  { name: 'Healthy Living', image: 'assets/raagi-cookies.jpg' }
];

// The five catalog entries and all product claims come from the supplied brief.
const products = [
  { id: 1, name: 'Walnut Raagi Brownie', category: 'Baking Essentials', price: 299, size: '1 Piece', quantity: '3 × 3 in · 1 in height', description: 'A rich chocolate brownie made with alkaline-free cocoa, organic whole wheat flour, and low-glycemic brown sugar, topped with walnut slices.', ingredients: ['Alkaline-free cocoa', 'Organic whole wheat flour', 'Low-glycemic brown sugar', 'Walnut slices'], image: 'assets/walnut-raagi-brownie.jpg', details: 'Cocoa is sourced from Godavari fields. The brand states that its organic whole wheat flour contains 9 g of protein per 200 g of flour.' },
  { id: 2, name: 'Butter Cake with Couverture Chocolate Chips', shortName: 'Butter Cake', category: 'Baking Essentials', price: 350, size: '250 g', quantity: '250 g', description: 'A delicious butter cake made with organic whole wheat flour, butter, and couverture chocolate chips.', ingredients: ['Organic whole wheat flour', 'Butter', 'Couverture chocolate chips'], image: 'assets/butter-cake.jpg' },
  { id: 3, name: 'Kowa Cake', category: 'Baking Essentials', price: 150, size: '1 Piece', quantity: '3 × 3 in · 1 in height', description: 'A rich Kowa cake made with Kowa, organic whole wheat flour, butter, low-glycemic brown sugar, and cardamom, topped with almond flakes.', ingredients: ['Kowa', 'Organic whole wheat flour', 'Butter', 'Low-glycemic brown sugar', 'Cardamom', 'Almond flakes'], image: 'assets/kowa-cake.jpg' },
  { id: 4, name: 'Raagi Cookies', category: 'Healthy Living', price: 550, size: '250 g tin', quantity: '17 cookies per box', description: 'Healthy cookies for kids and adults, made with pure A2 Belona ghee, organic raagi, whole wheat flour, and organic jaggery, topped with five types of nuts and seeds.', ingredients: ['Organic raagi', 'Whole wheat flour', 'Pure A2 Belona ghee', 'Organic jaggery', 'Pumpkin seeds', 'Cashews', 'Almonds', 'Sunflower seeds', 'Melon seeds'], image: 'assets/raagi-cookies.jpg' },
  { id: 5, name: 'Muesli', category: 'Healthy Living', price: 450, size: '250 g', quantity: '250 g', description: 'Premium muesli made with rolled oats, nuts, seeds, and dried fruits, combined with pure coconut oil and organic jaggery or honey.', ingredients: ['Premium rolled oats', 'Almonds', 'Pumpkin seeds', 'Flax seeds', 'Melon seeds', 'Raisins', 'Cranberries', 'Watermelon seeds', 'Sunflower seeds', 'Pure coconut oil', 'Organic jaggery or honey'], image: 'assets/muesli.jpg' },
  { id: 6, name: 'Tomato Pickle', category: 'Indian Pickles', price: 479, size: '500 g', quantity: '500 g · 1 kg available', description: 'Classic tangy and spicy tomato pickle.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '500 g', price: 479 }, { size: '1 kg', price: 899 }] },
  { id: 7, name: 'Gongura Pickle', category: 'Indian Pickles', price: 499, size: '500 g', quantity: '500 g · 1 kg available', description: 'The authentic tangy and spicy sorrel leaf pickle.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '500 g', price: 499 }, { size: '1 kg', price: 999 }] },
  { id: 8, name: 'Usirikaya Pickle (Amla)', category: 'Indian Pickles', price: 499, size: '500 g', quantity: '500 g · 1 kg available', description: 'Packed with Vitamin C and a unique amla flavor.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '500 g', price: 499 }, { size: '1 kg', price: 999 }] },
  { id: 9, name: 'Pandu Mirchi Pickle', category: 'Indian Pickles', price: 489, size: '500 g', quantity: '500 g · 1 kg available', description: 'Fiery and flavorful red chilli pickle.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '500 g', price: 489 }, { size: '1 kg', price: 959 }] },
  { id: 10, name: 'Mango Pickle', category: 'Indian Pickles', price: 449, size: '500 g', quantity: '500 g · 1 kg available', description: 'The quintessential South Indian green mango relish.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '500 g', price: 449 }, { size: '1 kg', price: 999 }] },
  { id: 11, name: 'Chicken Pickle (Bone)', category: 'Indian Pickles', price: 359, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Classic spicy bone-in chicken pickle.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 359 }, { size: '500 g', price: 599 }, { size: '1 kg', price: 1099 }] },
  { id: 12, name: 'Chicken Pickle (Boneless)', category: 'Indian Pickles', price: 399, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Tender boneless chicken in traditional spices.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 399 }, { size: '500 g', price: 799 }, { size: '1 kg', price: 1399 }] },
  { id: 13, name: 'Mutton Pickle (Bone)', category: 'Indian Pickles', price: 549, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Rich, aromatic bone-in mutton pickle.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 549 }, { size: '500 g', price: 999 }, { size: '1 kg', price: 1899 }] },
  { id: 14, name: 'Mutton Pickle (Boneless)', category: 'Indian Pickles', price: 699, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Succulent boneless mutton pickle.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 699 }, { size: '500 g', price: 1099 }, { size: '1 kg', price: 2099 }] },
  { id: 15, name: 'Prawns Pickle', category: 'Indian Pickles', price: 599, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Flavorful prawns cooked in a traditional masala.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 599 }, { size: '500 g', price: 999 }, { size: '1 kg', price: 1899 }] },
  { id: 16, name: 'Fish Pickle (Boneless)', category: 'Indian Pickles', price: 599, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Delicate boneless fish fillets in a spiced pickle.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 599 }, { size: '500 g', price: 999 }, { size: '1 kg', price: 1899 }] },
  { id: 17, name: 'Gongura Chicken (Boneless)', category: 'Indian Pickles', price: 599, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Sour gongura leaves with boneless chicken.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 599 }, { size: '500 g', price: 999 }, { size: '1 kg', price: 1899 }] },
  { id: 18, name: 'Gongura Mutton (Boneless)', category: 'Indian Pickles', price: 699, size: '250 g', quantity: '250 g · 500 g · 1 kg available', description: 'Tangy gongura with boneless mutton.', ingredients: [], image: 'assets/pickle-jar.svg', variants: [{ size: '250 g', price: 699 }, { size: '500 g', price: 1149 }, { size: '1 kg', price: 2149 }] }
];

const state = { selectedCategory: 'Baking Essentials', searchTerm: '', cart: readCart(), activeProductId: null, modalQty: 1, carouselIndex: 0, returnFocus: null, selectedVariant: null };
const $ = (selector) => document.querySelector(selector);
const categoryRow = $('#categoryRow'), productCarousel = $('#productCarousel'), cartDrawer = $('#cartDrawer');
const categoryFor = (product) => product.category;
const productImage = (product) => product.category === 'Indian Pickles' ? 'assets/pickle-jar.svg' : product.image;
function readCart() { try { const saved = JSON.parse(localStorage.getItem('milvanta-cart') || '[]'); return Array.isArray(saved) ? saved.filter((item) => Number.isFinite(item.id) && Number.isFinite(item.quantity) && item.quantity > 0) : []; } catch { return []; } }
function saveCart() { try { localStorage.setItem('milvanta-cart', JSON.stringify(state.cart)); } catch { /* Cart remains usable when browser storage is disabled. */ } }
function updateBadge() { const count = state.cart.reduce((sum, item) => sum + item.quantity, 0); $('#cartCount').textContent = count; $('#cartCount').setAttribute('aria-label', `${count} ${count === 1 ? 'item' : 'items'} in cart`); }
function visibleProducts() {
  const term = state.searchTerm.trim().toLowerCase();
  return products.filter((p) => (state.selectedCategory === 'All' || categoryFor(p) === state.selectedCategory) && (!term || `${p.name} ${p.category} ${p.description} ${p.ingredients.join(' ')}`.toLowerCase().includes(term)));
}
function renderCategories() {
  categoryRow.innerHTML = '';
  categories.forEach((category) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `category-card${state.selectedCategory === category.name ? ' is-active' : ''}`;
    button.setAttribute('aria-pressed', String(state.selectedCategory === category.name));
    button.innerHTML = `<span class="category-thumb"><img src="${category.image}" alt="" loading="lazy"></span><span>${category.name}</span>`;
    button.addEventListener('click', () => { state.selectedCategory = category.name; state.carouselIndex = 0; renderCategories(); renderCarousel(); });
    categoryRow.append(button);
  });
}
function renderCarousel() {
  const list = visibleProducts();
  $('#sectionTitle').textContent = state.searchTerm ? (state.selectedCategory === 'All' ? 'Search Results' : state.selectedCategory) : state.selectedCategory === 'All' ? 'Our Products' : state.selectedCategory;
  productCarousel.innerHTML = '';
  $('.carousel-dots').innerHTML = '';
  const showCatalog = state.selectedCategory === 'All' || list.length > 3;
  productCarousel.classList.toggle('catalog-grid', showCatalog);
  $('.product-carousel-wrapper').classList.toggle('catalog-mode', showCatalog);
  $('.carousel-dots').classList.toggle('hidden', showCatalog);
  if (!list.length) {
    const message = state.searchTerm ? 'No products match this search. Try another term or browse the full catalog.' : `${state.selectedCategory} products are not listed in the priced catalog yet.`;
    productCarousel.innerHTML = `<div class="empty-state"><strong>${state.searchTerm ? 'No results found' : 'Collection coming soon'}</strong><span>${message}</span><button class="text-action" type="button" data-show-all>View priced products</button></div>`;
    return;
  }
  state.carouselIndex = (state.carouselIndex + list.length) % list.length;
  const order = showCatalog ? list.map((_, i) => i) : list.map((_, i) => (i - state.carouselIndex + list.length) % list.length);
  order.forEach((offset) => {
    const productIndex = showCatalog ? offset : (state.carouselIndex + offset) % list.length;
    const p = list[productIndex];
    const card = document.createElement('article'); card.className = `product-card ${showCatalog ? 'catalog-card' : offset === 0 ? 'center' : offset === 1 ? 'side side-right' : offset === list.length - 1 ? 'side side-left' : 'hidden-card'}`; card.dataset.category = p.category;
    card.tabIndex = 0; card.setAttribute('aria-label', `${p.name}, ₹${p.price}. Open details.`);
    card.innerHTML = `<div class="product-image"><img src="${productImage(p)}" alt="${p.name}${p.category === 'Indian Pickles' ? ' illustration' : ''}" loading="lazy"><span class="image-badge" aria-hidden="true">✦</span></div><div class="card-body"><h3 class="product-name">${p.shortName || p.name}</h3><div class="product-meta"><span class="product-size">${p.size}</span><span class="product-qty">${p.quantity}</span></div><div class="ingredients-tags">${p.ingredients.slice(0, 3).map((x) => `<span>${x}</span>`).join('')}</div><div class="product-footer"><span class="product-price">${p.variants ? 'From ' : ''}₹${p.price}</span><button class="add-cart-mini" type="button" data-add-cart="${p.id}" aria-label="${p.variants ? 'Choose pack size for ' : 'Add '}${p.name} to cart">＋</button></div></div>`;
    card.addEventListener('click', (event) => { if (!event.target.closest('[data-add-cart]')) openProductModal(p.id); });
    card.addEventListener('keydown', (event) => { if (event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openProductModal(p.id); } });
    productCarousel.append(card);
  });
  if (!showCatalog) list.forEach((_, i) => { const dot = document.createElement('button'); dot.className = `carousel-dot${i === state.carouselIndex ? ' active' : ''}`; dot.type = 'button'; dot.setAttribute('aria-label', `Show product ${i + 1}`); dot.addEventListener('click', () => { state.carouselIndex = i; renderCarousel(); }); $('.carousel-dots').append(dot); });
}
function openProductModal(id) {
  const p = products.find((item) => item.id === id); if (!p) return;
  state.activeProductId = id; state.modalQty = 1; state.returnFocus = document.activeElement;
  $('#modalQty').textContent = '1'; $('#modalTitle').textContent = p.name; $('#modalDescription').textContent = p.description;
  $('#modalSize').textContent = p.variants ? '' : p.size; $('#modalSize').classList.toggle('hidden', Boolean(p.variants)); $('#modalPrice').textContent = `₹${p.price}`; $('#modalImage').src = productImage(p); $('#modalImage').alt = p.category === 'Indian Pickles' ? `${p.name} illustration` : p.name;
  const picker = $('#variantPicker'), select = $('#variantSelect');
  picker.classList.toggle('hidden', !p.variants);
  if (p.variants) { select.innerHTML = p.variants.map((variant, index) => `<option value="${index}">${variant.size} · ₹${variant.price}</option>`).join(''); state.selectedVariant = p.variants[0]; }
  else state.selectedVariant = null;
  $('.ingredients-block').classList.toggle('hidden', !p.ingredients.length);
  $('#modalIngredients').innerHTML = p.ingredients.map((item) => `<li>${item}</li>`).join('');
  $('#modalExtra').textContent = p.details || '';
  const modal = $('#productModal'); modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open'); $('#modalClose').focus();
}
function closeProductModal() { const modal = $('#productModal'); modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open'); if (state.returnFocus?.isConnected) state.returnFocus.focus(); }
function variantKey(item) { return item.variant?.size || ''; }
function addToCart(id, quantity = 1, variant = null) { const existing = state.cart.find((item) => item.id === id && variantKey(item) === (variant?.size || '')); if (existing) existing.quantity += quantity; else state.cart.push({ id, quantity, ...(variant ? { variant } : {}) }); saveCart(); updateBadge(); renderCart(); }
function updateCart(id, amount, variantSize = '') { const item = state.cart.find((entry) => entry.id === id && variantKey(entry) === variantSize); if (!item) return; item.quantity += amount; if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry !== item); saveCart(); updateBadge(); renderCart(); }
function renderCart() {
  const valid = state.cart.filter((entry) => products.some((p) => p.id === entry.id)); state.cart = valid;
  if (!valid.length) { $('#cartContent').innerHTML = '<p class="cart-empty">Your cart is empty.<br><span>Good things are just a browse away.</span></p>'; updateBadge(); return; }
  const rows = valid.map((entry) => { const p = products.find((item) => item.id === entry.id), size = entry.variant?.size || p.size, price = entry.variant?.price || p.price, key = encodeURIComponent(entry.variant?.size || ''); return `<div class="cart-item"><img class="cart-image" src="${productImage(p)}" alt="" loading="lazy"><div class="cart-details"><h4>${p.shortName || p.name}</h4><p>${size}</p><button class="remove-item" type="button" data-remove="${p.id}" data-variant="${key}">Remove</button></div><div class="cart-amount"><strong>₹${price * entry.quantity}</strong><div class="cart-quantity"><button type="button" data-cart-minus="${p.id}" data-variant="${key}" aria-label="Decrease quantity">−</button><span>${entry.quantity}</span><button type="button" data-cart-plus="${p.id}" data-variant="${key}" aria-label="Increase quantity">+</button></div></div></div>`; }).join('');
  const subtotal = valid.reduce((sum, entry) => sum + (entry.variant?.price || products.find((p) => p.id === entry.id).price) * entry.quantity, 0);
  $('#cartContent').innerHTML = `${rows}<div class="cart-footer"><div class="cart-subtotal"><span>Subtotal</span><span>₹${subtotal}</span></div><p class="cart-note">Delivery details can be confirmed with your local store.</p></div>`; saveCart();
}
function setCartOpen(open) { cartDrawer.classList.toggle('open', open); cartDrawer.setAttribute('aria-hidden', String(!open)); document.body.classList.toggle('cart-open', open); $('#cartToggle').setAttribute('aria-expanded', String(open)); if (open) { state.returnFocus = document.activeElement; $('#closeCart').focus(); } else if (state.returnFocus?.isConnected) state.returnFocus.focus(); }
function moveCarousel(amount) { const list = visibleProducts(); if (!list.length) return; state.carouselIndex = (state.carouselIndex + amount + list.length) % list.length; renderCarousel(); }
$('#prevBtn').addEventListener('click', () => moveCarousel(-1)); $('#nextBtn').addEventListener('click', () => moveCarousel(1));
$('#searchInput').addEventListener('input', (event) => { state.searchTerm = event.target.value; state.carouselIndex = 0; renderCarousel(); });
$('#clearSearch').addEventListener('click', () => { $('#searchInput').value = ''; state.searchTerm = ''; state.carouselIndex = 0; renderCarousel(); $('#searchInput').focus(); });
$('.view-all').addEventListener('click', () => { state.selectedCategory = 'All'; state.carouselIndex = 0; renderCategories(); renderCarousel(); });
$('#cartToggle').addEventListener('click', () => setCartOpen(true)); $('#closeCart').addEventListener('click', () => setCartOpen(false));
$('#modalClose').addEventListener('click', closeProductModal);
$('#variantSelect').addEventListener('change', (event) => { const p = products.find((item) => item.id === state.activeProductId); state.selectedVariant = p.variants[Number(event.target.value)]; $('#modalPrice').textContent = `₹${state.selectedVariant.price}`; });
$('#modalAddToCart').addEventListener('click', () => { if (state.activeProductId) addToCart(state.activeProductId, state.modalQty, state.selectedVariant); closeProductModal(); setCartOpen(true); });
document.querySelectorAll('.qty-btn').forEach((button) => button.addEventListener('click', () => { state.modalQty = Math.max(1, state.modalQty + (button.dataset.action === 'increase' ? 1 : -1)); $('#modalQty').textContent = state.modalQty; }));
document.addEventListener('click', (event) => {
  const add = event.target.closest('[data-add-cart]'); if (add) { const product = products.find((p) => p.id === Number(add.dataset.addCart)); if (product?.variants) openProductModal(product.id); else addToCart(Number(add.dataset.addCart)); return; }
  const plus = event.target.closest('[data-cart-plus]'); if (plus) updateCart(Number(plus.dataset.cartPlus), 1, decodeURIComponent(plus.dataset.variant || ''));
  const minus = event.target.closest('[data-cart-minus]'); if (minus) updateCart(Number(minus.dataset.cartMinus), -1, decodeURIComponent(minus.dataset.variant || ''));
  const remove = event.target.closest('[data-remove]'); if (remove) updateCart(Number(remove.dataset.remove), -9999, decodeURIComponent(remove.dataset.variant || ''));
  const all = event.target.closest('[data-show-all]'); if (all) { state.selectedCategory = 'All'; state.searchTerm = ''; $('#searchInput').value = ''; renderCategories(); renderCarousel(); }
  if (event.target === $('#productModal')) closeProductModal();
  if (event.target === $('#cartScrim')) setCartOpen(false);
});
$('#cartScrim').addEventListener('click', () => setCartOpen(false));
$('#menuToggle').addEventListener('click', () => { const open = $('#mainNav').classList.toggle('mobile-open'); $('#menuToggle').setAttribute('aria-expanded', String(open)); });
$('#mobileSearchToggle').addEventListener('click', () => { $('.search-box').classList.toggle('mobile-search-open'); if ($('.search-box').classList.contains('mobile-search-open')) $('#searchInput').focus(); });
$('#mainNav').addEventListener('click', (event) => { if (event.target.closest('a')) { $('#mainNav').classList.remove('mobile-open'); $('#menuToggle').setAttribute('aria-expanded', 'false'); } });
let touchStartX = null; productCarousel.addEventListener('touchstart', (event) => { touchStartX = event.changedTouches[0].screenX; }, { passive: true }); productCarousel.addEventListener('touchend', (event) => { if (touchStartX === null) return; const delta = event.changedTouches[0].screenX - touchStartX; if (Math.abs(delta) > 45) moveCarousel(delta < 0 ? 1 : -1); touchStartX = null; }, { passive: true });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('#productModal').classList.contains('hidden')) closeProductModal();
    if (cartDrawer.classList.contains('open')) setCartOpen(false);
    $('#mainNav').classList.remove('mobile-open'); $('#menuToggle').setAttribute('aria-expanded', 'false');
  }
  if (event.key === 'Tab') {
    const dialog = !$('#productModal').classList.contains('hidden') ? $('#productModal').querySelector('[role="dialog"]') : cartDrawer.classList.contains('open') ? cartDrawer : null;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]),a[href],input,select,[tabindex="0"]')].filter((element) => element.getClientRects().length);
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  }
});
renderCategories(); renderCarousel(); renderCart(); updateBadge();
