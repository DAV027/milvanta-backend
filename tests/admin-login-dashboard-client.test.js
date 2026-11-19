import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const page = fs.readFileSync(new URL('../frontend/admin.html', import.meta.url),'utf8');
const mirror = fs.readFileSync(new URL('../frontend/cloudflare-upload/admin.html',import.meta.url),'utf8');

function extract(start, end) {
  const a = page.indexOf(start), b = page.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Expected admin function boundary missing');
  return page.slice(a, b);
}

test('admin dashboard mirrors its Cloudflare copy and inline scripts compile', () => {
  assert.equal(page, mirror);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1);
  for (const snippet of scripts) assert.doesNotThrow(() => new vm.Script(snippet[1]));
});

test('admin form targets a separate role-gated login endpoint, not customer login', () => {
  assert.match(page,/fetch\(API_BASE \+ '\/api\/v1\/admin\/auth\/login'/);
  assert.doesNotMatch(page,/fetch\(API_BASE \+ '\/api\/v1\/auth\/login'/);
  assert.match(page,/loginEpoch !== adminAuthEpoch/);
  assert.match(page,/revokeAdminSessionBestEffort\(data\.token\)/);
  assert.match(page,/forbidden_admin_required/);
});

function bootContext() {
  const events = [];
  const state = new Map();
  const ui = {
    currentToken: 'admin-token-1',
    adminAuthEpoch: 0,
    events,
    sessionStorage: {
      removeItem: (key) => events.push('remove:' + key)
    },
    showLogin: (message) => events.push('login:' + message),
    showAccessDenied: (email) => events.push('denied:' + email),
    showDashboard: () => events.push('dashboard'),
    switchTab: (name) => events.push('tab:' + name),
    refreshManager: { start: () => events.push('refresh') },
    document: {
      getElementById: (id) => {
        if (!state.has(id)) state.set(id, { textContent:'' });
        return state.get(id);
      }
    }
  };
  vm.createContext(ui);
  const src = extract('      async function checkAuthAndInit() {',
    '      // Page Visibility API handles auto-refresh pause/resume');
  vm.runInContext(src + '\nglobalThis.runBoot = checkAuthAndInit; globalThis.signOut = () => { ++adminAuthEpoch; currentToken = ""; };', ui);
  return ui;
}

test('late /auth/me response after sign-out must never reopen the dashboard', async () => {
  const ui = bootContext();
  let resolveResponse;
  ui.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
  const pending = ui.runBoot();
  ui.signOut();
  resolveResponse({
    status:200, ok:true, json:async () => ({
      user:{is_admin:true,full_name:'Old admin', email:'old@milvanta.test'}
    })
  });
  await pending;
  assert.equal(ui.events.includes('dashboard'),false);
  assert.equal(ui.events.includes('refresh'),false);
});

test('role revoked between visits drops stored admin session', async () => {
  const ui = bootContext();
  ui.fetch = async () => ({
    status:200,ok:true,json:async () => ({
      customer:{is_admin:false,email:'demoted@milvanta.test'}
    })
  });
  await ui.runBoot();
  assert.ok(ui.events.includes('remove:milvanta-admin-token'));
  assert.ok(ui.events.includes('denied:demoted@milvanta.test'));
  assert.equal(ui.events.includes('dashboard'),false);
  assert.equal(ui.currentToken, '', 'Role revocation clears the token');
});

test('expired session redirects to sign-in instead of displaying dashboard', async () => {
  const ui = bootContext();
  ui.fetch = async () => ({status:401,ok:false});
  await ui.runBoot();
  assert.ok(ui.events.some(x=>x.startsWith('login:Your admin session has expired')));
  assert.equal(ui.events.includes('dashboard'),false);
});

test('overview marks metrics stale instead of silently displaying previous figures', async () => {
  const elements = new Map();
  const ui = {
    overviewState:{date:'2026-11-19'},
    document:{ getElementById: id => {
      if (!elements.has(id)) elements.set(id,{textContent:'',appendChild(){}});
      return elements.get(id);
    } },
    apiRequest:async () => {throw new Error('backend unavailable')},
    el:() => ({}),
    empty: () => {},
    events: []
  };
  vm.createContext(ui);
  vm.runInContext(extract('      async function loadOverview(signal) {','      // Deliveries loader') +
    '\nglobalThis.runOverview = loadOverview;', ui);
  const result=await ui.runOverview();
  assert.equal(result,false);
  assert.match(elements.get('overviewDataStatus').textContent, /may be stale/);
  assert.match(page, /Metrics unavailable\. Displayed values may be stale/);
  assert.match(page, /await loadOverview\(signal\) === false/);
});
