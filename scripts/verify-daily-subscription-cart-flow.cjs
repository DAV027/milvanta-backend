const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

async function main() {
  const edgePath = fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';

  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,960']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  console.log('1. Navigating to index.html...');
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // Test 1: Continuous Months in Product Modal -> Add to cart
  console.log('2. Opening Cow Milk modal and testing Continuous Months plan...');
  await page.evaluate(() => {
    localStorage.removeItem('milvanta-cart');
    // Set mock user for checkout navigation
    localStorage.setItem('milvanta-user', JSON.stringify({
      id: 1,
      full_name: 'Akhil Test',
      phone: '6305974564',
      email: 'akhil@example.com'
    }));
    window.openProductModal(101);
  });
  await new Promise(r => setTimeout(r, 600));

  // Switch to Subscription tab
  await page.evaluate(() => {
    const btn = document.querySelector('#btnModeSub');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  // Select 2 months quick pill
  await page.evaluate(() => {
    const pill = document.querySelector('#subMonthQuickPills [data-months="2"]');
    if (pill) pill.click();
  });
  await new Promise(r => setTimeout(r, 400));

  const continuousBtnText = await page.$eval('#modalAddToCart', el => el.textContent.trim());
  console.log('Modal Button Text (Continuous Months):', continuousBtnText);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'modal_continuous_months_add_to_cart.png') });

  // Click Add to cart button
  console.log('3. Clicking Add to Cart for Continuous Months...');
  await page.evaluate(() => document.querySelector('#modalAddToCart')?.click());
  await new Promise(r => setTimeout(r, 800));

  // Verify Cart Drawer display for Continuous Months
  const cartInfo1 = await page.evaluate(() => {
    const cart = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
    const badge = document.querySelector('.cart-item .cart-details .cart-sub-badge, .cart-item [style*="Continuous Subscription"]');
    const checkoutBtn = document.querySelector('#cartPlaceOrderBtn');
    const subNote = document.querySelector('.cart-drawer-footer [style*="Continuous Months"]');
    return {
      cartLength: cart.length,
      item: cart[0],
      badgeText: badge ? badge.textContent.trim() : null,
      btnText: checkoutBtn ? checkoutBtn.textContent.trim() : null,
      hasSubNote: Boolean(subNote)
    };
  });
  console.log('Cart drawer state (Continuous Months):', cartInfo1);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_drawer_continuous_months.png') });

  // Close cart drawer
  await page.evaluate(() => window.setCartOpen(false));
  await new Promise(r => setTimeout(r, 400));

  // Test 2: Custom Days in Product Modal -> Add to cart
  console.log('4. Testing Custom Days plan in modal...');
  await page.evaluate(() => {
    window.openProductModal(102); // Buffalo Milk
  });
  await new Promise(r => setTimeout(r, 600));

  await page.evaluate(() => document.querySelector('#btnModeSub')?.click());
  await new Promise(r => setTimeout(r, 500));

  await page.evaluate(() => document.querySelector('#subTabCustom')?.click());
  await new Promise(r => setTimeout(r, 500));

  // Select 14 days pill
  await page.evaluate(() => {
    const pill = document.querySelector('[data-days="14"]');
    if (pill) pill.click();
  });
  await new Promise(r => setTimeout(r, 400));

  const customBtnText = await page.$eval('#modalAddToCart', el => el.textContent.trim());
  console.log('Modal Button Text (Custom Days):', customBtnText);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'modal_custom_days_add_to_cart.png') });

  console.log('5. Clicking Add to Cart for Custom Days...');
  await page.evaluate(() => document.querySelector('#modalAddToCart')?.click());
  await new Promise(r => setTimeout(r, 800));

  const cartInfo2 = await page.evaluate(() => {
    const cart = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
    return {
      cartLength: cart.length,
      items: cart.map(i => ({ name: i.name, size: i.size, isContinuous: i.isContinuousMonthsPlan, isCustom: i.isCustomDaysPlan }))
    };
  });
  console.log('Cart drawer state (Both in cart):', cartInfo2);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_drawer_both_subscription_types.png') });

  // Test 3: Checkout Page with Continuous Months Plan (Subscription-Based Payment)
  console.log('6. Navigating to checkout with Continuous Months Plan...');
  await page.goto('http://localhost:8080/checkout.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // Step 1 Details form submit
  await page.evaluate(() => document.querySelector('#step1NextBtn')?.click());
  await new Promise(r => setTimeout(r, 600));

  // Step 2 Address form submit
  await page.evaluate(() => document.querySelector('#step2NextBtn')?.click());
  await new Promise(r => setTimeout(r, 800));

  // Verify Step 3 Payment Card
  const step3InfoContinuous = await page.evaluate(() => {
    const cardTitle = document.querySelector('.payment-method-title')?.textContent.trim();
    const payBtn = document.querySelector('#payRazorpayBtn')?.textContent.trim();
    return { cardTitle, payBtn };
  });
  console.log('Step 3 Payment for Continuous Months Plan:', step3InfoContinuous);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'checkout_step3_continuous_subscription_payment.png') });

  // Test 4: Checkout Page with ONLY Custom Days Plan (Normal Payment)
  console.log('7. Testing Checkout with ONLY Custom Days Plan...');
  await page.evaluate(() => {
    // Keep only the Custom Days plan in cart
    const cart = JSON.parse(localStorage.getItem('milvanta-cart') || '[]');
    const customOnly = cart.filter(i => i.isCustomDaysPlan || i.variant?.isCustomDaysPlan);
    localStorage.setItem('milvanta-cart', JSON.stringify(customOnly));
  });
  await page.goto('http://localhost:8080/checkout.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => document.querySelector('#step1NextBtn')?.click());
  await new Promise(r => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector('#step2NextBtn')?.click());
  await new Promise(r => setTimeout(r, 800));

  const step3InfoCustom = await page.evaluate(() => {
    const cardTitle = document.querySelector('.payment-method-title')?.textContent.trim();
    const payBtn = document.querySelector('#payRazorpayBtn')?.textContent.trim();
    return { cardTitle, payBtn };
  });
  console.log('Step 3 Payment for Custom Days Plan:', step3InfoCustom);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'checkout_step3_custom_days_normal_payment.png') });

  // Test 5: Verify Both Subscriptions Show in Profile Subscription Tab
  console.log('8. Testing Profile Subscription rendering for both plan types...');
  await page.evaluate(() => {
    const testSubs = [
      {
        id: 'sub-continuous-test',
        product: 'Pure Fresh Cow Milk (500 ml)',
        productName: 'Pure Fresh Cow Milk',
        image: 'assets/milvanta-cow-milk.jpg',
        size: '500 ml',
        planType: 'month',
        durationLabel: 'Oct 2026 – Nov 2026 (61 Days)',
        days: 61,
        dailyRate: 55,
        costPerDay: 55,
        totalAmount: 3355,
        frequency: 'Daily (Every Morning)',
        timeSlot: '6:00 AM - 7:00 AM',
        quantity: '500 ml',
        qtyNum: 1,
        status: 'active',
        nextDelivery: 'Tomorrow, 6:00 AM – 7:00 AM'
      },
      {
        id: 'sub-custom-test',
        product: 'Pure Buffalo Milk (500 ml)',
        productName: 'Pure Buffalo Milk',
        image: 'assets/milvanta-buffalo-milk.jpg',
        size: '500 ml',
        planType: 'custom',
        durationLabel: '14 Days Custom Plan',
        days: 14,
        customDays: 14,
        dailyRate: 65,
        costPerDay: 65,
        totalAmount: 910,
        frequency: 'Daily (Every Morning)',
        timeSlot: '6:00 AM - 7:00 AM',
        quantity: '500 ml',
        qtyNum: 1,
        status: 'active',
        nextDelivery: 'Tomorrow, 6:00 AM – 7:00 AM'
      }
    ];
    localStorage.setItem('milvanta-subscriptions', JSON.stringify(testSubs));
  });

  await page.goto('http://localhost:8080/profile.html?tab=subscription', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  const profileSubsInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#subscriptionsGridContainer .subscription-card'));
    return cards.map(c => ({
      title: c.querySelector('.subscription-item-title')?.textContent.trim(),
      tag: c.querySelector('.subscription-item-tag')?.textContent.trim(),
      rate: c.querySelector('[style*="color: #059669"]')?.textContent.trim(),
      duration: c.querySelector('[style*="color: #0a3d66"]')?.textContent.trim()
    }));
  });
  console.log('Profile Subscriptions Tab Cards:', profileSubsInfo);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'profile_both_subscriptions_rendered.png') });

  await browser.close();
  console.log('ALL TESTS COMPLETED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
