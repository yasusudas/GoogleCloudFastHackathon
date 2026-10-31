import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { extractReceipt, MAX_IMAGE_BYTES, ReceiptError } from './receipt.mjs';

const MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024;

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new ReceiptError(415, 'CONTENT_TYPE', 'JSON形式で画像を送信してください。');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ReceiptError(413, 'IMAGE_TOO_LARGE', '画像を6MB以下にしてください。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ReceiptError(400, 'INVALID_JSON', '送信データの形式を確認できませんでした。'); }
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

export function createApiServer({ extractor = extractReceipt, configured = () => Boolean(process.env.GEMINI_API_KEY), now = Date.now } = {}) {
  let active = 0;
  const calls = [];
  return createServer(async (request, response) => {
    try {
      // This initial API is local-only, including when it is reached via a Vite proxy.
      const host = new URL(`http://${request.headers.host || 'invalid'}`).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new ReceiptError(403, 'LOCAL_ONLY', 'このAPIはローカルで利用してください。');
      if (request.headers.origin) {
        let originHost;
        try { originHost = new URL(request.headers.origin).hostname; } catch { throw new ReceiptError(403, 'ORIGIN_DENIED', '送信元を確認できませんでした。'); }
        if (!['localhost', '127.0.0.1', '[::1]'].includes(originHost)) throw new ReceiptError(403, 'ORIGIN_DENIED', 'このAPIはローカルのアプリから利用してください。');
      }
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/api/health' && request.method === 'GET') return send(response, 200, { ok: true, geminiConfigured: configured(), localOnly: true });
      if (path !== '/api/receipts/extract') return send(response, 404, { error: { code: 'NOT_FOUND', message: 'APIが見つかりません。' } });
      if (request.method !== 'POST') return send(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTで送信してください。' } });
      if (!configured()) throw new ReceiptError(503, 'API_NOT_CONFIGURED', 'Gemini接続が未設定です。手入力で記録できます。');
      const input = await readJson(request);
      const time = now();
      while (calls.length && calls[0] <= time - 300000) calls.shift();
      if (active >= 2 || calls.length >= 15) throw new ReceiptError(429, 'RATE_LIMIT', '読み取りが混み合っています。少し待って再試行してください。');
      calls.push(time);
      active += 1;
      try { send(response, 200, await extractor(input)); } finally { active -= 1; }
    } catch (error) {
      // Never log request data, credentials, upstream errors, or receipt contents.
      if (error instanceof ReceiptError) send(response, error.status, { error: { code: error.code, message: error.message } });
      else send(response, 500, { error: { code: 'INTERNAL_ERROR', message: '読み取り処理でエラーが発生しました。もう一度お試しください。' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.GEMINI_ENV_FILE) process.loadEnvFile(process.env.GEMINI_ENV_FILE);
  const port = Number(process.env.API_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
  const server = createApiServer();
  server.requestTimeout = 15000;
  server.listen(port, '127.0.0.1', () => console.log(`Receipt API: http://127.0.0.1:${port} (Gemini ${process.env.GEMINI_API_KEY ? 'configured' : 'not configured'})`));
}
