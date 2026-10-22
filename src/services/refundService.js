/**
 * Milvanta Refund Management & Audit Service
 * Server-authoritative refund lifecycle for customer orders and subscriptions
 */

import crypto from 'node:crypto';
import { acquireClient } from './subscriptionService.js';

export const VALID_REFUND_REASONS = [
  'cancellation',
  'damaged_item',
  'wrong_item',
  'missing_item',
  'non_delivery',
  'quality_issue',
  'other'
];

/**
 * Generate unique human-readable refund request reference
 */
export function generateRefundRequestNumber(type = 'ord') {
  const prefix = type === 'sub' ? 'REF-SUB' : 'REF-ORD';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Calculate refund eligibility for a customer order
 */
export async function calculateOrderRefundEligibility(poolOrClient, { orderNumber, customerId }) {
  const { client, release } = await acquireClient(poolOrClient);
  try {
    const { rows: orderRows } = await client.query(
      `SELECT co.*, po.razorpay_payment_id
       FROM customer_orders co
       LEFT JOIN payment_orders po ON (po.razorpay_order_id = co.razorpay_order_id OR po.customer_order_id = co.id)
       WHERE co.order_number = $1 AND co.customer_id = $2
       ORDER BY po.created_at DESC LIMIT 1`,
      [orderNumber, customerId]
    );

    if (orderRows.length === 0) {
      return { eligible: false, error: 'order_not_found', statusCode: 404 };
    }

    const order = orderRows[0];
    const totalPaise = Number(order.total_paise) || 0;

    // Check payment status
    if (order.payment_status !== 'paid' && (!order.razorpay_payment_id || order.razorpay_payment_id.trim() === '')) {
      return {
        eligible: false,
        orderNumber: order.order_number,
        error: 'order_not_paid',
        message: 'Only successfully paid orders are eligible for refunds.',
        statusCode: 400
      };
    }

    // Previous refunds on this order
    const { rows: refundStats } = await client.query(
      `SELECT 
         COALESCE(SUM(approved_amount_paise) FILTER (WHERE status IN ('approved', 'processed')), 0)::int as refunded_amount_paise,
         COALESCE(SUM(requested_amount_paise) FILTER (WHERE status = 'pending'), 0)::int as pending_refund_paise
       FROM refund_requests
       WHERE order_id = $1`,
      [order.id]
    );

    const refundedPaise = refundStats[0]?.refunded_amount_paise || 0;
    const pendingPaise = refundStats[0]?.pending_refund_paise || 0;
    const maxRefundablePaise = Math.max(0, totalPaise - refundedPaise - pendingPaise);

    // Normalize order items
    let rawItems = [];
    if (Array.isArray(order.items)) {
      rawItems = order.items;
    } else if (typeof order.items === 'string') {
      try { rawItems = JSON.parse(order.items); } catch {}
    }

    const items = rawItems.map((item, idx) => ({
      index: idx,
      productId: item.productId || item.product_id || item.id,
      name: item.name || item.product_name || 'Item',
      quantity: Number(item.quantity) || 1,
      packSize: item.packSize || item.pack_size || item.size || null,
      pricePaise: Number(item.pricePaise) || (Number(item.price) ? Math.round(Number(item.price) * 100) : 0),
      totalPaise: (Number(item.pricePaise) || (Number(item.price) ? Math.round(Number(item.price) * 100) : 0)) * (Number(item.quantity) || 1)
    }));

    return {
      eligible: maxRefundablePaise > 0,
      orderId: order.id,
      orderNumber: order.order_number,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status,
      paymentId: order.razorpay_payment_id || null,
      totalPaise,
      totalAmount: totalPaise / 100,
      refundedPaise,
      refundedAmount: refundedPaise / 100,
      pendingPaise,
      pendingAmount: pendingPaise / 100,
      maxRefundablePaise,
      maxRefundableAmount: maxRefundablePaise / 100,
      items,
      createdAt: order.created_at
    };
  } finally {
    release();
  }
}

/**
 * Submit an order refund request with optional line-item selection
 */
export async function createOrderRefundRequest(poolOrClient, {
  orderNumber,
  customerId,
  reasonCategory,
  reasonDetail = null,
  customerNotes = null,
  selectedItems = null
}) {
  if (!VALID_REFUND_REASONS.includes(reasonCategory)) {
    return {
      success: false,
      error: 'invalid_reason_category',
      message: `Valid reasons: ${VALID_REFUND_REASONS.join(', ')}`,
      statusCode: 400
    };
  }

  const { client, release } = await acquireClient(poolOrClient);
  try {
    await client.query('BEGIN');

    const eligibility = await calculateOrderRefundEligibility(client, { orderNumber, customerId });
    if (!eligibility.eligible) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: eligibility.error || 'not_eligible_for_refund',
        message: eligibility.message || 'This order has no refundable balance.',
        statusCode: eligibility.statusCode || 400
      };
    }

    // Determine requested amount
    let requestedAmountPaise = eligibility.maxRefundablePaise;
    let itemsPayload = eligibility.items;

    if (Array.isArray(selectedItems) && selectedItems.length > 0) {
      // Sum selected item values
      let selectedSum = 0;
      for (const sel of selectedItems) {
        const itemQty = Number(sel.quantity) || 1;
        const itemPrice = Number(sel.pricePaise) || 0;
        selectedSum += itemQty * itemPrice;
      }
      if (selectedSum > 0) {
        requestedAmountPaise = Math.min(selectedSum, eligibility.maxRefundablePaise);
        itemsPayload = selectedItems;
      }
    }

    if (requestedAmountPaise <= 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'invalid_refund_amount', message: 'Refund amount must be greater than zero.', statusCode: 400 };
    }

    const requestNumber = generateRefundRequestNumber('ord');
    const idempotencyKey = `ord_ref_${eligibility.orderId}_${Date.now()}`;

    const { rows: refundRows } = await client.query(
      `INSERT INTO refund_requests (
        request_number, request_type, customer_id, order_id, order_number,
        payment_id, requested_amount_paise, calculated_eligible_amount_paise,
        currency, reason_category, reason_detail, customer_notes,
        items_payload, status, idempotency_key
      ) VALUES ($1, 'order', $2, $3, $4, $5, $6, $7, 'INR', $8, $9, $10, $11::jsonb, 'pending', $12)
      RETURNING *`,
      [
        requestNumber, customerId, eligibility.orderId, eligibility.orderNumber,
        eligibility.paymentId || 'manual_review', requestedAmountPaise, eligibility.maxRefundablePaise,
        reasonCategory, reasonDetail, customerNotes, JSON.stringify(itemsPayload), idempotencyKey
      ]
    );

    const refund = refundRows[0];

    // Record audit trail
    await client.query(
      `INSERT INTO refund_request_history (refund_request_id, previous_status, new_status, actor_type, actor_id, note)
       VALUES ($1, NULL, 'pending', 'customer', $2, 'Order refund request submitted by customer')`,
      [refund.id, customerId]
    );

    await client.query('COMMIT');

    return {
      success: true,
      refundRequest: {
        id: refund.id,
        requestNumber: refund.request_number,
        orderNumber: eligibility.orderNumber,
        requestedAmount: refund.requested_amount_paise / 100,
        requestedAmountPaise: refund.requested_amount_paise,
        status: refund.status,
        reasonCategory: refund.reason_category,
        createdAt: refund.created_at
      },
      message: `Refund request #${refund.request_number} for ₹${refund.requested_amount_paise / 100} has been submitted for admin approval.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * List refund requests for admin dashboard
 */
export async function listAdminRefundRequests(poolOrClient, { status = null, requestType = null, limit = 50, offset = 0 } = {}) {
  const { client, release } = await acquireClient(poolOrClient);
  try {
    const params = [];
    const conditions = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`rr.status = $${params.length}`);
    }

    if (requestType && requestType !== 'all') {
      params.push(requestType);
      conditions.push(`rr.request_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(Number(limit) || 50);
    const limitParam = `$${params.length}`;
    params.push(Number(offset) || 0);
    const offsetParam = `$${params.length}`;

    const { rows } = await client.query(
      `SELECT 
         rr.*,
         c.full_name as customer_name,
         c.phone as customer_phone,
         c.email as customer_email,
         reviewer.full_name as reviewer_name
       FROM refund_requests rr
       JOIN customers c ON c.id = rr.customer_id
       LEFT JOIN customers reviewer ON reviewer.id = rr.reviewed_by
       ${whereClause}
       ORDER BY rr.created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    const { rows: countRows } = await client.query(
      `SELECT 
         COUNT(*)::int as total_count,
         COUNT(*) FILTER (WHERE status = 'pending')::int as pending_count,
         COUNT(*) FILTER (WHERE status IN ('approved', 'processed'))::int as processed_count,
         COUNT(*) FILTER (WHERE status = 'rejected')::int as rejected_count,
         COALESCE(SUM(approved_amount_paise) FILTER (WHERE status IN ('approved', 'processed')), 0)::bigint as total_refunded_paise
       FROM refund_requests`
    );

    return {
      requests: rows.map(r => ({
        id: r.id,
        requestNumber: r.request_number,
        requestType: r.request_type,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email,
        subscriptionId: r.subscription_id,
        orderId: r.order_id,
        orderNumber: r.order_number,
        paymentId: r.payment_id,
        gatewaySubscriptionId: r.gateway_subscription_id,
        requestedAmountPaise: r.requested_amount_paise,
        requestedAmount: r.requested_amount_paise / 100,
        approvedAmountPaise: r.approved_amount_paise,
        approvedAmount: r.approved_amount_paise ? r.approved_amount_paise / 100 : null,
        calculatedEligiblePaise: r.calculated_eligible_amount_paise,
        currency: r.currency,
        reasonCategory: r.reason_category,
        reasonDetail: r.reason_detail,
        customerNotes: r.customer_notes,
        itemsPayload: r.items_payload,
        status: r.status,
        adminNotes: r.admin_notes,
        reviewedBy: r.reviewed_by,
        reviewerName: r.reviewer_name,
        reviewedAt: r.reviewed_at,
        gatewayRefundId: r.gateway_refund_id,
        failureReason: r.failure_reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })),
      stats: countRows[0] || {}
    };
  } finally {
    release();
  }
}

/**
 * Admin approves a refund request and initiates gateway refund
 */
export async function approveRefundRequest(poolOrClient, {
  refundRequestId,
  adminId,
  approvedAmountPaise = null,
  adminNotes = null,
  razorpayClient = null
}) {
  const { client, release } = await acquireClient(poolOrClient);
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE`,
      [refundRequestId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'refund_request_not_found', statusCode: 404 };
    }

    const req = rows[0];

    if (req.status !== 'pending') {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'already_reviewed',
        message: `Refund request is already in '${req.status}' state.`,
        statusCode: 400
      };
    }

    const effectiveApprovedPaise = approvedAmountPaise && Number(approvedAmountPaise) > 0
      ? Math.min(Number(approvedAmountPaise), req.requested_amount_paise)
      : req.requested_amount_paise;

    let gatewayRefundId = null;
    let gatewayResponse = null;

    // Execute Razorpay refund if live payment id exists and client supplied
    if (razorpayClient && req.payment_id && typeof req.payment_id === 'string' && req.payment_id.startsWith('pay_')) {
      try {
        const refundRes = await razorpayClient.payments.refund(req.payment_id, {
          amount: effectiveApprovedPaise,
          notes: {
            requestNumber: req.request_number,
            adminId: String(adminId),
            reason: req.reason_category
          },
          receipt: req.request_number
        });
        gatewayRefundId = refundRes.id;
        gatewayResponse = refundRes;
      } catch (gwErr) {
        // Record failure in history and update request failure status
        const errorMsg = gwErr.error?.description || gwErr.message || 'Razorpay refund execution failed';
        await client.query(
          `UPDATE refund_requests
           SET status = 'failed', failure_reason = $2, admin_notes = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [refundRequestId, errorMsg, adminNotes, adminId]
        );

        await client.query(
          `INSERT INTO refund_request_history (refund_request_id, previous_status, new_status, actor_type, actor_id, note, payload)
           VALUES ($1, 'pending', 'failed', 'admin', $2, $3, $4::jsonb)`,
          [refundRequestId, adminId, `Gateway execution failed: ${errorMsg}`, JSON.stringify({ error: errorMsg })]
        );

        await client.query('COMMIT');

        return {
          success: false,
          error: 'gateway_refund_failed',
          message: `Razorpay refund failed: ${errorMsg}`,
          statusCode: 502
        };
      }
    }

    // Update refund status to processed (or approved if manual)
    const newStatus = gatewayRefundId ? 'processed' : 'approved';
    await client.query(
      `UPDATE refund_requests
       SET status = $2,
           approved_amount_paise = $3,
           admin_notes = $4,
           reviewed_by = $5,
           reviewed_at = NOW(),
           gateway_refund_id = $6,
           gateway_response = $7::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [refundRequestId, newStatus, effectiveApprovedPaise, adminNotes, adminId, gatewayRefundId, JSON.stringify(gatewayResponse || {})]
    );

    // Record audit history
    await client.query(
      `INSERT INTO refund_request_history (refund_request_id, previous_status, new_status, actor_type, actor_id, note, payload)
       VALUES ($1, 'pending', $2, 'admin', $3, $4, $5::jsonb)`,
      [refundRequestId, newStatus, adminId, adminNotes || 'Refund approved by administrator', JSON.stringify({ gatewayRefundId, approvedAmountPaise: effectiveApprovedPaise })]
    );

    // If subscription refund, record in entitlement ledger
    if (req.subscription_id) {
      await client.query(
        `INSERT INTO subscription_entitlement_ledger (
          subscription_id, customer_id, entry_type, days_delta, amount_paise, payment_id, refund_request_id, notes
        ) VALUES ($1, $2, 'refund_approved', 0, $3, $4, $5, $6)`,
        [req.subscription_id, req.customer_id, effectiveApprovedPaise, req.payment_id, req.id, `Refund approved by admin (Ref: ${req.request_number})`]
      );
    }

    // If order refund, check if order is fully refunded
    if (req.order_id) {
      const { rows: orderSum } = await client.query(
        `SELECT co.total_paise,
                COALESCE(SUM(rr.approved_amount_paise) FILTER (WHERE rr.status IN ('approved', 'processed')), 0)::int as total_refunded
         FROM customer_orders co
         LEFT JOIN refund_requests rr ON rr.order_id = co.id
         WHERE co.id = $1
         GROUP BY co.id`,
        [req.order_id]
      );
      if (orderSum.length > 0 && orderSum[0].total_refunded >= orderSum[0].total_paise) {
        await client.query(
          `UPDATE customer_orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
          [req.order_id]
        );
      }
    }

    await client.query('COMMIT');

    return {
      success: true,
      refundRequestId,
      requestNumber: req.request_number,
      approvedAmount: effectiveApprovedPaise / 100,
      approvedAmountPaise: effectiveApprovedPaise,
      status: newStatus,
      gatewayRefundId,
      message: `Refund of ₹${effectiveApprovedPaise / 100} approved successfully.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/**
 * Admin rejects a refund request
 */
export async function rejectRefundRequest(poolOrClient, {
  refundRequestId,
  adminId,
  adminNotes
}) {
  if (!adminNotes || String(adminNotes).trim() === '') {
    return {
      success: false,
      error: 'admin_notes_required',
      message: 'A rejection reason / admin note is required.',
      statusCode: 400
    };
  }

  const { client, release } = await acquireClient(poolOrClient);
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE`,
      [refundRequestId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'refund_request_not_found', statusCode: 404 };
    }

    const req = rows[0];

    if (req.status !== 'pending') {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'already_reviewed',
        message: `Refund request is already in '${req.status}' state.`,
        statusCode: 400
      };
    }

    await client.query(
      `UPDATE refund_requests
       SET status = 'rejected',
           admin_notes = $2,
           reviewed_by = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [refundRequestId, adminNotes.trim(), adminId]
    );

    await client.query(
      `INSERT INTO refund_request_history (refund_request_id, previous_status, new_status, actor_type, actor_id, note)
       VALUES ($1, 'pending', 'rejected', 'admin', $2, $3)`,
      [refundRequestId, adminId, adminNotes.trim()]
    );

    await client.query('COMMIT');

    return {
      success: true,
      refundRequestId,
      requestNumber: req.request_number,
      status: 'rejected',
      message: `Refund request #${req.request_number} has been rejected.`
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    release();
  }
}
