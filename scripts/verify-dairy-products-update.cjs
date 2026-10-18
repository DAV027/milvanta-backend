const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ARTIFACT_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

function startStaticServer(port = 8115) {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const filePath = path.join(__dirname, '../frontend', reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[Static Server] Running on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

(async () => {
  let server;
  let browser;

  try {
    server = await startStaticServer(8115);

    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1024']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });

    console.log('1. Loading Storefront and filtering to Dairy Products...');
    await page.goto('http://127.0.0.1:8115/index.html', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));

    // Click on Dairy Products Category
    await page.evaluate(() => {
      const dairyLink = document.querySelector('[data-category-nav="Dairy Products"]') || Array.from(document.querySelectorAll('.category-card')).find(b => b.textContent.includes('Dairy'));
      if (dairyLink) {
        dairyLink.click();
      } else {
        state.selectedCategory = 'Dairy Products';
        renderCategories();
        renderCatalog();
      }
    });
    await new Promise(r => setTimeout(r, 600));

    // Inspect dairy product cards
    const dairyCards = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.product-card'));
      return cards.map(c => ({
        id: c.dataset.id,
        title: c.querySelector('h3')?.textContent?.trim(),
        price: c.querySelector('.product-price')?.textContent?.trim(),
        image: c.querySelector('img')?.getAttribute('src'),
        badge: c.querySelector('.badge-pill')?.textContent?.trim()
      }));
    });

    console.log('Rendered Dairy Product Cards:', JSON.stringify(dairyCards, null, 2));

    const paneer = dairyCards.find(c => c.title.toLowerCase().includes('paneer'));
    const curd = dairyCards.find(c => c.title.toLowerCase().includes('curd'));
    const cowGhee = dairyCards.find(c => c.title.toLowerCase().includes('cow ghee'));
    const buffaloGhee = dairyCards.find(c => c.title.toLowerCase().includes('buffalo ghee'));

    if (!paneer) throw new Error('Paneer card not found!');
    if (!curd) throw new Error('Pot Curd card not found!');
    if (!cowGhee) throw new Error('Pure Cow Ghee card not found!');
    if (!buffaloGhee) throw new Error('Pure Buffalo Ghee card not found!');

    console.log(`✓ Found all 4 Dairy Products:`);
    console.log(`  - Paneer: ${paneer.price}`);
    console.log(`  - Curd: ${curd.title} (${curd.price})`);
    console.log(`  - Cow Ghee: ${cowGhee.title} (${cowGhee.price}) - Image: ${cowGhee.image}`);
    console.log(`  - Buffalo Ghee: ${buffaloGhee.title} (${buffaloGhee.price}) - Image: ${buffaloGhee.image}`);

    // Take screenshot of Dairy Products Grid
    const gridScreenshot = path.join(ARTIFACT_DIR, 'dairy_products_grid_updated.png');
    await page.screenshot({ path: gridScreenshot });
    console.log('Saved dairy products grid screenshot:', gridScreenshot);

    // 2. Test Paneer Modal & Variants
    console.log('\n2. Testing Paneer Modal & Variants...');
    await page.evaluate((id) => {
      window.openProductModal(Number(id));
    }, paneer.id);
    await new Promise(r => setTimeout(r, 600));

    const paneerModal = await page.evaluate(() => {
      const title = document.getElementById('modalTitle')?.textContent?.trim();
      const price = document.getElementById('modalPrice')?.textContent?.trim();
      const chips = Array.from(document.querySelectorAll('#variantChips .variant-chip')).map(ch => ({
        label: ch.querySelector('.chip-size')?.textContent?.trim(),
        price: ch.querySelector('.chip-price')?.textContent?.trim(),
        active: ch.classList.contains('is-active')
      }));
      return { title, price, chips };
    });
    console.log('Paneer Modal:', JSON.stringify(paneerModal, null, 2));

    if (!paneerModal.chips.some(c => c.label.includes('500 g') && c.price.includes('400'))) {
      throw new Error('Paneer missing 500 g for ₹400 variant!');
    }
    if (!paneerModal.chips.some(c => c.label.includes('1 kg') && c.price.includes('750'))) {
      throw new Error('Paneer missing 1 kg for ₹750 variant!');
    }

    // Click 1 kg variant
    await page.evaluate(() => {
      const chip1kg = Array.from(document.querySelectorAll('#variantChips .variant-chip')).find(
        ch => ch.textContent.includes('1 kg')
      );
      if (chip1kg) chip1kg.click();
    });
    await new Promise(r => setTimeout(r, 400));
    const paneerPrice1kg = await page.evaluate(() => document.getElementById('modalPrice')?.textContent?.trim());
    console.log('Paneer 1kg selected price:', paneerPrice1kg);
    if (!paneerPrice1kg.includes('750')) throw new Error(`Expected Paneer 1kg price ₹750, got ${paneerPrice1kg}`);

    const paneerModalScreenshot = path.join(ARTIFACT_DIR, 'paneer_product_modal_variants.png');
    await page.screenshot({ path: paneerModalScreenshot });
    console.log('Saved Paneer modal screenshot:', paneerModalScreenshot);

    // Close modal
    await page.evaluate(() => document.getElementById('modalClose')?.click());
    await new Promise(r => setTimeout(r, 400));

    // 3. Test Pot Curd Modal & 5 Variants
    console.log('\n3. Testing Pot Curd Modal & 5 Variants...');
    await page.evaluate((id) => {
      window.openProductModal(Number(id));
    }, curd.id);
    await new Promise(r => setTimeout(r, 600));

    const curdModal = await page.evaluate(() => {
      const title = document.getElementById('modalTitle')?.textContent?.trim();
      const price = document.getElementById('modalPrice')?.textContent?.trim();
      const chips = Array.from(document.querySelectorAll('#variantChips .variant-chip')).map(ch => ({
        label: ch.querySelector('.chip-size')?.textContent?.trim(),
        price: ch.querySelector('.chip-price')?.textContent?.trim()
      }));
      return { title, price, chips };
    });
    console.log('Pot Curd Modal:', JSON.stringify(curdModal, null, 2));

    if (curdModal.chips.length !== 5) {
      throw new Error(`Expected 5 Pot Curd variants, got ${curdModal.chips.length}`);
    }

    const curdModalScreenshot = path.join(ARTIFACT_DIR, 'pot_curd_product_modal_variants.png');
    await page.screenshot({ path: curdModalScreenshot });
    console.log('Saved Pot Curd modal screenshot:', curdModalScreenshot);

    // Close modal
    await page.evaluate(() => document.getElementById('modalClose')?.click());
    await new Promise(r => setTimeout(r, 400));

    // 4. Test Pure Cow Ghee Modal
    console.log('\n4. Testing Pure Cow Ghee Modal...');
    await page.evaluate((id) => {
      window.openProductModal(Number(id));
    }, cowGhee.id);
    await new Promise(r => setTimeout(r, 600));

    const cowGheeModal = await page.evaluate(() => {
      const title = document.getElementById('modalTitle')?.textContent?.trim();
      const price = document.getElementById('modalPrice')?.textContent?.trim();
      const chips = Array.from(document.querySelectorAll('#variantChips .variant-chip')).map(ch => ({
        label: ch.querySelector('.chip-size')?.textContent?.trim(),
        price: ch.querySelector('.chip-price')?.textContent?.trim()
      }));
      return { title, price, chips };
    });
    console.log('Cow Ghee Modal:', JSON.stringify(cowGheeModal, null, 2));

    if (!cowGheeModal.chips.some(c => c.label.includes('500 g') && c.price.replace(/,/g, '').includes('1500'))) {
      throw new Error('Cow Ghee missing 500 g for ₹1,500!');
    }
    if (!cowGheeModal.chips.some(c => c.label.includes('1 kg') && c.price.replace(/,/g, '').includes('2800'))) {
      throw new Error('Cow Ghee missing 1 kg for ₹2,800!');
    }

    const cowGheeScreenshot = path.join(ARTIFACT_DIR, 'pure_cow_ghee_product_modal.png');
    await page.screenshot({ path: cowGheeScreenshot });
    console.log('Saved Pure Cow Ghee modal screenshot:', cowGheeScreenshot);

    // Close modal
    await page.evaluate(() => document.getElementById('modalClose')?.click());
    await new Promise(r => setTimeout(r, 400));

    // 5. Test Pure Buffalo Ghee Modal
    console.log('\n5. Testing Pure Buffalo Ghee Modal...');
    await page.evaluate((id) => {
      window.openProductModal(Number(id));
    }, buffaloGhee.id);
    await new Promise(r => setTimeout(r, 600));

    const buffaloGheeModal = await page.evaluate(() => {
      const title = document.getElementById('modalTitle')?.textContent?.trim();
      const price = document.getElementById('modalPrice')?.textContent?.trim();
      const chips = Array.from(document.querySelectorAll('#variantChips .variant-chip')).map(ch => ({
        label: ch.querySelector('.chip-size')?.textContent?.trim(),
        price: ch.querySelector('.chip-price')?.textContent?.trim()
      }));
      return { title, price, chips };
    });
    console.log('Buffalo Ghee Modal:', JSON.stringify(buffaloGheeModal, null, 2));

    if (!buffaloGheeModal.chips.some(c => c.label.includes('500 g') && c.price.replace(/,/g, '').includes('1100'))) {
      throw new Error('Buffalo Ghee missing 500 g for ₹1,100!');
    }
    if (!buffaloGheeModal.chips.some(c => c.label.includes('1 kg') && c.price.replace(/,/g, '').includes('2000'))) {
      throw new Error('Buffalo Ghee missing 1 kg for ₹2,000!');
    }

    const buffaloGheeScreenshot = path.join(ARTIFACT_DIR, 'pure_buffalo_ghee_product_modal.png');
    await page.screenshot({ path: buffaloGheeScreenshot });
    console.log('Saved Pure Buffalo Ghee modal screenshot:', buffaloGheeScreenshot);

    console.log('\n>>> ALL DAIRY PRODUCTS & GHEE CARDS TESTS PASSED PERFECTLY! <<<');
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();
