const puppeteer = require('puppeteer-core');
const path = require('path');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Navigating to http://localhost:8080/ ...');
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  // Set logged-in customer state and cart items count to 3 like the screenshot
  await page.evaluate(() => {
    window.state.customer = {
      id: 1,
      full_name: 'Akhil',
      phone: '6305974564',
      email: 'akhil@example.com'
    };
    window.updateAccountButton();

    // Set cart count to 3
    const cartBadge = document.getElementById('cartCount');
    if (cartBadge) {
      cartBadge.textContent = '3';
      cartBadge.classList.remove('hidden');
    }
  });

  await new Promise(r => setTimeout(r, 500));

  // Click the account toggle button to open the dropdown
  console.log('Clicking account toggle button...');
  await page.click('#accountToggle');
  await new Promise(r => setTimeout(r, 800));

  // Capture screenshot of the top-right header area with open dropdown
  const headerElem = await page.$('.site-header');
  if (headerElem) {
    // Clip the top right area where location, account toggle and cart are
    const box = await headerElem.boundingBox();
    const clipScreenshot = path.join(ARTIFACTS_DIR, 'user_account_dropdown_clipped.png');
    await page.screenshot({
      path: clipScreenshot,
      clip: {
        x: Math.max(0, box.x + box.width - 500),
        y: box.y,
        width: 500,
        height: 380
      }
    });
    console.log('Saved clipped dropdown screenshot:', clipScreenshot);
  }

  // Also capture full header view
  const fullScreenshot = path.join(ARTIFACTS_DIR, 'user_account_dropdown_full.png');
  await page.screenshot({ path: fullScreenshot });
  console.log('Saved full view screenshot:', fullScreenshot);

  // Test clicking "Profile"
  console.log('Clicking Profile menu item...');
  await page.click('#userMenuProfile');
  await new Promise(r => setTimeout(r, 1000));

  const profileModalScreenshot = path.join(ARTIFACTS_DIR, 'user_profile_modal.png');
  await page.screenshot({ path: profileModalScreenshot });
  console.log('Saved profile modal screenshot:', profileModalScreenshot);

  await browser.close();
  console.log('User dropdown verification complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

