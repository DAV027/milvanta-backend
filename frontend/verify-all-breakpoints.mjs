import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

async function testBreakpoint(width, height, filename) {
  return new Promise((resolve, reject) => {
    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
      '--headless=new',
      '--disable-gpu',
      `--window-size=${width},${height}`,
      '--remote-debugging-port=9229',
      'http://localhost:8080/'
    ]);

    setTimeout(() => {
      http.get('http://localhost:9229/json', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const tabs = JSON.parse(data);
          const tab = tabs.find(t => t.url.includes('localhost:8080'));
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
              setTimeout(() => {
                ws.send(JSON.stringify({
                  id: 2,
                  method: 'Page.captureScreenshot',
                  params: { format: 'png' }
                }));
              }, 500);
            } else if (msg.id === 2) {
              fs.writeFileSync(`frontend/${filename}`, Buffer.from(msg.result.data, 'base64'));
              ws.close();
              chrome.kill();
              resolve();
            }
          });
        });
      }).on('error', (e) => {
        chrome.kill();
        reject(e);
      });
    }, 1500);
  });
}

await testBreakpoint(1280, 800, 'screenshot-verify-1280.png');
await testBreakpoint(950, 800, 'screenshot-verify-950.png');
await testBreakpoint(768, 800, 'screenshot-verify-768.png');
await testBreakpoint(375, 812, 'screenshot-verify-375.png');
console.log('All breakpoint verifications captured');

