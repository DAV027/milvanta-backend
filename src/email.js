import 'dotenv/config';

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

  const sender = from || process.env.RESEND_FROM_EMAIL || 'Milvanta <onboarding@resend.dev>';
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
                        <td style="font-size: 13px; color: #059669;">Taxes &amp; Packaging</td>
                        <td style="font-size: 13px; font-weight: 600; color: #059669; text-align: right;">Included</td>
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
    const res = await client.query(
      `SELECT co.*, c.email AS customer_email, c.full_name AS customer_name, c.phone AS customer_phone
       FROM customer_orders co
       LEFT JOIN customers c ON c.id = co.customer_id
       WHERE co.id = $1 OR co.order_number = $1::text`,
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
    const sender = process.env.RESEND_FROM_EMAIL || 'Milvanta <onboarding@resend.dev>';

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

      results.customerEmail = await sendEmailViaResend({
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

      results.adminEmail = await sendEmailViaResend({
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
