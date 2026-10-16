/**
 * Milvanta Profile Page Logic
 * Handles Profile, Orders, Addresses, and Subscription management.
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const API_URL = (window.MILVANTA_API_URL || 'https://milvanta-backend.onrender.com').replace(/\/$/, '');

  // State
  const state = {
    activeTab: 'profile',
    customer: {
      name: 'Akhil',
      phone: '6305974564',
      email: 'akhil@milvanta.in',
      city: 'Hyderabad',
      pincode: '500081'
    },
    orders: [
      {
        id: 'MV-94821',
        date: 'Today, 6:15 AM',
        status: 'out_for_delivery',
        statusLabel: 'Out for Delivery',
        items: [
          { name: 'Pure Fresh Milk (1 Litre)', qty: 2, price: 150 },
          { name: 'Artisanal Walnut Raagi Brownie', qty: 1, price: 130 }
        ],
        total: 280,
        address: 'Flat 402, Greenwood Heights, Madhapur, Hyderabad - 500081',
        courier: 'Milvanta Cold-Chain Express',
        trackingNum: 'MLV-HYD-94821',
        estDelivery: 'Today by 7:00 AM'
      },
      {
        id: 'MV-89102',
        date: '12 Oct 2026, 6:45 AM',
        status: 'delivered',
        statusLabel: 'Delivered',
        items: [
          { name: 'Spicy Gongura Chicken Pickle (250g)', qty: 1, price: 260 },
          { name: 'Farm Fresh Malai Paneer (200g)', qty: 1, price: 110 }
        ],
        total: 370,
        address: 'Flat 402, Greenwood Heights, Madhapur, Hyderabad - 500081',
        courier: 'Milvanta Morning Route #4',
        trackingNum: 'MLV-HYD-89102',
        estDelivery: 'Delivered at 6:45 AM'
      }
    ],
    addresses: [
      {
        id: 1,
        type: 'Home',
        isDefault: true,
        name: 'Akhil',
        phone: '6305974564',
        house: 'Flat 402, Greenwood Heights',
        street: 'Madhapur Main Road, Near Cyber Towers',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081'
      },
      {
        id: 2,
        type: 'Work / Office',
        isDefault: false,
        name: 'Akhil',
        phone: '6305974564',
        house: 'Mindspace IT Park, Building 12',
        street: 'Floor 4, Hitec City',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081'
      }
    ],
    subscriptions: [
      {
        id: 'sub-1',
        product: 'Pure Fresh Milk (1 Litre)',
        image: 'assets/milvanta-cow-milk.jpg',
        frequency: 'Daily (Every Morning)',
        timeSlot: '6:00 AM – 7:00 AM',
        quantity: '1 Litre',
        qtyNum: 1,
        costPerDay: 75,
        status: 'active',
        nextDelivery: 'Tomorrow, 6:00 AM'
      },
      {
        id: 'sub-2',
        product: 'Farm Fresh Malai Paneer (200g)',
        image: 'assets/milvanta-paneer.jpg',
        frequency: 'Alternate Days (Mon, Wed, Fri)',
        timeSlot: '6:00 AM – 7:00 AM',
        quantity: '200g',
        qtyNum: 1,
        costPerDay: 110,
        status: 'active',
        nextDelivery: 'Friday, 6:00 AM'
      }
    ]
  };

  // Helper API fetch
  async function apiRequest(path, options = {}) {
    const token = sessionStorage.getItem('milvanta-auth-token') || '';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Request failed (${res.status})`);
    }
    return res.json();
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

  // Load Customer Profile
  async function initProfile() {
    try {
      const token = sessionStorage.getItem('milvanta-auth-token');
      if (token) {
        const data = await apiRequest('/api/v1/auth/me');
        const cust = data.customer || data.user;
        if (cust) {
          state.customer.name = cust.full_name || cust.name || 'Akhil';
          state.customer.phone = cust.phone || '6305974564';
          state.customer.email = cust.email || 'akhil@milvanta.in';
        }
      }
    } catch {
      // Fallback to default user Akhil
    }

    renderUserInfo();
  }

  // Render User Information across header and cards
  function renderUserInfo() {
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
    if ($('#profileDetailPhone')) $('#profileDetailPhone').textContent = `+91 ${state.customer.phone}`;
    if ($('#profileDetailEmail')) $('#profileDetailEmail').textContent = state.customer.email;

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

  // Update Cart Count
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

  // Render Order Cards
  function renderOrders() {
    const container = $('#ordersListContainer');
    if (!container) return;

    if (!state.orders.length) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; background: #fff; border-radius: 16px; border: 1px solid #eef2f6;">
          <p style="font-size: 1.1rem; color: #64748b; margin-bottom: 14px;">You have no past orders yet.</p>
          <a href="index.html#products" class="profile-order-now-btn">Browse Fresh Milk & Pickles</a>
        </div>
      `;
      return;
    }

    container.innerHTML = state.orders.map((order) => {
      const itemsHtml = order.items.map((item) => `
        <div class="order-item-row">
          <div class="order-item-title">
            <span>🥛 ${escapeHtml(item.name)}</span>
            <span style="color: #64748b; font-size: 0.82rem;">× ${item.qty}</span>
          </div>
          <span class="order-item-price">₹${item.price * item.qty}</span>
        </div>
      `).join('');

      return `
        <article class="order-card" data-order-id="${order.id}">
          <div class="order-card-header">
            <div class="order-id-group">
              <span class="order-id">#${order.id}</span>
              <span class="order-date">${order.date}</span>
            </div>
            <span class="order-status-pill ${order.status}">
              ${order.status === 'delivered' ? '✓' : '●'} ${order.statusLabel}
            </span>
          </div>
          <div class="order-items-list">
            ${itemsHtml}
          </div>
          <div class="order-card-footer">
            <div class="order-total-group">
              <span class="order-total-label">Total Amount:</span>
              <span class="order-total-amount">₹${order.total}</span>
            </div>
            <div class="order-actions-group">
              <button type="button" class="btn-track-order" data-track-id="${order.id}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                <span>Track Order</span>
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

  // Render Saved Addresses
  function renderAddresses() {
    const container = $('#addressesGridContainer');
    if (!container) return;

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
            ${escapeHtml(addr.house)}, ${escapeHtml(addr.street)}<br />
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

  // Render Subscriptions
  function renderSubscriptions() {
    const container = $('#subscriptionsGridContainer');
    if (!container) return;

    container.innerHTML = state.subscriptions.map((sub) => `
      <div class="subscription-card" data-sub-id="${sub.id}">
        <div>
          <div class="subscription-item-header">
            <img src="${sub.image}" alt="${escapeHtml(sub.product)}" class="subscription-item-img" />
            <div class="subscription-item-info">
              <span class="subscription-item-tag">Early Morning Delivery</span>
              <h4 class="subscription-item-title">${escapeHtml(sub.product)}</h4>
              <p class="subscription-item-meta">${sub.frequency} • ${sub.timeSlot}</p>
            </div>
          </div>
          <div class="subscription-details-list">
            <div class="sub-detail-row">
              <span class="sub-detail-label">Daily Quantity</span>
              <span class="sub-detail-val" id="qtyVal-${sub.id}">${sub.quantity}</span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Status</span>
              <span class="status-badge-active" id="statusVal-${sub.id}">
                ${sub.status === 'active' ? '● Active Schedule' : '⏸ Paused'}
              </span>
            </div>
            <div class="sub-detail-row">
              <span class="sub-detail-label">Next Scheduled Delivery</span>
              <span class="sub-detail-val" style="color: #0284c7;">${sub.nextDelivery}</span>
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

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Show Toast
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

  // Setup Event Listeners
  function setupListeners() {
    // Tab switching buttons
    $$('.profile-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // Overview Card Buttons
    $('#btnGoOrders')?.addEventListener('click', () => switchTab('orders'));

    // Logout Pill in Card
    $('#btnLogout')?.addEventListener('click', logoutUser);

    // Header Account Dropdown Toggle
    const accountToggle = $('#accountToggle') || $('#profileAccountToggle');
    accountToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = $('#userAccountDropdown') || $('#profileUserDropdown');
      if (dropdown) dropdown.classList.toggle('hidden');
    });

    // Header Dropdown Items
    $$('[data-tab-target]').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        $('#userAccountDropdown')?.classList.add('hidden');
        $('#profileUserDropdown')?.classList.add('hidden');
        switchTab(item.dataset.tabTarget);
      });
    });

    $('#userMenuLogout')?.addEventListener('click', logoutUser);
    $('#dropdownLogoutBtn')?.addEventListener('click', logoutUser);

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

    // Clear search
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

    // Orders Actions (Track & Reorder)
    $('#ordersListContainer')?.addEventListener('click', (e) => {
      const trackBtn = e.target.closest('[data-track-id]');
      if (trackBtn) {
        const orderId = trackBtn.dataset.trackId;
        openTrackingModal(orderId);
        return;
      }

      const reorderBtn = e.target.closest('[data-reorder-id]');
      if (reorderBtn) {
        showToast('Items added to cart! Redirecting to checkout...');
        setTimeout(() => {
          window.location.href = 'index.html#cart';
        }, 1000);
      }
    });

    // Addresses Actions (Default & Delete)
    $('#addressesGridContainer')?.addEventListener('click', (e) => {
      const defBtn = e.target.closest('[data-set-default]');
      if (defBtn) {
        const id = Number(defBtn.dataset.setDefault);
        state.addresses.forEach((a) => (a.isDefault = a.id === id));
        renderAddresses();
        showToast('Default address updated!');
        return;
      }

      const delBtn = e.target.closest('[data-delete-addr]');
      if (delBtn) {
        const id = Number(delBtn.dataset.deleteAddr);
        if (confirm('Delete this delivery address?')) {
          state.addresses = state.addresses.filter((a) => a.id !== id);
          renderAddresses();
          showToast('Address removed.');
        }
      }
    });

    // Add New Address Form Modal
    $('#btnOpenAddAddress')?.addEventListener('click', () => {
      $('#addAddressModal')?.classList.remove('hidden');
    });
    $('#closeAddAddressModal')?.addEventListener('click', () => {
      $('#addAddressModal')?.classList.add('hidden');
    });
    $('#cancelAddAddressBtn')?.addEventListener('click', () => {
      $('#addAddressModal')?.classList.add('hidden');
    });

    $('#addNewAddressForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newAddr = {
        id: Date.now(),
        type: fd.get('type') || 'Home',
        isDefault: fd.get('is_default') === 'on',
        name: fd.get('name'),
        phone: fd.get('phone'),
        house: fd.get('house'),
        street: fd.get('street'),
        city: fd.get('city') || 'Hyderabad',
        state: 'Telangana',
        pincode: fd.get('pincode') || '500081'
      };

      if (newAddr.isDefault) {
        state.addresses.forEach((a) => (a.isDefault = false));
      }
      state.addresses.push(newAddr);
      renderAddresses();
      $('#addAddressModal')?.classList.add('hidden');
      e.target.reset();
      showToast('New address saved successfully!');
    });

    // Subscriptions Actions (Pause / Modify)
    $('#subscriptionsGridContainer')?.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-toggle-sub]');
      if (toggleBtn) {
        const id = toggleBtn.dataset.toggleSub;
        const sub = state.subscriptions.find((s) => s.id === id);
        if (sub) {
          sub.status = sub.status === 'active' ? 'paused' : 'active';
          renderSubscriptions();
          showToast(sub.status === 'active' ? 'Subscription resumed!' : 'Subscription paused for now.');
        }
        return;
      }

      const modifyBtn = e.target.closest('[data-modify-sub]');
      if (modifyBtn) {
        const id = modifyBtn.dataset.modifySub;
        const sub = state.subscriptions.find((s) => s.id === id);
        if (sub) {
          const newQty = prompt(`Update daily quantity for ${sub.product}:`, sub.quantity);
          if (newQty && newQty.trim()) {
            sub.quantity = newQty.trim();
            renderSubscriptions();
            showToast(`Quantity updated to ${sub.quantity}`);
          }
        }
      }
    });

    // Tracking Modal Close
    $('#trackingModalClose')?.addEventListener('click', () => {
      $('#trackingModal')?.classList.add('hidden');
    });

    // Edit Profile Modal
    $('#btnEditProfile')?.addEventListener('click', () => {
      $('#editProfileName').value = state.customer.name;
      $('#editProfileEmail').value = state.customer.email;
      $('#editProfileModal')?.classList.remove('hidden');
    });
    $('#closeEditProfileModal')?.addEventListener('click', () => {
      $('#editProfileModal')?.classList.add('hidden');
    });
    $('#editProfileForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      state.customer.name = $('#editProfileName').value.trim() || state.customer.name;
      state.customer.email = $('#editProfileEmail').value.trim() || state.customer.email;
      renderUserInfo();
      $('#editProfileModal')?.classList.add('hidden');
      showToast('Profile information updated!');
    });

    // Policy links
    $$('.policy-btn').forEach((btn) => {
      btn.addEventListener('click', () => openPolicyModal(btn.dataset.policy));
    });
    $('#policyClose')?.addEventListener('click', closePolicyModal);
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
        <p>Orders of ₹499 and above enjoy <strong>FREE Delivery</strong>. For orders below ₹499, a nominal delivery charge of ₹40 applies.</p>`
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

  // Open Tracking Modal
  function openTrackingModal(orderId) {
    const order = state.orders.find((o) => o.id === orderId) || state.orders[0];
    const modal = $('#trackingModal');
    if (!modal) return;

    $('#trackingModalOrderId').textContent = `#${order.id}`;
    $('#trackingModalStatus').textContent = order.statusLabel;
    $('#trackingModalCourier').textContent = order.courier;
    $('#trackingModalEst').textContent = order.estDelivery;

    modal.classList.remove('hidden');
  }

  // Logout User
  async function logoutUser() {
    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' });
    } catch {}
    sessionStorage.removeItem('milvanta-auth-token');
    showToast('Logged out successfully.');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 800);
  }

  // Initialize Page
  document.addEventListener('DOMContentLoaded', () => {
    // Read URL tab parameter
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab') || 'profile';

    initProfile();
    updateCartBadge();
    renderOrders();
    renderAddresses();
    renderSubscriptions();
    setupListeners();
    switchTab(initialTab);
  });
})();

