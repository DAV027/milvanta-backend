import 'dotenv/config';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import {
  renderCustomerOrderEmail, renderAdminOrderEmail,
  renderCustomerSubscriptionEmail, renderAdminSubscriptionEmail,
  renderPasswordResetEmail, renderWelcomeEmail
} from './emailTemplateRenderers.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Verify Resend webhook signature following the Svix standard.
 * svix-id, svix-timestamp, svix-signature (v1,<base64>)
 * Signed content: `${svix_id}.${svix_timestamp}.${rawBody}`
 */
export function verifyResendWebhookSignature({ headers = {}, rawBody, secret, toleranceSeconds = 300 }) {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return { valid: false, reason: 'missing_secret' };
  }

  // Normalize header names (case-insensitive lookup)
  const headerKeys = Object.keys(headers);
  const findHeader = (name) => {
    const key = headerKeys.find(k => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : undefined;
  };

  const svixId = findHeader('svix-id');
  const svixTimestamp = findHeader('svix-timestamp');
  const svixSignature = findHeader('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: 'missing_svix_headers' };
  }

  // Validate timestamp within tolerance
  const ts = parseInt(svixTimestamp, 10);
  if (Number.isNaN(ts)) {
    return { valid: false, reason: 'invalid_timestamp' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  if (rawBody === undefined || rawBody === null) {
    return { valid: false, reason: 'missing_raw_body' };
  }

  const bodyStr = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));

  const toSign = `${svixId}.${svixTimestamp}.${bodyStr}`;

  // Resend/Svix secrets are base64 encoded, often prefixed with 'whsec_'
  const trimmedSecret = secret.trim();
  let secretKey;
  if (trimmedSecret.startsWith('whsec_')) {
    secretKey = Buffer.from(trimmedSecret.slice(6), 'base64');
  } else {
    try {
      const b64 = Buffer.from(trimmedSecret, 'base64');
      secretKey = b64.length >= 16 ? b64 : Buffer.from(trimmedSecret, 'utf8');
    } catch {
      secretKey = Buffer.from(trimmedSecret, 'utf8');
    }
  }

  const computedSig = crypto.createHmac('sha256', secretKey).update(toSign).digest('base64');

  // svix-signature contains space-separated versions: e.g. "v1,signature1 v1,signature2"
  const sigParts = svixSignature.split(' ');
  let isValid = false;

  for (const part of sigParts) {
    const [version, sig] = part.split(',');
    if (version === 'v1' && sig) {
      const computedBuf = Buffer.from(computedSig);
      const expectedBuf = Buffer.from(sig);
      if (computedBuf.length === expectedBuf.length && crypto.timingSafeEqual(computedBuf, expectedBuf)) {
        isValid = true;
        break;
      }
    }
  }

  if (!isValid) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return { valid: true, svixId, timestamp: ts };
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

/**
 * Unified email dispatcher: tries Resend first, then Nodemailer (SMTP) fallback.
 */
export async function sendEmail({ to, subject, html, text, from }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  let sender = (from || process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');
  let lastError = null;

  // 1. Try Resend if configured
  if (apiKey) {
    const resendRes = await sendEmailViaResend({ to, subject, html, text, from: sender });
    if (resendRes.success) return resendRes;
    lastError = resendRes;
    console.warn('[Email Dispatch] Resend failed, checking SMTP fallback...', resendRes.error);
  }

  // 2. Try SMTP/Nodemailer if configured
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT || 587) === 465,
        auth: { user: smtpUser, pass: smtpPass }
      });
      const info = await transporter.sendMail({
        from: sender,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        text
      });
      console.log('[SMTP Success] Email dispatched successfully:', { id: info.messageId, to, subject });
      return { success: true, id: info.messageId, provider: 'smtp' };
    } catch (smtpErr) {
      console.error('[SMTP Error] Failed to send email via SMTP:', smtpErr.message);
      return { success: false, error: smtpErr.message, provider: 'smtp' };
    }
  }

  // If a configured email provider was attempted but failed, return that failure
  if (lastError) {
    return {
      success: false,
      error: lastError.error || 'PROVIDER_DISPATCH_FAILED',
      status: lastError.status,
      details: lastError.details,
      provider: 'resend'
    };
  }

  console.warn('[Email Warning] No active email credentials (RESEND_API_KEY or SMTP_HOST/USER/PASS) in environment. Skipping email dispatch to:', to);
  return {
    success: false,
    skipped: true,
    error: 'NO_EMAIL_CREDENTIALS_CONFIGURED',
    message: 'Configure RESEND_API_KEY or SMTP credentials in .env to deliver live emails.'
  };
}

/**
 * Send an email using Resend REST API
 */
export async function sendEmailViaResend({ to, subject, html, text, from }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[Resend] RESEND_API_KEY is not set in environment. Skipping email dispatch to:', to);
    return {
      success: false,
      skipped: true,
      error: 'RESEND_API_KEY_NOT_CONFIGURED'
    };
  }

  let sender = (from || process.env.RESEND_FROM_EMAIL || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');
  const recipients = Array.isArray(to) ? to : [to];

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: sender,
        to: recipients,
        subject,
        html,
        text
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[Resend Error]', {
        status: response.status,
        statusText: response.statusText,
        data,
        to: recipients,
        sender
      });
      return {
        success: false,
        status: response.status,
        error: data.message || data.error || 'RESEND_API_ERROR',
        details: data
      };
    }

    console.log('[Resend Success] Email dispatched successfully:', {
      id: data.id,
      to: recipients,
      subject
    });

    return {
      success: true,
      id: data.id,
      provider: 'resend'
    };
  } catch (err) {
    console.error('[Resend Network Error]', err);
    return {
      success: false,
      error: err.message || 'RESEND_NETWORK_FAILURE'
    };
  }
}

// Only embed absolute HTTPS images in emails. Relative website paths do not
// resolve in Gmail/Outlook message bodies.
export function publicEmailImageUrl(value) {
  const raw = String(value || '').trim();
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^\/?assets\/[a-z0-9_./?=&%-]+$/i.test(raw) && !raw.includes('..')) {
    return 'https://milvanta.in/' + raw.replace(/^\//, '');
  }
  return '';
}

