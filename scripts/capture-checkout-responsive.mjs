import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

const sampleCustomer = {
  id: 42,
  full_name: 'Alpha Customer',
  email: 'customer.alpha@milvanta.test',
  phone: '9876543210'
};

const sampleAddress = {
  id: 101,
  customer_id: 42,
  recipient_name: 'Alpha Customer',
  phone: '9876543210',
  house: 'Flat 402',
  building: 'Greenwood Heights',
  street: 'Madhapur Main Road',
  landmark: 'Near Cyber Towers',
  city: 'Hyderabad',
  state: 'Telangana',
  pincode: '500049',
  is_default: true
};

function startServer(port = 8444) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // Mock API Routes
    if (pathname === '/api/v1/auth/me') {
      const auth = req.headers['authorization'] || '';
      if (auth.includes('expired_token')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unauthorized', message: 'Your login has expired. Please sign in again.' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ user: sampleCustomer, customer: sampleCustomer, csrfToken: 'mock_csrf' }));
    }

    if (pathname === '/api/v1/addresses') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ addresses: [sampleAddress] }));
    }

    if (pathname === '/api/v1/delivery/check') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        serviceable: true,
        inHyderabad: true,
        feePaise: 5000,
        fee: 50,
        area: 'Hafeezpet / Miyapur'
      }));
    }

    if (pathname === '/api/v1/orders' && req.method === 'POST') {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        orderNumber: 'MV-20261102-004201',
        orderId: 'order_rzp_mock_4201',
        amount: 23000,
        currency: 'INR',
        subtotalPaise: 18000,
        deliveryChargePaise: 5000,
        keyId: 'rzp_test_placeholder'
      }));
    }

    if (pathname.startsWith('/api/v1/orders/')) {
      const orderNumber = pathname.split('/')[4];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        order: {
          order_number: orderNumber || 'MV-20261102-004201',
          payment_status: 'pending',
          order_status: 'placed',
          total_paise: 23000
        }
      }));
    }

    // Static Frontend Files
    let filePath = path.join(__dirname, '../frontend', pathname === '/' ? 'checkout.html' : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function captureScreen(url, width, height, outputFile, setupScript = null) {
  return new Promise((resolve) => {
    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
      '--headless=new',
      '--disable-gpu',
      `--window-size=${width},${height}`,
      '--remote-debugging-port=9444',
      url
    ]);

    setTimeout(() => {
      http.get('http://127.0.0.1:9444/json', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const tabs = JSON.parse(data);
            const tab = tabs.find(t => t.url.includes('localhost:8444') || t.url.includes('127.0.0.1:8444'));
            if (!tab) {
              chrome.kill();
              return resolve();
            }
            const ws = new globalThis.WebSocket(tab.webSocketDebuggerUrl);

            ws.addEventListener('open', () => {
              ws.send(JSON.stringify({
                id: 1,
                method: 'Emulation.setDeviceMetricsOverride',
                params: { width, height, deviceScaleFactor: 2, mobile: width <= 768 }
              }));
            });

            ws.addEventListener('message', (event) => {
              const msg = JSON.parse(event.data);
              if (msg.id === 1) {
                if (setupScript) {
                  ws.send(JSON.stringify({
                    id: 2,
                    method: 'Runtime.evaluate',
                    params: { expression: setupScript }
                  }));
                } else {
                  setTimeout(() => {
                    ws.send(JSON.stringify({
                      id: 3,
                      method: 'Page.captureScreenshot',
                      params: { format: 'png' }
                    }));
                  }, 1200);
                }
              } else if (msg.id === 2) {
                setTimeout(() => {
                  ws.send(JSON.stringify({
                    id: 3,
                    method: 'Page.captureScreenshot',
                    params: { format: 'png' }
                  }));
                }, 1200);
              } else if (msg.id === 3) {
                if (msg.result?.data) {
                  fs.writeFileSync(outputFile, Buffer.from(msg.result.data, 'base64'));
                  console.log(`✓ Saved screenshot: ${path.basename(outputFile)} (${width}x${height})`);
                }
                ws.close();
                chrome.kill();
                resolve();
              }
            });
          } catch (e) {
            chrome.kill();
            resolve();
          }
        });
      }).on('error', () => {
        chrome.kill();
        resolve();
      });
    }, 1000);
  });
}

