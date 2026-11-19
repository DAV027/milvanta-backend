import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = 'C:\\Users\\akhil\\.gemini\\antigravity\\brain\\80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

const viewports = [
  { name: '1440px', width: 1440, height: 900 },
  { name: '768px', width: 768, height: 1024 },
  { name: '390px', width: 390, height: 844 },
  { name: '360px', width: 360, height: 740 }
];

async function capture() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const indexUrl = `file:///${path.resolve(__dirname, '../frontend/index.html').replace(/\\/g, '/')}`;
  const adminUrl = `file:///${path.resolve(__dirname, '../frontend/admin.html').replace(/\\/g, '/')}`;

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1
    });

    // 1. Storefront
    const pageIndex = await context.newPage();
    await pageIndex.goto(indexUrl, { waitUntil: 'load' });
    await pageIndex.waitForTimeout(600);
    const storefrontShotPath = path.join(artifactDir, `storefront_pure_milk_${vp.name}.png`);
    await pageIndex.screenshot({ path: storefrontShotPath, fullPage: false });
    console.log(`Saved storefront screenshot: ${storefrontShotPath}`);
    await pageIndex.close();

    // 2. Admin Portal (Milk Stock / Deliveries View)
    const pageAdmin = await context.newPage();
    await pageAdmin.goto(adminUrl, { waitUntil: 'load' });
    await pageAdmin.waitForTimeout(600);
    // Simulate logged in state / switch to demand tab to show milk stock
    await pageAdmin.evaluate(() => {
      if (typeof window.showDashboard === 'function') window.showDashboard();
      const el = document.getElementById('loginCard');
      if (el) el.style.display = 'none';
      const dash = document.getElementById('adminAppArea');
      if (dash) dash.style.display = 'block';
      const demandSec = document.getElementById('demandSection');
      if (demandSec) demandSec.classList.remove('hidden');
      const authCont = document.getElementById('authContainer');
      if (authCont) authCont.style.display = 'none';
    });
    await pageAdmin.waitForTimeout(300);
    const adminShotPath = path.join(artifactDir, `admin_milk_capacity_${vp.name}.png`);
    await pageAdmin.screenshot({ path: adminShotPath, fullPage: false });
    console.log(`Saved admin screenshot: ${adminShotPath}`);
    await pageAdmin.close();

    await context.close();
  }

  await browser.close();
  console.log('All responsive screenshots captured successfully.');
}

capture().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
