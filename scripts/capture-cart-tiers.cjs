const puppeteer = require('puppeteer-core');
const path = require('path');
const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });

  // Set Kondapur (500084) and add item 1
  await page.evaluate(() => {
    localStorage.setItem('milvanta-pincode', '500084');
    localStorage.setItem('milvanta-area', 'Kondapur');
    localStorage.setItem('milvanta-cart', JSON.stringify([{ id: 1, quantity: 1 }]));
  });
  await page.reload({ waitUntil: 'networkidle2' });

  // Open Cart
  await page.click('#cartToggle');
  await new Promise(r => setTimeout(r, 800));

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_tier1_50rs_active.png') });
  console.log('Saved cart_tier1_50rs_active.png');

  // Close cart
  await page.click('#closeCart');
  await new Promise(r => setTimeout(r, 500));

  // Change to Gachibowli (500032)
  await page.click('#headerLocationBtn');
  await new Promise(r => setTimeout(r, 600));
  await page.$eval('#pincodeInput', el => el.value = '500032');
  await page.click('#pincodeForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 1600));

  // Open Cart
  await page.click('#cartToggle');
  await new Promise(r => setTimeout(r, 800));

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'cart_tier2_80rs_active.png') });
  console.log('Saved cart_tier2_80rs_active.png');

  await browser.close();
  console.log('DONE!');
})();

