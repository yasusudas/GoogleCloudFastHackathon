import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createApiServer } from './index.mjs';

async function withServer(action) {
  const server = createApiServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('ローカルもAI停止状態を返す', () => withServer(async base => {
  const response = await fetch(base + '/api/health');
  assert.deepEqual(await response.json(), { ok: true, mode: 'archive', geminiConfigured: false, extractionEnabled: false });
  assert.equal(response.headers.get('cache-control'), 'no-store');
}));

test('外部ページやDNSリバインディングを引き続き拒否する', () => withServer(async base => {
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://example.org' } })).status, 403);
  const status = await new Promise((resolve, reject) => get(base + '/api/health', { headers: { Host: 'example.org' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(status, 403);
}));

test('ローカル経由でも画像を処理せず410を返す', () => withServer(async base => {
  for (const body of ['{}', '{', '{"mimeType":"image/png","imageBase64":"unused"}']) {
    const response = await fetch(base + '/api/receipts/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error.code, 'ARCHIVE_READ_ONLY');
  }
}));
