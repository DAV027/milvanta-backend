import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  renderCustomerOrderEmail as buildCustomerOrderEmail,
  renderAdminOrderEmail as buildAdminOrderEmail,
  renderCustomerSubscriptionEmail as buildCustomerSubscriptionEmail,
  renderAdminSubscriptionEmail as buildAdminSubscriptionEmail,
  renderPasswordResetEmail as buildPasswordResetEmail,
  renderWelcomeEmail as buildWelcomeEmail
} from '../src/emailTemplateRenderers.js';

const order = {
  id:4,order_number:'MV-20261112-0004',
  payment_status:'paid',order_status:'confirmed',
  subtotal_paise:159900,delivery_charge_paise:5000,
  total_paise:164900,created_at:'2026-11-12T06:00:00Z'
};
const customer={name:'Customer & Family',email:'customer@example.test',phone:'9000000000'};
const address={name:'Recipient',house:'Flat 4',street:'Lake Road',city:'Hyderabad',pincode:'500084'};
const items=[{name:'Cow Milk',size:'1 Litre',quantity:2,
  unitPricePaise:79950,lineTotalPaise:159900,imageUrl:'assets/milvanta-cow-milk.jpg'}];

test('customer and admin receipts share responsive table layout, verified totals and payment references',()=>{
  for(const html of [
    buildCustomerOrderEmail({order,customer,address,items,paymentId:'pay_test_123'}),
    buildAdminOrderEmail({order,customer,address,items,paymentId:'pay_test_123'})
  ]){
    assert.match(html,/<!doctype html>/i);
    assert.match(html,/<meta name="viewport"/);
    assert.match(html,/<table role="presentation"/);
    assert.match(html,/MV-20261112-0004/);
    assert.match(html,/₹1,599/);
    assert.match(html,/₹50/);
    assert.match(html,/₹1,649/);
    assert.match(html,/pay_test_123/);
    assert.match(html,/Asia\/Kolkata|IST/);
    assert.match(html,/https:\/\/milvanta\.in\/assets\/milvanta-cow-milk\.jpg/);
    assert.match(html,/Hafeezpet Hub/);
    assert.doesNotMatch(html,/linear-gradient|<script\b/i);
  }
});

test('unverified or incomplete receipts never create zero-price or paid assertions',()=>{
  const html=buildCustomerOrderEmail({
    order:{...order,order_status:'payment_review',total_paise:undefined},
    customer,address,items
  });
  assert.match(html,/Your order summary/);
  assert.match(html,/Check payment verification status/);
  assert.match(html,/Receipt totals are pending verification/);
  assert.doesNotMatch(html,/Order confirmed|₹0\b/);
});

test('subscription templates avoid tomorrow promises and fabricated payments',()=>{
  const subscription={
    productName:'Pure Fresh Cow Milk',quantity:'1 Litre',
    costPerDay:105,totalAmount:3150,
    nextDelivery:'Tomorrow, 6:00 AM',
    timeSlot:'6:00 AM – 7:00 AM',
    notes:{keyMode:'test',fulfillmentEntitled:false}
  };
  const inputs={subscription,customer,address,paymentId:'sub_example'};
  for(const html of [buildCustomerSubscriptionEmail(inputs),
    buildAdminSubscriptionEmail(inputs)]){
    assert.match(html,/Pending delivery scheduling/);
    assert.match(html,/₹105/);
    assert.match(html,/₹3,150/);
    assert.match(html,/6:00 AM – 7:00 AM/);
    assert.doesNotMatch(html,/Tomorrow, 6:00 AM|Total Amount Paid|Add customer to tomorrow|First Delivery Scheduled/);
    assert.doesNotMatch(html,/₹50|₹55/);
  }
});

test('autopay mandate email distinguishes authorization from captured subscription payment',()=>{
  const html=buildCustomerSubscriptionEmail({
    subscription:{
      productName:'Buffalo Milk',authType:'refundable_authorization',
      notes:{authAmountPaise:20000},totalAmount:3150
    },customer,address
  });
  assert.match(html,/Autopay mandate registered/);
  assert.match(html,/Mandate authorization \(not plan payment\)/);
  assert.match(html,/₹200/);
  assert.match(html,/Pending delivery scheduling/);
  assert.doesNotMatch(html,/Total Amount Paid|Mandate Activated|deliveries are scheduled/);
});

