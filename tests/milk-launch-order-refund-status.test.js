import 'dotenv/config';
import { describe, it, after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setupDisposableTestSchema, cleanupDisposableTestSchema } from './helpers/testDbGuard.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'milvanta_launch_refund_role_test_min_32_chars';
process.env.ADMIN_API_KEY = 'milvanta_only_disposable_test_admin_key';
const fixture = await setupDisposableTestSchema();
const { app } = await import('../src/server.js');
const pool = fixture.pool;
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const number = 'MV-TEST-MILK-REFUND-1';
let ownerId, ownerToken, strangerToken, orderId;

async function customer(email, phone) {
  const q = await pool.query(
    "INSERT INTO customers(full_name,email,phone,password_salt,password_hash,is_admin) VALUES ('Milk Launch Test',$1,$2,'fake-salt','fake-hash',FALSE) RETURNING id",
    [email,phone]
  );
  const id=q.rows[0].id;
  const token=app.jwt.sign({sub:String(id),email,jti:crypto.randomUUID()});
  await pool.query(
    "INSERT INTO customer_sessions(token_hash,customer_id,csrf_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 hour')",
    [hash(token),id,hash('csrf-'+email)]
  );
  return {id,token};
}

before(async () => {
  await app.ready();
  const owner=await customer('milk-owner@milvanta.test','9876543311');
  const stranger=await customer('milk-stranger@milvanta.test','9876543312');
  ownerId=owner.id;ownerToken=owner.token;strangerToken=stranger.token;
  const result=await pool.query(
    "INSERT INTO customer_orders(order_number,customer_id,idempotency_key,address,items,subtotal_paise,delivery_charge_paise,total_paise,order_status,payment_status,razorpay_payment_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,6000,0,6000,'delivered','paid','pay_test_stub') RETURNING id",
    [number,ownerId,'idem-milk-refund-test',
      JSON.stringify({city:'Hyderabad',street:'Sample Address',pincode:'500081'}),
      JSON.stringify([{name:'Cow Milk',quantity:1,unitPricePaise:6000,lineTotalPaise:6000}])]
  );
  orderId=result.rows[0].id;
});
after(async () => {
  await app.close().catch(()=>{});
  await cleanupDisposableTestSchema(fixture.pool, fixture.schemaName);
});
async function insertRefund(status, suffix){
  await pool.query(
    "INSERT INTO refund_requests(request_number,request_type,customer_id,order_id,order_number,payment_id,requested_amount_paise,reason_category,status,idempotency_key) VALUES($1,'order',$2,$3,$4,'pay_test_stub',1000,'quality_issue',$5,$6)",
    ['MV-REFUND-'+suffix,ownerId,orderId,number,status,'idem-'+suffix]
  );
}
describe('customer-owned order refund statuses', () => {
  it('shows no status before the first request',async()=>{
    const r=await app.inject({method:'GET',url:'/api/v1/orders',headers:{Authorization:'Bearer '+ownerToken}});
    assert.equal(r.statusCode,200,r.payload);
    const order=r.json().orders.find(x=>x.order_number===number);
    assert.ok(order);
    assert.equal(order.refund_status,null);
  });
  it('shows a pending refund in list/detail without internal review data',async()=>{
    await insertRefund('pending','first');
    for(const url of ['/api/v1/orders','/api/v1/orders/'+number]){
      const r=await app.inject({method:'GET',url,headers:{Authorization:'Bearer '+ownerToken}});
      assert.equal(r.statusCode,200,r.payload);
      const order=r.json().order ?? r.json().orders.find(x=>x.order_number===number);
      assert.equal(order.refund_status,'pending');
      assert.equal(order.refund_request_number,'MV-REFUND-first');
      assert.equal(Number(order.refund_requested_amount_paise),1000);
      assert.equal(Object.hasOwn(order,'admin_notes'),false);
      assert.equal(Object.hasOwn(order,'gateway_response'),false);
    }
  });
  it('shows latest request, no other customer orders',async()=>{
    await insertRefund('rejected','second');
    const r=await app.inject({method:'GET',url:'/api/v1/orders',headers:{Authorization:'Bearer '+ownerToken}});
    assert.equal(r.statusCode,200);
    const order=r.json().orders.find(x=>x.order_number===number);
    assert.equal(order.refund_status,'rejected');
    const other=await app.inject({method:'GET',url:'/api/v1/orders',headers:{Authorization:'Bearer '+strangerToken}});
    assert.equal(other.statusCode,200);
    assert.equal(other.json().orders.some(x=>x.order_number===number),false);
    const detail=await app.inject({method:'GET',url:'/api/v1/orders/'+number,headers:{Authorization:'Bearer '+strangerToken}});
    assert.equal(detail.statusCode,404);
  });
  it('requires authentication',async()=>{
    const r=await app.inject({method:'GET',url:'/api/v1/orders'});
    assert.equal(r.statusCode,401);
  });
});

test('HTML/JS deployment mirrors are identical',()=>{
  for(const path of ['index.html','js/script.js','js/profile.js','admin.html']){
    const file=fs.readFileSync(new URL('../frontend/'+path,import.meta.url),'utf8');
    const mirror=fs.readFileSync(new URL('../frontend/cloudflare-upload/'+path,import.meta.url),'utf8');
    assert.equal(file,mirror,path+' mirror mismatch');
  }
});
test('storefront exposes Pure Fresh Milk only and refund history uses real payment status',()=>{
  const html=fs.readFileSync(new URL('../frontend/index.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../frontend/js/script.js',import.meta.url),'utf8');
  const profile=fs.readFileSync(new URL('../frontend/js/profile.js',import.meta.url),'utf8');
  assert.equal((html.match(/data-category-nav="Fresh Milk"/g)||[]).length,3);
  for(const old of ['Dairy Products','Baking Essentials','Healthy Living','Indian Pickles']){
    assert.doesNotMatch(html,new RegExp('data-category-nav="'+old+'"'));
  }
  assert.match(js,/MILK_ONLY_STOREFRONT = true/);
  assert.match(js,/if \(MILK_ONLY_STOREFRONT && !isFreshMilkProduct\(p\)\) return false/);
  assert.match(js,/Live milk availability is temporarily unavailable/);
  assert.match(profile,/refundStatus: typeof row.refund_status/);
  assert.match(profile,/order\.isVerifiedStoreOrder &&/);
  assert.match(profile,/\$\$\('\.refund-item-check'\)/);
});
test('admin navigation keeps essential operations prominent',()=>{
  const html=fs.readFileSync(new URL('../frontend/admin.html',import.meta.url),'utf8');
  for(const id of ['navBtnOverview','navBtnDemand','navBtnOrders','navBtnSubscriptions',
    'navBtnDeliveries','navBtnRefunds','navBtnCustomers','navBtnReports']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/id="adminMoreTools"/);
  assert.match(html,/data-admin-go="demand"/);
  assert.match(html,/category: 'Fresh Milk'/);
});
