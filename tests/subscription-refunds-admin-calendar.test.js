/**
 * MILVANTA — Comprehensive Integration Test Suite
 * Covering Phases 1-8: Admin security, Entitlement ledger, Subscription & Order refunds,
 * Admin refund portal, Calendar SVG UI, and Modify Quantity removal.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertTestDatabaseConfigured,
  setupDisposableTestSchema,
  cleanupDisposableTestSchema
} from './helpers/testDbGuard.js';
import {
  isRecurringAutopaySubscription,
  isPrepaidSubscription,
  addDaysToYMD,
  getEffectivePaidThroughDate,
  skipDeliveryDate,
  unskipDeliveryDate,
  setVacation,
  resumeSubscription,
  cancelSubscriptionWithRefund,
  calculateSubscriptionEntitlement,
  getSubscriptionCalendar,
  formatDateYMD
} from '../src/services/subscriptionService.js';
import {
  calculateOrderRefundEligibility,
  createOrderRefundRequest,
  listAdminRefundRequests,
  approveRefundRequest,
  rejectRefundRequest
} from '../src/services/refundService.js';
import { generateDailyDeliveries } from '../src/services/deliveryEngine.js';

describe('Milvanta — Subscription, Refunds, Calendar & Admin Suite', () => {
  let setup;
  let pool;
  let schemaName;

  let customerId;
  let adminId;
  let prepaidSubId;
  let autopaySubId;
  let testOrderId;
  let testOrderNumber;

  const todayYMD = formatDateYMD(new Date());
  const tomorrowYMD = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDateYMD(d);
  })();
  const futureDateYMD = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return formatDateYMD(d);
  };

  before(async () => {
    assertTestDatabaseConfigured();
    setup = await setupDisposableTestSchema();
    pool = setup.pool;
    schemaName = setup.schemaName;

    // 1. Seed regular customer
    const custRes = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, is_admin)
       VALUES ('Regular Test Customer', 'regular.customer@milvanta.in', '+919876543201', 'salt1', 'hash1', false)
       RETURNING id`
    );
    customerId = custRes.rows[0].id;

    // 2. Seed admin customer
    const adminRes = await pool.query(
      `INSERT INTO customers (full_name, email, phone, password_salt, password_hash, is_admin)
       VALUES ('Ops Admin Officer', 'admin.officer@milvanta.in', '+919876543202', 'salt2', 'hash2', true)
       RETURNING id`
    );
    adminId = adminRes.rows[0].id;

    // 3. Seed customer address
    await pool.query(
      `INSERT INTO customer_addresses (customer_id, address_fingerprint, recipient_name, phone, house, building, street, landmark, city, state, pincode, is_default)
       VALUES ($1, 'fp_cust_1', 'Regular Test Customer', '+919876543201', 'Flat 402', 'Milvanta Greens', 'Hafeezpet Road', 'Near Metro', 'Hyderabad', 'Telangana', '500049', true)`,
      [customerId]
    );

    // 4. Seed Prepaid Subscription (30 days prepaid)
    const prepStart = todayYMD;
    const prepEnd = futureDateYMD(29);
    const subPrepaidRes = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, plan_type, product_id, product_name, quantity, cost_per_day_paise, total_amount_paise,
         status, notes, created_at, updated_at
       ) VALUES (
         $1, 'prepaid', 1, 'Pure Cow Milk', '1 Litre', 10500, 315000,
         'active', $2::jsonb, NOW(), NOW()
       ) RETURNING id`,
      [
        customerId,
        JSON.stringify({
          startDate: prepStart,
          paidThroughDate: prepEnd,
          paymentId: 'pay_test_prepaid_123',
          fulfillmentEntitled: true,
          months: 1
        })
      ]
    );
    prepaidSubId = subPrepaidRes.rows[0].id;

    // 5. Seed Autopay Recurring Subscription
    const autoStart = todayYMD;
    const autoEnd = futureDateYMD(29);
    const subAutopayRes = await pool.query(
      `INSERT INTO customer_subscriptions (
         customer_id, plan_type, product_id, product_name, quantity, cost_per_day_paise, total_amount_paise,
         status, razorpay_subscription_id, notes, created_at, updated_at
       ) VALUES (
         $1, 'continuous', 2, 'Buffalo Milk', '1 Litre', 11500, 345000,
         'active', 'sub_test_rzp_autopay_999', $2::jsonb, NOW(), NOW()
       ) RETURNING id`,
      [
        customerId,
        JSON.stringify({
          startDate: autoStart,
          paidThroughDate: autoEnd,
          lastPaymentId: 'pay_test_autopay_456',
          fulfillmentEntitled: true,
          authType: 'recurring',
          paidCount: 1
        })
      ]
    );
    autopaySubId = subAutopayRes.rows[0].id;

    // 6. Seed Paid Customer Order
    testOrderNumber = `MV-ORD-${Date.now().toString(36).toUpperCase()}`;
    const orderRes = await pool.query(
      `INSERT INTO customer_orders (
         order_number, customer_id, items, subtotal_paise, delivery_charge_paise, total_paise,
         order_status, payment_status, razorpay_order_id, address, idempotency_key
       ) VALUES (
         $1, $2, $3::jsonb, 75000, 5000, 80000,
         'delivered', 'paid', 'order_test_rzp_order_111', $4::jsonb, $5
       ) RETURNING id`,
      [
        testOrderNumber,
        customerId,
        JSON.stringify([
          { productId: 10, name: 'Bespoke Mango Pickle (500g)', quantity: 1, pricePaise: 45000 },
          { productId: 11, name: 'Artisan Brownie Box', quantity: 1, pricePaise: 30000 }
        ]),
        JSON.stringify({ recipient_name: 'Regular Customer', phone: '+919876543201', house: 'Flat 402', city: 'Hyderabad', pincode: '500049' }),
        `idem_order_${Date.now()}`
      ]
    );
    testOrderId = orderRes.rows[0].id;

    // Seed linked payment order
    await pool.query(
      `INSERT INTO payment_orders (razorpay_order_id, razorpay_payment_id, amount_paise, currency, status, customer_order_id, items)
       VALUES ('order_test_rzp_order_111', 'pay_test_order_789', 80000, 'INR', 'captured', $1, $2::jsonb)`,
      [testOrderId, JSON.stringify([{ productId: 10, quantity: 1 }])]
    );
  });

  after(async () => {
    if (setup) {
      await cleanupDisposableTestSchema(setup);
    }
  });

  // ==========================================
  // PHASE 1: Admin Promotion & Security
  // ==========================================
  describe('Phase 1 — Admin Security & Authorization', () => {
    it('confirms regular customer has is_admin = false and admin has is_admin = true in DB', async () => {
      const { rows: regularRows } = await pool.query('SELECT is_admin FROM customers WHERE id = $1', [customerId]);
      assert.strictEqual(regularRows[0].is_admin, false);

      const { rows: adminRows } = await pool.query('SELECT is_admin FROM customers WHERE id = $1', [adminId]);
      assert.strictEqual(adminRows[0].is_admin, true);
    });

    it('promote-admin.js does not write to nonexistent updated_at column in SQL', () => {
      const scriptCode = fs.readFileSync(path.resolve('scripts/promote-admin.js'), 'utf8');
      assert.doesNotMatch(scriptCode, /UPDATE\s+customers\s+SET[\s\S]*?updated_at/i, 'scripts/promote-admin.js must not update updated_at on customers table');
      assert.match(scriptCode, /--confirm|--approved-by-operator/, 'promote-admin.js must require explicit operator confirmation flag');
    });
  });

  // ==========================================
  // PHASE 2: Entitlement Ledger & Plan Identification
  // ==========================================
  describe('Phase 2 — Subscription Entitlement & Delivery Engine', () => {
    it('correctly classifies prepaid vs recurring autopay plans', async () => {
      const { rows: prepRows } = await pool.query('SELECT * FROM customer_subscriptions WHERE id = $1', [prepaidSubId]);
      const { rows: autoRows } = await pool.query('SELECT * FROM customer_subscriptions WHERE id = $1', [autopaySubId]);

      assert.strictEqual(isPrepaidSubscription(prepRows[0]), true);
      assert.strictEqual(isRecurringAutopaySubscription(prepRows[0]), false);

      assert.strictEqual(isRecurringAutopaySubscription(autoRows[0]), true);
      assert.strictEqual(isPrepaidSubscription(autoRows[0]), false);
    });

    it('skipping a date records extension for prepaid and credit for recurring autopay', async () => {
      const skipTargetPrepaid = futureDateYMD(5);
      const skipResPrepaid = await skipDeliveryDate(pool, {
        subscriptionId: prepaidSubId,
        customerId,
        skipDate: skipTargetPrepaid
      });
      assert.strictEqual(skipResPrepaid.success, true);

      // Verify prepaid received billing extension
      const { rows: adjPrep } = await pool.query(
        `SELECT adjustment_type, days_count, amount_paise FROM subscription_billing_adjustments
         WHERE subscription_id = $1 AND notes LIKE '%${skipTargetPrepaid}%'`,
        [prepaidSubId]
      );
      assert.strictEqual(adjPrep.length, 1);
      assert.strictEqual(adjPrep[0].adjustment_type, 'extension');
      assert.strictEqual(adjPrep[0].days_count, 1);

      // Verify entitlement ledger has record
      const { rows: ledgerPrep } = await pool.query(
        `SELECT entry_type, days_delta, amount_paise FROM subscription_entitlement_ledger
         WHERE subscription_id = $1 AND delivery_date = $2`,
        [prepaidSubId, skipTargetPrepaid]
      );
      assert.strictEqual(ledgerPrep.length, 1);
      assert.strictEqual(ledgerPrep[0].entry_type, 'delivery_skipped');
      assert.strictEqual(ledgerPrep[0].days_delta, 1);

      // Skip a date on Autopay
      const skipTargetAutopay = futureDateYMD(6);
      const skipResAutopay = await skipDeliveryDate(pool, {
        subscriptionId: autopaySubId,
        customerId,
        skipDate: skipTargetAutopay
      });
      assert.strictEqual(skipResAutopay.success, true);

      // Verify autopay received billing credit
      const { rows: adjAuto } = await pool.query(
        `SELECT adjustment_type, days_count, amount_paise FROM subscription_billing_adjustments
         WHERE subscription_id = $1 AND notes LIKE '%${skipTargetAutopay}%'`,
        [autopaySubId]
      );
      assert.strictEqual(adjAuto.length, 1);
      assert.strictEqual(adjAuto[0].adjustment_type, 'credit');
      assert.strictEqual(adjAuto[0].days_count, 1);
    });

    it('deliveryEngine recognizes carried-forward prepaid extensions and schedules deliveries beyond base end date', async () => {
      const { rows: subRows } = await pool.query('SELECT * FROM customer_subscriptions WHERE id = $1', [prepaidSubId]);
      const basePaidThrough = subRows[0].notes.paidThroughDate;

      // Base end date was day 29. Net extension is +1 day.
      const effectiveEndDate = await getEffectivePaidThroughDate(pool, subRows[0]);
      assert.strictEqual(effectiveEndDate, addDaysToYMD(basePaidThrough, 1));

      // Target the carried-forward extension day (day 30)
      const extensionDayTarget = addDaysToYMD(basePaidThrough, 1);
      const result = await generateDailyDeliveries(pool, extensionDayTarget);

      // Delivery order should be generated for the carried forward day!
      const { rows: deliveryOrders } = await pool.query(
        `SELECT * FROM subscription_delivery_orders WHERE subscription_id = $1 AND delivery_date = $2`,
        [prepaidSubId, extensionDayTarget]
      );
      assert.strictEqual(deliveryOrders.length, 1, 'Delivery order must be generated for carried-forward extension day');
      assert.strictEqual(deliveryOrders[0].status, 'scheduled');
    });

    it('calculateSubscriptionEntitlement computes authoritative balances and delivered value', async () => {
      const ent = await calculateSubscriptionEntitlement(pool, {
        subscriptionId: prepaidSubId,
        customerId
      });

      assert.ok(ent);
      assert.strictEqual(ent.subscriptionId, prepaidSubId);
      assert.strictEqual(ent.customerId, customerId);
      assert.strictEqual(ent.isAutopay, false);
      assert.strictEqual(ent.costPerDayPaise, 10500);
      assert.strictEqual(ent.totalContractAmountPaise, 315000);
      assert.ok(ent.unusedDays > 0);
      assert.ok(ent.estimatedRefundablePaise > 0);
    });
  });

  // ==========================================
  // PHASE 3: Cancellation & Authoritative Refunds
  // ==========================================
  describe('Phase 3 — Subscription Cancellation & Refund Request Flow', () => {
    it('cancels subscription, cancels future orders, and creates pending refund request', async () => {
      // Mock Razorpay client
      let rzpCancelledCalled = false;
      const mockRazorpay = {
        subscriptions: {
          cancel: async (subId, atCycleEnd) => {
            rzpCancelledCalled = true;
            return { id: subId, status: 'cancelled' };
          }
        }
      };

      const cancelRes = await cancelSubscriptionWithRefund(pool, {
        subscriptionId: prepaidSubId,
        customerId,
        reason: 'Relocating to another city',
        customerNotes: 'Please process refund to my card',
        razorpayClient: mockRazorpay
      });

      assert.strictEqual(cancelRes.success, true);
      assert.strictEqual(cancelRes.status, 'cancelled');
      assert.ok(cancelRes.refundRequest);
      assert.strictEqual(cancelRes.refundRequest.status, 'pending');
      assert.ok(cancelRes.refundRequest.requestedAmount > 0);

      // Verify subscription status is cancelled
      const { rows: subCheck } = await pool.query('SELECT status, next_delivery FROM customer_subscriptions WHERE id = $1', [prepaidSubId]);
      assert.strictEqual(subCheck[0].status, 'cancelled');
      assert.strictEqual(subCheck[0].next_delivery, 'Cancelled');

      // Verify future orders are cancelled
      const { rows: orderCheck } = await pool.query(
        'SELECT status FROM subscription_delivery_orders WHERE subscription_id = $1',
        [prepaidSubId]
      );
      for (const ord of orderCheck) {
        assert.strictEqual(ord.status, 'cancelled');
      }

      // Verify refund request exists in database
      const { rows: rfDb } = await pool.query('SELECT * FROM refund_requests WHERE id = $1', [cancelRes.refundRequest.id]);
      assert.strictEqual(rfDb.length, 1);
      assert.strictEqual(rfDb[0].request_type, 'subscription');
      assert.strictEqual(rfDb[0].status, 'pending');

      // Verify audit history was recorded
      const { rows: rfHist } = await pool.query('SELECT * FROM refund_request_history WHERE refund_request_id = $1', [cancelRes.refundRequest.id]);
      assert.strictEqual(rfHist.length, 1);
      assert.strictEqual(rfHist[0].actor_type, 'customer');

      // Verify ledger has refund_requested entry
      const { rows: ledgerRows } = await pool.query(
        'SELECT entry_type FROM subscription_entitlement_ledger WHERE refund_request_id = $1',
        [cancelRes.refundRequest.id]
      );
      assert.strictEqual(ledgerRows.length, 1);
      assert.strictEqual(ledgerRows[0].entry_type, 'refund_requested');
    });

    it('rejects cancellation on an already cancelled subscription', async () => {
      const res = await cancelSubscriptionWithRefund(pool, {
        subscriptionId: prepaidSubId,
        customerId
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'already_cancelled');
    });
  });

  // ==========================================
  // PHASE 4: Order Refund Requests & Cancelled Orders
  // ==========================================
  describe('Phase 4 — Order Refund Requests & Visibility', () => {
    it('calculates order refund eligibility with itemized prices and maximum balance', async () => {
      const el = await calculateOrderRefundEligibility(pool, {
        orderNumber: testOrderNumber,
        customerId
      });

      assert.strictEqual(el.eligible, true);
      assert.strictEqual(el.orderNumber, testOrderNumber);
      assert.strictEqual(el.totalPaise, 80000);
      assert.strictEqual(el.maxRefundablePaise, 80000);
      assert.strictEqual(el.items.length, 2);
    });

    it('creates partial order refund request for specific damaged item', async () => {
      const reqRes = await createOrderRefundRequest(pool, {
        orderNumber: testOrderNumber,
        customerId,
        reasonCategory: 'damaged_item',
        reasonDetail: 'Glass jar seal broken during courier delivery',
        customerNotes: 'Jar was leaking on arrival',
        selectedItems: [
          { productId: 10, name: 'Bespoke Mango Pickle (500g)', quantity: 1, pricePaise: 45000 }
        ]
      });

      assert.strictEqual(reqRes.success, true);
      assert.ok(reqRes.refundRequest);
      assert.strictEqual(reqRes.refundRequest.requestedAmountPaise, 45000);
      assert.strictEqual(reqRes.refundRequest.requestedAmount, 450);
      assert.strictEqual(reqRes.refundRequest.status, 'pending');

      // Verify DB row
      const { rows: rfRows } = await pool.query('SELECT * FROM refund_requests WHERE id = $1', [reqRes.refundRequest.id]);
      assert.strictEqual(rfRows[0].request_type, 'order');
      assert.strictEqual(rfRows[0].payment_id, 'pay_test_order_789');
    });

    it('subsequent eligibility calculation decrements pending refund from available balance', async () => {
      const el = await calculateOrderRefundEligibility(pool, {
        orderNumber: testOrderNumber,
        customerId
      });

      assert.strictEqual(el.pendingPaise, 45000);
      assert.strictEqual(el.maxRefundablePaise, 35000, 'Available balance should be 80000 - 45000 = 35000');
    });
  });

  // ==========================================
  // PHASE 5: Admin Refund Management Portal
  // ==========================================
  describe('Phase 5 — Admin Refund Management & Gateway Integration', () => {
    let pendingSubRefundId;
    let pendingOrderRefundId;

    before(async () => {
      const { rows: subRf } = await pool.query("SELECT id FROM refund_requests WHERE request_type = 'subscription' LIMIT 1");
      pendingSubRefundId = subRf[0].id;

      const { rows: ordRf } = await pool.query("SELECT id FROM refund_requests WHERE request_type = 'order' LIMIT 1");
      pendingOrderRefundId = ordRf[0].id;
    });

    it('lists refund requests with filter support for admin dashboard', async () => {
      const listRes = await listAdminRefundRequests(pool, { status: 'pending' });
      assert.ok(listRes.requests.length >= 2);
      assert.strictEqual(listRes.stats.pending_count >= 2, true);
      assert.ok(listRes.requests.every(r => r.status === 'pending'));
    });

    it('rejects refund request when mandatory admin note is missing', async () => {
      const res = await rejectRefundRequest(pool, {
        refundRequestId: pendingOrderRefundId,
        adminId,
        adminNotes: ''
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'admin_notes_required');
    });

    it('successfully rejects refund request with mandatory reason', async () => {
      const res = await rejectRefundRequest(pool, {
        refundRequestId: pendingOrderRefundId,
        adminId,
        adminNotes: 'Courier delivery photo confirms undamaged parcel delivered'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'rejected');

      const { rows: rfCheck } = await pool.query('SELECT status, admin_notes FROM refund_requests WHERE id = $1', [pendingOrderRefundId]);
      assert.strictEqual(rfCheck[0].status, 'rejected');
      assert.strictEqual(rfCheck[0].admin_notes, 'Courier delivery photo confirms undamaged parcel delivered');
    });

    it('approves refund request and invokes Razorpay payments refund API with operator confirmation', async () => {
      let rzpRefundCalledWith = null;
      const mockRazorpay = {
        payments: {
          refund: async (paymentId, payload) => {
            rzpRefundCalledWith = { paymentId, payload };
            return {
              id: 'rfnd_test_rzp_mock_123',
              payment_id: paymentId,
              amount: payload.amount,
              currency: 'INR',
              status: 'processed'
            };
          }
        }
      };

      const approveRes = await approveRefundRequest(pool, {
        refundRequestId: pendingSubRefundId,
        adminId,
        approvedAmountPaise: 200000,
        adminNotes: 'Operator verified unused 20 days balance; approved for full refund',
        razorpayClient: mockRazorpay
      });

      assert.strictEqual(approveRes.success, true);
      assert.strictEqual(approveRes.status, 'processed');
      assert.strictEqual(approveRes.gatewayRefundId, 'rfnd_test_rzp_mock_123');

      // Verify Razorpay API was called with payment ID and amount
      assert.ok(rzpRefundCalledWith);
      assert.strictEqual(rzpRefundCalledWith.payload.amount, 200000);

      // Verify DB row status
      const { rows: rfDb } = await pool.query('SELECT status, approved_amount_paise, gateway_refund_id FROM refund_requests WHERE id = $1', [pendingSubRefundId]);
      assert.strictEqual(rfDb[0].status, 'processed');
      assert.strictEqual(rfDb[0].approved_amount_paise, 200000);

      // Verify audit history
      const { rows: histDb } = await pool.query('SELECT * FROM refund_request_history WHERE refund_request_id = $1 AND new_status = $2', [pendingSubRefundId, 'processed']);
      assert.strictEqual(histDb.length, 1);
      assert.strictEqual(histDb[0].actor_type, 'admin');

      // Verify ledger recorded refund_approved
      const { rows: ledgerDb } = await pool.query(
        "SELECT entry_type, amount_paise FROM subscription_entitlement_ledger WHERE refund_request_id = $1 AND entry_type = 'refund_approved'",
        [pendingSubRefundId]
      );
      assert.strictEqual(ledgerDb.length, 1);
      assert.strictEqual(ledgerDb[0].amount_paise, 200000);
    });

    it('prevents double-refund on an already processed request', async () => {
      const res = await approveRefundRequest(pool, {
        refundRequestId: pendingSubRefundId,
        adminId,
        approvedAmountPaise: 200000
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'already_reviewed');
    });
  });

  // ==========================================
  // PHASE 7: Calendar UI & Responsive Design
  // ==========================================
  describe('Phase 7 — Calendar UI with Lucide SVG Icons & Legend', () => {
    it('profile.html contains updated legend with Lucide-style SVG icons', () => {
      const profileHtml = fs.readFileSync(path.resolve('frontend/profile.html'), 'utf8');
      assert.match(profileHtml, /cal-legend-item/, 'profile.html must contain .cal-legend-item elements');
      assert.match(profileHtml, /badge-scheduled/, 'Legend must include badge-scheduled');
      assert.match(profileHtml, /badge-delivered/, 'Legend must include badge-delivered');
      assert.match(profileHtml, /badge-skipped/, 'Legend must include badge-skipped');
      assert.match(profileHtml, /badge-vacation/, 'Legend must include badge-vacation');
      assert.match(profileHtml, /<svg[^>]*>[\s\S]*?<\/svg>/, 'Legend items must contain inline SVG icons');
    });

    it('profile.css contains responsive mobile styles down to 320px for monthly calendar', () => {
      const profileCss = fs.readFileSync(path.resolve('frontend/css/profile.css'), 'utf8');
      assert.match(profileCss, /@media\s*\(max-width:\s*480px\)/, 'profile.css must include mobile media query for 480px and below');
      assert.match(profileCss, /\.cal-icon-badge/, 'profile.css must include .cal-icon-badge styling');
      assert.match(profileCss, /\.month-cal-day-cell/, 'profile.css must include responsive cell adjustments');
    });
  });

  // ==========================================
  // PHASE 8: Removal of Modify Quantity Feature
  // ==========================================
  describe('Phase 8 — Removal of Post-Purchase Modify Quantity', () => {
    it('modifySubscriptionQuantity route is absent from server.js', () => {
      const serverCode = fs.readFileSync(path.resolve('src/server.js'), 'utf8');
      assert.doesNotMatch(serverCode, /app\.patch\('\/api\/v1\/subscriptions\/:id\/quantity'/, 'PATCH /api/v1/subscriptions/:id/quantity must be completely removed');
    });

    it('modifySubscriptionQuantity function is absent from subscriptionService.js', () => {
      const subServiceCode = fs.readFileSync(path.resolve('src/services/subscriptionService.js'), 'utf8');
      assert.doesNotMatch(subServiceCode, /export\s+async\s+function\s+modifySubscriptionQuantity/, 'modifySubscriptionQuantity must be removed from subscriptionService.js');
    });

    it('modify-sub button is absent from profile.js rendering and styles', () => {
      const profileJs = fs.readFileSync(path.resolve('frontend/js/profile.js'), 'utf8');
      assert.doesNotMatch(profileJs, /data-modify-sub/, 'data-modify-sub must not be rendered or listened to in profile.js');

      const profileCss = fs.readFileSync(path.resolve('frontend/css/profile.css'), 'utf8');
      assert.doesNotMatch(profileCss, /\.btn-modify-pill/, '.btn-modify-pill must be removed from profile.css');
    });
  });

  // ==========================================
  // PHASE 9: Parity & Asset Synchronization
  // ==========================================
  describe('Phase 9 — Frontend Parity & Asset Sync', () => {
    it('frontend and frontend/cloudflare-upload have 100% byte-for-byte identical files', () => {
      const files = ['profile.html', 'admin.html', 'js/profile.js', 'css/profile.css'];
      for (const f of files) {
        const b1 = fs.readFileSync(path.resolve('frontend', f));
        const b2 = fs.readFileSync(path.resolve('frontend/cloudflare-upload', f));
        assert.ok(b1.equals(b2), `File ${f} must be 100% identical between frontend and cloudflare-upload`);
      }
    });

    it('profile.html has incremented version query string (?v=20261022-1)', () => {
      const html = fs.readFileSync(path.resolve('frontend/profile.html'), 'utf8');
      assert.match(html, /profile\.js\?v=20261022-1/, 'profile.html must reference profile.js with version ?v=20261022-1');
    });

    it('milvanta-cloudflare-upload.zip exists and contains non-zero bytes', () => {
      const zipPath = path.resolve('milvanta-cloudflare-upload.zip');
      assert.strictEqual(fs.existsSync(zipPath), true);
      const stat = fs.statSync(zipPath);
      assert.ok(stat.size > 100000, `Zip size should be > 100KB, got ${stat.size} bytes`);
    });
  });
});
