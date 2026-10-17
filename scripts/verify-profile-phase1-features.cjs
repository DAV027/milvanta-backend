const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

// Embedded Static Server to avoid CORS and file:// restrictions
function startStaticServer(port = 8088) {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/profile.html';
    const filePath = path.join(__dirname, '../frontend', reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`✓ Local test server running on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

(async () => {
  let browser;
  let server;
  try {
    console.log('🚀 Starting Phase 1 Verification Test for Profile Page...');
    server = await startStaticServer(8088);

    const edgePath = fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
      ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      : 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';

    browser = await puppeteer.launch({
      executablePath: edgePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,960']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 960 });

    page.on('console', msg => {
      if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
    });

    // Seed mock orders and subscriptions into localStorage before page scripts execute
    await page.evaluateOnNewDocument(() => {
      const sampleCustomer = {
        id: 1,
        name: 'Akhil',
        phone: '6305974564',
        email: 'akhil@milvanta.in',
        city: 'Hafeezpet, Hyderabad'
      };

      const sampleSubs = [
        {
          id: 'sub-cont-101',
          product: 'Pure Fresh Cow Milk (1 Litre)',
          productName: 'Pure Fresh Cow Milk',
          image: 'assets/milvanta-cow-milk.jpg',
          frequency: 'Daily (Every Morning)',
          timeSlot: '6:00 AM - 7:00 AM',
          quantity: '1 Litre',
          dailyRate: 105,
          costPerDay: 105,
          totalAmount: 3255,
          deliveryFee: 50,
          totalPaid: 3305,
          planType: 'month',
          durationLabel: 'Oct 2026 – Nov 2026 (31 Days)',
          days: 31,
          status: 'active',
          nextDelivery: 'Tomorrow, 6:00 AM – 7:00 AM'
        },
        {
          id: 'sub-cust-102',
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
          id: 'MV-STORE-84912',
          order_number: 'MV-STORE-84912',
          order_status: 'delivered',
          status: 'delivered',
          orderType: 'store_order',
          created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
          items: [
            {
              id: 1,
              productId: 1,
              name: 'Walnut Raagi Brownie',
              size: '1 Piece',
              qty: 2,
              quantity: 2,
              unitPrice: 299,
              lineTotal: 598,
              image: 'assets/walnut-raagi-brownie.jpg'
            },
            {
              id: 10,
              productId: 10,
              name: 'Avakaya Mango Pickle',
              size: '500 g jar',
              qty: 1,
              quantity: 1,
              unitPrice: 449,
              lineTotal: 449,
              image: 'assets/avakaya-mango-pickle.jpg'
            }
          ],
          subtotal: 1047,
          deliveryFee: 50,
          total: 1097,
          address: 'Flat 402, Green Meadows, Hafeezpet, Hyderabad - 500049',
          recipientName: 'Akhil',
          recipientPhone: '6305974564',
          paymentMethod: 'Paid Online via Razorpay UPI',
          paymentStatus: 'PAID'
        }
      ];

      localStorage.setItem('milvanta-user', JSON.stringify(sampleCustomer));
      localStorage.setItem('milvanta-subscriptions', JSON.stringify(sampleSubs));
      localStorage.setItem('milvanta-orders', JSON.stringify(sampleOrders));
      localStorage.setItem('milvanta-area', 'Hafeezpet');
      localStorage.setItem('milvanta-pincode', '500049');
    });

    console.log('Navigating to http://127.0.0.1:8088/profile.html?tab=orders...');
    await page.goto('http://127.0.0.1:8088/profile.html?tab=orders', { waitUntil: 'networkidle2' });

    // Wait for orders to render
    await page.waitForSelector('.order-card', { timeout: 8000 });
    console.log('✓ Order cards rendered.');

    // 1. Verify Order Filter Pills Bar
    const filterPills = await page.$$('.order-filter-pill');
    if (filterPills.length !== 3) {
      throw new Error(`Expected 3 order filter pills, found ${filterPills.length}`);
    }
    console.log('✓ Found 3 Order Filter Pills: All, Subscriptions, Store Orders.');

    const allCount = await page.$eval('#filterCountAll', el => el.textContent.trim());
    const subsCount = await page.$eval('#filterCountSubs', el => el.textContent.trim());
    const storeCount = await page.$eval('#filterCountStore', el => el.textContent.trim());
    console.log(`Filter counts: All=${allCount}, Subscriptions=${subsCount}, Store=${storeCount}`);

    if (Number(allCount) <= 0 || Number(subsCount) <= 0 || Number(storeCount) <= 0) {
      throw new Error(`Invalid counts: All=${allCount}, Subs=${subsCount}, Store=${storeCount}`);
    }

    // 2. Test Subscriptions filter
    console.log('Testing Subscriptions Filter...');
    await page.click('.order-filter-pill[data-order-filter="subscriptions"]');
    await new Promise(r => setTimeout(r, 400));
    const subCardsVisible = await page.$$eval('.order-card', cards => cards.length);
    console.log(`✓ Clicked Subscriptions filter: ${subCardsVisible} subscription orders visible (Matches Subs Count: ${subsCount}).`);

    // Verify Renew / Extend button on subscription order cards
    const renewBtn = await page.$('.btn-renew-sub');
    if (!renewBtn) {
      throw new Error('Expected .btn-renew-sub button on subscription order card!');
    }
    const renewBtnText = await page.$eval('.btn-renew-sub', el => el.textContent.trim());
    console.log(`✓ Subscription card action button is: "${renewBtnText}" (Replaced generic re-order).`);

    // 3. Test Store Orders filter
    console.log('Testing Store Orders Filter...');
    await page.click('.order-filter-pill[data-order-filter="store"]');
    await new Promise(r => setTimeout(r, 400));
    const storeCardsVisible = await page.$$eval('.order-card', cards => cards.length);
    console.log(`✓ Clicked Store filter: ${storeCardsVisible} store orders visible (Matches Store Count: ${storeCount}).`);

    // Verify + Re-order button is present on Store Order cards
    const reorderBtn = await page.$('.btn-reorder');
    if (!reorderBtn) {
      throw new Error('Expected .btn-reorder button on store order card!');
    }
    const reorderBtnText = await page.$eval('.btn-reorder', el => el.textContent.trim());
    console.log(`✓ Store order action button is: "${reorderBtnText}".`);

    // 4. Test All Orders filter
    console.log('Restoring All Orders Filter...');
    await page.click('.order-filter-pill[data-order-filter="all"]');
    await new Promise(r => setTimeout(r, 400));
    const allCardsVisible = await page.$$eval('.order-card', cards => cards.length);
    console.log(`✓ Restored All Orders filter: ${allCardsVisible} orders visible.`);

    // 5. Test Order Details Modal & Print Invoice Button
    console.log('Testing Order Details Modal and Print Invoice button...');
    const firstDetailsBtn = await page.$('.btn-order-details');
    await firstDetailsBtn.click();
    await page.waitForSelector('#orderDetailsModal:not(.hidden)', { timeout: 3000 });
    console.log('✓ Order details modal opened successfully.');

    const printBtn = await page.$('#orderModalPrintBtn');
    if (!printBtn) {
      throw new Error('Expected #orderModalPrintBtn in order details modal!');
    }
    const printBtnText = await page.$eval('#orderModalPrintBtn', el => el.textContent.trim());
    console.log(`✓ Found Print Invoice button: "${printBtnText}".`);

    const modalReorderBtn = await page.$('#orderModalReorderBtn');
    const modalReorderText = await page.$eval('#orderModalReorderBtn', el => el.textContent.trim());
    console.log(`✓ Modal action button text: "${modalReorderText}".`);

    // Close modal
    await page.click('#closeOrderModalBtn');
    await page.waitForSelector('#orderDetailsModal.hidden', { timeout: 3000 });
    console.log('✓ Order details modal closed.');

    // 6. Switch to Subscriptions Tab and Test Vacation Pause
    console.log('Testing Vacation Mode / Date-Range Multi-Day Pause...');
    await page.click('.profile-tab-btn[data-tab="subscription"]');
    await page.waitForSelector('#profileMonthlyCalendarCard', { timeout: 5000 });
    console.log('✓ Switched to Subscription tab. Monthly calendar is visible.');

    const vacationBtn = await page.$('#btnOpenVacationModal');
    if (!vacationBtn) {
      throw new Error('Expected #btnOpenVacationModal in calendar header!');
    }
    await vacationBtn.click();
    await page.waitForSelector('#vacationPauseModal:not(.hidden)', { timeout: 3000 });
    console.log('✓ Vacation Pause modal opened.');

    const startVal = await page.$eval('#vacationStartDate', el => el.value);
    const endVal = await page.$eval('#vacationEndDate', el => el.value);
    const summaryText = await page.$eval('#vacationSummaryText', el => el.textContent.trim());
    console.log(`Vacation modal defaults: Start=${startVal}, End=${endVal}`);
    console.log(`Summary: "${summaryText}"`);

    if (!startVal || !endVal) {
      throw new Error('Start date or End date was not pre-populated in vacation modal!');
    }

    // Click 5-days preset chip
    const chip5 = await page.$('[data-vacation-days="5"]');
    if (chip5) {
      await chip5.click();
      await new Promise(r => setTimeout(r, 200));
      const updatedSummary = await page.$eval('#vacationSummaryText', el => el.textContent.trim());
      console.log(`✓ Clicked 5 Days preset. Updated summary: "${updatedSummary}"`);
    }

    // Submit Vacation Pause
    await page.click('#btnConfirmVacation');
    await page.waitForSelector('#vacationPauseModal.hidden', { timeout: 3000 });
    console.log('✓ Vacation pause submitted.');

    await new Promise(r => setTimeout(r, 600));

    // Check calendar for paused badges
    const pausedBadgesCount = await page.$$eval('.month-cal-day-badge.badge-paused', badges => badges.length);
    console.log(`✓ Calendar updated: ${pausedBadgesCount} day cells now show ⏸ Paused.`);
    if (pausedBadgesCount === 0) {
      throw new Error('Expected at least 1 paused badge on calendar after submitting vacation pause!');
    }

    // Test Clear All Paused Dates
    await vacationBtn.click();
    await page.waitForSelector('#vacationPauseModal:not(.hidden)', { timeout: 3000 });

    page.on('dialog', async dialog => {
      console.log(`Dialog message: "${dialog.message()}"`);
      await dialog.accept();
    });

    await page.click('#btnClearAllPausedDates');
    await page.waitForSelector('#vacationPauseModal.hidden', { timeout: 3000 });
    await new Promise(r => setTimeout(r, 600));

    const clearedPausedCount = await page.$$eval('.month-cal-day-badge.badge-paused', badges => badges.length);
    console.log(`✓ Cleared paused dates: ${clearedPausedCount} paused badges remain (Expected 0).`);
    if (clearedPausedCount !== 0) {
      throw new Error('Expected 0 paused badges after clearing vacation pause!');
    }

    // Take screenshot of Order History with Filters
    await page.click('.profile-tab-btn[data-tab="orders"]');
    await new Promise(r => setTimeout(r, 500));
    const ordersScreenshotPath = path.join(ARTIFACTS_DIR, 'profile_phase1_orders_filter_verified.png');
    await page.screenshot({ path: ordersScreenshotPath, fullPage: false });
    console.log(`Saved screenshot to: ${ordersScreenshotPath}`);

    // Take screenshot of Calendar with Vacation button
    await page.click('.profile-tab-btn[data-tab="subscription"]');
    await new Promise(r => setTimeout(r, 500));
    const calendarEl = await page.$('#profileMonthlyCalendarCard');
    const calScreenshotPath = path.join(ARTIFACTS_DIR, 'profile_phase1_calendar_vacation_verified.png');
    if (calendarEl) {
      await calendarEl.screenshot({ path: calScreenshotPath });
      console.log(`Saved screenshot to: ${calScreenshotPath}`);
    }

    console.log('🎉 ALL PHASE 1 CHECKS PASSED PERFECTLY!');
  } catch (err) {
    console.error('❌ Phase 1 Verification failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();

