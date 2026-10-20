import 'dotenv/config';
import nodemailer from 'nodemailer';

const RESEND_API_URL = 'https://api.resend.com/emails';

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
      id: data.id
    };
  } catch (err) {
    console.error('[Resend Network Error]', err);
    return {
      success: false,
      error: err.message || 'RESEND_NETWORK_FAILURE'
    };
  }
}

/**
 * Format currency helper
 */
function formatInr(paiseOrRupees, isPaise = false) {
  const val = isPaise ? Math.round(Number(paiseOrRupees) / 100) : Number(paiseOrRupees);
  return '₹' + (isNaN(val) ? 0 : val).toLocaleString('en-IN');
}

/**
 * Generate Customer Order Confirmation Email HTML
 */
export function buildCustomerOrderEmail({ order, customer, address, items, paymentId }) {
  const orderNumber = escapeHtml(order.order_number || `MV-${order.id}`);
  const customerName = escapeHtml(address?.name || customer?.full_name || customer?.name || 'Valued Customer');
  const totalStr = formatInr(order.total_paise, true);
  const subtotalStr = formatInr(order.subtotal_paise, true);
  const deliveryStr = Number(order.delivery_charge_paise) > 0 ? formatInr(order.delivery_charge_paise, true) : 'FREE';

  const orderDate = new Date(order.created_at || Date.now()).toLocaleDateString('en-IN', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const addressLines = [
    address?.house,
    address?.building,
    address?.street,
    address?.landmark ? `Landmark: ${address.landmark}` : null,
    address?.city ? `${address.city} - ${address.pincode || ''}` : null
  ].filter(Boolean).map(escapeHtml).join('<br/>');

  const itemsRows = (items || []).map((item) => {
    const name = escapeHtml(item.name || 'Artisanal Product');
    const unit = escapeHtml(item.unit || item.size || '');
    const qty = Number(item.quantity || 1);
    const unitPrice = formatInr(item.unitPricePaise || Math.round((item.price || 0) * 100), true);
    const lineTotal = formatInr(item.lineTotalPaise || Math.round((item.price || 0) * qty * 100), true);
    const imgUrl = item.imageUrl || item.image || '';

    return `
      <tr style="border-bottom: 1px solid #eef2f6;">
        <td style="padding: 12px 8px; vertical-align: middle;">
          ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${name}" width="48" height="48" style="border-radius: 8px; object-fit: cover; display: block; background: #f8fafc; border: 1px solid #e2e8f0;" />` : ''}
        </td>
        <td style="padding: 12px 8px; vertical-align: middle;">
          <div style="font-weight: 700; color: #0f172a; font-size: 14px;">${name}</div>
          ${unit ? `<div style="font-size: 12px; color: #64748b;">${unit}</div>` : ''}
        </td>
        <td style="padding: 12px 8px; text-align: center; color: #475569; font-size: 13px; vertical-align: middle;">
          ${qty} × ${unitPrice}
        </td>
        <td style="padding: 12px 8px; text-align: right; font-weight: 700; color: #0a3d66; font-size: 14px; vertical-align: middle;">
          ${lineTotal}
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmed - ${orderNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);" cellspacing="0" cellpadding="0">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0a3d66 0%, #072d4c 100%); padding: 32px 28px; text-align: center; color: #ffffff;">
              <div style="letter-spacing: 2px; font-size: 22px; font-weight: 800; margin-bottom: 6px;">MILVANTA</div>
              <div style="font-size: 12px; opacity: 0.85; text-transform: uppercase; letter-spacing: 1px;">Farm Fresh &amp; Artisanal Pantry</div>
              <div style="margin-top: 18px; display: inline-block; background: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                ✓ Order Paid &amp; Confirmed
              </div>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 28px 24px;">
              <h2 style="font-size: 20px; margin: 0 0 10px; color: #0f172a;">Thank you for your order, ${customerName}!</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
                We have received your payment of <strong style="color: #0a3d66;">${totalStr}</strong>. Our cold-chain team is preparing your fresh farm favorites straight from our Hafeezpet hub.
              </p>

              <!-- Order Metadata Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <table width="100%" cellspacing="0" cellpadding="4">
                      <tr>
                        <td style="font-size: 13px; color: #64748b; width: 40%;">Order Number:</td>
                        <td style="font-size: 13px; font-weight: 700; color: #0a3d66;">#${orderNumber}</td>
                      </tr>
                      <tr>
                        <td style="font-size: 13px; color: #64748b;">Order Date:</td>
                        <td style="font-size: 13px; color: #0f172a;">${orderDate}</td>
                      </tr>
                      <tr>
                        <td style="font-size: 13px; color: #64748b;">Payment Method:</td>
                        <td style="font-size: 13px; color: #059669; font-weight: 600;">✓ Razorpay Online (${paymentId || 'Verified'})</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Items Breakdown Table -->
              <h3 style="font-size: 15px; margin: 0 0 12px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Your Ordered Items</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                    <th style="padding: 8px; text-align: left; font-size: 12px; color: #64748b; text-transform: uppercase;">Image</th>
                    <th style="padding: 8px; text-align: left; font-size: 12px; color: #64748b; text-transform: uppercase;">Item</th>
                    <th style="padding: 8px; text-align: center; font-size: 12px; color: #64748b; text-transform: uppercase;">Qty</th>
                    <th style="padding: 8px; text-align: right; font-size: 12px; color: #64748b; text-transform: uppercase;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>

              <!-- Bill Breakdown -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <table width="100%" cellspacing="0" cellpadding="4">
                      <tr>
                        <td style="font-size: 13px; color: #475569;">Items Subtotal</td>
                        <td style="font-size: 13px; font-weight: 600; color: #0f172a; text-align: right;">${subtotalStr}</td>
                      </tr>
                      <tr>
                        <td style="font-size: 13px; color: #475569;">Cold-Chain Delivery Charges</td>
                        <td style="font-size: 13px; font-weight: 600; color: #0f172a; text-align: right;">${deliveryStr}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding: 6px 0;"><div style="height: 1px; background: #cbd5e1;"></div></td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 800; color: #0f172a;">Total Paid</td>
                        <td style="font-size: 18px; font-weight: 800; color: #0a3d66; text-align: right;">${totalStr}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Destination Address -->
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                <div style="font-size: 12px; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 6px;">📍 Delivering To:</div>
                <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">${customerName} (${escapeHtml(address?.phone || customer?.phone || '')})</div>
                <div style="font-size: 13px; color: #475569; line-height: 1.5;">${addressLines}</div>
              </div>

              <!-- Support Note -->
              <div style="text-align: center; padding: 12px 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px;">
                <p style="font-size: 13px; color: #065f46; margin: 0; line-height: 1.4;">
                  Have questions or need assistance? Reply to this email or WhatsApp us at <strong>+91 9052222256</strong>.
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #0f172a; padding: 24px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6;">
              <strong style="color: #ffffff;">Milvanta Organics &amp; Direct Dairy</strong><br/>
              Hafeezpet Hub, Hyderabad, Telangana 500049<br/>
              © 2026 Milvanta. All rights reserved.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate Admin Order Notification Email HTML
 */
export function buildAdminOrderEmail({ order, customer, address, items, paymentId }) {
  const orderNumber = escapeHtml(order.order_number || `MV-${order.id}`);
  const customerName = escapeHtml(address?.name || customer?.full_name || customer?.name || 'Customer');
  const customerPhone = escapeHtml(address?.phone || customer?.phone || 'N/A');
  const customerEmail = escapeHtml(address?.email || customer?.email || 'N/A');
  const totalStr = formatInr(order.total_paise, true);
  const subtotalStr = formatInr(order.subtotal_paise, true);
  const deliveryStr = formatInr(order.delivery_charge_paise, true);

  const orderDate = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const addressLines = [
    address?.house,
    address?.building,
    address?.street,
    address?.landmark ? `Landmark: ${address.landmark}` : null,
    address?.city ? `${address.city} - ${address.pincode || ''}` : null
  ].filter(Boolean).map(escapeHtml).join('<br/>');

  const itemsRows = (items || []).map((item, idx) => {
    const name = escapeHtml(item.name || 'Artisanal Product');
    const unit = escapeHtml(item.unit || item.size || '');
    const qty = Number(item.quantity || 1);
    const lineTotal = formatInr(item.lineTotalPaise || Math.round((item.price || 0) * qty * 100), true);

    return `
      <tr style="border-bottom: 1px solid #e2e8f0; background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding: 10px 12px; font-weight: 700; color: #0f172a; font-size: 14px;">
          ${name}
          ${unit ? `<span style="font-weight: 400; color: #64748b; font-size: 12px;"> (${unit})</span>` : ''}
        </td>
        <td style="padding: 10px 12px; text-align: center; font-weight: 800; color: #0a3d66; font-size: 15px;">
          ${qty}
        </td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #0f172a; font-size: 14px;">
          ${lineTotal}
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Paid Order - ${orderNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0;" cellspacing="0" cellpadding="0">
          
          <!-- Admin Alert Banner -->
          <tr>
            <td style="background: #0a3d66; padding: 24px; color: #ffffff;">
              <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.85; margin-bottom: 4px;">ADMIN DISPATCH ALERT</div>
              <h1 style="font-size: 22px; margin: 0 0 8px; color: #ffffff;">🚨 New Paid Order: #${orderNumber}</h1>
              <div style="font-size: 15px; font-weight: 600; color: #34d399;">
                Amount Received: ${totalStr} via Razorpay
              </div>
            </td>
          </tr>

          <!-- Customer Info -->
          <tr>
            <td style="padding: 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f1f5f9; border-radius: 10px; padding: 14px; margin-bottom: 20px;">
                <tr>
                  <td>
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Customer Details</div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">${customerName}</div>
                    <div style="font-size: 13px; color: #334155;">
                      📞 <a href="tel:${customerPhone}" style="color: #0a3d66; font-weight: 600; text-decoration: none;">${customerPhone}</a> · 
                      ✉️ <a href="mailto:${customerEmail}" style="color: #0a3d66; text-decoration: none;">${customerEmail}</a>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Delivery Address -->
              <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px; margin-bottom: 20px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #1e40af; margin-bottom: 4px;">📍 Delivery Location</div>
                <div style="font-size: 13px; color: #1e293b; line-height: 1.5;">${addressLines}</div>
              </div>

              <!-- Packing List -->
              <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #0f172a; margin: 0 0 10px;">📦 Packing Checklist</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background: #e2e8f0;">
                    <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #475569;">Item</th>
                    <th style="padding: 8px 12px; text-align: center; font-size: 12px; color: #475569;">Qty</th>
                    <th style="padding: 8px 12px; text-align: right; font-size: 12px; color: #475569;">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>

              <!-- Payment Breakdown -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="4" style="font-size: 13px; color: #475569; margin-bottom: 16px;">
                <tr>
                  <td>Items Subtotal</td>
                  <td style="text-align: right; font-weight: 600; color: #0f172a;">${subtotalStr}</td>
                </tr>
                <tr>
                  <td>Delivery Fee</td>
                  <td style="text-align: right; font-weight: 600; color: #0f172a;">${deliveryStr}</td>
                </tr>
                <tr style="border-top: 1px solid #cbd5e1;">
                  <td style="font-weight: 700; color: #0f172a; padding-top: 6px;">Total Paid</td>
                  <td style="text-align: right; font-weight: 800; font-size: 16px; color: #0a3d66; padding-top: 6px;">${totalStr}</td>
                </tr>
              </table>

              <div style="font-size: 11px; color: #64748b; padding-top: 10px; border-top: 1px solid #f1f5f9;">
                Razorpay Payment ID: <code>${escapeHtml(paymentId || 'N/A')}</code> · Recorded At: ${orderDate} IST
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f1f5f9; padding: 14px; text-align: center; color: #64748b; font-size: 12px;">
              Automated Milvanta Operations Notification · Hafeezpet Hub Dispatch
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Send order confirmation emails to both customer and admin
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
      console.warn('[Resend] Order not found for email dispatch:', orderId);
      return { success: false, error: 'ORDER_NOT_FOUND' };
    }

    const order = res.rows[0];

    // Check if confirmation email was already sent
    if (order.confirmation_email_sent) {
      console.log(`[Resend] Confirmation email already sent for order #${order.order_number}. Skipping.`);
      return { success: true, skipped: true, alreadySent: true };
    }

    const address = typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {});
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
    const customer = {
      name: order.customer_name || address.name,
      email: address.email || order.customer_email,
      phone: address.phone || order.customer_phone
    };

    const recipientCustomerEmail = customer.email?.trim();
    const adminEmail = process.env.ADMIN_EMAIL?.trim() || 'projects@milvanta.in';
    const sender = (process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');

    const results = {
      customerEmail: null,
      adminEmail: null
    };

    // 1. Send Customer Email
    if (recipientCustomerEmail && recipientCustomerEmail.includes('@')) {
      const customerHtml = buildCustomerOrderEmail({
        order,
        customer,
        address,
        items,
        paymentId
      });

      const customerText = `Thank you for your order, ${customer.name || 'Valued Customer'}!\n\nYour order #${order.order_number} has been paid and confirmed.\nTotal Paid: ${formatInr(order.total_paise, true)}\n\nDelivering To:\n${address.house || ''}, ${address.building || ''}, ${address.street || ''}, ${address.city || ''} - ${address.pincode || ''}\n\nTeam Milvanta\nHafeezpet Hub, Hyderabad`;

      results.customerEmail = await sendEmail({
        to: recipientCustomerEmail,
        subject: `Order Confirmed: #${order.order_number} - Milvanta Farm Fresh`,
        html: customerHtml,
        text: customerText,
        from: sender
      });
    } else {
      console.warn('[Resend] No valid customer email found for order #' + order.order_number);
    }

    // 2. Send Admin Notification Email
    if (adminEmail && adminEmail.includes('@')) {
      const adminHtml = buildAdminOrderEmail({
        order,
        customer,
        address,
        items,
        paymentId
      });

      const adminText = `ALERT: New Paid Order #${order.order_number}\nAmount: ${formatInr(order.total_paise, true)}\nCustomer: ${customer.name} (${customer.phone}, ${customer.email})\nAddress: ${address.house || ''}, ${address.building || ''}, ${address.street || ''}, ${address.city || ''} - ${address.pincode || ''}\nRazorpay Payment ID: ${paymentId}`;

      results.adminEmail = await sendEmail({
        to: adminEmail,
        subject: `🚨 New Paid Order #${order.order_number} - ${formatInr(order.total_paise, true)} (${customer.name})`,
        html: adminHtml,
        text: adminText,
        from: sender
      });
    }

    // Mark email sent in DB if at least one attempt succeeded or Resend was called
    try {
      await client.query(
        `UPDATE customer_orders 
         SET confirmation_email_sent = TRUE, confirmation_email_at = NOW() 
         WHERE id = $1`,
        [order.id]
      );
    } catch (dbErr) {
      // If columns don't exist yet, ignore
      console.warn('[Resend] Could not update confirmation_email_sent column (migration might be pending):', dbErr.message);
    }

    return {
      success: true,
      results
    };

  } catch (err) {
    console.error('[Resend] Failed to send order emails:', err);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Generate Customer Subscription Confirmation Email HTML
 */
export function buildCustomerSubscriptionEmail({ subscription, customer, address, paymentId }) {
  const customerName = escapeHtml(customer?.name || customer?.full_name || address?.name || 'Valued Customer');
  const productName = escapeHtml(subscription?.productName || subscription?.product_name || subscription?.product || 'Pure Fresh Milk');
  const size = escapeHtml(subscription?.quantity || subscription?.size || '500 ml');
  const frequency = escapeHtml(subscription?.frequency || 'Daily (Every Morning)');
  const timeSlot = escapeHtml(subscription?.timeSlot || subscription?.time_slot || '6:00 AM – 7:00 AM');
  const isCustom = (subscription?.planType || subscription?.plan_type) === 'custom' || String(subscription?.durationLabel || '').toLowerCase().includes('custom');
  const isRefundableAuth = Boolean(
    subscription?.authType === 'refundable_authorization' ||
    subscription?.isRefundableAuth ||
    (subscription?.notes && (subscription.notes.authType === 'refundable_authorization' || subscription.notes.isRefundableAuth))
  );
  const authAmountPaise = Number(subscription?.authAmountPaise || subscription?.notes?.authAmountPaise || 200);

  const planTag = isRefundableAuth
    ? 'E-Mandate Autopay Authorized & Registered'
    : (isCustom ? 'Custom Days Plan' : 'Continuous Monthly Subscription');
  const durationLabel = escapeHtml(subscription?.durationLabel || subscription?.duration_label || (isCustom ? `${subscription?.days || 7} Days Custom Plan` : 'Continuous Monthly'));
  const dailyRate = subscription?.costPerDay || subscription?.dailyRate || Math.round((subscription?.cost_per_day_paise || 5500) / 100);
  const subtotalPlan = subscription?.totalAmount || Math.round((subscription?.total_amount_paise || 0) / 100) || (dailyRate * (subscription?.days || 30));
  const deliveryFee = Number(subscription?.deliveryFee || 50);
  const totalPaid = subscription?.totalPaid || (subtotalPlan + deliveryFee);
  const dailyRateStr = formatInr(dailyRate);
  const subtotalPlanStr = formatInr(subtotalPlan);
  const deliveryFeeStr = formatInr(deliveryFee);
  const totalPaidStr = formatInr(totalPaid);
  const nextDelivery = escapeHtml(subscription?.nextDelivery || subscription?.next_delivery || 'Tomorrow Morning · 6:00 AM – 7:00 AM');
  const imgUrl = subscription?.image || subscription?.image_url || (productName.toLowerCase().includes('buffalo') ? 'https://milvanta.in/assets/milvanta-buffalo-milk.jpg' : 'https://milvanta.in/assets/milvanta-cow-milk.jpg');
  const paymentMethod = isRefundableAuth
    ? 'UPI Autopay / Card E-Mandate (Refundable Authorization)'
    : (isCustom ? 'Paid Online via Razorpay (One-Time)' : 'Subscription Autopay (Razorpay Recurring)');

  const addressLines = [
    address?.house,
    address?.building,
    address?.street,
    address?.landmark ? `Landmark: ${address.landmark}` : null,
    address?.city ? `${address.city} - ${address.pincode || ''}` : null
  ].filter(Boolean).map(escapeHtml).join('<br/>');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${isRefundableAuth ? 'Your Milk Subscription E-Mandate is Registered' : 'Your Morning Milk Subscription is Confirmed'} - Milvanta</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0a3d66 0%, #065f46 100%); padding: 32px 28px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0 0 6px; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">🥛 Milvanta Farm Fresh</h1>
              <p style="color: #d1fae5; margin: 0; font-size: 14px; font-weight: 500;">Direct from Ethical Local Dairy Farms to Your Doorstep</p>
            </td>
          </tr>

          <!-- Welcome Body -->
          <tr>
            <td style="padding: 28px 28px 16px;">
              <div style="display: inline-block; background: ${isRefundableAuth ? '#e0e7ff' : (isCustom ? '#dcfce7' : '#e0f2fe')}; color: ${isRefundableAuth ? '#3730a3' : (isCustom ? '#15803d' : '#0369a1')}; border: 1px solid ${isRefundableAuth ? '#c7d2fe' : (isCustom ? '#bbf7d0' : '#bae6fd')}; border-radius: 9999px; padding: 4px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px;">
                ${planTag}
              </div>
              <h2 style="color: #0f172a; margin: 0 0 10px; font-size: 20px; font-weight: 700;">${isRefundableAuth ? `Mandate Activated, ${customerName}!` : `Welcome to Morning Fresh Milk, ${customerName}!`}</h2>
              <p style="color: #475569; margin: 0 0 20px; font-size: 14px; line-height: 1.6;">
                ${isRefundableAuth 
                  ? `Your subscription autopay mandate has been registered successfully! Regular morning deliveries are scheduled to begin on <strong>${nextDelivery}</strong>. Monthly plan charges will be debited automatically at each recurring billing cycle.`
                  : `Your daily milk subscription has been activated successfully! Fresh, chilled, unadulterated milk will be placed right at your doorstep every morning.`
                }
              </p>

              <!-- Subscription Highlight Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 22px;">
                <tr>
                  <td width="70" style="vertical-align: top; padding-right: 14px;">
                    <img src="${escapeHtml(imgUrl)}" alt="${productName}" width="70" height="70" style="border-radius: 10px; object-fit: cover; display: block; border: 1px solid #cbd5e1;" />
                  </td>
                  <td style="vertical-align: top;">
                    <h3 style="margin: 0 0 4px; font-size: 16px; color: #0f172a;">${productName}</h3>
                    <div style="font-size: 13px; color: #64748b; margin-bottom: 8px;">${size} · ${frequency}</div>
                    <div style="font-size: 13px; color: #0284c7; font-weight: 600;">⏰ ${timeSlot}</div>
                  </td>
                </tr>
              </table>

              <!-- Delivery & Plan Metrics -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="font-size: 13px; color: #475569; margin-bottom: 20px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 14px;">
                <tr>
                  <td style="color: #64748b;">Plan Duration</td>
                  <td style="text-align: right; font-weight: 700; color: #0f172a;">${durationLabel}</td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Daily Rate</td>
                  <td style="text-align: right; font-weight: 700; color: #059669;">${dailyRateStr}/day</td>
                </tr>
                ${isRefundableAuth ? `
                <tr>
                  <td style="color: #64748b;">Mandate Token Authorization</td>
                  <td style="text-align: right; font-weight: 700; color: #4338ca;">${formatInr(authAmountPaise, true)} (Refundable Auth)</td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Recurring Billing Amount</td>
                  <td style="text-align: right; font-weight: 800; font-size: 14px; color: #0a3d66;">${subtotalPlanStr} / month</td>
                </tr>
                ` : `
                <tr>
                  <td style="color: #64748b;">Deliveries Subtotal</td>
                  <td style="text-align: right; font-weight: 700; color: #0f172a;">${subtotalPlanStr}</td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Delivery Charges</td>
                  <td style="text-align: right; font-weight: 700; color: #0284c7;">${deliveryFeeStr}</td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Total Amount Paid</td>
                  <td style="text-align: right; font-weight: 800; font-size: 15px; color: #0a3d66;">${totalPaidStr}</td>
                </tr>
                `}
                <tr>
                  <td style="color: #64748b;">Payment Method</td>
                  <td style="text-align: right; font-weight: 600; color: #0f172a;">${paymentMethod}</td>
                </tr>
                <tr>
                  <td style="color: #64748b;">First Delivery Scheduled</td>
                  <td style="text-align: right; font-weight: 700; color: #0284c7;">${nextDelivery}</td>
                </tr>
              </table>

              <!-- Delivery Address Box -->
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 22px;">
                <div style="font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; margin-bottom: 6px;">📍 Doorstep Delivery Destination</div>
                <div style="font-size: 13px; color: #334155; line-height: 1.5;">${addressLines}</div>
              </div>

              <!-- Customer Profile Self-Service Help -->
              <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px;">
                <div style="font-size: 13px; font-weight: 700; color: #065f46; margin-bottom: 4px;">📅 Complete Flexibility at Your Fingertips</div>
                <div style="font-size: 12px; color: #047857; line-height: 1.5;">
                  Going out of station or need extra milk for guests? You can <strong>pause delivery</strong>, <strong>resume</strong>, or <strong>modify bottle quantities</strong> anytime with one click in your <a href="https://milvanta.in/profile.html?tab=subscription" style="color: #065f46; font-weight: 700;">Milvanta Profile Subscriptions Tab</a>.
                </div>
              </div>

              <div style="font-size: 11px; color: #94a3b8; padding-top: 10px; border-top: 1px solid #f1f5f9;">
                Reference Payment ID: <code>${escapeHtml(paymentId || 'N/A')}</code> · Dispatch Hub: Hafeezpet Cold-Chain Center, Hyderabad
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f1f5f9; padding: 20px; text-align: center; color: #64748b; font-size: 12px; line-height: 1.5;">
              Milvanta Artisanal Foods & Dairy · Hafeezpet Hub, Hyderabad, Telangana 500049<br/>
              Need assistance? WhatsApp us at <a href="https://wa.me/919052222256" style="color: #0a3d66; font-weight: 700; text-decoration: none;">+91 9052222256</a> or email <a href="mailto:orders@milvanta.in" style="color: #0a3d66; text-decoration: none;">orders@milvanta.in</a>.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate Admin Subscription Notification Email HTML
 */
export function buildAdminSubscriptionEmail({ subscription, customer, address, paymentId }) {
  const customerName = escapeHtml(customer?.name || customer?.full_name || address?.name || 'Customer');
  const customerEmail = escapeHtml(customer?.email || address?.email || 'N/A');
  const customerPhone = escapeHtml(customer?.phone || address?.phone || 'N/A');
  const productName = escapeHtml(subscription?.productName || subscription?.product_name || subscription?.product || 'Fresh Milk');
  const size = escapeHtml(subscription?.quantity || subscription?.size || '500 ml');
  const frequency = escapeHtml(subscription?.frequency || 'Daily (Every Morning)');
  const timeSlot = escapeHtml(subscription?.timeSlot || subscription?.time_slot || '6:00 AM – 7:00 AM');
  const isCustom = (subscription?.planType || subscription?.plan_type) === 'custom' || String(subscription?.durationLabel || '').toLowerCase().includes('custom');
  const isRefundableAuth = Boolean(
    subscription?.authType === 'refundable_authorization' ||
    subscription?.isRefundableAuth ||
    (subscription?.notes && (subscription.notes.authType === 'refundable_authorization' || subscription.notes.isRefundableAuth))
  );
  const authAmountPaise = Number(subscription?.authAmountPaise || subscription?.notes?.authAmountPaise || 200);

  const planTag = isRefundableAuth
    ? 'E-Mandate Autopay Authorized & Registered'
    : (isCustom ? 'Custom Days Plan' : 'Continuous Monthly Subscription');
  const durationLabel = escapeHtml(subscription?.durationLabel || subscription?.duration_label || (isCustom ? `${subscription?.days || 7} Days Custom Plan` : 'Continuous Monthly'));
  const dailyRate = subscription?.costPerDay || subscription?.dailyRate || Math.round((subscription?.cost_per_day_paise || 5500) / 100);
  const totalAmount = subscription?.totalAmount || Math.round((subscription?.total_amount_paise || 0) / 100) || (dailyRate * (subscription?.days || 30));
  const deliveryFee = Number(subscription?.deliveryFee || 50);
  const totalPaid = subscription?.totalPaid || (totalAmount + deliveryFee);

  const addressLines = [
    address?.house,
    address?.building,
    address?.street,
    address?.landmark ? `Landmark: ${address.landmark}` : null,
    address?.city ? `${address.city} - ${address.pincode || ''}` : null
  ].filter(Boolean).map(escapeHtml).join('<br/>');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${isRefundableAuth ? 'ALERT: New Morning Milk Mandate Registered' : 'ALERT: New Morning Milk Subscription'}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1;">
          
          <tr style="background: #0a3d66; color: #ffffff;">
            <td style="padding: 20px 24px;">
              <h2 style="margin: 0 0 4px; font-size: 20px; color: #ffffff;">${isRefundableAuth ? '🚨 ACTION REQUIRED: New Morning Milk Mandate Registered' : '🚨 ACTION REQUIRED: New Morning Milk Subscription'}</h2>
              <div style="font-size: 13px; color: #93c5fd;">Add customer to tomorrow's early morning route sheet</div>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 24px;">
              <div style="display: inline-block; background: ${isRefundableAuth ? '#e0e7ff' : (isCustom ? '#dcfce7' : '#e0f2fe')}; color: ${isRefundableAuth ? '#3730a3' : (isCustom ? '#15803d' : '#0369a1')}; border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 700; margin-bottom: 12px;">
                ${planTag}
              </div>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="font-size: 13px; margin-bottom: 16px;">
                <tr>
                  <td width="140" style="color: #64748b;">Customer</td>
                  <td><strong>${customerName}</strong></td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Phone</td>
                  <td><a href="tel:${customerPhone}" style="color: #0a3d66; font-weight: 700;">${customerPhone}</a></td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Email</td>
                  <td><a href="mailto:${customerEmail}" style="color: #0a3d66;">${customerEmail}</a></td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Product</td>
                  <td><strong>${productName} (${size})</strong></td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Schedule</td>
                  <td><strong>${frequency} · ${timeSlot}</strong></td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Plan Duration</td>
                  <td><strong>${durationLabel}</strong></td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Daily Rate</td>
                  <td style="color: #059669; font-weight: 700;">₹${dailyRate}/day</td>
                </tr>
                ${isRefundableAuth ? `
                <tr>
                  <td style="color: #64748b;">Mandate Auth Amount</td>
                  <td style="color: #4338ca; font-weight: 700;">${formatInr(authAmountPaise, true)} (Refundable Token Auth)</td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Recurring Plan Charge</td>
                  <td style="color: #0a3d66; font-weight: 800; font-size: 14px;">₹${totalAmount.toLocaleString('en-IN')} / month</td>
                </tr>
                ` : `
                <tr>
                  <td style="color: #64748b;">Deliveries Subtotal</td>
                  <td><strong>₹${totalAmount.toLocaleString('en-IN')}</strong></td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Delivery Fee</td>
                  <td style="color: #0284c7; font-weight: 700;">₹${deliveryFee}</td>
                </tr>
                <tr>
                  <td style="color: #64748b;">Total Paid</td>
                  <td style="color: #0a3d66; font-weight: 800; font-size: 15px;">₹${totalPaid.toLocaleString('en-IN')}</td>
                </tr>
                `}
                <tr>
                  <td style="color: #64748b;">Payment / Sub ID</td>
                  <td><code>${escapeHtml(paymentId || 'N/A')}</code></td>
                </tr>
              </table>

              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                <div style="font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; margin-bottom: 4px;">📍 Delivery Route Drop Address</div>
                <div style="font-size: 13px; color: #334155; line-height: 1.4;">${addressLines}</div>
              </div>

              <div style="font-size: 11px; color: #64748b;">
                Hafeezpet Hub Logistics Notification · Recorded at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
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
            costPerDay: Math.round(row.cost_per_day_paise / 100),
            planType: row.plan_type || 'month',
            durationLabel: row.duration_label || '',
            totalAmount: Math.round((row.total_amount_paise || 0) / 100),
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
      const custText = `Your Milvanta Milk Subscription is Confirmed!\n\nProduct: ${subscription.productName} (${subscription.quantity})\nSchedule: ${subscription.frequency} (${subscription.timeSlot})\nDuration: ${subscription.durationLabel}\nDaily Rate: ₹${subscription.costPerDay}/day\nNext Delivery: Tomorrow at 6:00 AM\n\nDelivering to:\n${address.house || ''}, ${address.street || ''}, ${address.city || ''} - ${address.pincode || ''}\n\nManage anytime from your Milvanta Profile.\nTeam Milvanta`;

      const custSendRes = await sendEmail({
        to: recipientCustomerEmail,
        subject: isRefundableAuth
          ? `🥛 Subscription E-Mandate Registered: ${subscription.productName} - Milvanta Farm Fresh`
          : `🥛 Subscription Confirmed: ${subscription.productName} - Milvanta Farm Fresh`,
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
      const admText = `ALERT: New Morning Milk Subscription!\nCustomer: ${customer.name || address.name} (${customer.phone || address.phone}, ${customer.email || address.email})\nProduct: ${subscription.productName} (${subscription.quantity})\nPlan: ${subscription.planType === 'custom' ? 'Custom Days' : 'Continuous Monthly'} (${subscription.durationLabel})\nDaily Rate: ₹${subscription.costPerDay}/day\nAddress: ${address.house || ''}, ${address.street || ''}, ${address.city || ''} - ${address.pincode || ''}\nRazorpay Payment ID: ${paymentId}`;

      const admSendRes = await sendEmail({
        to: adminEmail,
        subject: isRefundableAuth
          ? `🚨 New Morning Milk Mandate Registered! - ${subscription.productName} (${customer.name || address.name || 'Customer'})`
          : `🚨 New Morning Milk Subscription! - ${subscription.productName} (${customer.name || address.name || 'Customer'})`,
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
           )
           WHERE id = $3`,
          [paymentKey, JSON.stringify(eventData), subId]
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
  const safeName = escapeHtml(customerName || 'Valued Customer');
  const safeOtp = escapeHtml(otp);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset OTP - Milvanta</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 540px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          <!-- Brand Header -->
          <tr>
            <td style="background-color: #0a3d66; padding: 32px 28px; text-align: center;">
              <span style="font-size: 13px; font-weight: 700; letter-spacing: 3px; color: #93c5fd; text-transform: uppercase; display: block; margin-bottom: 6px;">MILVANTA FARM DIRECT</span>
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">Account Security</h1>
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="padding: 32px 28px;">
              <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #0a3d66;">Hello ${safeName},</p>
              <p style="margin: 0 0 20px; font-size: 15px; color: #475569; line-height: 1.6;">
                We received a request to reset the password for your Milvanta account. Please use the 6-digit One-Time Password (OTP) below to verify your identity and set a new password:
              </p>

              <!-- OTP Highlight Box -->
              <div style="background-color: #f0f7ff; border: 2px dashed #0284c7; border-radius: 12px; padding: 22px 20px; text-align: center; margin: 26px 0;">
                <span style="font-size: 12px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 1.5px; display: block; margin-bottom: 8px;">Your One-Time Password (OTP)</span>
                <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #0a3d66; display: inline-block;">${safeOtp}</span>
              </div>

              <!-- Expiry & Security Notice -->
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 10px; padding: 14px 16px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.5;">
                  <strong>⏱️ Valid for 10 minutes:</strong> This code can only be used once. For your protection, never share this code with anyone.
                </p>
              </div>

              <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                If you did not request a password reset, you can safely ignore this email. Your existing password remains secure and will not be changed.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 28px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #0a3d66;">Milvanta Customer Care</p>
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">Fresh Farm-Direct Dairy & Artisanal Essentials · Hyderabad</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Send password reset email with OTP to customer
 */
export async function sendPasswordResetEmail({ to, customerName, otp }) {
  const subject = `Your Milvanta Password Reset OTP: ${otp}`;
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



