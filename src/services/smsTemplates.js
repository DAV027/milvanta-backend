/**
 * Milvanta Twilio SMS Template Registry
 * DLT Compliant message formats with parameter interpolation
 * 
 * TRAI (Telecom Regulatory Authority of India) TCCCPR 2018 Compliance:
 * All commercial bulk SMS traffic in India requires registration on a telecom DLT portal
 * (e.g. Vilpower, Airtel, Jio, Smartping) with Principal Entity ID, approved Sender Header (e.g. MLVNTA),
 * and Content Template IDs.
 * 
 * NOTE: The template IDs below represent DLT registration mappings. Prior to live operator registration,
 * they are treated as PENDING_OPERATOR_APPROVAL.
 */

export const DLT_REGULATORY_INFO = {
  status: 'PENDING_OPERATOR_APPROVAL',
  registeredHeader: 'MLVNTA',
  principalEntityId: '1401160000000000000', // Placeholder until final telecom approval
  isApproved: false,
  complianceFramework: 'TRAI TCCCPR 2018'
};

export const SMS_TEMPLATES = {
  SUBSCRIPTION_CANCELLED: { name:'SUBSCRIPTION_CANCELLED', dltStatus:'pending_approval', format: p => `Milvanta: Your ${p.productName} subscription has been cancelled.` },
  ORDER_CONFIRMED: {
    name: 'ORDER_CONFIRMED',
    dltTemplateId: '1407168000000000001',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta: Order #${params.orderNumber} of Rs.${params.amount} confirmed! Your farm-fresh dairy will be delivered to ${params.area || 'your address'} on ${params.deliveryDate || 'tomorrow'}. Thank you!`
  },
  SUBSCRIPTION_ACTIVATED: {
    name: 'SUBSCRIPTION_ACTIVATED',
    dltTemplateId: '1407168000000000002',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta: Your ${params.productName} (${params.quantity}) subscription is now ACTIVE! Morning delivery starts ${params.startDate || 'tomorrow'} (6:00 AM – 7:00 AM). Manage anytime on milvanta.in`
  },
  NEXT_DAY_REMINDER: {
    name: 'NEXT_DAY_REMINDER',
    dltTemplateId: '1407168000000000003',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta Reminder: Your morning milk delivery of ${params.quantity} ${params.productName} is scheduled for tomorrow between 6:00 AM - 7:00 AM.`
  },
  SUBSCRIPTION_PAUSED: {
    name: 'SUBSCRIPTION_PAUSED',
    dltTemplateId: '1407168000000000004',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta: Your ${params.productName} subscription has been paused${params.pauseDate ? ` from ${params.pauseDate}` : ''}. Deliveries are on hold. You can resume anytime on milvanta.in`
  },
  SUBSCRIPTION_RESUMED: {
    name: 'SUBSCRIPTION_RESUMED',
    dltTemplateId: '1407168000000000005',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta: Welcome back! Your ${params.productName} subscription is now RESUMED. Next delivery is scheduled for ${params.nextDate || 'tomorrow'} morning.`
  },
  OUT_FOR_DELIVERY: {
    name: 'OUT_FOR_DELIVERY',
    dltTemplateId: '1407168000000000006',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta: Good morning! Your fresh delivery of ${params.quantity} ${params.productName} is OUT FOR DELIVERY. Estimated doorstep drop: 6:00 AM – 7:00 AM.`
  },
  DELIVERY_COMPLETED: {
    name: 'DELIVERY_COMPLETED',
    dltTemplateId: '1407168000000000007',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta: Your fresh delivery of ${params.quantity} ${params.productName} was safely delivered at ${params.time || 'your doorstep'}. Enjoy pure farm freshness!`
  },
  DELIVERY_FAILED: {
    name: 'DELIVERY_FAILED',
    dltTemplateId: '1407168000000000008',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta Notice: We could not complete your delivery today: ${params.reason || 'Door locked / unreachable'}. Our operations team will follow up shortly.`
  },
  BILLING_ISSUE: {
    name: 'BILLING_ISSUE',
    dltTemplateId: '1407168000000000009',
    dltStatus: 'pending_approval',
    format: (params) =>
      `Milvanta Alert: Payment renewal for your subscription (${params.productName || 'Milk'}) could not be charged. Please update your payment method at milvanta.in to continue uninterrupted deliveries.`
  }
};

export function renderSmsTemplate(templateKey, params = {}) {
  const template = SMS_TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown SMS template key: ${templateKey}`);
  }
  return {
    templateName: template.name,
    dltTemplateId: template.dltTemplateId,
    dltStatus: template.dltStatus || 'pending_approval',
    body: template.format(params)
  };
}

