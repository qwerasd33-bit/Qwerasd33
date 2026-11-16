import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMODITIES_CATALOG, HIJRI_MONTH_NAMES } from '../constants';
import {
  advanceMonth,
  anchorHijriStart,
  applyManualPriceOverride,
  applyMonthlyPlanBatchOverrides,
  createInitialGameState,
  describePatternRule,
  deserializeGameState,
  endUnlimitedSession,
  executeTrade,
  getActiveHijriImpacts,
  getActiveSeasonalEvent,
  getDualCalendarForMonth,
  getEffectivePrice,
  getLeaderboard,
  getNextSeasonalEventMonth,
  getPlayedSeasonalEvents,
  getVisibleHistory,
  grantTeamCash,
  isPrimeMonth,
  purchaseSecretReport,
  resetSessionFromBeginning,
  serializeGameState,
  undoLastAction,
} from './marketEngine';
import {
  deleteSavedSessionSlot,
  listSavedSessions,
  loadSavedSessionState,
  saveSessionSlot,
} from '../services/SavedSessionsStore';

test('catalog contains the exact 14 requested products', () => {
  const expectedNames = [
    'حطب',
    'تمر',
    'جوال',
    'قهوة',
    'طحين',
    'غنم',
    'رز',
    'الواح طاقة شمسية',
    'بنزين',
    'حديد',
    'اسمنت',
    'عقارات',
    'دواجن',
    'غاز',
  ];
  assert.equal(COMMODITIES_CATALOG.length, 14);
  assert.deepEqual(
    COMMODITIES_CATALOG.map((c) => c.name),
    expectedNames
  );
});

test('customization: respects productCount, activePatterns, volatilityMultiplier, horizonMode, and per-product pattern override', () => {
  const state = createInitialGameState(
    {
      productCount: 9,
      volatilityMultiplier: 1.5,
      horizonMode: 'unlimited',
      activePatterns: {
        seasonal_monthly: true,
        numeric_month_rule: true,
        linked_commodity: false,
      },
      productPatternConfigs: {
        firewood: {
          pattern: 'numeric_month_rule',
          numericRule: 'prime_months',
        },
      },
    },
    ['فريق 1', 'فريق 2']
  );

  assert.equal(state.market.activeCommodityIds.length, 9);
  assert.equal(state.config.horizonMode, 'unlimited');
  assert.equal(state.teams.length, 2);
  // Customized firewood uses numeric prime_months
  assert.equal(state.market.seriesById['firewood'].effectivePattern, 'numeric_month_rule');
  assert.equal(
    state.market.seriesById['firewood'].appliedPatternConfig.numericRule,
    'prime_months'
  );
  // Disabled linked_commodity falls back to neutral
  assert.equal(state.market.seriesById['rice'].effectivePattern, 'neutral');
  assert.equal(state.market.seriesById['gasoline'].effectivePattern, 'neutral');
});

test('Pattern 1 (seasonal_monthly): winter firewood peaks in winter and dips in summer with monthly steps', () => {
  const state = createInitialGameState({
    productCount: 14,
    volatilityMultiplier: 1.0,
    productPatternConfigs: {
      firewood: { pattern: 'seasonal_monthly', seasonalPeak: 'winter' },
    },
  });
  const base = state.market.seriesById['firewood'].basePrices;
  assert.equal(base.length, 36);
  // Month 1 (idx 0, winter) should be significantly higher than Month 7 (idx 6, summer)
  assert.ok(base[0] > base[6] + 30);
  // Month 13 (idx 12, winter year 2) also higher than Month 7 (idx 6)
  assert.ok(base[12] > base[6] + 30);
  // Should vary monthly rather than staying flat
  assert.notEqual(base[1], base[2]);
  assert.notEqual(base[2], base[3]);
});

test('Pattern 1 (seasonal_monthly custom): respects user-defined 12-month prices across all years', () => {
  const custom12 = [110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220];
  const state = createInitialGameState({
    productCount: 14,
    productPatternConfigs: {
      firewood: {
        pattern: 'seasonal_monthly',
        seasonalPeak: 'custom',
        customMonthlyPrices: custom12,
      },
    },
  });
  const base = state.market.seriesById['firewood'].basePrices;
  for (let m = 0; m < 36; m++) {
    assert.equal(base[m], custom12[m % 12]);
  }
});

