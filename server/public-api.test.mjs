import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReceiptRequest } from './public-api.mjs';

test('公開用ハンドラーは同じAPI契約を維持する', async () => {
  const request = new Request('https://example.vercel.app/api/receipts/extract', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.vercel.app' }, body: '{"mimeType":"image/png","imageBase64":"test"}' });
  const response = await handleReceiptRequest(request, async input => ({ requiresConfirmation: true, received: input.mimeType }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { requiresConfirmation: true, received: 'image/png' });
});

test('公開APIは外部Origin・不正JSON・過大ボディを拒否する', async () => {
  const call = options => handleReceiptRequest(new Request('https://example.vercel.app/api/receipts/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', ...options }), () => assert.fail('must not call'));
  assert.equal((await call({ headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await call({ body: '{' })).status, 400);
  assert.equal((await call({ headers: { 'Content-Type': 'application/json', 'Content-Length': '5000000' } })).status, 413);
});
