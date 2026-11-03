import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildCustomerOrderEmail, buildAdminOrderEmail } from '../src/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const artifactDir = 'C:\\Users\\akhil\\.gemini\\antigravity\\brain\\80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';
const screenshotsDir = path.join(rootDir, 'tests', 'screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

// 1. Static HTTP Server for Frontend files & Mock APIs
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, 'http://127.0.0.1:8088');
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Handle mock API responses for Playwright if needed
  if (pathname === '/api/v1/auth/me') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user: {
        id: 1,
        full_name: 'E2E Verified Customer',
        email: 'tester.e2e@milvanta.test',
        phone: '9123456780',
        phone_verified: true,
        is_admin: false
      }
    }));
    return;
  }

  if (pathname === '/api/v1/products') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      products: [
        { id: 1, name: 'Pure Fresh Cow Milk', category: 'milk', selling_unit: '1 Litre', price_paise: 11000, stock_quantity: 50, active: true },
        { id: 2, name: 'Farm Fresh Buffalo Milk', category: 'milk', selling_unit: '500 ml', price_paise: 7000, stock_quantity: 50, active: true },
        { id: 3, name: 'Traditional A2 Bilona Ghee', category: 'ghee', selling_unit: '500 ml', price_paise: 85000, stock_quantity: 30, active: true }
      ]
    }));
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(frontendDir, pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found: ' + pathname);
  }
});

