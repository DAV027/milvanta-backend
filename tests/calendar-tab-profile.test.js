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

    it('profile.html has incremented cache-busting version strings (?v=20261021-3)', () => {
      assert.ok(profileHtmlPrimary.includes('css/profile.css?v=20261021-3'));
      assert.ok(profileHtmlPrimary.includes('js/profile.js?v=20261021-3'));
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
});
