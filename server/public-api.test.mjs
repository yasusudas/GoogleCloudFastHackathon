import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReceiptRequest } from './public-api.mjs';
import route from '../api/receipts/extract.js';
import { GET as health } from '../api/health.js';

const assertDisabled = async response => {
  assert.equal(response.status, 410);
  assert.equal((await response.json()).error.code, 'ARCHIVE_READ_ONLY');
  assert.equal(response.headers.get('cache-control'), 'no-store');
};

test('実際の公開ルートはキーが設定されても本文を読まず上流を呼ばない', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('archive must not call upstream'));
  const original = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key-must-remain-unused';
  t.after(() => { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original; });
  const request = new Proxy({}, { get() { assert.fail('archive must not inspect or consume the request'); } });
  await assertDisabled(route.fetch(request));
  assert.deepEqual(await health().json(), { ok: true, mode: 'archive', geminiConfigured: false, extractionEnabled: false });
});

test('メソッド・Origin・不正本文にかかわらず読み取りは停止', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'OPTIONS']) {
    for (const origin of [undefined, 'https://other.example', 'https://example.vercel.app']) {
      const request = new Request('https://example.vercel.app/api/receipts/extract', {
        method, headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: '{' }),
      });
      await assertDisabled(handleReceiptRequest(request));
    }
  }
});

test('停止APIへの連続リクエストは共通枠を消費せずヘルスチェックも継続', async () => {
  for (let i = 0; i < 35; i++) await assertDisabled(handleReceiptRequest());
  assert.equal(health().status, 200);
  assert.equal((await health().json()).extractionEnabled, false);
});
