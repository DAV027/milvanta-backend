const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ARTIFACT_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

function startStaticServer(port = 8112) {
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
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const filePath = path.join(__dirname, '../frontend', reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[Static Server] Running on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

(async () => {
  let server;
  let browser;

  try {
    server = await startStaticServer(8112);

    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,960']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 960 });

    // Seed mock user so profile.html doesn't redirect
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('milvanta-user', JSON.stringify({
        id: 1,
        name: 'Akhil',
        phone: '6305974564',
        email: 'akhil@milvanta.in',
        city: 'Hafeezpet, Hyderabad'
      }));
      localStorage.setItem('milvanta-token', 'mock-token-12345');
    });

    console.log('1. Testing Storefront Daily Subscription Pack Size Dropdown...');
    await page.goto('http://127.0.0.1:8112/index.html', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));

    // Open Cow Milk modal
    await page.evaluate(() => {
      const cowMilkCard = document.querySelector('.product-card[data-id="101"]') || document.querySelector('.product-card[data-id="1"]');
      if (cowMilkCard) {
        cowMilkCard.click();
      } else if (window.openProductModal) {
        window.openProductModal(101);
      }
    });
    await new Promise(r => setTimeout(r, 600));

    // Switch to Daily Subscription mode
    await page.evaluate(() => {
      const subTab = document.querySelector('[data-mode="subscription"]');
      if (subTab) subTab.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Verify Dropdown and Custom Days removal in modal
    const resultModal = await page.evaluate(() => {
      const select = document.getElementById('subPackSizeSelect');
      const dropdownWrap = document.getElementById('subPackSizeDropdownWrap');
      const customControls = document.getElementById('subCustomControls');
      const customTab = document.getElementById('subTabCustom');
      const dailyPrice = document.getElementById('subSummaryRate')?.textContent?.trim() || document.getElementById('modalPrice')?.textContent?.trim();
      const summaryTotal = document.getElementById('subFinalPrice')?.textContent?.trim();

      const options = select ? Array.from(select.options).map(o => ({
        value: o.value,
        label: o.text
      })) : [];

      return {
        hasSelect: Boolean(select),
        isSelectVisible: dropdownWrap && !dropdownWrap.classList.contains('hidden'),
        optionsCount: options.length,
        options,
        hasCustomControls: Boolean(customControls),
        hasCustomTab: Boolean(customTab),
        dailyPrice,
        summaryTotal
      };
    });

    console.log('Modal Pack Size Select found:', resultModal.hasSelect);
    console.log('Options count:', resultModal.optionsCount);
    console.log('Options list:', resultModal.options.map(o => o.label).join(' | '));
    console.log('Custom controls present:', resultModal.hasCustomControls, 'Custom tab present:', resultModal.hasCustomTab);
    console.log('Initial Daily Price for 500 ml:', resultModal.dailyPrice, '| Summary Total:', resultModal.summaryTotal);

    if (resultModal.optionsCount !== 10) {
      throw new Error(`Expected 10 pack size options, but found ${resultModal.optionsCount}`);
    }
    if (resultModal.hasCustomControls || resultModal.hasCustomTab) {
      throw new Error('Custom days controls/tab should be completely removed from DOM!');
    }

    // Select 1.5 Litre (value = '1.5 Litre')
    await page.evaluate(() => {
      const sel = document.getElementById('subPackSizeSelect');
      sel.value = '1.5 Litre';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const price15 = await page.evaluate(() => {
      return {
        dailyRate: document.getElementById('subSummaryRate')?.textContent?.trim(),
        modalPrice: document.getElementById('modalPrice')?.textContent?.trim(),
        summaryTotal: document.getElementById('subFinalPrice')?.textContent?.trim(),
        periodDays: document.getElementById('subPeriodDaysBadge')?.textContent?.trim()
      };
    });
    console.log('Selected 1.5 Litre -> Daily Rate:', price15.dailyRate, '| Header Price:', price15.modalPrice, '| Total:', price15.summaryTotal);

    // Select 5 Litre (value = '5 Litre')
    await page.evaluate(() => {
      const sel = document.getElementById('subPackSizeSelect');
      sel.value = '5 Litre';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const price5 = await page.evaluate(() => {
      return {
        dailyRate: document.getElementById('subSummaryRate')?.textContent?.trim(),
        modalPrice: document.getElementById('modalPrice')?.textContent?.trim(),
        summaryTotal: document.getElementById('subFinalPrice')?.textContent?.trim(),
        periodDays: document.getElementById('subPeriodDaysBadge')?.textContent?.trim()
      };
    });
    console.log('Selected 5 Litre -> Daily Rate:', price5.dailyRate, '| Header Price:', price5.modalPrice, '| Total:', price5.summaryTotal);

    // Re-select 1.5 Litre for screenshot
    await page.evaluate(() => {
      const sel = document.getElementById('subPackSizeSelect');
      sel.value = '1.5 Litre';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const screenshotPath1 = path.join(ARTIFACT_DIR, 'daily_subscription_pack_size_dropdown.png');
    await page.screenshot({ path: screenshotPath1 });
    console.log('Saved storefront subscription screenshot:', screenshotPath1);

    // Add 1.5 Litre subscription to cart
    await page.evaluate(() => {
      document.getElementById('modalAddToCart')?.click();
    });
    await new Promise(r => setTimeout(r, 600));

    const cartCheck = await page.evaluate(() => {
      const items = document.querySelectorAll('.cart-item');
      return Array.from(items).map(item => ({
        title: item.querySelector('h4')?.textContent?.trim(),
        size: item.querySelector('p')?.textContent?.trim(),
        badge: item.querySelector('.cart-details span')?.textContent?.trim()
      }));
    });
    console.log('Cart Items after adding 1.5L subscription:', JSON.stringify(cartCheck, null, 2));

    console.log('\n2. Testing Profile Start Subscription Modal Pack Size Dropdown...');
    await page.goto('http://127.0.0.1:8112/profile.html', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));

    // Switch to subscriptions tab
    await page.evaluate(() => {
      const subTabBtn = document.querySelector('[data-tab="subscriptions"]');
      if (subTabBtn) subTabBtn.click();
    });
    await new Promise(r => setTimeout(r, 400));

    // Click "+ Subscribe Product" button
    await page.evaluate(() => {
      const btn = document.getElementById('btnOpenCreateSubModal');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const profileModalCheck = await page.evaluate(() => {
      const modal = document.getElementById('createSubscriptionModal');
      const select = document.getElementById('profileSubPackSizeSelect');
      const customWrap = document.getElementById('profileSubCustomWrap');
      const customTab = document.getElementById('profileSubTabCustom');

      const options = select ? Array.from(select.options).map(o => o.text) : [];

      return {
        modalOpen: modal && !modal.classList.contains('hidden'),
        hasSelect: Boolean(select),
        optionsCount: options.length,
        options,
        hasCustomWrap: Boolean(customWrap),
        hasCustomTab: Boolean(customTab),
        dailyRate: document.getElementById('profileSubSummaryRateText')?.textContent?.trim(),
        totalAmount: document.getElementById('profileSubFinalTotal')?.textContent?.trim()
      };
    });

    console.log('Profile Modal Open:', profileModalCheck.modalOpen);
    console.log('Profile Select options count:', profileModalCheck.optionsCount);
    console.log('Profile Select options:', profileModalCheck.options.join(' | '));
    console.log('Profile Custom wrap:', profileModalCheck.hasCustomWrap, 'Custom tab:', profileModalCheck.hasCustomTab);
    console.log('Profile Initial Daily Rate:', profileModalCheck.dailyRate, '| Total Amount:', profileModalCheck.totalAmount);

    if (profileModalCheck.optionsCount !== 10) {
      throw new Error(`Profile modal expected 10 pack sizes, got ${profileModalCheck.optionsCount}`);
    }
    if (profileModalCheck.hasCustomWrap || profileModalCheck.hasCustomTab) {
      throw new Error('Profile custom days controls should be absent!');
    }

    // Select 2 Litre in profile modal
    await page.evaluate(() => {
      const sel = document.getElementById('profileSubPackSizeSelect');
      sel.value = '2 Litre';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const profileRate2L = await page.evaluate(() => {
      return {
        dailyRate: document.getElementById('profileSubSummaryRateText')?.textContent?.trim(),
        totalAmount: document.getElementById('profileSubFinalTotal')?.textContent?.trim()
      };
    });
    console.log('Profile After selecting 2 Litre: Daily Rate =', profileRate2L.dailyRate, '| Total =', profileRate2L.totalAmount);

    // Switch to Buffalo Milk
    await page.evaluate(() => {
      const buffaloCard = document.querySelector('#profileSubMilkTypeGroup [data-milk="buffalo"]');
      if (buffaloCard) buffaloCard.click();
    });
    await new Promise(r => setTimeout(r, 400));

    const profileRateBuffalo2L = await page.evaluate(() => {
      return {
        dailyRate: document.getElementById('profileSubSummaryRateText')?.textContent?.trim(),
        totalAmount: document.getElementById('profileSubFinalTotal')?.textContent?.trim()
      };
    });
    console.log('Profile Buffalo Milk 2 Litre: Daily Rate =', profileRateBuffalo2L.dailyRate, '| Total =', profileRateBuffalo2L.totalAmount);

    const screenshotPath2 = path.join(ARTIFACT_DIR, 'profile_subscription_pack_size_dropdown.png');
    await page.screenshot({ path: screenshotPath2 });
    console.log('Saved profile subscription screenshot:', screenshotPath2);

    console.log('\n>>> ALL SUBSCRIPTION PACK SIZE DROPDOWN & CUSTOM DAYS REMOVAL TESTS PASSED! <<<');
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();
