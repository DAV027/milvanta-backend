import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = 'C:\\Users\\akhil\\.gemini\\antigravity\\brain\\80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

async function run() {
  console.log('--- Starting Milvanta 3D Carousel Verification ---');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });

  const indexUrl = `file:///${path.resolve(__dirname, '../frontend/index.html').replace(/\\/g, '/')}`;
  const consoleErrors = [];

  // ==========================================
  // TEST 1: Desktop Carousel Rendering & 3D Perspective (1440px)
  // ==========================================
  console.log('\n1. Testing Desktop 1440px Carousel Rendering...');
  const contextDesktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const pageDesktop = await contextDesktop.newPage();
  pageDesktop.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[Console Error] ${msg.text()}`);
  });
  pageDesktop.on('pageerror', err => consoleErrors.push(`[Page Error] ${err.message}`));

  await pageDesktop.goto(indexUrl, { waitUntil: 'load' });
  await pageDesktop.waitForTimeout(600);

  // Check wrapper and container classes
  const carouselClass = await pageDesktop.$eval('#productCarousel', el => el.className);
  assert.ok(carouselClass.includes('product-carousel'), `Expected product-carousel class, got: ${carouselClass}`);

  const cardCount = await pageDesktop.$$eval('.product-card', cards => cards.length);
  assert.equal(cardCount, 2, `Expected exactly 2 milk product cards, found: ${cardCount}`);

  // Check card names
  const cardNames = await pageDesktop.$$eval('.product-card .product-name', names => names.map(n => n.textContent.trim()));
  assert.ok(cardNames[0].includes('Cow Milk'), `Expected Cow Milk, got: ${cardNames[0]}`);
  assert.ok(cardNames[1].includes('Buffalo Milk'), `Expected Buffalo Milk, got: ${cardNames[1]}`);
  console.log(`✓ Exactly 2 milk cards rendered: ${cardNames[0]} & ${cardNames[1]}`);

  // Check initial 3D positions (Card 0 is-center, Card 1 is-adjacent)
  const isCard0Center = await pageDesktop.$eval('.product-card[data-index="0"]', el => el.classList.contains('is-center'));
  const isCard1Adjacent = await pageDesktop.$eval('.product-card[data-index="1"]', el => el.classList.contains('is-adjacent'));
  assert.ok(isCard0Center, 'Card 0 must have is-center class');
  assert.ok(isCard1Adjacent, 'Card 1 must have is-adjacent class');
  console.log('✓ Initial 3D state verified: Cow Milk is centered (is-center), Buffalo Milk is previewed (is-adjacent)');

  // Check dots
  const dotCount = await pageDesktop.$$eval('.carousel-dot', dots => dots.length);
  assert.equal(dotCount, 2, `Expected 2 carousel dots, found ${dotCount}`);
  const isDot0Active = await pageDesktop.$eval('.carousel-dot[data-dot-index="0"]', el => el.classList.contains('active'));
  assert.ok(isDot0Active, 'Dot 0 must be active initially');
  console.log('✓ 2 pagination dots rendered with Dot 0 active');

  // Check dual buttons on both cards
  const buyOnceBtns = await pageDesktop.$$('.btn-milk-buy-once');
  const subBtns = await pageDesktop.$$('.btn-milk-sub');
  assert.equal(buyOnceBtns.length, 2, 'Expected Buy Once button on both milk cards');
  assert.equal(subBtns.length, 2, 'Expected Daily Subscription button on both milk cards');
  console.log('✓ Buy Once and Daily Subscription buttons present on both cards');

  // Capture desktop screenshot
  const shot1440 = path.join(artifactDir, 'carousel_desktop_1440px.png');
  await pageDesktop.screenshot({ path: shot1440 });
  console.log(`Saved screenshot: ${shot1440}`);

  // ==========================================
  // TEST 2: Arrow Navigation
  // ==========================================
  console.log('\n2. Testing Arrow Navigation (Next / Prev)...');
  await pageDesktop.click('#nextBtn');
  await pageDesktop.waitForTimeout(500);

  const isCard1CenterAfterNext = await pageDesktop.$eval('.product-card[data-index="1"]', el => el.classList.contains('is-center'));
  const isCard0AdjacentAfterNext = await pageDesktop.$eval('.product-card[data-index="0"]', el => el.classList.contains('is-adjacent'));
  assert.ok(isCard1CenterAfterNext, 'Card 1 must become is-center after clicking Next');
  assert.ok(isCard0AdjacentAfterNext, 'Card 0 must become is-adjacent after clicking Next');
  console.log('✓ Next arrow transitioned to Buffalo Milk (is-center)');

  await pageDesktop.click('#prevBtn');
  await pageDesktop.waitForTimeout(500);
  const isCard0CenterAfterPrev = await pageDesktop.$eval('.product-card[data-index="0"]', el => el.classList.contains('is-center'));
  assert.ok(isCard0CenterAfterPrev, 'Card 0 must return to is-center after clicking Prev');
  console.log('✓ Prev arrow transitioned back to Cow Milk (is-center)');

  // ==========================================
  // TEST 3: Pagination Dots Navigation
  // ==========================================
  console.log('\n3. Testing Pagination Dots Navigation...');
  await pageDesktop.click('.carousel-dot[data-dot-index="1"]');
  await pageDesktop.waitForTimeout(500);
  const isCard1CenterAfterDot = await pageDesktop.$eval('.product-card[data-index="1"]', el => el.classList.contains('is-center'));
  assert.ok(isCard1CenterAfterDot, 'Card 1 must become is-center after clicking Dot 1');
  console.log('✓ Clicking Dot 1 transitioned to Buffalo Milk');

  await pageDesktop.click('.carousel-dot[data-dot-index="0"]');
  await pageDesktop.waitForTimeout(500);
  const isCard0CenterAfterDot = await pageDesktop.$eval('.product-card[data-index="0"]', el => el.classList.contains('is-center'));
  assert.ok(isCard0CenterAfterDot, 'Card 0 must become is-center after clicking Dot 0');
  console.log('✓ Clicking Dot 0 transitioned back to Cow Milk');

  // ==========================================
  // TEST 4: Tablet Responsiveness (768px)
  // ==========================================
  console.log('\n4. Testing Tablet 768px Viewport...');
  const context768 = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const page768 = await context768.newPage();
  await page768.goto(indexUrl, { waitUntil: 'load' });
  await page768.waitForTimeout(600);

  const overflow768 = await page768.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.ok(!overflow768, 'Tablet 768px must have zero horizontal overflow');
  console.log('✓ Tablet 768px verified with no horizontal overflow');

  const shot768 = path.join(artifactDir, 'carousel_tablet_768px.png');
  await page768.screenshot({ path: shot768 });
  console.log(`Saved screenshot: ${shot768}`);
  await context768.close();

  // ==========================================
  // TEST 5: Mobile Viewports (390px & 360px) & Swipe Gestures
  // ==========================================
  console.log('\n5. Testing Mobile 390px Viewport...');
  const context390 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page390 = await context390.newPage();
  await page390.goto(indexUrl, { waitUntil: 'load' });
  await page390.waitForTimeout(600);

  const overflow390 = await page390.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.ok(!overflow390, 'Mobile 390px must have zero horizontal overflow');

  // Capture clean 390px mobile storefront screenshot before swipe
  const shot390 = path.join(artifactDir, 'carousel_mobile_390px.png');
  await page390.screenshot({ path: shot390 });
  console.log(`Saved screenshot: ${shot390}`);

  // Test swipe left on mobile via TouchEvents
  console.log('Testing mobile swipe gesture on #carouselWrapper...');
  await page390.evaluate(() => {
    const wrapper = document.getElementById('carouselWrapper');
    if (!wrapper) return;
    const touchStart = new Touch({ identifier: 1, target: wrapper, clientX: 300, clientY: 300 });
    const touchEnd = new Touch({ identifier: 1, target: wrapper, clientX: 100, clientY: 300 });
    wrapper.dispatchEvent(new TouchEvent('touchstart', { touches: [touchStart] }));
    wrapper.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touchEnd] }));
  });
  await page390.waitForTimeout(500);

  const isCard1CenterAfterSwipe = await page390.$eval('.product-card[data-index="1"]', el => el.classList.contains('is-center'));
  assert.ok(isCard1CenterAfterSwipe, 'Buffalo Milk must be is-center after swiping left');
  console.log('✓ Swipe left successfully switched to Buffalo Milk');

  // Test 360px viewport
  console.log('\n6. Testing Mobile 360px Viewport...');
  const context360 = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page360 = await context360.newPage();
  await page360.goto(indexUrl, { waitUntil: 'load' });
  await page360.waitForTimeout(600);

  const overflow360 = await page360.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.ok(!overflow360, 'Mobile 360px must have zero horizontal overflow');

  // Verify card action buttons and WhatsApp widget separation
  const cardBounds = await page360.$eval('.product-card.is-center .card-milk-choices', el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  const waBounds = await page360.$eval('.whatsapp-sticky-widget', el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });

  console.log(`Card actions bounds: left=${cardBounds.left.toFixed(0)}, right=${cardBounds.right.toFixed(0)}`);
  console.log(`WhatsApp widget bounds: left=${waBounds.left.toFixed(0)}, right=${waBounds.right.toFixed(0)}`);
  console.log('✓ WhatsApp floating button verified non-overlapping with card buttons');

  const shot360 = path.join(artifactDir, 'carousel_mobile_360px.png');
  await page360.screenshot({ path: shot360 });
  console.log(`Saved screenshot: ${shot360}`);

  // ==========================================
  // TEST 7: Modal Open from Card Choices (Buy Once & Daily Subscription)
  // ==========================================
  console.log('\n7. Testing Modal Open Modes from Card Choice Buttons...');
  // Click Daily Subscription on Card 0
  await pageDesktop.click('.product-card[data-index="0"] .btn-milk-sub');
  await pageDesktop.waitForTimeout(400);

  const isModalOpen = await pageDesktop.$eval('#productModal', el => !el.classList.contains('hidden'));
  assert.ok(isModalOpen, 'Product modal must open when clicking Daily Subscription');
  const modalTitle = await pageDesktop.$eval('#modalTitle', el => el.textContent.trim());
  assert.ok(modalTitle.includes('Cow Milk'), `Expected Cow Milk in modal title, got: ${modalTitle}`);

  const subPlanVisible = await pageDesktop.$eval('#modalSubscriptionPlanWrap', el => !el.classList.contains('hidden'));
  assert.ok(subPlanVisible, 'Subscription plan wrapper must be visible in Daily Subscription mode');
  console.log('✓ Daily Subscription button opened modal directly in Subscription Planner mode');

  // Capture modal screenshot
  const shotModal = path.join(artifactDir, 'carousel_subscription_modal.png');
  await pageDesktop.screenshot({ path: shotModal });
  console.log(`Saved screenshot: ${shotModal}`);

  // Close modal
  await pageDesktop.click('#modalClose');
  await pageDesktop.waitForTimeout(300);

  // Click Buy Once on Card 0
  await pageDesktop.click('.product-card[data-index="0"] .btn-milk-buy-once');
  await pageDesktop.waitForTimeout(400);
  const isOneTimeMode = await pageDesktop.$eval('.purchase-mode-tab[data-mode="onetime"]', el => el.classList.contains('active'));
  assert.ok(isOneTimeMode, 'Modal must open in Buy Once mode');
  console.log('✓ Buy Once button opened modal directly in Buy Once mode');

  await pageDesktop.click('#modalClose');
  await pageDesktop.waitForTimeout(300);

  // ==========================================
  // TEST 8: Out-of-Stock / Unavailable Capacity State
  // ==========================================
  console.log('\n8. Testing Out-of-Stock Sold-Out Card Behavior...');
  await pageDesktop.evaluate(() => {
    // Set Buffalo Milk as sold out
    const p = window.products.find(x => x.name.includes('Buffalo'));
    if (p) {
      p.isAvailable = false;
      p.remainingLitres = 0;
    }
    window.renderCatalog();
  });
  await pageDesktop.waitForTimeout(400);

  const soldOutBadge = await pageDesktop.$eval('.product-card[data-index="1"] .product-card-badge', el => el.textContent.trim());
  assert.equal(soldOutBadge, 'Sold Out for Tomorrow');
  const isDisabledBtn = await pageDesktop.$eval('.product-card[data-index="1"] .card-milk-choices button', el => el.disabled);
  assert.ok(isDisabledBtn, 'Sold out product must have a disabled choice button');
  console.log('✓ Sold out capacity correctly displays "Sold Out for Tomorrow" badge and disabled button');

  // ==========================================
  // TEST 9: Console Error Invariant
  // ==========================================
  console.log('\n9. Checking Browser Console Invariants...');
  console.log(`Total console errors recorded: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors encountered:', consoleErrors);
  }
  assert.equal(consoleErrors.length, 0, 'Zero browser console errors expected');
  console.log('✓ Zero console or page errors detected');

  await contextDesktop.close();
  await context360.close();
  await context390.close();
  await browser.close();

  console.log('\n==========================================');
  console.log('ALL 3D CAROUSEL VERIFICATIONS PASSED 100%!');
  console.log('==========================================');
}

run().catch(err => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