function safeReceiptPaise(value) {
  // PostgreSQL integer and integer-string representations are both supported.
  // Never coerce booleans, blanks, decimals, scientific notation or objects
  // into a seemingly valid payment amount.
  if (typeof value !== 'number' &&
      (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function validOrderReceiptFinancials(order) {
  if (!order) return false;
  const subtotal = safeReceiptPaise(order.subtotal_paise);
  const delivery = safeReceiptPaise(order.delivery_charge_paise);
  const total = safeReceiptPaise(order.total_paise);
  return subtotal !== null && subtotal > 0 &&
    delivery !== null && total !== null &&
    Number.isSafeInteger(subtotal + delivery) &&
    subtotal + delivery === total;
}

/**
 * Exact currency formatter for receipt subjects/plain text.
 * For paise values, preserve decimal precision exactly as the HTML renderer.
 */
export function formatInr(paiseOrRupees, isPaise = false) {
  if (isPaise) {
    const amount = safeReceiptPaise(paiseOrRupees);
    if (amount === null) return 'Pending verification';
    return '₹' + (amount / 100).toLocaleString('en-IN', {
      minimumFractionDigits: amount % 100 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }
  const amount = Number(paiseOrRupees);
  return Number.isFinite(amount) && amount >= 0
    ? '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    : 'Pending verification';
}

/**
 * Generate Customer Order Confirmation Email HTML
 */
export function buildCustomerOrderEmail({ order, customer, address, items, paymentId }) {
  return renderCustomerOrderEmail({ order, customer, address, items, paymentId });
}

/**
 * Generate Admin Order Notification Email HTML
 */
export function buildAdminOrderEmail({ order, customer, address, items, paymentId }) {
  return renderAdminOrderEmail({ order, customer, address, items, paymentId });
}

/**
 * Enqueue transactional email outbox records for a confirmed paid order
 */
export async function enqueueOrderPaidOutbox(client, { order, customer, address, items, paymentId }) {
  if (!client || !order) return [];
  if (!validOrderReceiptFinancials(order)) {
    // A missing SQL projection must NEVER produce a false ₹0 receipt.
    // Do not throw inside the payment transaction; preserve the captured
    // payment and allow separate recovery of the unsent email instead.
    console.error('[Email Outbox] Skipped order email with absent or inconsistent receipt totals', {
      orderId: order.id || null
    });
    return [];
  }
  const adminEmail = (process.env.ADMIN_EMAIL || 'projects@milvanta.in').trim();
  const customerEmail = (customer?.email || address?.email || order?.customer_email || '').trim();

  const customerKey = `order_paid:customer:${order.id}`;
  const adminKey = `order_paid:admin:${order.id}`;

  const payload = {
    order: {
      id: order.id,
      order_number: order.order_number,
      total_paise: order.total_paise,
      subtotal_paise: order.subtotal_paise,
      delivery_charge_paise: order.delivery_charge_paise,
      payment_status: order.payment_status,
      order_status: order.order_status,
      created_at: order.created_at
    },
    customer: {
      name: customer?.name || customer?.full_name || address?.name || 'Valued Customer',
      email: customerEmail,
      phone: customer?.phone || address?.phone || ''
    },
    address: address || {},
    items: Array.isArray(items) ? items : [],
    paymentId: paymentId || ''
  };

  const enqueued = [];

  // 1. Enqueue Customer Confirmation
  if (customerEmail && customerEmail.includes('@')) {
    const { rows } = await client.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         source_order_id, payment_id, payload, status
       ) VALUES ($1, 'order_confirmation', 'customer', $2, $3, $4, $5::jsonb, 'pending')
       ON CONFLICT (event_key) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = NOW()
         WHERE email_outbox.status = 'failed'
       RETURNING id, event_key, status`,
      [customerKey, customerEmail, order.id, paymentId, JSON.stringify(payload)]
    );
    if (rows[0]) enqueued.push(rows[0]);
  }

  // 2. Enqueue Admin Notification
  if (adminEmail && adminEmail.includes('@')) {
    const { rows } = await client.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         source_order_id, payment_id, payload, status
       ) VALUES ($1, 'order_notification', 'admin', $2, $3, $4, $5::jsonb, 'pending')
       ON CONFLICT (event_key) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = NOW()
         WHERE email_outbox.status = 'failed'
       RETURNING id, event_key, status`,
      [adminKey, adminEmail, order.id, paymentId, JSON.stringify(payload)]
    );
    if (rows[0]) enqueued.push(rows[0]);
  }

  return enqueued;
}

/**
 * Enqueue transactional email outbox records for a confirmed milk subscription
 */
export async function enqueueSubscriptionOutbox(client, { subscription, customer, address, paymentId, sourceOrderId = null }) {
  if (!client || !subscription) return [];
  const adminEmail = (process.env.ADMIN_EMAIL || 'projects@milvanta.in').trim();
  const customerEmail = (customer?.email || address?.email || subscription?.customer_email || subscription?.email || '').trim();

  const subId = subscription.id;
  const customerKey = `sub_confirmed:customer:${subId}`;
  const adminKey = `sub_notification:admin:${subId}`;

  const payload = {
    subscription: {
      id: subscription.id,
      productName: subscription.product_name || subscription.productName || 'Pure Fresh Milk',
      quantity: subscription.quantity,
      frequency: subscription.frequency || 'Daily (Every Morning)',
      timeSlot: subscription.time_slot || subscription.timeSlot || '6:00 AM – 7:00 AM',
      costPerDay: subscription.cost_per_day_paise != null ? Number(subscription.cost_per_day_paise) / 100 : (subscription.costPerDay ?? null),
      cost_per_day_paise: subscription.cost_per_day_paise ?? null,
      planType: subscription.plan_type || subscription.planType || 'custom',
      durationLabel: subscription.duration_label || subscription.durationLabel || '7 Days Custom Plan',
      totalAmount: subscription.total_amount_paise != null ? Number(subscription.total_amount_paise) / 100 : (subscription.totalAmount ?? null),
      total_amount_paise: subscription.total_amount_paise ?? null,
      image: subscription.image_url || subscription.image,
      status: subscription.status || 'active',
      nextDelivery: subscription.next_delivery || subscription.nextDelivery || 'Pending delivery scheduling',
      notes: subscription.notes || {}
    },
    customer: {
      name: customer?.name || customer?.full_name || address?.name || 'Valued Customer',
      email: customerEmail,
      phone: customer?.phone || address?.phone || subscription?.phone || ''
    },
    address: address || (typeof subscription.delivery_address === 'object' ? subscription.delivery_address : {}),
    paymentId: paymentId || ''
  };

  const enqueued = [];

  // 1. Enqueue Customer Subscription Confirmation
  if (customerEmail && customerEmail.includes('@')) {
    const { rows } = await client.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         source_order_id, source_subscription_id, payment_id, payload, status
       ) VALUES ($1, 'subscription_confirmation', 'customer', $2, $3, $4, $5, $6::jsonb, 'pending')
       ON CONFLICT (event_key) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = NOW()
         WHERE email_outbox.status = 'failed'
       RETURNING id, event_key, status`,
      [customerKey, customerEmail, sourceOrderId, subId, paymentId, JSON.stringify(payload)]
    );
    if (rows[0]) enqueued.push(rows[0]);
  }

  // 2. Enqueue Admin Subscription Notification
  if (adminEmail && adminEmail.includes('@')) {
    const { rows } = await client.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         source_order_id, source_subscription_id, payment_id, payload, status
       ) VALUES ($1, 'subscription_notification', 'admin', $2, $3, $4, $5, $6::jsonb, 'pending')
       ON CONFLICT (event_key) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = NOW()
         WHERE email_outbox.status = 'failed'
       RETURNING id, event_key, status`,
      [adminKey, adminEmail, sourceOrderId, subId, paymentId, JSON.stringify(payload)]
    );
    if (rows[0]) enqueued.push(rows[0]);
  }

  return enqueued;
}

/**
 * Enqueue durable transactional email outbox records for recurring monthly subscription charges
 * Using renewal-specific event keys to guarantee idempotent delivery per billing cycle.
 */
export async function enqueueRecurringSubscriptionOutbox(client, {
  subscription,
  customer,
  address,
  paymentId = '',
  billingCycle = '',
  isRenewal = true,
  eventName = 'subscription.charged'
}) {
  if (!client || !subscription) return [];
  const adminEmail = (process.env.ADMIN_EMAIL || 'projects@milvanta.in').trim();
  const customerEmail = (customer?.email || address?.email || subscription?.customer_email || subscription?.email || '').trim();

  const subId = subscription.id;
  const cycleToken = paymentId || billingCycle || (subscription.notes?.paidThroughDate) || 'renewal';
  const customerKey = `sub_charged:customer:${subId}:${cycleToken}`;
  const adminKey = `sub_charged:admin:${subId}:${cycleToken}`;

  const payload = {
    subscription: {
      id: subscription.id,
      productName: subscription.product_name || subscription.productName || 'Pure Fresh Milk',
      quantity: subscription.quantity,
      frequency: subscription.frequency || 'Daily (Every Morning)',
      timeSlot: subscription.time_slot || subscription.timeSlot || '6:00 AM – 7:00 AM',
      costPerDay: subscription.cost_per_day_paise != null ? Number(subscription.cost_per_day_paise) / 100 : (subscription.costPerDay ?? null),
      cost_per_day_paise: subscription.cost_per_day_paise ?? null,
      planType: subscription.plan_type || subscription.planType || 'monthly',
      durationLabel: subscription.duration_label || subscription.durationLabel || 'Monthly Recurring',
      totalAmount: subscription.total_amount_paise != null ? Number(subscription.total_amount_paise) / 100 : (subscription.totalAmount ?? null),
      total_amount_paise: subscription.total_amount_paise ?? null,
      image: subscription.image_url || subscription.image,
      status: subscription.status || 'active',
      nextDelivery: subscription.next_delivery || subscription.nextDelivery || 'Pending delivery scheduling',
      notes: subscription.notes || {}
    },
    customer: {
      name: customer?.name || customer?.full_name || address?.name || 'Valued Subscriber',
      email: customerEmail,
      phone: customer?.phone || address?.phone || subscription?.phone || ''
    },
    address: address || (typeof subscription.delivery_address === 'object' ? subscription.delivery_address : {}),
    paymentId: paymentId || '',
    billingCycle: cycleToken,
    eventName,
    isRenewal: Boolean(isRenewal)
  };

  const enqueued = [];

  if (customerEmail && customerEmail.includes('@')) {
    const { rows } = await client.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         source_subscription_id, payment_id, payload, status
       ) VALUES ($1, 'subscription_confirmation', 'customer', $2, $3, $4, $5::jsonb, 'pending')
       ON CONFLICT (event_key) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = NOW()
         WHERE email_outbox.status = 'failed'
       RETURNING id, event_key, status`,
      [customerKey, customerEmail, subId, paymentId, JSON.stringify(payload)]
    );
    if (rows[0]) enqueued.push(rows[0]);
  }

  if (adminEmail && adminEmail.includes('@')) {
    const { rows } = await client.query(
      `INSERT INTO email_outbox (
         event_key, email_type, recipient_type, recipient_email,
         source_subscription_id, payment_id, payload, status
       ) VALUES ($1, 'subscription_notification', 'admin', $2, $3, $4, $5::jsonb, 'pending')
       ON CONFLICT (event_key) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = NOW()
         WHERE email_outbox.status = 'failed'
       RETURNING id, event_key, status`,
      [adminKey, adminEmail, subId, paymentId, JSON.stringify(payload)]
    );
    if (rows[0]) enqueued.push(rows[0]);
  }

  return enqueued;
}

/**
 * Process pending/failed/recoverable records in email_outbox.
 * Supports worker concurrency leases, timeout recovery, exponential backoff and dead-letter state.
 */
export async function processEmailOutbox(poolOrClient, options = {}) {
  if (!poolOrClient) return { success: false, error: 'NO_DATABASE_POOL' };
  const isPool = Boolean(poolOrClient && typeof poolOrClient.connect === 'function' && typeof poolOrClient.totalCount === 'number');
  const client = isPool ? await poolOrClient.connect() : poolOrClient;
  const shouldRelease = isPool;

  try {
    const {
      orderId,
      subscriptionId,
      eventKey,
      limit = 50,
      leaseMinutes = 5,
      workerId = `worker_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
    } = options;

    // 1. Transition expired leases exceeding max_attempts directly to dead_letter state
    await client.query(`
      UPDATE email_outbox
      SET status = 'dead_letter',
          last_error = COALESCE(last_error, 'LEASE_EXPIRED_MAX_ATTEMPTS_EXCEEDED'),
          next_retry_at = NULL,
          locked_by = NULL,
          locked_at = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE status = 'processing'
        AND lease_expires_at <= NOW()
        AND attempts >= max_attempts
    `);

    let filterClauses = `
      ((status IN ('pending', 'failed') AND next_retry_at <= NOW() AND attempts < max_attempts)
       OR (status = 'processing' AND lease_expires_at <= NOW() AND attempts < max_attempts))
    `;
    const params = [limit, workerId, leaseMinutes];

    if (orderId) {
      params.push(orderId);
      filterClauses += ` AND source_order_id = $${params.length}`;
    }
    if (subscriptionId) {
      params.push(subscriptionId);
      filterClauses += ` AND source_subscription_id = $${params.length}`;
    }
    if (eventKey) {
      params.push(eventKey);
      filterClauses += ` AND event_key = $${params.length}`;
    }

    // Atomic claim query with row-level locks and lease recovery
    const claimQuery = `
      WITH claimable AS (
        SELECT id
        FROM email_outbox
        WHERE ${filterClauses}
        ORDER BY id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE email_outbox
      SET status = 'processing',
          locked_by = $2,
          locked_at = NOW(),
          lease_expires_at = NOW() + ($3 || ' minutes')::interval,
          attempts = attempts + 1,
          updated_at = NOW()
      FROM claimable
      WHERE email_outbox.id = claimable.id
      RETURNING email_outbox.*;
    `;

    const { rows: pendingItems } = await client.query(claimQuery, params);

    const results = {
      workerId,
      processed: pendingItems.length,
      customerEmail: null,
      adminEmail: null,
      items: []
    };

    const sender = (process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');

    for (const item of pendingItems) {
      const payload = item.payload || {};
      let subject = '';
      let html = '';
      let text = '';

      if (item.email_type === 'order_confirmation') {
        const paid = payload.order?.payment_status === 'paid' &&
          payload.order?.order_status === 'confirmed';
        const number = payload.order?.order_number || 'Order';
        const total = validOrderReceiptFinancials(payload.order)
          ? formatInr(payload.order.total_paise, true) : 'Pending verification';
        subject = paid
          ? `Order Confirmed: #${number} - Milvanta Farm Fresh`
          : `Milvanta Order Update: #${number}`;
        html = buildCustomerOrderEmail(payload);
        text = [
          `Milvanta order details for ${payload.customer?.name || 'Customer'}`,
          `Order #${number}`,
          `Payment status: ${paid ? 'Paid and confirmed' : 'Requires verification'}`,
          `Milvanta order total: ${total}`,
          'Review your latest delivery status at https://milvanta.in/profile.html'
        ].join('\n');
      } else if (item.email_type === 'order_notification') {
        const paid = payload.order?.payment_status === 'paid' &&
          payload.order?.order_status === 'confirmed';
        const number = payload.order?.order_number || 'Order';
        const total = validOrderReceiptFinancials(payload.order)
          ? formatInr(payload.order.total_paise, true) : 'Pending verification';
        subject = paid
          ? `New Paid Order #${number} - ${total} - Milvanta`
          : `Milvanta Operations: Order Review #${number}`;
        html = buildAdminOrderEmail(payload);
        text = [
          `Milvanta operations: ${paid ? 'Verified paid order' : 'Order requires payment review'}`,
          `Order #${number}`,
          `Milvanta order total: ${total}`,
          `Customer: ${payload.customer?.name || 'Customer'}`,
          'Verify delivery eligibility in the operations dashboard.'
        ].join('\n');
      } else if (item.email_type === 'subscription_confirmation') {
        const isRefundable = payload.subscription?.notes?.authType === 'refundable_authorization';
        subject = isRefundable
          ? `🥛 Subscription E-Mandate Registered: ${payload.subscription?.productName || payload.subscription?.product_name || 'Fresh Milk'} - Milvanta Farm Fresh`
          : (payload.isRenewal
              ? `Milvanta subscription billing update: ${payload.subscription?.productName || payload.subscription?.product_name || 'Fresh Milk'}`
              : `Milvanta subscription details: ${payload.subscription?.productName || payload.subscription?.product_name || 'Fresh Milk'}`);
        html = buildCustomerSubscriptionEmail(payload);
        text = `Milvanta subscription details\nProduct: ${payload.subscription?.productName || payload.subscription?.product_name || 'Fresh milk'}\nReview payment eligibility and delivery scheduling in your Milvanta profile.\nTeam Milvanta`;
      } else if (item.email_type === 'subscription_notification') {
        const isRefundable = payload.subscription?.notes?.authType === 'refundable_authorization';
        subject = isRefundable
          ? `🚨 ACTION REQUIRED: New Morning Milk Mandate Registered`
          : (payload.isRenewal
              ? `Milvanta operations: recurring subscription update`
              : `Milvanta operations: subscription review`);
        html = buildAdminSubscriptionEmail(payload);
        text = `ALERT: Milk Subscription\nCustomer: ${payload.customer?.name || payload.customer?.full_name}`;
      }

      const toEmail = item.recipient_email?.trim();
      let sendResult;

      if (!toEmail || !toEmail.includes('@')) {
        sendResult = { success: false, skipped: true, error: 'INVALID_RECIPIENT_EMAIL' };
      } else {
        try {
          sendResult = await sendEmail({
            to: toEmail,
            subject,
            html,
            text,
            from: sender
          });
        } catch (dispatchErr) {
          sendResult = { success: false, error: dispatchErr.message };
        }
      }

      if (sendResult.success) {
        // Record provider acceptance (status = 'sent', provider_status = 'accepted').
        // Note: delivered_at remains NULL until webhook confirms inbox delivery.
        // Fencing guard: ONLY succeed if this worker still holds the lock!
        const updateRes = await client.query(
          `UPDATE email_outbox 
           SET status = 'sent',
               provider = $2,
               provider_message_id = $3,
               provider_status = 'accepted',
               sent_at = NOW(),
               locked_by = NULL,
               locked_at = NULL,
               lease_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $1 AND locked_by = $4`,
          [item.id, sendResult.provider || 'resend', sendResult.id || null, workerId]
        );

        if (updateRes.rowCount === 0) {
          console.warn(`[Email Outbox] Worker ${workerId} lost lease for outbox item ${item.id}; ignoring stale update`);
          continue;
        }

        // Update independent recipient tracking
        if (item.source_order_id) {
          if (item.recipient_type === 'customer') {
            await client.query(
              `UPDATE customer_orders 
               SET customer_email_sent = TRUE, customer_email_at = NOW(), updated_at = NOW() 
               WHERE id = $1`,
              [item.source_order_id]
            );
          } else if (item.recipient_type === 'admin') {
            await client.query(
              `UPDATE customer_orders 
               SET admin_email_sent = TRUE, admin_email_at = NOW(), updated_at = NOW() 
               WHERE id = $1`,
              [item.source_order_id]
            );
          }

          // Mark confirmation_email_sent ONLY when BOTH customer and admin dispatches have succeeded
          const { rows: [ordCheck] } = await client.query(
            `SELECT customer_email_sent, admin_email_sent FROM customer_orders WHERE id = $1`,
            [item.source_order_id]
          );
          if (ordCheck && ordCheck.customer_email_sent && ordCheck.admin_email_sent) {
            await client.query(
              `UPDATE customer_orders 
               SET confirmation_email_sent = TRUE, confirmation_email_at = NOW() 
               WHERE id = $1`,
              [item.source_order_id]
            );
          }
        }

        if (item.source_subscription_id) {
          if (item.recipient_type === 'customer') {
            await client.query(
              `UPDATE customer_subscriptions 
               SET customer_email_sent = TRUE, customer_email_at = NOW(), updated_at = NOW() 
               WHERE id = $1`,
              [item.source_subscription_id]
            );
          } else if (item.recipient_type === 'admin') {
            await client.query(
              `UPDATE customer_subscriptions 
               SET admin_email_sent = TRUE, admin_email_at = NOW(), updated_at = NOW() 
               WHERE id = $1`,
              [item.source_subscription_id]
            );
          }
        }

        const outboxSummary = {
          success: true,
          status: 'accepted',
          providerAccepted: true,
          id: sendResult.id,
          provider: sendResult.provider || 'resend',
          acceptedAt: new Date().toISOString()
        };
        if (item.recipient_type === 'customer') results.customerEmail = outboxSummary;
        if (item.recipient_type === 'admin') results.adminEmail = outboxSummary;
        results.items.push({ id: item.id, recipientType: item.recipient_type, ...outboxSummary });
      } else {
        const errMsg = sendResult.error || 'DISPATCH_FAILED';
        const currentAttempts = item.attempts;
        const maxAttempts = item.max_attempts || 5;

        if (currentAttempts >= maxAttempts) {
          // Transition to terminal dead_letter state
          const dlRes = await client.query(
            `UPDATE email_outbox 
             SET status = 'dead_letter',
                 last_error = $2,
                 next_retry_at = NULL,
                 locked_by = NULL,
                 locked_at = NULL,
                 lease_expires_at = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND locked_by = $3`,
            [item.id, errMsg, workerId]
          );
          if (dlRes.rowCount === 0) {
            console.warn(`[Email Outbox] Worker ${workerId} lost lease for outbox item ${item.id} during dead-letter transition`);
            continue;
          }
        } else {
          // Exponential backoff: min(60, 2^(attempts-1)) minutes
          const backoffMinutes = Math.min(60, Math.pow(2, Math.max(0, currentAttempts - 1)));
          const failRes = await client.query(
            `UPDATE email_outbox 
             SET status = 'failed',
                 last_error = $2,
                 next_retry_at = NOW() + ($3 || ' minutes')::interval,
                 locked_by = NULL,
                 locked_at = NULL,
                 lease_expires_at = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND locked_by = $4`,
            [item.id, errMsg, backoffMinutes, workerId]
          );
          if (failRes.rowCount === 0) {
            console.warn(`[Email Outbox] Worker ${workerId} lost lease for outbox item ${item.id} during failure transition`);
            continue;
          }
        }

        const outboxSummary = {
          success: false,
          status: currentAttempts >= maxAttempts ? 'dead_letter' : 'failed',
          providerAccepted: false,
          attempts: currentAttempts,
          maxAttempts,
          error: errMsg
        };
        if (item.recipient_type === 'customer') results.customerEmail = outboxSummary;
        if (item.recipient_type === 'admin') results.adminEmail = outboxSummary;
        results.items.push({ id: item.id, recipientType: item.recipient_type, ...outboxSummary });
      }
    }

    return results;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

let outboxWorkerTimer = null;
let isWorkerExecuting = false;

/**
 * Start the background worker for processing email outbox records.
 * Uses recursive setTimeout to guarantee runs never overlap.
 */
export function startEmailOutboxWorker(pool, options = {}) {
  if (outboxWorkerTimer) {
    return { workerId: options.workerId || 'running', status: 'already_running' };
  }

  const intervalMs = Math.max(1000, options.intervalMs || 10000);
  const workerId = options.workerId || `worker_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
  const limit = options.limit || 50;
  const leaseMinutes = options.leaseMinutes || 5;

  const scheduleNext = () => {
    outboxWorkerTimer = setTimeout(async () => {
      if (isWorkerExecuting) {
        scheduleNext();
        return;
      }
      isWorkerExecuting = true;
      try {
        await processEmailOutbox(pool, { workerId, limit, leaseMinutes });
      } catch (err) {
        console.error('[Email Outbox Worker] Error during scheduled pass:', err.message);
      } finally {
        isWorkerExecuting = false;
        if (outboxWorkerTimer !== null) {
          scheduleNext();
        }
      }
    }, intervalMs);
    if (outboxWorkerTimer?.unref) {
      outboxWorkerTimer.unref();
    }
  };

  scheduleNext();

  return {
    workerId,
    intervalMs,
    stop: () => stopEmailOutboxWorker()
  };
}

/**
 * Stop the background email outbox worker.
 */
export function stopEmailOutboxWorker() {
  if (outboxWorkerTimer) {
    clearTimeout(outboxWorkerTimer);
    outboxWorkerTimer = null;
  }
  isWorkerExecuting = false;
}

/**
 * Mark an outbox email record as delivered upon receipt of webhook delivery confirmation.
 * Strictly separates provider acceptance from actual inbox delivery.
 */
export async function markOutboxDelivered(poolOrClient, { providerMessageId, deliveredAt = new Date() }) {
  if (!providerMessageId) return { success: false, error: 'NO_MESSAGE_ID' };
  const query = `
    UPDATE email_outbox 
    SET status = 'delivered', provider_status = 'delivered', delivered_at = $2, updated_at = NOW() 
    WHERE provider_message_id = $1
    RETURNING id, event_key, recipient_email, delivered_at
  `;
  const { rows } = await poolOrClient.query(query, [providerMessageId, deliveredAt]);
  return {
    success: rows.length > 0,
    count: rows.length,
    delivered: rows[0] || null
  };
}

/**
 * Send order confirmation emails to both customer and admin.
 * Requires authoritative PostgreSQL payment evidence and confirmed order status.
 * Dispatches via durable transactional email_outbox.
 */
export async function sendOrderPaidEmails(pool, orderId, paymentId = '') {
  if (!pool) {
    console.warn('[Resend] Database pool not available for order email dispatch');
    return { success: false, error: 'NO_DATABASE_POOL' };
  }

  const client = await pool.connect();
  try {
    const isNumericId = typeof orderId === 'number' || (/^\d+$/.test(String(orderId).trim()) && !String(orderId).includes('-'));
    const res = await client.query(
      isNumericId
        ? `SELECT co.*, c.email AS customer_email, c.full_name AS customer_name, c.phone AS customer_phone
           FROM customer_orders co
           LEFT JOIN customers c ON c.id = co.customer_id
           WHERE co.id = $1`
        : `SELECT co.*, c.email AS customer_email, c.full_name AS customer_name, c.phone AS customer_phone
           FROM customer_orders co
           LEFT JOIN customers c ON c.id = co.customer_id
           WHERE co.order_number = $1`,
      [orderId]
    );

    if (!res.rowCount) {
      console.warn('[Email Guard] Order not found for email dispatch:', orderId);
      return { success: false, error: 'ORDER_NOT_FOUND', message: 'Order not found' };
    }

    const order = res.rows[0];

    // REQUIREMENT 1: Never send confirmation unless:
    // 1. Order confirmed, not payment_review
    if (order.order_status === 'payment_review') {
      console.warn(`[Email Guard] Order #${order.order_number} is in payment_review. Paid confirmation blocked.`);
      return { success: false, error: 'ORDER_IN_REVIEW', message: 'Order is under manual review and cannot send paid confirmation emails.' };
    }

    // 2. Payment captured and order confirmed (reject pending, authorized, failed)
    if (order.payment_status !== 'paid' || order.order_status !== 'confirmed') {
      console.warn(`[Email Guard] Order #${order.order_number} is not paid/confirmed (payment_status=${order.payment_status}, order_status=${order.order_status}). Dispatch blocked.`);
      return { success: false, error: 'ORDER_NOT_PAID', message: 'Order payment is not paid or order is not confirmed.' };
    }

    // 3. Authoritative PostgreSQL payment evidence in payment_orders
    const payRes = await client.query(
      `SELECT razorpay_payment_id, razorpay_order_id, amount_paise, currency, status 
       FROM payment_orders 
       WHERE customer_order_id = $1`,
      [order.id]
    );

    const capturedRows = payRes.rows.filter(p => p.status === 'captured');
    const validCaptured = capturedRows.filter(p =>
      Number(p.amount_paise) === Number(order.total_paise) &&
      p.currency === 'INR'
    );

    if (!validCaptured.length) {
      console.warn(`[Email Guard] No verified captured payment evidence found for order #${order.order_number}`);
      return { success: false, error: 'UNVERIFIED_PAYMENT_EVIDENCE', message: 'No authoritative captured payment record matches this order.' };
    }

    // 4. No unresolved payment conflict
    if (capturedRows.length > 1 && capturedRows.some(p => p.razorpay_payment_id !== validCaptured[0].razorpay_payment_id)) {
      console.warn(`[Email Guard] Unresolved payment conflict: multiple distinct captured payments for order #${order.order_number}`);
      return { success: false, error: 'PAYMENT_CONFLICT', message: 'Unresolved payment conflict detected.' };
    }

    // STRICT: Ignore any external paymentId argument; strictly use authoritative captured payment from payment_orders
    const verifiedPaymentId = validCaptured[0].razorpay_payment_id;

    // Check if BOTH customer and admin emails were ALREADY sent
    if (order.confirmation_email_sent && order.customer_email_sent && order.admin_email_sent) {
      console.log(`[Email Outbox] Both confirmation emails already sent for order #${order.order_number}. Skipping duplicate run.`);
      return {
        success: true,
        skipped: true,
        alreadySent: true,
        results: {
          customerEmail: { success: true, status: 'accepted', alreadySent: true, providerAccepted: true },
          adminEmail: { success: true, status: 'accepted', alreadySent: true, providerAccepted: true }
        }
      };
    }

    const address = typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {});
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
    const customer = {
      name: order.customer_name || address.name,
      email: address.email || order.customer_email,
      phone: address.phone || order.customer_phone
    };

    const isPureSubscriptionOrder = Array.isArray(items) && items.length > 0 && items.every(item => item.isCustomDaysPlan === true);
    const hasSubscriptionItems = Array.isArray(items) && items.some(item => item.isCustomDaysPlan === true);

    if (hasSubscriptionItems) {
      const subRes = await client.query(
        `SELECT * FROM customer_subscriptions WHERE (notes->>'sourceOrderId') = $1::text`,
        [String(order.id)]
      );
      for (const sub of subRes.rows) {
        await enqueueSubscriptionOutbox(client, {
          subscription: sub,
          customer,
          address,
          paymentId: verifiedPaymentId,
          sourceOrderId: order.id
        });
      }
    }

    if (!isPureSubscriptionOrder) {
      await enqueueOrderPaidOutbox(client, {
        order,
        customer,
        address,
        items,
        paymentId: verifiedPaymentId
      });
    }

    // Process the outbox for this order
    const outboxResult = await processEmailOutbox(client, { orderId: order.id });

    // Fetch refreshed order status to see recipient states
    const { rows: [refreshedOrder] } = await client.query(
      `SELECT confirmation_email_sent, customer_email_sent, admin_email_sent FROM customer_orders WHERE id = $1`,
      [order.id]
    );

    const customerSent = Boolean(refreshedOrder?.customer_email_sent);
    const adminSent = Boolean(refreshedOrder?.admin_email_sent);
    const bothSent = customerSent && adminSent;

    return {
      success: bothSent,
      customerEmailSent: customerSent,
      adminEmailSent: adminSent,
      results: {
        customerEmail: outboxResult.customerEmail || (customerSent ? { success: true, status: 'accepted' } : { success: false, status: 'failed' }),
        adminEmail: outboxResult.adminEmail || (adminSent ? { success: true, status: 'accepted' } : { success: false, status: 'failed' })
      }
    };
  } catch (err) {
    console.error('[Email Outbox] Failed to send order emails:', err);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Generate Customer Subscription Confirmation Email HTML
 */
export function buildCustomerSubscriptionEmail({ subscription, customer, address, paymentId }) {
  return renderCustomerSubscriptionEmail({ subscription, customer, address, paymentId });
}

/**
 * Generate Admin Subscription Notification Email HTML
 */
export function buildAdminSubscriptionEmail({ subscription, customer, address, paymentId }) {
  return renderAdminSubscriptionEmail({ subscription, customer, address, paymentId });
}

/**
 * Send subscription confirmation emails to both customer and admin
 */
export async function sendSubscriptionConfirmationEmails(pool, subData, options = {}) {
  const paymentId = options.paymentId || subData?.paymentId || '';
  const customer = subData?.customer || {};
  const address = subData?.address || {};
  let subscription = subData?.subscription || subData || {};

  // If subData is an ID or order number, lookup authoritative record in DB
  let serverRecord = null;
  if (pool && (typeof subData === 'string' || typeof subData === 'number' || subData.subscriptionId || subData.orderNumber || subData.id)) {
    const lookupId = subData.subscriptionId || subData.orderNumber || subData.id || subData;
    try {
      const client = await pool.connect();
      try {
        const isNumeric = typeof lookupId === 'number' || (/^\d+$/.test(String(lookupId).trim()) && !String(lookupId).includes('-'));
        const subRes = await client.query(
          isNumeric
            ? `SELECT cs.*, c.full_name, c.email, c.phone 
               FROM customer_subscriptions cs 
               JOIN customers c ON c.id = cs.customer_id 
               WHERE cs.id = $1`
            : `SELECT cs.*, c.full_name, c.email, c.phone 
               FROM customer_subscriptions cs 
               JOIN customers c ON c.id = cs.customer_id 
               WHERE cs.id::text = $1 OR cs.razorpay_subscription_id = $1 OR cs.notes->>'subscriptionId' = $1 OR cs.notes->>'razorpay_subscription_id' = $1`,
          [lookupId]
        );
        if (subRes.rows[0]) {
          const row = subRes.rows[0];
          serverRecord = row;
          subscription = {
            id: row.id,
            productName: row.product_name,
            quantity: row.quantity,
            frequency: row.frequency,
            timeSlot: row.time_slot,
            costPerDay: row.cost_per_day_paise != null ? Number(row.cost_per_day_paise) / 100 : null,
            cost_per_day_paise: row.cost_per_day_paise ?? null,
            planType: row.plan_type || 'month',
            durationLabel: row.duration_label || '',
            totalAmount: row.total_amount_paise != null ? Number(row.total_amount_paise) / 100 : null,
            total_amount_paise: row.total_amount_paise ?? null,
            image: row.image_url,
            status: row.status,
            nextDelivery: row.next_delivery,
            notes: row.notes,
            authType: row.notes?.authType,
            authAmountPaise: row.notes?.authAmountPaise
          };
          customer.name = customer.name || row.full_name;
          customer.email = customer.email || row.email;
          customer.phone = customer.phone || row.phone;
        }
      } finally {
        client.release();
      }
    } catch (e) {
      console.warn('[Subscription Email] DB lookup error:', e.message);
    }
  }

  if (subscription) {
    if (subscription.product_name && !subscription.productName) subscription.productName = subscription.product_name;
    if (subscription.cost_per_day_paise && !subscription.costPerDay) subscription.costPerDay = Math.round(subscription.cost_per_day_paise / 100);
    if (subscription.total_amount_paise && !subscription.totalAmount) subscription.totalAmount = Math.round(subscription.total_amount_paise / 100);
    if (subscription.time_slot && !subscription.timeSlot) subscription.timeSlot = subscription.time_slot;
    if (subscription.plan_type && !subscription.planType) subscription.planType = subscription.plan_type;
    if (subscription.duration_label && !subscription.durationLabel) subscription.durationLabel = subscription.duration_label;
    if (subscription.next_delivery && !subscription.nextDelivery) subscription.nextDelivery = subscription.next_delivery;
    if (subscription.image_url && !subscription.image) subscription.image = subscription.image_url;
  }
  if (customer) {
    if (customer.full_name && !customer.name) customer.name = customer.full_name;
  }

  const subId = subscription?.id ? Number(subscription.id) : null;
  // Derive payment email idempotency key strictly from server-side verified records
  const serverNotes = typeof serverRecord?.notes === 'object' && serverRecord?.notes !== null
    ? serverRecord.notes
    : (typeof subscription?.notes === 'object' && subscription?.notes !== null ? subscription.notes : {});
  const verifiedServerPaymentRef = serverNotes.lastPaymentId || serverNotes.paymentId || serverNotes.mandatePaymentId || serverRecord?.razorpay_subscription_id || subscription?.razorpay_subscription_id;
  const paymentKey = String(paymentId || verifiedServerPaymentRef || 'initial_activation').trim();

  // Database-backed atomic idempotency lock using transaction advisory lock
  let lockClient = null;
  let advisoryLockAcquired = false;
  if (pool && subId && Number.isSafeInteger(subId)) {
    try {
      lockClient = await pool.connect();
      await lockClient.query('BEGIN');
      // Try acquiring transaction-level advisory lock to prevent concurrent verification, callback and frontend requests
      const { rows: lockRows } = await lockClient.query('SELECT pg_try_advisory_xact_lock(98765, $1::integer) AS locked', [subId]);
      advisoryLockAcquired = Boolean(lockRows[0]?.locked);
      if (!advisoryLockAcquired) {
        console.log(`[Email Idempotency] Concurrent dispatch in progress for subscription ${subId}. Skipping duplicate run.`);
        await lockClient.query('ROLLBACK').catch(() => {});
        lockClient.release();
        lockClient = null;
        return {
          success: true,
          skipped: true,
          concurrent: true,
          providerAccepted: false,
          deliveryStatus: 'in_progress_concurrently'
        };
      }
    } catch (lockErr) {
      console.warn('[Subscription Email] Advisory lock acquisition failure, failing safely:', lockErr.message);
      if (lockClient) {
        await lockClient.query('ROLLBACK').catch(() => {});
        lockClient.release();
        lockClient = null;
      }
      return {
        success: false,
        skipped: true,
        error: 'LOCK_ACQUISITION_FAILED',
        message: lockErr.message,
        providerAccepted: false,
        deliveryStatus: 'lock_failed'
      };
    }
  }

  try {
    // Read existing confirmation history from database
    let existingConfirmations = {};
    if (pool && subId) {
      try {
        const checkClient = lockClient || pool;
        const { rows: subCheck } = await checkClient.query('SELECT notes FROM customer_subscriptions WHERE id = $1', [subId]);
        const subNotes = typeof subCheck[0]?.notes === 'object' && subCheck[0]?.notes !== null ? subCheck[0].notes : {};
        existingConfirmations = subNotes.emailConfirmations || {};
      } catch (readErr) {
        console.warn('[Subscription Email] Failed to read emailConfirmations from notes:', readErr.message);
      }
    }

    const eventRecord = existingConfirmations[paymentKey] || {};
    const customerPrevious = eventRecord.customer || {};
    const adminPrevious = eventRecord.admin || {};

    const customerAlreadyAccepted = customerPrevious.status === 'accepted';
    const adminAlreadyAccepted = adminPrevious.status === 'accepted';

    // If both recipients already received provider acceptance for this event, do not duplicate
    if (customerAlreadyAccepted && adminAlreadyAccepted) {
      console.log(`[Email Idempotency] Both customer and admin emails already accepted by provider for sub ${subId}, payment ${paymentKey}`);
      return {
        success: true,
        skipped: true,
        duplicate: true,
        providerAccepted: true,
        deliveryStatus: 'previously_accepted_by_provider',
        results: {
          customerEmail: {
            success: true,
            status: 'accepted',
            skipped: true,
            alreadySent: true,
            providerAccepted: true,
            id: customerPrevious.messageId,
            provider: customerPrevious.provider,
            acceptedAt: customerPrevious.acceptedAt
          },
          adminEmail: {
            success: true,
            status: 'accepted',
            skipped: true,
            alreadySent: true,
            providerAccepted: true,
            id: adminPrevious.messageId,
            provider: adminPrevious.provider,
            acceptedAt: adminPrevious.acceptedAt
          }
        }
      };
    }

    const isRefundableAuth = Boolean(
      subscription?.authType === 'refundable_authorization' ||
      subscription?.isRefundableAuth ||
      (subscription?.notes && (subscription.notes.authType === 'refundable_authorization' || subscription.notes.isRefundableAuth))
    );

    const recipientCustomerEmail = (customer?.email || address?.email || options.customerEmail || '').trim();
    const adminEmail = (process.env.ADMIN_EMAIL || 'projects@milvanta.in').trim();
    const sender = (process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');

    const results = { customerEmail: null, adminEmail: null };

    // 1. Customer Subscription Email: retry only if not previously accepted
    if (customerAlreadyAccepted) {
      results.customerEmail = {
        success: true,
        status: 'accepted',
        skipped: true,
        alreadySent: true,
        providerAccepted: true,
        id: customerPrevious.messageId,
        provider: customerPrevious.provider,
        acceptedAt: customerPrevious.acceptedAt
      };
    } else if (recipientCustomerEmail && recipientCustomerEmail.includes('@')) {
      const custHtml = buildCustomerSubscriptionEmail({ subscription, customer, address, paymentId });
      const custText = [
        'Your Milvanta subscription details',
        'Product: ' + (subscription.productName || subscription.product_name || 'Fresh milk'),
        'Plan: ' + (subscription.durationLabel || 'See your profile for plan terms'),
        'Payment / mandate status: refer to your account and gateway records.',
        'First delivery: Pending delivery scheduling.',
        'Visit https://milvanta.in/profile.html?tab=subscription to manage your plan.',
        'Team Milvanta'
      ].join('\n');

      const custSendRes = await sendEmail({
        to: recipientCustomerEmail,
        subject: isRefundableAuth
          ? `🥛 Subscription E-Mandate Registered: ${subscription.productName} - Milvanta Farm Fresh`
          : `Milvanta subscription details: ${subscription.productName || 'Fresh milk'}`,
        html: custHtml,
        text: custText,
        from: sender
      });

      if (custSendRes.success && custSendRes.id) {
        results.customerEmail = {
          success: true,
          status: 'accepted',
          providerAccepted: true,
          id: custSendRes.id,
          provider: custSendRes.provider || 'resend',
          acceptedAt: new Date().toISOString()
        };
      } else if (custSendRes.skipped) {
        results.customerEmail = {
          success: false,
          status: 'skipped',
          skipped: true,
          providerAccepted: false,
          error: custSendRes.error || 'SKIPPED',
          message: custSendRes.message
        };
      } else {
        results.customerEmail = {
          success: false,
          status: 'failed',
          providerAccepted: false,
          error: custSendRes.error || 'DISPATCH_FAILED'
        };
      }
    } else {
      results.customerEmail = {
        success: false,
        status: 'skipped',
        skipped: true,
        providerAccepted: false,
        error: 'NO_VALID_CUSTOMER_EMAIL'
      };
    }

    // 2. Admin Subscription Email: retry only if not previously accepted
    if (adminAlreadyAccepted) {
      results.adminEmail = {
        success: true,
        status: 'accepted',
        skipped: true,
        alreadySent: true,
        providerAccepted: true,
        id: adminPrevious.messageId,
        provider: adminPrevious.provider,
        acceptedAt: adminPrevious.acceptedAt
      };
    } else if (adminEmail && adminEmail.includes('@')) {
      const admHtml = buildAdminSubscriptionEmail({ subscription, customer, address, paymentId });
      const admText = [
        'Milvanta subscription requires operations review',
        'Customer: ' + (customer?.name || address?.name || 'Customer'),
        'Product: ' + (subscription.productName || subscription.product_name || 'Fresh milk'),
        'Payment reference: ' + (paymentId || 'Not provided'),
        'Verify captured payment, entitlement and scheduling before dispatch.'
      ].join('\n');

      const admSendRes = await sendEmail({
        to: adminEmail,
        subject: isRefundableAuth
          ? `🚨 New Morning Milk Mandate Registered! - ${subscription.productName} (${customer.name || address.name || 'Customer'})`
          : `Milvanta operations: subscription review - ${subscription.productName || 'Fresh milk'}`,
        html: admHtml,
        text: admText,
        from: sender
      });

      if (admSendRes.success && admSendRes.id) {
        results.adminEmail = {
          success: true,
          status: 'accepted',
          providerAccepted: true,
          id: admSendRes.id,
          provider: admSendRes.provider || 'resend',
          acceptedAt: new Date().toISOString()
        };
      } else if (admSendRes.skipped) {
        results.adminEmail = {
          success: false,
          status: 'skipped',
          skipped: true,
          providerAccepted: false,
          error: admSendRes.error || 'SKIPPED',
          message: admSendRes.message
        };
      } else {
        results.adminEmail = {
          success: false,
          status: 'failed',
          providerAccepted: false,
          error: admSendRes.error || 'DISPATCH_FAILED'
        };
      }
    } else {
      results.adminEmail = {
        success: false,
        status: 'skipped',
        skipped: true,
        providerAccepted: false,
        error: 'NO_VALID_ADMIN_EMAIL'
      };
    }

    // Persist separate recipient status in database
    if (pool && subId) {
      try {
        const updateClient = lockClient || pool;
        const customerToPersist = results.customerEmail?.status === 'accepted'
          ? { status: 'accepted', messageId: results.customerEmail.id, provider: results.customerEmail.provider, acceptedAt: results.customerEmail.acceptedAt }
          : (customerAlreadyAccepted ? customerPrevious : { status: results.customerEmail?.status || 'failed', error: results.customerEmail?.error, attemptedAt: new Date().toISOString() });

        const adminToPersist = results.adminEmail?.status === 'accepted'
          ? { status: 'accepted', messageId: results.adminEmail.id, provider: results.adminEmail.provider, acceptedAt: results.adminEmail.acceptedAt }
          : (adminAlreadyAccepted ? adminPrevious : { status: results.adminEmail?.status || 'failed', error: results.adminEmail?.error, attemptedAt: new Date().toISOString() });

        const eventData = {
          paymentId,
          customer: customerToPersist,
          admin: adminToPersist,
          updatedAt: new Date().toISOString()
        };

        await updateClient.query(
          `UPDATE customer_subscriptions
           SET notes = jsonb_set(
             COALESCE(notes, '{}'::jsonb),
             '{emailConfirmations}',
             COALESCE(notes->'emailConfirmations', '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb)
           ),
           customer_email_sent = CASE WHEN $4::text = 'accepted' THEN TRUE ELSE customer_email_sent END,
           customer_email_at = CASE WHEN $4::text = 'accepted' THEN NOW() ELSE customer_email_at END,
           admin_email_sent = CASE WHEN $5::text = 'accepted' THEN TRUE ELSE admin_email_sent END,
           admin_email_at = CASE WHEN $5::text = 'accepted' THEN NOW() ELSE admin_email_at END,
           updated_at = NOW()
           WHERE id = $3`,
          [paymentKey, JSON.stringify(eventData), subId, results.customerEmail?.status || '', results.adminEmail?.status || '']
        );
      } catch (dbErr) {
        console.warn('[Subscription Email] Database tracking update error:', dbErr.message);
      }
    }

    console.log('[Subscription Email Dispatch Result]', {
      subId,
      paymentId: paymentKey,
      customer: results.customerEmail?.status === 'accepted' ? `ACCEPTED (${results.customerEmail.id})` : (results.customerEmail?.status || 'FAILED'),
      admin: results.adminEmail?.status === 'accepted' ? `ACCEPTED (${results.adminEmail.id})` : (results.adminEmail?.status || 'FAILED')
    });

    const customerAccepted = results.customerEmail?.status === 'accepted';
    const adminAccepted = results.adminEmail?.status === 'accepted';
    const allAccepted = customerAccepted && adminAccepted;

    return {
      success: allAccepted,
      providerAccepted: allAccepted,
      deliveryStatus: allAccepted ? 'accepted_by_provider' : (results.customerEmail?.status === 'skipped' ? 'skipped' : 'partial_or_failed'),
      results
    };
  } finally {
    if (lockClient) {
      try {
        await lockClient.query('COMMIT');
      } catch {} finally {
        lockClient.release();
        lockClient = null;
      }
    }
  }
}

/**
 * Build branded HTML email for Password Reset OTP
 */
export function buildPasswordResetEmail({ customerName, otp }) {
  return renderPasswordResetEmail({ customerName, otp });
}

/**
 * Send password reset email with OTP to customer
 */
export async function sendPasswordResetEmail({ to, customerName, otp }) {
  const subject = 'Your Milvanta Password Reset Code';
  const html = buildPasswordResetEmail({ customerName, otp });
  const text = `Hello ${customerName || 'Valued Customer'},\n\nYour Milvanta password reset OTP is: ${otp}\n\nThis OTP is valid for 10 minutes. If you did not request this, please ignore this email.\n\nTeam Milvanta`;

  const sender = (process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');
  return sendEmail({
    to,
    subject,
    html,
    text,
    from: sender
  });
}

/**
 * Generate Customer Welcome Email HTML
 */
export function buildWelcomeEmail({ customerName }) {
  return renderWelcomeEmail({ customerName });
}

/**
 * Send welcome email to new customer via Resend / SMTP
 */
export async function sendWelcomeEmail({ to, customerName }) {
  const subject = 'Welcome to Milvanta — Pure Fresh Milk & Dairy';
  const html = buildWelcomeEmail({ customerName });
  const text = `Hi ${customerName || 'Valued Customer'},\n\nWelcome to Milvanta! Your account has been created successfully.\n\nYou can now log in, browse our products and manage orders. Delivery timing and availability will be shown during checkout or in your subscription calendar.\n\nConnecting Farms to Families\nTeam Milvanta`;
  const sender = (process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');
  return sendEmail({
    to,
    subject,
    html,
    text,
    from: sender
  });
}

