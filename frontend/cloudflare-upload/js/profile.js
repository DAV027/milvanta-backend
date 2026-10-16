/**
 * Milvanta Profile Page Logic
 * Handles Profile, Orders, Addresses, and Subscription management.
 * 
 * Rules:
 * - User info fetches live from /api/v1/auth/me (synced with milvanta-user in localStorage).
 * - Removed account membership and preferred delivery slot.
 * - My Orders fetches live from /api/v1/orders (with formatted items, status, live tracking, and reorder).
 * - Saved Addresses fetches live from /api/v1/addresses (add, set default, delete).
 * - Subscriptions fetches live from /api/v1/subscriptions (pause, resume, modify quantity).
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const API_URL = (window.MILVANTA_API_URL || 'https://milvanta-backend.onrender.com').replace(/\/$/, '');

  // Session token handling
  let authToken = (() => {
    try {
      return sessionStorage.getItem('milvanta-auth-token') || localStorage.getItem('milvanta-auth-token') || '';
    } catch {
      return '';
    }
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

  // App State
  const state = {
    activeTab: 'profile',
    customer: null,
    orders: [],
    addresses: [],
    subscriptions: []
  };

  // Helper API fetch
  async function apiRequest(path, options = {}) {
    const token = authToken || sessionStorage.getItem('milvanta-auth-token') || localStorage.getItem('milvanta-auth-token') || '';
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (!res.ok) {
      if (res.status === 401) {
        setAuthToken('');
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Show Toast Notification
  function showToast(msg) {
    let toast = $('#profileToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'profileToast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: #0d2137;
        color: #ffffff;
        padding: 12px 24px;
        border-radius: 9999px;
        font-size: 0.9rem;
        font-weight: 600;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        z-index: 9999;
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>✓</span> <span>${escapeHtml(msg)}</span>`;
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      toast.style.transform = 'translateX(-50%) translateY(100px)';
    }, 2800);
  }

  // Switch Tab
  function switchTab(tabId) {
    if (!['profile', 'orders', 'addresses', 'subscription'].includes(tabId)) {
      tabId = 'profile';
    }
    state.activeTab = tabId;

    // Update Tab Buttons
    $$('.profile-tab-btn').forEach((btn) => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Update Panels
    $$('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tabPanel-${tabId}`);
    });

    // Update URL query string without reloading
    const url = new URL(window.location);
    url.searchParams.set('tab', tabId);
    window.history.replaceState({}, '', url);

    // Scroll smoothly to top of content if on mobile
    if (window.innerWidth < 768) {
      $('.profile-content-container')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // ==========================================
  // 1. CUSTOMER PROFILE INITIALIZATION
  // ==========================================
  async function initProfile() {
    // A. Read cached customer from localStorage first for instant paint
    try {
      const saved = localStorage.getItem('milvanta-user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.full_name || parsed.name)) {
          state.customer = {
            id: parsed.id,
            name: parsed.full_name || parsed.name,
            phone: parsed.phone || '',
            email: parsed.email || '',
            city: parsed.city || 'Hafeezpet, Hyderabad'
          };
          renderUserInfo();
        }
      }
    } catch {}

    // B. Fetch live customer session if auth token exists
    const token = authToken || sessionStorage.getItem('milvanta-auth-token') || localStorage.getItem('milvanta-auth-token');
    if (token) {
      try {
        const data = await apiRequest('/api/v1/auth/me');
        const cust = data.customer || data.user;
        if (cust) {
          state.customer = {
            id: cust.id,
            name: cust.full_name || cust.name || 'Akhil',
            phone: cust.phone || '',
            email: cust.email || '',
            city: 'Hafeezpet, Hyderabad'
          };
          try {
            localStorage.setItem('milvanta-user', JSON.stringify(state.customer));
          } catch {}
          renderUserInfo();
        }
      } catch (err) {
        console.warn('Live profile fetch failed, using cached session:', err);
      }
    }

    // C. Gate unauthenticated visitors: If neither token nor user exists, redirect to login
    if (!state.customer && !token) {
      window.location.href = 'index.html?auth=login';
      return;
    }

    renderUserInfo();
  }

  // Render User Information across header and profile card
  function renderUserInfo() {
    if (!state.customer) return;

    const initial = (state.customer.name || 'A').charAt(0).toUpperCase();

    // Top card
    if ($('#accountUserAvatar')) $('#accountUserAvatar').textContent = initial;
    if ($('#accountUserName')) $('#accountUserName').textContent = state.customer.name;
    if ($('#accountUserPhone')) $('#accountUserPhone').textContent = state.customer.phone;

    // Header pill & dropdown
    const avatar = $('#accountAvatarCircle') || $('#profileHeaderAvatar');
    if (avatar) avatar.textContent = initial;
    const name = $('#userDropdownName') || $('#dropdownUserName');
    if (name) name.textContent = state.customer.name;
    const phone = $('#userDropdownSub') || $('#dropdownUserPhone');
    if (phone) phone.textContent = state.customer.phone;

    // Profile Tab Details
    if ($('#profileDetailName')) $('#profileDetailName').textContent = state.customer.name;
    if ($('#profileDetailPhone')) $('#profileDetailPhone').textContent = state.customer.phone ? `+91 ${state.customer.phone}` : '—';
    if ($('#profileDetailEmail')) $('#profileDetailEmail').textContent = state.customer.email || '—';

    // Delivery Location & Area from Pincode
    const pin = localStorage.getItem('milvanta-pincode') || '500049';
    const delivery = window.MilvantaDelivery;
    const info = delivery ? delivery.getDeliveryInfo(pin) : { shortArea: 'Hafeezpet' };
    const area = (info.inHyderabad && info.shortArea) ? info.shortArea : (localStorage.getItem('milvanta-area') || 'Hafeezpet');

    if ($('#currentLocationText')) $('#currentLocationText').textContent = area;
    if ($('#currentLocationDrawer')) $('#currentLocationDrawer').textContent = area;
    if ($('#currentPincodeDrawer')) $('#currentPincodeDrawer').textContent = pin;
    if ($('#profileDetailCity')) $('#profileDetailCity').textContent = `${area}, Hyderabad`;
  }

  // Update Cart Badge Count
  function updateCartBadge() {
    try {
      const cart = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
      const count = Array.isArray(cart) ? cart.reduce((sum, item) => sum + (item.quantity || 1), 0) : 0;
      const badge = $('#cartCount') || $('#profileCartCount');
      if (badge) badge.textContent = count;
    } catch {
      const badge = $('#cartCount') || $('#profileCartCount');
      if (badge) badge.textContent = '0';
    }
  }

  // ==========================================
  // 2. MY ORDERS FETCHING & RENDERING
  // ==========================================

  // Rich catalog lookup table for resolving images, pack sizes, and prices
  const productsCatalog = [
    { id: 101, name: 'Cow Milk', shortName: 'Cow Milk', price: 60, size: '500 ml pouch', image: 'assets/milvanta-cow-milk.jpg' },
    { id: 102, name: 'Buffalo Milk', shortName: 'Buffalo Milk', price: 70, size: '500 ml bottle', image: 'assets/milvanta-buffalo-milk.jpg' },
    { id: 104, name: 'Paneer', shortName: 'Paneer', price: 140, size: '200 g pack', image: 'assets/milvanta-paneer.jpg' },
    { id: 105, name: 'Curd', shortName: 'Curd', price: 65, size: '400 g tub', image: 'assets/milvanta-curd.jpg' },
    { id: 103, name: 'Ghee', shortName: 'Ghee', price: 1100, size: '500 ml jar', image: 'assets/milvanta-ghee.jpg' },
    { id: 1, name: 'Walnut Raagi Brownie', shortName: 'Walnut Brownie', price: 299, size: '1 Piece', image: 'assets/walnut-raagi-brownie.jpg' },
    { id: 2, name: 'Butter Cake with Couverture Chocolate Chips', shortName: 'Butter Cake', price: 350, size: '250 g cake', image: 'assets/butter-cake.jpg' },
    { id: 3, name: 'Kowa Cake', shortName: 'Kowa Cake', price: 150, size: '1 Piece', image: 'assets/kowa-cake.jpg' },
    { id: 4, name: 'Raagi Cookies', shortName: 'Raagi Cookies', price: 550, size: '250 g tin', image: 'assets/raagi-cookies.jpg' },
    { id: 5, name: 'Muesli', shortName: 'Muesli', price: 450, size: '250 g pack', image: 'assets/muesli.jpg' },
    { id: 6, name: 'Traditional Tomato Pickle', shortName: 'Tomato Pickle', price: 479, size: '500 g jar', image: 'assets/tomato-pickle.jpg' },
    { id: 7, name: 'Andhra Gongura Pickle', shortName: 'Gongura Pickle', price: 499, size: '500 g jar', image: 'assets/gongura-pickle.jpg' },
    { id: 8, name: 'Usirikaya Pickle (Amla)', shortName: 'Usirikaya Pickle', price: 499, size: '500 g jar', image: 'assets/usirikaya-pickle.jpg' },
    { id: 9, name: 'Pandu Mirchi Pickle', shortName: 'Pandu Mirchi Pickle', price: 489, size: '500 g jar', image: 'assets/pandu-mirchi-pickle.jpg' },
    { id: 10, name: 'Avakaya Mango Pickle', shortName: 'Mango Avakaya', price: 449, size: '500 g jar', image: 'assets/avakaya-mango-pickle.jpg' },
    { id: 12, name: 'Chicken Pickle (Boneless)', shortName: 'Chicken Pickle', price: 849, size: '500 g jar', image: 'assets/chicken-pickle-boneless.jpg' },
    { id: 14, name: 'Mutton Pickle (Boneless)', shortName: 'Mutton Pickle', price: 1149, size: '500 g jar', image: 'assets/mutton-pickle-boneless.jpg' },
    { id: 15, name: 'Prawns Pickle', shortName: 'Prawns Pickle', price: 1049, size: '500 g jar', image: 'assets/prawns-pickle.jpg' },
    { id: 16, name: 'Fish Pickle (Boneless)', shortName: 'Fish Pickle', price: 1049, size: '500 g jar', image: 'assets/fish-pickle-boneless.jpg' },
    { id: 17, name: 'Gongura Chicken (Boneless)', shortName: 'Gongura Chicken', price: 1149, size: '500 g jar', image: 'assets/gongura-chicken-pickle.jpg' },
    { id: 18, name: 'Gongura Mutton (Boneless)', shortName: 'Gongura Mutton', price: 1199, size: '500 g jar', image: 'assets/gongura-mutton-pickle.jpg' }
  ];

  // Helper to resolve accurate product image, pack size, and unit price
  function resolveProductInfo(item) {
    const rawName = String(item.name || item.product_name || '').trim();
    const lower = rawName.toLowerCase();
    const id = Number(item.productId || item.id || 0);

    // 1. Direct ID match
    if (id > 0) {
      const match = productsCatalog.find((p) => Number(p.id) === id);
      if (match) return match;
    }

    // 2. Exact or substring match in catalog name
    const byName = productsCatalog.find((p) => p.name.toLowerCase() === lower || lower.includes(p.name.toLowerCase()));
    if (byName) return byName;

    // 3. Keyword matching for all Milvanta specialties
    if (lower.includes('gongura mutton')) return { id: 18, name: 'Gongura Mutton (Boneless)', size: '500 g jar', price: 1199, image: 'assets/gongura-mutton-pickle.jpg' };
    if (lower.includes('gongura chicken')) return { id: 17, name: 'Gongura Chicken (Boneless)', size: '500 g jar', price: 1149, image: 'assets/gongura-chicken-pickle.jpg' };
    if (lower.includes('mutton pickle') || (lower.includes('mutton') && lower.includes('pickle'))) return { id: 14, name: 'Mutton Pickle (Boneless)', size: '500 g jar', price: 1149, image: 'assets/mutton-pickle-boneless.jpg' };
    if (lower.includes('chicken pickle') || (lower.includes('chicken') && lower.includes('pickle'))) return { id: 12, name: 'Chicken Pickle (Boneless)', size: '500 g jar', price: 849, image: 'assets/chicken-pickle-boneless.jpg' };
    if (lower.includes('prawn')) return { id: 15, name: 'Prawns Pickle', size: '500 g jar', price: 1049, image: 'assets/prawns-pickle.jpg' };
    if (lower.includes('fish pickle') || (lower.includes('fish') && lower.includes('pickle'))) return { id: 16, name: 'Fish Pickle (Boneless)', size: '500 g jar', price: 1049, image: 'assets/fish-pickle-boneless.jpg' };
    if (lower.includes('tomato pickle') || (lower.includes('tomato') && lower.includes('pickle'))) return { id: 6, name: 'Traditional Tomato Pickle', size: '500 g jar', price: 479, image: 'assets/tomato-pickle.jpg' };
    if (lower.includes('gongura pickle')) return { id: 7, name: 'Andhra Gongura Pickle', size: '500 g jar', price: 499, image: 'assets/gongura-pickle.jpg' };
    if (lower.includes('usirikaya') || lower.includes('amla')) return { id: 8, name: 'Usirikaya Pickle (Amla)', size: '500 g jar', price: 499, image: 'assets/usirikaya-pickle.jpg' };
    if (lower.includes('pandu mirchi')) return { id: 9, name: 'Pandu Mirchi Pickle', size: '500 g jar', price: 489, image: 'assets/pandu-mirchi-pickle.jpg' };
    if (lower.includes('avakaya') || lower.includes('mango')) return { id: 10, name: 'Avakaya Mango Pickle', size: '500 g jar', price: 449, image: 'assets/avakaya-mango-pickle.jpg' };
    if (lower.includes('cow milk') || (lower.includes('cow') && lower.includes('milk'))) return { id: 101, name: 'Pure Fresh Cow Milk', size: '500 ml pouch', price: 60, image: 'assets/milvanta-cow-milk.jpg' };
    if (lower.includes('buffalo milk') || (lower.includes('buffalo') && lower.includes('milk'))) return { id: 102, name: 'Pure Buffalo Milk', size: '500 ml bottle', price: 70, image: 'assets/milvanta-buffalo-milk.jpg' };
    if (lower.includes('paneer')) return { id: 104, name: 'Farm Fresh Malai Paneer', size: '200 g pack', price: 140, image: 'assets/milvanta-paneer.jpg' };
    if (lower.includes('curd') || lower.includes('dahi')) return { id: 105, name: 'Traditional Farm Curd', size: '400 g tub', price: 65, image: 'assets/milvanta-curd.jpg' };
    if (lower.includes('ghee')) return { id: 103, name: 'Desi Cow Bilona Ghee', size: '500 ml jar', price: 1100, image: 'assets/milvanta-ghee.jpg' };
    if (lower.includes('brownie')) return { id: 1, name: 'Walnut Raagi Brownie', size: '1 Piece', price: 299, image: 'assets/walnut-raagi-brownie.jpg' };
    if (lower.includes('butter cake')) return { id: 2, name: 'Butter Cake with Chocolate Chips', size: '250 g cake', price: 350, image: 'assets/butter-cake.jpg' };
    if (lower.includes('kowa cake')) return { id: 3, name: 'Heritage Kowa Cake', size: '1 Piece', price: 150, image: 'assets/kowa-cake.jpg' };
    if (lower.includes('cookie') || lower.includes('raagi cookie')) return { id: 4, name: 'Raagi Cookies', size: '250 g tin', price: 550, image: 'assets/raagi-cookies.jpg' };
    if (lower.includes('muesli')) return { id: 5, name: 'Artisanal Muesli', size: '250 g pack', price: 450, image: 'assets/muesli.jpg' };

    return {
      id: 0,
      name: rawName || 'Milvanta Selection',
      size: item.size || item.unit || '',
      price: Number(item.price || item.unitPrice || 0),
      image: item.image || item.imageUrl || item.image_url || 'assets/milvanta-mark.png'
    };
  }

  async function fetchOrders() {
    const container = $('#ordersListContainer');
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <div style="display: inline-block; width: 34px; height: 34px; border: 3px solid #e2e8f0; border-top-color: #0a3d66; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <p style="font-size: 0.9rem; color: #64748b; margin-top: 12px;">Fetching your orders from Milvanta hub...</p>
        </div>
      `;
    }

    let loadedOrders = [];

    // 1. Fetch live orders from backend API
    try {
      const data = await apiRequest('/api/v1/orders');
      if (data && Array.isArray(data.orders)) {
        loadedOrders = data.orders
          .filter((o) => String(o.order_status || o.status || '').toLowerCase() !== 'cancelled')
          .map(formatOrderRow);
      }
    } catch (err) {
      console.warn('Backend orders fetch failed, reading from local cache:', err);
    }

    // 2. Merge with any local orders saved in localStorage (from recent checkout)
    try {
      const localOrders = JSON.parse(localStorage.getItem('milvanta-orders') || '[]');
      if (Array.isArray(localOrders) && localOrders.length > 0) {
        localOrders.forEach((lo) => {
          const loStatus = String(lo.order_status || lo.status || '').toLowerCase();
          if (loStatus === 'cancelled') return;
          const loId = lo.id || lo.order_number;
          if (!loadedOrders.some((o) => o.id === loId)) {
            loadedOrders.push(formatOrderRow(lo));
          }
        });
      }
    } catch {}

    // Exclude any cancelled order
    loadedOrders = loadedOrders.filter((o) => String(o.status || '').toLowerCase() !== 'cancelled');

    // Sort by date descending
    loadedOrders.sort((a, b) => new Date(b.rawDate || b.date) - new Date(a.rawDate || a.date));

    state.orders = loadedOrders;
    renderOrders();
  }

  function formatOrderRow(row) {
    const id = row.order_number || row.id || `MV-${Date.now()}`;
    const rawDate = row.created_at || row.date || new Date().toISOString();
    let formattedDate = 'Recently placed';
    try {
      const d = new Date(rawDate);
      formattedDate = d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {}

    const status = (row.order_status || row.status || 'placed').toLowerCase();
    const statusMap = {
      placed: 'Order Placed',
      confirmed: 'Confirmed',
      bottled: 'Bottled Fresh',
      hub: 'At Cold Hub',
      out_for_delivery: 'Out for Delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled'
    };
    const statusLabel = row.statusLabel || statusMap[status] || 'Processing';

    // Parse items array
    let rawItems = [];
    if (Array.isArray(row.items)) {
      rawItems = row.items;
    } else if (typeof row.items === 'string') {
      try {
        const parsed = JSON.parse(row.items);
        if (Array.isArray(parsed)) rawItems = parsed;
      } catch {}
    }

    const items = rawItems.map((it) => {
      const resolved = resolveProductInfo(it);
      const name = it.name || it.product_name || resolved.name || `Milvanta Selection`;
      const qty = Number(it.quantity || it.qty || 1);
      const unitPrice = Number(
        it.unitPrice ||
        (it.unitPricePaise ? it.unitPricePaise / 100 : 0) ||
        it.price ||
        (it.price_paise ? it.price_paise / 100 : 0) ||
        resolved.price ||
        0
      );
      const lineTotal = Number(
        it.lineTotal ||
        (it.lineTotalPaise ? it.lineTotalPaise / 100 : 0) ||
        (unitPrice * qty)
      );

      return {
        productId: it.productId || it.id || resolved.id,
        name,
        size: it.size || it.unit || resolved.size || '',
        image: it.image || it.imageUrl || it.image_url || resolved.image || 'assets/milvanta-mark.png',
        qty,
        unitPrice,
        price: unitPrice,
        lineTotal
      };
    });

    // Subtotal, Delivery Fee & Total in rupees
    let subtotal = 0;
    if (row.subtotal_paise) {
      subtotal = Math.round(row.subtotal_paise / 100);
    } else if (row.subtotal) {
      subtotal = Math.round(row.subtotal);
    } else {
      subtotal = items.reduce((sum, it) => sum + it.lineTotal, 0);
    }

    let deliveryFee = 50;
    if (row.delivery_charge_paise) {
      deliveryFee = Math.round(row.delivery_charge_paise / 100);
    } else if (row.deliveryFee !== undefined) {
      deliveryFee = Math.round(row.deliveryFee);
    }

    let total = 0;
    if (row.total_paise) {
      total = Math.round(row.total_paise / 100);
    } else if (row.total) {
      total = Math.round(row.total);
    } else {
      total = subtotal + deliveryFee;
    }

    if (total > 0 && subtotal === 0) {
      subtotal = Math.max(0, total - deliveryFee);
    }

    // Address string & recipient details
    let addrStr = 'Hafeezpet, Hyderabad - 500049';
    let recipientName = state.customer?.name || 'Customer';
    let recipientPhone = state.customer?.phone || '';
    if (typeof row.address === 'object' && row.address !== null) {
      const a = row.address;
      recipientName = a.name || recipientName;
      recipientPhone = a.phone || recipientPhone;
      addrStr = `${a.house || ''}${a.building ? ', ' + a.building : ''}${a.street ? ', ' + a.street : ''}, ${a.city || 'Hyderabad'} - ${a.pincode || ''}`;
    } else if (typeof row.address === 'string' && row.address.trim()) {
      addrStr = row.address;
    }

    return {
      id,
      rawDate,
      date: formattedDate,
      status,
      statusLabel,
      items,
      subtotal,
      deliveryFee,
      total,
      recipientName,
      recipientPhone,
      address: addrStr,
      paymentStatus: (row.payment_status || 'paid').toUpperCase(),
      paymentMethod: row.paymentMethod || 'Paid Online via Razorpay',
      courier: row.courier_name || row.courier || 'Milvanta Cold-Chain Express (Hafeezpet Hub)',
      trackingNum: row.tracking_number || row.trackingNum || `MLV-${id}`,
      estDelivery: row.estimated_delivery || row.estDelivery || 'Tomorrow Morning · 6:00 AM – 7:00 AM'
    };
  }

  // Render Order Cards with rich thumbnails, detailed prices, and breakdown
  function renderOrders() {
    const container = $('#ordersListContainer');
    if (!container) return;

    // Filter out any cancelled orders
    const activeOrders = state.orders.filter((order) => String(order.status || '').toLowerCase() !== 'cancelled');

    if (!activeOrders.length) {
      container.innerHTML = `
        <div style="text-align: center; padding: 48px 20px; background: #fff; border-radius: 16px; border: 1px solid #eef2f6;">
          <div style="font-size: 2.8rem; margin-bottom: 12px;">🧺</div>
          <h3 style="font-size: 1.25rem; font-weight: 700; color: #0f172a; margin: 0 0 8px;">No Past Orders Yet</h3>
          <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 20px;">You haven't placed any orders yet. Fresh farm milk and authentic pickles are just a tap away.</p>
          <a href="index.html#products" class="address-card-btn" style="padding: 10px 22px; font-weight: 700; text-decoration: none; display: inline-block;">Browse Fresh Milk &amp; Pickles →</a>
        </div>
      `;
      return;
    }

    container.innerHTML = activeOrders.map((order) => {
      const itemsHtml = order.items.length > 0
        ? order.items.map((item) => `
            <div class="order-item-detailed-row">
              <div class="order-item-thumb-box">
                <img src="${item.image}" alt="${escapeHtml(item.name)}" class="order-item-thumb-img" onerror="this.src='assets/milvanta-mark.png'" loading="lazy" />
              </div>
              <div class="order-item-content">
                <div class="order-item-heading">
                  <h4 class="order-item-title">${escapeHtml(item.name)}</h4>
                  <span class="order-item-line-total">₹${item.lineTotal.toLocaleString('en-IN')}</span>
                </div>
                <div class="order-item-specs">
                  ${item.size ? `<span class="order-item-spec-badge">${escapeHtml(item.size)}</span>` : ''}
                  <span class="order-item-spec-qty">Qty: <strong>${item.qty}</strong></span>
                  <span class="order-item-spec-unit">₹${item.unitPrice.toLocaleString('en-IN')} each</span>
                </div>
              </div>
            </div>
          `).join('')
        : `<div class="order-item-detailed-row"><div class="order-item-content"><h4 class="order-item-title">Milvanta Farm Fresh Selection</h4></div></div>`;

      return `
        <article class="order-card" data-order-id="${order.id}">
          <div class="order-card-header">
            <div class="order-id-group">
              <span class="order-id">#${order.id}</span>
              <span class="order-date">Placed on ${order.date}</span>
            </div>
            <span class="order-status-pill ${order.status}">
              ${order.status === 'delivered' ? '✓' : order.status === 'out_for_delivery' ? '🛵' : '●'} ${order.statusLabel}
            </span>
          </div>

          <div class="order-items-list">
            ${itemsHtml}
          </div>

          <!-- Order Delivery & Bill Details Breakdown -->
          <div class="order-delivery-bill-card">
            <div class="order-destination-info">
              <div class="order-info-line">
                <span class="order-info-icon">📍</span>
                <div class="order-info-text">
                  <strong>Delivering to:</strong> ${escapeHtml(order.address)}
                </div>
              </div>
              <div class="order-info-line" style="margin-top: 4px;">
                <span class="order-info-icon">🕒</span>
                <div class="order-info-text">
                  <strong>Delivery Window:</strong> ${escapeHtml(order.estDelivery)}
                </div>
              </div>
            </div>

            <div class="order-bill-summary-bar">
              <div class="bill-metric">
                <span class="bill-metric-label">Items Subtotal</span>
                <span class="bill-metric-val">₹${order.subtotal.toLocaleString('en-IN')}</span>
              </div>
              <div class="bill-metric">
                <span class="bill-metric-label">Delivery Fee</span>
                <span class="bill-metric-val">${order.deliveryFee > 0 ? `₹${order.deliveryFee}` : 'FREE'}</span>
              </div>
              <div class="bill-metric total">
                <span class="bill-metric-label">Total Amount</span>
                <span class="bill-metric-val total-price">₹${order.total.toLocaleString('en-IN')}</span>
              </div>
              <div class="bill-payment-tag">
                <span class="payment-check-icon">✓</span>
                <span>${order.paymentMethod}</span>
              </div>
            </div>
          </div>

          <div class="order-card-footer">
            <div class="order-total-group">
              <span class="order-total-label">Grand Total Paid:</span>
              <span class="order-total-amount">₹${order.total.toLocaleString('en-IN')}</span>
            </div>
            <div class="order-actions-group">
              <button type="button" class="btn-order-details" data-details-id="${order.id}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>View Details</span>
              </button>
              <button type="button" class="btn-reorder" data-reorder-id="${order.id}">
                <span>+ Re-order</span>
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  // ==========================================
  // 3. SAVED ADDRESSES FETCHING & RENDERING
  // ==========================================
  async function fetchAddresses() {
    const container = $('#addressesGridContainer');
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 30px 20px;">
          <div style="display: inline-block; width: 30px; height: 30px; border: 3px solid #e2e8f0; border-top-color: #0a3d66; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <p style="font-size: 0.88rem; color: #64748b; margin-top: 10px;">Loading saved delivery addresses...</p>
        </div>
      `;
    }

    let loadedAddresses = [];

    // 1. Fetch live addresses from backend API
    try {
      const data = await apiRequest('/api/v1/addresses');
      if (data && Array.isArray(data.addresses)) {
        loadedAddresses = data.addresses.map(formatAddressRow);
      }
    } catch (err) {
      console.warn('Backend addresses fetch failed, reading from local cache:', err);
    }

    // 2. Merge with localStorage addresses
    try {
      const localAddrs = JSON.parse(localStorage.getItem('milvanta-addresses') || '[]');
      if (Array.isArray(localAddrs) && localAddrs.length > 0) {
        localAddrs.forEach((la) => {
          if (!loadedAddresses.some((a) => a.id === la.id || (a.house === la.house && a.pincode === la.pincode))) {
            loadedAddresses.push(formatAddressRow(la));
          }
        });
      }
    } catch {}

    // Ensure at least one default if addresses exist
    if (loadedAddresses.length > 0 && !loadedAddresses.some((a) => a.isDefault)) {
      loadedAddresses[0].isDefault = true;
    }

    state.addresses = loadedAddresses;
    try {
      localStorage.setItem('milvanta-addresses', JSON.stringify(loadedAddresses));
    } catch {}
    renderAddresses();
  }

  function formatAddressRow(row) {
    const id = row.id || Date.now();
    const isDefault = Boolean(row.is_default || row.isDefault);
    const house = row.house || '';
    const building = row.building || '';
    const street = row.street || '';
    const landmark = row.landmark || '';
    const city = row.city || 'Hyderabad';
    const stateVal = row.state || 'Telangana';
    const pincode = row.pincode || '500049';
    const name = row.name || row.recipient_name || state.customer?.name || 'Akhil';
    const phone = row.phone || state.customer?.phone || '6305974564';

    let type = row.type || 'Home';
    if (!row.type) {
      if (/office|work|park|tower|building|hitec|cyber/i.test(`${building} ${street} ${landmark}`)) {
        type = 'Work / Office';
      }
    }

    return {
      id,
      type,
      isDefault,
      name,
      phone,
      house,
      building,
      street,
      landmark,
      city,
      state: stateVal,
      pincode
    };
  }

  // Render Saved Addresses
  function renderAddresses() {
    const container = $('#addressesGridContainer');
    if (!container) return;

    if (!state.addresses.length) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; background: #fff; border-radius: 16px; border: 1px solid #eef2f6;">
          <p style="font-size: 1rem; color: #64748b; margin-bottom: 14px;">No saved delivery addresses found.</p>
          <button type="button" class="address-add-btn" onclick="document.getElementById('btnOpenAddAddress')?.click()">
            <span>+ Add Your First Address</span>
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = state.addresses.map((addr) => `
      <div class="address-card ${addr.isDefault ? 'is-default' : ''}">
        <div>
          <div class="address-tag-row">
            <span class="address-tag">${escapeHtml(addr.type)}</span>
            ${addr.isDefault ? '<span class="address-default-badge">✓ Default Address</span>' : ''}
          </div>
          <h4 class="address-recipient">${escapeHtml(addr.name)}</h4>
          <p class="address-phone">+91 ${escapeHtml(addr.phone)}</p>
          <p class="address-text">
            ${escapeHtml(addr.house)}${addr.building ? `, ${escapeHtml(addr.building)}` : ''}, ${escapeHtml(addr.street)}${addr.landmark ? `, ${escapeHtml(addr.landmark)}` : ''}<br />
            ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} - <strong>${escapeHtml(addr.pincode)}</strong>
          </p>
        </div>
        <div class="address-card-actions">
          ${!addr.isDefault ? `<button type="button" class="address-card-btn" data-set-default="${addr.id}">Set as Default</button>` : ''}
          <button type="button" class="address-card-btn" data-edit-addr="${addr.id}">Edit</button>
          ${!addr.isDefault ? `<button type="button" class="address-card-btn delete-btn" data-delete-addr="${addr.id}">Delete</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  // ==========================================
  // 4. SUBSCRIPTION FETCHING & RENDERING
  // ==========================================
  async function fetchSubscriptions() {
    const container = $('#subscriptionsGridContainer');
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 30px 20px;">
          <div style="display: inline-block; width: 30px; height: 30px; border: 3px solid #e2e8f0; border-top-color: #0a3d66; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <p style="font-size: 0.88rem; color: #64748b; margin-top: 10px;">Loading your active milk subscriptions...</p>
        </div>
      `;
    }

    let loadedSubs = [];

    // 1. Fetch live subscriptions from backend API
    try {
      const data = await apiRequest('/api/v1/subscriptions');
      if (data && Array.isArray(data.subscriptions) && data.subscriptions.length > 0) {
        loadedSubs = data.subscriptions.map(formatSubscriptionRow);
      }
    } catch (err) {
      console.warn('Backend subscriptions fetch failed, checking local cache:', err);
    }

    // 2. Read from localStorage if API empty or unavailable
    if (loadedSubs.length === 0) {
      try {
        const localSubs = JSON.parse(localStorage.getItem('milvanta-subscriptions') || '[]');
        if (Array.isArray(localSubs) && localSubs.length > 0) {
          loadedSubs = localSubs.map(formatSubscriptionRow);
        }
      } catch {}
    }

    // 3. If still empty, provide the standard initial milk subscription
    if (loadedSubs.length === 0) {
      const defaultSub = {
        id: 'sub-1',
        product: 'Pure Fresh Cow Milk (1 Litre)',
        image: 'assets/milvanta-cow-milk.jpg',
        frequency: 'Daily (Every Morning)',
        timeSlot: '6:00 AM – 7:00 AM',
        quantity: '1 Litre',
        qtyNum: 1,
        costPerDay: 60,
        status: 'active',
        nextDelivery: 'Tomorrow, 6:00 AM'
      };
      loadedSubs = [defaultSub];

      // Try creating in backend in background
      try {
        apiRequest('/api/v1/subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            productName: defaultSub.product,
            imageUrl: defaultSub.image,
            frequency: defaultSub.frequency,
            timeSlot: defaultSub.timeSlot,
            quantity: defaultSub.quantity,
            quantityNum: 1,
            costPerDayPaise: 6000
          })
        }).then((res) => {
          if (res?.subscription?.id) defaultSub.id = res.subscription.id;
        }).catch(() => {});
      } catch {}
    }

    state.subscriptions = loadedSubs;
    try {
      localStorage.setItem('milvanta-subscriptions', JSON.stringify(loadedSubs));
    } catch {}
    renderSubscriptions();
  }

  function formatSubscriptionRow(row) {
    return {
      id: row.id || Date.now(),
      product: row.product_name || row.product || 'Pure Fresh Milk (1 Litre)',
      image: row.image_url || row.image || 'assets/milvanta-cow-milk.jpg',
      frequency: row.frequency || 'Daily (Every Morning)',
      timeSlot: row.time_slot || row.timeSlot || '6:00 AM – 7:00 AM',
      quantity: row.quantity || '1 Litre',
      qtyNum: Number(row.quantity_num || row.qtyNum || 1),
      costPerDay: row.cost_per_day_paise ? Math.round(row.cost_per_day_paise / 100) : (Number(row.costPerDay) || 60),
      status: row.status || 'active',
      nextDelivery: row.next_delivery || row.nextDelivery || 'Tomorrow, 6:00 AM'
    };
  }

  // Render Subscriptions
  function renderSubscriptions() {
    const container = $('#subscriptionsGridContainer');
    if (!container) return;

    if (!state.subscriptions.length) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; background: #fff; border-radius: 16px; border: 1px solid #eef2f6;">
          <p style="font-size: 1rem; color: #64748b; margin-bottom: 14px;">No active subscriptions found.</p>
          <a href="index.html#products" class="address-card-btn" style="text-decoration: none; padding: 10px 20px; display: inline-block;">+ Subscribe to Morning Fresh Milk</a>
        </div>
      `;
      return;
    }

    container.innerHTML = state.subscriptions.map((sub) => `
      <div class="subscription-card" data-sub-id="${sub.id}">
        <div>
          <div class="subscription-item-header">
            <img src="${sub.image}" alt="${escapeHtml(sub.product)}" class="subscription-item-img" onerror="this.src='assets/milvanta-cow-milk.jpg'" />
            <div class="subscription-item-info">
              <span class="subscription-item-tag">Early Morning Delivery</span>
              <h4 class="subscription-item-title">${escapeHtml(sub.product)}</h4>
              <p class="subscription-item-meta">${escapeHtml(sub.frequency)} • ${escapeHtml(sub.timeSlot)}</p>
            </div>
          </div>
          <div class="subscription-details-list">
            <div class="sub-detail-row">
              <span class="sub-detail-label">Daily Quantity</span>
              <span class="sub-detail-val" id="qtyVal-${sub.id}"><strong>${escapeHtml(sub.quantity)}</strong></span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Status</span>
              <span class="status-badge-active" id="statusVal-${sub.id}" style="${sub.status === 'active' ? '' : 'background:#fef3c7; color:#b45309; border-color:#fde68a;'}">
                ${sub.status === 'active' ? '● Active Schedule' : '⏸ Paused'}
              </span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Next Scheduled Delivery</span>
              <span class="sub-detail-val" style="color: #0284c7; font-weight: 600;">${escapeHtml(sub.nextDelivery)}</span>
            </div>
          </div>
        </div>
        <div class="subscription-actions-row">
          <button type="button" class="btn-sub-pause" data-toggle-sub="${sub.id}">
            ${sub.status === 'active' ? '⏸ Pause' : '▶ Resume'}
          </button>
          <button type="button" class="btn-sub-modify" data-modify-sub="${sub.id}">
            ✎ Modify Qty
          </button>
        </div>
      </div>
    `).join('');
  }

  // ==========================================
  // 5. EVENT LISTENERS & USER ACTIONS
  // ==========================================
  function setupListeners() {
    // Tab switching buttons
    $$('.profile-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // Overview Card Buttons
    $('#btnGoOrders')?.addEventListener('click', () => switchTab('orders'));

    // Logout
    $('#btnLogout')?.addEventListener('click', logoutUser);
    $('#userMenuLogout')?.addEventListener('click', logoutUser);
    $('#dropdownLogoutBtn')?.addEventListener('click', logoutUser);

    // Header Account Dropdown Toggle
    const accountToggle = $('#accountToggle') || $('#profileAccountToggle');
    accountToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = $('#userAccountDropdown') || $('#profileUserDropdown');
      if (dropdown) dropdown.classList.toggle('hidden');
    });

    // Header Dropdown Navigation Items
    $$('[data-tab-target]').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        $('#userAccountDropdown')?.classList.add('hidden');
        $('#profileUserDropdown')?.classList.add('hidden');
        switchTab(item.dataset.tabTarget);
      });
    });

    // Close Dropdown on outside click
    document.addEventListener('click', (e) => {
      const menu = $('#accountMenuWrapper') || $('#profileAccountMenuWrapper');
      if (menu && !menu.contains(e.target)) {
        $('#userAccountDropdown')?.classList.add('hidden');
        $('#profileUserDropdown')?.classList.add('hidden');
      }
    });

    // Mobile Navigation Drawer
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
      if (e.target.closest('a')) setNavOpen(false);
    });

    // Mobile Search Toggle
    $('#mobileSearchToggle')?.addEventListener('click', () => {
      const container = $('.header-search-container');
      container?.classList.toggle('mobile-active');
      if (container?.classList.contains('mobile-active')) {
        $('#searchInput')?.focus();
      }
    });

    $('#clearSearch')?.addEventListener('click', () => {
      const input = $('#searchInput');
      if (input) {
        input.value = '';
        input.focus();
      }
    });

    // Pincode modal
    function openPincodeModal() {
      $('#pincodeModal')?.classList.remove('hidden');
      $('#pincodeInput')?.focus();
    }
    function closePincodeModal() {
      $('#pincodeModal')?.classList.add('hidden');
    }
    $('#headerLocationBtn')?.addEventListener('click', openPincodeModal);
    $('#mobileLocBtn')?.addEventListener('click', () => {
      setNavOpen(false);
      openPincodeModal();
    });
    $('#pincodeClose')?.addEventListener('click', closePincodeModal);

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

      localStorage.setItem('milvanta-pincode', pin);
      localStorage.setItem('milvanta-area', info.shortArea || info.area);

      if ($('#currentLocationText')) $('#currentLocationText').textContent = info.shortArea || 'Hafeezpet';
      if ($('#currentLocationDrawer')) $('#currentLocationDrawer').textContent = info.shortArea || 'Hafeezpet';
      if ($('#currentPincodeDrawer')) $('#currentPincodeDrawer').textContent = pin;
      if ($('#profileDetailCity')) $('#profileDetailCity').textContent = `${info.shortArea || 'Hafeezpet'}, Hyderabad`;

      $('#pincodeFeedback').style.color = '#15803d';
      $('#pincodeFeedback').textContent = `✓ Delivering to ${info.area} (~${info.distanceKm} km from Hafeezpet hub) · ₹${info.fee} delivery!`;
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

    // Orders Actions (Details & Reorder)
    $('#ordersListContainer')?.addEventListener('click', (e) => {
      const detailsBtn = e.target.closest('[data-details-id]');
      if (detailsBtn) {
        const orderId = detailsBtn.dataset.detailsId;
        openOrderDetailsModal(orderId);
        return;
      }

      const reorderBtn = e.target.closest('[data-reorder-id]');
      if (reorderBtn) {
        const orderId = reorderBtn.dataset.reorderId;
        const order = state.orders.find((o) => o.id === orderId);
        triggerReorder(order);
      }
    });

    // Close Order Details Modal
    $('#closeOrderDetailsModal')?.addEventListener('click', closeOrderDetailsModal);
    $('#closeOrderModalBtn')?.addEventListener('click', closeOrderDetailsModal);
    $('#orderDetailsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'orderDetailsModal') closeOrderDetailsModal();
    });

    // Addresses Actions (Set Default, Delete, Edit)
    $('#addressesGridContainer')?.addEventListener('click', async (e) => {
      const defBtn = e.target.closest('[data-set-default]');
      if (defBtn) {
        const id = defBtn.dataset.setDefault;
        try {
          await apiRequest(`/api/v1/addresses/${id}/default`, { method: 'PUT' });
        } catch (err) {
          console.warn('API set default failed:', err);
        }
        state.addresses.forEach((a) => (a.isDefault = String(a.id) === String(id)));
        try {
          localStorage.setItem('milvanta-addresses', JSON.stringify(state.addresses));
        } catch {}
        renderAddresses();
        showToast('Default delivery address updated!');
        return;
      }

      const delBtn = e.target.closest('[data-delete-addr]');
      if (delBtn) {
        const id = delBtn.dataset.deleteAddr;
        if (confirm('Delete this delivery address?')) {
          try {
            await apiRequest(`/api/v1/addresses/${id}`, { method: 'DELETE' });
          } catch (err) {
            console.warn('API delete address failed:', err);
          }
          state.addresses = state.addresses.filter((a) => String(a.id) !== String(id));
          try {
            localStorage.setItem('milvanta-addresses', JSON.stringify(state.addresses));
          } catch {}
          renderAddresses();
          showToast('Address removed.');
        }
        return;
      }

      const editBtn = e.target.closest('[data-edit-addr]');
      if (editBtn) {
        const id = editBtn.dataset.editAddr;
        const addr = state.addresses.find((a) => String(a.id) === String(id));
        if (addr) {
          const modal = $('#addAddressModal');
          if (modal) {
            modal.querySelector('h2').textContent = 'Edit Delivery Address';
            const form = $('#addNewAddressForm');
            if (form) {
              form.elements['name'].value = addr.name || '';
              form.elements['phone'].value = addr.phone || '';
              form.elements['house'].value = addr.house || '';
              form.elements['street'].value = addr.street || '';
              form.elements['city'].value = addr.city || 'Hyderabad';
              form.elements['pincode'].value = addr.pincode || '';
              form.elements['type'].value = addr.type || 'Home';
              form.elements['is_default'].checked = Boolean(addr.isDefault);
            }
            modal.classList.remove('hidden');
          }
        }
      }
    });

    // Add / Edit Address Form Modal Handlers
    $('#btnOpenAddAddress')?.addEventListener('click', () => {
      const modal = $('#addAddressModal');
      if (modal) {
        modal.querySelector('h2').textContent = 'Add Delivery Address';
        $('#addNewAddressForm')?.reset();
        if ($('#addNewAddressForm')?.elements['name']) {
          $('#addNewAddressForm').elements['name'].value = state.customer?.name || '';
        }
        if ($('#addNewAddressForm')?.elements['phone']) {
          $('#addNewAddressForm').elements['phone'].value = state.customer?.phone || '';
        }
        modal.classList.remove('hidden');
      }
    });

    $('#closeAddAddressModal')?.addEventListener('click', () => {
      $('#addAddressModal')?.classList.add('hidden');
    });
    $('#cancelAddAddressBtn')?.addEventListener('click', () => {
      $('#addAddressModal')?.classList.add('hidden');
    });

    $('#addNewAddressForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name')?.trim() || state.customer?.name || 'Akhil',
        phone: fd.get('phone')?.trim() || state.customer?.phone || '6305974564',
        house: fd.get('house')?.trim(),
        building: fd.get('street')?.trim() || '',
        street: fd.get('street')?.trim(),
        landmark: '',
        city: fd.get('city')?.trim() || 'Hyderabad',
        state: 'Telangana',
        pincode: fd.get('pincode')?.trim() || '500049',
        is_default: fd.get('is_default') === 'on'
      };

      let savedId = Date.now();
      try {
        const res = await apiRequest('/api/v1/addresses', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res?.address?.id) savedId = res.address.id;
      } catch (err) {
        console.warn('API save address failed:', err);
      }

      const newAddr = {
        id: savedId,
        type: fd.get('type') || 'Home',
        isDefault: payload.is_default,
        ...payload
      };

      if (newAddr.isDefault) {
        state.addresses.forEach((a) => (a.isDefault = false));
      }
      state.addresses.unshift(newAddr);
      try {
        localStorage.setItem('milvanta-addresses', JSON.stringify(state.addresses));
      } catch {}
      renderAddresses();
      $('#addAddressModal')?.classList.add('hidden');
      e.target.reset();
      showToast('New address saved successfully!');
    });

    // Subscriptions Actions (Pause / Resume & Modify Qty via Backend)
    $('#subscriptionsGridContainer')?.addEventListener('click', async (e) => {
      const toggleBtn = e.target.closest('[data-toggle-sub]');
      if (toggleBtn) {
        const id = toggleBtn.dataset.toggleSub;
        const sub = state.subscriptions.find((s) => String(s.id) === String(id));
        if (sub) {
          const newStatus = sub.status === 'active' ? 'paused' : 'active';
          sub.status = newStatus;
          try {
            await apiRequest(`/api/v1/subscriptions/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: newStatus })
            });
          } catch (err) {
            console.warn('API subscription status update failed:', err);
          }
          try {
            localStorage.setItem('milvanta-subscriptions', JSON.stringify(state.subscriptions));
          } catch {}
          renderSubscriptions();
          showToast(newStatus === 'active' ? 'Subscription resumed!' : 'Subscription paused for now.');
        }
        return;
      }

      const modifyBtn = e.target.closest('[data-modify-sub]');
      if (modifyBtn) {
        const id = modifyBtn.dataset.modifySub;
        const sub = state.subscriptions.find((s) => String(s.id) === String(id));
        if (sub) {
          const newQty = prompt(`Update daily quantity for ${sub.product}:`, sub.quantity);
          if (newQty && newQty.trim()) {
            sub.quantity = newQty.trim();
            try {
              await apiRequest(`/api/v1/subscriptions/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ quantity: sub.quantity })
              });
            } catch (err) {
              console.warn('API subscription quantity update failed:', err);
            }
            try {
              localStorage.setItem('milvanta-subscriptions', JSON.stringify(state.subscriptions));
            } catch {}
            renderSubscriptions();
            showToast(`Quantity updated to ${sub.quantity}`);
          }
        }
      }
    });

    // Edit Profile Modal & Handler
    $('#btnEditProfile')?.addEventListener('click', () => {
      if ($('#editProfileName')) $('#editProfileName').value = state.customer?.name || '';
      if ($('#editProfileEmail')) $('#editProfileEmail').value = state.customer?.email || '';
      $('#editProfileModal')?.classList.remove('hidden');
    });

    $('#closeEditProfileModal')?.addEventListener('click', () => {
      $('#editProfileModal')?.classList.add('hidden');
    });

    $('#editProfileForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = $('#editProfileName')?.value.trim();
      const newEmail = $('#editProfileEmail')?.value.trim();

      if (!newName || newName.length < 2) {
        alert('Please enter a valid full name.');
        return;
      }

      try {
        await apiRequest('/api/v1/auth/me', {
          method: 'PATCH',
          body: JSON.stringify({ fullName: newName })
        });
      } catch (err) {
        console.warn('API profile update failed:', err);
      }

      if (!state.customer) state.customer = {};
      state.customer.name = newName;
      if (newEmail) state.customer.email = newEmail;

      try {
        localStorage.setItem('milvanta-user', JSON.stringify(state.customer));
      } catch {}

      renderUserInfo();
      $('#editProfileModal')?.classList.add('hidden');
      showToast('Profile updated successfully!');
    });

    // Policy Links
    $$('.policy-btn').forEach((btn) => {
      btn.addEventListener('click', () => openPolicyModal(btn.dataset.policy));
    });
    $('#policyClose')?.addEventListener('click', closePolicyModal);
  }

  // Order Details Modal with Full Tax Invoice and Items Breakdown
  function openOrderDetailsModal(orderId) {
    const modal = $('#orderDetailsModal');
    if (!modal) return;
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) return;

    if ($('#orderModalId')) $('#orderModalId').textContent = `#${order.id}`;
    if ($('#orderModalDate')) $('#orderModalDate').textContent = `Placed on ${order.date}`;
    if ($('#orderModalStatusPill')) {
      const pill = $('#orderModalStatusPill');
      pill.className = `order-status-pill ${order.status}`;
      pill.textContent = `${order.status === 'delivered' ? '✓' : order.status === 'out_for_delivery' ? '🛵' : '●'} ${order.statusLabel}`;
    }

    if ($('#orderModalAddress')) $('#orderModalAddress').textContent = order.address;
    if ($('#orderModalContact')) {
      $('#orderModalContact').textContent = `${order.recipientName || state.customer?.name || 'Customer'}${order.recipientPhone ? ' · +91 ' + order.recipientPhone : ''}`;
    }
    if ($('#orderModalWindow')) $('#orderModalWindow').textContent = order.estDelivery;
    if ($('#orderModalCourier')) $('#orderModalCourier').textContent = order.courier;
    if ($('#orderModalPayment')) $('#orderModalPayment').textContent = `✓ ${order.paymentMethod || 'Paid Online (Razorpay)'}`;

    if ($('#orderModalSubtotal')) $('#orderModalSubtotal').textContent = `₹${order.subtotal.toLocaleString('en-IN')}`;
    if ($('#orderModalDeliveryFee')) $('#orderModalDeliveryFee').textContent = order.deliveryFee > 0 ? `₹${order.deliveryFee}` : 'FREE';
    if ($('#orderModalTotal')) $('#orderModalTotal').textContent = `₹${order.total.toLocaleString('en-IN')}`;

    const itemsContainer = $('#orderModalItemsContainer');
    if (itemsContainer) {
      itemsContainer.innerHTML = order.items.map((item) => `
        <div class="order-item-detailed-row">
          <div class="order-item-thumb-box">
            <img src="${item.image}" alt="${escapeHtml(item.name)}" class="order-item-thumb-img" onerror="this.src='assets/milvanta-mark.png'" loading="lazy" />
          </div>
          <div class="order-item-content">
            <div class="order-item-heading">
              <h4 class="order-item-title">${escapeHtml(item.name)}</h4>
              <span class="order-item-line-total">₹${item.lineTotal.toLocaleString('en-IN')}</span>
            </div>
            <div class="order-item-specs">
              ${item.size ? `<span class="order-item-spec-badge">${escapeHtml(item.size)}</span>` : ''}
              <span class="order-item-spec-qty">Qty: <strong>${item.qty}</strong></span>
              <span class="order-item-spec-unit">₹${item.unitPrice.toLocaleString('en-IN')} each</span>
            </div>
          </div>
        </div>
      `).join('');
    }

    // Modal action buttons
    const reorderBtn = $('#orderModalReorderBtn');
    if (reorderBtn) {
      reorderBtn.onclick = () => {
        closeOrderDetailsModal();
        triggerReorder(order);
      };
    }

    modal.classList.remove('hidden');
  }

  function closeOrderDetailsModal() {
    $('#orderDetailsModal')?.classList.add('hidden');
  }

  // One-click Re-order handler
  function triggerReorder(order) {
    if (!order || !order.items || order.items.length === 0) {
      window.location.href = 'index.html#products';
      return;
    }
    try {
      const cart = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
      order.items.forEach((item) => {
        const existing = cart.find((c) => c.name === item.name);
        if (existing) {
          existing.quantity = (existing.quantity || 1) + item.qty;
        } else {
          cart.push({
            id: item.productId || Date.now(),
            name: item.name,
            price: item.price || item.unitPrice,
            size: item.size || '',
            quantity: item.qty,
            image: item.image || 'assets/milvanta-mark.png'
          });
        }
      });
      localStorage.setItem('milvanta-cart', JSON.stringify(cart));
      updateCartBadge();
      showToast('Items added to cart! Opening checkout...');
      setTimeout(() => {
        window.location.href = 'checkout.html';
      }, 700);
    } catch {
      window.location.href = 'index.html#cart';
    }
  }

  // Policy Modal
  const POLICIES = {
    terms: {
      title: 'Terms & Conditions',
      html: `<p>Welcome to <strong>Milvanta</strong>. By accessing our platform or placing an order, you agree to these Terms.</p>
        <h4>1. Products & Availability</h4>
        <p>Milvanta supplies fresh dairy, bakery items, and traditional pickles. Daily fresh milk orders are fulfilled between 6:00 AM and 7:00 AM. In case of unexpected farm stock shortages, refunds are processed within 24 hours.</p>
        <h4>2. Orders & Payment</h4>
        <p>Orders are placed via Razorpay's secure checkout. Prices shown are in Indian Rupees (INR) and are inclusive of GST. Orders cannot be modified once dispatched from the packing facility.</p>
        <h4>3. Serviceable Areas</h4>
        <p>Perishable fresh dairy is serviceable across Hyderabad morning delivery pin codes (500001–500096).</p>`
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
      html: `<p>We take pride in our direct-from-farm cold-chain logistics originating from Hafeezpet hub.</p>
        <h4>1. Fresh Dairy Delivery</h4>
        <p>Fresh milk and cottage cheese are dispatched in temperature-controlled bags maintained under 4°C and delivered directly to your doorstep between <strong>6:00 AM and 7:00 AM</strong>.</p>
        <h4>2. Delivery Charges</h4>
        <p>Orders within 5 km: ₹50. Deliveries 6–10 km and Hyderabad Core City (500001–500096): ₹80.</p>`
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

  function openPolicyModal(key) {
    const policy = POLICIES[key];
    if (!policy) return;
    if ($('#policyTitle')) $('#policyTitle').textContent = policy.title;
    if ($('#policyContent')) $('#policyContent').innerHTML = policy.html;
    $('#policyModal')?.classList.remove('hidden');
  }

  function closePolicyModal() {
    $('#policyModal')?.classList.add('hidden');
  }

  // Logout User
  async function logoutUser() {
    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' });
    } catch {}
    setAuthToken('');
    try {
      localStorage.removeItem('milvanta-user');
    } catch {}
    showToast('Logged out successfully.');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 700);
  }

  // ==========================================
  // INITIALIZE PAGE ON LOAD
  // ==========================================
  document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab') || 'profile';

    setupListeners();
    switchTab(initialTab);
    updateCartBadge();

    // Fetch and initialize all profile sections
    await initProfile();
    fetchOrders();
    fetchAddresses();
    fetchSubscriptions();
  });
})();
