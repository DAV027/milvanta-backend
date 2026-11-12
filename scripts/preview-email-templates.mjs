/**
 * Generate local-only synthetic previews of the six Milvanta email templates.
 * Usage: node scripts/preview-email-templates.mjs
 * Never reads .env, queries data, sends messages or calls a payment API.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  renderCustomerOrderEmail,renderAdminOrderEmail,
  renderCustomerSubscriptionEmail,renderAdminSubscriptionEmail,
  renderPasswordResetEmail,renderWelcomeEmail
} from '../src/emailTemplateRenderers.js';

const outputDir = path.join(process.cwd(),'email-previews');
const fakeCustomer={name:'Preview Customer',email:'preview@example.invalid',phone:'9000000000'};
const fakeAddress={name:'Preview Customer',house:'Flat 3B',
  street:'Lakeview Road',city:'Hyderabad',pincode:'500084'};
const fakeOrder={id:902,order_number:'MV-PREVIEW-902',payment_status:'paid',
  order_status:'confirmed',subtotal_paise:159900,
  delivery_charge_paise:5000,total_paise:164900,
  created_at:'2026-11-12T06:00:00.000Z'};
const fakeItems=[
  {name:'Pure Fresh Cow Milk',quantity:2,size:'1 Litre',
    unitPricePaise:79950,lineTotalPaise:159900,
    imageUrl:'assets/milvanta-cow-milk.jpg'}
];
const fakeSubscription={id:904,productName:'Pure Fresh Cow Milk',
  quantity:'1 Litre',frequency:'Daily',timeSlot:'6:00 AM – 7:00 AM',
  costPerDay:105,totalAmount:3150,planType:'month',
  durationLabel:'Monthly recurring',nextDelivery:'Tomorrow, 6:00 AM',
  notes:{keyMode:'test',fulfillmentEntitled:false}};
const orderInput={order:fakeOrder,customer:fakeCustomer,address:fakeAddress,
  items:fakeItems,paymentId:'pay_PREVIEW_ONLY'};
const subInput={subscription:fakeSubscription,customer:fakeCustomer,address:fakeAddress,
  paymentId:'sub_PREVIEW_ONLY'};
const previews=[
  ['Customer order', 'customer-order.html',renderCustomerOrderEmail(orderInput)],
  ['Admin order', 'admin-order.html',renderAdminOrderEmail(orderInput)],
  ['Customer subscription', 'customer-subscription.html',
    renderCustomerSubscriptionEmail(subInput)],
  ['Admin subscription', 'admin-subscription.html',
    renderAdminSubscriptionEmail(subInput)],
  ['Password reset', 'password-reset.html',
    renderPasswordResetEmail({customerName:'Preview Customer',otp:'123456'})],
  ['Welcome', 'welcome.html',renderWelcomeEmail({customerName:'Preview Customer'})]
];
fs.mkdirSync(outputDir,{recursive:true});
for(const [,file,html] of previews)fs.writeFileSync(path.join(outputDir,file),html,'utf8');
const cards=previews.map(([name,file])=>
  '<article><h2>'+name+'</h2><iframe loading="lazy" title="'+name+
  '" src="'+file+'"></iframe><p><a href="'+file+'">Open full email</a></p></article>').join('');
const gallery='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Milvanta — Local Email Previews</title><style>'+
  'body{font-family:Arial,sans-serif;background:#eef4f2;margin:24px;color:#123b56}'+
  'h1{font-size:24px}p{font-size:13px;color:#607583;line-height:1.6}'+
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}'+
  'article{background:white;border:1px solid #d9e5df;border-radius:12px;padding:15px}'+
  'h2{font-size:16px}iframe{width:100%;height:630px;border:1px solid #d9e5df}'+
  'a{color:#16675f}</style></head><body><h1>Milvanta email templates</h1>'+
  '<p>Local synthetic previews only. Nothing is sent, stored in production, or paid.</p>'+
  '<section class="grid">'+cards+'</section></body></html>';
fs.writeFileSync(path.join(outputDir,'index.html'),gallery,'utf8');
console.log('Local previews created:',path.join(outputDir,'index.html'));
