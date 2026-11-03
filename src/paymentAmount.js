/**
 * Normalize a Razorpay payment to the merchant's original order amount.
 *
 * A customer-fee-bearer account can charge the payer the order amount PLUS
 * Razorpay's own fee. This is NOT carte blanche to accept mismatched captures:
 * the exact fee must be present in the authenticated Razorpay payment entity.
 * All callers must independently prove order_id, order.amount, INR currency,
 * signature / webhook authenticity and customer ownership.
 */
export function verifyRazorpayOrderAmount(expectedPaise, gatewayPayment) {
  const expected = Number(expectedPaise);
  const charged = Number(gatewayPayment?.amount);
  const currency = gatewayPayment?.currency;
  const fee = Number(gatewayPayment?.fee);
  const tax = gatewayPayment?.tax == null ? null : Number(gatewayPayment.tax);
  const validMoney = Number.isSafeInteger(expected) && expected > 0 &&
    Number.isSafeInteger(charged) && charged > 0;

  const mismatch = { matched: false, orderAmountPaise: expected, customerFeePaise: null };
  if (!validMoney || currency !== 'INR' || gatewayPayment?.refund_status === 'full') return mismatch;
  if (Number.isSafeInteger(Number(gatewayPayment?.amount_refunded)) &&
      Number(gatewayPayment.amount_refunded) >= charged) return mismatch;
  if (charged === expected) return { matched: true, orderAmountPaise: expected, customerFeePaise: 0 };

  // Never silently accept less money, or an unproven fee.
  if (gatewayPayment?.status !== 'captured' ||
      !Number.isSafeInteger(fee) || fee <= 0 || charged !== expected + fee ||
      fee > Math.ceil(expected * 0.075) ||
      (tax !== null && (!Number.isSafeInteger(tax) || tax < 0 || tax > fee))) {
    return mismatch;
  }

  return { matched: true, orderAmountPaise: expected, customerFeePaise: fee };
}