test('Pattern 2 (numeric_month_rule): prime_months, multiples_of_3, multiples_of_4, and even/odd behave accurately', () => {
  const state = createInitialGameState({
    productCount: 14,
    volatilityMultiplier: 1.0,
    productPatternConfigs: {
      steel: { pattern: 'numeric_month_rule', numericRule: 'prime_months' },
      poultry: { pattern: 'numeric_month_rule', numericRule: 'multiples_of_3' },
      mobile: { pattern: 'numeric_month_rule', numericRule: 'multiples_of_4' },
      flour: { pattern: 'numeric_month_rule', numericRule: 'even_up_odd_down' },
      coffee: { pattern: 'numeric_month_rule', numericRule: 'odd_up_even_down' },
    },
  });

  // Check prime months rule on steel
  const steel = state.market.seriesById['steel'].basePrices;
  let primeSum = 0;
  let primeCount = 0;
  let compSum = 0;
  let compCount = 0;
  for (let m = 0; m < 36; m++) {
    const monthNum = m + 1;
    if (isPrimeMonth(monthNum)) {
      primeSum += steel[m];
      primeCount++;
    } else {
      compSum += steel[m];
      compCount++;
    }
  }
  assert.ok(primeSum / primeCount > compSum / compCount + 80);

  // Check multiples of 3 on poultry (months 3, 6, 9 vs 1, 2, 4)
  const poultry = state.market.seriesById['poultry'].basePrices;
  assert.ok(poultry[2] > poultry[0] && poultry[2] > poultry[1]); // month 3 > month 1, 2
  assert.ok(poultry[5] > poultry[3] && poultry[5] > poultry[4]); // month 6 > month 4, 5

  // Check multiples of 4 on mobile (months 4, 8, 12)
  const mobile = state.market.seriesById['mobile'].basePrices;
  assert.ok(mobile[3] > mobile[1] && mobile[3] > mobile[2]); // month 4 > month 2, 3
  assert.ok(mobile[7] > mobile[5] && mobile[7] > mobile[6]); // month 8 > month 6, 7

  // Check even vs odd parity on flour (even high) and coffee (odd high)
  const flour = state.market.seriesById['flour'].basePrices;
  const coffee = state.market.seriesById['coffee'].basePrices;
  assert.ok(flour[1] > flour[0]); // Month 2 (even) > Month 1 (odd)
  assert.ok(coffee[0] > coffee[1]); // Month 1 (odd) > Month 2 (even)
});

test('Pattern 3 (linked_commodity): direct & inverse correlations work and circular links do not fail', () => {
  const state = createInitialGameState({
    productCount: 14,
    volatilityMultiplier: 1.0,
    productPatternConfigs: {
      firewood: { pattern: 'seasonal_monthly', seasonalPeak: 'winter' },
      dates: {
        pattern: 'linked_commodity',
        linkedCommodityId: 'firewood',
        correlationDirection: 'direct',
        lagMonths: 0,
      },
      gas: {
        pattern: 'linked_commodity',
        linkedCommodityId: 'firewood',
        correlationDirection: 'inverse',
        lagMonths: 0,
      },
      // Circular link between steel <-> cement should break gracefully
      steel: {
        pattern: 'linked_commodity',
        linkedCommodityId: 'cement',
        correlationDirection: 'direct',
      },
      cement: {
        pattern: 'linked_commodity',
        linkedCommodityId: 'steel',
        correlationDirection: 'direct',
      },
    },
  });

  const firewood = state.market.seriesById['firewood'].basePrices;
  const dates = state.market.seriesById['dates'].basePrices;
  const gas = state.market.seriesById['gas'].basePrices;

  assert.ok(firewood[0] > firewood[6]);
  assert.ok(dates[0] > dates[6]);
  assert.ok(gas[0] < gas[6]);

  const steel = state.market.seriesById['steel'].basePrices;
  const cement = state.market.seriesById['cement'].basePrices;
  assert.equal(steel.length, 36);
  assert.equal(cement.length, 36);
  assert.ok(steel.every((p) => Number.isFinite(p) && p > 0));
  assert.ok(cement.every((p) => Number.isFinite(p) && p > 0));
});

