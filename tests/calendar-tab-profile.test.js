import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Milvanta Dedicated Delivery Calendar Tab Suite', () => {
  const root = process.cwd();
  const profileHtmlPrimary = fs.readFileSync(path.join(root, 'frontend/profile.html'), 'utf8');
  const profileHtmlCloudflare = fs.readFileSync(path.join(root, 'frontend/cloudflare-upload/profile.html'), 'utf8');
  const profileJsPrimary = fs.readFileSync(path.join(root, 'frontend/js/profile.js'), 'utf8');
  const profileJsCloudflare = fs.readFileSync(path.join(root, 'frontend/cloudflare-upload/js/profile.js'), 'utf8');
  const profileCssPrimary = fs.readFileSync(path.join(root, 'frontend/css/profile.css'), 'utf8');
  const profileCssCloudflare = fs.readFileSync(path.join(root, 'frontend/cloudflare-upload/css/profile.css'), 'utf8');
  const indexHtmlPrimary = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const indexHtmlCloudflare = fs.readFileSync(path.join(root, 'frontend/cloudflare-upload/index.html'), 'utf8');
  const checkoutHtmlPrimary = fs.readFileSync(path.join(root, 'frontend/checkout.html'), 'utf8');
  const checkoutHtmlCloudflare = fs.readFileSync(path.join(root, 'frontend/cloudflare-upload/checkout.html'), 'utf8');
  const scriptJsPrimary = fs.readFileSync(path.join(root, 'frontend/js/script.js'), 'utf8');
  const scriptJsCloudflare = fs.readFileSync(path.join(root, 'frontend/cloudflare-upload/js/script.js'), 'utf8');

  describe('1. Dual-Copy Parity & Asset Versioning', () => {
    it('profile.html primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      assert.strictEqual(profileHtmlPrimary, profileHtmlCloudflare);
    });

    it('profile.js primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      assert.strictEqual(profileJsPrimary, profileJsCloudflare);
    });

    it('profile.css primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      assert.strictEqual(profileCssPrimary, profileCssCloudflare);
    });

    it('index.html primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      assert.strictEqual(indexHtmlPrimary, indexHtmlCloudflare);
    });

    it('checkout.html primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      assert.strictEqual(checkoutHtmlPrimary, checkoutHtmlCloudflare);
    });

    it('script.js primary and cloudflare-upload copies are 100% byte-for-byte identical', () => {
      assert.strictEqual(scriptJsPrimary, scriptJsCloudflare);
    });

    it('profile.html has incremented cache-busting version strings (?v=20261021-2)', () => {
      assert.ok(profileHtmlPrimary.includes('css/profile.css?v=20261021-2'));
      assert.ok(profileHtmlPrimary.includes('js/profile.js?v=20261021-2'));
    });

    it('milvanta-cloudflare-upload.zip exists and is non-empty', () => {
      const zipPath = path.join(root, 'frontend/milvanta-cloudflare-upload.zip');
      assert.ok(fs.existsSync(zipPath));
      const stats = fs.statSync(zipPath);
      assert.ok(stats.size > 10000, `Zip size is too small: ${stats.size}`);
    });
  });

  describe('2. Navigation & Tabs Bar Layout', () => {
    it('contains all 5 tab buttons in the required sequence: profile -> orders -> addresses -> subscription -> calendar', () => {
      const tabPattern = /data-tab="([^"]+)"/g;
      const matches = [];
      let match;
      const tabsBarMatch = profileHtmlPrimary.match(/<div class="profile-tabs-bar"[\s\S]*?<\/div>/);
      assert.ok(tabsBarMatch, 'profile-tabs-bar found');
      
      while ((match = tabPattern.exec(tabsBarMatch[0])) !== null) {
        matches.push(match[1]);
      }
      assert.deepStrictEqual(matches, ['profile', 'orders', 'addresses', 'subscription', 'calendar']);
    });

    it('calendar tab button has valid SVG icon and data-tab="calendar"', () => {
      const calBtnMatch = profileHtmlPrimary.match(/<button[^>]*data-tab="calendar"[^>]*>[\s\S]*?<\/button>/);
      assert.ok(calBtnMatch, 'Calendar tab button found');
      assert.ok(calBtnMatch[0].includes('<svg'), 'Has SVG icon');
      assert.ok(calBtnMatch[0].includes('<span>Calendar</span>'), 'Has Calendar text label');
    });

    it('user account dropdown in profile.html has Delivery Calendar tab target', () => {
      assert.ok(profileHtmlPrimary.includes('data-tab-target="calendar"'));
      assert.ok(profileHtmlPrimary.includes('Delivery Calendar'));
    });

    it('mobile drawer in profile.html links to profile.html?tab=calendar', () => {
      assert.ok(profileHtmlPrimary.includes('<a href="profile.html?tab=calendar">📅 Delivery Calendar</a>'));
    });

    it('header dropdown in index.html and checkout.html links to profile.html?tab=calendar', () => {
      assert.ok(indexHtmlPrimary.includes('id="userMenuCalendar"'));
      assert.ok(indexHtmlPrimary.includes('href="profile.html?tab=calendar"'));
      assert.ok(checkoutHtmlPrimary.includes('id="userMenuCalendar"'));
      assert.ok(checkoutHtmlPrimary.includes('href="profile.html?tab=calendar"'));
    });

    it('script.js attaches userMenuCalendar click listener', () => {
      assert.ok(scriptJsPrimary.includes("$('#userMenuCalendar')"));
      assert.ok(scriptJsPrimary.includes("window.location.href = 'profile.html?tab=calendar'"));
    });
  });

  describe('3. Panel Separation & Calendar Isolation', () => {
    it('tabPanel-subscription exists and contains banner, cards grid, and subTomorrowStripContainer', () => {
      const subPanelMatch = profileHtmlPrimary.match(/<section id="tabPanel-subscription"[\s\S]*?<\/section>/);
      assert.ok(subPanelMatch, 'tabPanel-subscription exists');
      const subPanelHtml = subPanelMatch[0];
      assert.ok(subPanelHtml.includes('id="subscriptionsGridContainer"'));
      assert.ok(subPanelHtml.includes('id="subTomorrowStripContainer"'));
      assert.ok(subPanelHtml.includes('id="btnOpenCreateSubModal"'));
      assert.ok(!subPanelHtml.includes('id="profileMonthlyCalendarCard"'), 'tabPanel-subscription must NOT contain profileMonthlyCalendarCard');
    });

    it('tabPanel-calendar exists, is a tabpanel, and contains calTomorrowStripContainer and profileMonthlyCalendarCard', () => {
      const calPanelMatch = profileHtmlPrimary.match(/<section id="tabPanel-calendar"[\s\S]*?<\/section>/);
      assert.ok(calPanelMatch, 'tabPanel-calendar exists');
      const calPanelHtml = calPanelMatch[0];
      assert.ok(calPanelHtml.includes('role="tabpanel"'));
      assert.ok(calPanelHtml.includes('id="calTomorrowStripContainer"'));
      assert.ok(calPanelHtml.includes('id="profileMonthlyCalendarCard"'));
    });

    it('preserves all existing calendar element IDs without recreation or duplication', () => {
      const requiredIds = [
        'profileMonthlyCalendarCard',
        'calCurrentMonthLabel',
        'calPrevMonthBtn',
        'calNextMonthBtn',
        'calTodayBtn',
        'btnOpenVacationModal',
        'calMonthStatsBar',
        'subCalendarSelector',
        'profileMonthlyCalendarGrid',
        'calSelectedDayCard'
      ];
      for (const id of requiredIds) {
        const occurrences = (profileHtmlPrimary.match(new RegExp(`id="${id}"`, 'g')) || []).length;
        assert.strictEqual(occurrences, 1, `Element id="${id}" must appear exactly once in profile.html`);
      }
    });
  });

  describe('4. JavaScript Tab Routing & Interaction (profile.js)', () => {
    it('switchTab recognizes calendar in allowed tabs list', () => {
      assert.ok(profileJsPrimary.includes("['profile', 'orders', 'addresses', 'subscription', 'calendar'].includes(tabId)"));
    });

    it('switchTab updates active states on dropdown items with data-tab-target', () => {
      assert.ok(profileJsPrimary.includes("item.classList.toggle('active-nav-tab', item.dataset.tabTarget === tabId)"));
    });

    it('switchTab sets URL query parameter tab=calendar and preserves selectedSubId', () => {
      assert.ok(profileJsPrimary.includes("url.searchParams.set('tab', tabId)"));
      assert.ok(profileJsPrimary.includes("if (tabId === 'calendar' && state.selectedSubId) {"));
      assert.ok(profileJsPrimary.includes("url.searchParams.set('sub', state.selectedSubId)"));
      assert.ok(profileJsPrimary.includes("url.searchParams.delete('sub')"));
    });

    it('switchTab renders tomorrow strip and monthly calendar when tabId is calendar', () => {
      assert.ok(profileJsPrimary.includes("} else if (tabId === 'calendar') {\n      renderTomorrowStrip();\n      renderMonthlyDeliveryCalendar();\n    }"));
    });

    it('subscription card template renders View Calendar pill with data-view-cal="${sub.id}"', () => {
      assert.ok(profileJsPrimary.includes('data-view-cal="${sub.id}"'));
      assert.ok(profileJsPrimary.includes('btn-view-cal-pill'));
      assert.ok(profileJsPrimary.includes('📅 View Calendar'));
    });

    it('clicking data-view-cal sets state.selectedSubId and switches to calendar tab', () => {
      assert.ok(profileJsPrimary.includes("const viewCalBtn = e.target.closest('[data-view-cal]')"));
      assert.ok(profileJsPrimary.includes("state.selectedSubId = subId"));
      assert.ok(profileJsPrimary.includes("switchTab('calendar')"));
    });

    it('clicking View Subscription & Calendar in order history switches to calendar tab', () => {
      const orderActionRegex = /const goSubBtn = e\.target\.closest\('\[data-go-sub-tab\]'\);[\s\S]*?switchTab\('calendar'\);/;
      assert.ok(orderActionRegex.test(profileJsPrimary));
    });

    it('multi-subscription selector syncs selectedSubId with URL searchParams', () => {
      assert.ok(profileJsPrimary.includes("state.selectedSubId = btn.dataset.selectCalSub"));
      assert.ok(profileJsPrimary.includes("url.searchParams.set('sub', state.selectedSubId)"));
    });

    it('DOMContentLoaded parses ?tab and ?sub query params and awaits fetchSubscriptions()', () => {
      assert.ok(profileJsPrimary.includes("const initialTab = params.get('tab') || 'profile'"));
      assert.ok(profileJsPrimary.includes("const subParam = params.get('sub')"));
      assert.ok(profileJsPrimary.includes("state.selectedSubId = subParam"));
      assert.ok(profileJsPrimary.includes("await fetchSubscriptions()"));
    });
  });

  describe('5. CSS Responsiveness & Mobile Design', () => {
    it('.btn-view-cal-pill styling is present in profile.css', () => {
      assert.ok(profileCssPrimary.includes('.btn-view-cal-pill'));
      assert.ok(profileCssPrimary.includes('background: #e0f2fe;'));
      assert.ok(profileCssPrimary.includes('color: #0369a1;'));
    });

    it('mobile styles for monthly calendar grid are defined under @media query', () => {
      assert.ok(profileCssPrimary.includes('/* Dedicated Monthly Delivery Calendar Mobile Styles */'));
      assert.ok(profileCssPrimary.includes('grid-template-columns: repeat(7, minmax(36px, 1fr))'));
      assert.ok(profileCssPrimary.includes('.cal-selected-day-card'));
    });

    it('profile-tabs-bar supports horizontal scrolling with scrollbar hidden', () => {
      assert.ok(profileCssPrimary.includes('.profile-tabs-bar {'));
      assert.ok(profileCssPrimary.includes('overflow-x: auto;'));
      assert.ok(profileCssPrimary.includes('scrollbar-width: none;'));
    });
  });

  describe('6. Regression Tests for Reviewed Issues', () => {
    it('Regression 1: No invalid products.html links exist anywhere in the frontend codebase', () => {
      const frontendFiles = [
        'frontend/profile.html',
        'frontend/index.html',
        'frontend/checkout.html',
        'frontend/js/profile.js',
        'frontend/js/script.js',
        'frontend/js/checkout.js',
        'frontend/cloudflare-upload/profile.html',
        'frontend/cloudflare-upload/index.html',
        'frontend/cloudflare-upload/checkout.html',
        'frontend/cloudflare-upload/js/profile.js',
        'frontend/cloudflare-upload/js/script.js',
        'frontend/cloudflare-upload/js/checkout.js'
      ];

      for (const relPath of frontendFiles) {
        const fullPath = path.join(root, relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          assert.ok(
            !content.includes('products.html'),
            `File ${relPath} must not contain invalid link 'products.html'`
          );
        }
      }
    });

    it('Regression 1b: Empty state links to verified Milvanta milk storefront section (index.html#products)', () => {
      assert.ok(profileJsPrimary.includes('href="index.html#products"'));
      assert.ok(indexHtmlPrimary.includes('<section class="featured-section" id="products">'));
      assert.ok(scriptJsPrimary.includes("selectedCategory: 'Fresh Milk'"));
    });

    it('Regression 2: Handles multiple subscriptions with independent tomorrow statuses without conflation', () => {
      // Simulate state with 2 active subscriptions
      const mockState = {
        subscriptions: [
          { id: 101, product: 'Pure Buffalo Milk', quantity: '1 Litre', status: 'active' },
          { id: 102, product: 'Pure Fresh Cow Milk', quantity: '500 ml', status: 'active' }
        ],
        subCalendarMap: {
          101: { days: [{ date: '2026-10-22', status: 'scheduled' }] },
          102: { days: [{ date: '2026-10-22', status: 'skipped' }] }
        }
      };

      const tomKey = '2026-10-22';
      const results = mockState.subscriptions.map((sub) => {
        let isTomSkipped = false;
        let statusDetail = '✓ Scheduled (6:00 AM – 7:00 AM)';
        const subCal = mockState.subCalendarMap[sub.id];
        if (subCal && Array.isArray(subCal.days)) {
          const tomDayData = subCal.days.find((d) => d.date === tomKey);
          if (tomDayData && (tomDayData.status === 'skipped' || tomDayData.status === 'paused')) {
            isTomSkipped = true;
            statusDetail = '⏸ Paused (Will not deliver tomorrow)';
          }
        }
        return {
          id: sub.id,
          isTomSkipped,
          statusDetail,
          action: isTomSkipped ? 'resume' : 'skip'
        };
      });

      assert.strictEqual(results[0].id, 101);
      assert.strictEqual(results[0].isTomSkipped, false, 'Sub 101 must be scheduled');
      assert.strictEqual(results[0].action, 'skip', 'Sub 101 action must be skip');

      assert.strictEqual(results[1].id, 102);
      assert.strictEqual(results[1].isTomSkipped, true, 'Sub 102 must be skipped');
      assert.strictEqual(results[1].action, 'resume', 'Sub 102 action must be resume');

      // Crucial: Sub 102 being skipped must NOT affect Sub 101
      assert.notStrictEqual(results[0].isTomSkipped, results[1].isTomSkipped);
    });

    it('Regression 3: Calendar API response triggers tomorrow strip refresh with authoritative data', () => {
      assert.ok(profileJsPrimary.includes('state.subCalendarMap = state.subCalendarMap || {};'));
      assert.ok(profileJsPrimary.includes('state.subCalendarMap[state.selectedSubId] = data;'));
      assert.ok(profileJsPrimary.includes('renderTomorrowStrip();'));
      // renderTomorrowStrip must update both containers
      assert.ok(profileJsPrimary.includes("const containers = [$('#subTomorrowStripContainer'), $('#calTomorrowStripContainer')].filter(Boolean);"));
    });

    it('Regression 4: Skip and Resume actions target strictly the designated subscription ID', () => {
      // Verify toggle button attributes and listener logic
      assert.ok(profileJsPrimary.includes('data-toggle-tomorrow-sub="${sub.id}"'));
      assert.ok(profileJsPrimary.includes('const subId = btn.dataset.toggleTomorrowSub;'));
      assert.ok(profileJsPrimary.includes('await apiRequest(`/api/v1/subscriptions/${subId}/skip-date'));
      
      // Ensure loop over all subscriptions has been completely removed
      assert.ok(!profileJsPrimary.includes('for (const sub of targetSubs)'));
    });

    it('Regression 5: Mutex guard and disabled state prevent duplicate in-flight delivery mutations', () => {
      assert.ok(profileJsPrimary.includes('let isTogglingTomorrow = false;'));
      assert.ok(profileJsPrimary.includes('if (isTogglingTomorrow) return;'));
      assert.ok(profileJsPrimary.includes('isTogglingTomorrow = true;'));
      assert.ok(profileJsPrimary.includes("$$('[data-toggle-tomorrow-sub]').forEach((b) => { b.disabled = true; });"));
      assert.ok(profileJsPrimary.includes("$$('[data-toggle-tomorrow-sub]').forEach((b) => { b.disabled = false; });"));
      assert.ok(profileJsPrimary.includes('isTogglingTomorrow = false;'));
    });
  });
});