test('explicit earliest eligible date is not described as a scheduled order',()=>{
  const html=buildCustomerSubscriptionEmail({
    subscription:{productName:'Cow Milk',
      firstEligibleDeliveryDate:'2026-11-14',notes:{keyMode:'live'}},
    customer,address
  });
  assert.match(html,/2026-11-14/);
  assert.match(html,/Earliest eligible morning — not yet scheduled/);
  assert.doesNotMatch(html,/First Delivery Scheduled/);
});

test('customer-controlled details, OTP and image URLs are escaped or rejected',()=>{
  const dangerous='"><img src=x onerror=alert(1)>';
  const badItems=[{name:dangerous,imageUrl:'javascript:alert(1)',quantity:1,
    unitPricePaise:10000,lineTotalPaise:10000}];
  const receipt=buildCustomerOrderEmail({
    order:{...order,subtotal_paise:10000,total_paise:15000},
    customer:{name:dangerous},address:{street:dangerous},items:badItems
  });
  assert.doesNotMatch(receipt,/<img src=x onerror=/);
  assert.doesNotMatch(receipt,/src="javascript:/);
  assert.match(receipt,/&lt;img src=x onerror=alert\(1\)&gt;/);
  const sub=buildAdminSubscriptionEmail({subscription:{productName:dangerous},
    customer:{name:dangerous},address});
  assert.doesNotMatch(sub,/<img src=x onerror=/);
  const otp=buildPasswordResetEmail({customerName:dangerous,otp:dangerous});
  assert.doesNotMatch(otp,/<img src=x onerror=/);
  assert.match(otp,/Never share it with anyone/);
  const welcome=buildWelcomeEmail({customerName:dangerous});
  assert.doesNotMatch(welcome,/<img src=x onerror=/);
});

test('welcome and reset templates provide clear accessible calls to action',()=>{
  const welcome=buildWelcomeEmail({customerName:'New Customer'});
  assert.match(welcome,/Fresh starts here/);
  assert.match(welcome,/href="https:\/\/milvanta\.in"/);
  assert.match(welcome,/Delivery availability/);
  const reset=buildPasswordResetEmail({customerName:'New Customer',otp:'123456'});
  assert.match(reset,/123456/);
  assert.match(reset,/10 minutes/);
  assert.match(reset,/Account security/);
});


test('synthetic preview generator creates all six email files and never sends messages',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'milvanta-email-preview-'));
  try {
    const script=fileURLToPath(new URL('../scripts/preview-email-templates.mjs',import.meta.url));
    const run=spawnSync(process.execPath,[script],{cwd:temp,encoding:'utf8',
      timeout:15000,env:{PATH:process.env.PATH || '',HOME:temp}});
    assert.equal(run.status,0,run.stderr || run.stdout);
    const directory=path.join(temp,'email-previews');
    const files=fs.readdirSync(directory).sort();
    assert.deepEqual(files,[
      'admin-order.html','admin-subscription.html','customer-order.html',
      'customer-subscription.html','index.html','password-reset.html','welcome.html'
    ]);
    const gallery=fs.readFileSync(path.join(directory,'index.html'),'utf8');
    assert.match(gallery,/Local synthetic previews only/);
    for(const name of files.filter(file=>file!=='index.html')){
      const html=fs.readFileSync(path.join(directory,name),'utf8');
      assert.match(html,/<!doctype html>/i);
      assert.match(html,/MILVANTA/);
      assert.doesNotMatch(html,/<script\b|undefined|NaN|Infinity/);
    }
    const subscription=fs.readFileSync(path.join(directory,'customer-subscription.html'),'utf8');
    assert.match(subscription,/Pending delivery scheduling/);
    assert.doesNotMatch(subscription,/Tomorrow, 6:00 AM/);
  } finally {
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('prices preserve paise precision and never invent an amount for incomplete source rows',()=>{
  const receipt=buildCustomerOrderEmail({
    order:{order_number:'MV-PAISE',payment_status:'paid',order_status:'confirmed',
      subtotal_paise:10575,delivery_charge_paise:0,total_paise:10575},
    customer,address,items:[{name:'Milk',quantity:1,unitPricePaise:10575,lineTotalPaise:10575}]
  });
  assert.match(receipt,/₹105\.75/);
  assert.match(receipt,/FREE/);
  assert.doesNotMatch(receipt,/₹106\b/);

  const missing=buildCustomerSubscriptionEmail({
    subscription:{productName:'Milk',costPerDay:null,totalAmount:null},
    customer,address
  });
  assert.doesNotMatch(missing,/Reference daily rate[\s\S]{0,130}₹0\b/);
  assert.doesNotMatch(missing,/Plan amount[\s\S]{0,130}₹0\b/);
});