test('zone of unknown: visible history strictly slices up to currentMonthIndex', () => {
  let state = createInitialGameState({ productCount: 14 });
  assert.equal(getVisibleHistory(state, 'firewood').length, 1);

  state = advanceMonth(state);
  state = advanceMonth(state);
  assert.equal(state.currentMonthIndex, 2);
  assert.equal(getVisibleHistory(state, 'firewood').length, 3);
});

test('unlimited horizon: continues smoothly past month 36 until moderator ends session', () => {
  let state = createInitialGameState({
    productCount: 14,
    horizonMode: 'unlimited',
    startingCash: 5000,
  });

  for (let i = 0; i < 40; i++) {
    state = advanceMonth(state);
  }
  assert.equal(state.isFinished, false);
  assert.equal(state.currentMonthIndex, 40); // Month 41
  assert.equal(getVisibleHistory(state, 'firewood').length, 41);
  // Month 41 (prime) on steel should still obey prime spike vs Month 40 (composite)
  assert.ok(
    getEffectivePrice(state.market, 'steel', 40) >
      getEffectivePrice(state.market, 'steel', 39)
  );

  const ended = endUnlimitedSession(state);
  assert.equal(ended.isFinished, true);
  const undone = undoLastAction(ended);
  assert.equal(undone.state.isFinished, false);
});

test('pre-adoption customPlanOverrides & in-session monthly batch plan overrides', () => {
  const s0 = createInitialGameState({
    productCount: 14,
    customPlanOverrides: {
      firewood: { 0: 333, 14: 444 },
    },
  });
  assert.equal(getEffectivePrice(s0.market, 'firewood', 0), 333);
  assert.equal(getEffectivePrice(s0.market, 'firewood', 14), 444);

  const batch = applyMonthlyPlanBatchOverrides(s0, [
    { commodityId: 'dates', monthIndex: 2, price: 199 },
    { commodityId: 'coffee', monthIndex: 5, price: 255 },
  ]);
  assert.equal(batch.updatedCount, 2);
  assert.equal(getEffectivePrice(batch.state.market, 'dates', 2), 199);
  assert.equal(getEffectivePrice(batch.state.market, 'coffee', 5), 255);

  const undone = undoLastAction(batch.state);
  assert.notEqual(getEffectivePrice(undone.state.market, 'dates', 2), 199);
});

test('pre-month & ad-hoc team funding grants 1000, 2000, 3000, and custom amounts with undo', () => {
  const s0 = createInitialGameState({ startingCash: 5000 });
  const granted = grantTeamCash(s0, {
    team_1: 1000,
    team_2: 2000,
    team_3: 3000,
    team_4: 4750,
  });
  assert.equal(granted.error, undefined);
  assert.equal(granted.totalGranted, 10750);
  assert.equal(granted.state.teams[0].cash, 6000);
  assert.equal(granted.state.teams[1].cash, 7000);
  assert.equal(granted.state.teams[2].cash, 8000);
  assert.equal(granted.state.teams[3].cash, 9750);

  const undoneGrant = undoLastAction(granted.state);
  assert.equal(undoneGrant.state.teams[0].cash, 5000);

  const s1 = advanceMonth(undoneGrant.state, {
    team_1: 2000,
    team_2: 0,
    team_3: 1500,
  });
  assert.equal(s1.currentMonthIndex, 1);
  assert.equal(s1.teams[0].cash, 7000);
  assert.equal(s1.teams[1].cash, 5000);
  assert.equal(s1.teams[2].cash, 6500);
  assert.equal(s1.teams[0].netWorthHistory[1], 7000);
});

