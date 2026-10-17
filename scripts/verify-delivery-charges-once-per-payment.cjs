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

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  console.log('1. Navigating to index.html...');
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle2' });
  await sleep(1000);

  // Test 1: Open milk modal, check subscription price card delivery notice
  console.log('2. Opening Product Modal for Cow Milk (101)...');
  await page.evaluate(() => {
    localStorage.removeItem('milvanta-cart');
    localStorage.setItem('milvanta-user', JSON.stringify({
      id: 1,
      full_name: 'Akhil Test',
      phone: '6305974564',
      email: 'akhil@example.com'
    }));
    window.openProductModal(101);
  });
  await sleep(600);

  // Switch to Subscription tab
  await page.evaluate(() => document.querySelector('#btnModeSub')?.click());
  await sleep(500);

  const subNotice = await page.$eval('#subPriceSummaryCard', el => el.innerText);
  console.log('Subscription Price Summary Text:\n', subNotice);
  if (!subNotice.includes('Delivery charge (₹50) applies for all order & subscription types, and is applied only once per payment.')) {
    throw new Error('Delivery notice missing in subscription summary card');
  }

  // Add 1 Month subscription to cart
  console.log('3. Adding 1-Month Cow Milk subscription to cart...');
  await page.evaluate(() => document.querySelector('#modalAddToCart')?.click());
  await sleep(800);

  // Verify Cart Drawer display for Single Subscription Item
  const cartDrawer1 = await page.evaluate(() => {
    const footer = document.querySelector('.cart-drawer-footer');
    return footer ? footer.innerText : null;
  });
  console.log('Cart Drawer Footer (1 Subscription Item):\n', cartDrawer1);
  if (!cartDrawer1.includes('Delivery charges') || !cartDrawer1.includes('Applied once per payment · All types')) {
    throw new Error('Cart drawer missing delivery charges once-per-payment breakdown');
  }

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_drawer_single_sub_with_delivery.png') });

  // Add a regular store item (e.g. Malai Paneer or Buffalo Milk) to the same cart
  console.log('4. Adding regular product to cart (Mixed Cart Test)...');
  await page.evaluate(() => {
    window.setCartOpen(false);
  });
  await sleep(400);

  await page.evaluate(() => {
    window.addToCart(3, 1, { price: 160, size: '200g' }); // Malai Paneer
    window.setCartOpen(true);
  });
  await sleep(600);

  // Verify Cart Drawer for Mixed Cart (Subscription + Store Item)
  const cartDrawer2 = await page.evaluate(() => {
    const footer = document.querySelector('.cart-drawer-footer');
    return footer ? footer.innerText : null;
  });
  console.log('Cart Drawer Footer (Mixed Cart: Subscription + Store Item):\n', cartDrawer2);

  // Delivery charge should still be ₹50 (applied ONLY ONCE!)
  if (!cartDrawer2.includes('₹50')) {
    throw new Error('Delivery charge was not ₹50 for mixed cart');
  }
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_drawer_mixed_cart_single_delivery_fee.png') });

  // Test 5: Proceed to Checkout Page
  console.log('5. Navigating to checkout.html...');
  await page.goto('http://127.0.0.1:8080/checkout.html', { waitUntil: 'networkidle2' });
  await sleep(1000);

  const checkoutSummary = await page.evaluate(() => {
    const sidebar = document.querySelector('.summary-card');
    return sidebar ? sidebar.innerText : null;
  });
  console.log('Checkout Sidebar Summary:\n', checkoutSummary);
  if (!checkoutSummary.includes('Delivery charges') || !checkoutSummary.includes('Applied once per payment · All types')) {
    throw new Error('Checkout sidebar missing delivery charges once-per-payment breakdown');
  }
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'checkout_sidebar_delivery_charges_verified.png') });

  // Test 6: Verify Profile Subscriptions & Order History Tabs
  console.log('6. Navigating to profile.html?tab=subscription...');
  await page.evaluate(() => {
    // Populate sample subscription and order records
    const sampleSubs = [
      {
        id: 'sub-cont-101',
        product: 'Pure Fresh Cow Milk (500 ml)',
        productName: 'Pure Fresh Cow Milk',
        image: 'assets/milvanta-cow-milk.jpg',
        frequency: 'Daily (Every Morning)',
        timeSlot: '6:00 AM - 7:00 AM',
        quantity: '500 ml',
        dailyRate: 55,
        costPerDay: 55,
        totalAmount: 3355,
        deliveryFee: 50,
        totalPaid: 3405,
        planType: 'month',
        durationLabel: 'Oct 2026 – Nov 2026 (61 Days)',
        days: 61,
        status: 'active',
        nextDelivery: 'Tomorrow, 6:00 AM – 7:00 AM'
      },
      {
        id: 'sub-custom-102',
        product: 'Pure Buffalo Milk (500 ml)',
        productName: 'Pure Buffalo Milk',
        image: 'assets/milvanta-buffalo-milk.jpg',
        frequency: 'Daily (Every Morning)',
        timeSlot: '6:00 AM - 7:00 AM',
        quantity: '500 ml',
        dailyRate: 65,
        costPerDay: 65,
        totalAmount: 910,
        deliveryFee: 50,
        totalPaid: 960,
        planType: 'custom',
        durationLabel: '14 Days Custom Plan',
        days: 14,
        status: 'active',
        nextDelivery: 'Tomorrow, 6:00 AM – 7:00 AM'
      }
    ];

    const sampleOrders = [
      {
        order_number: 'MV-20261017-000016',
        items: [
          {
            productId: 2,
            name: 'Buffalo Milk',
            size: '500 ml',
            quantity: 1,
            qty: 1,
            unitPrice: 70,
            price: 70,
            lineTotal: 70,
            image: 'assets/milvanta-buffalo-milk.jpg'
          }
        ],
        subtotal: 70,
        deliveryFee: 50,
        total: 120,
        order_status: 'placed',
        payment_status: 'paid',
        paymentMethod: 'Paid Online via Razorpay',
        created_at: new Date().toISOString()
      }
    ];

    localStorage.setItem('milvanta-subscriptions', JSON.stringify(sampleSubs));
    localStorage.setItem('milvanta-orders', JSON.stringify(sampleOrders));
  });

  await page.goto('http://127.0.0.1:8080/profile.html?tab=subscription', { waitUntil: 'networkidle2' });
  await sleep(1000);

  const subCardDetails = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#subscriptionsGridContainer .subscription-card')).map(card => {
      const rows = Array.from(card.querySelectorAll('.sub-detail-row')).map(r => ({
        label: r.querySelector('.sub-detail-label')?.textContent.trim(),
        val: r.querySelector('.sub-detail-val')?.textContent.trim()
      }));
      return rows;
    });
  });
  console.log('Subscription Cards Financial Rows:\n', JSON.stringify(subCardDetails, null, 2));

  // Check that Delivery Charges and Deliveries Subtotal are shown
  const flatRows = subCardDetails.flat();
  const hasDeliveryChargeRow = flatRows.some(r => r.label === 'Delivery Charges');
  const hasSubtotalRow = flatRows.some(r => r.label === 'Deliveries Subtotal');
  console.log('Has Deliveries Subtotal Row:', hasSubtotalRow);
  console.log('Has Delivery Charges Row:', hasDeliveryChargeRow);
  if (!hasDeliveryChargeRow || !hasSubtotalRow) {
    throw new Error('Subscription cards missing separate Deliveries Subtotal and Delivery Charges rows');
  }

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'profile_subscription_cards_delivery_fee_verified.png') });

  // Test 7: Verify Order History Tab Shows Delivery Fee for All Order Types
  console.log('7. Switching to profile Order History tab...');
  await page.click('[data-tab="orders"]');
  await sleep(800);

  const ordersBillMetrics = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#ordersListContainer .order-card')).map(card => {
      const typeBadge = card.querySelector('.order-type-badge')?.textContent.trim();
      const orderId = card.querySelector('.order-id')?.textContent.trim();
      const metrics = Array.from(card.querySelectorAll('.order-bill-summary-bar .bill-metric')).map(m => ({
        label: m.querySelector('.bill-metric-label')?.textContent.trim(),
        val: m.querySelector('.bill-metric-val')?.textContent.trim()
      }));
      const grandTotal = card.querySelector('.order-total-amount')?.textContent.trim();
      return { typeBadge, orderId, metrics, grandTotal };
    });
  });
  console.log('Order History Bill Metrics for All Order Types:\n', JSON.stringify(ordersBillMetrics, null, 2));

  // Verify that all 3 orders show Delivery Fee ₹50
  for (const ord of ordersBillMetrics) {
    const feeMetric = ord.metrics.find(m => m.label === 'Delivery Fee');
    if (!feeMetric || feeMetric.val !== '₹50') {
      throw new Error(`Order ${ord.orderId} (${ord.typeBadge}) did not display Delivery Fee ₹50. Found: ${JSON.stringify(feeMetric)}`);
    }
  }

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'profile_orders_delivery_fee_all_types_verified.png') });

  await browser.close();
  console.log('ALL DELIVERY CHARGES VERIFICATIONS PASSED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
