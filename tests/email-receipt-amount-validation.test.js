import test from 'node:test';
import assert from 'node:assert/strict';
import {formatInr, validOrderReceiptFinancials} from '../src/email.js';
import {renderCustomerOrderEmail} from '../src/emailTemplateRenderers.js';

test('plain text currency preserves exact paise just like HTML', () => {
  for (const [paise, expected] of [
    [1, '₹0.01'], [10575, '₹105.75'],
    [10005, '₹100.05'], [159900, '₹1,599'],
    [0, '₹0'], ['21050', '₹210.50']
  ]) {
    assert.equal(formatInr(paise, true), expected);
  }
  const order = {order_number: 'MV-PRECISE', payment_status: 'paid',
    order_status: 'confirmed', subtotal_paise: 10575,
    delivery_charge_paise: 0, total_paise: 10575};
  assert.equal(validOrderReceiptFinancials(order), true);
  const html = renderCustomerOrderEmail({order,
    customer: {name:'Preview Only'}, address: {}, items: []});
  assert.match(html, /₹105\.75/);
  assert.equal(formatInr(order.total_paise, true), '₹105.75');
});

test('receipt financial validation refuses coerced, missing or contradictory values', () => {
  const base = {subtotal_paise: 10575, delivery_charge_paise: 5000,
    total_paise: 15575};
  assert.equal(validOrderReceiptFinancials(base), true);
  assert.equal(validOrderReceiptFinancials({
    subtotal_paise:'10575',delivery_charge_paise:'5000',total_paise:'15575'
  }),true,'PostgreSQL integer strings remain supported');
  for (const bad of [
    {subtotal_paise:true},
    {subtotal_paise:'10.575'},
    {subtotal_paise:'1e4'},
    {subtotal_paise:' 10575'},
    {subtotal_paise:[]},
    {subtotal_paise:{}},
    {subtotal_paise:null},
    {total_paise:15574},
    {delivery_charge_paise:-1},
    {total_paise:Number.MAX_SAFE_INTEGER + 1}
  ]) {
    assert.equal(validOrderReceiptFinancials({...base,...bad}),false,
      'must reject '+JSON.stringify(bad));
  }
});

test('invalid receipt amounts produce pending verification, never made-up zero', () => {
  for (const input of [undefined, null, false, true, '', 'foo', '0.5',
    -1, {}, [], ' 100', 1.5]) {
    assert.equal(formatInr(input,true),'Pending verification');
  }
});