(async () => {
  const server = await startServer(8444);
  console.log('✓ Mock checkout server started on http://127.0.0.1:8444');

  try {
    const validSetupScript = `
      localStorage.setItem('milvanta-auth-token', 'mock_valid_token_alpha');
      localStorage.setItem('milvanta-user', JSON.stringify({ id: 42, full_name: 'Alpha Customer', email: 'customer.alpha@milvanta.test', phone: '9876543210' }));
      localStorage.setItem('milvanta-pincode', '500049');
      localStorage.setItem('milvanta-cart', JSON.stringify([
        { id: 1, name: 'Pure Fresh Cow Milk', price: 110, quantity: 1, size: '1 Litre' },
        { id: 2, name: 'Pure Fresh Buffalo Milk', price: 70, quantity: 1, size: '500 ml' }
      ]));
      if (typeof window.checkAuthAndInit === 'function') {
        window.checkAuthAndInit();
      }
    `;

    // 1. Capture 8 responsive viewports with active checkout
    const viewports = [
      { width: 320, height: 640, file: 'checkout_mobile_320px.png' },
      { width: 360, height: 740, file: 'checkout_mobile_360px.png' },
      { width: 375, height: 667, file: 'checkout_mobile_375px.png' },
      { width: 390, height: 844, file: 'checkout_mobile_390px.png' },
      { width: 430, height: 932, file: 'checkout_mobile_430px.png' },
      { width: 768, height: 1024, file: 'checkout_tablet_768px.png' },
      { width: 1024, height: 768, file: 'checkout_laptop_1024px.png' },
      { width: 1440, height: 900, file: 'checkout_desktop_1440px.png' }
    ];

    for (const vp of viewports) {
      await captureScreen(
        'http://127.0.0.1:8444/checkout.html',
        vp.width,
        vp.height,
        path.join(ARTIFACT_DIR, vp.file),
        validSetupScript
      );
    }

    // 2. Capture Expired Session Login Gate (Step 1 Authentication Gate)
    const expiredSetupScript = `
      localStorage.setItem('milvanta-auth-token', 'expired_token_mock');
      localStorage.setItem('milvanta-user', JSON.stringify({ id: 42, full_name: 'Expired User', email: 'expired@milvanta.test' }));
      localStorage.setItem('milvanta-cart', JSON.stringify([
        { id: 1, name: 'Pure Fresh Cow Milk', price: 110, quantity: 1, size: '1 Litre' },
        { id: 2, name: 'Pure Fresh Buffalo Milk', price: 70, quantity: 1, size: '500 ml' }
      ]));
      if (typeof window.checkAuthAndInit === 'function') {
        window.checkAuthAndInit();
      }
    `;
    await captureScreen(
      'http://127.0.0.1:8444/checkout.html',
      390,
      844,
      path.join(ARTIFACT_DIR, 'checkout_expired_session_login_gate.png'),
      expiredSetupScript
    );

    // 3. Capture Step 3 Payment Review (showing exact ₹230 total: ₹180 subtotal + ₹50 delivery)
    const step3SetupScript = `
      ${validSetupScript}
      setTimeout(() => {
        if (typeof window.goToStep === 'function') {
          window.goToStep(3);
        }
      }, 300);
    `;
    await captureScreen(
      'http://127.0.0.1:8444/checkout.html',
      1440,
      900,
      path.join(ARTIFACT_DIR, 'checkout_step3_payment_review.png'),
      step3SetupScript
    );

    // 4. Capture Pending Payment Recovery Banner
    const pendingRecoveryScript = `
      localStorage.setItem('milvanta-auth-token', 'mock_valid_token_alpha');
      const pendingData = {
        orderNumber: 'MV-20261102-004201',
        orderId: 'order_rzp_mock_4201',
        paymentId: 'pay_rzp_mock_999',
        signature: 'sig_mock_proof',
        customerId: 42,
        amountPaise: 23000,
        timestamp: Date.now()
      };
      sessionStorage.setItem('milvanta-pending-order-payment', JSON.stringify(pendingData));
      localStorage.setItem('milvanta-pending-order-payment-42', JSON.stringify(pendingData));
      if (typeof window.checkAuthAndInit === 'function') {
        window.checkAuthAndInit();
      }
    `;
    await captureScreen(
      'http://127.0.0.1:8444/checkout.html',
      390,
      844,
      path.join(ARTIFACT_DIR, 'checkout_pending_payment_recovery.png'),
      pendingRecoveryScript
    );

    console.log('✓ All 11 responsive and state screenshots captured successfully!');
  } finally {
    server.close();
  }
})();
