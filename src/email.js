import 'dotenv/config';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

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
 * Enqueue transactional email outbox records for a confirmed paid order
 */
export async function enqueueOrderPaidOutbox(client, { order, customer, address, items, paymentId }) {
  if (!client || !order) return [];
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
      costPerDay: subscription.cost_per_day_paise ? Math.round(subscription.cost_per_day_paise / 100) : (subscription.costPerDay || 55),
      planType: subscription.plan_type || subscription.planType || 'custom',
      durationLabel: subscription.duration_label || subscription.durationLabel || '7 Days Custom Plan',
      totalAmount: subscription.total_amount_paise ? Math.round(subscription.total_amount_paise / 100) : (subscription.totalAmount || 0),
      image: subscription.image_url || subscription.image,
      status: subscription.status || 'active',
      nextDelivery: subscription.next_delivery || subscription.nextDelivery || 'Tomorrow, 6:00 AM',
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
      costPerDay: subscription.cost_per_day_paise ? Math.round(subscription.cost_per_day_paise / 100) : (subscription.costPerDay || 55),
      planType: subscription.plan_type || subscription.planType || 'monthly',
      durationLabel: subscription.duration_label || subscription.durationLabel || 'Monthly Recurring',
      totalAmount: subscription.total_amount_paise ? Math.round(subscription.total_amount_paise / 100) : (subscription.totalAmount || 0),
      image: subscription.image_url || subscription.image,
      status: subscription.status || 'active',
      nextDelivery: subscription.next_delivery || subscription.nextDelivery || 'Tomorrow, 6:00 AM',
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
        subject = `Order Confirmed: #${payload.order?.order_number || ''} - Milvanta Farm Fresh`;
        html = buildCustomerOrderEmail(payload);
        text = `Thank you for your order, ${payload.customer?.name || 'Valued Customer'}!\n\nYour order #${payload.order?.order_number} has been paid and confirmed.\nTotal Paid: ${formatInr(payload.order?.total_paise, true)}`;
      } else if (item.email_type === 'order_notification') {
        subject = `🚨 New Paid Order #${payload.order?.order_number || ''} - ${formatInr(payload.order?.total_paise, true)} (${payload.customer?.name || 'Customer'})`;
        html = buildAdminOrderEmail(payload);
        text = `ALERT: New Paid Order #${payload.order?.order_number}\nAmount: ${formatInr(payload.order?.total_paise, true)}\nCustomer: ${payload.customer?.name} (${payload.customer?.phone}, ${payload.customer?.email})`;
      } else if (item.email_type === 'subscription_confirmation') {
        const isRefundable = payload.subscription?.notes?.authType === 'refundable_authorization';
        subject = isRefundable
          ? `🥛 Subscription E-Mandate Registered: ${payload.subscription?.productName || payload.subscription?.product_name || 'Fresh Milk'} - Milvanta Farm Fresh`
          : (payload.isRenewal
              ? `🥛 Subscription Renewal Confirmed: ${payload.subscription?.productName || payload.subscription?.product_name || 'Fresh Milk'} - Milvanta Farm Fresh`
              : `🥛 Subscription Confirmed: ${payload.subscription?.productName || payload.subscription?.product_name || 'Fresh Milk'} - Milvanta Farm Fresh`);
        html = buildCustomerSubscriptionEmail(payload);
        text = `Your Milvanta Milk Subscription is Confirmed!\nProduct: ${payload.subscription?.productName || payload.subscription?.product_name}\nTeam Milvanta`;
      } else if (item.email_type === 'subscription_notification') {
        const isRefundable = payload.subscription?.notes?.authType === 'refundable_authorization';
        subject = isRefundable
          ? `🚨 ACTION REQUIRED: New Morning Milk Mandate Registered`
          : (payload.isRenewal
              ? `🚨 NOTICE: Morning Milk Subscription Renewed`
              : `🚨 ACTION REQUIRED: New Morning Milk Subscription`);
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
  const name = escapeHtml(customerName || 'Valued Customer');
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Welcome to Milvanta</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(15,23,42,0.06);">
          <tr style="background: linear-gradient(135deg, #0a3d66 0%, #065f46 100%); color: #ffffff; text-align: center;">
            <td style="padding: 28px 24px;">
              <h1 style="margin: 0 0 6px; font-size: 24px; font-weight: 800;">🥛 Welcome to Milvanta</h1>
              <p style="margin: 0; font-size: 14px; color: #d1fae5;">Pure Fresh Farm Milk & Artisanal Goodness</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 24px; color: #0f172a;">
              <h2 style="margin: 0 0 12px; font-size: 18px;">Hello ${name},</h2>
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #475569;">
                Thank you for joining Milvanta! Your account has been created successfully.
              </p>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #475569;">
                You can now log in anytime to order fresh morning milk, homemade pickles, and artisanal dairy delivered directly to your doorstep across Hyderabad between <strong>6:00 AM – 7:00 AM</strong>.
              </p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="https://milvanta.in" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block;">Start Exploring</a>
              </div>
              <p style="margin: 0; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 16px;">
                Connecting Farms to Families<br>
                <strong>Team Milvanta · Hafeezpet Hub, Hyderabad</strong>
              </p>
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
 * Send welcome email to new customer via Resend / SMTP
 */
export async function sendWelcomeEmail({ to, customerName }) {
  const subject = 'Welcome to Milvanta — Pure Fresh Milk & Dairy';
  const html = buildWelcomeEmail({ customerName });
  const text = `Hi ${customerName || 'Valued Customer'},\n\nWelcome to Milvanta! Your account has been created successfully.\n\nYou can now log in and order fresh morning milk, homemade pickles, and artisanal dairy delivered between 6:00 AM – 7:00 AM across Hyderabad.\n\nConnecting Farms to Families\nTeam Milvanta`;
  const sender = (process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || 'Milvanta <orders@milvanta.in>').trim().replace(/^["']|["']$/g, '');
  return sendEmail({
    to,
    subject,
    html,
    text,
    from: sender
  });
}