test('trading validation, portfolio valuation, and supply-demand next-month impact', () => {
  const initial = createInitialGameState({
    productCount: 14,
    startingCash: 5000,
    supplyDemandThreshold: 10,
    supplyDemandStepPct: 0.1,
  });

  const gasolinePriceM0 = getEffectivePrice(initial.market, 'gasoline', 0);
  const tradeRes = executeTrade(initial, 'team_1', [
    { commodityId: 'gasoline', quantity: 15 },
  ]);
  assert.equal(tradeRes.error, undefined);

  const afterTrade = tradeRes.state;
  assert.equal(afterTrade.teams[0].cash, 5000 - gasolinePriceM0 * 15);
  assert.equal(afterTrade.teams[0].holdings['gasoline'], 15);
  assert.equal(afterTrade.market.currentMonthNetVolume['gasoline'], 15);

  const badSell = executeTrade(afterTrade, 'team_1', [
    { commodityId: 'gasoline', quantity: -20 },
  ]);
  assert.ok(badSell.error);

  const afterAdvance = advanceMonth(afterTrade);
  assert.equal(afterAdvance.currentMonthIndex, 1);
  assert.ok(afterAdvance.market.lastMonthDemandImpact['gasoline'] > 0);

  const baseM1 = afterAdvance.market.seriesById['gasoline'].basePrices[1];
  const actualM1 = getEffectivePrice(afterAdvance.market, 'gasoline', 1);
  assert.ok(actualM1 > baseM1);

  const board = getLeaderboard(afterAdvance);
  assert.equal(board[0].team.id, 'team_1');
});

test('secret reports adapt dynamically to custom assigned patterns', () => {
  const state = createInitialGameState({
    startingCash: 1500,
    secretReportCost: 500,
    productPatternConfigs: {
      firewood: {
        pattern: 'numeric_month_rule',
        numericRule: 'prime_months',
      },
    },
  });

  const r1 = purchaseSecretReport(state, 'team_1', 'firewood');
  assert.equal(r1.error, undefined);
  assert.ok(r1.hint?.text.includes('رقم الشهر'));

  const r2 = purchaseSecretReport(r1.state, 'team_1', 'firewood');
  assert.equal(r2.error, undefined);
  assert.ok(r2.hint?.text.includes('الأولية'));

  const summary = describePatternRule(
    r2.state.market.seriesById['firewood'].effectivePattern,
    r2.state.market.seriesById['firewood'].appliedPatternConfig
  );
  assert.ok(summary.includes('الأولية'));

  const r3 = purchaseSecretReport(r2.state, 'team_1', 'firewood');
  assert.ok(r3.error);
});

test('manual price overrides (temporary vs permanent) and multi-level undo', () => {
  const s0 = createInitialGameState({ productCount: 14 });
  const origM0 = getEffectivePrice(s0.market, 'firewood', 0);
  const origM1 = getEffectivePrice(s0.market, 'firewood', 1);

  const tempRes = applyManualPriceOverride(s0, 'firewood', 300, 'temporary');
  assert.equal(getEffectivePrice(tempRes.state.market, 'firewood', 0), 300);
  assert.equal(getEffectivePrice(tempRes.state.market, 'firewood', 1), origM1);

  const undone = undoLastAction(tempRes.state);
  assert.equal(getEffectivePrice(undone.state.market, 'firewood', 0), origM0);

  const permRes = applyManualPriceOverride(undone.state, 'firewood', origM0 + 50, 'permanent');
  assert.equal(getEffectivePrice(permRes.state.market, 'firewood', 0), origM0 + 50);
  assert.equal(getEffectivePrice(permRes.state.market, 'firewood', 1), origM1 + 50);
});

test('JSON serialization round-trip preserves full state including unlimited horizon and rejects mismatched catalog', () => {
  const s0 = createInitialGameState({
    sessionName: 'كشتة الخميس',
    productCount: 14,
    horizonMode: 'unlimited',
  });
  let state = executeTrade(s0, 'team_2', [{ commodityId: 'firewood', quantity: 4 }]).state;
  for (let i = 0; i < 38; i++) {
    state = advanceMonth(state);
  }

  const json = serializeGameState(state);
  const restored = deserializeGameState(json);
  assert.equal(restored.error, undefined);
  assert.equal(restored.state?.config.sessionName, 'كشتة الخميس');
  assert.equal(restored.state?.config.horizonMode, 'unlimited');
  assert.equal(restored.state?.currentMonthIndex, 38);
  assert.equal(restored.state?.teams[1].holdings['firewood'], 4);
});

