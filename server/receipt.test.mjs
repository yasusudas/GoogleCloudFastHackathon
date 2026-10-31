import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReceipt, validateImage, validateReceipt } from './receipt.mjs';

const png = { mimeType: 'image/png', imageBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64') };
const item = (overrides = {}) => ({ originalName: 'タマゴMS10', normalizedName: '卵 Mサイズ 10個', category: 'food', quantity: 1, unitPrice: 258, discount: 0, taxRate: 8, taxIncluded: true, comparisonQuantity: 10, comparisonUnit: 'piece', needsReview: false, ...overrides });
const raw = (overrides = {}) => ({ isReceipt: true, currency: 'JPY', storeName: 'テストスーパー', purchasedAt: '2026-10-31', taxMode: 'inclusive', items: [item()], subtotal: 258, receiptDiscount: 0, taxAmount: 19, additionalTax: 0, total: 258, warnings: [], ...overrides });
const generated = (value, finishReason = 'STOP') => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 });

test('内税は加算せず確認前の下書きとして返す', () => {
  const result = validateReceipt(raw());
  assert.equal(result.computedTotal, 258);
  assert.equal(result.receipt.taxAmount, 19);
  assert.equal(result.requiresConfirmation, true);
  assert.deepEqual(result.warnings, []);
});

test('商品値引き・全体値引き・外税をそれぞれ一度だけ計上する', () => {
  const result = validateReceipt(raw({ taxMode: 'mixed', items: [item({ quantity: 2, unitPrice: 200, discount: 40, taxIncluded: false }), item({ unitPrice: 100 })], receiptDiscount: 10, additionalTax: 28, total: 478 }));
  assert.equal(result.computedSubtotal, 460);
  assert.equal(result.computedTotal, 478);
  assert.deepEqual(result.warnings, []);
});

test('合計差異を補正で隠さず両方維持する', () => {
  const result = validateReceipt(raw({ total: 500 }));
  assert.equal(result.receipt.total, 500);
  assert.equal(result.computedTotal, 258);
  assert.match(result.warnings.join(''), /一致しません/);
});

test('不明な価格・税額・内容量を推定で埋めない', () => {
  const result = validateReceipt(raw({ purchasedAt: '', items: [item({ unitPrice: null, comparisonQuantity: null, comparisonUnit: 'unknown' })], additionalTax: null, total: null }));
  assert.equal(result.receipt.items[0].unitPrice, null);
  assert.equal(result.receipt.items[0].comparisonQuantity, null);
  assert.equal(result.receipt.items[0].needsReview, true);
  assert.equal(result.computedTotal, null);
  assert.match(result.warnings.join(''), /購入日/);
});

test('存在しない日付・NaN・文字列価格・負の値引きを拒否する', () => {
  for (const value of [raw({ purchasedAt: '2026-02-30' }), raw({ purchasedAt: '2026-99-99' }), raw({ items: [item({ quantity: NaN })] }), raw({ items: [item({ unitPrice: '258' })] }), raw({ receiptDiscount: -1 })]) {
    assert.throws(() => validateReceipt(value), error => error.code === 'INVALID_MODEL_OUTPUT');
  }
});

test('レシート以外と非対応通貨を家計データに変換しない', () => {
  assert.throws(() => validateReceipt(raw({ isReceipt: false })), error => error.code === 'NOT_A_RECEIPT');
  assert.throws(() => validateReceipt(raw({ currency: 'other' })), error => error.code === 'UNSUPPORTED_CURRENCY');
});

test('画像型・署名・base64・容量を検査する', () => {
  assert.deepEqual(validateImage(png), png);
  for (const value of [{ ...png, mimeType: 'text/html' }, { ...png, imageBase64: 'hello' }, { ...png, imageBase64: Buffer.from('not a PNG').toString('base64') }]) assert.throws(() => validateImage(value));
  assert.throws(() => validateImage({ ...png, imageBase64: 'A'.repeat(9 * 1024 * 1024) }), error => error.status === 413);
});

test('Gemini 3.8 Flashへサーバーからだけキーを送りJSONスキーマを指定する', async () => {
  let request;
  const result = await extractReceipt(png, { apiKey: 'test-secret', fetchImpl: async (url, options) => { request = { url, options }; return generated(raw()); } });
  assert.match(request.url, /\/gemini-3\.8-flash:generateContent$/);
  assert.equal(request.options.headers['x-goog-api-key'], 'test-secret');
  assert.equal(JSON.parse(request.options.body).generationConfig.responseMimeType, 'application/json');
  assert.equal(result.receipt.total, 258);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('上流の秘密を含みうるエラーメッセージを利用者へ転送しない', async () => {
  for (const status of [400, 403, 429, 500]) {
    await assert.rejects(extractReceipt(png, { apiKey: 'test-secret', fetchImpl: async () => new Response('test-secret internal detail', { status }) }), error => !error.message.includes('test-secret') && [429, 502, 503].includes(error.status));
  }
});

test('出力の途中終了を正常なレシートとして扱わない', async () => {
  await assert.rejects(extractReceipt(png, { apiKey: 'test-secret', fetchImpl: async () => generated(raw(), 'MAX_TOKENS') }), error => error.code === 'INCOMPLETE_EXTRACTION');
});
