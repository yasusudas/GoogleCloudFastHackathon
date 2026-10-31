import { extractReceipt, ReceiptError } from './receipt.mjs';

const MAX_BODY = 4200000;
let active = 0;
let windowStarted = Date.now();
let calls = 0;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function handleReceiptRequest(request, extractor = extractReceipt) {
  try {
    if (request.method !== 'POST') throw new ReceiptError(405, 'METHOD_NOT_ALLOWED', 'POSTで送信してください。');
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) throw new ReceiptError(403, 'ORIGIN_DENIED', 'このアプリから画像を送信してください。');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new ReceiptError(415, 'CONTENT_TYPE', 'JSON形式で送信してください。');
    if (Number(request.headers.get('content-length')) > MAX_BODY) throw new ReceiptError(413, 'IMAGE_TOO_LARGE', '画像を小さくしてから再試行してください。');
    const reader = request.body?.getReader();
    if (!reader) throw new ReceiptError(400, 'INVALID_JSON', '画像データがありません。');
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new ReceiptError(413, 'IMAGE_TOO_LARGE', '画像を小さくしてから再試行してください。'); }
      chunks.push(Buffer.from(value));
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ReceiptError(400, 'INVALID_JSON', '画像データの形式を確認できませんでした。'); }
    if (Date.now() - windowStarted > 300000) { windowStarted = Date.now(); calls = 0; }
    if (active >= 2 || calls >= 30) throw new ReceiptError(429, 'RATE_LIMIT', '読み取りが混み合っています。少し待って再試行してください。');
    active += 1;
    calls += 1;
    try { return json(await extractor(input)); } finally { active -= 1; }
  } catch (error) {
    if (error instanceof ReceiptError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: '読み取りに失敗しました。時間をおいて再試行してください。' } }, 500);
  }
}