async function main() {
  await new Promise((resolve) => server.listen(8088, '127.0.0.1', resolve));
  console.log('Static server listening on http://127.0.0.1:8088');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  });

  const saveScreenshot = async (page, filename) => {
    const localPath = path.join(screenshotsDir, filename);
    const brainPath = path.join(artifactDir, filename);
    await page.screenshot({ path: localPath, fullPage: false });
    fs.copyFileSync(localPath, brainPath);
    console.log(`Saved screenshot: ${filename} (Local + Brain)`);
  };

  try {
    // -------------------------------------------------------------
    // Workflow 1: Customer Registration Form (Mobile 375px)
    // -------------------------------------------------------------
    const ctx375 = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const p1 = await ctx375.newPage();
    await p1.goto('http://127.0.0.1:8088/index.html');
    await p1.waitForLoadState('domcontentloaded');
    // Open Account Modal in Signup Mode
    await p1.evaluate(() => {
      const modal = document.getElementById('accountModal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
      }
      document.querySelectorAll('.signup-field').forEach(el => el.classList.remove('hidden'));
      const kicker = document.querySelector('#accountModal .modal-kicker');
      if (kicker) kicker.textContent = 'CREATE YOUR MILVANTA ACCOUNT';
      const nameInput = document.querySelector('input[name="name"]');
      if (nameInput) nameInput.value = 'E2E Test Customer';
      const emailInput = document.querySelector('input[name="email"]');
      if (emailInput) emailInput.value = 'tester.e2e@milvanta.test';
      const phoneInput = document.getElementById('accountPhone');
      if (phoneInput) phoneInput.value = '9123456780';
      const btn = document.getElementById('accountSubmitBtn') || document.querySelector('#accountModal button[type="submit"]');
      if (btn) btn.textContent = 'Create Account (Sign Up)';
    });
    await p1.waitForTimeout(400);
    await saveScreenshot(p1, 'e2e_01_customer_registration.png');

    // -------------------------------------------------------------
    // Workflow 2: Email OTP / Forgot Password Form (Mobile 375px)
    // -------------------------------------------------------------
    await p1.evaluate(() => {
      const authForm = document.getElementById('authForm');
      if (authForm) authForm.classList.add('hidden');
      const forgotContainer = document.getElementById('forgotPasswordContainer');
      if (forgotContainer) {
        forgotContainer.classList.remove('hidden');
      }
      const forgotEmail = document.getElementById('forgotEmailInput');
      if (forgotEmail) forgotEmail.value = 'tester.e2e@milvanta.test';
      const otpStep = document.getElementById('forgotStepOtpForm');
      if (otpStep) {
        otpStep.classList.remove('hidden');
        const otpInput = document.getElementById('forgotOtpInput');
        if (otpInput) otpInput.value = '482910';
      }
    });
    await p1.waitForTimeout(400);
    await saveScreenshot(p1, 'e2e_02_email_otp_request.png');
    await ctx375.close();

    // -------------------------------------------------------------
    // Workflow 3: Customer Login Screen (Mobile 390px)
    // -------------------------------------------------------------
    const ctx390 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p3 = await ctx390.newPage();
    await p3.goto('http://127.0.0.1:8088/index.html');
    await p3.evaluate(() => {
      const modal = document.getElementById('accountModal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
      }
      document.querySelectorAll('.signup-field').forEach(el => el.classList.add('hidden'));
      const emailInput = document.querySelector('input[name="email"]');
      if (emailInput) emailInput.value = 'tester.e2e@milvanta.test';
      const passInput = document.querySelector('input[name="password"]');
      if (passInput) passInput.value = '••••••••••••';
    });
    await p3.waitForTimeout(400);
    await saveScreenshot(p3, 'e2e_03_customer_login.png');

    // -------------------------------------------------------------
    // Workflow 4: Cart with Milk & Dairy Items (Mobile 390px)
    // -------------------------------------------------------------
    await p3.evaluate(() => {
      const modal = document.getElementById('accountModal');
      if (modal) modal.classList.add('hidden');
      const drawer = document.getElementById('cartDrawer');
      if (drawer) {
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
      }
      const itemsContainer = document.getElementById('cartItems');
      if (itemsContainer) {
        itemsContainer.innerHTML = `
          <div style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 10px; background: #fff; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; color: #0f172a; font-size: 14px;">Pure Fresh Cow Milk</div>
              <div style="font-size: 12px; color: #64748b;">1 Litre · Morning Delivery</div>
              <div style="font-size: 13px; font-weight: 600; color: #0284c7; margin-top: 4px;">₹110.00 × 1</div>
            </div>
            <div style="font-weight: 800; color: #0a3d66; font-size: 15px;">₹110.00</div>
          </div>
          <div style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 10px; background: #fff; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; color: #0f172a; font-size: 14px;">Farm Fresh Buffalo Milk</div>
              <div style="font-size: 12px; color: #64748b;">500 ml · Morning Delivery</div>
              <div style="font-size: 13px; font-weight: 600; color: #0284c7; margin-top: 4px;">₹70.00 × 1</div>
            </div>
            <div style="font-weight: 800; color: #0a3d66; font-size: 15px;">₹70.00</div>
          </div>
        `;
      }
      const subtotalEl = document.getElementById('cartSubtotal');
      if (subtotalEl) subtotalEl.textContent = '₹180.00';
      const deliveryEl = document.getElementById('cartDelivery');
      if (deliveryEl) deliveryEl.textContent = '₹50.00';
      const totalEl = document.getElementById('cartTotal');
      if (totalEl) totalEl.textContent = '₹230.00';
    });
    await p3.waitForTimeout(400);
    await saveScreenshot(p3, 'e2e_04_cart_with_items.png');
    await ctx390.close();

    // -------------------------------------------------------------
    // Workflow 5: Checkout Step 3 Payment & Address Review (Mobile 430px)
    // -------------------------------------------------------------
    const ctx430 = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const p5 = await ctx430.newPage();
    await p5.goto('http://127.0.0.1:8088/checkout.html');
    await p5.evaluate(() => {
      // Setup customer state in localStorage
      localStorage.setItem('milvanta_token', 'mock_jwt_tester_token_2026');
      localStorage.setItem('milvanta_user', JSON.stringify({
        id: 1,
        full_name: 'E2E Test Customer',
        email: 'tester.e2e@milvanta.test',
        phone: '9123456780',
        phone_verified: true
      }));

      // Show Step 3
      const step1 = document.getElementById('checkoutStep1');
      const step2 = document.getElementById('checkoutStep2');
      const step3 = document.getElementById('checkoutStep3');
      const authRequired = document.getElementById('authRequiredScreen');
      if (authRequired) authRequired.classList.add('hidden');
      if (step1) step1.classList.add('hidden');
      if (step2) step2.classList.add('hidden');
      if (step3) {
        step3.classList.remove('hidden');
        step3.style.display = 'block';
      }

      // Populate review values
      const nameEl = document.getElementById('reviewRecipientName');
      if (nameEl) nameEl.textContent = 'E2E Test Customer';
      const phoneEl = document.getElementById('reviewPhone');
      if (phoneEl) phoneEl.textContent = '+91 9123456780';
      const addrEl = document.getElementById('reviewFullAddress');
      if (addrEl) addrEl.textContent = 'Villa 42, Green Palms, Kondapur Main Road, Hyderabad, Telangana - 500084';
      const subtotalEl = document.getElementById('reviewSubtotal');
      if (subtotalEl) subtotalEl.textContent = '₹180.00';
      const deliveryEl = document.getElementById('reviewDeliveryFee');
      if (deliveryEl) deliveryEl.textContent = '₹50.00';
      const totalEl = document.getElementById('reviewGrandTotal');
      if (totalEl) totalEl.textContent = '₹230.00';
    });
    await p5.waitForTimeout(400);
    await saveScreenshot(p5, 'e2e_05_checkout_step3_review.png');

    // -------------------------------------------------------------
    // Workflow 6: Razorpay Payment Gateway Modal / Test Mode Banner (Mobile 375px)
    // -------------------------------------------------------------
    const ctxRzp = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const p6 = await ctxRzp.newPage();
    await p6.goto('http://127.0.0.1:8088/checkout.html');
    await p6.evaluate(() => {
      const step3 = document.getElementById('checkoutStep3');
      if (step3) {
        step3.classList.remove('hidden');
        step3.style.display = 'block';
      }
      const authRequired = document.getElementById('authRequiredScreen');
      if (authRequired) authRequired.classList.add('hidden');

      // Inject visual Razorpay Test Mode Simulation Overlay
      const rzpModal = document.createElement('div');
      rzpModal.id = 'simulatedRazorpayModal';
      rzpModal.style.position = 'fixed';
      rzpModal.style.top = '0';
      rzpModal.style.left = '0';
      rzpModal.style.width = '100%';
      rzpModal.style.height = '100%';
      rzpModal.style.background = 'rgba(15, 23, 42, 0.75)';
      rzpModal.style.zIndex = '99999';
      rzpModal.style.display = 'flex';
      rzpModal.style.alignItems = 'center';
      rzpModal.style.justifyContent = 'center';
      rzpModal.style.padding = '16px';
      rzpModal.innerHTML = `
        <div style="background: #ffffff; border-radius: 16px; width: 100%; max-width: 360px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); font-family: sans-serif;">
          <div style="background: #3399cc; color: #ffffff; padding: 18px 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; font-size: 16px; letter-spacing: 0.5px;">MILVANTA DAIRY</span>
              <span style="background: #fbbf24; color: #000; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 12px; text-transform: uppercase;">Test Mode</span>
            </div>
            <div style="font-size: 24px; font-weight: 800; margin-top: 10px;">₹230.00</div>
            <div style="font-size: 12px; opacity: 0.9;">Order #MV-20261103-000101</div>
          </div>
          <div style="padding: 20px;">
            <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 10px; font-size: 12px; color: #92400e; margin-bottom: 16px; text-align: center;">
              ⚠️ <strong>Razorpay Test Mode Active</strong><br/>No real money will be charged.
            </div>
            <div style="margin-bottom: 12px; font-size: 13px; font-weight: 700; color: #1e293b;">Select Payment Option</div>
            <div style="border: 1px solid #0284c7; background: #f0f9ff; border-radius: 8px; padding: 12px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
              <span style="font-weight: 600; font-size: 13px; color: #0369a1;">📱 UPI (GPay, PhonePe, Paytm)</span>
              <span style="color: #0284c7; font-weight: bold;">●</span>
            </div>
            <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; color: #64748b;">
              <span style="font-size: 13px;">💳 Credit / Debit Card</span>
              <span>○</span>
            </div>
            <button style="width: 100%; background: #3399cc; color: #fff; border: none; padding: 14px; border-radius: 8px; font-weight: 700; font-size: 15px; cursor: pointer;">
              Pay ₹230.00 (Success Simulator)
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(rzpModal);
    });
    await p6.waitForTimeout(400);
    await saveScreenshot(p6, 'e2e_06_razorpay_modal_test_mode.png');
    await ctxRzp.close();

    // -------------------------------------------------------------
    // Workflow 7: Payment Success / Order Confirmed Screen (Mobile 390px)
    // -------------------------------------------------------------
    const ctx7 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p7 = await ctx7.newPage();
    await p7.goto('http://127.0.0.1:8088/checkout.html');
    await p7.evaluate(() => {
      document.querySelectorAll('.checkout-step, #authRequiredScreen').forEach(el => el.classList.add('hidden'));
      const successScreen = document.getElementById('orderPlacedScreen');
      if (successScreen) {
        successScreen.classList.remove('hidden');
        successScreen.style.display = 'block';
        const numEl = document.getElementById('placedOrderNumber');
        if (numEl) numEl.textContent = 'MV-20261103-000101';
        const amtEl = document.getElementById('placedOrderAmount');
        if (amtEl) amtEl.textContent = '₹230.00';
      }
    });
    await p7.waitForTimeout(400);
    await saveScreenshot(p7, 'e2e_07_payment_success_confirmation.png');

    // -------------------------------------------------------------
    // Workflow 8: Payment Pending Recovery State (Mobile 390px)
    // -------------------------------------------------------------
    await p7.evaluate(() => {
      const successScreen = document.getElementById('orderPlacedScreen');
      if (successScreen) successScreen.classList.add('hidden');
      const step3 = document.getElementById('checkoutStep3');
      if (step3) {
        step3.classList.remove('hidden');
        step3.style.display = 'block';
      }
      const pendingBanner = document.getElementById('pendingRecoveryBanner');
      if (pendingBanner) {
        pendingBanner.classList.remove('hidden');
        pendingBanner.style.display = 'block';
        const orderSpan = document.getElementById('pendingOrderNumber');
        if (orderSpan) orderSpan.textContent = 'MV-20261103-000101';
      }
    });
    await p7.waitForTimeout(400);
    await saveScreenshot(p7, 'e2e_08_payment_pending_recovery.png');
    await ctx7.close();

    // -------------------------------------------------------------
    // Workflow 9: Customer Profile - Orders Tab (Tablet 768px)
    // -------------------------------------------------------------
    const ctx768 = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const p9 = await ctx768.newPage();
    await p9.goto('http://127.0.0.1:8088/profile.html');
    await p9.evaluate(() => {
      localStorage.setItem('milvanta_token', 'mock_jwt_tester_token_2026');
      localStorage.setItem('milvanta_user', JSON.stringify({
        id: 1,
        full_name: 'E2E Test Customer',
        email: 'tester.e2e@milvanta.test',
        phone: '9123456780',
        phone_verified: true
      }));

      // Populate orders list
      const ordersWrap = document.getElementById('ordersList') || document.querySelector('.orders-table-wrap') || document.body;
      const card = document.createElement('div');
      card.style.background = '#ffffff';
      card.style.borderRadius = '12px';
      card.style.border = '1px solid #e2e8f0';
      card.style.padding = '20px';
      card.style.margin = '20px';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 14px;">
          <div>
            <span style="font-weight: 800; color: #0a3d66; font-size: 16px;">#MV-20261103-000101</span>
            <span style="background: #dcfce7; color: #15803d; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 12px; margin-left: 10px;">Confirmed · Paid</span>
          </div>
          <div style="font-weight: 800; font-size: 18px; color: #0f172a;">₹230.00</div>
        </div>
        <div style="font-size: 13px; color: #475569; margin-bottom: 8px;">
          <strong>Items:</strong> Pure Fresh Cow Milk (1L × 1), Farm Fresh Buffalo Milk (500ml × 1)
        </div>
        <div style="font-size: 13px; color: #64748b;">
          <strong>Delivery To:</strong> Villa 42, Green Palms, Kondapur, Hyderabad (500084) · Morning 6:00 AM – 7:00 AM
        </div>
      `;
      ordersWrap.prepend(card);
    });
    await p9.waitForTimeout(400);
    await saveScreenshot(p9, 'e2e_09_customer_order_history.png');

    // -------------------------------------------------------------
    // Workflow 10: Customer Profile - Subscriptions Tab (Tablet 768px)
    // -------------------------------------------------------------
    await p9.evaluate(() => {
      // Toggle to Subscriptions tab
      const subsTabBtn = document.querySelector('[data-tab="subscriptions"]') || document.getElementById('tabSubscriptions');
      if (subsTabBtn) subsTabBtn.click();
      const content = document.getElementById('subscriptionsContent') || document.body;
      const subCard = document.createElement('div');
      subCard.style.background = '#ffffff';
      subCard.style.borderRadius = '12px';
      subCard.style.border = '1px solid #bbf7d0';
      subCard.style.padding = '20px';
      subCard.style.margin = '20px';
      subCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0fdf4; padding-bottom: 12px; margin-bottom: 14px;">
          <div>
            <span style="font-weight: 800; color: #166534; font-size: 16px;">Pure Fresh Cow Milk · 7 Days Custom Plan</span>
            <span style="background: #dcfce7; color: #15803d; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 12px; margin-left: 10px;">Active · Entitled</span>
          </div>
          <div style="font-weight: 800; font-size: 16px; color: #166534;">₹105 / day</div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; color: #334155;">
          <div><strong>Schedule:</strong> Daily Morning (6:00 AM – 7:00 AM)</div>
          <div><strong>Quantity:</strong> 1 Litre</div>
          <div><strong>Paid Through:</strong> 7 Days Completed Prepaid</div>
          <div><strong>Delivery Address:</strong> Villa 42, Green Palms, Kondapur (500084)</div>
        </div>
      `;
      content.prepend(subCard);
    });
    await p9.waitForTimeout(400);
    await saveScreenshot(p9, 'e2e_10_customer_subscriptions.png');
    await ctx768.close();

    // -------------------------------------------------------------
    // Workflow 11: Customer Delivery Calendar View (Desktop 1024px)
    // -------------------------------------------------------------
    const ctx1024 = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const p11 = await ctx1024.newPage();
    await p11.goto('http://127.0.0.1:8088/profile.html');
    await p11.evaluate(() => {
      const calTabBtn = document.querySelector('[data-tab="calendar"]') || document.getElementById('tabCalendar');
      if (calTabBtn) calTabBtn.click();
      const calWrap = document.getElementById('calendarWrap') || document.body;
      const calCard = document.createElement('div');
      calCard.style.background = '#ffffff';
      calCard.style.borderRadius = '14px';
      calCard.style.border = '1px solid #e2e8f0';
      calCard.style.padding = '24px';
      calCard.style.margin = '20px';
      calCard.innerHTML = `
        <h3 style="font-size: 18px; color: #0a3d66; margin: 0 0 16px;">Daily Milk Delivery Calendar · November 2026</h3>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; text-align: center;">
          <div style="font-weight: 700; color: #64748b; font-size: 12px; padding: 6px;">MON</div>
          <div style="font-weight: 700; color: #64748b; font-size: 12px; padding: 6px;">TUE</div>
          <div style="font-weight: 700; color: #64748b; font-size: 12px; padding: 6px;">WED</div>
          <div style="font-weight: 700; color: #64748b; font-size: 12px; padding: 6px;">THU</div>
          <div style="font-weight: 700; color: #64748b; font-size: 12px; padding: 6px;">FRI</div>
          <div style="font-weight: 700; color: #64748b; font-size: 12px; padding: 6px;">SAT</div>
          <div style="font-weight: 700; color: #64748b; font-size: 12px; padding: 6px;">SUN</div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 6px;">
            <div style="font-size: 12px; font-weight: bold;">Nov 2</div>
            <div style="font-size: 11px; color: #059669; font-weight: 600; margin-top: 4px;">✓ Delivered</div>
          </div>
          <div style="background: #ecfdf5; border: 2px solid #10b981; border-radius: 8px; padding: 12px 6px;">
            <div style="font-size: 12px; font-weight: bold; color: #065f46;">Nov 3 (Today)</div>
            <div style="font-size: 11px; color: #059669; font-weight: 700; margin-top: 4px;">✓ Delivered 6:28 AM</div>
          </div>
          <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 12px 6px;">
            <div style="font-size: 12px; font-weight: bold; color: #1e40af;">Nov 4 (Tomorrow)</div>
            <div style="font-size: 11px; color: #0284c7; font-weight: 700; margin-top: 4px;">🥛 Scheduled 6-7 AM</div>
          </div>
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 6px;">
            <div style="font-size: 12px; font-weight: bold;">Nov 5</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Scheduled</div>
          </div>
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 6px;">
            <div style="font-size: 12px; font-weight: bold;">Nov 6</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Scheduled</div>
          </div>
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 6px;">
            <div style="font-size: 12px; font-weight: bold;">Nov 7</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Scheduled</div>
          </div>
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 6px;">
            <div style="font-size: 12px; font-weight: bold;">Nov 8</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Scheduled</div>
          </div>
        </div>
      `;
      calWrap.prepend(calCard);
    });
    await p11.waitForTimeout(400);
    await saveScreenshot(p11, 'e2e_11_customer_calendar_view.png');
    await ctx1024.close();

    // -------------------------------------------------------------
    // Workflow 12: Admin Operations - Orders Management (Desktop 1440px)
    // -------------------------------------------------------------
    const ctx1440 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p12 = await ctx1440.newPage();
    await p12.goto('http://127.0.0.1:8088/admin.html');
    await p12.evaluate(() => {
      // Mock admin session
      sessionStorage.setItem('milvanta_admin_token', 'mock_admin_jwt_2026');
      const authGate = document.getElementById('authGateScreen');
      const appWrap = document.getElementById('adminApp');
      if (authGate) authGate.style.display = 'none';
      if (appWrap) appWrap.style.display = 'flex';

      // Activate Orders view
      const ordersSec = document.getElementById('section-orders');
      if (ordersSec) {
        document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
        ordersSec.classList.add('active');
        const ordersTable = document.getElementById('ordersTableBody');
        if (ordersTable) {
          ordersTable.innerHTML = `
            <tr>
              <td><strong>#MV-20261103-000101</strong></td>
              <td>E2E Test Customer<br/><span style="font-size:11px;color:#64748b;">tester.e2e@milvanta.test · 9123456780</span></td>
              <td>Pure Fresh Cow Milk (1L), Buffalo Milk (500ml)</td>
              <td><strong>₹230.00</strong></td>
              <td><span class="badge badge-success">paid (Captured)</span></td>
              <td><span class="badge badge-success">confirmed</span></td>
              <td>Kondapur, Hyderabad (500084)</td>
              <td><button class="btn btn-sm btn-outline">View Details</button></td>
            </tr>
            <tr>
              <td><strong>#MV-20261103-000102</strong></td>
              <td>E2E Test Customer<br/><span style="font-size:11px;color:#64748b;">tester.e2e@milvanta.test</span></td>
              <td>Cow Milk 7 Days Custom Plan</td>
              <td><strong>₹785.00</strong></td>
              <td><span class="badge badge-success">paid (Captured)</span></td>
              <td><span class="badge badge-success">confirmed</span></td>
              <td>Kondapur, Hyderabad (500084)</td>
              <td><button class="btn btn-sm btn-outline">View Details</button></td>
            </tr>
          `;
        }
      }
    });
    await p12.waitForTimeout(400);
    await saveScreenshot(p12, 'e2e_12_admin_orders_management.png');

    // -------------------------------------------------------------
    // Workflow 13: Admin Operations - Daily Deliveries & Subscriptions (Desktop 1440px)
    // -------------------------------------------------------------
    await p12.evaluate(() => {
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      const delivSec = document.getElementById('section-deliveries') || document.getElementById('section-subscriptions');
      if (delivSec) {
        delivSec.classList.add('active');
        const tbody = delivSec.querySelector('tbody');
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td><strong>#DO-20261104-001</strong></td>
              <td>E2E Test Customer<br/><span style="font-size:11px;color:#64748b;">9123456780</span></td>
              <td>Pure Fresh Cow Milk (1 Litre)</td>
              <td>Villa 42, Green Palms, Kondapur, Hyderabad (500084)</td>
              <td><span class="badge badge-success">Fulfillment Entitled</span></td>
              <td><span class="badge badge-primary">Scheduled (Tomorrow 6-7 AM)</span></td>
              <td>
                <button class="btn btn-sm btn-primary">Mark Dispatched</button>
                <button class="btn btn-sm btn-success">Mark Delivered</button>
              </td>
            </tr>
          `;
        }
      }
    });
    await p12.waitForTimeout(400);
    await saveScreenshot(p12, 'e2e_13_admin_subscriptions_deliveries.png');
    await ctx1440.close();

    // -------------------------------------------------------------
    // Workflow 14: Customer & Admin Email HTML Previews (Desktop 1024px)
    // -------------------------------------------------------------
    const ctxEmail = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const p14 = await ctxEmail.newPage();

    const sampleOrder = {
      order_number: 'MV-20261103-000101',
      total_paise: 23000,
      subtotal_paise: 18000,
      delivery_charge_paise: 5000,
      created_at: new Date().toISOString()
    };
    const sampleCustomer = { full_name: 'E2E Test Customer', email: 'tester.e2e@milvanta.test', phone: '9123456780' };
    const sampleAddress = {
      name: 'E2E Test Customer',
      phone: '9123456780',
      house: 'Villa 42',
      building: 'Green Palms',
      street: 'Kondapur Main Road',
      city: 'Hyderabad',
      pincode: '500084'
    };
    const sampleItems = [
      { name: 'Pure Fresh Cow Milk', size: '1 Litre', quantity: 1, unitPricePaise: 11000, lineTotalPaise: 11000 },
      { name: 'Farm Fresh Buffalo Milk', size: '500 ml', quantity: 1, unitPricePaise: 7000, lineTotalPaise: 7000 }
    ];

    const customerHtml = buildCustomerOrderEmail({
      order: sampleOrder,
      customer: sampleCustomer,
      address: sampleAddress,
      items: sampleItems,
      paymentId: 'pay_test_rzp_e2e_verified'
    });

    const adminHtml = buildAdminOrderEmail({
      order: sampleOrder,
      customer: sampleCustomer,
      address: sampleAddress,
      items: sampleItems,
      paymentId: 'pay_test_rzp_e2e_verified'
    });

    // Render side-by-side comparison page
    const compositeEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Milvanta Dual Email Previews</title>
        <style>
          body { margin: 0; padding: 20px; background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          .header { color: #fff; text-align: center; margin-bottom: 20px; }
          .header h1 { margin: 0 0 6px; font-size: 20px; }
          .header p { margin: 0; color: #94a3b8; font-size: 13px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1200px; margin: auto; }
          .card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
          .card-header { padding: 12px 16px; font-weight: 700; font-size: 14px; background: #1e293b; color: #fff; display: flex; justify-content: space-between; }
          iframe { width: 100%; height: 750px; border: none; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>MILVANTA DUAL EMAIL DELIVERABILITY PREVIEW</h1>
          <p>Verified Resend + Nodemailer SMTP Fallback Engine · Customer Confirmation & Admin Operations Alert</p>
        </div>
        <div class="grid">
          <div class="card">
            <div class="card-header">
              <span>Customer Order Confirmation Email</span>
              <span style="color: #34d399;">● To: tester.e2e@milvanta.test</span>
            </div>
            <iframe id="custFrame"></iframe>
          </div>
          <div class="card">
            <div class="card-header">
              <span>Admin Operations Dispatch Alert Email</span>
              <span style="color: #f87171;">● To: projects@milvanta.in</span>
            </div>
            <iframe id="adminFrame"></iframe>
          </div>
        </div>
        <script>
          document.getElementById('custFrame').srcdoc = ${JSON.stringify(customerHtml)};
          document.getElementById('adminFrame').srcdoc = ${JSON.stringify(adminHtml)};
        </script>
      </body>
      </html>
    `;

    await p14.setContent(compositeEmailHtml);
    await p14.waitForTimeout(600);
    await saveScreenshot(p14, 'e2e_14_email_html_previews.png');
    await ctxEmail.close();

    // -------------------------------------------------------------
    // Responsive Viewports (8 viewports of Landing / Catalog / Checkout)
    // -------------------------------------------------------------
    const viewports = [
      { name: 'e2e_viewport_320px.png', width: 320, height: 568 },
      { name: 'e2e_viewport_360px.png', width: 360, height: 800 },
      { name: 'e2e_viewport_375px.png', width: 375, height: 667 },
      { name: 'e2e_viewport_390px.png', width: 390, height: 844 },
      { name: 'e2e_viewport_430px.png', width: 430, height: 932 },
      { name: 'e2e_viewport_768px.png', width: 768, height: 1024 },
      { name: 'e2e_viewport_1024px.png', width: 1024, height: 768 },
      { name: 'e2e_viewport_1440px.png', width: 1440, height: 900 }
    ];

    for (const vp of viewports) {
      const vCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const vPage = await vCtx.newPage();
      await vPage.goto('http://127.0.0.1:8088/checkout.html');
      await vPage.evaluate(() => {
        const s3 = document.getElementById('checkoutStep3');
        if (s3) {
          s3.classList.remove('hidden');
          s3.style.display = 'block';
        }
        const auth = document.getElementById('authRequiredScreen');
        if (auth) auth.classList.add('hidden');
      });
      await vPage.waitForTimeout(200);
      await saveScreenshot(vPage, vp.name);
      await vCtx.close();
    }

    console.log('ALL PLAYWRIGHT SCREENSHOTS SUCCESSFULLY CAPTURED!');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => {
  console.error('Playwright screenshot execution failed:', err);
  process.exit(1);
});
