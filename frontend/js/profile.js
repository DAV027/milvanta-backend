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
      if (isActive) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });

    // Update Panels
    $$('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tabPanel-${tabId}`);
    });

    // Update URL query string without reloading
    const url = new URL(window.location);
    url.searchParams.set('tab', tabId);
    window.history.replaceState({}, '', url);

    // Re-render subscriptions & delivery calendar if switching to subscription tab
    if (tabId === 'subscription') {
      renderSubscriptions();
      renderMonthlyDeliveryCalendar();
    }

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
    const rawName = String(item.name || item.product_name || item.product || '').trim();
    const lower = rawName.toLowerCase();
    const id = Number(item.productId || item.id || 0);

    // 1. Check specific fresh milk names first (prevents PostgreSQL ID 1 & 2 conflict with brownie & cake)
    if (lower.includes('buffalo milk') || (lower.includes('buffalo') && lower.includes('milk'))) {
      return { id: 102, name: 'Pure Buffalo Milk', size: item.size || item.unit || '500 ml bottle', price: 70, image: 'assets/milvanta-buffalo-milk.jpg' };
    }
    if (lower.includes('cow milk') || (lower.includes('cow') && lower.includes('milk'))) {
      return { id: 101, name: 'Pure Fresh Cow Milk', size: item.size || item.unit || '500 ml pouch', price: 60, image: 'assets/milvanta-cow-milk.jpg' };
    }

    // 2. Exact or substring match in catalog name
    const byName = productsCatalog.find((p) => p.name.toLowerCase() === lower || (rawName && lower.includes(p.name.toLowerCase())));
    if (byName) return byName;

    // 3. Direct ID match (avoiding 1 & 2 if name is generic)
    if (id > 0) {
      if (id === 1 && !lower.includes('brownie')) {
        return { id: 1, name: 'Pure Fresh Cow Milk', size: '500 ml pouch', price: 60, image: 'assets/milvanta-cow-milk.jpg' };
      }
      if (id === 2 && !lower.includes('cake')) {
        return { id: 2, name: 'Pure Buffalo Milk', size: '500 ml bottle', price: 70, image: 'assets/milvanta-buffalo-milk.jpg' };
      }
      const match = productsCatalog.find((p) => Number(p.id) === id);
      if (match) return match;
    }

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

    // 3. Integrate subscription payments into Order History so customer sees payments of both
    try {
      let subs = [];
      try {
        subs = JSON.parse(localStorage.getItem('milvanta-subscriptions') || '[]');
      } catch {}
      if (!Array.isArray(subs) || subs.length === 0) {
        subs = state.subscriptions || [];
      }

      subs.forEach((sub) => {
        if (!sub || sub.status === 'cancelled') return;
        const subId = String(sub.id || '');
        const isCustom = sub.planType === 'custom' || (sub.durationLabel || '').toLowerCase().includes('custom');
        const expectedOrderNum = sub.orderNumber || (isCustom ? `ORD-CUST-${subId.replace(/^sub-/, '')}` : `SUB-REC-${subId.replace(/^sub-/, '')}`);

        // Check if an order already exists for this subscription
        const alreadyExists = loadedOrders.some((o) =>
          o.id === expectedOrderNum ||
          o.id === subId ||
          (o.items && o.items.some((it) => it.name === sub.product && (isCustom ? (it.isCustomDays || it.isCustomDaysPlan) : (it.isSubscription || it.isSubscriptionPlan))))
        );

        if (!alreadyExists) {
          const isBuffalo = (sub.product || '').toLowerCase().includes('buffalo');
          const is1L = (sub.quantity || sub.product || '').toLowerCase().includes('1');
          const defaultDailyRate = isBuffalo ? (is1L ? 125 : 65) : (is1L ? 105 : 55);
          const rate = Number(sub.costPerDay || sub.dailyRate || defaultDailyRate);
          const days = Number(sub.days || (isCustom ? 14 : 30));
          const totalVal = Number(sub.totalAmount || (rate * days));

          loadedOrders.push({
            id: expectedOrderNum,
            rawDate: sub.created_at || new Date().toISOString(),
            date: sub.created_at ? new Date(sub.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Active Subscription',
            status: 'confirmed',
            statusLabel: isCustom ? 'Custom Days Active' : 'Autopay Active',
            orderType: isCustom ? 'subscription_custom' : 'subscription_continuous',
            orderTypeLabel: isCustom ? 'Custom Days Plan Payment' : 'Continuous Monthly Subscription Payment',
            items: [
              {
                productId: sub.productId || (isBuffalo ? 2 : 1),
                name: sub.product,
                size: `${sub.quantity || (is1L ? '1 Litre' : '500 ml')} (${sub.durationLabel || (isCustom ? `${days} Days Custom Plan` : 'Continuous Monthly')} · Daily 6:00 AM – 7:00 AM)`,
                image: sub.image || (isBuffalo ? 'assets/milvanta-buffalo-milk.jpg' : 'assets/milvanta-cow-milk.jpg'),
                qty: 1,
                unitPrice: totalVal,
                price: totalVal,
                lineTotal: totalVal,
                isSubscription: !isCustom,
                isCustomDays: isCustom,
                days: days,
                dailyRate: rate
              }
            ],
            subtotal: totalVal,
            deliveryFee: 0,
            total: totalVal,
            recipientName: state.customer?.name || 'Customer',
            recipientPhone: state.customer?.phone || '',
            address: localStorage.getItem('milvanta-area') ? `${localStorage.getItem('milvanta-area')}, Hyderabad - ${localStorage.getItem('milvanta-pincode') || '500049'}` : 'Hafeezpet, Hyderabad - 500049',
            paymentStatus: 'PAID',
            paymentMethod: isCustom ? 'Paid Online via Razorpay (One-Time Upfront)' : 'Paid via Subscription Autopay (Razorpay Recurring)',
            courier: 'Milvanta Cold-Chain Fleet (Morning Express)',
            trackingNum: `MLV-SUB-${subId.slice(-6)}`,
            estDelivery: 'Tomorrow Morning · 6:00 AM – 7:00 AM'
          });
        }
      });
    } catch (e) {
      console.warn('Subscription orders integration notice:', e);
    }

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
        lineTotal,
        isCustomDaysPlan: Boolean(it.isCustomDaysPlan || it.isCustomDays),
        isSubscriptionPlan: Boolean(it.isSubscriptionPlan || it.isSubscription)
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

    // Determine order category & plan type
    const isCustomOrder = Boolean(
      row.orderType === 'subscription_custom' ||
      row.isCustomDaysPlan ||
      (row.paymentMethod && row.paymentMethod.toLowerCase().includes('custom')) ||
      items.some((it) => it.isCustomDaysPlan || (it.size && it.size.toLowerCase().includes('custom')) || (it.name && it.name.toLowerCase().includes('custom')))
    );

    const isContinuousOrder = Boolean(
      !isCustomOrder && (
        row.orderType === 'subscription_continuous' ||
        row.isSubscription ||
        (row.paymentMethod && (row.paymentMethod.toLowerCase().includes('subscription') || row.paymentMethod.toLowerCase().includes('autopay'))) ||
        items.some((it) => it.isSubscriptionPlan || it.isContinuousMonthsPlan || (it.size && it.size.toLowerCase().includes('continuous')) || (it.name && it.name.toLowerCase().includes('continuous')))
      )
    );

    let orderType = 'store_order';
    let orderTypeLabel = 'Store Order';
    if (isCustomOrder) {
      orderType = 'subscription_custom';
      orderTypeLabel = 'Custom Days Plan Payment';
    } else if (isContinuousOrder) {
      orderType = 'subscription_continuous';
      orderTypeLabel = 'Continuous Monthly Subscription Payment';
    }

    return {
      id,
      rawDate,
      date: formattedDate,
      status,
      statusLabel,
      orderType,
      orderTypeLabel,
      items,
      subtotal,
      deliveryFee,
      total,
      recipientName,
      recipientPhone,
      address: addrStr,
      paymentStatus: (row.payment_status || 'paid').toUpperCase(),
      paymentMethod: row.paymentMethod || (isCustomOrder ? 'Paid Online via Razorpay (One-Time Upfront)' : isContinuousOrder ? 'Paid via Subscription Autopay (Razorpay Recurring)' : 'Paid Online via Razorpay'),
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
              <div class="order-type-badge-row">
                ${order.orderType === 'subscription_continuous' ? `
                  <span class="order-type-badge badge-sub-continuous">
                    🔄 Continuous Subscription Payment · Auto-renewing
                  </span>
                ` : order.orderType === 'subscription_custom' ? `
                  <span class="order-type-badge badge-sub-custom">
                    🗓️ Custom Days Plan Payment · Upfront Paid
                  </span>
                ` : `
                  <span class="order-type-badge badge-store-order">
                    🛍️ Store Order · One-Time
                  </span>
                `}
              </div>
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
              ${order.orderType === 'subscription_continuous' || order.orderType === 'subscription_custom' ? `
                <button type="button" class="btn-order-view-sub" data-go-sub-tab="true">
                  <span>📅 View Subscription &amp; Calendar →</span>
                </button>
              ` : ''}
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
    let loadedSubs = [];

    // 1. Immediately read from localStorage for instant zero-delay render
    try {
      const localSubs = JSON.parse(localStorage.getItem('milvanta-subscriptions') || '[]');
      if (Array.isArray(localSubs) && localSubs.length > 0) {
        loadedSubs = localSubs.map(formatSubscriptionRow);
        state.subscriptions = loadedSubs;
        renderSubscriptions();
      }
    } catch {}

    // 2. Fetch live subscriptions from backend API
    try {
      const data = await apiRequest('/api/v1/subscriptions');
      if (data && Array.isArray(data.subscriptions) && data.subscriptions.length > 0) {
        loadedSubs = data.subscriptions.map(formatSubscriptionRow);
        state.subscriptions = loadedSubs;
        try {
          localStorage.setItem('milvanta-subscriptions', JSON.stringify(loadedSubs));
        } catch {}
        renderSubscriptions();
        return;
      }
    } catch (err) {
      console.warn('Backend subscriptions fetch failed, using local cache:', err);
    }

    // 3. If still empty, provide the standard initial milk subscription
    if (loadedSubs.length === 0) {
      const defaultSub = {
        id: 'sub-1',
        product: 'Pure Fresh Cow Milk (1 Litre)',
        image: 'assets/milvanta-cow-milk.jpg',
        frequency: 'Daily (Every Morning)',
        timeSlot: '6:00 AM - 7:00 AM',
        quantity: '1 Litre',
        qtyNum: 1,
        costPerDay: 105,
        dailyRate: 105,
        durationLabel: 'Monthly Plan (30 Days)',
        days: 30,
        status: 'active',
        nextDelivery: 'Tomorrow'
      };
      loadedSubs = [defaultSub];
      state.subscriptions = loadedSubs;
      try {
        localStorage.setItem('milvanta-subscriptions', JSON.stringify(loadedSubs));
      } catch {}
      renderSubscriptions();

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
            costPerDayPaise: 10500
          })
        }).then((res) => {
          if (res?.subscription?.id) defaultSub.id = res.subscription.id;
        }).catch(() => {});
      } catch {}
    }
  }

  function formatSubscriptionRow(row) {
    const isBuffalo = (row.product_name || row.product || '').toLowerCase().includes('buffalo');
    const is1L = (row.quantity || row.size || row.product_name || row.product || '').toLowerCase().includes('1');
    const defaultCost = isBuffalo ? (is1L ? 125 : 65) : (is1L ? 105 : 55);

    return {
      id: row.id || Date.now(),
      product: row.product_name || row.product || (isBuffalo ? 'Pure Buffalo Milk (1/2 Litre)' : 'Pure Fresh Cow Milk (1 Litre)'),
      image: row.image_url || row.image || (isBuffalo ? 'assets/milvanta-buffalo-milk.jpg' : 'assets/milvanta-cow-milk.jpg'),
      frequency: row.frequency || 'Daily (Every Morning)',
      timeSlot: row.time_slot || row.timeSlot || '6:00 AM - 7:00 AM',
      quantity: row.quantity || (is1L ? '1 Litre' : '500 ml'),
      qtyNum: Number(row.quantity_num || row.qtyNum || 1),
      costPerDay: row.cost_per_day_paise ? Math.round(row.cost_per_day_paise / 100) : (Number(row.costPerDay) || Number(row.dailyRate) || defaultCost),
      dailyRate: row.dailyRate || (row.cost_per_day_paise ? Math.round(row.cost_per_day_paise / 100) : defaultCost),
      durationLabel: row.durationLabel || row.duration_label || '',
      planType: row.planType || row.plan_type || ((row.durationLabel || row.duration_label || '').toLowerCase().includes('custom') ? 'custom' : 'month'),
      totalAmount: row.totalAmount || row.total_amount || 0,
      days: row.days || (row.customDays || 30),
      status: row.status || 'active',
      nextDelivery: row.next_delivery || row.nextDelivery || 'Tomorrow'
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
          <button type="button" class="address-card-btn" onclick="document.getElementById('btnOpenCreateSubModal')?.click()" style="text-decoration: none; padding: 10px 20px; display: inline-block;">+ Subscribe to Morning Fresh Milk</button>
        </div>
      `;
      renderMonthlyDeliveryCalendar();
      return;
    }

    container.innerHTML = state.subscriptions.map((sub) => {
      const isBuffalo = (sub.product || '').toLowerCase().includes('buffalo');
      const is1L = (sub.quantity || sub.product || '').toLowerCase().includes('1');
      const rate = sub.costPerDay || sub.dailyRate || (isBuffalo ? (is1L ? 125 : 65) : (is1L ? 105 : 55));
      const fallbackTotal = (sub.days || 30) * rate;
      const totalDisplay = sub.totalAmount ? Number(sub.totalAmount).toLocaleString('en-IN') : fallbackTotal.toLocaleString('en-IN');

      const isCustom = sub.planType === 'custom' || (sub.durationLabel || '').toLowerCase().includes('custom');
      const customDaysCount = Number(sub.days || sub.customDays || 14);
      const subTag = isCustom ? '🗓️ Custom Days Plan' : '🔄 Continuous Subscription';
      const tagStyle = isCustom ? 'background:#dcfce7; color:#15803d; border:1px solid #bbf7d0;' : 'background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;';
      const planDuration = sub.durationLabel || (isCustom ? `${customDaysCount} Days Custom Plan` : 'Continuous Monthly');
      const paymentMode = isCustom ? 'Paid Online via Razorpay (One-Time Upfront)' : 'Subscription Autopay (Razorpay Recurring)';
      const planTypeDesc = isCustom ? 'Custom Days (Upfront Paid)' : 'Continuous Months (Recurring Autopay)';

      return `
      <div class="subscription-card" data-sub-id="${sub.id}">
        <div>
          <div class="subscription-item-header">
            <img src="${sub.image}" alt="${escapeHtml(sub.product)}" class="subscription-item-img" onerror="this.src='assets/milvanta-cow-milk.jpg'" />
            <div class="subscription-item-info">
              <span class="subscription-item-tag" style="${tagStyle}">${subTag}</span>
              <h4 class="subscription-item-title">${escapeHtml(sub.product)}</h4>
              <p class="subscription-item-meta">${escapeHtml(sub.frequency)}${sub.timeSlot ? ` • ${escapeHtml(sub.timeSlot)}` : ''}</p>
            </div>
          </div>

          <div class="subscription-details-list">
            <div class="sub-detail-row">
              <span class="sub-detail-label">Plan Type</span>
              <span class="sub-detail-val" style="color: #0f172a; font-weight: 700;">${planTypeDesc}</span>
            </div>
            ${isCustom ? `
              <div class="sub-detail-row">
                <span class="sub-detail-label">Custom Days Booked</span>
                <span class="sub-detail-val" style="color: #15803d; font-weight: 800; font-size: 0.95rem;">🗓️ ${customDaysCount} Days Selected</span>
              </div>
              <div class="sub-detail-row">
                <span class="sub-detail-label">Booking Schedule</span>
                <span class="sub-detail-val" style="color: #0a3d66; font-weight: 700;">18 Oct 2026 – 31 Oct 2026 (${customDaysCount} Mornings)</span>
              </div>
            ` : `
              <div class="sub-detail-row">
                <span class="sub-detail-label">Plan Duration</span>
                <span class="sub-detail-val" style="color: #0a3d66; font-weight: 700;">${escapeHtml(planDuration)}</span>
              </div>
            `}
            <div class="sub-detail-row">
              <span class="sub-detail-label">Daily Quantity</span>
              <span class="sub-detail-val" id="qtyVal-${sub.id}"><strong>${escapeHtml(sub.quantity)}</strong></span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Daily Rate</span>
              <span class="sub-detail-val" style="color: #059669; font-weight: 700;">₹${rate}/day</span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Total Plan Value</span>
              <span class="sub-detail-val" style="color: #0a3d66; font-weight: 800;">₹${totalDisplay}</span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Payment Method</span>
              <span class="sub-detail-val" style="color: #334155; font-size: 0.82rem; font-weight: 600;">${paymentMode}</span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Delivery Slot</span>
              <span class="sub-detail-val" style="color: #0284c7; font-weight: 600;">Daily 6:00 AM – 7:00 AM</span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Next Scheduled Delivery</span>
              <span class="sub-detail-val" style="color: #0284c7; font-weight: 700;">${escapeHtml(sub.nextDelivery || 'Tomorrow, 6:00 AM – 7:00 AM')}</span>
            </div>
            ${isCustom ? `
              <div class="sub-detail-row">
                <span class="sub-detail-label">Deliveries Remaining</span>
                <span class="sub-detail-val" style="color: #15803d; font-weight: 700;">${customDaysCount} Mornings Remaining (0 Delivered)</span>
              </div>
            ` : ''}
            <div class="sub-detail-row">
              <span class="sub-detail-label">Status</span>
              <span class="status-badge-active" id="statusVal-${sub.id}" style="${sub.status === 'active' ? '' : 'background:#fef3c7; color:#b45309; border-color:#fde68a;'}">
                ${sub.status === 'active' ? '● Active Schedule' : '⏸ Paused'}
              </span>
            </div>
          </div>

          ${isCustom ? `
            <div class="custom-days-progress-box">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; font-weight: 700; color: #166534; margin-bottom: 6px;">
                <span>🗓️ Custom Plan Progress</span>
                <span>0 / ${customDaysCount} Mornings Delivered (${customDaysCount} Left)</span>
              </div>
              <div style="width: 100%; height: 8px; background: #dcfce7; border-radius: 9999px; overflow: hidden;">
                <div style="width: 7%; height: 100%; background: #16a34a; border-radius: 9999px;"></div>
              </div>
              <div style="font-size: 0.74rem; color: #15803d; margin-top: 6px; font-weight: 500;">
                🌱 Milk deliveries arrive every morning between 6:00 AM – 7:00 AM through 31 Oct 2026.
              </div>
            </div>
          ` : `
            <div style="margin-top: 10px; padding: 10px 14px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; font-size: 0.78rem; color: #0369a1; font-weight: 600;">
              🥛 Auto-renews monthly via Razorpay. Pause dates anytime on the calendar below with zero penalty.
            </div>
          `}
        </div>

        <div class="subscription-actions-row" style="flex-wrap: wrap; margin-top: 14px;">
          <button type="button" class="btn-sub-pause" data-toggle-sub="${sub.id}">
            ${sub.status === 'active' ? '⏸ Pause' : '▶ Resume'}
          </button>
          <button type="button" class="btn-sub-modify" data-modify-sub="${sub.id}">
            ✎ Modify Qty
          </button>
          <button type="button" class="btn-sub-view-cal" data-view-cal="${sub.id}" style="background: #f0f9ff; border: 1px solid #bae6fd; color: #0369a1; border-radius: 8px; padding: 9px 12px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">
            📅 Calendar
          </button>
          <button type="button" class="btn-sub-pause" data-cancel-sub="${sub.id}" style="color: #ef4444; border-color: #fee2e2; background: #fff5f5;">
            Cancel
          </button>
        </div>
      </div>
    `;
    }).join('');

    renderMonthlyDeliveryCalendar();
  }

  // Comprehensive One-Month Morning Delivery Calendar
  let currentCalYear = 2026;
  let currentCalMonth = 9; // 0-indexed: 9 = October
  let selectedCalDate = 18; // Tomorrow
  let pausedDates = [];
  try {
    pausedDates = JSON.parse(localStorage.getItem('milvanta-paused-dates') || '[]');
    if (!Array.isArray(pausedDates)) pausedDates = [];
  } catch {
    pausedDates = [];
  }

  function renderMonthlyDeliveryCalendar(year = currentCalYear, month = currentCalMonth) {
    currentCalYear = year;
    currentCalMonth = month;

    const grid = $('#profileMonthlyCalendarGrid');
    const label = $('#calCurrentMonthLabel');
    const statsBar = $('#calMonthStatsBar');
    if (!grid) return;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    if (label) {
      label.textContent = `${monthNames[month]} ${year}`;
    }

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const activeSubs = state.subscriptions.filter((s) => s.status === 'active');
    const hasActiveSubs = activeSubs.length > 0;
    const customSub = activeSubs.find((s) => s.planType === 'custom' || (s.durationLabel || '').toLowerCase().includes('custom'));
    const contSub = activeSubs.find((s) => s.planType !== 'custom' && !(s.durationLabel || '').toLowerCase().includes('custom'));
    const customDaysTotal = customSub ? Number(customSub.days || customSub.customDays || 14) : 0;

    let scheduledCount = 0;
    let deliveredCount = 0;
    let pausedCount = 0;

    const now = new Date();
    const isCurrentCalendarMonth = (now.getFullYear() === year && now.getMonth() === month);
    const todayDate = now.getDate();

    let gridHtml = weekdays.map((day) => `<div class="month-cal-weekday">${day}</div>`).join('');

    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const prevDate = prevMonthDays - i;
      gridHtml += `
        <div class="month-cal-day-cell is-other-month">
          <span class="month-cal-day-num">${prevDate}</span>
          <span class="month-cal-day-badge badge-none">–</span>
        </div>
      `;
    }

    // Days of current month
    for (let day = 1; day <= daysInMonth; day++) {
      const isToday = isCurrentCalendarMonth && day === todayDate;
      const isPast = isCurrentCalendarMonth ? day < todayDate : (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth()));
      const isTomorrow = isCurrentCalendarMonth && day === todayDate + 1;
      const isSelected = day === selectedCalDate;

      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isDatePaused = pausedDates.includes(dateKey);

      let badgeHtml = '';
      let statusType = 'none';

      const dayOffset = isCurrentCalendarMonth ? (day - todayDate) : 0;
      const isWithinCustom = customSub && dayOffset >= 1 && dayOffset <= customDaysTotal;

      if (!hasActiveSubs) {
        badgeHtml = `<span class="month-cal-day-badge badge-none">No Drop</span>`;
      } else if (isDatePaused) {
        pausedCount++;
        statusType = 'paused';
        badgeHtml = `<span class="month-cal-day-badge badge-paused">⏸ Paused</span>`;
      } else if (isPast) {
        deliveredCount++;
        statusType = 'delivered';
        badgeHtml = `<span class="month-cal-day-badge badge-delivered">✔ Delivered</span>`;
      } else if (isToday) {
        scheduledCount++;
        statusType = 'today';
        badgeHtml = `<span class="month-cal-day-badge badge-today">🚚 Today</span>`;
      } else if (isTomorrow) {
        scheduledCount++;
        statusType = 'tomorrow';
        badgeHtml = `<span class="month-cal-day-badge badge-scheduled" style="background:#dbeafe; color:#1d4ed8; font-weight:800;">🥛 Tomorrow${customSub ? ' (D1)' : ''}</span>`;
      } else if (isWithinCustom) {
        scheduledCount++;
        statusType = 'custom_scheduled';
        badgeHtml = `<span class="month-cal-day-badge badge-custom-day">🗓️ Day ${dayOffset} of ${customDaysTotal}</span>`;
      } else if (contSub) {
        scheduledCount++;
        statusType = 'scheduled';
        badgeHtml = `<span class="month-cal-day-badge badge-scheduled">🥛 6:00 AM</span>`;
      } else {
        badgeHtml = `<span class="month-cal-day-badge badge-plan-ended">Plan Ended</span>`;
      }

      gridHtml += `
        <div class="month-cal-day-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" data-day="${day}" data-date-key="${dateKey}" data-status="${statusType}">
          <span class="month-cal-day-num">${day}</span>
          ${badgeHtml}
        </div>
      `;
    }

    grid.innerHTML = gridHtml;

    // Attach click handlers to days
    grid.querySelectorAll('.month-cal-day-cell:not(.is-other-month)').forEach((cell) => {
      cell.addEventListener('click', () => {
        const d = Number(cell.dataset.day);
        selectedCalDate = d;
        grid.querySelectorAll('.month-cal-day-cell').forEach((c) => c.classList.remove('is-selected'));
        cell.classList.add('is-selected');
        renderSelectedDayInspector(year, month, d, cell.dataset.dateKey, cell.dataset.status);
      });
    });

    // Update stats bar
    if (statsBar) {
      statsBar.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px;">
          <strong style="color:#0f172a;">${monthNames[month]} Overview:</strong>
        </div>
        <span style="background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:6px; font-weight:700;">🥛 ${scheduledCount} Drops Scheduled</span>
        <span style="background:#dcfce7; color:#15803d; padding:3px 8px; border-radius:6px; font-weight:700;">✔ ${deliveredCount} Delivered</span>
        ${pausedCount > 0 ? `<span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:6px; font-weight:700;">⏸ ${pausedCount} Paused</span>` : ''}
        ${customSub ? `<span style="background:#ecfdf5; color:#047857; padding:3px 8px; border-radius:6px; font-weight:700;">🗓️ ${customDaysTotal} Custom Days Active</span>` : ''}
        <span style="margin-left:auto; color:#64748b; font-size:0.8rem;">Drop Window: <strong style="color:#0f172a;">6:00 AM – 7:00 AM</strong></span>
      `;
    }

    const selectedKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedCalDate).padStart(2, '0')}`;
    const selectedCell = grid.querySelector(`[data-day="${selectedCalDate}"]`);
    const currentStatus = selectedCell ? selectedCell.dataset.status : 'scheduled';
    renderSelectedDayInspector(year, month, selectedCalDate, selectedKey, currentStatus);
  }

  function renderSelectedDayInspector(year, month, day, dateKey, status) {
    const inspector = $('#calSelectedDayCard');
    if (!inspector) return;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const dObj = new Date(year, month, day);
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dObj.getDay()];
    const formattedDate = `${dayName}, ${day} ${monthNames[month]} ${year}`;

    const isDatePaused = pausedDates.includes(dateKey);
    const activeSubs = state.subscriptions.filter((s) => s.status === 'active');
    const subNames = activeSubs.map((s) => `${s.quantity || '500 ml'} ${s.product}`).join(' + ') || 'Pure Farm Fresh Milk (500 ml)';

    const customSub = activeSubs.find((s) => s.planType === 'custom' || (s.durationLabel || '').toLowerCase().includes('custom'));
    const contSub = activeSubs.find((s) => s.planType !== 'custom' && !(s.durationLabel || '').toLowerCase().includes('custom'));
    const customDaysTotal = customSub ? Number(customSub.days || customSub.customDays || 14) : 0;
    const now = new Date();
    const isCurrentCalendarMonth = (now.getFullYear() === year && now.getMonth() === month);
    const todayDate = now.getDate();
    const dayOffset = isCurrentCalendarMonth ? (day - todayDate) : 0;
    const isWithinCustom = customSub && dayOffset >= 1 && dayOffset <= customDaysTotal;
    const isAfterCustomEnded = !contSub && customSub && dayOffset > customDaysTotal;

    let statusBadge = '';
    let actionBtn = '';

    if (isDatePaused) {
      statusBadge = `<span style="background:#fee2e2; color:#991b1b; padding:4px 10px; border-radius:9999px; font-weight:700; font-size:0.75rem;">⏸ Delivery Paused For This Day</span>`;
      actionBtn = `<button type="button" class="btn-resume-day" id="btnToggleDayDelivery" style="background:#059669; color:#fff; border:none; border-radius:8px; padding:8px 16px; font-weight:700; cursor:pointer;">▶ Resume Delivery For This Day</button>`;
    } else if (status === 'delivered') {
      statusBadge = `<span style="background:#dcfce7; color:#15803d; padding:4px 10px; border-radius:9999px; font-weight:700; font-size:0.75rem;">✔ Delivered at 6:15 AM</span>`;
      actionBtn = `<span style="font-size:0.82rem; color:#64748b; font-weight:600;">Delivered by Hafeezpet Route Van</span>`;
    } else if (isAfterCustomEnded) {
      statusBadge = `<span style="background:#f1f5f9; color:#64748b; padding:4px 10px; border-radius:9999px; font-weight:700; font-size:0.75rem;">🗓️ Custom Plan Ended</span>`;
      actionBtn = `<a href="index.html#products" style="display:inline-block; background:#0a3d66; color:#fff; border-radius:8px; padding:8px 16px; font-size:0.82rem; font-weight:700; text-decoration:none;">+ Extend Plan</a>`;
    } else {
      statusBadge = `<span style="background:#e0f2fe; color:#0369a1; padding:4px 10px; border-radius:9999px; font-weight:700; font-size:0.75rem;">🥛 Scheduled Morning Drop</span>`;
      actionBtn = `<button type="button" class="btn-pause-day" id="btnToggleDayDelivery" style="background:#ffffff; color:#b91c1c; border:1px solid #fca5a5; border-radius:8px; padding:8px 16px; font-weight:600; cursor:pointer;">⏸ Skip / Pause This Day</button>`;
    }

    let planTagHtml = '';
    if (isWithinCustom) {
      planTagHtml = `<span class="order-type-badge badge-sub-custom" style="font-size:0.72rem; padding:2px 8px;">🗓️ Custom Days Plan: Day ${dayOffset} of ${customDaysTotal}</span>`;
    }
    if (contSub) {
      planTagHtml += `<span class="order-type-badge badge-sub-continuous" style="font-size:0.72rem; padding:2px 8px; margin-left:4px;">🔄 Continuous Monthly Plan</span>`;
    }

    inspector.innerHTML = `
      <div style="flex: 1; min-width: 260px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
          <h5 style="margin: 0; font-size: 1rem; color: #0f172a; font-weight: 700;">${formattedDate}</h5>
          ${statusBadge}
          ${planTagHtml}
        </div>
        <div style="font-size: 0.88rem; color: #334155; margin-bottom: 4px;">
          ${isAfterCustomEnded ? 'No delivery scheduled for this date (Custom days plan completed).' : `Scheduled: <strong>${escapeHtml(subNames)}</strong>`}
        </div>
        <div style="font-size: 0.82rem; color: #64748b; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
          <span>⏰ Delivery Slot: <strong style="color:#0f172a;">6:00 AM – 7:00 AM</strong></span>
          <span>📍 Hub: <strong>Hafeezpet Cold-Chain Hub</strong></span>
        </div>
      </div>
      <div>
        ${actionBtn}
      </div>
    `;

    $('#btnToggleDayDelivery')?.addEventListener('click', () => {
      if (pausedDates.includes(dateKey)) {
        pausedDates = pausedDates.filter((k) => k !== dateKey);
        showToast(`▶ Delivery resumed for ${formattedDate}!`);
      } else {
        pausedDates.push(dateKey);
        showToast(`⏸ Delivery paused for ${formattedDate}. You will not receive milk on this date.`);
      }
      try {
        localStorage.setItem('milvanta-paused-dates', JSON.stringify(pausedDates));
      } catch {}
      renderMonthlyDeliveryCalendar(year, month);
    });
  }

  // Check Return from Razorpay Subscription Checkout
  function checkSubscriptionReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('subscription') === 'success' || urlParams.get('sub_success') === '1' || urlParams.get('sub_success') === 'true') {
      switchTab('subscription');
      const cleanUrl = `${window.location.pathname}?tab=subscription`;
      window.history.replaceState({}, document.title, cleanUrl);
      setTimeout(() => {
        showToast('🥛 Morning Milk Subscription Activated! Your fresh delivery starts tomorrow at 6:00 AM.');
      }, 500);
    }
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

    // Orders Actions (Details, Reorder, and View Subscription)
    $('#ordersListContainer')?.addEventListener('click', (e) => {
      const goSubBtn = e.target.closest('[data-go-sub-tab]');
      if (goSubBtn) {
        switchTab('subscription');
        $('#profileMonthlyCalendarCard')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }

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

      const cancelBtn = e.target.closest('[data-cancel-sub]');
      if (cancelBtn) {
        const id = cancelBtn.dataset.cancelSub;
        const sub = state.subscriptions.find((s) => String(s.id) === String(id));
        if (sub && confirm(`Are you sure you want to cancel the subscription for ${sub.product}?`)) {
          state.subscriptions = state.subscriptions.filter((s) => String(s.id) !== String(id));
          try {
            await apiRequest(`/api/v1/subscriptions/${id}`, { method: 'DELETE' });
          } catch (err) {
            console.warn('API subscription cancellation failed:', err);
          }
          try {
            localStorage.setItem('milvanta-subscriptions', JSON.stringify(state.subscriptions));
          } catch {}
          renderSubscriptions();
          showToast('Subscription cancelled.');
        }
        return;
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

    // Create Subscription Modal Setup
    setupCreateSubscriptionModal();

    // Policy Links
    $$('.policy-btn').forEach((btn) => {
      btn.addEventListener('click', () => openPolicyModal(btn.dataset.policy));
    });
    $('#policyClose')?.addEventListener('click', closePolicyModal);
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

  // Continuous Months calculation helper
  function getContinuousMonthsDetails(startOffset = 0, count = 1) {
    const now = new Date();
    let totalDays = 0;
    const mList = [];

    let startDate;
    if (startOffset === 0) {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth() + startOffset, 1);
    }

    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + startOffset + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const sName = d.toLocaleString('en-IN', { month: 'short' });
      const lName = d.toLocaleString('en-IN', { month: 'long' });

      mList.push({ year: y, month: m, sName, lName, days: daysInMonth });
      totalDays += daysInMonth;
    }

    const endDate = new Date(startDate.getTime() + (totalDays - 1) * 24 * 60 * 60 * 1000);

    const startFormatted = startOffset === 0
      ? `Tomorrow, ${startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const endFormatted = endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    let rangeLabel = '';
    if (count === 1) {
      rangeLabel = `${mList[0].lName} ${mList[0].year} (${totalDays} Days)`;
    } else {
      rangeLabel = `${mList[0].sName} ${mList[0].year} – ${mList[mList.length - 1].sName} ${mList[mList.length - 1].year} (${count} Months · ${totalDays} Days)`;
    }

    return { totalDays, startDate, endDate, startFormatted, endFormatted, rangeLabel, mList };
  }

  // Create Subscription Modal Logic & Dynamic Pricing
  function setupCreateSubscriptionModal() {
    const modal = $('#createSubscriptionModal');
    const openBtn = $('#btnOpenCreateSubModal');
    const closeBtn = $('#closeCreateSubModal') || $('#createSubClose');
    const cancelBtn = $('#closeCreateSubBtn');
    const form = $('#createSubForm') || $('#createSubscriptionForm');
    const monthSelect = $('#profileSubMonthSelect');

    if (!modal) return;

    let subState = {
      milk: 'cow',
      size: '500ml',
      planType: 'month',
      days: 30,
      monthsCount: 1
    };

    function populateProfileMonths() {
      if (!monthSelect) return;
      const now = new Date();
      monthSelect.innerHTML = '';
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        const monthName = d.toLocaleString('en-IN', { month: 'long' });
        const days = new Date(y, m + 1, 0).getDate();
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = i === 0 ? `${monthName} ${y} (Starts Now · ${days} Days)` : `${monthName} ${y} (${days} Days)`;
        if (i === 0) opt.selected = true;
        monthSelect.appendChild(opt);
      }
    }

    function calculateProfileRates() {
      const isBuffalo = subState.milk === 'buffalo';
      const is1L = subState.size === '1L';

      let dailyRate, oneTimeRate;
      if (isBuffalo) {
        if (is1L) {
          dailyRate = 125; oneTimeRate = 130;
        } else {
          dailyRate = 65; oneTimeRate = 70;
        }
      } else {
        if (is1L) {
          dailyRate = 105; oneTimeRate = 110;
        } else {
          dailyRate = 55; oneTimeRate = 60;
        }
      }

      // Update rate chips inside pack size cards
      const rate500 = $('#profileSizeRate500');
      const rate1L = $('#profileSizeRate1L');
      if (rate500) rate500.textContent = isBuffalo ? '₹65/day' : '₹55/day';
      if (rate1L) rate1L.textContent = isBuffalo ? '₹125/day' : '₹105/day';

      let days = 30;
      let planLabel = '';
      let startFormatted = '';
      let endFormatted = '';

      if (subState.planType === 'month') {
        const startOffset = parseInt(monthSelect?.value || '0', 10) || 0;
        const count = Math.max(1, Math.min(12, subState.monthsCount || 1));
        subState.monthsCount = count;

        const details = getContinuousMonthsDetails(startOffset, count);
        days = details.totalDays;
        planLabel = details.rangeLabel;
        startFormatted = details.startFormatted;
        endFormatted = details.endFormatted;

        const valElem = $('#profileSubMonthsVal');
        const unitElem = $('#profileSubMonthsUnit');
        if (valElem) valElem.textContent = count;
        if (unitElem) unitElem.textContent = count === 1 ? 'Month' : 'Months';

        const hintElem = $('#profileSubMonthHint');
        if (hintElem) {
          if (count === 1) {
            hintElem.textContent = `Period: ${details.mList[0].lName} ${details.mList[0].year} (${days} Days). Price adapts automatically to exact days.`;
          } else {
            const bTxt = details.mList.map((m) => `${m.sName}: ${m.days}d`).join(' + ');
            hintElem.textContent = `Period: ${bTxt} = ${days} Continuous Days across ${count} months.`;
          }
        }

        document.querySelectorAll('#profileSubMonthQuickPills .sub-quick-pill').forEach((pill) => {
          const pMonths = parseInt(pill.dataset.profileMonths, 10);
          const isAct = pMonths === count;
          pill.style.background = isAct ? '#0a3d66' : '#f1f5f9';
          pill.style.color = isAct ? '#ffffff' : '#334155';
          pill.style.borderColor = isAct ? '#0a3d66' : '#cbd5e1';
        });
      } else {
        const input = $('#profileSubDaysInput');
        days = Math.max(2, Math.min(90, parseInt(input?.value || '7', 10) || 7));
        if (input) input.value = days;
        planLabel = `${days} Days Custom Plan`;

        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const endDate = new Date(startDate.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
        startFormatted = `Tomorrow, ${startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        endFormatted = endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

        document.querySelectorAll('[data-profile-days]').forEach((pill) => {
          const pDays = parseInt(pill.dataset.profileDays, 10);
          const isAct = pDays === days;
          pill.style.background = isAct ? '#0a3d66' : '#f1f5f9';
          pill.style.color = isAct ? '#ffffff' : '#334155';
          pill.style.borderColor = isAct ? '#0a3d66' : '#cbd5e1';
        });
      }

      subState.days = days;
      const totalAmount = days * dailyRate;
      const regularTotal = days * oneTimeRate;
      const savings = days * (oneTimeRate - dailyRate);

      // Update Delivery Period Card
      if ($('#profileSubPeriodDaysBadge')) $('#profileSubPeriodDaysBadge').textContent = `${days} Mornings`;
      if ($('#profileSubPeriodStartDate')) $('#profileSubPeriodStartDate').textContent = startFormatted;
      if ($('#profileSubPeriodEndDate')) $('#profileSubPeriodEndDate').textContent = endFormatted;

      // Update Price Summary Card
      if ($('#profileSubSummaryPlanText')) $('#profileSubSummaryPlanText').textContent = planLabel;
      if ($('#profileSubSummaryRateText')) $('#profileSubSummaryRateText').textContent = `₹${dailyRate} / day`;
      if ($('#profileSubSavingsText')) $('#profileSubSavingsText').textContent = `Save ₹${savings.toLocaleString('en-IN')} vs one-time order`;
      if ($('#profileSubFinalTotal')) $('#profileSubFinalTotal').textContent = `₹${totalAmount.toLocaleString('en-IN')}`;

      // Update Action Button
      const submitBtn = $('#profileSubmitSubBtn');
      if (submitBtn) {
        submitBtn.innerHTML = `<span>Add to Cart · ₹${totalAmount.toLocaleString('en-IN')}</span>`;
      }

      return { dailyRate, oneTimeRate, days, totalAmount, savings, planLabel, startFormatted, endFormatted };
    }

    openBtn?.addEventListener('click', () => {
      populateProfileMonths();
      calculateProfileRates();
      modal.classList.remove('hidden');
    });

    const closeModal = () => modal.classList.add('hidden');
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Milk selection
    $$('#profileSubMilkTypeGroup .sub-type-card').forEach((card) => {
      card.addEventListener('click', () => {
        $$('#profileSubMilkTypeGroup .sub-type-card').forEach((c) => {
          c.classList.remove('active');
          c.style.borderColor = '#e2e8f0';
          c.style.background = '#ffffff';
        });
        card.classList.add('active');
        card.style.borderColor = '#0a3d66';
        card.style.background = '#eff6ff';
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        subState.milk = card.dataset.milk || 'cow';
        calculateProfileRates();
      });
    });

    // Size selection
    $$('#profileSubSizeGroup .sub-size-card').forEach((card) => {
      card.addEventListener('click', () => {
        $$('#profileSubSizeGroup .sub-size-card').forEach((c) => {
          c.classList.remove('active');
          c.style.borderColor = '#e2e8f0';
          c.style.background = '#ffffff';
        });
        card.classList.add('active');
        card.style.borderColor = '#0a3d66';
        card.style.background = '#eff6ff';
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        subState.size = card.dataset.size || '500ml';
        calculateProfileRates();
      });
    });

    // Duration tabs
    const tabMonth = $('#profileSubTabMonth');
    const tabCustom = $('#profileSubTabCustom');
    const wrapMonth = $('#profileSubMonthWrap');
    const wrapCustom = $('#profileSubCustomWrap');

    tabMonth?.addEventListener('click', () => {
      subState.planType = 'month';
      tabMonth.style.background = '#0a3d66';
      tabMonth.style.color = '#fff';
      tabMonth.style.borderColor = '#0a3d66';
      if (tabCustom) {
        tabCustom.style.background = '#f8fafc';
        tabCustom.style.color = '#475569';
        tabCustom.style.borderColor = '#cbd5e1';
      }
      wrapMonth?.classList.remove('hidden');
      wrapCustom?.classList.add('hidden');
      calculateProfileRates();
    });

    tabCustom?.addEventListener('click', () => {
      subState.planType = 'custom';
      tabCustom.style.background = '#0a3d66';
      tabCustom.style.color = '#fff';
      tabCustom.style.borderColor = '#0a3d66';
      if (tabMonth) {
        tabMonth.style.background = '#f8fafc';
        tabMonth.style.color = '#475569';
        tabMonth.style.borderColor = '#cbd5e1';
      }
      wrapCustom?.classList.remove('hidden');
      wrapMonth?.classList.add('hidden');
      calculateProfileRates();
    });

    monthSelect?.addEventListener('change', calculateProfileRates);

    $('#profileSubMonthsDec')?.addEventListener('click', () => {
      subState.monthsCount = Math.max(1, (subState.monthsCount || 1) - 1);
      calculateProfileRates();
    });

    $('#profileSubMonthsInc')?.addEventListener('click', () => {
      subState.monthsCount = Math.min(12, (subState.monthsCount || 1) + 1);
      calculateProfileRates();
    });

    document.querySelectorAll('#profileSubMonthQuickPills .sub-quick-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        subState.monthsCount = parseInt(pill.dataset.profileMonths, 10) || 1;
        calculateProfileRates();
      });
    });

    $('#profileSubDaysDec')?.addEventListener('click', () => {
      const input = $('#profileSubDaysInput');
      if (input) {
        const cur = parseInt(input.value || '7', 10);
        input.value = Math.max(2, cur - 1);
        calculateProfileRates();
      }
    });

    $('#profileSubDaysInc')?.addEventListener('click', () => {
      const input = $('#profileSubDaysInput');
      if (input) {
        const cur = parseInt(input.value || '7', 10);
        input.value = Math.min(90, cur + 1);
        calculateProfileRates();
      }
    });

    $('#profileSubDaysInput')?.addEventListener('input', () => {
      const input = $('#profileSubDaysInput');
      if (input) {
        let cur = parseInt(input.value || '2', 10);
        if (isNaN(cur) || cur < 2) cur = 2;
        if (cur > 90) cur = 90;
        input.value = cur;
        calculateProfileRates();
      }
    });

    $$('[data-profile-days]').forEach((pill) => {
      pill.addEventListener('click', () => {
        const days = parseInt(pill.dataset.profileDays, 10);
        const input = $('#profileSubDaysInput');
        if (input && days >= 2) {
          input.value = days;
          calculateProfileRates();
        }
      });
    });

    // Form submit
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const calc = calculateProfileRates();
      const isBuffalo = subState.milk === 'buffalo';
      const is1L = subState.size === '1L';

      const productName = isBuffalo ? 'Pure Buffalo Milk' : 'Pure Fresh Cow Milk';
      const sizeLabel = is1L ? '1 Litre' : '500 ml';
      const imageUrl = isBuffalo ? 'assets/milvanta-buffalo-milk.jpg' : 'assets/milvanta-cow-milk.jpg';
      const submitBtn = $('#profileSubmitSubBtn');

      // 1. CUSTOM DAYS PLAN -> Add to Cart
      if (subState.planType === 'custom') {
        const cartItem = {
          id: isBuffalo ? 102 : 101,
          name: productName,
          price: calc.totalAmount,
          size: `${sizeLabel} (${calc.days} Days · ₹${calc.dailyRate}/day)`,
          image: imageUrl,
          quantity: 1,
          customDays: calc.days,
          days: calc.days,
          dailyRate: calc.dailyRate,
          isCustomDaysPlan: true,
          isSubscriptionPlan: true,
          subscriptionPlan: {
            planType: 'custom',
            productName: productName,
            productId: isBuffalo ? 102 : 101,
            size: sizeLabel,
            days: calc.days,
            customDays: calc.days,
            dailyRate: calc.dailyRate,
            planLabel: `${calc.days} Days Custom Plan`,
            frequency: 'Daily (Every Morning)',
            timeSlot: '6:00 AM - 7:00 AM'
          }
        };

        let cart = [];
        try {
          cart = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
          if (!Array.isArray(cart)) cart = [];
        } catch {
          cart = [];
        }

        const existingIdx = cart.findIndex((item) => Number(item.id) === Number(cartItem.id) && (item.size || '') === (cartItem.size || ''));
        if (existingIdx > -1) {
          cart[existingIdx].quantity = (cart[existingIdx].quantity || 1) + 1;
        } else {
          cart.push(cartItem);
        }

        try {
          localStorage.setItem('milvanta-cart', JSON.stringify(cart));
        } catch {}

        updateCartBadge();
        closeModal();
        showToast(`Added ${calc.days}-Day Fresh Milk plan (₹${calc.totalAmount.toLocaleString('en-IN')}) to Cart! <a href="checkout.html" style="color:#ffffff; text-decoration:underline; font-weight:700; margin-left:8px;">Checkout →</a>`);
        return;
      }

      // 2. CONTINUOUS MONTHS PLAN -> Add to Cart
      const startOffset = parseInt(monthSelect?.value || '0', 10) || 0;
      const cartItem = {
        id: isBuffalo ? 102 : 101,
        name: productName,
        price: calc.totalAmount,
        size: `${sizeLabel} (${calc.planLabel} · ₹${calc.dailyRate}/day)`,
        image: imageUrl,
        quantity: 1,
        monthsCount: subState.monthsCount,
        days: calc.days,
        dailyRate: calc.dailyRate,
        startOffset: startOffset,
        rangeLabel: calc.planLabel,
        isContinuousMonthsPlan: true,
        isSubscriptionPlan: true,
        subscriptionPlan: {
          planType: 'month',
          productName: productName,
          productId: isBuffalo ? 102 : 101,
          size: sizeLabel,
          monthsCount: subState.monthsCount,
          days: calc.days,
          dailyRate: calc.dailyRate,
          rangeLabel: calc.planLabel,
          startOffset: startOffset,
          frequency: 'Daily (Every Morning)',
          timeSlot: '6:00 AM - 7:00 AM'
        }
      };

      let cart = [];
      try {
        cart = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
        if (!Array.isArray(cart)) cart = [];
      } catch {
        cart = [];
      }

      const existingIdx = cart.findIndex((item) => Number(item.id) === Number(cartItem.id) && (item.size || '') === (cartItem.size || ''));
      if (existingIdx > -1) {
        cart[existingIdx].quantity = (cart[existingIdx].quantity || 1) + 1;
      } else {
        cart.push(cartItem);
      }

      try {
        localStorage.setItem('milvanta-cart', JSON.stringify(cart));
      } catch {}

      updateCartBadge();
      closeModal();
      showToast(`Added ${subState.monthsCount}-Month Continuous Subscription (${calc.planLabel}) to Cart! <a href="checkout.html" style="color:#ffffff; text-decoration:underline; font-weight:700; margin-left:8px;">Checkout →</a>`);
    });
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
    renderMonthlyDeliveryCalendar();

    // Monthly Calendar Navigation Listeners
    $('#calPrevMonthBtn')?.addEventListener('click', () => {
      let newMonth = currentCalMonth - 1;
      let newYear = currentCalYear;
      if (newMonth < 0) {
        newMonth = 11;
        newYear--;
      }
      renderMonthlyDeliveryCalendar(newYear, newMonth);
    });

    $('#calNextMonthBtn')?.addEventListener('click', () => {
      let newMonth = currentCalMonth + 1;
      let newYear = currentCalYear;
      if (newMonth > 11) {
        newMonth = 0;
        newYear++;
      }
      renderMonthlyDeliveryCalendar(newYear, newMonth);
    });

    $('#calTodayBtn')?.addEventListener('click', () => {
      const today = new Date();
      currentCalYear = today.getFullYear();
      currentCalMonth = today.getMonth();
      selectedCalDate = today.getDate();
      renderMonthlyDeliveryCalendar(currentCalYear, currentCalMonth);
    });

    // View Calendar button click from subscription card
    document.addEventListener('click', (e) => {
      const viewCalBtn = e.target.closest('[data-view-cal]');
      if (viewCalBtn) {
        const card = $('#profileMonthlyCalendarCard');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          card.style.transition = 'box-shadow 0.3s ease';
          card.style.boxShadow = '0 0 0 3px #0284c7';
          setTimeout(() => { card.style.boxShadow = ''; }, 1500);
        }
      }
    });

    checkSubscriptionReturn();
    switchTab(initialTab);
    updateCartBadge();

    // Fetch and initialize all profile sections
    await initProfile();
    fetchOrders();
    fetchAddresses();
    fetchSubscriptions();
  });
})();
