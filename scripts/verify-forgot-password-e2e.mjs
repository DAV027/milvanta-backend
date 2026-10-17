import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import 'dotenv/config';
import { app, pool } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACTS_DIR = 'C:/Users/akhil/.gemini/antigravity/brain/80c9f6d8-6f90-45b8-ad3f-fd5276ec5a8d';

const scrypt = promisify(crypto.scrypt);

function startStaticServer(port = 8096) {
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
      console.log(`✓ Local static server running on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

(async () => {
  let browser;
  let staticServer;
  const backendPort = process.env.PORT || 10000;

  try {
    console.log(`🚀 Starting Full E2E Verification for Forgot Password Flow on http://127.0.0.1:${backendPort}...`);

    // 2. Start Frontend static server on port 8096
    staticServer = await startStaticServer(8096);

    // 3. Seed test user in DB
    const testEmail = 'verify_forgot@milvanta.in';
    const testName = 'Forgot Password Verification User';
    const testPhone = '9988776655';
    const initialPassword = 'InitialOldPassword123!';
    const newPassword = 'BrandNewPassword888!';

    console.log(`Setting up test user: ${testEmail}...`);
    await pool.query('DELETE FROM password_reset_codes WHERE email = $1', [testEmail]);
    await pool.query('DELETE FROM customers WHERE email = $1', [testEmail]);

    const salt = crypto.randomBytes(16);
    const key = await scrypt(initialPassword, salt, 64);
    await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [testName, testEmail, testPhone, salt.toString('hex'), key.toString('hex')]
    );
    console.log('✓ Test user seeded in PostgreSQL database.');

    // 4. Launch Headless Edge
    const edgePath = fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
      ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      : 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';

    browser = await puppeteer.launch({
      executablePath: edgePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,960']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 960 });

    page.on('console', msg => {
      if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
    });

    // Point frontend to our running test backend on 10001
    await page.evaluateOnNewDocument((port) => {
      window.MILVANTA_API_URL = `http://127.0.0.1:${port}`;
    }, backendPort);

    // 5. Open Sign-In modal
    console.log('Navigating to http://127.0.0.1:8096/index.html?auth=login...');
    await page.goto('http://127.0.0.1:8096/index.html?auth=login', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#accountModal:not(.hidden)', { timeout: 6000 });
    console.log('✓ Account Sign-In modal opened.');

    // 6. Verify "Forgot Password?" button below password
    const forgotBtn = await page.$('#btnForgotPassword');
    if (!forgotBtn) throw new Error('Missing #btnForgotPassword in DOM!');
    const isForgotVisible = await page.evaluate(() => {
      const btn = document.getElementById('btnForgotPassword');
      const wrap = document.getElementById('forgotPasswordLinkWrap');
      return btn && wrap && !wrap.classList.contains('hidden') && btn.offsetParent !== null;
    });
    if (!isForgotVisible) throw new Error('Forgot password button is not visible below password!');
    console.log('✓ Found "Forgot Password?" button below password field in Sign-In modal.');

    // Capture screenshot 1: Sign in with Forgot Password link
    const modalElem = await page.$('.account-panel');
    const screenshot1 = path.join(ARTIFACTS_DIR, 'forgot_password_step0_signin_link.png');
    if (modalElem) await modalElem.screenshot({ path: screenshot1 });
    console.log(`Saved screenshot 1 to: ${screenshot1}`);

    // 7. Click "Forgot Password?" -> Step 1 (Enter Email)
    await forgotBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const isStep1 = await page.evaluate(() => {
      const container = document.getElementById('forgotPasswordContainer');
      const step1 = document.getElementById('forgotStepEmailForm');
      return container && !container.classList.contains('hidden') && step1 && !step1.classList.contains('hidden');
    });
    if (!isStep1) throw new Error('Did not transition to Step 1 (Email form)!');
    console.log('✓ Step 1: Registered Email Form visible.');

    // Capture screenshot 2: Step 1 Enter Email
    const screenshot2 = path.join(ARTIFACTS_DIR, 'forgot_password_step1_email_input.png');
    if (modalElem) await modalElem.screenshot({ path: screenshot2 });
    console.log(`Saved screenshot 2 to: ${screenshot2}`);

    // 8. Submit Step 1 with registered email
    await page.type('#forgotEmailInput', testEmail, { delay: 15 });
    console.log(`Submitting email ${testEmail} to generate OTP...`);
    await page.click('#btnSendForgotOtp');

    // Wait for Step 2 OTP form to appear
    await page.waitForSelector('#forgotStepOtpForm:not(.hidden)', { timeout: 8000 });
    console.log('✓ Step 2: OTP verification form displayed.');

    // Verify OTP record exists in DB and get the raw OTP by inspecting DB or test log
    const codeRecord = await pool.query('SELECT * FROM password_reset_codes WHERE email = $1', [testEmail]);
    if (codeRecord.rows.length === 0) {
      throw new Error('No password_reset_codes record found in database for email!');
    }
    console.log('✓ Database recorded OTP hash with expiry at:', codeRecord.rows[0].expires_at);

    // Let's find the OTP by matching the 6-digit hash (100000..999999) or from server log
    const storedHash = codeRecord.rows[0].otp_hash;
    let foundOtp = null;
    for (let c = 100000; c <= 999999; c++) {
      const h = crypto.createHash('sha256').update(String(c) + testEmail).digest('hex');
      if (h === storedHash) {
        foundOtp = String(c);
        break;
      }
    }
    if (!foundOtp) throw new Error('Could not resolve OTP from hash for testing!');
    console.log(`✓ Resolved OTP for testing: ${foundOtp}`);

    // Capture screenshot 3: Step 2 OTP Input
    const screenshot3 = path.join(ARTIFACTS_DIR, 'forgot_password_step2_otp_input.png');
    if (modalElem) await modalElem.screenshot({ path: screenshot3 });
    console.log(`Saved screenshot 3 to: ${screenshot3}`);

    // Test invalid OTP first
    console.log('Testing invalid OTP rejection (000000)...');
    await page.type('#forgotOtpInput', '000000');
    await page.click('#btnVerifyForgotOtp');
    await new Promise(r => setTimeout(r, 600));

    const errMsg = await page.$eval('#accountMessage', el => el.innerText);
    if (!errMsg.includes('Incorrect OTP')) {
      throw new Error(`Expected incorrect OTP error, but got: "${errMsg}"`);
    }
    console.log(`✓ Invalid OTP cleanly rejected: "${errMsg}"`);

    // Now enter valid OTP
    await page.evaluate(() => { document.getElementById('forgotOtpInput').value = ''; });
    await page.type('#forgotOtpInput', foundOtp, { delay: 20 });
    console.log(`Submitting valid OTP ${foundOtp}...`);
    await page.click('#btnVerifyForgotOtp');

    // Wait for Step 3 Reset Password form
    await page.waitForSelector('#forgotStepResetForm:not(.hidden)', { timeout: 8000 });
    console.log('✓ Step 3: New Password & Re-enter Password form displayed.');

    // Capture screenshot 4: Step 3 Password Form
    const screenshot4 = path.join(ARTIFACTS_DIR, 'forgot_password_step3_new_password.png');
    if (modalElem) await modalElem.screenshot({ path: screenshot4 });
    console.log(`Saved screenshot 4 to: ${screenshot4}`);

    // Enter mismatched passwords first to test client validation
    console.log('Testing password mismatch validation...');
    await page.type('#forgotNewPassword', newPassword);
    await page.type('#forgotConfirmPassword', 'Mismatch123!');
    await page.click('#btnSubmitNewPassword');
    await new Promise(r => setTimeout(r, 300));

    const mismatchMsg = await page.$eval('#accountMessage', el => el.innerText);
    if (!mismatchMsg.includes('Passwords do not match')) {
      throw new Error(`Expected password mismatch error, got: "${mismatchMsg}"`);
    }
    console.log(`✓ Password mismatch validation verified: "${mismatchMsg}"`);

    // Fix confirm password to match
    await page.evaluate(() => { document.getElementById('forgotConfirmPassword').value = ''; });
    await page.type('#forgotConfirmPassword', newPassword);
    console.log('Submitting matching new password...');
    await page.click('#btnSubmitNewPassword');

    // 9. Verify transition back to Sign-In
    await page.waitForSelector('#accountForm:not(.hidden)', { timeout: 8000 });
    console.log('✓ Successfully returned to Sign-In form.');

    // Verify email is pre-filled and success banner is displayed
    const prefilledEmail = await page.$eval('#accountForm input[name="email"]', el => el.value);
    const successBanner = await page.$eval('#accountMessage', el => el.innerText);

    if (prefilledEmail !== testEmail) {
      throw new Error(`Expected pre-filled email "${testEmail}", got "${prefilledEmail}"`);
    }
    if (!successBanner.includes('Password reset successfully')) {
      throw new Error(`Expected password reset success banner, got "${successBanner}"`);
    }
    console.log(`✓ Pre-filled email verified: ${prefilledEmail}`);
    console.log(`✓ Success banner verified: "${successBanner}"`);

    // Capture screenshot 5: Back to Sign In with success message
    const screenshot5 = path.join(ARTIFACTS_DIR, 'forgot_password_step4_back_to_signin_success.png');
    if (modalElem) await modalElem.screenshot({ path: screenshot5 });
    console.log(`Saved screenshot 5 to: ${screenshot5}`);

    // 10. Sign in with the brand new password to confirm complete authentication cycle
    console.log('Signing in with brand new password to verify credentials in database...');
    await page.type('#accountPassword', newPassword, { delay: 15 });
    await page.click('#accountSubmit');

    // Wait for account modal to close or show logged-in state
    await new Promise(r => setTimeout(r, 1200));

    // Verify session in localStorage
    const savedUser = await page.evaluate(() => {
      const u = localStorage.getItem('milvanta-user');
      return u ? JSON.parse(u) : null;
    });

    if (!savedUser || savedUser.email !== testEmail) {
      throw new Error(`Failed to sign in with new password! Saved user: ${JSON.stringify(savedUser)}`);
    }
    console.log(`✓ Successfully signed in with new password! Authenticated customer: ${savedUser.name} (${savedUser.email})`);

    console.log('🎉 ALL FORGOT PASSWORD STEPS PASSED 100% PERFECTLY!');
  } catch (err) {
    console.error('❌ E2E Verification failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    if (staticServer) staticServer.close();
    await app.close();
    await pool.end();
  }
})();
