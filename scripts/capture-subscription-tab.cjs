const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ARTIFACT_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

function startStaticServer(port = 8118) {
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
    server = await startStaticServer(8118);
    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });

    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('milvanta-user', JSON.stringify({
        id: 1, name: 'Akhil', email: 'akhil@example.com', phone: '6305974564'
      }));
      localStorage.setItem('milvanta-auth-token', 'mock-token-123');
      localStorage.setItem('milvanta-subscriptions', JSON.stringify([
        {
          id: 1,
          product: 'Pure Fresh Cow Milk',
          quantity: '1 Litre',
          frequency: 'Daily (Every Morning)',
          timeSlot: '6:00 AM – 7:00 AM',
          status: 'active',
          nextDelivery: 'Tomorrow, 19 Oct 2026',
          costPerDay: 105,
          days: 31,
          totalAmount: 3255,
          image: 'assets/milvanta-cow-milk.jpg',
          durationLabel: 'October 2026 (31 Days)'
        }
      ]));
    });

    await page.goto('http://127.0.0.1:8118/profile.html?tab=subscription', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));

    const shot1 = path.join(ARTIFACT_DIR, 'profile_subscription_tab_current.png');
    await page.screenshot({ path: shot1, fullPage: true });
    console.log('Saved desktop screenshot:', shot1);

    // Mobile viewport
    await page.setViewport({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));

    const shot2 = path.join(ARTIFACT_DIR, 'profile_subscription_tab_mobile.png');
    await page.screenshot({ path: shot2, fullPage: true });
    console.log('Saved mobile screenshot:', shot2);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();
