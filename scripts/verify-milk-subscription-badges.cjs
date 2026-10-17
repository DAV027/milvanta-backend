const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

function startStaticServer(port = 8098) {
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

async function run() {
  let server;
  let browser;

  try {
    server = await startStaticServer(8098);

    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,960']
    });

    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));
    await page.setViewport({ width: 1280, height: 960 });

    console.log('Loading page at http://127.0.0.1:8098/ ...');
    await page.goto('http://127.0.0.1:8098/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // 1. Check Category Card badge
    const catBadgeInfo = await page.evaluate(() => {
      const catCards = Array.from(document.querySelectorAll('.category-card'));
      console.log('Category cards found:', catCards.length, catCards.map(c => c.textContent.trim().replace(/\s+/g, ' ')));
      const milkCat = catCards.find(c => c.textContent.includes('Milk'));
      if (!milkCat) return { error: 'No Milk category found among: ' + catCards.map(c => c.textContent.trim()).join(', ') };
      const badge = milkCat.querySelector('.category-card-badge');
      return {
        cardText: milkCat.innerText.trim(),
        badgeText: badge ? badge.innerText.trim() : null,
        badgeFound: !!badge
      };
    });

    console.log('Category Badge verification:', catBadgeInfo);
    if (!catBadgeInfo || !catBadgeInfo.badgeFound || catBadgeInfo.badgeText !== 'Subscription Available') {
      throw new Error(`Category badge verification failed: ${JSON.stringify(catBadgeInfo)}`);
    }

    // Scroll to Category Row and screenshot
    const catRow = await page.$('.category-strip');
    if (catRow) {
      await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), catRow);
      await new Promise(r => setTimeout(r, 500));
      const catScreenshotPath = path.join(ARTIFACTS_DIR, 'category_milk_subscription_badge.png');
      await catRow.screenshot({ path: catScreenshotPath });
      console.log('Saved category badge screenshot:', catScreenshotPath);
    }

    // Click the Pure Fresh Milk category card to load milk products
    console.log('Clicking Pure Fresh Milk category card...');
    await page.evaluate(() => {
      const catCards = Array.from(document.querySelectorAll('.category-card'));
      const milkCat = catCards.find(c => c.textContent.includes('Milk'));
      if (milkCat) milkCat.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    // 2. Check Product Badges for Cow Milk and Buffalo Milk in Fresh Milk category
    const productBadgesInfo = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.product-card'));
      const results = [];
      cards.forEach(card => {
        const nameEl = card.querySelector('.product-name');
        const name = nameEl ? nameEl.innerText.trim() : '';
        const badgeEl = card.querySelector('.product-card-badge');
        results.push({
          name,
          badgeText: badgeEl ? badgeEl.innerText.trim() : null,
          isSubBadge: badgeEl ? badgeEl.classList.contains('sub-badge') : false
        });
      });
      return results;
    });

    console.log('Product Badges verification:', productBadgesInfo);
    const cowMilk = productBadgesInfo.find(p => p.name.toLowerCase().includes('cow'));
    const buffaloMilk = productBadgesInfo.find(p => p.name.toLowerCase().includes('buffalo'));

    if (!cowMilk || cowMilk.badgeText !== 'Subscription Available' || !cowMilk.isSubBadge) {
      throw new Error(`Cow milk badge verification failed: ${JSON.stringify(cowMilk)}`);
    }
    if (!buffaloMilk || buffaloMilk.badgeText !== 'Subscription Available' || !buffaloMilk.isSubBadge) {
      throw new Error(`Buffalo milk badge verification failed: ${JSON.stringify(buffaloMilk)}`);
    }

    // Scroll to Product Catalog section and capture screenshot
    const productsSec = await page.$('#products');
    if (productsSec) {
      await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), productsSec);
      await new Promise(r => setTimeout(r, 800));
      const prodScreenshotPath = path.join(ARTIFACTS_DIR, 'product_milk_subscription_badges.png');
      await page.screenshot({ path: prodScreenshotPath });
      console.log('Saved product badges screenshot:', prodScreenshotPath);
    }

    // 3. Test Mobile Viewport
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await new Promise(r => setTimeout(r, 800));
    const mobileCatRow = await page.$('.category-strip');
    if (mobileCatRow) {
      await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), mobileCatRow);
      await new Promise(r => setTimeout(r, 500));
      const mobileScreenshotPath = path.join(ARTIFACTS_DIR, 'mobile_milk_subscription_badges.png');
      await page.screenshot({ path: mobileScreenshotPath });
      console.log('Saved mobile screenshot:', mobileScreenshotPath);
    }

    console.log('ALL SUBSCRIPTION BADGE VERIFICATIONS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
}

run();
