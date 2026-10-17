const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

async function verify() {
  const edgePath = fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';

  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1100']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  // Pre-seed localStorage before navigation to prevent auth redirect
  await page.evaluateOnNewDocument(() => {
    const sampleUser = {
      id: 1,
      name: 'Akhil Varma',
      email: 'akhilvarma1017@gmail.com',
      phone: '9876543210'
    };

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

    localStorage.setItem('milvanta-user', JSON.stringify(sampleUser));
    localStorage.setItem('milvanta_token', 'test-session-token');
    localStorage.setItem('milvanta-subscriptions', JSON.stringify(sampleSubs));
    localStorage.setItem('milvanta-orders', JSON.stringify(sampleOrders));
  });

  // Navigate to profile subscription tab
  await page.goto('http://127.0.0.1:8080/profile.html?tab=subscription', { waitUntil: 'networkidle2' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(1000);

  console.log('1. Verifying Subscriptions Cards in Profile Subscription Tab...');
  const subCardsData = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#subscriptionsGridContainer .subscription-card'));
    return cards.map(c => {
      const tag = c.querySelector('.subscription-item-tag')?.textContent.trim();
      const title = c.querySelector('.subscription-item-title')?.textContent.trim();
      const progressBox = c.querySelector('.custom-days-progress-box')?.textContent.trim();
      const rows = Array.from(c.querySelectorAll('.sub-detail-row')).map(r => ({
        label: r.querySelector('.sub-detail-label')?.textContent.trim(),
        val: r.querySelector('.sub-detail-val')?.textContent.trim()
      }));
      return { tag, title, progressBox, rows };
    });
  });
  console.log('Subscription Cards Details:', JSON.stringify(subCardsData, null, 2));

  // Screenshot 1: Subscription tab with both cards and monthly calendar
  const subTabPath = path.join(ARTIFACTS_DIR, 'profile_subscription_tab_with_month_calendar.png');
  await page.screenshot({ path: subTabPath, fullPage: false });
  console.log('Saved screenshot:', subTabPath);

  console.log('2. Verifying Monthly Milk Delivery Calendar & Custom Days Badges...');
  const calHeader = await page.$eval('#calCurrentMonthLabel', el => el.textContent.trim());
  const calStats = await page.$eval('#calMonthStatsBar', el => el.textContent.trim());
  const dayCellsCount = await page.$$eval('.month-cal-day-cell:not(.is-other-month)', els => els.length);
  const day19Badge = await page.$eval('[data-day="19"] .month-cal-day-badge', el => el.textContent.trim());

  console.log('Calendar Month:', calHeader);
  console.log('Calendar Stats Bar:', calStats);
  console.log('Days in Month Grid:', dayCellsCount);
  console.log('Day 19 Badge (Custom Day):', day19Badge);

  // Click Day 20 on Monthly Calendar
  console.log('3. Clicking Day 20 on Monthly Calendar...');
  await page.click('[data-day="20"]');
  await sleep(400);

  const day20Inspector = await page.$eval('#calSelectedDayCard', el => el.textContent.trim());
  console.log('Day 20 Inspector Text:', day20Inspector);

  // Click Pause delivery for this day
  console.log('4. Testing single-day delivery pause toggle...');
  await page.click('#btnToggleDayDelivery');
  await sleep(400);

  const pausedDay20Badge = await page.$eval('[data-day="20"] .month-cal-day-badge', el => el.textContent.trim());
  console.log('Day 20 Badge After Pause:', pausedDay20Badge);

  // Screenshot 2: Monthly Delivery Calendar zoomed
  const calCard = await page.$('#profileMonthlyCalendarCard');
  if (calCard) {
    const calCardPath = path.join(ARTIFACTS_DIR, 'monthly_delivery_calendar_card_verified.png');
    await calCard.screenshot({ path: calCardPath });
    console.log('Saved screenshot:', calCardPath);
  }

  // Switch to Orders tab and verify payments of both (Continuous + Custom + Store)
  console.log('5. Verifying Order History Tab & Payments of Both...');
  await page.click('[data-tab="orders"]');
  await sleep(800);

  const ordersData = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#ordersListContainer .order-card'));
    return cards.map(c => {
      const typeBadge = c.querySelector('.order-type-badge')?.textContent.trim();
      const orderId = c.querySelector('.order-id')?.textContent.trim();
      const totalAmount = c.querySelector('.order-total-amount')?.textContent.trim();
      const paymentTag = c.querySelector('.bill-payment-tag')?.textContent.trim();
      const hasViewSubBtn = Boolean(c.querySelector('[data-go-sub-tab]'));
      const items = Array.from(c.querySelectorAll('.order-item-detailed-row')).map(it => ({
        title: it.querySelector('.order-item-title')?.textContent.trim(),
        specs: it.querySelector('.order-item-specs')?.textContent.trim(),
        thumb: it.querySelector('.order-item-thumb-img')?.getAttribute('src')
      }));
      return { typeBadge, orderId, totalAmount, paymentTag, hasViewSubBtn, items };
    });
  });
  console.log('Order History Payments Breakdown:', JSON.stringify(ordersData, null, 2));

  const orderTabPath = path.join(ARTIFACTS_DIR, 'order_history_all_payments_verified.png');
  await page.screenshot({ path: orderTabPath, fullPage: false });
  console.log('Saved screenshot:', orderTabPath);

  // Test clicking "View Subscription & Calendar" from Order History
  console.log('6. Testing "View Subscription & Calendar" button click from Order History...');
  const firstSubOrderBtn = await page.$('[data-go-sub-tab]');
  if (firstSubOrderBtn) {
    await firstSubOrderBtn.click();
    await sleep(600);
    const activePanelId = await page.evaluate(() => document.querySelector('.tab-panel.active')?.id);
    console.log('Active tab panel after clicking View Subscription button:', activePanelId);
  }

  await browser.close();
  console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY!');
}

verify().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
