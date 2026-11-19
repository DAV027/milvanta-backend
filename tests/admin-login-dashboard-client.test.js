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
    API_BASE: 'https://milvanta.test',
    ADMIN_TOKEN_KEY: 'milvanta-admin-token',
    currentToken: 'admin-token-1',
    adminAuthEpoch: 0,
    events,
    sessionStorage: {
      removeItem: (key) => events.push('remove:' + key)
    },
    showLogin: (message) => events.push('login:' + message),
    showAccessDenied: (email) => events.push('denied:' + email),
    revokeAdminSessionBestEffort: token => events.push('revoke:' + token),
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
  assert.ok(ui.events.includes('revoke:admin-token-1'));
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


test('admin row-action helpers register real click handlers without HTML attributes', () => {
  const calls = [];
  class FakeNode {
    constructor(tag) {
      this.tag = tag;
      this.style = {};
      this.attrs = {};
      this.children = [];
    }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    addEventListener(event, callback) { calls.push({ event, callback }); }
    appendChild(node) { this.children.push(node); }
  }
  const context = {
    Node: FakeNode,
    document: {
      createElement: tag => new FakeNode(tag),
      createTextNode: text => ({ value: text })
    }
  };
  vm.createContext(context);
  vm.runInContext(extract('      function el(tag, attrs = {}, children = []) {',
    '      function empty(node) {') + '\nglobalThis.makeNode = el;', context);
  let clicks = 0;
  const button = context.makeNode('button', {
    className: 'btn-row-action',
    textContent: '<img src=x onerror=alert(1)>',
    addEventListener: ['click', () => { clicks++; }]
  });
  assert.equal(button.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(button.attrs.addEventListener, undefined, 'Must not serialize a callback into markup');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, 'click');
  calls[0].callback();
  assert.equal(clicks, 1, 'The button must actually run its handler');
  assert.throws(() => context.makeNode('a', {addEventListener:['click','evil string']}), /Invalid admin DOM event handler/);
});

test('old admin API response after account switch cannot return data to the new session', async () => {
  const ui = {
    API_BASE: 'https://milvanta.test',
    currentToken: 'old-token',
    adminAuthEpoch: 1,
    FormData: class MockFormData {},
    refreshManager: {state:'idle', updateUI() {}, onAuthExpired() {}}
  };
  vm.createContext(ui);
  vm.runInContext(extract('      async function apiRequest(endpoint, options = {}) {',
    '      // UI View state switches') + '\nglobalThis.runAPI = apiRequest;', ui);
  let resolveFetch;
  ui.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
  const pending = ui.runAPI('/api/v1/admin/stats');
  ui.currentToken = 'new-token';
  ui.adminAuthEpoch = 2;
  resolveFetch({
    ok: true, status:200,
    headers: {get:()=>'application/json'},
    json:async()=>({totalRevenuePaise:500000})
  });
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(ui.refreshManager.state, 'idle');
});

test('overlapping forced dashboard refresh cannot let earlier request clear newer state', async () => {
  const pendingLoads = [];
  const elements = new Map();
  const ui = {
    currentToken: 'admin-token',
    activeTab: 'overview',
    AbortController,
    formatISTTimeOnly: () => '12:00 IST',
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id,{textContent:'',className:''});
      return elements.get(id);
    }},
    loadOverview(signal) {
      return new Promise(resolve => { pendingLoads.push({resolve,signal}); });
    }
  };
  vm.createContext(ui);
  vm.runInContext(extract('      const refreshManager = {',
    '      // API Request helper') + '\nglobalThis.manager = refreshManager;', ui);
  const first = ui.manager.executeSync(true);
  assert.equal(pendingLoads.length, 1);
  const second = ui.manager.executeSync(true);
  assert.equal(pendingLoads.length, 2);
  assert.equal(pendingLoads[0].signal.aborted, true);
  pendingLoads[0].resolve(true);
  await first;
  assert.equal(ui.manager.state,'syncing');
  assert.equal(ui.manager.syncing,true);
  assert.equal(ui.manager.activeController.signal, pendingLoads[1].signal);
  pendingLoads[1].resolve(true);
  await second;
  assert.equal(ui.manager.state,'idle');
  assert.equal(ui.manager.syncing,false);
  assert.equal(ui.manager.lastSuccessTime,'12:00 IST');
});
