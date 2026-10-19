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

  console.log('Verifying Chicken Pickle (Boneless) modal...');
  await page.goto('http://localhost:8080/?product=12', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pickle_chicken_modal.png') });

  console.log('Verifying Mutton Pickle (Boneless) modal...');
  await page.goto('http://localhost:8080/?product=14', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pickle_mutton_modal.png') });

  console.log('Verifying Gongura Chicken (Boneless) modal...');
  await page.goto('http://localhost:8080/?product=17', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pickle_gongura_chicken_modal.png') });

  console.log('Verifying Gongura Mutton (Boneless) modal...');
  await page.goto('http://localhost:8080/?product=18', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pickle_gongura_mutton_modal.png') });

  console.log('Verifying Indian Pickles grid view...');
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(() => {
    const link = document.querySelector('[data-category-nav="Indian Pickles"]');
    if (link) link.click();
  });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => {
    const viewAll = document.querySelector('#viewAllBtn') || document.querySelector('.carousel-view-all');
    if (viewAll) viewAll.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Scroll down to the non-veg pickles
  await page.evaluate(() => {
    const nonVeg = Array.from(document.querySelectorAll('.product-card')).find(c => c.textContent.includes('Chicken Pickle'));
    if (nonVeg) nonVeg.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'non_veg_pickles_grid.png') });

  console.log('All screenshots captured successfully.');
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