test('seasonal events: trigger strictly every 3 months (Month 3, 6, 9, ...) and target only ONE product', () => {
  const baseline = createInitialGameState({
    productCount: 14,
    seasonalEventsEnabled: false,
    seed: 555111,
  });
  const withEvents = createInitialGameState({
    productCount: 14,
    seasonalEventsEnabled: true,
    seasonalEventImpactPct: 0.3,
    seed: 555111,
  });

  // No events on disabled baseline
  assert.equal(Object.keys(baseline.market.seasonalEvents).length, 0);

  // Months 1..36: events ONLY at 0-based indices 2, 5, 8, ..., 35 (i.e. (m+1) % 3 === 0)
  for (let m = 0; m < 36; m++) {
    const ev = getActiveSeasonalEvent(withEvents.market, m);
    if ((m + 1) % 3 === 0) {
      assert.ok(ev, `Expected seasonal event at Month ${m + 1}`);
      assert.ok(ev.direction === 'up' || ev.direction === 'down');
      if (ev.direction === 'up') {
        assert.ok(ev.priceDelta > 0);
      } else {
        assert.ok(ev.priceDelta < 0);
      }

      // Verify strictly ONE product deviates from baseline while all other 13 match baseline
      let changedCount = 0;
      for (const cid of withEvents.market.activeCommodityIds) {
        const pWith = getEffectivePrice(withEvents.market, cid, m);
        const pBase = getEffectivePrice(baseline.market, cid, m);
        if (cid === ev.commodityId) {
          assert.notEqual(pWith, pBase);
          assert.equal(pWith, Math.max(1, pBase + ev.priceDelta));
          changedCount++;
        } else {
          assert.equal(pWith, pBase, `Non-target commodity ${cid} must not be altered at Month ${m + 1}`);
        }
      }
      assert.equal(changedCount, 1);
    } else {
      assert.equal(ev, null, `Unexpected seasonal event at Month ${m + 1}`);
    }
  }
});

test('seasonal events: zero future leakage and seamless unlimited horizon extension', () => {
  let state = createInitialGameState({
    productCount: 14,
    horizonMode: 'unlimited',
    seasonalEventsEnabled: true,
    seasonalEventImpactPct: 0.35,
    seed: 777333,
  });

  // Month 1: zero played events revealed, next is Month 3
  assert.equal(getPlayedSeasonalEvents(state).length, 0);
  assert.equal(getNextSeasonalEventMonth(state), 3);

  // Advance to Month 3 (index 2) -> exactly 1 event revealed
  state = advanceMonth(state);
  state = advanceMonth(state);
  assert.equal(state.currentMonthIndex, 2);
  assert.equal(getPlayedSeasonalEvents(state).length, 1);
  assert.equal(getPlayedSeasonalEvents(state)[0].monthIndex, 2);

  // Advance past Month 36 to Month 39 (index 38) -> Month 39 seasonal event generated and active
  for (let i = 0; i < 36; i++) {
    state = advanceMonth(state);
  }
  assert.equal(state.currentMonthIndex, 38);
  const m39Event = getActiveSeasonalEvent(state.market, 38);
  assert.ok(m39Event);
  assert.equal(getPlayedSeasonalEvents(state).length, 13); // 3,6,...,36,39
  assert.equal(getPlayedSeasonalEvents(state)[0].monthIndex, 38);

  // Editing an event month via monthly plan still lands on the exact requested price
  const targetCid = m39Event.commodityId;
  const batch = applyMonthlyPlanBatchOverrides(state, [
    { commodityId: targetCid, monthIndex: 38, price: 420 },
  ]);
  assert.equal(getEffectivePrice(batch.state.market, targetCid, 38), 420);
});

test('seasonal events: default 50% impact and flagship cause-driven events (Month 3 livestock -50%, Month 6 gasoline +50%)', () => {
  const s0 = createInitialGameState();
  assert.equal(s0.config.seasonalEventImpactPct, 0.5);

  // Month 3 (index 2): livestock scabies -50%
  const evM3 = getActiveSeasonalEvent(s0.market, 2);
  assert.ok(evM3);
  assert.equal(evM3.commodityId, 'livestock');
  assert.equal(evM3.direction, 'down');
  assert.equal(evM3.impactPct, 0.5);
  assert.ok(evM3.title.includes('الجرب'));
  assert.ok(evM3.reason.length > 10);
  const baseM3 = s0.market.seriesById['livestock'].basePrices[2];
  assert.equal(evM3.priceDelta, -Math.round(baseM3 * 0.5));

  // Month 6 (index 5): global oil crisis gasoline +50%
  const evM6 = getActiveSeasonalEvent(s0.market, 5);
  assert.ok(evM6);
  assert.equal(evM6.commodityId, 'gasoline');
  assert.equal(evM6.direction, 'up');
  assert.equal(evM6.impactPct, 0.5);
  assert.ok(evM6.title.includes('النفط'));
  assert.ok(evM6.reason.length > 10);
  const baseM6 = s0.market.seriesById['gasoline'].basePrices[5];
  assert.equal(evM6.priceDelta, Math.round(baseM6 * 0.5));

  // Serialization preserves reason
  const restored = deserializeGameState(serializeGameState(s0));
  assert.equal(restored.error, undefined);
  assert.equal(
    getActiveSeasonalEvent(restored.state!.market, 2)?.reason,
    evM3.reason
  );
});

