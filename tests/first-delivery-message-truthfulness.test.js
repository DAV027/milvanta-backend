import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const server = source('../src/server.js');
const email = source('../src/email.js');

test('backend never promises tomorrow without verified delivery scheduling', () => {
  assert.doesNotMatch(server, /Tomorrow, 6:00 AM/);
  assert.match(server, /Pending delivery scheduling/);
  assert.match(server, /gatewayStartAtYMD/);
});

test('subscription emails do not invent a first delivery date', () => {
  assert.doesNotMatch(email, /Tomorrow, 6:00 AM|Tomorrow Morning · 6:00 AM/);
  assert.match(email, /First Delivery Status/);
  assert.match(email, /Pending delivery scheduling/);
});

test('delivery generation remains authenticated and Test Mode excluded', () => {
  assert.match(server, /DELIVERY_CRON_SECRET/);
  assert.match(server, /liveGatewayOnly: true/);
});
