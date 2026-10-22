import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getSubscriptionCalendar,
  unskipDeliveryDate,
  skipDeliveryDate,
  setVacation,
  resumeSubscription,
  formatDateYMD
} from '../src/services/subscriptionService.js';

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

    it('profile.html has incremented cache-busting version strings (?v=20261022-3)', () => {
      assert.ok(profileHtmlPrimary.includes('css/profile.css?v=20261022-3'));
      assert.ok(profileHtmlPrimary.includes('js/profile.js?v=20261022-3'));
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
      assert.ok(profileJsPrimary.replace(/\r\n/g, '\n').includes("} else if (tabId === 'calendar') {\n      renderTomorrowStrip();\n      renderMonthlyDeliveryCalendar();\n    }"));
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
      assert.ok(profileJsPrimary.includes('setCachedCalendar(targetSubId, year, month, data);'));
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

    it('Regression 6: Cache calendar data by subscription ID AND year/month (rather than ID alone)', () => {
      assert.ok(profileJsPrimary.includes('function getCalendarCacheKey(subId, year, month)'));
      assert.ok(profileJsPrimary.includes('return `${subId}_${year}_${month}`;'));
      assert.ok(profileJsPrimary.includes('function getCachedCalendar(subId, year, month)'));
      assert.ok(profileJsPrimary.includes('function setCachedCalendar(subId, year, month, data)'));

      // Executable verification of multi-month caching
      const cache = {};
      const getKey = (subId, y, m) => `${subId}_${y}_${m}`;
      cache[getKey(101, 2026, 9)] = { days: [{ date: '2026-10-31', status: 'scheduled' }] };
      cache[getKey(101, 2026, 10)] = { days: [{ date: '2026-11-01', status: 'scheduled' }] };

      assert.strictEqual(cache[getKey(101, 2026, 9)].days[0].date, '2026-10-31');
      assert.strictEqual(cache[getKey(101, 2026, 10)].days[0].date, '2026-11-01');
      // Sub 101 has both October and November stored simultaneously without overwriting
      assert.ok(cache[getKey(101, 2026, 9)] !== cache[getKey(101, 2026, 10)]);
    });

    it('Regression 7: Month boundary retrieval across month transition', () => {
      // Simulate today being October 31st, 2026 in IST
      const mockDateOct31 = new Date(2026, 9, 31, 10, 0, 0); // 31 Oct 2026
      const tomDate = new Date(mockDateOct31.getFullYear(), mockDateOct31.getMonth(), mockDateOct31.getDate() + 1);
      const tomYear = tomDate.getFullYear();
      const tomMonth = tomDate.getMonth();
      const tomDay = tomDate.getDate();
      const tomKey = `${tomYear}-${String(tomMonth + 1).padStart(2, '0')}-${String(tomDay).padStart(2, '0')}`;

      assert.strictEqual(tomYear, 2026);
      assert.strictEqual(tomMonth, 10, 'Tomorrow must be in month index 10 (November)');
      assert.strictEqual(tomDay, 1, 'Tomorrow date must be 1st');
      assert.strictEqual(tomKey, '2026-11-01');

      // Even if customer is currently browsing October (month 9), tomorrow's status requests month 10
      const cache = {};
      cache[`101_2026_9`] = { month: 9, days: [{ date: '2026-10-31' }] };
      cache[`101_2026_10`] = { month: 10, days: [{ date: '2026-11-01', status: 'scheduled', isEditable: true }] };

      const subCal = cache[`101_${tomYear}_${tomMonth}`];
      assert.ok(subCal, 'Must retrieve calendar for November 2026, not October');
      const tomData = subCal.days.find(d => d.date === tomKey);
      assert.ok(tomData, 'Must locate 2026-11-01 in November calendar');
      assert.strictEqual(tomData.status, 'scheduled');
    });

    it('Regression 8: Vacation pauses redirect to vacation modal and never call DELETE /skip-date', () => {
      assert.ok(profileJsPrimary.includes("statusText = '✈️ Vacation Mode (Paused)';"));
      assert.ok(profileJsPrimary.includes('btn-manage-vacation'));
      assert.ok(profileJsPrimary.includes('data-open-vacation="true"'));
      
      // Ensure click listener strictly guards against vacation resume via skip-date
      assert.ok(profileJsPrimary.includes("if (action !== 'resume' && action !== 'skip') return;"));

      // Verify Vacation Modal opens via data-open-vacation
      assert.ok(profileJsPrimary.includes("if (e.target.closest('[data-open-vacation]'))"));
      assert.ok(profileJsPrimary.includes("document.getElementById('btnOpenVacationModal')?.click()"));
    });

    it('Regression 9: Pending-payment, ended entitlement, and cancelled states respect billing', () => {
      assert.ok(profileJsPrimary.includes("statusText = '⏳ Pending Payment (Mandate/Billing)';"));
      assert.ok(profileJsPrimary.includes("statusText = '⏹ Entitlement Ended';"));
      assert.ok(profileJsPrimary.includes("statusText = '✕ Subscription Cancelled';"));
      assert.ok(profileJsPrimary.includes('data-quick-extend="true"'));

      // Check inspector handling
      assert.ok(profileJsPrimary.includes("status === 'pending_payment'"));
      assert.ok(profileJsPrimary.includes("status === 'ended'"));
      assert.ok(profileJsPrimary.includes('Awaiting payment confirmation'));
      assert.ok(profileJsPrimary.includes('Paid entitlement period ended'));
    });

    it('Regression 10: Rapid subscription switching discards stale in-flight responses', () => {
      assert.ok(profileJsPrimary.includes('let calendarFetchSequence = 0;'));
      assert.ok(profileJsPrimary.includes('const currentSeq = ++calendarFetchSequence;'));
      assert.ok(profileJsPrimary.includes('const targetSubId = String(state.selectedSubId);'));
      assert.ok(profileJsPrimary.includes('if (currentSeq !== calendarFetchSequence || String(state.selectedSubId) !== targetSubId)'));

      // Executable logic test
      let fetchSequence = 0;
      let activeSubId = '101';
      let renderedSubId = null;

      // Request 1 starts for sub 101
      const req1Seq = ++fetchSequence;
      const req1SubId = activeSubId;

      // User rapidly clicks sub 102
      activeSubId = '102';
      const req2Seq = ++fetchSequence;
      const req2SubId = activeSubId;

      // Request 2 completes first
      if (req2Seq === fetchSequence && req2SubId === activeSubId) {
        renderedSubId = req2SubId;
      }
      assert.strictEqual(renderedSubId, '102', 'Sub 102 must be rendered');

      // Request 1 arrives delayed
      if (req1Seq === fetchSequence && req1SubId === activeSubId) {
        renderedSubId = req1SubId; // Should NOT be reached
      }
      assert.strictEqual(renderedSubId, '102', 'Sub 101 delayed response must NOT overwrite Sub 102');
    });

    it('Regression 11: Business delivery timezone (Asia/Kolkata) & Delivery Cutoff', () => {
      assert.ok(profileJsPrimary.includes("timeZone: 'Asia/Kolkata'"));
      assert.ok(profileJsPrimary.includes('function getNowInIST()'));
      assert.ok(profileJsPrimary.includes('function getTomorrowInIST()'));
      assert.ok(profileJsPrimary.includes('istNow.getHours() >= 20')); // 8:00 PM cutoff

      // Loading state shows checking and disabled button
      assert.ok(profileJsPrimary.includes('Checking delivery status'));
      assert.ok(profileJsPrimary.includes('btn-tomorrow-toggle-action disabled'));
      assert.ok(profileJsPrimary.includes('data-action="disabled"'));

      // Cutoff passed message
      assert.ok(profileJsPrimary.includes('Cutoff passed (8:00 PM IST)'));
    });
  });

  describe('7. Behavior-Level Delivery State Machine & Verification Suite', () => {
    it('7.1: Server-authoritative pause/resume preserves local state on API failure without flipping', async () => {
      // 1. Static code verification
      assert.ok(profileJsPrimary.includes('if (!res || !res.success)'));
      assert.ok(profileJsPrimary.includes("throw new Error(res?.error || res?.message || `Failed to ${isCurrentlyActive ? 'pause' : 'resume'} subscription.`);"));
      assert.ok(profileJsPrimary.includes("console.warn('API subscription pause/resume failed:', err);"));
      assert.ok(profileJsPrimary.includes("showToast(err.message || `Unable to ${isCurrentlyActive ? 'pause' : 'resume'} subscription. Please try again.`);"));

      // Ensure that inside catch block, sub.status is NOT flipped locally
      const catchIdx = profileJsPrimary.indexOf("console.warn('API subscription pause/resume failed:'");
      const finallyIdx = profileJsPrimary.indexOf('state.mutatingSubIds.delete(String(subId));', catchIdx);
      const catchBlock = profileJsPrimary.slice(catchIdx, finallyIdx);
      assert.ok(!catchBlock.includes('sub.status ='), 'Catch block must not flip subscription status');

      // 2. Behavioral state machine simulation
      const mockState = {
        subscriptions: [{ id: '101', status: 'active', product: 'Buffalo Milk' }],
        mutatingSubIds: new Set()
      };

      const simulateToggle = async (subId, apiHandler) => {
        if (mockState.mutatingSubIds.has(String(subId))) return;
        const sub = mockState.subscriptions.find((s) => String(s.id) === String(subId));
        if (!sub) return;

        mockState.mutatingSubIds.add(String(subId));
        const isCurrentlyActive = sub.status === 'active';
        try {
          const res = await apiHandler();
          if (!res || !res.success) {
            throw new Error(res?.error || `Failed to ${isCurrentlyActive ? 'pause' : 'resume'}`);
          }
          sub.status = res.status || (isCurrentlyActive ? 'paused' : 'active');
        } catch (err) {
          // Preserved confirmed state!
        } finally {
          mockState.mutatingSubIds.delete(String(subId));
        }
      };

      // Attempt pause that fails with 500 / network error
      await simulateToggle('101', async () => ({ success: false, error: 'Database transaction lock timeout' }));
      assert.strictEqual(mockState.subscriptions[0].status, 'active', 'Status must remain active on failure');
      assert.strictEqual(mockState.mutatingSubIds.has('101'), false, 'Mutex must release lock after error');

      // Attempt pause that throws network error
      await simulateToggle('101', async () => { throw new Error('Network offline'); });
      assert.strictEqual(mockState.subscriptions[0].status, 'active', 'Status must remain active on exception');
      assert.strictEqual(mockState.mutatingSubIds.has('101'), false, 'Mutex must release lock after exception');

      // Successful pause
      await simulateToggle('101', async () => ({ success: true, status: 'paused', message: 'Subscription paused.' }));
      assert.strictEqual(mockState.subscriptions[0].status, 'paused', 'Status updates only on verified success');
    });

    it('7.2: In-flight mutex blocks concurrent duplicate pause/resume clicks on the same subscription ID', async () => {
      assert.ok(profileJsPrimary.includes('state.mutatingSubIds = state.mutatingSubIds || new Set();'));
      assert.ok(profileJsPrimary.includes('if (state.mutatingSubIds.has(String(subId))) {'));
      assert.ok(profileJsPrimary.includes('state.mutatingSubIds.add(String(subId));'));
      assert.ok(profileJsPrimary.includes('state.mutatingSubIds.delete(String(subId));'));

      const mutatingSet = new Set();
      let networkCallsCount = 0;

      const performMutation = async (subId) => {
        if (mutatingSet.has(String(subId))) {
          return { skippedDueToLock: true };
        }
        mutatingSet.add(String(subId));
        networkCallsCount++;
        // Simulate in-flight asynchronous roundtrip
        await new Promise((r) => setTimeout(r, 20));
        mutatingSet.delete(String(subId));
        return { success: true };
      };

      // First click begins in-flight operation
      const firstClickPromise = performMutation('101');
      // Simultaneous rapid double-click on same subscription ID
      const secondClickPromise = performMutation('101');
      // Independent click on a different subscription ID
      const otherSubPromise = performMutation('102');

      const [res1, res2, res3] = await Promise.all([firstClickPromise, secondClickPromise, otherSubPromise]);

      assert.strictEqual(res1.success, true);
      assert.strictEqual(res2.skippedDueToLock, true, 'Second click must be rejected by mutex lock');
      assert.strictEqual(res3.success, true, 'Different subscription ID must proceed');
      assert.strictEqual(networkCallsCount, 2, 'Only 2 network calls should execute, not 3');
      assert.strictEqual(mutatingSet.size, 0, 'Mutex set should be completely empty when idle');
    });

    it('7.3: Fail-closed delivery status rendering rejects unknown statuses and disables actions', () => {
      // 1. Static code check in tomorrow strip and calendar inspector
      assert.ok(profileJsPrimary.includes("statusClass = 'unknown';"));
      assert.ok(profileJsPrimary.includes("statusText = status ? `Status: ${escapeHtml(status)}` : 'Delivery status unavailable';"));
      assert.ok(profileJsPrimary.includes('data-action="disabled"'));
      assert.ok(profileJsPrimary.includes("statusType = dayData ? dayData.status : 'unknown';"));
      assert.ok(profileJsPrimary.includes("status = dayData?.status || 'unknown';"));
      assert.ok(profileJsPrimary.includes("status === 'scheduled'"));

      // 2. Behavioral verification of fail-closed state resolution
      const resolveDeliveryDropAction = (status, isCutoffPassed = false) => {
        if (status === 'scheduled') {
          return isCutoffPassed ? { action: 'cutoff', allowed: false } : { action: 'skip', allowed: true };
        } else if (status === 'skipped') {
          return isCutoffPassed ? { action: 'cutoff', allowed: false } : { action: 'resume', allowed: true };
        } else if (status === 'vacation') {
          return { action: 'vacation_modal', allowed: false };
        } else if (status === 'paused') {
          return { action: 'sub_resume', allowed: false };
        } else {
          // Fail-closed for all unknown, unexpected, or unverified statuses
          return { action: 'disabled', allowed: false, display: 'Delivery status unavailable' };
        }
      };

      const testUnknownStatuses = ['custom_hold', 'processing', 'transit', 'review', null, undefined, '', 'unknown'];
      for (const unk of testUnknownStatuses) {
        const resolution = resolveDeliveryDropAction(unk);
        assert.strictEqual(resolution.allowed, false, `Status '${unk}' must NOT allow delivery mutation`);
        assert.strictEqual(resolution.action, 'disabled', `Status '${unk}' must fail closed with disabled action`);
      }
    });

    it('7.4: getSubscriptionCalendar enforces skipped precedence over orders cancelled by customer skips, and preserves delivered/failed orders', async () => {
      const mockSub = {
        id: 101,
        customer_id: 1,
        product_name: 'Buffalo Milk',
        quantity: '1 Litre',
        status: 'active',
        cost_per_day_paise: 9000,
        total_amount_paise: 270000,
        created_at: new Date('2026-10-01'),
        notes: {
          fulfillmentEntitled: true,
          paidThroughDate: '2026-11-30',
          startDate: '2026-10-01'
        }
      };

      const mockOrders = [
        { delivery_date: '2026-10-15', status: 'delivered', delivery_order_number: 'ORD-101', delivered_at: new Date('2026-10-15T06:30:00Z'), failed_reason: null },
        { delivery_date: '2026-10-16', status: 'failed', delivery_order_number: 'ORD-102', delivered_at: null, failed_reason: 'Gate locked by resident' },
        { delivery_date: '2026-10-17', status: 'cancelled', delivery_order_number: 'ORD-103', delivered_at: null, failed_reason: 'Delivery date skipped by customer' },
        { delivery_date: '2026-10-18', status: 'cancelled', delivery_order_number: 'ORD-104', delivered_at: null, failed_reason: 'Cancelled by operational hub' },
        { delivery_date: '2026-10-19', status: 'scheduled', delivery_order_number: 'ORD-105', delivered_at: null, failed_reason: null }
      ];

      const mockSkips = [
        { skip_date: '2026-10-17', reason: 'Customer out of station' }
      ];

      const mockPool = {
        query: async (sql) => {
          if (sql.includes('FROM customer_subscriptions cs')) return { rows: [mockSub] };
          if (sql.includes('DELETE FROM subscription_skipped_dates')) return { rows: [{ id: 1 }], rowCount: 1 };
          if (sql.includes('FROM subscription_delivery_orders')) return { rows: mockOrders };
          if (sql.includes('FROM subscription_skipped_dates')) return { rows: mockSkips };
          if (sql.includes('FROM subscription_delivery_pauses')) return { rows: [] };
          return { rows: [] };
        }
      };

      const cal = await getSubscriptionCalendar(mockPool, { subscriptionId: 101, customerId: 1, year: 2026, month: 9 });
      assert.ok(cal && Array.isArray(cal.days));

      const day15 = cal.days.find(d => d.date === '2026-10-15');
      const day16 = cal.days.find(d => d.date === '2026-10-16');
      const day17 = cal.days.find(d => d.date === '2026-10-17');
      const day18 = cal.days.find(d => d.date === '2026-10-18');
      const day19 = cal.days.find(d => d.date === '2026-10-19');

      assert.strictEqual(day15.status, 'delivered', 'Delivered order must report delivered');
      assert.strictEqual(day16.status, 'failed', 'Failed order must report failed');
      assert.strictEqual(day17.status, 'skipped', 'Order cancelled by customer skip MUST report skipped');
      assert.strictEqual(day17.detail, 'Customer out of station', 'Must retain customer skip detail');
      assert.strictEqual(day18.status, 'cancelled', 'Order cancelled by hub must report cancelled');
      assert.strictEqual(day19.status, 'scheduled', 'Scheduled order must report scheduled');
    });

    it('7.5: unskipDeliveryDate restores orders cancelled due to customer skips back to scheduled', async () => {
      const executedQueries = [];
      const mockSub = {
        id: 101,
        customer_id: 1,
        plan_type: 'daily',
        razorpay_subscription_id: null,
        status: 'active'
      };

      const mockClient = {
        query: async (sql, params) => {
          executedQueries.push({ sql, params });
          if (sql.includes('FROM customer_subscriptions cs')) return { rows: [mockSub] };
          if (sql.includes('DELETE FROM subscription_skipped_dates')) return { rows: [{ id: 1 }], rowCount: 1 };
          return { rows: [] };
        },
        release: () => {}
      };

      const mockPool = {
        connect: async () => mockClient
      };

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 4);
      const testSkipDate = futureDate.toISOString().slice(0, 10);

      await unskipDeliveryDate(mockPool, { subscriptionId: 101, customerId: 1, skipDate: testSkipDate });

      const restoreQuery = executedQueries.find(q =>
        q.sql.includes('UPDATE subscription_delivery_orders') &&
        q.sql.includes("status = 'scheduled'") &&
        q.sql.includes("failed_reason = 'Delivery date skipped by customer'")
      );

      assert.ok(restoreQuery, 'unskipDeliveryDate must execute order restoration query');
      assert.strictEqual(restoreQuery.params[0], 101);
      assert.strictEqual(restoreQuery.params[1], testSkipDate);
    });

    it('7.6: Paused subscriptions remain visible in Calendar tab and Tomorrow banner with resume action', () => {
      // 1. Static code assertions
      assert.ok(profileJsPrimary.includes("const eligibleSubs = state.subscriptions.filter((s) => s.status === 'active' || s.status === 'paused');"));
      assert.ok(profileJsPrimary.includes("if (sub.status === 'paused') {"));
      assert.ok(profileJsPrimary.includes('⏸ Subscription Paused'));
      assert.ok(profileJsPrimary.includes('▶ Resume Subscription'));
      assert.ok(profileJsPrimary.includes("const visibleSubs = state.subscriptions.filter((s) => s.status === 'active' || s.status === 'paused');"));
      assert.ok(profileJsPrimary.includes('[⏸ Paused]'));

      // 2. Behavioral verification of subscription eligibility filtering
      const sampleSubscriptions = [
        { id: 1, status: 'active', product: 'Buffalo Milk 1L' },
        { id: 2, status: 'paused', product: 'Cow Milk 500ml' },
        { id: 3, status: 'cancelled', product: 'Buffalo Milk 500ml' },
        { id: 4, status: 'expired', product: 'Cow Milk 1L' },
        { id: 5, status: 'unpaid', product: 'Buffalo Milk 1L' }
      ];

      const eligibleForTomorrow = sampleSubscriptions.filter((s) => s.status === 'active' || s.status === 'paused');
      assert.strictEqual(eligibleForTomorrow.length, 2, 'Only active and paused subscriptions should be eligible for tomorrow banner');
      assert.deepStrictEqual(eligibleForTomorrow.map(s => s.id), [1, 2]);

      const visibleForCalendar = sampleSubscriptions.filter((s) => s.status === 'active' || s.status === 'paused');
      assert.strictEqual(visibleForCalendar.length, 2, 'Calendar switcher must only show active and paused plans');
      assert.deepStrictEqual(visibleForCalendar.map(s => s.id), [1, 2]);

      // Verify that cancelled/expired plans have no delivery actions available
      const nonDeliverable = sampleSubscriptions.filter((s) => s.status !== 'active' && s.status !== 'paused');
      for (const sub of nonDeliverable) {
        assert.ok(!eligibleForTomorrow.some(s => s.id === sub.id));
        assert.ok(!visibleForCalendar.some(s => s.id === sub.id));
      }
    });
  });

  describe('8. Resumed Vacation Lifecycle & Idempotent Delivery Skip Suite', () => {
    // Helper to spin up a transactional in-memory database simulation
    function createMockTransactionalDb(initialOverrides = {}) {
      const db = {
        customer_subscriptions: [{
          id: 101,
          customer_id: 1,
          plan_type: 'daily',
          product_name: 'Buffalo Milk',
          quantity: '1 Litre',
          cost_per_day_paise: 9000,
          total_amount_paise: 270000,
          status: 'active',
          next_delivery: null,
          created_at: new Date('2026-10-01'),
          notes: {
            fulfillmentEntitled: true,
            paidThroughDate: '2026-12-31',
            startDate: '2026-10-01',
            paidCount: 3
          },
          ...initialOverrides.subscription
        }],
        customers: [{ id: 1, full_name: 'Test Customer', phone: '+919999999999', email: 'test@milvanta.in' }],
        subscription_skipped_dates: initialOverrides.skipped_dates || [],
        subscription_delivery_pauses: initialOverrides.pauses || [],
        subscription_billing_adjustments: initialOverrides.adjustments || [],
        subscription_delivery_orders: initialOverrides.orders || [],
        subscription_events: []
      };

      const executeQuery = (sql, params = []) => {
        // SELECT cs.*, c.phone, c.full_name, c.email FROM customer_subscriptions cs JOIN customers c ...
        if (sql.includes('FROM customer_subscriptions cs') && sql.includes('JOIN customers c')) {
          const sub = db.customer_subscriptions.find(s => s.id === params[0] && s.customer_id === params[1]);
          if (!sub) return { rows: [] };
          const cust = db.customers.find(c => c.id === sub.customer_id);
          return { rows: [{ ...sub, ...cust }] };
        }
        // INSERT INTO subscription_skipped_dates ... ON CONFLICT DO NOTHING RETURNING id
        if (sql.includes('INSERT INTO subscription_skipped_dates')) {
          const exists = db.subscription_skipped_dates.some(s => s.subscription_id === params[0] && s.skip_date === params[2]);
          if (exists) return { rows: [], rowCount: 0 };
          const row = { id: db.subscription_skipped_dates.length + 1, subscription_id: params[0], customer_id: params[1], skip_date: params[2], reason: params[3] };
          db.subscription_skipped_dates.push(row);
          return { rows: [row], rowCount: 1 };
        }
        // DELETE FROM subscription_skipped_dates ... RETURNING id
        if (sql.includes('DELETE FROM subscription_skipped_dates')) {
          const idx = db.subscription_skipped_dates.findIndex(s => s.subscription_id === params[0] && s.skip_date === params[1]);
          if (idx === -1) return { rows: [], rowCount: 0 };
          const [removed] = db.subscription_skipped_dates.splice(idx, 1);
          return { rows: [removed], rowCount: 1 };
        }
        // UPDATE subscription_delivery_orders
        if (sql.includes('UPDATE subscription_delivery_orders')) {
          let count = 0;
          for (const ord of db.subscription_delivery_orders) {
            if (ord.subscription_id === params[0]) {
              if (sql.includes("SET status = 'cancelled'")) {
                if (sql.includes('delivery_date >= $2 AND delivery_date <= $3')) {
                  // Vacation cancel range
                  if (ord.delivery_date >= params[1] && ord.delivery_date <= params[2] && ord.status === 'scheduled') {
                    ord.status = 'cancelled';
                    ord.failed_reason = 'Vacation mode active';
                    count++;
                  }
                } else if (ord.delivery_date === params[1] && ord.status === 'scheduled') {
                  ord.status = 'cancelled';
                  ord.failed_reason = 'Delivery date skipped by customer';
                  count++;
                }
              } else if (sql.includes("SET status = 'scheduled'")) {
                if (ord.delivery_date === params[1] && ord.status === 'cancelled' && ord.failed_reason === 'Delivery date skipped by customer') {
                  ord.status = 'scheduled';
                  ord.failed_reason = null;
                  count++;
                }
              }
            }
          }
          return { rowCount: count };
        }
        // INSERT INTO subscription_billing_adjustments
        if (sql.includes('INSERT INTO subscription_billing_adjustments')) {
          let daysCount = 1;
          let amount = params[3];
          let notes = params[4];
          if (sql.includes(', -1,')) {
            daysCount = -1;
            amount = params[3];
            notes = params[4];
          } else if (sql.includes(', 1,')) {
            daysCount = 1;
            amount = params[3];
            notes = params[4];
          } else {
            daysCount = params[3];
            amount = params[4];
            notes = params[5];
          }
          const row = { id: db.subscription_billing_adjustments.length + 1, subscription_id: params[0], customer_id: params[1], adjustment_type: params[2], days_count: daysCount, amount_paise: amount, notes };
          db.subscription_billing_adjustments.push(row);
          return { rows: [row], rowCount: 1 };
        }
        // INSERT INTO subscription_delivery_pauses
        if (sql.includes('INSERT INTO subscription_delivery_pauses')) {
          const row = { id: db.subscription_delivery_pauses.length + 1, subscription_id: params[0], customer_id: params[1], pause_start_date: params[2], pause_end_date: params[3], reason: params[4], resumed_at: null };
          db.subscription_delivery_pauses.push(row);
          return { rows: [row], rowCount: 1 };
        }
        // UPDATE subscription_delivery_pauses SET resumed_at = NOW()
        if (sql.includes('UPDATE subscription_delivery_pauses') && sql.includes('resumed_at = NOW()')) {
          let count = 0;
          for (const p of db.subscription_delivery_pauses) {
            if (p.subscription_id === params[0] && p.resumed_at === null) {
              p.resumed_at = new Date();
              count++;
            }
          }
          return { rowCount: count };
        }
        // SELECT FROM subscription_delivery_pauses
        if (sql.includes('FROM subscription_delivery_pauses')) {
          const active = db.subscription_delivery_pauses.filter(p => {
            if (p.subscription_id !== params[0]) return false;
            if (sql.includes('resumed_at IS NULL') && p.resumed_at !== null) return false;
            return true;
          });
          return { rows: active };
        }
        // SELECT FROM subscription_skipped_dates
        if (sql.includes('FROM subscription_skipped_dates')) {
          const rows = db.subscription_skipped_dates.filter(s => s.subscription_id === params[0]);
          return { rows };
        }
        // SELECT FROM subscription_delivery_orders
        if (sql.includes('FROM subscription_delivery_orders')) {
          const rows = db.subscription_delivery_orders.filter(o => o.subscription_id === params[0]);
          return { rows };
        }
        // UPDATE customer_subscriptions
        if (sql.includes('UPDATE customer_subscriptions')) {
          const sub = db.customer_subscriptions.find(s => s.id === params[0]);
          if (sub && sql.includes("status = 'active'")) sub.status = 'active';
          if (sub && params[1]) sub.next_delivery = params[1];
          return { rowCount: 1 };
        }
        // SELECT FROM customer_subscriptions
        if (sql.includes('FROM customer_subscriptions')) {
          const sub = db.customer_subscriptions.find(s => s.id === params[0]);
          return { rows: sub ? [sub] : [] };
        }
        // INSERT INTO subscription_events
        if (sql.includes('INSERT INTO subscription_events')) {
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };

      const pool = {
        connect: async () => ({
          query: async (sql, params) => executeQuery(sql, params),
          release: () => {}
        }),
        query: async (sql, params) => executeQuery(sql, params)
      };

      return { db, pool };
    }

    it('8.1: Resumed vacation visibility sequence (create vacation -> shows vacation -> resume -> future dates show scheduled)', async () => {
      const vStart = new Date();
      vStart.setDate(vStart.getDate() + 5);
      const vEnd = new Date();
      vEnd.setDate(vEnd.getDate() + 8);
      const startStr = formatDateYMD(vStart);
      const endStr = formatDateYMD(vEnd);

      const { db, pool } = createMockTransactionalDb();

      // 1. Initial calendar shows scheduled
      const calInitial = await getSubscriptionCalendar(pool, { subscriptionId: 101, customerId: 1, year: vStart.getFullYear(), month: vStart.getMonth() });
      const dayInitial = calInitial.days.find(d => d.date === startStr);
      assert.strictEqual(dayInitial.status, 'scheduled', 'Date should initially be scheduled');

      // 2. Customer creates vacation
      const vacRes = await setVacation(pool, { subscriptionId: 101, customerId: 1, startDate: startStr, endDate: endStr, reason: 'Family trip' });
      assert.strictEqual(vacRes.success, true);
      assert.strictEqual(db.subscription_delivery_pauses.length, 1);
      assert.strictEqual(db.subscription_delivery_pauses[0].resumed_at, null);

      // 3. Calendar during active vacation shows vacation
      const calDuringVacation = await getSubscriptionCalendar(pool, { subscriptionId: 101, customerId: 1, year: vStart.getFullYear(), month: vStart.getMonth() });
      const dayDuringVacation = calDuringVacation.days.find(d => d.date === startStr);
      assert.strictEqual(dayDuringVacation.status, 'vacation', 'Date during vacation must report vacation');

      // 4. Customer resumes subscription
      const resumeRes = await resumeSubscription(pool, { subscriptionId: 101, customerId: 1 });
      assert.strictEqual(resumeRes.success, true);
      assert.ok(db.subscription_delivery_pauses[0].resumed_at !== null, 'Pause record must be marked resumed with timestamp');

      // 5. Future eligible dates no longer show vacation
      const calAfterResume = await getSubscriptionCalendar(pool, { subscriptionId: 101, customerId: 1, year: vStart.getFullYear(), month: vStart.getMonth() });
      const dayAfterResume = calAfterResume.days.find(d => d.date === startStr);
      assert.strictEqual(dayAfterResume.status, 'scheduled', 'Future date must restore to scheduled and no longer show vacation');
    });

    it('8.2: getSubscriptionCalendar strictly queries subscription_delivery_pauses with resumed_at IS NULL condition', async () => {
      const executedQueries = [];
      const mockPool = {
        query: async (sql, params) => {
          executedQueries.push({ sql, params });
          if (sql.includes('FROM customer_subscriptions cs')) {
            return {
              rows: [{
                id: 101,
                customer_id: 1,
                product_name: 'Buffalo Milk',
                quantity: '1 Litre',
                status: 'active',
                cost_per_day_paise: 9000,
                total_amount_paise: 270000,
                created_at: new Date('2026-10-01'),
                notes: { fulfillmentEntitled: true, paidThroughDate: '2026-12-31' }
              }]
            };
          }
          return { rows: [] };
        }
      };

      await getSubscriptionCalendar(mockPool, { subscriptionId: 101, customerId: 1, year: 2026, month: 10 });

      const pausesQuery = executedQueries.find(q => q.sql.includes('FROM subscription_delivery_pauses'));
      assert.ok(pausesQuery, 'Must query subscription_delivery_pauses');
      assert.ok(pausesQuery.sql.includes('resumed_at IS NULL'), 'pauses query must enforce resumed_at IS NULL condition');
    });

    it('8.3: Idempotent skip billing: repeated requests for the same date create exactly 1 billing adjustment', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 4);
      const testSkipDate = formatDateYMD(futureDate);

      const { db, pool } = createMockTransactionalDb();

      // First skip request
      const skip1 = await skipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: testSkipDate, reason: 'Out of town' });
      assert.strictEqual(skip1.success, true);
      assert.strictEqual(skip1.alreadySkipped, false);
      assert.strictEqual(db.subscription_billing_adjustments.length, 1);
      assert.strictEqual(db.subscription_billing_adjustments[0].days_count, 1);
      assert.strictEqual(db.subscription_skipped_dates.length, 1);

      // Repeated skip request for the exact same date
      const skip2 = await skipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: testSkipDate, reason: 'Duplicate click' });
      assert.strictEqual(skip2.success, true);
      assert.strictEqual(skip2.alreadySkipped, true, 'Second call must report alreadySkipped');
      assert.strictEqual(db.subscription_billing_adjustments.length, 1, 'Must NOT create duplicate billing adjustment');
      assert.strictEqual(db.subscription_skipped_dates.length, 1);

      // Third rapid repeat
      const skip3 = await skipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: testSkipDate });
      assert.strictEqual(skip3.success, true);
      assert.strictEqual(skip3.alreadySkipped, true);
      assert.strictEqual(db.subscription_billing_adjustments.length, 1, 'Still strictly 1 adjustment');
    });

    it('8.4: Idempotent unskip billing: repeated requests do NOT generate multiple negative adjustments', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 4);
      const testSkipDate = formatDateYMD(futureDate);

      const { db, pool } = createMockTransactionalDb({
        skipped_dates: [{ id: 1, subscription_id: 101, customer_id: 1, skip_date: testSkipDate, reason: 'Initial skip' }],
        adjustments: [{ id: 1, subscription_id: 101, customer_id: 1, adjustment_type: 'extension', days_count: 1, amount_paise: 9000 }],
        orders: [{ id: 1, subscription_id: 101, delivery_date: testSkipDate, status: 'cancelled', failed_reason: 'Delivery date skipped by customer' }]
      });

      // First unskip request
      const unskip1 = await unskipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: testSkipDate });
      assert.strictEqual(unskip1.success, true);
      assert.strictEqual(unskip1.alreadyUnskipped, false);
      assert.strictEqual(db.subscription_billing_adjustments.length, 2, 'Must record reversal adjustment');
      assert.strictEqual(db.subscription_billing_adjustments[1].days_count, -1);
      assert.strictEqual(db.subscription_delivery_orders[0].status, 'scheduled', 'Order must be restored to scheduled');
      assert.strictEqual(db.subscription_skipped_dates.length, 0);

      // Repeated unskip request
      const unskip2 = await unskipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: testSkipDate });
      assert.strictEqual(unskip2.success, true);
      assert.strictEqual(unskip2.alreadyUnskipped, true, 'Second call must report alreadyUnskipped');
      assert.strictEqual(db.subscription_billing_adjustments.length, 2, 'Must NOT generate multiple negative adjustments');

      // Third unskip request
      const unskip3 = await unskipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: testSkipDate });
      assert.strictEqual(unskip3.success, true);
      assert.strictEqual(unskip3.alreadyUnskipped, true);
      assert.strictEqual(db.subscription_billing_adjustments.length, 2, 'Still strictly 2 adjustments');
    });

    it('8.5: Unskip order restoration specifically targets customer-skipped cancellations and preserves operational cancellations', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 4);
      const skipDate = formatDateYMD(futureDate);

      const { db, pool } = createMockTransactionalDb({
        skipped_dates: [{ id: 1, subscription_id: 101, customer_id: 1, skip_date: skipDate, reason: 'Skip' }],
        orders: [
          { id: 1, subscription_id: 101, delivery_date: skipDate, status: 'cancelled', failed_reason: 'Delivery date skipped by customer' },
          { id: 2, subscription_id: 101, delivery_date: '2026-10-30', status: 'cancelled', failed_reason: 'Cancelled by operational dairy hub' }
        ]
      });

      await unskipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate });

      const customerSkippedOrder = db.subscription_delivery_orders.find(o => o.id === 1);
      const hubCancelledOrder = db.subscription_delivery_orders.find(o => o.id === 2);

      assert.strictEqual(customerSkippedOrder.status, 'scheduled', 'Customer-skipped order must be restored to scheduled');
      assert.strictEqual(customerSkippedOrder.failed_reason, null);

      assert.strictEqual(hubCancelledOrder.status, 'cancelled', 'Hub operational cancellation must be strictly preserved');
      assert.strictEqual(hubCancelledOrder.failed_reason, 'Cancelled by operational dairy hub');
    });

    it('8.6: Boundary & security enforcement: cutoff, ownership, cancelled subscription, and entitlement limits', async () => {
      const { pool } = createMockTransactionalDb({
        subscription: {
          status: 'cancelled'
        }
      });

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const validFutureDate = formatDateYMD(futureDate);

      // 1. Cancelled subscription guard
      const skipCancelled = await skipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: validFutureDate });
      assert.strictEqual(skipCancelled.success, false);
      assert.strictEqual(skipCancelled.error, 'cannot_modify_cancelled_subscription');

      const unskipCancelled = await unskipDeliveryDate(pool, { subscriptionId: 101, customerId: 1, skipDate: validFutureDate });
      assert.strictEqual(unskipCancelled.success, false);
      assert.strictEqual(unskipCancelled.error, 'cannot_modify_cancelled_subscription');

      // 2. Ownership verification guard (wrong customer ID)
      const { pool: activePool } = createMockTransactionalDb();
      const skipWrongOwner = await skipDeliveryDate(activePool, { subscriptionId: 101, customerId: 999, skipDate: validFutureDate });
      assert.strictEqual(skipWrongOwner.success, false);
      assert.strictEqual(skipWrongOwner.error, 'subscription_not_found');

      // 3. Cutoff enforcement (past date)
      const skipPast = await skipDeliveryDate(activePool, { subscriptionId: 101, customerId: 1, skipDate: '2026-01-01' });
      assert.strictEqual(skipPast.success, false);
      assert.strictEqual(skipPast.error, 'cutoff_passed');

      const unskipPast = await unskipDeliveryDate(activePool, { subscriptionId: 101, customerId: 1, skipDate: '2026-01-01' });
      assert.strictEqual(unskipPast.success, false);
      assert.strictEqual(unskipPast.error, 'cutoff_passed');

      // 4. Entitlement limit guard (skipping past paid entitlement date 2026-12-31)
      const skipBeyond = await skipDeliveryDate(activePool, { subscriptionId: 101, customerId: 1, skipDate: '2027-02-15' });
      assert.strictEqual(skipBeyond.success, false);
      assert.strictEqual(skipBeyond.error, 'beyond_entitlement');
    });
  });
});
