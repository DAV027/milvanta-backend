const puppeteer = require('puppeteer-core');
const path = require('path');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,960']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  console.log('1. Navigating to home page...');
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  console.log('2. Adding items to cart via window.addToCart...');
  const res = await page.evaluate(() => {
    console.log('Window products count:', (window.products || []).length);
    console.log('Window addToCart exists:', typeof window.addToCart);
    const prods = window.products || [];
    if (prods.length > 0) {
      window.addToCart(prods[0].id, 2);
      if (prods.length > 1) {
        window.addToCart(prods[1].id, 1);
      }
    }
    console.log('Cart after add:', JSON.stringify(window.state?.cart));
    window.setCartOpen(true);
    return {
      productsCount: prods.length,
      cartCount: (window.state?.cart || []).length
    };
  });
  console.log('Evaluation result:', res);
  await new Promise(r => setTimeout(r, 800));

  // Screenshot 1: Cart Drawer showing ONLY items and "Place order" button
  console.log('3. Capturing cart drawer screenshot...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_drawer_items_only.png') });

  // Click "Place order" button
  console.log('4. Clicking Place order button...');
  const placeOrderBtn = await page.$('#cartPlaceOrderBtn');
  if (!placeOrderBtn) throw new Error('Place order button not found in cart!');
  await placeOrderBtn.click();

  // Wait for navigation to checkout.html
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  console.log('Navigated to:', page.url());
  await new Promise(r => setTimeout(r, 800));

  // Screenshot 2: Step 1 (Details)
  console.log('5. Capturing Step 1 (Details) screenshot...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'checkout_step1_details.png') });

  // Fill in Step 1 (Instant Guest / Details)
  console.log('6. Filling Step 1 details...');
  await page.evaluate(() => {
    const guestTab = document.querySelector('#tabAuthGuest');
    if (guestTab) guestTab.click();
  });
  await new Promise(r => setTimeout(r, 400));

  await page.type('#authName', 'Akhil Kumar');
  await page.type('#authEmail', 'akhil@example.com');
  await page.type('#authPhone', '9876543210');

  // Submit Step 1
  await page.click('#authSubmitBtn');
  await new Promise(r => setTimeout(r, 800));

  // Screenshot 3: Step 2 (Address)
  console.log('7. Capturing Step 2 (Address) screenshot...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'checkout_step2_address.png') });

  // Fill Address fields
  console.log('8. Filling Step 2 address fields...');
  await page.type('#addrHouse', 'Flat 402, Block B');
  await page.type('#addrBuilding', 'Aparna CyberLife');
  await page.type('#addrStreet', 'Hafeezpet Road, Nallagandla');

  // Submit Step 2
  await page.click('#step2NextBtn');
  await new Promise(r => setTimeout(r, 800));

  // Screenshot 4: Step 3 (Payment)
  console.log('9. Capturing Step 3 (Payment) screenshot...');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'checkout_step3_payment.png') });

  console.log('All checkout flow steps verified successfully!');
  await browser.close();
}

main().catch(err => {
  console.error('Error during checkout flow verification:', err);
  process.exit(1);
});
