import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleState, monthTotal, computeTotals, unitPriceReport, suggestions, familyAmount, draftFromApi, receiptIssues } from './domain.js';

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
