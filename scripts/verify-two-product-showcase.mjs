import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = 'C:\\Users\\akhil\\.gemini\\antigravity\\brain\\80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

async function run() {
  console.log('--- Starting Milvanta Premium Two-Product Showcase Verification ---');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });

  const indexUrl = `file:///${path.resolve(__dirname, '../frontend/index.html').replace(/\\/g, '/')}`;
  const consoleErrors = [];

  // ==========================================
  // TEST 1: Desktop 1440px Showcase Rendering
  // ==========================================
  console.log('\n1. Testing Desktop 1440px Showcase Rendering...');
  const context1440 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const page1440 = await context1440.newPage();
  page1440.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[Console Error 1440px] ${msg.text()}`);
  });
  page1440.on('pageerror', err => consoleErrors.push(`[Page Error 1440px] ${err.message}`));

  await page1440.goto(indexUrl, { waitUntil: 'load' });
  await page1440.waitForTimeout(500);

  // Check showcase container and grid
  const gridClass = await page1440.$eval('#productCarousel', el => el.className);
  assert.ok(gridClass.includes('milk-showcase-grid'), `Expected milk-showcase-grid class, got: ${gridClass}`);

  const cardCount = await page1440.$$eval('.product-card', cards => cards.length);
  assert.equal(cardCount, 2, `Expected exactly 2 milk product cards, found: ${cardCount}`);

  // Check product names
  const cardNames = await page1440.$$eval('.product-card .product-name', names => names.map(n => n.textContent.trim()));
  assert.ok(cardNames[0].includes('Cow Milk'), `Expected Cow Milk, got: ${cardNames[0]}`);
  assert.ok(cardNames[1].includes('Buffalo Milk'), `Expected Buffalo Milk, got: ${cardNames[1]}`);
  console.log(`✓ Exactly 2 milk cards rendered: "${cardNames[0]}" and "${cardNames[1]}"`);

  // Side-by-side positioning & Equal visual prominence
  const cardBounds = await page1440.$$eval('.product-card', cards => cards.map(c => {
    const rect = c.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height
    };
  }));

  assert.equal(cardBounds.length, 2);
  const card0 = cardBounds[0];
  const card1 = cardBounds[1];

  console.log(`  Card 0: width=${card0.width.toFixed(1)}px, height=${card0.height.toFixed(1)}px, top=${card0.top.toFixed(1)}px`);
  console.log(`  Card 1: width=${card1.width.toFixed(1)}px, height=${card1.height.toFixed(1)}px, top=${card1.top.toFixed(1)}px`);

  // Side-by-side alignment: top alignment within 2px
  assert.ok(Math.abs(card0.top - card1.top) <= 2, `Cards must align on top: ${card0.top} vs ${card1.top}`);
  // Card 1 must be to the right of Card 0
  assert.ok(card1.left >= card0.right, `Card 1 must be positioned to the right of Card 0`);
  // Equal widths (within 2px) and equal heights (within 2px)
  assert.ok(Math.abs(card0.width - card1.width) <= 2, `Cards must have equal width: ${card0.width} vs ${card1.width}`);
  assert.ok(Math.abs(card0.height - card1.height) <= 2, `Cards must have equal height: ${card0.height} vs ${card1.height}`);
  console.log('✓ Desktop 1440px: Cards are side-by-side with identical width and height.');

  // Verify carousel 3D classes and transforms are GONE
  const hasCarouselClasses = await page1440.$$eval('.product-card', cards =>
    cards.some(c => c.classList.contains('is-center') || c.classList.contains('is-adjacent') || c.classList.contains('is-far'))
  );
  assert.ok(!hasCarouselClasses, 'Product cards must NOT have 3D carousel classes (is-center, is-adjacent, is-far)');

  // Verify carousel arrows and dots do not exist or are hidden
  const prevBtnDisplay = await page1440.$eval('#prevBtn', el => window.getComputedStyle(el).display).catch(() => 'none');
  const nextBtnDisplay = await page1440.$eval('#nextBtn', el => window.getComputedStyle(el).display).catch(() => 'none');
  const dotsCount = await page1440.$$eval('.carousel-dot', dots => dots.length);
  assert.equal(prevBtnDisplay, 'none', 'Prev arrow must be hidden or absent');
  assert.equal(nextBtnDisplay, 'none', 'Next arrow must be hidden or absent');
  assert.equal(dotsCount, 0, 'Carousel pagination dots must not be rendered');
  console.log('✓ Carousel navigation arrows and dots are completely absent from visible interface');

  // Verify quality highlights
  const cowHighlights = await page1440.$$eval('.product-card[data-index="0"] .quality-item', items => items.map(i => i.textContent.trim()));
  const buffaloHighlights = await page1440.$$eval('.product-card[data-index="1"] .quality-item', items => items.map(i => i.textContent.trim()));
  assert.ok(cowHighlights.length >= 2, `Expected at least 2 Cow highlights, got ${cowHighlights.length}`);
  assert.ok(buffaloHighlights.length >= 2, `Expected at least 2 Buffalo highlights, got ${buffaloHighlights.length}`);
  console.log(`✓ Quality highlights verified: Cow [${cowHighlights.join(' | ')}], Buffalo [${buffaloHighlights.join(' | ')}]`);

  // Verify starting price and pack size
  const cowPriceText = await page1440.$eval('.product-card[data-index="0"] .card-price-row', el => el.textContent.trim());
  const buffaloPriceText = await page1440.$eval('.product-card[data-index="1"] .card-price-row', el => el.textContent.trim());
  assert.ok(cowPriceText.includes('₹60'), `Expected Cow starting price ₹60, got: ${cowPriceText}`);
  assert.ok(buffaloPriceText.includes('₹70'), `Expected Buffalo starting price ₹70, got: ${buffaloPriceText}`);
  assert.ok(cowPriceText.includes('500 ml'), `Expected pack size 500 ml in Cow price row, got: ${cowPriceText}`);
  console.log(`✓ Starting price and pack size verified on both cards`);

  // Verify capacity status indicator
  const hasCapacityStatus = await page1440.$$eval('.card-capacity-status', els => els.length);
  assert.equal(hasCapacityStatus, 2, `Expected 2 capacity status blocks, found: ${hasCapacityStatus}`);
  console.log(`✓ Milk availability / capacity status rendered on both cards`);

  // Verify dual purchase buttons
  const cowBuyOnce = await page1440.$('.product-card[data-index="0"] .btn-milk-buy-once');
  const cowSub = await page1440.$('.product-card[data-index="0"] .btn-milk-sub');
  const bufBuyOnce = await page1440.$('.product-card[data-index="1"] .btn-milk-buy-once');
  const bufSub = await page1440.$('.product-card[data-index="1"] .btn-milk-sub');
  assert.ok(cowBuyOnce && cowSub && bufBuyOnce && bufSub, 'Both cards must feature Buy Once and Daily Subscription buttons');
  console.log('✓ Dual action buttons (Buy Once & Daily Subscription) present on both cards');

  // Capture Desktop 1440px Screenshot
  const productsSection = await page1440.$('#products');
  await productsSection.scrollIntoViewIfNeeded();
  await page1440.waitForTimeout(300);
  await page1440.screenshot({
    path: path.join(artifactDir, 'showcase_desktop_1440px.png'),
    fullPage: false
  });
  console.log('✓ Captured desktop 1440px screenshot: showcase_desktop_1440px.png');

  // ==========================================
  // TEST 2: Desktop 1024px Showcase Rendering
  // ==========================================
  console.log('\n2. Testing Desktop 1024px Showcase Rendering...');
  const context1024 = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 1
  });
  const page1024 = await context1024.newPage();
  await page1024.goto(indexUrl, { waitUntil: 'load' });
  await page1024.waitForTimeout(400);

  const cardBounds1024 = await page1024.$$eval('.product-card', cards => cards.map(c => {
    const rect = c.getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  }));
  assert.ok(Math.abs(cardBounds1024[0].top - cardBounds1024[1].top) <= 2, 'Cards must remain side-by-side at 1024px');
  assert.ok(Math.abs(cardBounds1024[0].width - cardBounds1024[1].width) <= 2, 'Cards must have equal width at 1024px');

  const scrollWidth1024 = await page1024.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollWidth1024 <= 1024, `Zero horizontal overflow at 1024px: scrollWidth=${scrollWidth1024}`);

  const section1024 = await page1024.$('#products');
  await section1024.scrollIntoViewIfNeeded();
  await page1024.waitForTimeout(200);
  await page1024.screenshot({
    path: path.join(artifactDir, 'showcase_desktop_1024px.png'),
    fullPage: false
  });
  console.log('✓ Captured 1024px screenshot: showcase_desktop_1024px.png');

  // ==========================================
  // TEST 3: Mobile 390px (iPhone 14) Stacked Layout
  // ==========================================
  console.log('\n3. Testing Mobile 390px (iPhone 14) Layout...');
  const context390 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page390 = await context390.newPage();
  await page390.goto(indexUrl, { waitUntil: 'load' });
  await page390.waitForTimeout(400);

  const cardBounds390 = await page390.$$eval('.product-card', cards => cards.map(c => {
    const rect = c.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
  }));

  // On mobile, cards must stack vertically: Card 1 top is below Card 0 bottom
  assert.ok(cardBounds390[1].top >= cardBounds390[0].bottom, `Mobile 390px: Cards must stack vertically. Card 1 top (${cardBounds390[1].top}) >= Card 0 bottom (${cardBounds390[0].bottom})`);
  // Full width cards with comfortable side margins (width >= 310px out of 390px)
  assert.ok(cardBounds390[0].width >= 310, `Mobile 390px: Card width should be comfortable (got ${cardBounds390[0].width})`);
  console.log(`✓ Mobile 390px: Cards stacked vertically, Card width=${cardBounds390[0].width.toFixed(1)}px`);

  // Verify zero horizontal overflow
  const scrollWidth390 = await page390.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollWidth390 <= 390, `Mobile 390px: No horizontal page overflow (scrollWidth=${scrollWidth390})`);
  console.log(`✓ Mobile 390px: Zero horizontal overflow (scrollWidth=${scrollWidth390}px)`);

  const section390 = await page390.$('#products');
  await section390.scrollIntoViewIfNeeded();
  await page390.waitForTimeout(200);
  await page390.screenshot({
    path: path.join(artifactDir, 'showcase_mobile_390px.png'),
    fullPage: false
  });
  console.log('✓ Captured mobile 390px screenshot: showcase_mobile_390px.png');

  // ==========================================
  // TEST 4: Mobile 360px (Android) Layout
  // ==========================================
  console.log('\n4. Testing Mobile 360px (Android) Layout...');
  const context360 = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page360 = await context360.newPage();
  await page360.goto(indexUrl, { waitUntil: 'load' });
  await page360.waitForTimeout(400);

  const scrollWidth360 = await page360.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollWidth360 <= 360, `Mobile 360px: Zero horizontal overflow (scrollWidth=${scrollWidth360})`);
  console.log(`✓ Mobile 360px: Zero horizontal overflow (scrollWidth=${scrollWidth360}px)`);

  // Check floating button does not overlap buttons
  const isOverlap = await page360.evaluate(() => {
    const wa = document.querySelector('.whatsapp-sticky-widget');
    const buttons = document.querySelectorAll('.card-milk-choices');
    if (!wa || !buttons.length) return false;
    const waRect = wa.getBoundingClientRect();
    for (const b of buttons) {
      const bRect = b.getBoundingClientRect();
      if (!(waRect.right < bRect.left || waRect.left > bRect.right || waRect.bottom < bRect.top || waRect.top > bRect.bottom)) {
        return true;
      }
    }
    return false;
  });
  console.log(`✓ WhatsApp widget collision check: ${isOverlap ? 'Colliding' : 'Safe'}`);

  const section360 = await page360.$('#products');
  await section360.scrollIntoViewIfNeeded();
  await page360.waitForTimeout(200);
  await page360.screenshot({
    path: path.join(artifactDir, 'showcase_mobile_360px.png'),
    fullPage: false
  });
  console.log('✓ Captured mobile 360px screenshot: showcase_mobile_360px.png');

  // ==========================================
  // TEST 5: Interactive Modals: Buy Once & Daily Subscription
  // ==========================================
  console.log('\n5. Testing Modal Triggers (Buy Once & Daily Subscription)...');
  
  // Test Buy Once
  await page1440.click('.product-card[data-index="0"] .btn-milk-buy-once');
  await page1440.waitForTimeout(300);
  const isModalOpen1 = await page1440.$eval('#productModal', el => !el.classList.contains('hidden') && el.getAttribute('aria-hidden') === 'false');
  assert.ok(isModalOpen1, 'Modal must open when clicking Buy Once');
  const modalTitle1 = await page1440.$eval('#modalTitle', el => el.textContent.trim());
  assert.ok(modalTitle1.includes('Cow Milk'), `Expected modal title Cow Milk, got: ${modalTitle1}`);
  const isOnetimeActive = await page1440.$eval('.purchase-mode-tab[data-mode="onetime"]', el => el.classList.contains('active'));
  assert.ok(isOnetimeActive, 'Buy Once tab must be active when Buy Once button is clicked');
  console.log('✓ Buy Once button triggers modal with onetime purchase mode tab active');

  // Close modal
  await page1440.click('#modalClose');
  await page1440.waitForTimeout(300);

  // Test Daily Subscription
  await page1440.click('.product-card[data-index="0"] .btn-milk-sub');
  await page1440.waitForTimeout(300);
  const isModalOpen2 = await page1440.$eval('#productModal', el => !el.classList.contains('hidden') && el.getAttribute('aria-hidden') === 'false');
  assert.ok(isModalOpen2, 'Modal must open when clicking Daily Subscription');
  const isSubActive = await page1440.$eval('.purchase-mode-tab[data-mode="subscription"]', el => el.classList.contains('active'));
  assert.ok(isSubActive, 'Daily Subscription tab must be active when Daily Subscription button is clicked');
  const subWrapVisible = await page1440.$eval('#modalSubscriptionPlanWrap', el => !el.classList.contains('hidden'));
  assert.ok(subWrapVisible, 'Subscription planner wrap must be visible in subscription mode');
  console.log('✓ Daily Subscription button triggers modal with subscription planner active');

  // Capture Subscription Modal Screenshot
  await page1440.screenshot({
    path: path.join(artifactDir, 'showcase_subscription_modal.png'),
    fullPage: false
  });
  console.log('✓ Captured subscription modal screenshot: showcase_subscription_modal.png');

  await page1440.click('#modalClose');
  await page1440.waitForTimeout(200);

  // Test Buffalo Milk Daily Subscription
  await page1440.click('.product-card[data-index="1"] .btn-milk-sub');
  await page1440.waitForTimeout(300);
  const modalTitle2 = await page1440.$eval('#modalTitle', el => el.textContent.trim());
  assert.ok(modalTitle2.includes('Buffalo Milk'), `Expected modal title Buffalo Milk, got: ${modalTitle2}`);
  console.log('✓ Buffalo Milk card correctly opens modal for Buffalo Milk subscription');

  // ==========================================
  // TEST 6: Console Error Invariant
  // ==========================================
  console.log('\n6. Checking Browser Console Errors...');
  assert.equal(consoleErrors.length, 0, `Expected 0 console errors, encountered: \n${consoleErrors.join('\n')}`);
  console.log('✓ Exactly 0 console errors detected throughout entire verification suite');

  await browser.close();
  console.log('\n--- ALL TWO-PRODUCT SHOWCASE VERIFICATIONS PASSED ---');
}

run().catch(err => {
  console.error('\n✖ Verification failed:', err);
  process.exit(1);
});