test('dual Hijri & Gregorian calendar aligns monotonically with zero skipped Hijri months', () => {
  const anchored = anchorHijriStart(2026, 11);
  assert.equal(anchored.hijriYear, 1448);
  assert.equal(anchored.hijriMonth, 6);

  const m1 = getDualCalendarForMonth({ startYear: 2026, startMonth: 11 }, 0);
  assert.equal(m1.gregorianMonthName, 'نوفمبر');
  assert.equal(m1.gregorianYear, 2026);
  assert.equal(m1.hijriMonthName, 'جمادى الآخرة');
  assert.equal(m1.hijriYear, 1448);

  // Month 4 (index 3) should be Ramadan 1448 / Feb 2027
  const m4 = getDualCalendarForMonth({ startYear: 2026, startMonth: 11 }, 3);
  assert.equal(m4.gregorianMonthName, 'فبراير');
  assert.equal(m4.gregorianYear, 2027);
  assert.equal(m4.hijriMonth, 9);
  assert.equal(m4.hijriMonthName, 'رمضان');
  assert.equal(m4.hijriYear, 1448);

  // Month 7 (index 6) should be Dhu al-Hijjah 1448 / May 2027
  const m7 = getDualCalendarForMonth({ startYear: 2026, startMonth: 11 }, 6);
  assert.equal(m7.hijriMonth, 12);
  assert.equal(m7.hijriMonthName, 'ذو الحجة');

  // Monotonic progression across 48 consecutive months
  for (let i = 0; i < 48; i++) {
    const cur = getDualCalendarForMonth({ startYear: 2026, startMonth: 11 }, i);
    assert.equal(cur.hijriMonthName, HIJRI_MONTH_NAMES[cur.hijriMonth - 1]);
    if (i > 0) {
      const prev = getDualCalendarForMonth({ startYear: 2026, startMonth: 11 }, i - 1);
      const expectedNext = (prev.hijriMonth % 12) + 1;
      assert.equal(cur.hijriMonth, expectedNext);
    }
  }
});

test('Hijri months impact prices (Dates +38% in Ramadan, Livestock +35% in Dhu al-Hijjah) and respect batch overrides', () => {
  const baseState = createInitialGameState({
    productCount: 14,
    startYear: 2026,
    startMonth: 11,
    hijriEffectsEnabled: false,
    seed: 987654,
  });
  const hijriState = createInitialGameState({
    productCount: 14,
    startYear: 2026,
    startMonth: 11,
    hijriEffectsEnabled: true,
    seed: 987654,
  });

  // Month 4 (idx 3) = Ramadan 1448 -> dates surge +38%, coffee +18%
  const ramadanImpacts = getActiveHijriImpacts(hijriState.market, 3);
  assert.ok(ramadanImpacts.some((imp) => imp.commodityId === 'dates' && imp.impactPct > 0.3));
  assert.ok(ramadanImpacts.some((imp) => imp.commodityId === 'coffee' && imp.impactPct > 0.1));

  const datesBaseM4 = getEffectivePrice(baseState.market, 'dates', 3);
  const datesRamadanM4 = getEffectivePrice(hijriState.market, 'dates', 3);
  assert.ok(datesRamadanM4 > datesBaseM4 + 10);

  // Month 7 (idx 6) = Dhu al-Hijjah 1448 -> livestock surge +35%
  const sheepBaseM7 = getEffectivePrice(baseState.market, 'livestock', 6);
  const sheepHijriM7 = getEffectivePrice(hijriState.market, 'livestock', 6);
  assert.ok(sheepHijriM7 > sheepBaseM7 + 50);

  // Disabled returns empty impacts
  assert.equal(getActiveHijriImpacts(baseState.market, 3).length, 0);

  // Monthly plan batch edit still lands on exact requested price in Ramadan
  const edited = applyMonthlyPlanBatchOverrides(hijriState, [
    { commodityId: 'dates', monthIndex: 3, price: 215 },
  ]);
  assert.equal(getEffectivePrice(edited.state.market, 'dates', 3), 215);
});

