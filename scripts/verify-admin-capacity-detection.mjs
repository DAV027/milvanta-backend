import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8089;
const server = http.createServer((req, res) => {
  let filePath = path.join(process.cwd(), 'frontend', req.url.split('?')[0]);
  if (req.url === '/' || req.url === '/admin') filePath = path.join(process.cwd(), 'frontend', 'admin.html');
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mime = ext === '.html' ? 'text/html' : (ext === '.js' ? 'application/javascript' : (ext === '.css' ? 'text/css' : 'text/plain'));
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, async () => {
  console.log(`Test web server running on http://127.0.0.1:${PORT}`);
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    console.log('\n--- Scenario A: Missing Milk Capacity API (Production PR #40 / Commit 852b531) ---');

    // Intercept backend API routes to simulate production Render backend (PR #40)
    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/api/v1/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: { id: 1, email: 'admin@milvanta.com', is_admin: true } })
        });
      }

      if (url.includes('/api/v1/admin/demand-forecast')) {
        // PR #40 backend returned forecast data WITHOUT `capacity` object
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            date: '2026-11-21',
            totalLitres: 12.5,
            cowMilkLitres: 7.5,
            buffaloMilkLitres: 5.0,
            totalDeliveries: 15,
            hasUnrecognizedUnits: false,
            packBreakdown: { 'Pure Fresh Cow Milk (1 Litre)': 5, 'Pure Fresh Buffalo Milk (500 ml)': 10 }
            // NO capacity property!
          })
        });
      }

      if (url.includes('/api/v1/admin/milk-capacity')) {
        // PR #40 backend returns 404
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not Found', message: 'Route POST /api/v1/admin/milk-capacity not found' })
        });
      }

      if (url.includes('/api/v1/admin/deliveries') || url.includes('/api/v1/admin/overview') || url.includes('/api/v1/admin/orders')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ deliveries: [], orders: [], stats: {} })
        });
      }

      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    // Seed admin token in sessionStorage
    await page.addInitScript(() => {
      sessionStorage.setItem('milvanta-admin-token', 'mock_admin_token_test');
    });

    await page.goto(`http://127.0.0.1:${PORT}/admin.html`, { waitUntil: 'networkidle' });

    // Navigate to Milk Stock tab
    await page.click('#navBtnDemand');
    await page.waitForTimeout(500);

    // 1. Check warning banner in demandAlertsContainer
    const alertEl = await page.$('#capacityUnavailableAlert');
    assert.ok(alertEl, 'Alert banner #capacityUnavailableAlert should be present');
    const alertText = await alertEl.innerText();
    console.log('✓ Alert banner text:', alertText.trim());
    assert.ok(
      alertText.includes('Milk inventory management is not available on the deployed backend. Please contact the administrator.'),
      'Banner text must match exact requirement'
    );

    // 2. Check in-card feedback
    const cardFeedback = await page.$eval('#capacityFeedbackMsg', el => ({ text: el.textContent, display: getComputedStyle(el).display }));
    console.log('✓ In-card feedback:', cardFeedback);
    assert.ok(
      cardFeedback.text.includes('Milk inventory management is not available on the deployed backend. Please contact the administrator.'),
      'Card feedback must show unavailable message'
    );
    assert.strictEqual(cardFeedback.display, 'block');

    // 3. Check badge
    const badgeText = await page.$eval('#capSourceBadge', el => el.textContent.trim());
    console.log('✓ Badge text:', badgeText);
    assert.ok(badgeText.includes('API Unavailable'));

    // 4. Check KPI values - NOT 100L / 80L
    const cowAvail = await page.$eval('#capCowAvailable', el => el.textContent.trim());
    const bufAvail = await page.$eval('#capBuffaloAvailable', el => el.textContent.trim());
    const cowComm = await page.$eval('#capCowCommitted', el => el.textContent.trim());
    const bufComm = await page.$eval('#capBuffaloCommitted', el => el.textContent.trim());
    const cowRem = await page.$eval('#capCowRemaining', el => el.textContent.trim());
    const bufRem = await page.$eval('#capBuffaloRemaining', el => el.textContent.trim());

    console.log(`✓ Capacity KPIs: Cow Available=${cowAvail}, Committed=${cowComm}, Remaining=${cowRem}`);
    console.log(`✓ Capacity KPIs: Buffalo Available=${bufAvail}, Committed=${bufComm}, Remaining=${bufRem}`);
    assert.strictEqual(cowAvail, '--', 'Cow Available capacity must display placeholder --');
    assert.strictEqual(bufAvail, '--', 'Buffalo Available capacity must display placeholder --');
    assert.strictEqual(cowComm, '--', 'Cow Committed capacity must display --');
    assert.strictEqual(bufComm, '--', 'Buffalo Committed capacity must display --');
    assert.strictEqual(cowRem, '--', 'Cow Remaining capacity must display --');
    assert.strictEqual(bufRem, '--', 'Buffalo Remaining capacity must display --');

    // 5. Check inputs disabled
    const cowDisabled = await page.$eval('#inputCowCapacity', el => el.disabled);
    const bufDisabled = await page.$eval('#inputBuffaloCapacity', el => el.disabled);
    const notesDisabled = await page.$eval('#inputCapacityNotes', el => el.disabled);
    console.log(`✓ Inputs disabled: Cow=${cowDisabled}, Buffalo=${bufDisabled}, Notes=${notesDisabled}`);
    assert.ok(cowDisabled && bufDisabled && notesDisabled, 'All capacity inputs must be disabled');

    // 6. Check buttons disabled
    const btnOverrideDisabled = await page.$eval('#btnSaveCapacityOverride', el => el.disabled);
    const btnDefaultsDisabled = await page.$eval('#btnSaveCapacityDefaults', el => el.disabled);
    const btnConfirmDisabled = await page.$eval('#btnConfirmSupply', el => el.disabled);
    console.log(`✓ Buttons disabled: SaveOverride=${btnOverrideDisabled}, SetDefault=${btnDefaultsDisabled}, ConfirmBaseline=${btnConfirmDisabled}`);
    assert.ok(btnOverrideDisabled && btnDefaultsDisabled && btnConfirmDisabled, 'All capacity action buttons must be disabled');

    // 7. Check liveDot is RED (dot-error) and NOT green (Synced)
    const liveDotClass = await page.$eval('#liveDot', el => el.className);
    const syncLabelText = await page.$eval('#lastSyncLabel', el => el.textContent.trim());
    const timerLabelText = await page.$eval('#refreshTimerLabel', el => el.textContent.trim());
    console.log(`✓ Sync status: liveDot class="${liveDotClass}", lastSync="${syncLabelText}", timerLabel="${timerLabelText}"`);
    assert.ok(liveDotClass.includes('dot-error'), 'liveDot must have dot-error class (RED indicator)');
    assert.ok(!liveDotClass.includes('dot-syncing') && liveDotClass !== 'live-dot', 'liveDot must NOT be bare live-dot (green)');
    assert.strictEqual(syncLabelText, 'Capacity unavailable', 'Sync label must state "Capacity unavailable"');
    assert.strictEqual(timerLabelText, 'Capacity API unavailable', 'Timer label must state "Capacity API unavailable"');

    // Screenshot of Scenario A
    await page.screenshot({ path: 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d/admin_milk_capacity_unavailable_production.png' });
    console.log('✓ Captured screenshot: admin_milk_capacity_unavailable_production.png');

    console.log('\n--- Scenario B: Verified Milk Capacity API Available (PR #41 Deployed) ---');

    // Unroute and re-route with PR #41 capacity payload
    await page.unroute('**/api/v1/**');
    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/v1/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: { id: 1, email: 'admin@milvanta.com', is_admin: true } })
        });
      }
      if (url.includes('/api/v1/admin/demand-forecast')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            date: '2026-11-21',
            totalLitres: 45.0,
            cowMilkLitres: 25.0,
            buffaloMilkLitres: 20.0,
            totalDeliveries: 30,
            hasUnrecognizedUnits: false,
            packBreakdown: { 'Pure Fresh Cow Milk (1 Litre)': 25, 'Pure Fresh Buffalo Milk (1 Litre)': 20 },
            capacity: {
              cow: { total: 100, committedTotal: 25, remaining: 75, isConfirmed: true, source: 'default' },
              buffalo: { total: 80, committedTotal: 20, remaining: 60, isConfirmed: true, source: 'default' }
            }
          })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    // Trigger refresh / date change
    await page.click('#btnManualRefresh');
    await page.waitForTimeout(500);

    // 1. Warning banner should be removed
    const alertElB = await page.$('#capacityUnavailableAlert');
    assert.strictEqual(alertElB, null, 'Warning banner must be removed when capacity is available');

    // 2. Badge should show confirmed
    const badgeTextB = await page.$eval('#capSourceBadge', el => el.textContent.trim());
    console.log('✓ Available Badge text:', badgeTextB);
    assert.ok(badgeTextB.includes('Confirmed Farm Supply'));

    // 3. KPI values should be formatted numbers
    const cowAvailB = await page.$eval('#capCowAvailable', el => el.textContent.trim());
    const bufAvailB = await page.$eval('#capBuffaloAvailable', el => el.textContent.trim());
    console.log(`✓ Available Capacity KPIs: Cow=${cowAvailB}, Buffalo=${bufAvailB}`);
    assert.strictEqual(cowAvailB, '100.00 L');
    assert.strictEqual(bufAvailB, '80.00 L');

    // 4. Buttons and inputs should be enabled
    const cowDisabledB = await page.$eval('#inputCowCapacity', el => el.disabled);
    const btnOverrideDisabledB = await page.$eval('#btnSaveCapacityOverride', el => el.disabled);
    assert.strictEqual(cowDisabledB, false, 'Inputs must be enabled when capacity API is active');
    assert.strictEqual(btnOverrideDisabledB, false, 'Buttons must be enabled when capacity API is active');

    // 5. liveDot should be green
    const liveDotClassB = await page.$eval('#liveDot', el => el.className);
    console.log(`✓ Available Sync status: liveDot class="${liveDotClassB}"`);
    assert.strictEqual(liveDotClassB, 'live-dot', 'liveDot must be standard green indicator');

    await page.screenshot({ path: 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d/admin_milk_capacity_available_pr41.png' });
    console.log('✓ Captured screenshot: admin_milk_capacity_available_pr41.png');

    console.log('\n--- ALL ADMIN MILK CAPACITY DETECTION VERIFICATIONS PASSED ---');
  } finally {
    await browser.close();
    server.close();
  }
});
