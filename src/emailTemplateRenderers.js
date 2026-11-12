/**
 * Presentation-only HTML email renderers for Milvanta.
 * No network access, gateway calls, state mutations or new entitlement rules.
 * All recipient-controlled strings are escaped; prices are never invented.
 */
const BRAND = {
  navy: '#123b56',
  teal: '#16675f',
  ink: '#1f3341',
  muted: '#607583',
  background: '#eef4f2',
  line: '#d9e5df',
  pale: '#f6faf8'
};
const SITE = 'https://milvanta.in';
const PROFILE = SITE + '/profile.html?tab=subscription';

function h(input) {
  return String(input ?? '').replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function words(...values) {
  return values.find(value => value !== undefined && value !== null &&
    String(value).trim() !== '') ?? '';
}
function nonnegativeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function inrPaise(value) {
  const amount = nonnegativeInteger(value);
  return amount === null ? null : '₹' + (amount / 100).toLocaleString('en-IN',
    {minimumFractionDigits: amount % 100 ? 2 : 0, maximumFractionDigits: 2});
}
function inrRupees(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return '₹' + number.toLocaleString('en-IN', {maximumFractionDigits:2});
}
function photoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const url = /^\/?assets\/[A-Za-z0-9_./?=&%-]+$/.test(raw) && !raw.includes('..')
    ? SITE + '/' + raw.replace(/^\//, '') : raw;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.href : '';
  } catch { return ''; }
}
function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('en-IN', {timeZone:'Asia/Kolkata',
    day:'numeric', month:'short', year:'numeric',
    hour:'numeric', minute:'2-digit', hour12:true}) + ' IST';
}
function addressText(addr) {
  const value = addr && typeof addr === 'object' ? addr : {};
  return [value.house, value.building, value.street,
    value.landmark ? 'Landmark: ' + value.landmark : '',
    value.city, value.pincode].filter(Boolean).map(h).join(', ') ||
    'Delivery address not available in this notification';
}
function detail(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return '<tr><td valign="top" style="padding:9px 4px;color:' + BRAND.muted +
    ';font-size:13px;width:42%;">' + h(label) +
    '</td><td valign="top" style="padding:9px 4px;text-align:right;color:' +
    BRAND.ink + ';font-size:13px;font-weight:700;overflow-wrap:anywhere;">' +
    h(value) + '</td></tr>';
}
function detailsTable(rows) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="border-collapse:collapse;">' + rows.join('') + '</table>';
}
function panel(title, body) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="margin:0 0 20px;border:1px solid ' + BRAND.line +
    ';background:' + BRAND.pale + ';border-radius:12px;">' +
    '<tr><td style="padding:19px 20px;">' +
    '<p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:800;' +
    'color:' + BRAND.teal + ';margin:0 0 10px;">' + h(title) + '</p>' +
    body + '</td></tr></table>';
}
function paragraph(body) {
  return '<p style="margin:0 0 20px;color:' + BRAND.muted +
    ';font-size:14px;line-height:1.7;">' + body + '</p>';
}
function action(label, href) {
  return '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 22px;">' +
    '<tr><td bgcolor="' + BRAND.teal + '" style="border-radius:8px;">' +
    '<a href="' + h(href) + '" style="display:inline-block;padding:14px 22px;' +
    'font-size:14px;line-height:18px;font-weight:700;color:#ffffff;' +
    'background:' + BRAND.teal + ';text-decoration:none;border-radius:8px;">' +
    h(label) + '</a></td></tr></table>';
}
function shell({title,eyebrow,preheader,lead,body,admin=false}) {
  const content = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light"><title>', h(title), ' — Milvanta</title>',
    '</head><body style="margin:0;padding:0;background:', BRAND.background,
    ';font-family:Arial,Helvetica,sans-serif;color:', BRAND.ink, ';">',
    '<div style="display:none;font-size:1px;max-height:0;max-width:0;opacity:0;' +
      'overflow:hidden;mso-hide:all;">', h(preheader), '</div>',
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" ' +
      'style="background:', BRAND.background, ';"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ' +
      'style="width:100%;max-width:600px;background:#ffffff;border:1px solid:', BRAND.line, ';' +
      'border-radius:14px;border-collapse:separate;">',
    '<tr><td bgcolor="', BRAND.navy,
    '" style="padding:24px 28px;border-radius:13px 13px 0 0;">',
    '<p style="font-size:12px;font-weight:800;letter-spacing:3px;' +
      'color:#aee4d4;margin:0 0 6px;">MILVANTA</p>',
    '<p style="font-size:12px;color:#d1e9e3;margin:0;">Fresh milk &amp; essentials</p>',
    '</td></tr><tr><td style="padding:30px 28px 22px;">',
    '<p style="margin:0 0 12px;font-size:11px;letter-spacing:1.3px;' +
      'text-transform:uppercase;font-weight:800;color:', BRAND.teal, ';">',
    h(eyebrow), '</p>',
    '<h1 style="margin:0 0 12px;font-size:25px;line-height:1.27;' +
      'letter-spacing:-0.5px;color:', BRAND.navy, ';">', h(title), '</h1>',
    paragraph(h(lead)), body,
    '</td></tr><tr><td style="padding:20px 28px;border-top:1px solid:',
    BRAND.line, ';background:', BRAND.pale, ';border-radius:0 0 13px 13px;">',
    '<p style="margin:0 0 8px;font-size:12px;color:', BRAND.muted,
    ';line-height:1.7;">Milvanta · Hafeezpet Hub, Hyderabad, Telangana</p>',
    '<p style="margin:0;font-size:12px;color:', BRAND.muted, ';line-height:1.7;">',
    '<a href="', SITE, '" style="color:', BRAND.teal, ';">milvanta.in</a>',
    admin ? ' · Internal operations notice' :
      ' · <a href="mailto:orders@milvanta.in" style="color:' + BRAND.teal + ';">Help &amp; support</a>',
    '</p></td></tr></table></td></tr></table></body></html>'
  ];
  return content.join('');
}
function orderRows(items, isAdmin) {
  if (!Array.isArray(items) || !items.length) return paragraph('Item details are available in your account.');
  const lines = items.map(item => {
    const name = h(words(item?.name,item?.product_name,'Item'));
    const size = h(words(item?.unit,item?.size,''));
    const quantity = nonnegativeInteger(item?.quantity);
    const unitPrice = nonnegativeInteger(item?.unitPricePaise);
    const totalExplicit = nonnegativeInteger(item?.lineTotalPaise);
    const computed = quantity !== null && unitPrice !== null &&
      Number.isSafeInteger(quantity * unitPrice) ? quantity * unitPrice : null;
    const linePrice = inrPaise(totalExplicit ?? computed) || 'Not available';
    const image = photoUrl(words(item?.imageUrl,item?.image,''));
    const label = name + (size ? '<div style="font-size:12px;color:' + BRAND.muted + ';">' + size + '</div>' : '');
    return '<tr><td style="padding:13px 4px;border-bottom:1px solid:' + BRAND.line + ';">' +
      (image ? '<img src="' + h(image) + '" alt="" width="46" height="46" ' +
       'style="display:block;border-radius:8px;border:1px solid:' + BRAND.line + ';">' : '') +
      '</td><td style="padding:13px 5px;border-bottom:1px solid:' + BRAND.line + ';' +
      'font-size:13px;color:' + BRAND.ink + ';font-weight:700;">' + label + '</td>' +
      '<td align="right" style="padding:13px 5px;border-bottom:1px solid:' +
      BRAND.line + ';font-size:12px;color:' + BRAND.ink + ';">' +
      (quantity === null ? 'Qty unavailable' : '× ' + quantity) +
      '<div style="font-weight:800;margin-top:5px;">' + h(linePrice) + '</div>' +
      '</td></tr>';
  }).join('');
  return panel(isAdmin ? 'Packing list' : 'Your ordered items',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    lines + '</table>');
}
function financials(order) {
  const subtotal = nonnegativeInteger(order?.subtotal_paise);
  const delivery = nonnegativeInteger(order?.delivery_charge_paise);
  const total = nonnegativeInteger(order?.total_paise);
  if (subtotal === null || subtotal <= 0 || delivery === null || total === null ||
      !Number.isSafeInteger(subtotal + delivery) || subtotal + delivery !== total) {
    return panel('Billing summary', paragraph('Receipt totals are pending verification. Please contact support if you need a copy.'));
  }
  return panel('Payment breakdown', detailsTable([
    detail('Items Subtotal', inrPaise(subtotal)),
    detail('Cold-Chain Delivery Charges', delivery ? inrPaise(delivery) : 'FREE'),
    detail('Milvanta Order Total', inrPaise(total))
  ]));
}
function orderBody({order={},customer={},address={},items=[],paymentId=''},isAdmin) {
  const orderNumber = words(order.order_number,
    order.id ? 'MV-' + String(order.id) : 'Not available');
  const name = words(address.name, customer.full_name, customer.name, 'Customer');
  const verified = order.payment_status === 'paid' && order.order_status === 'confirmed';
  const paymentInfo = paymentId ? detail('Payment reference', paymentId) : '';
  const metadata = panel('Order details', detailsTable([
    detail('Order number', orderNumber),
    detail('Order date', fmtDate(order.created_at)),
    detail('Payment status', verified ? 'Recorded as paid and confirmed' :
      'Check payment verification status'),
    paymentInfo
  ]));
  const contact = isAdmin ? panel('Customer contact', detailsTable([
    detail('Name',name),detail('Phone', words(address.phone,customer.phone,'')),
    detail('Email',words(address.email,customer.email,''))
  ])) : '';
  const destination = panel('Delivery address',
    '<p style="font-size:13px;line-height:1.6;margin:0;color:' +
    BRAND.ink + ';">' + addressText(address) + '</p>');
  return metadata + contact + orderRows(items,isAdmin) + financials(order) +
    destination + (isAdmin ?
      paragraph('Use the operations dashboard to verify payment and delivery eligibility before packing or assigning a route.') :
      paragraph('Any separate Razorpay convenience charges shown at checkout are not included in the Milvanta order total.')) +
    (isAdmin ? '' : action('View your orders',SITE + '/profile.html'));
}
export function renderCustomerOrderEmail(input={}) {
  const name = words(input.address?.name,input.customer?.full_name,input.customer?.name,'there');
  const paid = input.order?.payment_status === 'paid' && input.order?.order_status === 'confirmed';
  return shell({eyebrow:'Your Milvanta order', title:paid ? 'Order confirmed' : 'Your order summary',
    preheader:'Order details, items and verified totals in one place.',
    lead:'Hello ' + name + ', here is your Milvanta order summary. Keep this email for your records.',
    body:orderBody(input,false)});
}
export function renderAdminOrderEmail(input={}) {
  const id = words(input.order?.order_number,input.order?.id,'New order');
  return shell({admin:true,eyebrow:'Operations · Order review',title:'Order received — ' + id,
    preheader:'Customer, items, delivery address and payment references.',
    lead:'This notification is not an instruction to dispatch without payment and schedule checks.',
    body:orderBody(input,true)});
}
function subscriptionDetails({subscription={},customer={},address={},paymentId=''},admin=false) {
  const isMandate = subscription.authType === 'refundable_authorization' ||
    subscription.isRefundableAuth === true ||
    subscription.notes?.authType === 'refundable_authorization';
  const isCustom = words(subscription.planType, subscription.plan_type) === 'custom';
  const name = words(customer.name,customer.full_name,address.name,'Customer');
  const product = words(subscription.productName,subscription.product_name,subscription.product,'Fresh milk');
  const size = words(subscription.quantity,subscription.size,'');
  const frequency = words(subscription.frequency,'Daily');
  const slot = words(subscription.timeSlot, subscription.time_slot,'Slot to be confirmed');
  const duration = words(subscription.durationLabel,subscription.duration_label,
    isCustom ? 'Custom plan' : 'Recurring subscription');
  const dailyRate = inrPaise(subscription.cost_per_day_paise) ||
    inrRupees(words(subscription.costPerDay,subscription.dailyRate,''));
  const referenceTotal = inrPaise(subscription.total_amount_paise) ||
    inrRupees(subscription.totalAmount);
  const authorization = inrPaise(words(subscription.authAmountPaise,
    subscription.notes?.authAmountPaise,''));
  // A guessed "Tomorrow" is never evidence of a persisted delivery order.
  // The first eligible date, if known, is not equivalent to a booked delivery.
  const eligible = words(subscription.firstEligibleDeliveryDate,
    subscription.notes?.firstEligibleDeliveryDate,'');
  const safeEligible = typeof eligible === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(eligible)
    ? eligible : '';
  const status = isMandate ? 'Mandate registration; plan charge not confirmed' :
    'Subscription recorded; check payment and delivery eligibility in your profile';
  const rows = [
    detail('Product', product + (size ? ' · ' + size : '')),
    detail('Frequency', frequency),
    detail('Preferred delivery slot', slot),
    detail('Plan', duration),
    detail('Status', status),
    detail('Reference daily rate', dailyRate),
    detail(isMandate ? 'Recurring plan amount (not a receipt)' : 'Plan amount (reference)', referenceTotal),
    isMandate ? detail('Mandate authorization (not plan payment)',authorization) : '',
    paymentId ? detail('Gateway reference',paymentId) : '',
    safeEligible ? detail('Earliest eligible morning — not yet scheduled',safeEligible) :
      detail('First delivery', 'Pending delivery scheduling')
  ];
  const summary = panel(admin ? 'Subscription review' : 'Your subscription at a glance',
    detailsTable(rows));
  const contact = admin ? panel('Customer contact',detailsTable([
    detail('Name',name),detail('Phone',words(address.phone,customer.phone,'')),
    detail('Email',words(address.email,customer.email,''))
  ])) : '';
  return summary + contact +
    panel('Delivery address','<p style="margin:0;color:' + BRAND.ink +
      ';font-size:13px;line-height:1.6;">' + addressText(address) + '</p>') +
    (admin ? paragraph('Do not add this customer to a physical route solely because the mandate or subscription exists. Confirm a captured live payment, entitlement and an actual scheduled order.') :
      paragraph('Delivery scheduling depends on payment verification, the applicable cutoff and your selected dates. A mandate registration alone does not confirm payment or a physical delivery.')) +
    (admin ? '' : action('Manage subscription',PROFILE));
}
export function renderCustomerSubscriptionEmail(input={}) {
  const sub = input.subscription || {};
  const mandate = sub.authType === 'refundable_authorization' ||
    sub.isRefundableAuth === true || sub.notes?.authType === 'refundable_authorization';
  return shell({eyebrow:'Your milk subscription',
    title:mandate ? 'Autopay mandate registered' : 'Your subscription details',
    preheader:'Your plan, delivery preferences and payment-reference information.',
    lead:mandate ? 'Your autopay mandate has been recorded. It is not proof that the monthly plan charge was captured.' :
      'Your subscription information is ready to review. Delivery and payment status are confirmed separately.',
    body:subscriptionDetails(input,false)});
}
export function renderAdminSubscriptionEmail(input={}) {
  return shell({eyebrow:'Operations · Subscription review',title:'New subscription event',
    preheader:'Review customer, billing reference and scheduling readiness.',
    lead:'Check the payment gateway mode, captured entitlement and delivery calendar before any physical fulfillment.',
    body:subscriptionDetails(input,true),admin:true});
}
export function renderPasswordResetEmail({customerName,otp}={}) {
  // OTP should be generated and validated by the existing auth flow.
  return shell({eyebrow:'Account security',title:'Reset your password',
    preheader:'Your one-time Milvanta password reset code.',
    lead:'Hello ' + words(customerName,'there') + ', use the one-time code below to continue your password reset.',
    body:panel('Your verification code',
      '<p style="font-family:Consolas,monospace;font-size:30px;font-weight:800;letter-spacing:6px;' +
      'color:' + BRAND.navy + ';text-align:center;margin:6px 0;">' + h(words(otp,'')) + '</p>') +
      paragraph('This code expires after 10 minutes. Never share it with anyone, including Milvanta staff. If you did not request a reset, ignore this message.')});
}
export function renderWelcomeEmail({customerName}={}) {
  return shell({eyebrow:'Welcome to Milvanta',title:'Fresh starts here',
    preheader:'Your Milvanta account is ready.',
    lead:'Hello ' + words(customerName,'there') + ', welcome to Milvanta!',
    body:paragraph('Browse fresh milk and pantry essentials, save your delivery address, and manage your orders or subscriptions from your account.') +
      panel('Good to know',paragraph('Delivery availability and the first eligible morning depend on your plan, payment confirmation and local service schedule.')) +
      action('Explore Milvanta',SITE)});
}
