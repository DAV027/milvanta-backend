import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]); }
test('only Meta is reachable from active phone-messaging code and configuration',()=>{
  for(const file of [...files('src'),...files('scripts'),'.env.example','render.yaml','render.staging.yaml']) {
    if(file.endsWith('.sql')) continue;
    const content=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(content,/twilio|smsTemplates|NOTIFICATION_PROVIDER|NOTIFICATION_DRAIN_PREVIOUS_PROVIDER|notificationProvider/i,file);
  }
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.equal(pkg.dependencies.twilio,undefined);
  assert.doesNotMatch(fs.readFileSync('package-lock.json','utf8'),/node_modules\/twilio|"twilio"/i);
  assert.equal(fs.existsSync(path.join(root,'src/services/twilioService.js')),false);
});
test('customer frontend offers WhatsApp exclusively and retains consent/OTP controls',()=>{
  for(const f of files('frontend').filter(file=>/\.(?:html|js)$/.test(file))) {
    const s=fs.readFileSync(f,'utf8');
    assert.doesNotMatch(s,/twilio|\bSMS\b|config\.provider/i,f);
  }
  const profile=fs.readFileSync('frontend/profile.html','utf8');
  for(const label of ['Verify with WhatsApp','Send OTP to WhatsApp','WhatsApp Notifications']) assert.ok(profile.includes(label),label);
});
test('email password recovery remains clearly separate from phone verification',()=>{
  const html=fs.readFileSync('frontend/index.html','utf8');
  assert.match(html, /id="btnResendForgotOtp"[^>]*>Resend email OTP<\/button>/);
  assert.match(html, /id="btnResendPhoneOtp"[^>]*>Send OTP to WhatsApp<\/button>/);
});
