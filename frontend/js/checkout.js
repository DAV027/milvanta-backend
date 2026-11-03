/**
 * Milvanta 3-Step Checkout Controller
 * Step 1: Details (Customer & Contact - Editable Full Name, Mobile, Email)
 * Step 2: Address (Delivery Location & Hyderabad Pincode Engine)
 * Step 3: Payment (Review & Razorpay Checkout)
 * 
 * Rules:
 * - User must be logged in to access checkout page; non-logged-in users are redirected to login.
 * - Header & footer identical to index.html.
 * - No user info banner or switch account button in Step 1.
 * - No "Step-by-step Morning Delivery Setup" tagline in top bar.
 * - Cart items reliably display in Order Summary.
 * - Clean bill breakdown: Subtotal, Delivery charges (₹50 / ₹80), and Total.
 */

(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  const API_URL = (window.MILVANTA_API_URL || 'https://milvanta-backend.onrender.com').replace(/\/$/, '');
  const isProdHost = ['milvanta.in', 'www.milvanta.in'].includes((window.location.hostname || '').toLowerCase());
  const RAZORPAY_KEY = window.RAZORPAY_KEY_ID || (isProdHost ? '' : 'rzp_test_TMT4s342RfwceX');

  let authToken = (() => {
    try { return sessionStorage.getItem('milvanta-auth-token') || localStorage.getItem('milvanta-auth-token') || ''; } catch { return ''; }
  })();

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
    } catch {}
  }

  // Curated fallback products catalog for items rendering
  let productsCatalog = [
    { id: 101, name: 'Cow Milk', price: 60, size: '500 ml pouch', image: 'assets/milvanta-cow-milk.jpg' },
    { id: 102, name: 'Buffalo Milk', price: 70, size: '500 ml bottle', image: 'assets/milvanta-buffalo-milk.jpg' },
    { id: 104, name: 'Paneer', price: 400, size: '500 g pack', image: 'assets/milvanta-paneer.jpg' },
    { id: 105, name: 'Pot Curd', price: 49, size: '200 g pot', image: 'assets/milvanta-curd.jpg?v=2' },
    { id: 103, name: 'Pure Cow Ghee', price: 1500, size: '500 g jar', image: 'assets/milvanta-cow-ghee.jpg' },
    { id: 106, name: 'Pure Buffalo Ghee', price: 1100, size: '500 g jar', image: 'assets/milvanta-buffalo-ghee.jpg' },
    { id: 1, name: 'Walnut Raagi Brownie', price: 299, size: '1 Piece', image: 'assets/walnut-raagi-brownie.jpg' },
    { id: 2, name: 'Butter Cake (Chocolate Chips)', price: 299, size: '300 g loaf', image: 'assets/butter-cake.jpg' },
    { id: 3, name: 'Heritage Kowa Cake', price: 349, size: '400 g box', image: 'assets/kowa-cake.jpg' },
    { id: 4, name: 'Organic Raagi Millet Cookies', price: 149, size: '200 g tin', image: 'assets/raagi-cookies.jpg' },
    { id: 5, name: 'Sprouted Millet Muesli', price: 249, size: '350 g pouch', image: 'assets/sprouted-millet-muesli.jpg' },
    { id: 10, name: 'Avakaya Mango Pickle', price: 449, size: '500 g jar', image: 'assets/avakaya-mango-pickle.jpg' },
    { id: 6, name: 'Traditional Tomato Pickle', price: 479, size: '500 g jar', image: 'assets/traditional-tomato-pickle.jpg' },
    { id: 7, name: 'Andhra Gongura Pickle', price: 499, size: '500 g jar', image: 'assets/andhra-gongura-pickle.jpg' },
    { id: 8, name: 'Usirikaya Pickle (Amla)', price: 499, size: '500 g jar', image: 'assets/usirikaya-pickle.jpg' },
    { id: 9, name: 'Pandu Mirchi Pickle', price: 489, size: '500 g jar', image: 'assets/pandu-mirchi-pickle.jpg' },
    { id: 12, name: 'Chicken Pickle (Boneless)', price: 849, size: '500 g jar', image: 'assets/chicken-pickle-boneless.jpg' },
    { id: 14, name: 'Mutton Pickle (Boneless)', price: 1149, size: '500 g jar', image: 'assets/mutton-pickle-boneless.jpg' },
    { id: 15, name: 'Prawns Pickle', price: 1049, size: '500 g jar', image: 'assets/prawns-pickle.jpg' },
    { id: 16, name: 'Fish Pickle (Boneless)', price: 1049, size: '500 g jar', image: 'assets/fish-pickle-boneless.jpg' },
    { id: 17, name: 'Gongura Chicken (Boneless)', price: 1149, size: '500 g jar', image: 'assets/gongura-chicken-pickle.jpg' },
    { id: 18, name: 'Gongura Mutton (Boneless)', price: 1199, size: '500 g jar', image: 'assets/gongura-mutton-pickle.jpg' }
  ];

  function findProductInCatalog(idOrItem) {
    const item = typeof idOrItem === 'object' && idOrItem !== null ? idOrItem : { id: idOrItem };
    const numId = Number(item.id || item.productId || 0);
    const rawName = String(item.name || item.product_name || item.product || '').toLowerCase();

    if (rawName.includes('buffalo milk') || (rawName.includes('buffalo') && rawName.includes('milk')) || numId === 102) {
      return { id: 102, name: 'Buffalo Milk', price: 70, size: '500 ml bottle', image: 'assets/milvanta-buffalo-milk.jpg' };
    }
    if (rawName.includes('cow milk') || (rawName.includes('cow') && rawName.includes('milk')) || numId === 101) {
      return { id: 101, name: 'Cow Milk', price: 60, size: '500 ml pouch', image: 'assets/milvanta-cow-milk.jpg' };
    }
    if (numId === 1 && !rawName.includes('brownie')) {
      return { id: 101, name: 'Cow Milk', price: 60, size: '500 ml pouch', image: 'assets/milvanta-cow-milk.jpg' };
    }
    if (numId === 2 && !rawName.includes('cake')) {
      return { id: 102, name: 'Buffalo Milk', price: 70, size: '500 ml bottle', image: 'assets/milvanta-buffalo-milk.jpg' };
    }
    if (numId === 104 || rawName.includes('paneer')) {
      return { id: 104, name: 'Paneer', price: 400, size: '500 g pack', image: 'assets/milvanta-paneer.jpg' };
    }
    if (numId === 105 || rawName.includes('curd')) {
      return { id: 105, name: 'Pot Curd', price: 49, size: '200 g pot', image: 'assets/milvanta-curd.jpg?v=2' };
    }
    if (numId === 103 || (rawName.includes('cow') && rawName.includes('ghee'))) {
      return { id: 103, name: 'Pure Cow Ghee', price: 1500, size: '500 g jar', image: 'assets/milvanta-cow-ghee.jpg' };
    }
    if (numId === 106 || (rawName.includes('buffalo') && rawName.includes('ghee'))) {
      return { id: 106, name: 'Pure Buffalo Ghee', price: 1100, size: '500 g jar', image: 'assets/milvanta-buffalo-ghee.jpg' };
    }
    return productsCatalog.find(p => Number(p.id) === numId) || {};
  }

  // Resolve a legacy cart entry to exactly one ACTIVE server product.
  // Never use historical frontend IDs as database IDs: legacy id=1 was a brownie
  // while production id=1 is Cow Milk. Names must independently match.
  function canonicalCheckoutProductName(value) {
    const raw = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const aliases = {
      'pure farm cow milk': 'cow milk',
      'pure farm buffalo milk': 'buffalo milk',
      'heritage kowa cake': 'kowa cake',
      'organic raagi millet cookies': 'raagi cookies',
      'sprouted millet muesli': 'muesli',
      'butter cake chocolate chips': 'butter cake with couverture chocolate chips',
      'pure desi cow ghee': 'pure cow ghee',
      'pure desi buffalo ghee': 'pure buffalo ghee'
    };
    return aliases[raw] || raw;
  }

  async function resolveCheckoutCartAgainstServer() {
    // A fresh catalog is mandatory at payment time; render-only fallback
    // products are not allowed to create chargeable orders.
    const { products: liveProducts } = await api('/api/v1/products');
    if (!Array.isArray(liveProducts) || liveProducts.length === 0) {
      throw new Error('Live product catalog is temporarily unavailable. Please retry when connected.');
    }
    const requested = state.cart.map(item => {
      const itemName = canonicalCheckoutProductName(item.name || item.product_name);
      const liveMatches = liveProducts.filter(product =>
        canonicalCheckoutProductName(product.name) === itemName
      );
      if (!itemName || liveMatches.length !== 1) {
        throw new Error('Cart item "' + String(item.name || 'Unknown item') +
          '" is no longer available in our live catalog. Please refresh your cart before paying.');
      }
      const product = liveMatches[0];
      const qty = Number(item.quantity);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 25) {
        throw new Error('Invalid cart quantity for ' + product.name + '.');
      }
      return {
        productId: Number(product.id),
        quantity: qty,
        size: item.variant?.size || item.size || product.selling_unit || '',
        variant: item.variant || null,
        isSubscriptionPlan: Boolean(item.isSubscriptionPlan || item.variant?.isSubscriptionPlan),
        isCustomDaysPlan: Boolean(item.isCustomDaysPlan || item.variant?.isCustomDaysPlan),
        subscriptionPlan: item.subscriptionPlan || item.variant?.subscriptionPlan || null,
        productName: product.name,
        availableStock: Number(product.stock_quantity)
      };
    });
    const grouped = new Map();
    for (const item of requested) {
      grouped.set(item.productId, (grouped.get(item.productId) || 0) + item.quantity);
    }
    for (const [id, quantity] of grouped) {
      const item = requested.find(entry => entry.productId === id);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(item.availableStock) || quantity > item.availableStock) {
        throw new Error(item.productName + ' has insufficient live stock for this order. Please adjust your cart.');
      }
    }
    return requested.map(({ productName, availableStock, ...item }) => item);
  }

  // Store Policy Contents for Compliance Dialog (Same as index.html)
  const POLICIES = {
    terms: {
      title: 'Terms & Conditions',
      html: `<p>Welcome to <strong>Milvanta</strong>. By accessing our platform or placing an order, you agree to these Terms.</p>
        <h4>1. Products & Availability</h4>
        <p>Milvanta supplies pure fresh milk, artisanal bakery items, and traditional homemade pickles. Morning milk deliveries are fulfilled between 6:00 AM and 7:00 AM across Hyderabad.</p>
        <h4>2. Orders & Payment</h4>
        <p>Orders are placed via Razorpay's secure checkout. Prices shown are in Indian Rupees (INR) and are inclusive of all taxes. Orders cannot be cancelled once dispatched.</p>
        <h4>3. Serviceable Areas</h4>
        <p>Delivery is fulfilled from our Hafeezpet hub across Hyderabad pin codes (500001–500096).</p>`
    },
    privacy: {
      title: 'Privacy Policy',
      html: `<p>Milvanta respects your privacy and protects your personal data.</p>
        <h4>1. Information We Collect</h4>
        <p>We collect your name, delivery address, phone number, and email address solely to fulfill your orders and notify you of delivery status.</p>
        <h4>2. Payment Security</h4>
        <p>We do not store your credit/debit card numbers or UPI MPINs. All transactions are securely processed through Razorpay using PCI-DSS compliant encryption.</p>
        <h4>3. Data Sharing</h4>
        <p>We never sell or rent your personal information to third parties. Information is only shared with logistics partners to complete doorstep delivery.</p>`
    },
    shipping: {
      title: 'Shipping & Delivery Policy',
      html: `<p>We take pride in our direct-from-farm cold-chain logistics originating from our Hafeezpet hub in Hyderabad.</p>
        <h4>1. Morning Delivery Window</h4>
        <p>Orders are dispatched in temperature-controlled bags and delivered straight to your doorstep between <strong>6:00 AM and 7:00 AM</strong>.</p>
        <h4>2. Delivery Charges</h4>
        <p>Delivery charges apply to all order and subscription types: <strong>₹50</strong> for deliveries within 5 km of Hafeezpet hub, and <strong>₹80</strong> for deliveries 6–10 km and Hyderabad Core City (500001–500096).</p>`
    },
    refund: {
      title: 'Refund & Cancellation Policy',
      html: `<p>Your satisfaction and food safety are our highest priorities.</p>
        <h4>1. Damaged or Compromised Goods</h4>
        <p>If any product arrives damaged or unsealed, notify us within 24 hours of delivery. We will immediately dispatch a fresh replacement or issue a 100% refund.</p>
        <h4>2. Refund Timeline</h4>
        <p>Approved refunds are credited back to the original payment source (UPI/Card/Bank) via Razorpay within 3–5 working days.</p>`
    }
  };

  const state = {
    currentStep: 1,
    cart: [],
    customer: null,
    savedAddresses: [],
    selectedAddressId: null,
    addressDraft: {
      name: '',
      phone: '',
      email: '',
      house: '',
      building: '',
      street: '',
      landmark: '',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500049'
    },
    isSubmitting: false,
    isPaymentProcessing: false,
    checkoutKey: (() => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try { return crypto.randomUUID(); } catch {}
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    })()
  };

  // API Helper
  async function api(path, options = {}) {
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers
    };
    try {
      const res = await fetch(`${API_URL}${path}`, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok && ['/api/v1/auth/signup', '/api/v1/auth/login'].includes(path) && data.token) {
        setAuthToken(data.token);
      }
      if (res.status === 401) {
        setAuthToken('');
        try { localStorage.removeItem('milvanta-user'); } catch {}
      }
      if (!res.ok) {
        const message = res.status === 401
          ? 'Your login has expired. Sign in again to continue securely.'
          : (data.message || data.error || `HTTP ${res.status}`);
        const error = new Error(message);
        error.status = res.status;
        throw error;
      }
      return data;
    } catch (err) {
      console.warn(`API call ${path} failed:`, err.message);
      throw err;
    }
  }

  // Load live catalog to augment fallback catalog
  async function fetchLiveCatalog() {
    try {
      const data = await api('/api/v1/products');
      if (data && Array.isArray(data.products) && data.products.length > 0) {
        data.products.forEach(p => {
          const existing = productsCatalog.find(item => Number(item.id) === Number(p.id));
          const unitPrice = p.price_paise ? Math.round(p.price_paise / 100) : (p.price || 0);
          if (existing) {
            existing.name = p.name || existing.name;
            if (unitPrice > 0) existing.price = unitPrice;
            existing.size = p.selling_unit || p.size || existing.size;
            existing.image = p.image_url || existing.image;
          } else {
            productsCatalog.push({
              id: p.id,
              name: p.name,
              price: unitPrice,
              size: p.selling_unit || '',
              image: p.image_url || 'assets/milvanta-mark.png'
            });
          }
        });
      }
    } catch (e) {
      // Offline fallback
    }
  }

  // Load Cart from localStorage
  function loadCart() {
    try {
      const raw = localStorage.getItem('milvanta-cart');
      state.cart = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.cart)) state.cart = [];
    } catch {
      state.cart = [];
    }

    const savedPin = localStorage.getItem('milvanta-pincode');
    if (savedPin) state.addressDraft.pincode = savedPin;

    updateHeaderLocation();
    updateCartCountBadge();
  }

  // Calculate Order Financials (Strictly: Subtotal, Delivery Fee, Total)
  function getOrderFinancials() {
    const subtotal = state.cart.reduce((sum, item) => {
      const prod = findProductInCatalog(item);
      const unitPrice = Number(item.variant?.price || item.price || prod.price || 0);
      const qty = Number(item.quantity || 1);
      return sum + (unitPrice * qty);
    }, 0);

    const pin = state.addressDraft.pincode || localStorage.getItem('milvanta-pincode') || '500049';
    const deliveryHelper = window.MilvantaDelivery;
    const info = deliveryHelper
      ? deliveryHelper.getDeliveryInfo(pin)
      : { fee: 50, distanceKm: 1, serviceable: true, inHyderabad: true, area: 'Hafeezpet', shortArea: 'Hafeezpet' };

    // Continuous milk subscriptions include daily doorstep morning delivery in the subscription daily rate.
    // Regular orders below ₹499 incur delivery fee (₹50 within 5km, ₹80 for 6-10km and Core City).
    const hasContinuous = state.cart.some((item) => item.isContinuousMonthsPlan || item.variant?.isContinuousMonthsPlan);
    const deliveryFee = hasContinuous ? 0 : (info.serviceable ? (Number(info.fee) || 50) : 50);
    const total = subtotal + deliveryFee;

    return {
      subtotal,
      deliveryFee,
      total,
      deliveryInfo: info,
      isDeliveryIncluded: hasContinuous
    };
  }

  // Render Order Summary Sidebar (Item list + Clean bill breakdown)
  function renderSidebarSummary() {
    const listEl = $('#summaryItemsList');
    const { subtotal, deliveryFee, total } = getOrderFinancials();

    if (!listEl) return;

    if (state.cart.length === 0) {
      listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.88rem; padding: 16px 0; text-align: center;">Your cart is empty.</p>';
      $('#summarySubtotal').textContent = '₹0';
      $('#summaryDeliveryFee').textContent = `₹${deliveryFee}`;
      $('#summaryTotal').textContent = '₹0';
      return;
    }

    listEl.innerHTML = state.cart.map((entry) => {
      const prod = findProductInCatalog(entry);
      const name = entry.name || entry.variant?.name || prod.name || 'Milvanta Product';
      const size = entry.size || entry.variant?.size || prod.size || '';
      const image = entry.image || prod.image || 'assets/milvanta-mark.png';
      const unitPrice = Number(entry.variant?.price || entry.price || prod.price || 0);
      const quantity = Number(entry.quantity || 1);
      const lineTotal = unitPrice * quantity;

      const isContinuous = entry.isContinuousMonthsPlan || entry.variant?.isContinuousMonthsPlan;
      const isCustom = entry.isCustomDaysPlan || entry.variant?.isCustomDaysPlan;
      let badge = '';
      if (isContinuous) {
        badge = `<span style="display:inline-block; font-size:0.68rem; font-weight:700; color:#0369a1; background:#e0f2fe; border-radius:3px; padding:1px 5px; margin-left:4px;">Continuous Sub</span>`;
      } else if (isCustom) {
        badge = `<span style="display:inline-block; font-size:0.68rem; font-weight:700; color:#15803d; background:#dcfce7; border-radius:3px; padding:1px 5px; margin-left:4px;">Custom Plan</span>`;
      }

      return `
        <div class="summary-item-row">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" class="summary-item-thumb" onerror="this.src='assets/milvanta-mark.png'" />
          <div class="summary-item-details">
            <h5 class="summary-item-name" title="${escapeHtml(name)}">${escapeHtml(name)} ${badge}</h5>
            <p class="summary-item-meta">${escapeHtml(size)}${size ? ' · ' : ''}Qty: <strong>${quantity}</strong></p>
          </div>
          <div class="summary-item-price">₹${lineTotal.toFixed(0)}</div>
        </div>
      `;
    }).join('');

    $('#summarySubtotal').textContent = `₹${subtotal.toLocaleString('en-IN')}`;
    $('#summaryDeliveryFee').textContent = deliveryFee === 0 ? 'FREE (Included)' : `₹${deliveryFee}`;
    $('#summaryTotal').textContent = `₹${total.toLocaleString('en-IN')}`;
  }

  // Update Stepper Visuals & Panels
  function updateStepper() {
    const steps = [1, 2, 3];
    steps.forEach((s) => {
      const stepEl = $(`#stepperStep${s}`);
      const nodeEl = stepEl?.querySelector('.step-node');
      if (!stepEl || !nodeEl) return;

      stepEl.classList.remove('active', 'completed');
      if (s < state.currentStep) {
        stepEl.classList.add('completed');
        nodeEl.textContent = '✓';
      } else if (s === state.currentStep) {
        stepEl.classList.add('active');
        nodeEl.textContent = String(s);
      } else {
        nodeEl.textContent = String(s);
      }
    });

    const line1 = $('#stepperLine1');
    const line2 = $('#stepperLine2');
    if (line1) line1.classList.toggle('completed', state.currentStep > 1);
    if (line2) line2.classList.toggle('completed', state.currentStep > 2);

    // Show/hide step panels
    $('#panelStep1')?.classList.toggle('hidden', state.currentStep !== 1);
    $('#panelStep2')?.classList.toggle('hidden', state.currentStep !== 2);
    $('#panelStep3')?.classList.toggle('hidden', state.currentStep !== 3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Validate and read pending subscription authorization state from sessionStorage
  function validatePendingSubscriptionAuth(auth) {
    if (!auth || typeof auth !== 'object') return null;
    const subId = typeof auth.subscriptionId === 'string' ? auth.subscriptionId.trim() : '';
    const payId = typeof auth.paymentId === 'string' ? auth.paymentId.trim() : '';
    const sig = typeof auth.signature === 'string' ? auth.signature.trim() : '';
    if (!subId || !/^sub_[A-Za-z0-9_]+$/.test(subId)) return null;
    if (!payId || !/^pay_[A-Za-z0-9_]+$/.test(payId)) return null;
    if (!sig || !/^[a-fA-F0-9]{32,128}$/.test(sig)) return null;
    return { subscriptionId: subId, paymentId: payId, signature: sig };
  }

  function getPendingSubscriptionAuth() {
    try {
      const raw = sessionStorage.getItem('pending_subscription_auth');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const validated = validatePendingSubscriptionAuth(parsed);
      if (!validated) {
        sessionStorage.removeItem('pending_subscription_auth');
        return null;
      }
      return validated;
    } catch {
      try { sessionStorage.removeItem('pending_subscription_auth'); } catch {}
      return null;
    }
  }

  // AUTH CHECK: A cached customer profile is NOT authentication.
  // Only a server-validated bearer session can enter checkout.
  async function checkAuthAndInit() {
    if (!authToken) {
      try { localStorage.removeItem('milvanta-user'); } catch {}
      showLoginRequired();
      return false;
    }

    let customerData = null;
    try {
      const data = await api('/api/v1/auth/me');
      customerData = data.customer || data.user || null;
    } catch (error) {
      if (error.status === 401) {
        showLoginRequired();
        return false;
      }
      // Network errors, DB outages and cold-start timeouts are not invalid
      // sessions. Fail closed, but let the customer retry without logging out.
      $('.checkout-layout')?.classList.add('hidden');
      $('.checkout-stepper')?.classList.add('hidden');
      $('.checkout-top-bar')?.classList.add('hidden');
      $('#emptyCartView')?.classList.add('hidden');
      const gate = $('#authRequiredView');
      if (gate) {
        gate.classList.remove('hidden');
        const label = gate.querySelector('p');
        if (label) label.textContent = 'Unable to verify your login right now. Check your connection and refresh to retry. Your cart is preserved.';
      }
      console.warn('Checkout authentication temporarily unavailable:', error.message);
      return false;
    }

    if (!customerData || !customerData.id) {
      setAuthToken('');
      try { localStorage.removeItem('milvanta-user'); } catch {}
      showLoginRequired();
      return false;
    }

    // Keep the cached account synchronized with the validated server identity.
    state.customer = customerData;
    try { localStorage.setItem('milvanta-user', JSON.stringify(customerData)); } catch {}
    const name = customerData.full_name || customerData.name || '';
    const phone = customerData.phone || '';
    const email = customerData.email || '';

    state.addressDraft.name = name;
    state.addressDraft.phone = phone;
    state.addressDraft.email = email;

    await loadSavedAddresses();
    updateAccountButton();
    const pendingAuth = getPendingSubscriptionAuth();
    const hasContinuous = state.cart.some((item) => item.isContinuousMonthsPlan || item.variant?.isContinuousMonthsPlan);
    if (pendingAuth && hasContinuous) {
      state.currentStep = 3;
      updateStepper();
      renderStep3();
    } else {
      renderStep1();
    }
    return true;
  }

  // Show login required gate & redirect to login
  function showLoginRequired() {
    sessionStorage.setItem('milvanta-pending-checkout', 'true');
    $('.checkout-layout')?.classList.add('hidden');
    $('.checkout-stepper')?.classList.add('hidden');
    $('.checkout-top-bar')?.classList.add('hidden');
    $('#emptyCartView')?.classList.add('hidden');
    $('#authRequiredView')?.classList.remove('hidden');

    window.location.replace('index.html?auth=login');
  }

  // Load Saved Addresses
  async function loadSavedAddresses() {
    if (!state.customer) return;
    try {
      if (authToken) {
        const res = await api('/api/v1/addresses');
        if (res && Array.isArray(res.addresses) && res.addresses.length > 0) {
          state.savedAddresses = res.addresses;
          const def = state.savedAddresses.find(a => a.is_default) || state.savedAddresses[0];
          state.selectedAddressId = def.id;
          applySavedAddressToDraft(def);
          return;
        }
      }
    } catch {}
    // No saved addresses for this customer: reset to clean state without invented defaults
    state.savedAddresses = [];
    state.selectedAddressId = null;
  }

  function applySavedAddressToDraft(addr) {
    if (!addr) return;
    state.addressDraft.name = addr.name || addr.recipient_name || state.addressDraft.name;
    state.addressDraft.phone = addr.phone || state.addressDraft.phone;
    state.addressDraft.house = addr.house || '';
    state.addressDraft.building = addr.building || '';
    state.addressDraft.street = addr.street || '';
    state.addressDraft.landmark = addr.landmark || '';
    state.addressDraft.city = addr.city || 'Hyderabad';
    state.addressDraft.state = addr.state || 'Telangana';
    state.addressDraft.pincode = addr.pincode || state.addressDraft.pincode;
  }

  // STEP 1: Details Render & Handlers (Directly editable fields, NO user info banner, NO switch account)
  function renderStep1() {
    const container = $('#step1Content');
    if (!container) return;

    const userFullName = state.addressDraft.name || state.customer?.full_name || state.customer?.name || '';
    const userPhone = state.addressDraft.phone || state.customer?.phone || '';
    const userEmail = state.addressDraft.email || state.customer?.email || '';

    container.innerHTML = `
      <form id="step1DetailsForm" novalidate>
        <div class="checkout-form-grid">
          <div class="form-group">
            <label class="form-label" for="step1FullName">Full Name <span style="color:#dc2626;">*</span></label>
            <input type="text" class="form-input" id="step1FullName" name="fullName" value="${escapeHtml(userFullName)}" placeholder="Enter your full name" required autocomplete="name" />
          </div>

          <div class="form-group">
            <label class="form-label" for="step1Phone">Mobile Number (for WhatsApp delivery updates) <span style="color:#dc2626;">*</span></label>
            <input type="tel" class="form-input" id="step1Phone" name="phone" value="${escapeHtml(userPhone)}" placeholder="10-digit mobile number" maxlength="10" inputmode="numeric" required autocomplete="tel" />
          </div>

          <div class="form-group full-width">
            <label class="form-label" for="step1Email">Email Address (for Order Confirmation &amp; Invoice) <span style="color:#dc2626;">*</span></label>
            <input type="email" class="form-input" id="step1Email" name="email" value="${escapeHtml(userEmail)}" placeholder="you@example.com" required autocomplete="email" />
          </div>
        </div>

        <p id="step1ErrorMsg" style="color: #b91c1c; font-size: 0.85rem; margin: 4px 0 12px; font-weight: 600;"></p>

        <div class="step-actions-row">
          <a href="index.html#products" class="checkout-prev-btn">← Continue Shopping</a>
          <button type="submit" class="checkout-next-btn" id="step1NextBtn">
            Continue to Delivery Address →
          </button>
        </div>
      </form>
    `;

    const form = $('#step1DetailsForm');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const errEl = $('#step1ErrorMsg');
      if (errEl) errEl.textContent = '';

      const nameInput = $('#step1FullName')?.value.trim();
      const phoneInput = $('#step1Phone')?.value.trim();
      const emailInput = $('#step1Email')?.value.trim();

      if (!nameInput || nameInput.length < 2) {
        if (errEl) errEl.textContent = 'Please enter your full name (at least 2 characters).';
        $('#step1FullName')?.focus();
        return;
      }

      const cleanPhone = phoneInput.replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length !== 10) {
        if (errEl) errEl.textContent = 'Please enter a valid 10-digit mobile number for morning delivery updates.';
        $('#step1Phone')?.focus();
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailInput || !emailRegex.test(emailInput)) {
        if (errEl) errEl.textContent = 'Please enter a valid email address for your order invoice.';
        $('#step1Email')?.focus();
        return;
      }

      // Update state & persist edits
      state.addressDraft.name = nameInput;
      state.addressDraft.phone = cleanPhone;
      state.addressDraft.email = emailInput;

      if (!state.customer) {
        state.customer = { name: nameInput, full_name: nameInput, phone: cleanPhone, email: emailInput };
      } else {
        state.customer.name = nameInput;
        state.customer.full_name = nameInput;
        state.customer.phone = cleanPhone;
        state.customer.email = emailInput;
      }

      try {
        localStorage.setItem('milvanta-user', JSON.stringify({
          name: nameInput,
          full_name: nameInput,
          phone: cleanPhone,
          email: emailInput
        }));
      } catch {}

      updateAccountButton();

      state.currentStep = 2;
      updateStepper();
      renderStep2();
    });
  }

  // STEP 2: Address Render & Handlers
  function renderStep2() {
    const container = $('#step2Content');
    if (!container) return;

    const savedAddrHtml = state.savedAddresses && state.savedAddresses.length > 0
      ? `
        <div style="margin-bottom: 20px;">
          <span class="form-label" style="font-size: 0.88rem; color: var(--primary);">Choose from Saved Addresses:</span>
          <div class="saved-addresses-grid">
            ${state.savedAddresses.map((addr) => {
              const isSelected = state.selectedAddressId === addr.id;
              return `
                <label class="saved-addr-card ${isSelected ? 'selected' : ''}">
                  <input type="radio" name="savedAddrChoice" value="${addr.id}" ${isSelected ? 'checked' : ''} data-addr-id="${addr.id}" />
                  <div style="flex: 1;">
                    <strong>${escapeHtml(addr.name || state.addressDraft.name)}</strong> (${escapeHtml(addr.phone || state.addressDraft.phone)})
                    ${addr.is_default ? '<span class="addr-badge-default">Default</span>' : ''}
                    <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">
                      ${escapeHtml(addr.house || '')}, ${escapeHtml(addr.building || '')}, ${escapeHtml(addr.street || '')}, ${escapeHtml(addr.city || 'Hyderabad')} - ${escapeHtml(addr.pincode || '')}
                    </div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>
          <span style="font-size: 0.8rem; color: var(--text-muted); display: block; margin: 8px 0 14px;">Or confirm / edit delivery details below:</span>
        </div>
      `
      : '';

    container.innerHTML = `
      <form id="step2AddressForm" novalidate>
        ${savedAddrHtml}

        <div class="checkout-form-grid">
          <div class="form-group">
            <label class="form-label" for="addrName">Recipient Name <span style="color:#dc2626;">*</span></label>
            <input type="text" class="form-input" id="addrName" name="name" value="${escapeHtml(state.addressDraft.name)}" required />
          </div>

          <div class="form-group">
            <label class="form-label" for="addrPhone">Contact Mobile Number <span style="color:#dc2626;">*</span></label>
            <input type="tel" class="form-input" id="addrPhone" name="phone" value="${escapeHtml(state.addressDraft.phone)}" placeholder="10-digit mobile" maxlength="10" required />
          </div>

          <div class="form-group">
            <label class="form-label" for="addrHouse">House / Flat / Door Number <span style="color:#dc2626;">*</span></label>
            <input type="text" class="form-input" id="addrHouse" name="house" value="${escapeHtml(state.addressDraft.house)}" placeholder="e.g. Flat 402, Villa 18" required />
          </div>

          <div class="form-group">
            <label class="form-label" for="addrBuilding">Apartment / Building / Society <span style="color:#dc2626;">*</span></label>
            <input type="text" class="form-input" id="addrBuilding" name="building" value="${escapeHtml(state.addressDraft.building)}" placeholder="e.g. Greenwood Heights, My Home Jewel" required />
          </div>

          <div class="form-group full-width">
            <label class="form-label" for="addrStreet">Street / Locality / Area <span style="color:#dc2626;">*</span></label>
            <input type="text" class="form-input" id="addrStreet" name="street" value="${escapeHtml(state.addressDraft.street)}" placeholder="e.g. Madhapur Main Road, Near Cyber Towers" required />
          </div>

          <div class="form-group full-width">
            <label class="form-label" for="addrLandmark">Landmark (Optional)</label>
            <input type="text" class="form-input" id="addrLandmark" name="landmark" value="${escapeHtml(state.addressDraft.landmark)}" placeholder="e.g. Opposite Metro Pillar 12" />
          </div>

          <div class="form-group">
            <label class="form-label">City</label>
            <input type="text" class="form-input" id="addrCity" name="city" value="${escapeHtml(state.addressDraft.city || 'Hyderabad')}" readonly />
          </div>

          <div class="form-group">
            <label class="form-label">State</label>
            <input type="text" class="form-input" id="addrState" name="state" value="${escapeHtml(state.addressDraft.state || 'Telangana')}" readonly />
          </div>

          <div class="form-group full-width">
            <label class="form-label" for="addrPincode">Delivery PIN Code (Hyderabad Core City 500001 – 500096) <span style="color:#dc2626;">*</span></label>
            <input type="text" class="form-input" id="addrPincode" name="pincode" value="${escapeHtml(state.addressDraft.pincode)}" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" required />
            <div id="pincodeNotice" style="margin-top: 8px;"></div>
          </div>
        </div>

        <p id="step2ErrorMsg" style="color: #b91c1c; font-size: 0.85rem; margin: 4px 0 12px; font-weight: 600;"></p>

        <div class="step-actions-row">
          <button type="button" class="checkout-prev-btn" id="step2BackBtn">← Back to Details</button>
          <button type="submit" class="checkout-next-btn" id="step2NextBtn">
            Continue to Payment →
          </button>
        </div>
      </form>
    `;

    updatePincodeFeedback(state.addressDraft.pincode);

    // Saved address radio selection
    $$('input[name="savedAddrChoice"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const id = Number(e.target.value);
        state.selectedAddressId = id;
        const addr = state.savedAddresses.find(a => a.id === id);
        if (addr) {
          applySavedAddressToDraft(addr);
          renderStep2();
          renderSidebarSummary();
        }
      });
    });

    // Pincode input handler
    $('#addrPincode')?.addEventListener('input', (e) => {
      const pin = e.target.value.trim();
      state.addressDraft.pincode = pin;
      updatePincodeFeedback(pin);
      if (pin.length === 6) {
        localStorage.setItem('milvanta-pincode', pin);
        updateHeaderLocation();
        renderSidebarSummary();
      }
    });

    $('#step2BackBtn')?.addEventListener('click', () => {
      state.currentStep = 1;
      updateStepper();
      renderStep1();
    });

    $('#step2AddressForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const errEl = $('#step2ErrorMsg');
      if (errEl) errEl.textContent = '';

      const name = $('#addrName')?.value.trim();
      const phone = $('#addrPhone')?.value.trim();
      const house = $('#addrHouse')?.value.trim();
      const building = $('#addrBuilding')?.value.trim();
      const street = $('#addrStreet')?.value.trim();
      const landmark = $('#addrLandmark')?.value.trim();
      const pin = $('#addrPincode')?.value.trim();

      if (!name || !phone || !house || !building || !street || !pin) {
        if (errEl) errEl.textContent = 'Please fill in all required delivery address fields.';
        return;
      }

      const helper = window.MilvantaDelivery;
      const info = helper ? helper.getDeliveryInfo(pin) : { inHyderabad: true, serviceable: true };

      if (!info.inHyderabad || !info.serviceable) {
        if (errEl) errEl.textContent = `Milvanta delivers across Hyderabad (500001–500096). PIN code ${pin} is outside our delivery zone.`;
        $('#addrPincode')?.focus();
        return;
      }

      state.addressDraft.name = name;
      state.addressDraft.phone = phone;
      state.addressDraft.house = house;
      state.addressDraft.building = building;
      state.addressDraft.street = street;
      state.addressDraft.landmark = landmark;
      state.addressDraft.city = 'Hyderabad';
      state.addressDraft.state = 'Telangana';
      state.addressDraft.pincode = pin;

      localStorage.setItem('milvanta-pincode', pin);
      updateHeaderLocation();
      renderSidebarSummary();

      state.currentStep = 3;
      updateStepper();
      renderStep3();
    });
  }

  function updatePincodeFeedback(pin) {
    const noticeEl = $('#pincodeNotice');
    if (!noticeEl) return;
    const helper = window.MilvantaDelivery;
    const info = helper ? helper.getDeliveryInfo(pin) : { inHyderabad: true, serviceable: true, area: 'Hafeezpet', fee: 50, distanceKm: 1 };

    if (!info.valid) {
      noticeEl.innerHTML = `<span style="color:#b91c1c; font-size:0.8rem; font-weight:600;">⚠️ Please enter a 6-digit PIN code.</span>`;
      return;
    }

    if (!info.inHyderabad) {
      noticeEl.innerHTML = `<span style="color:#b91c1c; font-size:0.8rem; font-weight:600;">❌ PIN code ${escapeHtml(pin)} is outside Hyderabad. Milvanta delivers within Hyderabad (500001–500096).</span>`;
      return;
    }

    noticeEl.innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#15803d; border-radius:6px; padding:8px 12px; font-size:0.82rem; font-weight:500;">
        📍 Delivering to <strong>${escapeHtml(info.area)}</strong> (~${info.distanceKm} km from Hafeezpet hub) · ₹${info.fee} morning delivery · 6:00 AM – 7:00 AM Drop!
      </div>
    `;
  }

  // Payments and subscription activation are authoritative in PostgreSQL.
  // Never manufacture an "active" plan in localStorage or reuse a one-time
  // order payment via POST /subscriptions (the backend intentionally rejects it).
  async function activateSubscriptionsFromCart(cartItems, paymentInfo = {}) {
    const hasSubscription = cartItems.some(item =>
      item.isContinuousMonthsPlan || item.variant?.isContinuousMonthsPlan ||
      item.isCustomDaysPlan || item.variant?.isCustomDaysPlan ||
      item.isSubscriptionPlan || item.variant?.isSubscriptionPlan
    );
    if (!hasSubscription) return { synced: true };
    try {
      const result = await api('/api/v1/subscriptions');
      if (!result || !Array.isArray(result.subscriptions)) {
        throw new Error('The server did not return subscription records.');
      }
      localStorage.setItem('milvanta-subscriptions', JSON.stringify(result.subscriptions));
      return { synced: true, subscriptions: result.subscriptions };
    } catch (error) {
      // Preserve the paid order record while refusing to display fake active
      // subscriptions. A background refresh or support may still be needed.
      try { localStorage.removeItem('milvanta-subscriptions'); } catch {}
      console.warn('Subscription records could not be refreshed after payment:', error.message);
      return { synced: false, message: 'Payment status is preserved; subscriptions will be shown after server synchronization.' };
    }
  }

  // If Razorpay returned a payment reference but the backend verification
  // was interrupted, NEVER initiate a second checkout without reconciling.
  const PENDING_ORDER_PAYMENT_KEY = 'milvanta-pending-order-payment';
  function getPendingOrderPayment() {
    try {
      const customerId = state.customer?.id;
      if (!customerId) return null;
      let raw = sessionStorage.getItem(PENDING_ORDER_PAYMENT_KEY);
      if (!raw) {
        raw = localStorage.getItem(PENDING_ORDER_PAYMENT_KEY + '-' + customerId);
      }
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || typeof p.orderNumber !== 'string' || !p.orderNumber || typeof p.paymentId !== 'string') return null;
      if (String(p.customerId || '') !== String(customerId)) return null;
      return p;
    } catch { return null; }
  }
  async function reconcilePendingOrderPayment(pending) {
    const payBtn = $('#payRazorpayBtn');
    const errEl = $('#checkoutErrorMessage');
    if (state.isPaymentProcessing) return;
    state.isPaymentProcessing = true;
    if (payBtn) { payBtn.disabled = true; payBtn.textContent = 'Checking payment status…'; }

    try {
      let orderConfirmed = false;
      let requiresReview = false;
      try {
        const response = await api('/api/v1/orders/' + encodeURIComponent(pending.orderNumber));
        orderConfirmed = response?.order?.payment_status === 'paid' &&
          response?.order?.order_status === 'confirmed';
        requiresReview = response?.order?.payment_status === 'paid' &&
          response?.order?.order_status !== 'confirmed';
      } catch (checkError) {
        if (checkError.status === 401) { showLoginRequired(); return; }
      }

      if (!orderConfirmed && !requiresReview && pending.orderId && pending.paymentId && pending.signature) {
        try {
          const result = await api('/api/v1/payments/verify', {
            method: 'POST',
            body: JSON.stringify({
              razorpay_order_id: pending.orderId,
              razorpay_payment_id: pending.paymentId,
              razorpay_signature: pending.signature
            })
          });
          orderConfirmed = result?.verified === true && result.status === 'captured' &&
            result.orderStatus === 'confirmed' && result.requiresManualReview !== true;
          requiresReview = result?.requiresManualReview === true || result?.orderStatus === 'payment_review';
        } catch (verifyError) {
          if (verifyError.status === 401) { showLoginRequired(); return; }
        }
      }

      // Reconcile independently of browser callbacks: server retrieves the
      // ORIGINAL order's gateway payments with its own Razorpay credentials.
      if (!orderConfirmed && !requiresReview) {
        try {
          const result = await api('/api/v1/orders/' + encodeURIComponent(pending.orderNumber) + '/reconcile-payment', {
            method: 'POST'
          });
          orderConfirmed = result?.state === 'confirmed';
          requiresReview = result?.state === 'payment_review';
        } catch (reconcileError) {
          if (reconcileError.status === 401) { showLoginRequired(); return; }
          if (reconcileError.status === 409) requiresReview = true;
          else if (errEl) errEl.textContent = 'Gateway status is temporarily unavailable. Do not pay again; retry status check or contact support.';
        }
      }

      if (requiresReview) {
        if (errEl) errEl.textContent = 'The gateway payment requires manual reconciliation. Do not pay again. Please contact Milvanta support with order ' + pending.orderNumber + '.';
        return;
      }
      if (!orderConfirmed) {
        if (errEl && !errEl.textContent) {
          errEl.textContent = 'Payment is still unconfirmed. Do not pay again yet. Use Check Payment Status or contact support with order ' + pending.orderNumber + '.';
        }
        return;
      }

      // Financial confirmation comes from PostgreSQL/Razorpay, not localStorage.
      // Local subscription activation remains best-effort; a failed local
      // follow-up MUST NOT cause a second payment.
      try {
        const financials = getOrderFinancials();
        await activateSubscriptionsFromCart(state.cart, {
          paymentId: pending.paymentId || '',
          deliveryFee: financials.deliveryFee,
          totalPaid: financials.total,
          subtotal: financials.subtotal
        });
      } catch (activationError) {
        console.warn('Post-payment subscription refresh needs attention:', activationError.message);
      }
      sessionStorage.removeItem(PENDING_ORDER_PAYMENT_KEY);
      if (pending.customerId) {
        try { localStorage.removeItem(PENDING_ORDER_PAYMENT_KEY + '-' + pending.customerId); } catch {}
      }
      showOrderSuccess(pending.orderNumber, false);
    } catch (error) {
      if (error.status === 401) { showLoginRequired(); return; }
      if (errEl) errEl.textContent = 'Unable to confirm the payment now. Do not pay again yet; try status check or contact support.';
    } finally {
      state.isPaymentProcessing = false;
      const stillPending = sessionStorage.getItem(PENDING_ORDER_PAYMENT_KEY) ||
        (pending.customerId && localStorage.getItem(PENDING_ORDER_PAYMENT_KEY + '-' + pending.customerId));
      if (payBtn && stillPending) {
        payBtn.disabled = false;
        payBtn.textContent = 'Check Payment Status (no new charge)';
      }
    }
  }

  // STEP 3: Review & Payment Render & Handlers
  function renderStep3() {
    const container = $('#step3Content');
    if (!container) return;

    const { total } = getOrderFinancials();
    const addr = state.addressDraft;

    const continuousItem = state.cart.find((item) => item.isContinuousMonthsPlan || item.variant?.isContinuousMonthsPlan);
    const customDaysItem = state.cart.find((item) => item.isCustomDaysPlan || item.variant?.isCustomDaysPlan);
    const hasContinuous = Boolean(continuousItem);
    const hasCustomDays = Boolean(customDaysItem);

    let paymentMethodHtml = '';
    if (hasContinuous) {
      paymentMethodHtml = `
        <div class="payment-method-card" style="border: 2px solid #0284c7; background: #f0f9ff; border-radius: 12px; padding: 20px;">
          <div class="payment-method-header" style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.6rem;">🔄</span>
            <div>
              <div class="payment-method-title" style="color: #0369a1; font-weight: 700; font-size: 1.05rem;">Subscription-Based Payment (Razorpay Subscriptions)</div>
              <div style="font-size: 0.8rem; color: #0284c7; font-weight: 500;">
                Continuous Morning Delivery Plan · Recurring billing via UPI Autopay, Cards, or NetBanking
              </div>
            </div>
          </div>
          <div style="margin: 14px 0 10px; padding: 10px 14px; background: #ffffff; border-radius: 8px; border: 1px solid #bae6fd; font-size: 0.85rem; color: #0c4a6e;">
            🥛 <strong>${escapeHtml(continuousItem.name || 'Fresh Milk')}</strong>: ${escapeHtml(continuousItem.size || continuousItem.variant?.size || '')}
          </div>
          <div class="payment-badges-list">
            <span class="pay-chip" style="background:#e0f2fe; color:#0369a1; font-weight:700;">UPI Autopay</span>
            <span class="pay-chip" style="background:#e0f2fe; color:#0369a1; font-weight:700;">Credit / Debit Card</span>
            <span class="pay-chip" style="background:#e0f2fe; color:#0369a1; font-weight:700;">Net Banking</span>
            <span class="pay-chip">Google Pay</span>
            <span class="pay-chip">PhonePe</span>
          </div>
        </div>
      `;
    } else {
      paymentMethodHtml = `
        <div class="payment-method-card" style="border-radius: 12px; padding: 20px;">
          <div class="payment-method-header" style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.6rem;">🔒</span>
            <div>
              <div class="payment-method-title" style="font-weight: 700; font-size: 1.05rem;">${hasCustomDays ? 'Normal Payment (Custom Days Plan)' : 'Razorpay Secure Checkout'}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">
                ${hasCustomDays ? 'Standard one-time payment for your selected custom days milk delivery' : 'One-time payment via UPI, Google Pay, PhonePe, Cards, NetBanking'}
              </div>
            </div>
          </div>
          ${hasCustomDays ? `
            <div style="margin: 14px 0 10px; padding: 10px 14px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0; font-size: 0.85rem; color: #166534;">
              🥛 <strong>${escapeHtml(customDaysItem.name || 'Fresh Milk')}</strong>: ${escapeHtml(customDaysItem.size || customDaysItem.variant?.size || '')} · Standard one-time payment
            </div>
          ` : ''}
          <div class="payment-badges-list">
            <span class="pay-chip">Google Pay</span>
            <span class="pay-chip">PhonePe</span>
            <span class="pay-chip">Paytm</span>
            <span class="pay-chip">BHIM UPI</span>
            <span class="pay-chip">Visa</span>
            <span class="pay-chip">Mastercard</span>
            <span class="pay-chip">RuPay</span>
            <span class="pay-chip">Net Banking</span>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="review-recap-box">
        <div class="recap-row">
          <span class="recap-label">Recipient</span>
          <span class="recap-val"><strong>${escapeHtml(addr.name)}</strong> (${escapeHtml(addr.phone)}) · ${escapeHtml(addr.email)}</span>
          <button type="button" class="recap-edit-btn" id="editRecipientBtn">Edit</button>
        </div>
        <div class="recap-row">
          <span class="recap-label">Drop Address</span>
          <span class="recap-val">${escapeHtml(addr.house)}, ${escapeHtml(addr.building)}, ${escapeHtml(addr.street)}${addr.landmark ? `, ${escapeHtml(addr.landmark)}` : ''}, ${escapeHtml(addr.city)} - ${escapeHtml(addr.pincode)}</span>
          <button type="button" class="recap-edit-btn" id="editAddrBtn">Edit</button>
        </div>
      </div>

      ${paymentMethodHtml}

      <p id="checkoutErrorMessage" style="color: #b91c1c; font-size: 0.85rem; font-weight: 600; margin: 10px 0;"></p>

      <div class="step-actions-row">
        <button type="button" class="checkout-prev-btn" id="step3BackBtn">← Back to Address</button>
        <button type="button" class="checkout-next-btn" id="payRazorpayBtn" style="font-size: 1.05rem; padding: 15px 32px; background: ${hasContinuous ? '#0284c7' : '#059669'};">
          ${hasContinuous ? `Pay ₹${total.toFixed(0)} via Subscription 🔒` : `Pay ₹${total.toFixed(0)} via Razorpay 🔒`}
        </button>
      </div>
    `;

    $('#editRecipientBtn')?.addEventListener('click', () => {
      state.currentStep = 1;
      updateStepper();
      renderStep1();
    });

    $('#editAddrBtn')?.addEventListener('click', () => {
      state.currentStep = 2;
      updateStepper();
      renderStep2();
    });

    $('#step3BackBtn')?.addEventListener('click', () => {
      state.currentStep = 2;
      updateStepper();
      renderStep2();
    });

    const pendingAuth = getPendingSubscriptionAuth();
    if (pendingAuth && hasContinuous) {
      const payBtn = $('#payRazorpayBtn');
      const errEl = $('#checkoutErrorMessage');
      if (payBtn) {
        payBtn.textContent = 'Check Subscription Status 🔄';
      }
      if (errEl) {
        errEl.style.color = '#c0392b';
        errEl.style.fontWeight = '600';
        errEl.textContent = `Subscription payment was authorized (${pendingAuth.paymentId}), but server verification is pending. Click below to check status without paying again.`;
      }
    }

    $('#payRazorpayBtn')?.addEventListener('click', onPayButtonClick);
    const unresolved = getPendingOrderPayment();
    if (unresolved) {
      const payBtn = $('#payRazorpayBtn');
      const errEl = $('#checkoutErrorMessage');
      if (payBtn) payBtn.textContent = 'Check Payment Status (no new charge)';
      if (errEl) errEl.textContent = 'A prior payment attempt needs confirmation. Check its status instead of paying again.';
    }
  }

  // Load Razorpay Script Dynamically
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

  // Customer-Authenticated Read-Only Subscription Status Checker
  async function checkSubscriptionStatusWithServer(authPayload) {
    if (!authPayload) return false;
    const payBtn = $('#payRazorpayBtn');
    const errEl = $('#checkoutErrorMessage');

    state.isPaymentProcessing = true;
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = 'Checking Subscription Status…';
    }
    if (errEl) {
      errEl.textContent = '';
    }

    try {
      const statusRes = await api(`/api/v1/subscriptions/${encodeURIComponent(authPayload.subscriptionId)}/status`);
      if (statusRes && statusRes.success) {
        // Tightened paid-success condition: require all 5 conditions
        const isAuthoritativePaidSuccess = Boolean(
          statusRes.state === 'active_paid' &&
          statusRes.isPaid === true &&
          statusRes.fulfillmentEntitled === true &&
          statusRes.status === 'active' &&
          statusRes.localSubscriptionId
        );

        if (isAuthoritativePaidSuccess) {
          try { sessionStorage.removeItem('pending_subscription_auth'); } catch {}
          const finalFinancials = getOrderFinancials();
          await activateSubscriptionsFromCart(state.cart, {
            subscriptionId: authPayload.subscriptionId,
            paymentId: authPayload.paymentId || statusRes.lastPaymentId || '',
            deliveryFee: finalFinancials.deliveryFee,
            totalPaid: finalFinancials.total,
            subtotal: finalFinancials.subtotal
          });
          state.isPaymentProcessing = false;
          showOrderSuccess(authPayload.paymentId || statusRes.lastPaymentId || '', true);
          return true;
        }

        if (statusRes.state === 'mandate_authorized_awaiting_payment' || statusRes.status === 'pending_authorization') {
          try {
            sessionStorage.setItem('pending_subscription_auth', JSON.stringify(authPayload));
          } catch {}
          if (errEl) {
            errEl.style.color = '#0a3d66';
            errEl.style.fontWeight = '600';
            errEl.textContent = 'Mandate authorized — awaiting first recurring billing payment.';
          }
          if (payBtn) {
            payBtn.disabled = true;
            payBtn.textContent = 'Mandate Authorized (Awaiting First Payment)';
          }
          state.isPaymentProcessing = false;
          return true;
        }

        if (statusRes.state === 'pending_reconciliation' || !statusRes.localSubscriptionId) {
          try {
            sessionStorage.setItem('pending_subscription_auth', JSON.stringify(authPayload));
          } catch {}
          if (errEl) {
            errEl.style.color = '#0a3d66';
            errEl.style.fontWeight = '600';
            errEl.textContent = 'Subscription authorization received — syncing with store records. Click below to re-check status.';
          }
          if (payBtn) {
            payBtn.disabled = false;
            payBtn.textContent = 'Check Subscription Status 🔄';
          }
          state.isPaymentProcessing = false;
          return false;
        }

        if (statusRes.state === 'active_unverified') {
          try {
            sessionStorage.setItem('pending_subscription_auth', JSON.stringify(authPayload));
          } catch {}
          if (errEl) {
            errEl.style.color = '#c0392b';
            errEl.style.fontWeight = '600';
            errEl.textContent = 'Subscription is awaiting verified billing cycle evidence. Click below to re-check status.';
          }
          if (payBtn) {
            payBtn.disabled = false;
            payBtn.textContent = 'Check Subscription Status 🔄';
          }
          state.isPaymentProcessing = false;
          return false;
        }
      }
    } catch (statusErr) {
      console.warn('Status lookup notice:', statusErr);
    }

    // Never initiate payment or open Razorpay!
    // Preserve pendingAuth and show re-check button
    try {
      sessionStorage.setItem('pending_subscription_auth', JSON.stringify(authPayload));
    } catch {}

    if (errEl) {
      errEl.style.color = '#c0392b';
      errEl.style.fontWeight = '600';
      errEl.textContent = `Subscription payment was authorized (${authPayload?.paymentId || 'N/A'}), but server verification is pending. Click below to check status without paying again.`;
    }
    if (payBtn) {
      payBtn.disabled = false;
      payBtn.textContent = 'Check Subscription Status 🔄';
    }
    state.isPaymentProcessing = false;
    return false;
  }

  // Server-Authoritative Subscription Verification & Fulfillment Activation
  async function verifySubscriptionWithServer(authPayload) {
    if (!authPayload) return false;
    const payBtn = $('#payRazorpayBtn');
    const errEl = $('#checkoutErrorMessage');

    state.isPaymentProcessing = true;
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = 'Verifying Subscription Authorization…';
    }
    if (errEl) {
      errEl.textContent = '';
    }

    let verifyRes;
    try {
      verifyRes = await api('/api/v1/subscriptions/verify', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_subscription_id: authPayload.subscriptionId,
          razorpay_payment_id: authPayload.paymentId,
          razorpay_signature: authPayload.signature
        })
      });
      if (!verifyRes || !verifyRes.verified) {
        throw new Error(verifyRes?.error || 'Subscription signature verification failed.');
      }
    } catch (verifyErr) {
      console.error('Subscription verification failed:', verifyErr);
      // On unresolved verification, preserve the signed authorization and prevent a new payment
      try {
        sessionStorage.setItem('pending_subscription_auth', JSON.stringify(authPayload));
      } catch {}

      if (errEl) {
        errEl.style.color = '#c0392b';
        errEl.style.fontWeight = '600';
        errEl.textContent = `Subscription payment was authorized (${authPayload?.paymentId || 'N/A'}), but server verification is pending. Click below to check status without paying again.`;
      }
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.textContent = 'Check Subscription Status 🔄';
      }
      state.isPaymentProcessing = false;
      return false;
    }

    // Handle mandate-only pending authorization without premature activation or paid confirmation
    if (verifyRes?.status === 'pending_authorization' || verifyRes?.fulfillmentEntitled === false) {
      // Preserve signed authorization so customer is not prompted to initiate another checkout
      try {
        sessionStorage.setItem('pending_subscription_auth', JSON.stringify(authPayload));
      } catch {}

      if (errEl) {
        errEl.style.color = '#0a3d66';
        errEl.style.fontWeight = '600';
        errEl.textContent = 'Mandate authorized — awaiting first billing payment.';
      }
      if (payBtn) {
        payBtn.disabled = true;
        payBtn.textContent = 'Mandate Authorized (Awaiting First Payment)';
      }
      state.isPaymentProcessing = false;
      return true;
    }

    // Authoritative active subscription with verified captured payment!
    try { sessionStorage.removeItem('pending_subscription_auth'); } catch {}
    const finalFinancials = getOrderFinancials();
    await activateSubscriptionsFromCart(state.cart, {
      subscriptionId: authPayload.subscriptionId,
      paymentId: authPayload.paymentId,
      deliveryFee: finalFinancials.deliveryFee,
      totalPaid: finalFinancials.total,
      subtotal: finalFinancials.subtotal
    });

    // Trigger subscription confirmation email
    try {
      await api('/api/v1/subscriptions/send-confirmation', {
        method: 'POST',
        body: JSON.stringify({
          subscriptionId: authPayload.subscriptionId,
          paymentId: authPayload.paymentId,
          deliveryFee: finalFinancials.deliveryFee,
          totalPaid: finalFinancials.total,
          cart: state.cart,
          address: state.addressDraft,
          customer: {
            name: state.addressDraft.name,
            email: state.addressDraft.email,
            phone: state.addressDraft.phone
          }
        })
      });
    } catch (emErr) {
      console.warn('Subscription email trigger notice:', emErr);
    }

    state.isPaymentProcessing = false;
    showOrderSuccess(authPayload.paymentId, true);
    return true;
  }

  // Unified Pay Button Handler with Duplicate-Click & State Routing Protection
  async function onPayButtonClick(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (state.isPaymentProcessing) {
      console.warn('Payment or verification already in progress. Duplicate click ignored.');
      return;
    }

    const pendingAuth = getPendingSubscriptionAuth();
    if (pendingAuth) {
      // Clicking "Check Subscription Status" calls authenticated server status, NEVER razorpay-checkout or Razorpay.open()
      return await checkSubscriptionStatusWithServer(pendingAuth);
    }
    const pendingOrderPayment = getPendingOrderPayment();
    if (pendingOrderPayment) return await reconcilePendingOrderPayment(pendingOrderPayment);

    return await executeOrderPayment();
  }

  // Execute Payment
  async function executeOrderPayment() {
    state.isPaymentProcessing = true;
    const payBtn = $('#payRazorpayBtn');
    const errEl = $('#checkoutErrorMessage');
    if (errEl) errEl.textContent = '';

    const orderFinancials = getOrderFinancials();
    const currentTotal = orderFinancials.total;
    const continuousItem = state.cart.find((item) => item.isContinuousMonthsPlan || item.variant?.isContinuousMonthsPlan);
    const hasContinuous = Boolean(continuousItem);

    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = hasContinuous ? 'Setting Up Subscription…' : 'Opening Secure Gateway…';
    }

    try {
      // Revalidate before creating ANY Razorpay order. Checkout may have been
      // open long enough for a session to expire or be revoked on another tab.
      const session = await api('/api/v1/auth/me');
      const verifiedCustomer = session.customer || session.user;
      if (!verifiedCustomer?.id || String(verifiedCustomer.id) !== String(state.customer?.id)) {
        throw new Error('Your account changed. Please sign in again before paying.');
      }
      await ensureRazorpayScript();

      if (hasContinuous) {
        // CONTINUOUS MONTHS: Subscription-based Payment via Razorpay Subscriptions
        const subData = continuousItem.subscriptionPlan || continuousItem.variant?.subscriptionPlan || {};
        const monthsCount = subData.monthsCount || continuousItem.variant?.monthsCount || 1;
        const daysCount = subData.days || continuousItem.variant?.days || (monthsCount * 30);
        const dailyRatePaise = (subData.dailyRate || continuousItem.variant?.dailyRate || 55) * 100;
        const startOffset = subData.startOffset || continuousItem.variant?.startOffset || 0;
        const prodId = Number(continuousItem.id) === 102 ? 2 : (Number(continuousItem.id) === 101 ? 1 : Number(continuousItem.id));
        const size = continuousItem.variant?.size || continuousItem.size || '500 ml';

        let res;
        try {
          res = await api('/api/v1/subscriptions/razorpay-checkout', {
            method: 'POST',
            body: JSON.stringify({
              productId: prodId,
              productName: continuousItem.name || 'Fresh Milk',
              size: size,
              monthsCount,
              daysCount,
              totalAmountPaise: Math.round(currentTotal * 100),
              dailyRatePaise,
              startOffset
            })
          });
        } catch (subErr) {
          state.isPaymentProcessing = false;
          console.error('Subscription checkout creation failed:', subErr);
          if (errEl) errEl.textContent = subErr.message || 'Unable to initialize subscription checkout. Please try again.';
          if (payBtn) {
            payBtn.disabled = false;
            payBtn.textContent = `Pay ₹${currentTotal.toFixed(0)} via Subscription 🔒`;
          }
          return;
        }

        const returnEndpoint = `${API_URL}/api/v1/subscriptions/callback?return_url=${encodeURIComponent(window.location.origin + '/profile.html?tab=subscription')}`;

        if (window.Razorpay && res?.subscriptionId) {
          const rzpOptions = {
            key: res.keyId || RAZORPAY_KEY,
            subscription_id: res.subscriptionId,
            name: 'Milvanta',
            description: `${continuousItem.name} · Continuous Subscription`,
            callback_url: returnEndpoint,
            prefill: {
              name: state.addressDraft.name,
              contact: state.addressDraft.phone,
              email: state.addressDraft.email || ''
            },
            theme: { color: '#0a3d66' },
            handler: async (response) => {
              const signedAuth = {
                subscriptionId: response?.razorpay_subscription_id || res.subscriptionId,
                paymentId: response?.razorpay_payment_id,
                signature: response?.razorpay_signature
              };
              try {
                sessionStorage.setItem('pending_subscription_auth', JSON.stringify(signedAuth));
              } catch {}

              await verifySubscriptionWithServer(signedAuth);
            },
            modal: {
              ondismiss: () => {
                state.isPaymentProcessing = false;
                if (errEl) errEl.textContent = 'Subscription checkout was cancelled. You can retry whenever ready.';
                if (payBtn) {
                  payBtn.disabled = false;
                  payBtn.textContent = `Pay ₹${currentTotal.toFixed(0)} via Subscription 🔒`;
                }
              }
            }
          };

          const rzp = new window.Razorpay(rzpOptions);
          rzp.open();
          return;
        }

        if (res?.shortUrl) {
          window.location.href = res.shortUrl;
          return;
        }

        throw new Error('Razorpay checkout modal failed to load. Please refresh and try again.');
      }

      // NORMAL PAYMENT: Custom Days Plan or Regular Products
      const orderBody = {
        address: state.addressDraft,
        // Resolve against the authoritative live catalog before reserving stock.
        items: await resolveCheckoutCartAgainstServer()
      };

      let order;
      try {
        order = await api('/api/v1/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': state.checkoutKey },
          body: JSON.stringify(orderBody)
        });
      } catch (orderErr) {
        state.isPaymentProcessing = false;
        console.error('Order creation failed:', orderErr);
        if (orderErr.status === 401) {
          showLoginRequired();
          return;
        }
        if (errEl) errEl.textContent = orderErr.message || 'Unable to place order. Please review your cart and try again.';
        if (payBtn) {
          payBtn.disabled = false;
          payBtn.textContent = `Pay ₹${currentTotal.toFixed(0)} via Razorpay 🔒`;
        }
        return;
      }

      const totalAmountPaise = Math.round(currentTotal * 100);
      const serverAmount = Number(order?.amount || 0);

      // Fail closed: a payment order must be a real Razorpay order. Never
      // attempt checkout in the backend's direct-placement fallback mode.
      if (order?.directMode || !/^order_[A-Za-z0-9]+$/.test(order?.orderId || '') ||
          !/^rzp_(live|test)_[A-Za-z0-9]+$/.test(order?.keyId || RAZORPAY_KEY || '')) {
        throw new Error('Secure payment is temporarily unavailable. No payment was started. Please contact Milvanta support.');
      }
      if (serverAmount !== totalAmountPaise) {
        throw new Error('The live server price is ₹' + (serverAmount / 100).toFixed(2) +
          ', but checkout displayed ₹' + (totalAmountPaise / 100).toFixed(2) +
          '. No payment was started. Refresh your cart to review the updated price.');
      }

      // A payment attempt may survive a browser close even if the Razorpay
      // handler never runs. Record the order before opening the gateway.
      try {
        const attempt = JSON.stringify({
          customerId: state.customer?.id,
          orderNumber: order.orderNumber,
          orderId: order.orderId,
          paymentId: '',
          signature: '',
          createdAt: Date.now()
        });
        sessionStorage.setItem(PENDING_ORDER_PAYMENT_KEY, attempt);
        if (state.customer?.id) localStorage.setItem(PENDING_ORDER_PAYMENT_KEY + '-' + state.customer.id, attempt);
      } catch {}

      const options = {
        key: order.keyId || RAZORPAY_KEY,
        amount: serverAmount > 0 ? serverAmount : totalAmountPaise,
        currency: order.currency || 'INR',
        name: 'Milvanta',
        description: `Order ${order.orderNumber} (Total ₹${currentTotal.toFixed(0)} incl. delivery)`,
        ...(order.orderId ? { order_id: order.orderId } : {}),
        prefill: {
          name: state.addressDraft.name,
          contact: state.addressDraft.phone,
          email: state.addressDraft.email || ''
        },
        theme: { color: '#0a3d66' },
        handler: async (response) => {
          if (payBtn) {
            payBtn.disabled = true;
            payBtn.textContent = 'Verifying Secure Payment…';
          }
          // Save a non-secret reconciliation reference BEFORE calling the server.
          // If connection/auth fails after Razorpay's callback, never offer to pay twice.
          const paymentId = response?.razorpay_payment_id;
          if (typeof paymentId === 'string' && paymentId) {
            try {
              const pendingRecord = JSON.stringify({
                customerId: state.customer?.id,
                orderNumber: order.orderNumber,
                orderId: response?.razorpay_order_id || order.orderId,
                paymentId,
                signature: response?.razorpay_signature || '',
                createdAt: Date.now()
              });
              sessionStorage.setItem(PENDING_ORDER_PAYMENT_KEY, pendingRecord);
              if (state.customer?.id) {
                // Never persist the signed Razorpay callback proof in durable storage.
                // Gateway reconciliation only needs the server-owned order reference.
                const safeForDurableStorage = JSON.parse(pendingRecord);
                safeForDurableStorage.signature = '';
                localStorage.setItem(PENDING_ORDER_PAYMENT_KEY + '-' + state.customer.id, JSON.stringify(safeForDurableStorage));
              }
            } catch {}
          }

          // SEC-03 & PAY-01: Verify signature with backend before confirming
          try {
            const verifyRes = await api('/api/v1/payments/verify', {
              method: 'POST',
              body: JSON.stringify(response)
            });
            if (!verifyRes || !verifyRes.verified || verifyRes.status !== 'captured' ||
                verifyRes.orderStatus !== 'confirmed' || verifyRes.requiresManualReview === true) {
              throw new Error(verifyRes?.error || 'Payment capture or fulfillment needs reconciliation.');
            }
          } catch (verifyErr) {
            console.error('Payment verification failed:', verifyErr);
            if (errEl) {
              errEl.textContent = 'Razorpay returned a payment reference, but final capture is unconfirmed. Check the status; do NOT pay again yet. Reference: ' + (response?.razorpay_payment_id || 'N/A');
            }
            state.isPaymentProcessing = false;
            if (payBtn) {
              payBtn.disabled = false;
              payBtn.textContent = 'Check Payment Status (no new charge)';
            }
            return; // Do NOT activate, do NOT clear cart, do NOT show success
          }

          try {
            await api(`/api/v1/orders/${encodeURIComponent(order.orderNumber)}/send-confirmation`, {
              method: 'POST',
              body: JSON.stringify({ paymentId: response?.razorpay_payment_id || '' })
            });
          } catch {}

          // Activate any Custom Days plan (or subscription items) in profile subscriptions & PostgreSQL!
          const finalFinancials = getOrderFinancials();
          await activateSubscriptionsFromCart(state.cart, {
            paymentId: response?.razorpay_payment_id || '',
            deliveryFee: finalFinancials.deliveryFee,
            totalPaid: finalFinancials.total,
            subtotal: finalFinancials.subtotal
          });

          sessionStorage.removeItem(PENDING_ORDER_PAYMENT_KEY);
          if (state.customer?.id) {
            try { localStorage.removeItem(PENDING_ORDER_PAYMENT_KEY + '-' + state.customer.id); } catch {}
          }
          state.isPaymentProcessing = false;
          showOrderSuccess(order.orderNumber, false);
        },
        modal: {
          ondismiss: () => {
            state.isPaymentProcessing = false;
            // Dismissal is not proof that no charge occurred.
            if (getPendingOrderPayment()) {
              if (errEl) errEl.textContent = 'Checkout closed. Check this order’s payment status before attempting another payment.';
              if (payBtn) {
                payBtn.disabled = false;
                payBtn.textContent = 'Check Payment Status (no new charge)';
              }
              return;
            }
            if (errEl) errEl.textContent = 'Payment checkout was closed.';
            if (payBtn) {
              payBtn.disabled = false;
              payBtn.textContent = `Pay ₹${currentTotal.toFixed(0)} via Razorpay 🔒`;
            }
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();

    } catch (err) {
      state.isPaymentProcessing = false;
      console.error('Payment execution failed:', err);
      if (err.status === 401) {
        showLoginRequired();
        return;
      }
      if (errEl) {
        errEl.textContent = err.message || 'Payment could not be completed. Please try again.';
      }
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.textContent = hasContinuous
          ? `Pay ₹${currentTotal.toFixed(0)} via Subscription 🔒`
          : `Pay ₹${currentTotal.toFixed(0)} via Razorpay 🔒`;
      }
    }
  }

  // Display Order Success Screen
  function showOrderSuccess(orderNumber, isSubscription = false) {
    const continuousItem = state.cart.find((i) => i.isContinuousMonthsPlan || i.variant?.isContinuousMonthsPlan);
    const customItem = state.cart.find((i) => i.isCustomDaysPlan || i.variant?.isCustomDaysPlan);
    const hasContinuous = isSubscription || Boolean(continuousItem);
    const hasCustom = Boolean(customItem);
    const hasAnySub = hasContinuous || hasCustom || state.cart.some((i) => i.isSubscriptionPlan || i.variant?.isSubscriptionPlan);

    const orderType = hasContinuous ? 'subscription_continuous' : (hasCustom ? 'subscription_custom' : 'regular');
    const orderTypeLabel = hasContinuous 
      ? 'Continuous Monthly Subscription Payment' 
      : (hasCustom ? 'Custom Days Plan Payment' : 'Store Order');

    try {
      const { total, subtotal, deliveryFee } = getOrderFinancials();
      const existingOrders = JSON.parse(localStorage.getItem('milvanta-orders') || '[]');
      const newOrderRecord = {
        order_number: orderNumber,
        orderType: orderType,
        orderTypeLabel: orderTypeLabel,
        items: state.cart.map((item) => {
          const prod = findProductInCatalog(item);
          const unitPrice = Number(item.variant?.price || item.price || prod.price || 0);
          const qty = Number(item.quantity || 1);
          return {
            productId: item.id || prod.id,
            name: item.name || item.variant?.name || prod.name || 'Milvanta Product',
            size: item.size || item.variant?.size || prod.size || '',
            image: item.image || prod.image || 'assets/milvanta-mark.png',
            quantity: qty,
            qty: qty,
            unitPrice: unitPrice,
            price: unitPrice,
            lineTotal: unitPrice * qty,
            isSubscriptionPlan: Boolean(item.isSubscriptionPlan || item.isContinuousMonthsPlan || item.variant?.isSubscriptionPlan || item.variant?.isContinuousMonthsPlan),
            isCustomDaysPlan: Boolean(item.isCustomDaysPlan || item.variant?.isCustomDaysPlan)
          };
        }),
        address: state.addressDraft,
        subtotal: subtotal,
        subtotal_paise: Math.round(subtotal * 100),
        deliveryFee: deliveryFee,
        delivery_charge_paise: Math.round(deliveryFee * 100),
        total: total,
        total_paise: Math.round(total * 100),
        order_status: 'placed',
        payment_status: 'paid',
        paymentMethod: hasContinuous 
          ? 'Paid via Subscription Autopay (Razorpay Recurring)' 
          : (hasCustom ? 'Paid Online via Razorpay (One-Time Upfront)' : 'Paid Online via Razorpay'),
        courier_name: 'Milvanta Cold-Chain Express (Hafeezpet Hub)',
        tracking_number: `MLV-${orderNumber}`,
        estimated_delivery: 'Tomorrow Morning · 6:00 AM – 7:00 AM',
        created_at: new Date().toISOString()
      };
      existingOrders.unshift(newOrderRecord);
      localStorage.setItem('milvanta-orders', JSON.stringify(existingOrders));

      const existingAddrs = JSON.parse(localStorage.getItem('milvanta-addresses') || '[]');
      const newAddrRecord = {
        id: Date.now(),
        type: 'Home',
        isDefault: true,
        ...state.addressDraft
      };
      existingAddrs.forEach((a) => (a.isDefault = false));
      existingAddrs.unshift(newAddrRecord);
      localStorage.setItem('milvanta-addresses', JSON.stringify(existingAddrs));

      localStorage.removeItem('milvanta-cart');
    } catch {}
    state.cart = [];
    updateCartCountBadge();

    $('.checkout-layout')?.classList.add('hidden');
    $('.checkout-stepper')?.classList.add('hidden');
    $('.checkout-top-bar')?.classList.add('hidden');

    const successEl = $('#orderSuccessScreen');
    if (successEl) {
      successEl.classList.remove('hidden');
      $('#successOrderNumber').textContent = orderNumber;
      $('#successAddress').textContent = `${state.addressDraft.house}, ${state.addressDraft.building}, ${state.addressDraft.street}, ${state.addressDraft.city} - ${state.addressDraft.pincode}`;

      if (hasAnySub) {
        let subNotice = $('#successSubscriptionNotice');
        if (!subNotice) {
          subNotice = document.createElement('div');
          subNotice.id = 'successSubscriptionNotice';
          subNotice.style.cssText = 'margin: 16px 0; padding: 14px 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; color: #15803d; font-size: 0.9rem; font-weight: 600; text-align: left;';
          subNotice.innerHTML = '🥛 <strong>Morning Milk Subscription is Active!</strong> Deliveries start tomorrow at 6:00 AM. View, pause or manage in <a href="profile.html?tab=subscription" style="color: #0369a1; text-decoration: underline; font-weight: 700;">Profile Subscriptions →</a>';
          const actionsRow = successEl.querySelector('div:last-child');
          if (actionsRow) successEl.insertBefore(subNotice, actionsRow);
        } else {
          subNotice.classList.remove('hidden');
        }
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Header & Footer Interactivity (Exact same features as index.html)
  function initHeaderAndFooterInteractions() {
    // 1. Mobile Menu Drawer Toggle
    const menuToggle = $('#menuToggle');
    const menuClose = $('#menuClose');
    const navScrim = $('#navScrim');
    const mainNav = $('#mainNav');

    function openMobileNav() {
      mainNav?.classList.add('active');
      navScrim?.classList.add('active');
      menuToggle?.setAttribute('aria-expanded', 'true');
    }

    function closeMobileNav() {
      mainNav?.classList.remove('active');
      navScrim?.classList.remove('active');
      menuToggle?.setAttribute('aria-expanded', 'false');
    }

    menuToggle?.addEventListener('click', openMobileNav);
    menuClose?.addEventListener('click', closeMobileNav);
    navScrim?.addEventListener('click', closeMobileNav);

    // 2. Delivery Location Pill & Pincode Modal
    const headerLocBtn = $('#headerLocationBtn');
    const mobileLocBtn = $('#mobileLocBtn');
    const pincodeModal = $('#pincodeModal');
    const pincodeClose = $('#pincodeClose');
    const pincodeForm = $('#pincodeForm');
    const pincodeInput = $('#pincodeInput');
    const pincodeFeedback = $('#pincodeFeedback');

    function openPincodeSelector() {
      if (!pincodeModal) return;
      pincodeModal.classList.remove('hidden');
      if (pincodeInput) {
        pincodeInput.value = state.addressDraft.pincode || localStorage.getItem('milvanta-pincode') || '500049';
        pincodeInput.focus();
      }
      if (pincodeFeedback) pincodeFeedback.textContent = '';
    }

    function closePincodeSelector() {
      pincodeModal?.classList.add('hidden');
    }

    headerLocBtn?.addEventListener('click', openPincodeSelector);
    mobileLocBtn?.addEventListener('click', () => {
      closeMobileNav();
      openPincodeSelector();
    });
    pincodeClose?.addEventListener('click', closePincodeSelector);
    pincodeModal?.addEventListener('click', (e) => {
      if (e.target === pincodeModal) closePincodeSelector();
    });

    pincodeForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = pincodeInput?.value.trim();
      const helper = window.MilvantaDelivery;
      const info = helper ? helper.getDeliveryInfo(pin) : { inHyderabad: true, valid: true, shortArea: 'Hafeezpet' };

      if (!info.valid) {
        if (pincodeFeedback) {
          pincodeFeedback.style.color = '#dc2626';
          pincodeFeedback.textContent = 'Please enter a valid 6-digit PIN code.';
        }
        return;
      }

      if (!info.inHyderabad) {
        if (pincodeFeedback) {
          pincodeFeedback.style.color = '#dc2626';
          pincodeFeedback.textContent = `Milvanta delivers across Hyderabad (500001–500096). ${pin} is outside Hyderabad.`;
        }
        return;
      }

      // Valid Hyderabad PIN
      state.addressDraft.pincode = pin;
      try { localStorage.setItem('milvanta-pincode', pin); } catch {}

      updateHeaderLocation();
      renderSidebarSummary();
      if (state.currentStep === 2) {
        const addrPin = $('#addrPincode');
        if (addrPin) addrPin.value = pin;
        updatePincodeFeedback(pin);
      }
      closePincodeSelector();
    });

    // 3. User Account Toggle & Dropdown Menu
    const accountToggle = $('#accountToggle');
    const userDropdown = $('#userAccountDropdown');
    const userLogout = $('#userMenuLogout');

    accountToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.customer) {
        userDropdown?.classList.toggle('hidden');
        const isOpen = !userDropdown?.classList.contains('hidden');
        accountToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      } else {
        showLoginRequired();
      }
    });

    document.addEventListener('click', (e) => {
      if (!userDropdown?.contains(e.target) && !accountToggle?.contains(e.target)) {
        userDropdown?.classList.add('hidden');
        accountToggle?.setAttribute('aria-expanded', 'false');
      }
    });

    userLogout?.addEventListener('click', () => {
      const tokenToRevoke = authToken;
      setAuthToken('');
      if (tokenToRevoke) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        void fetch(API_URL + '/api/v1/auth/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tokenToRevoke },
          signal: controller.signal,
          keepalive: true
        }).catch(() => {
          console.warn('Customer session revocation could not be confirmed; local credentials were cleared.');
        }).finally(() => clearTimeout(timeout));
      }
      state.customer = null;
      state.addressDraft = {
        name: '',
        phone: '',
        email: '',
        house: '',
        building: '',
        street: '',
        landmark: '',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500049'
      };
      state.savedAddresses = [];
      state.selectedAddressId = null;
      sessionStorage.removeItem(PENDING_ORDER_PAYMENT_KEY);
      try { localStorage.removeItem('milvanta-user'); } catch {}
      userDropdown?.classList.add('hidden');
      updateAccountButton();
      // Logged out users are not allowed on checkout page
      showLoginRequired();
    });

    // 4. Policy Modals in Footer
    const policyModal = $('#policyModal');
    const policyClose = $('#policyClose');
    const policyTitle = $('#policyTitle');
    const policyContent = $('#policyContent');

    function openPolicy(policyKey) {
      const p = POLICIES[policyKey];
      if (!p || !policyModal) return;
      if (policyTitle) policyTitle.textContent = p.title;
      if (policyContent) policyContent.innerHTML = p.html;
      policyModal.classList.remove('hidden');
    }

    function closePolicy() {
      policyModal?.classList.add('hidden');
    }

    $$('.policy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.policy;
        if (key) openPolicy(key);
      });
    });

    policyClose?.addEventListener('click', closePolicy);
    policyModal?.addEventListener('click', (e) => {
      if (e.target === policyModal) closePolicy();
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePincodeSelector();
        closePolicy();
        closeMobileNav();
        userDropdown?.classList.add('hidden');
      }
    });
  }

  // Update Header Location Pill & Drawer
  function updateHeaderLocation() {
    const pin = state.addressDraft.pincode || localStorage.getItem('milvanta-pincode') || '500049';
    const helper = window.MilvantaDelivery;
    const info = helper ? helper.getDeliveryInfo(pin) : { shortArea: 'Hafeezpet', fee: 50 };
    const areaName = (info.inHyderabad && info.shortArea) ? info.shortArea : 'Hafeezpet';

    const locText = $('#currentLocationText');
    if (locText) locText.textContent = areaName;

    const drawerLoc = $('#currentLocationDrawer');
    if (drawerLoc) drawerLoc.textContent = areaName;

    const drawerPin = $('#currentPincodeDrawer');
    if (drawerPin) drawerPin.textContent = pin;

    const locBtn = $('#headerLocationBtn');
    if (locBtn) {
      locBtn.title = `Delivering to ${info.area || areaName}, Hyderabad (${pin}) · Click to change`;
    }
  }

  // Update Cart Count Badge on Header Cart Button
  function updateCartCountBadge() {
    const badge = $('#cartCount');
    if (!badge) return;
    const count = state.cart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    badge.textContent = String(count);
    badge.setAttribute('aria-label', `${count} item${count === 1 ? '' : 's'} in cart`);
  }

  // Update Account Header Button (Shows initial avatar when logged in, Sign In when logged out)
  function updateAccountButton() {
    const btn = $('#accountToggle');
    const loggedOutIcon = $('#accountLoggedOutIcon');
    const label = $('#accountBtnText');
    const avatar = $('#accountAvatarCircle');
    const chevron = $('#accountChevronIcon');
    const dropdownName = $('#userDropdownName');
    const dropdownSub = $('#userDropdownSub');

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
      if (dropdownSub) dropdownSub.textContent = phone || email || 'Account';
    } else {
      btn?.classList.remove('is-logged-in');
      loggedOutIcon?.classList.remove('hidden');
      if (label) {
        label.textContent = 'Sign In';
        label.classList.remove('hidden');
      }
      avatar?.classList.add('hidden');
      chevron?.classList.add('hidden');
    }
  }

  // Escape HTML helper
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Initial Boot
  document.addEventListener('DOMContentLoaded', async () => {
    loadCart();
    initHeaderAndFooterInteractions();

    // Enforce authentication gate: user cannot view checkout unless logged in
    const authenticated = await checkAuthAndInit();
    if (!authenticated) {
      return; // showLoginRequired has redirected to login
    }

    if (state.cart.length === 0) {
      $('#emptyCartView')?.classList.remove('hidden');
      $('.checkout-layout')?.classList.add('hidden');
      $('.checkout-stepper')?.classList.add('hidden');
      return;
    }

    renderSidebarSummary();
    await fetchLiveCatalog();
    renderSidebarSummary();
    updateStepper();
  });

})();
