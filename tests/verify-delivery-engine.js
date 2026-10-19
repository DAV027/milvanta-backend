import { getDeliveryInfo, isHyderabadPincode } from '../src/delivery.js';

console.log('--- Testing Delivery Engine (src/delivery.js) ---');

const testCases = [
  { pin: '500001', expectedArea: 'Abids', expectedFee: 80, serviceable: true },
  { pin: '500002', expectedArea: 'Charminar', expectedFee: 80, serviceable: true },
  { pin: '500003', expectedArea: 'Secunderabad', expectedFee: 80, serviceable: true },
  { pin: '500004', expectedArea: 'Khairatabad', expectedFee: 80, serviceable: true },
  { pin: '500034', expectedArea: 'Banjara Hills', expectedFee: 80, serviceable: true },
  { pin: '500049', expectedArea: 'Hafeezpet', expectedFee: 50, serviceable: true },
  { pin: '500084', expectedArea: 'Kondapur', expectedFee: 50, serviceable: true },
  { pin: '500096', expectedArea: 'Boduppal', expectedFee: 80, serviceable: true },
  { pin: '502032', expectedArea: 'Tellapur', expectedFee: 80, serviceable: true },
  { pin: '560001', expectedArea: 'Outside Hyd', serviceable: false, inHyderabad: false }
];

let failed = 0;
for (const tc of testCases) {
  const info = getDeliveryInfo(tc.pin);
  const matchService = info.serviceable === tc.serviceable;
  const matchArea = info.shortArea === tc.expectedArea;
  const matchFee = tc.expectedFee ? info.feePaise === tc.expectedFee * 100 : true;
  if (!matchService || !matchArea || !matchFee) {
    console.error(`FAILED for PIN ${tc.pin}:`, info);
    failed++;
  } else {
    console.log(`✓ PIN ${tc.pin}: shortArea="${info.shortArea}", feePaise=${info.feePaise}, serviceable=${info.serviceable}`);
  }
}

// Test complete range 500001 to 500096
let rangeFailed = 0;
for (let i = 1; i <= 96; i++) {
  const pin = '500' + String(i).padStart(3, '0');
  const info = getDeliveryInfo(pin);
  if (!info.serviceable || !info.inHyderabad || !info.shortArea) {
    console.error(`Range test failed for ${pin}:`, info);
    rangeFailed++;
  }
}

console.log(`All 500001–500096 pins serviceable test: ${rangeFailed === 0 ? 'PASSED (96/96)' : 'FAILED'}`);
if (failed > 0 || rangeFailed > 0) process.exit(1);
console.log('All backend delivery engine tests passed successfully!');

