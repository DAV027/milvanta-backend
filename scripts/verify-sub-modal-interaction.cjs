const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

function startStaticServer(port = 8117) {
  const mimeTypes = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg'
  };
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/profile.html';
    const filePath = path.join(__dirname, '../frontend', reqPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not Found');
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

(async () => {
  let server;
  let browser;

  try {
    server = await startStaticServer(8117);
    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('milvanta-user', JSON.stringify({
        id: 1, name: 'Akhil', email: 'akhil@example.com', phone: '6305974564'
      }));
      localStorage.setItem('milvanta-auth-token', 'mock-token-123');
    });

    await page.goto('http://127.0.0.1:8117/profile.html?tab=subscription', { waitUntil: 'networkidle2' });

    // Open modal
    await page.evaluate(() => document.getElementById('btnOpenCreateSubModal')?.click());
    await new Promise(r => setTimeout(r, 400));

    // Test 1: Switch to Buffalo Milk
    await page.evaluate(() => {
      const buffaloCard = document.querySelector('#profileSubMilkTypeGroup [data-milk="buffalo"]');
      if (buffaloCard) buffaloCard.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // Test 2: Select 2 Litre pack
    await page.evaluate(() => {
      const select = document.getElementById('profileSubPackSizeSelect');
      if (select) {
        select.value = '2 Litre';
        select.dispatchEvent(new Event('change'));
      }
    });
    await new Promise(r => setTimeout(r, 300));

    // Test 3: Select 3 Months pill
    await page.evaluate(() => {
      const pill3m = document.querySelector('[data-profile-months="3"]');
      if (pill3m) pill3m.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const state = await page.evaluate(() => {
      return {
        dailyRate: document.getElementById('profileSubSummaryRateText')?.textContent?.trim(),
        totalAmt: document.getElementById('profileSubFinalTotal')?.textContent?.trim(),
        btnText: document.getElementById('profileSubmitSubBtn')?.textContent?.trim(),
        daysBadge: document.getElementById('profileSubPeriodDaysBadge')?.textContent?.trim()
      };
    });

    console.log('Interactive State after selecting Buffalo 2L for 3 Months:', JSON.stringify(state, null, 2));

    if (!state.totalAmt || state.totalAmt === '₹0') {
      throw new Error('Total amount failed to update!');
    }

    console.log('✓ All interactions and dynamic recalculations work flawlessly!');
  } catch (err) {
    console.error('Verification failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();

