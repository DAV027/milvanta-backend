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

  // Click Indian Pickles nav link
  console.log('Clicking Indian Pickles navigation link...');
  const pickleNav = await page.$('[data-category-nav="Indian Pickles"]');
  if (pickleNav) {
    await pickleNav.click();
  } else {
    // fallback to clicking category card
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.category-card, .shop-cat-card, #categoryRow button, #categoryRow div'));
      const c = cards.find(el => el.textContent.includes('Indian Pickles'));
      if (c) c.click();
    });
  }
  await new Promise(r => setTimeout(r, 1500));

  // Scroll to featured section
  const featured = await page.$('#products');
  if (featured) {
    await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), featured);
    await new Promise(r => setTimeout(r, 1000));
  }

  // 1. Capture carousel view of Indian Pickles
  const carouselScreenshot = path.join(ARTIFACTS_DIR, 'indian_pickles_carousel_view.png');
  await page.screenshot({ path: carouselScreenshot });
  console.log('Saved Indian Pickles carousel view:', carouselScreenshot);

  // 2. Click View All button
  const viewAllBtn = await page.$('#viewAllBtn');
  if (viewAllBtn) {
    console.log('Clicking #viewAllBtn...');
    await viewAllBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // Scroll down to trigger lazy loading of images
    await page.evaluate(async () => {
      window.scrollBy(0, 400);
      await new Promise(r => setTimeout(r, 500));
      window.scrollBy(0, 400);
      await new Promise(r => setTimeout(r, 500));
    });
    await new Promise(r => setTimeout(r, 1500));

    const gridScreenshot = path.join(ARTIFACTS_DIR, 'indian_pickles_grid_view.png');
    await page.screenshot({ path: gridScreenshot });
    console.log('Saved Indian Pickles grid view:', gridScreenshot);
  }

  // 3. Inspect cards
  const cardsInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.product-card')).map(c => {
      const title = c.querySelector('h3, .product-title, .product-name')?.textContent?.trim() || '';
      const img = c.querySelector('img');
      return {
        title,
        src: img?.getAttribute('src') || '',
        naturalWidth: img?.naturalWidth || 0,
        complete: img?.complete || false
      };
    }).filter(c => c.title.toLowerCase().includes('pickle'));
  });
  console.table(cardsInfo);

  // 4. Modal for Avakaya Mango Pickle
  const avakayaCard = await page.evaluateHandle(() => {
    const cards = Array.from(document.querySelectorAll('.product-card'));
    return cards.find(c => c.textContent.includes('Avakaya'));
  });
  if (avakayaCard) {
    console.log('Opening Avakaya modal...');
    await avakayaCard.click();
    await new Promise(r => setTimeout(r, 1500));
    const avakayaModalPath = path.join(ARTIFACTS_DIR, 'avakaya_pickle_modal.png');
    await page.screenshot({ path: avakayaModalPath });
    console.log('Saved Avakaya modal screenshot:', avakayaModalPath);

    // Close modal
    const closeBtn = await page.$('.modal-close, .modal-close-btn, #modalClose');
    if (closeBtn) await closeBtn.click();
    await new Promise(r => setTimeout(r, 1000));
  }

  // 5. Modal for Mutton Pickle (Boneless)
  const muttonCard = await page.evaluateHandle(() => {
    const cards = Array.from(document.querySelectorAll('.product-card'));
    return cards.find(c => c.textContent.includes('Mutton') && !c.textContent.includes('Gongura'));
  });
  if (muttonCard) {
    console.log('Opening Mutton modal...');
    await muttonCard.click();
    await new Promise(r => setTimeout(r, 1500));
    const muttonModalPath = path.join(ARTIFACTS_DIR, 'mutton_pickle_modal.png');
    await page.screenshot({ path: muttonModalPath });
    console.log('Saved Mutton modal screenshot:', muttonModalPath);
  }

  await browser.close();
  console.log('All pickle screenshots captured successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

