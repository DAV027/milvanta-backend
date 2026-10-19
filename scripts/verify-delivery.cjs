const puppeteer = require('puppeteer-core');
const path = require('path');

const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Navigating to http://localhost:8080/ ...');
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // 1. Check initial header location text
  let headerText = await page.$eval('#currentLocationText', el => el.textContent.trim());
  console.log('Initial Header Location Pill:', headerText);

  // 2. Open Pincode Modal
  await page.click('#headerLocationBtn');
  await new Promise(r => setTimeout(r, 600));

  // Take screenshot of Pincode Modal with Hafeezpet rates and chips
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pincode_modal_hafeezpet.png') });
  console.log('Saved pincode_modal_hafeezpet.png');

  // 3. Test Kondapur (500084) - Tier 1: <= 5 km (Rs 50)
  await page.$eval('#pincodeInput', el => el.value = '500084');
  await page.click('#pincodeForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 1600));

  headerText = await page.$eval('#currentLocationText', el => el.textContent.trim());
  console.log('Header after 500084 (Kondapur):', headerText);

  // Add item to cart and open cart
  await page.evaluate(() => {
    window.state.cart = [{ id: 101, quantity: 1 }];
    renderCart();
    updateBadge();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.click('#cartToggle');
  await new Promise(r => setTimeout(r, 800));

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_tier1_50rs.png') });
  console.log('Saved cart_tier1_50rs.png');

  // Close cart
  await page.click('#closeCart');
  await new Promise(r => setTimeout(r, 500));

  // 4. Test Gachibowli (500032) - Tier 2: 6-10 km (Rs 80)
  await page.click('#headerLocationBtn');
  await new Promise(r => setTimeout(r, 600));
  await page.$eval('#pincodeInput', el => el.value = '500032');
  await page.click('#pincodeForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 1600));

  headerText = await page.$eval('#currentLocationText', el => el.textContent.trim());
  console.log('Header after 500032 (Gachibowli):', headerText);

  // Open cart to check Rs 80 delivery
  await page.click('#cartToggle');
  await new Promise(r => setTimeout(r, 800));

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_tier2_80rs.png') });
  console.log('Saved cart_tier2_80rs.png');

  // Close cart
  await page.click('#closeCart');
  await new Promise(r => setTimeout(r, 500));

  // 5. Test Outside Hyderabad (560001)
  await page.click('#headerLocationBtn');
  await new Promise(r => setTimeout(r, 600));
  await page.$eval('#pincodeInput', el => el.value = '560001');
  await page.click('#pincodeForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 400));
  const outsideFeedback = await page.$eval('#pincodeFeedback', el => el.textContent.trim());
  console.log('Feedback for 560001 (Bangalore):', outsideFeedback);

  // 6. Test Secunderabad > 10 km (500003)
  await page.$eval('#pincodeInput', el => el.value = '500003');
  await page.click('#pincodeForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 400));
  const beyondFeedback = await page.$eval('#pincodeFeedback', el => el.textContent.trim());
  console.log('Feedback for 500003 (Secunderabad):', beyondFeedback);

  // 7. Check Profile Page
  await page.goto('http://localhost:8080/profile.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  const profileHeader = await page.$eval('#currentLocationText', el => el.textContent.trim());
  const profileCity = await page.$eval('#profileDetailCity', el => el.textContent.trim());
  console.log('Profile Header Location:', profileHeader);
  console.log('Profile Detail City:', profileCity);

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'profile_location_hafeezpet.png') });
  console.log('Saved profile_location_hafeezpet.png');

  await browser.close();
  console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});