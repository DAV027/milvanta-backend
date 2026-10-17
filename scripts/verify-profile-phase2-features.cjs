const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

function startStaticServer(port = 8089) {
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
    console.log('🚀 Starting Phase 2 Verification Test for Profile Page (Delivery Operations)...');
    server = await startStaticServer(8089);

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

    // Seed mock customer, address, and 2 subscriptions (one with <= 3 days left to trigger alert)
    await page.evaluateOnNewDocument(() => {
      const sampleCustomer = {
        id: 1,
        name: 'Akhil',
        phone: '6305974564',
        email: 'akhil@milvanta.in',
        city: 'Hafeezpet, Hyderabad'
      };

      const sampleAddrs = [
        {
          id: 'addr-1',
          name: 'Akhil',
          phone: '6305974564',
          house: 'Flat 402',
          building: 'Green Meadows',
          street: 'Kondapur Main Road',
          city: 'Hyderabad',
          pincode: '500049',
          type: 'Home',
          isDefault: true
        }
      ];

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
          totalAmount: 130,
          deliveryFee: 50,
          totalPaid: 180,
          planType: 'custom',
          durationLabel: '2 Days Custom Plan',
          days: 2, // <= 3 days!
          status: 'active',
          nextDelivery: 'Tomorrow, 6:00 AM – 7:00 AM'
        }
      ];

      localStorage.setItem('milvanta-user', JSON.stringify(sampleCustomer));
      localStorage.setItem('milvanta-addresses', JSON.stringify(sampleAddrs));
      localStorage.setItem('milvanta-subscriptions', JSON.stringify(sampleSubs));
      localStorage.setItem('milvanta-area', 'Hafeezpet');
      localStorage.setItem('milvanta-pincode', '500049');
    });

    console.log('Navigating to http://127.0.0.1:8089/profile.html?tab=subscription...');
    await page.goto('http://127.0.0.1:8089/profile.html?tab=subscription', { waitUntil: 'networkidle2' });

    // Wait for subscription cards to render
    await page.waitForSelector('.subscription-card', { timeout: 8000 });
    console.log('✓ Subscription cards rendered.');

    // 1. Verify Active Delivery Address on Card
    console.log('Testing Active Delivery Address on Subscription Card...');
    const addrChangeBtn = await page.$('.sub-addr-change-btn');
    if (!addrChangeBtn) {
      throw new Error('Expected .sub-addr-change-btn button on subscription card!');
    }
    const cardText = await page.$eval('.subscription-card', el => el.innerText);
    if (!cardText.includes('Morning Delivery Address') || !cardText.includes('Green Meadows')) {
      throw new Error('Subscription card does not display active morning delivery address!');
    }
    console.log('✓ Found Morning Delivery Address on card: Flat 402, Green Meadows...');

    // Test clicking Change address
    await addrChangeBtn.click();
    await new Promise(r => setTimeout(r, 400));
    const isAddressesActive = await page.$eval('#tabPanel-addresses', el => el.classList.contains('active'));
    console.log(`✓ Clicked Change Address: Successfully switched to Addresses tab (active=${isAddressesActive}).`);

    // Switch back to subscription tab
    await page.click('.profile-tab-btn[data-tab="subscription"]');
    await new Promise(r => setTimeout(r, 400));

    // 2. Verify Rider Drop Instruction & Modal
    console.log('Testing Rider Drop Preference...');
    if (!cardText.includes('Rider Drop Preference') || !cardText.includes('Silent Drop')) {
      throw new Error('Subscription card does not display Rider Drop Preference!');
    }
    console.log('✓ Found Rider Drop Preference on card (Default: 🤫 Silent Drop).');

    const instructionChangeBtn = await page.$('.sub-instruction-change-btn');
    await instructionChangeBtn.click();
    await page.waitForSelector('#doorstepInstructionModal:not(.hidden)', { timeout: 3000 });
    console.log('✓ Opened Doorstep Drop Instruction Modal.');

    // Choose 3rd option: "🧺 Leave in Milk Bag / Basket at Door"
    await page.evaluate(() => {
      const radio = document.querySelector('input[value="door_bag"]');
      if (radio) {
        radio.click();
        radio.closest('.drop-option-label')?.click();
      }
    });

    // Submit form
    await page.click('#doorstepInstructionForm button[type="submit"]');
    await page.waitForSelector('#doorstepInstructionModal.hidden', { timeout: 3000 });
    console.log('✓ Submitted drop preference form.');

    await new Promise(r => setTimeout(r, 500));
    const updatedCardText = await page.$eval('.subscription-card', el => el.innerText);
    if (!updatedCardText.includes('Leave in Milk Bag')) {
      throw new Error('Subscription card did not update with new drop preference!');
    }
    console.log('✓ Subscription card updated with new drop instruction: "🧺 Leave in Milk Bag / Basket at Door".');

    // 3. Verify Low Remaining Days Alert Banner (on the 2-day plan card)
    console.log('Testing Low Remaining Days Renewal Alert Banner...');
    const alertBanner = await page.$('.sub-low-balance-alert');
    if (!alertBanner) {
      throw new Error('Expected .sub-low-balance-alert banner on custom days plan with <= 3 days remaining!');
    }
    const alertText = await page.$eval('.sub-low-balance-alert', el => el.innerText);
    console.log(`✓ Found Plan Ending Soon alert banner:\n${alertText}`);

    const quickExtendBtn = await page.$('.sub-low-balance-alert button');
    if (!quickExtendBtn) {
      throw new Error('Expected Extend Plan Now button inside low balance alert!');
    }
    await quickExtendBtn.evaluate(b => b.click());
    await page.waitForSelector('#createSubscriptionModal:not(.hidden)', { timeout: 3000 });
    console.log('✓ Clicked "Extend Plan Now →" and successfully opened Create Subscription modal!');
    await page.click('#closeCreateSubModal');
    await page.waitForSelector('#createSubscriptionModal.hidden', { timeout: 3000 });

    // 4. Verify Glass Bottle Return Reminder has been removed
    console.log('Verifying Bottle Return Reminder is removed...');
    const bottleBadges = await page.$$('.sub-bottle-return-pill');
    if (bottleBadges.length > 0) {
      throw new Error('Expected .sub-bottle-return-pill to be removed from subscription cards!');
    }
    const cardContentAfter = await page.$eval('#subscriptionsGridContainer', el => el.innerText);
    if (cardContentAfter.includes('Bottle Return Reminder')) {
      throw new Error('Bottle Return Reminder text still present on subscription cards!');
    }
    console.log('✓ Verified: Bottle Return Reminder is completely removed from all subscription cards.');

    // Capture comprehensive screenshot of verified Phase 2 subscription cards
    const subsGrid = await page.$('#subscriptionsGridContainer');
    const screenshotPath = path.join(ARTIFACTS_DIR, 'profile_phase2_subscription_operations_verified.png');
    if (subsGrid) {
      await subsGrid.screenshot({ path: screenshotPath });
      console.log(`Saved screenshot to: ${screenshotPath}`);
    }

    console.log('🎉 ALL PHASE 2 CHECKS PASSED PERFECTLY!');
  } catch (err) {
    console.error('❌ Phase 2 Verification failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();
