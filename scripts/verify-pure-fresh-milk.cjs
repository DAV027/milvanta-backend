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
  await new Promise(r => setTimeout(r, 2000));

  // 1. Capture Header & Category Strip
  const headerScreenshot = path.join(ARTIFACTS_DIR, 'pure_fresh_milk_header_categories.png');
  await page.screenshot({ path: headerScreenshot });
  console.log('Saved header screenshot:', headerScreenshot);

  // 2. Click "Pure Fresh Milk" tab
  const milkLink = await page.$('[data-category-nav="Fresh Milk"]');
  if (milkLink) {
    console.log('Clicking Pure Fresh Milk navigation link...');
    await milkLink.click();
    await new Promise(r => setTimeout(r, 1500));
  }

  // Scroll to featured section
  const featured = await page.$('#products');
  if (featured) {
    await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), featured);
    await new Promise(r => setTimeout(r, 1000));
  }

  const productsScreenshot = path.join(ARTIFACTS_DIR, 'pure_fresh_milk_products_section.png');
  await page.screenshot({ path: productsScreenshot });
  console.log('Saved products section screenshot:', productsScreenshot);

  // 3. Scroll to Hero Section
  const hero = await page.$('.hero');
  if (hero) {
    await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), hero);
    await new Promise(r => setTimeout(r, 1000));
    const heroScreenshot = path.join(ARTIFACTS_DIR, 'pure_fresh_milk_hero_section.png');
    await page.screenshot({ path: heroScreenshot });
    console.log('Saved hero section screenshot:', heroScreenshot);
  }

  // 4. Scroll to Footer
  const footer = await page.$('footer');
  if (footer) {
    await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), footer);
    await new Promise(r => setTimeout(r, 1000));
    const footerScreenshot = path.join(ARTIFACTS_DIR, 'pure_fresh_milk_footer_section.png');
    await page.screenshot({ path: footerScreenshot });
    console.log('Saved footer section screenshot:', footerScreenshot);
  }

  await browser.close();
  console.log('Verification finished.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

