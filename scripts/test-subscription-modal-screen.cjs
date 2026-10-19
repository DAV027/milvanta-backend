const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ARTIFACT_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

function startStaticServer(port = 8116) {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/profile.html';
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
      resolve(server);
    });
  });
}

(async () => {
  let server;
  let browser;

  try {
    server = await startStaticServer(8116);

    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const viewports = [
      { name: 'desktop-1366x768', width: 1366, height: 768 },
      { name: 'desktop-1920x1080', width: 1920, height: 1080 },
      { name: 'laptop-1280x720', width: 1280, height: 720 },
      { name: 'mobile-390x844', width: 390, height: 844 },
      { name: 'mobile-360x640', width: 360, height: 640 }
    ];

    for (const vp of viewports) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('milvanta-user', JSON.stringify({
          id: 1,
          name: 'Akhil',
          email: 'akhil@example.com',
          phone: '6305974564'
        }));
        localStorage.setItem('milvanta-auth-token', 'mock-token-123');
      });
      await page.goto('http://127.0.0.1:8116/profile.html?tab=subscription', { waitUntil: 'networkidle2' });

      // Click to open Create Subscription modal
      await page.evaluate(() => {
        const btn = document.getElementById('btnOpenCreateSubModal');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 400));

      const info = await page.evaluate(() => {
        const modal = document.getElementById('createSubscriptionModal');
        const panel = modal ? modal.querySelector('.subscription-modal-panel') : null;
        if (!modal || !panel) return { error: 'Modal or panel not found' };

        const modalRect = modal.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const style = window.getComputedStyle(panel);

        return {
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          panelRect: {
            top: Math.round(panelRect.top),
            bottom: Math.round(panelRect.bottom),
            height: Math.round(panelRect.height),
            width: Math.round(panelRect.width),
            scrollHeight: panel.scrollHeight,
            clientHeight: panel.clientHeight
          },
          overflowY: style.overflowY,
          maxHeight: style.maxHeight,
          isClippedBottom: panelRect.bottom > window.innerHeight,
          isClippedTop: panelRect.top < 0,
          hasVerticalScrollbar: panel.scrollHeight > panel.clientHeight
        };
      });

      console.log(`Viewport: ${vp.name}`);
      console.log(JSON.stringify(info, null, 2));

      const screenshotPath = path.join(ARTIFACT_DIR, `sub_modal_${vp.name}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`Saved screenshot: ${screenshotPath}\n`);

      await page.close();
    }
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();
