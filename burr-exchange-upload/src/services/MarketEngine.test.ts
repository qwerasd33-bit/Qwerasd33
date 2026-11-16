import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketEngine } from './MarketEngine';

test('MarketEngine class initializes all requested products and pattern mappings', () => {
  const engine = new MarketEngine();
  const products = engine.getProducts();
  assert.equal(products.length, 14);

  const names = products.map((p) => p.name);
  for (const expected of [
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
  ]) {
    assert.ok(names.includes(expected), `Missing product: ${expected}`);
  }

  // Pattern 1 (Seasonal)
  assert.equal(engine.getProductPattern('firewood')?.effectivePattern, 'seasonal_monthly');
  // Pattern 2 (Mathematical / Prime-based)
  assert.equal(engine.getProductPattern('steel')?.effectivePattern, 'numeric_month_rule');
  assert.equal(engine.getProductPattern('steel')?.config.numericRule, 'prime_months');
  // Pattern 3 (Correlation-based)
  assert.equal(engine.getProductPattern('gas')?.effectivePattern, 'linked_commodity');
  assert.equal(engine.getProductPattern('gas')?.config.correlationDirection, 'inverse');
});

test('MarketEngine stateful workflow: trade, secret report, batch monthly edit, cash grant, advance, undo, serialize', () => {
  const engine = new MarketEngine(undefined, {
    startingCash: 6000,
    secretReportCost: 400,
    horizonMode: 'unlimited',
  });

  const tradeRes = engine.executeTrade('team_1', [{ commodityId: 'firewood', quantity: 5 }]);
  assert.equal(tradeRes.error, undefined);
  assert.equal(engine.getState().teams[0].holdings['firewood'], 5);

  const hintRes = engine.purchaseSecretReport('team_1', 'steel');
  assert.equal(hintRes.error, undefined);
  assert.ok(hintRes.hint?.text.length);

  const batchRes = engine.applyMonthlyPlanBatchOverrides([
    { commodityId: 'firewood', monthIndex: 0, price: 220 },
    { commodityId: 'dates', monthIndex: 1, price: 145 },
  ]);
  assert.equal(batchRes.error, undefined);
  assert.equal(batchRes.updatedCount, 2);
  assert.equal(engine.getPrice('firewood', 0), 220);

  engine.advanceMonth({ team_2: 3000 });
  assert.equal(engine.getState().currentMonthIndex, 1);
  assert.equal(engine.getState().teams[1].cash, 9000);
  assert.equal(engine.getVisibleHistory('firewood').length, 2);

  const undone = engine.undo();
  assert.ok(undone.restoredLabel);
  assert.equal(engine.getState().currentMonthIndex, 0);
  assert.equal(engine.getState().teams[1].cash, 6000);

  const json = engine.serialize();
  const restored = MarketEngine.deserialize(json);
  assert.equal(restored.error, undefined);
  assert.ok(restored.engine);
  assert.equal(restored.engine?.getPrice('firewood'), 220);
});

test('MarketEngine exposes quarterly seasonal events targeting a single commodity every 3 months with reason and 50% default impact', () => {
  const engine = new MarketEngine(undefined, {
    seasonalEventsEnabled: true,
  });

  assert.equal(engine.getActiveSeasonalEvent(), null);
  assert.equal(engine.getNextSeasonalEventMonth(), 3);
  assert.equal(engine.getPlayedSeasonalEvents().length, 0);

  engine.advanceMonth(); // Month 2
  assert.equal(engine.getActiveSeasonalEvent(), null);

  engine.advanceMonth(); // Month 3
  const ev = engine.getActiveSeasonalEvent();
  assert.ok(ev);
  assert.equal(ev.monthIndex, 2);
  assert.equal(ev.commodityId, 'livestock');
  assert.equal(ev.direction, 'down');
  assert.equal(ev.impactPct, 0.5);
  assert.ok(ev.reason.length > 10);
  assert.equal(engine.getPlayedSeasonalEvents().length, 1);
  assert.ok(engine.getProducts().some((p) => p.id === ev.commodityId));
});

