import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleState, monthTotal, computeTotals, unitPriceReport, suggestions, familyAmount, draftFromApi, receiptIssues, migrateState, loadState } from './domain.js';

test('sample data uses neutral names', () => {
  const s = sampleState();
  assert.equal(s.householdName, '青葉家');
  assert.equal(s.members.find((m) => m.id === s.selfId).name, 'はると');
  assert.ok(!JSON.stringify(s).includes('しゅう') && !JSON.stringify(s).includes('山本家'));
});

test('legacy saved names are renamed; receipts and amounts are kept', () => {
  const legacy = sampleState();
  legacy.householdName = '山本家';
  legacy.members[0].name = 'しゅう';
  legacy.budget = 123456;
  const before = JSON.stringify(legacy.receipts);
  const { state, changed } = migrateState(legacy);
  assert.equal(changed, true);
  assert.equal(state.householdName, '青葉家');
  assert.equal(state.members[0].name, 'はると');
  assert.deepEqual(state.members.slice(1), legacy.members.slice(1));
  assert.equal(JSON.stringify(state.receipts), before);
  assert.equal(state.budget, 123456);
  assert.equal(monthTotal(state, '2026-10'), 86420);
});

test('user-chosen names are not touched', () => {
  const s = sampleState();
  s.householdName = '田中家';
  s.members[0].name = 'たろう';
  const { state, changed } = migrateState(s);
  assert.equal(changed, false);
  assert.equal(state.householdName, '田中家');
  assert.equal(state.members[0].name, 'たろう');
});

test('loadState migrates existing localStorage and writes it back', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const legacy = sampleState();
  legacy.householdName = '山本家';
  legacy.members[0].name = 'しゅう';
  legacy.receipts.push({ ...legacy.receipts[0], id: 'user-1', sample: false, source: 'manual' });
  store.set('receipt-kakeibo:v1', JSON.stringify(legacy));
  const { state, error } = loadState();
  assert.equal(error, null);
  assert.equal(state.householdName, '青葉家');
  assert.equal(state.members[0].name, 'はると');
  assert.equal(state.receipts.length, legacy.receipts.length);
  const saved = store.get('receipt-kakeibo:v1');
  assert.ok(!saved.includes('しゅう') && !saved.includes('山本家'));
  assert.ok(saved.includes('user-1'));
  delete globalThis.localStorage;
});

test('sample month totals are computed from receipts', () => {
  const s = sampleState();
  assert.equal(monthTotal(s, '2026-10'), 86420);
  assert.equal(monthTotal(s, '2026-09'), 91240);
});

test('private receipts never enter family totals', () => {
  const s = sampleState();
  const r = s.receipts[0];
  r.visibility = 'private';
  assert.equal(familyAmount(r, s.settings), 0);
});

test('discount and printed-total mismatch are kept', () => {
  const t = computeTotals({ items: [{ quantity: 1, unitPrice: 412, discount: 82 }], receiptDiscount: 0, additionalTax: 0, printedTotal: 340 });
  assert.equal(t.computed, 330);
  assert.equal(t.mismatch, true);
});

test('unit price report and history-based suggestions', () => {
  const s = sampleState();
  const u = unitPriceReport(s, '2026-10');
  assert.ok(u.rows.some((r) => r.name === '卵 Mサイズ' && r.saved > 0));
  const sg = suggestions(s, '2026-10-31');
  assert.ok(sg.some((x) => x.bestStore === '業務スーパー 福島店'));
});

test('API response converts to a draft that requires confirmation', () => {
  const d = draftFromApi({ model: 'gemini-3.8-flash', warnings: [], receipt: { storeName: '', purchasedAt: '2026-10-31', taxMode: 'inclusive', subtotal: null, receiptDiscount: 0, taxAmount: null, additionalTax: 0, total: 436,
    items: [{ id: 'a', originalName: 'X', normalizedName: 'X', category: 'food', quantity: 1, unitPrice: null, discount: 0, taxRate: 8, taxIncluded: true, comparisonQuantity: null, comparisonUnit: 'unknown', needsReview: true }] } }, 'me', 'family');
  const issues = receiptIssues(d);
  assert.ok(issues.some((i) => i.includes('店名')));
  assert.ok(issues.some((i) => i.includes('要確認')));
});
