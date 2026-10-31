import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createApiServer } from './index.mjs';

async function withServer(options, action) {
  const server = createApiServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('ヘルスチェックは設定有無だけを返す', () => withServer({ configured: () => true }, async base => {
  const response = await fetch(base + '/api/health');
  assert.deepEqual(await response.json(), { ok: true, geminiConfigured: true, localOnly: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
}));

test('外部ページやDNSリバインディングからの読み取りを拒否する', () => withServer({ configured: () => true }, async base => {
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://example.org' } })).status, 403);
  const status = await new Promise((resolve, reject) => get(base + '/api/health', { headers: { Host: 'example.org' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(status, 403);
}));

test('未設定のキー・不正JSONを明示してモデルを呼ばない', async () => {
  await withServer({ configured: () => false, extractor: () => assert.fail('must not call') }, async base => {
    const response = await fetch(base + '/api/receipts/extract', { method: 'POST' });
    assert.equal(response.status, 503);
  });
  await withServer({ configured: () => true, extractor: () => assert.fail('must not call') }, async base => {
    const response = await fetch(base + '/api/receipts/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400);
  });
});

test('短時間の連続リクエストに上限を設け、時間が経つと回復する', () => {
  let time = 1000;
  return withServer({ configured: () => true, now: () => time, extractor: async () => ({ requiresConfirmation: true }) }, async base => {
    const request = () => fetch(base + '/api/receipts/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    for (let index = 0; index < 15; index++) assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429);
    time += 300001;
    assert.equal((await request()).status, 200);
  });
});