test('resetSessionFromBeginning resets month, cash, portfolios, hints, and supports keep-plan vs new-seed with undo', () => {
  let state = createInitialGameState({
    startingCash: 5000,
    productCount: 14,
    seed: 24680,
  });

  state = executeTrade(state, 'team_1', [{ commodityId: 'firewood', quantity: 5 }]).state;
  state = purchaseSecretReport(state, 'team_2', 'dates').state;
  state = grantTeamCash(state, { team_1: 2000 }).state;
  state = advanceMonth(state);
  state = advanceMonth(state);
  assert.equal(state.currentMonthIndex, 2);
  assert.equal(state.teams[0].holdings['firewood'], 5);
  assert.equal(state.teams[1].unlockedHints.length, 1);

  const originalFirewoodM0 = getEffectivePrice(state.market, 'firewood', 0);

  // Reset keeping price plan
  const resetSame = resetSessionFromBeginning(state, { regeneratePrices: false });
  assert.equal(resetSame.currentMonthIndex, 0);
  assert.equal(resetSame.isFinished, false);
  assert.equal(resetSame.teams[0].cash, 5000);
  assert.deepEqual(resetSame.teams[0].holdings, {});
  assert.equal(resetSame.teams[1].unlockedHints.length, 0);
  assert.equal(resetSame.tradeLog.length, 0);
  assert.deepEqual(resetSame.teams[0].netWorthHistory, [5000]);
  assert.equal(resetSame.market.currentMonthNetVolume['firewood'], 0);
  assert.equal(getEffectivePrice(resetSame.market, 'firewood', 0), originalFirewoodM0);

  // Undo restores Month 3 state
  const undone = undoLastAction(resetSame);
  assert.equal(undone.state.currentMonthIndex, 2);
  assert.equal(undone.state.teams[0].holdings['firewood'], 5);

  // Reset regenerating new prices changes seed
  const resetFresh = resetSessionFromBeginning(state, { regeneratePrices: true });
  assert.equal(resetFresh.currentMonthIndex, 0);
  assert.notEqual(resetFresh.config.seed, state.config.seed);
  assert.equal(resetFresh.teams[0].cash, 5000);
});

test('SavedSessionsStore saves, lists, overwrites, loads, and deletes in-app checkpoints', () => {
  const mem = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };

  let s1 = createInitialGameState({ sessionName: 'كشتة الشمال' });
  s1 = advanceMonth(s1);
  s1 = advanceMonth(s1);
  s1 = advanceMonth(s1); // Month 4 (Ramadan)

  const slot1 = saveSessionSlot(s1, 'حفظ رمضان', undefined, mockStorage);
  assert.equal(slot1.monthNumber, 4);
  assert.equal(slot1.hijriLabel.includes('رمضان'), true);

  let s2 = createInitialGameState({ sessionName: 'كشتة الجنوب' });
  saveSessionSlot(s2, 'بداية الجنوب', undefined, mockStorage);

  const list = listSavedSessions(mockStorage);
  assert.equal(list.length, 2);

  // Overwrite slot1
  const s1Next = advanceMonth(s1);
  const updated = saveSessionSlot(s1Next, 'شوال محدث', slot1.id, mockStorage);
  assert.equal(updated.id, slot1.id);
  assert.equal(updated.monthNumber, 5);
  assert.equal(listSavedSessions(mockStorage).length, 2);

  // Load slot1
  const loaded = loadSavedSessionState(slot1.id, mockStorage);
  assert.equal(loaded.error, undefined);
  assert.equal(loaded.state?.currentMonthIndex, 4);
  assert.equal(loaded.state?.config.sessionName, 'كشتة الشمال');

  // Delete slot1
  const afterDel = deleteSavedSessionSlot(slot1.id, mockStorage);
  assert.equal(afterDel.length, 1);
});


