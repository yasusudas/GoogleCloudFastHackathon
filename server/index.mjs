import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { archiveHealth, handleReceiptRequest } from './public-api.mjs';

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

export function createApiServer() {
  return createServer(async (request, response) => {
    try {
      const host = new URL(`http://${request.headers.host || 'invalid'}`).hostname;
      const local = ['localhost', '127.0.0.1', '[::1]'];
      if (!local.includes(host)) return send(response, 403, { error: { code: 'LOCAL_ONLY', message: 'このAPIはローカルで利用してください。' } });
      if (request.headers.origin) {
        let originHost;
        try { originHost = new URL(request.headers.origin).hostname; } catch { /* deny invalid Origin */ }
        if (!local.includes(originHost)) return send(response, 403, { error: { code: 'ORIGIN_DENIED', message: 'このAPIはローカルのアプリから利用してください。' } });
      }
      const path = new URL(request.url, 'http://localhost').pathname;
      let result;
      if (path === '/api/health' && request.method === 'GET') result = archiveHealth();
      else if (path === '/api/receipts/extract') result = handleReceiptRequest();
      else return send(response, 404, { error: { code: 'NOT_FOUND', message: 'APIが見つかりません。' } });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      send(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'リクエストを処理できませんでした。' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.API_PORT || 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
  const server = createApiServer();
  server.requestTimeout = 15000;
  server.listen(port, '127.0.0.1', () => console.log(`Archive API: http://127.0.0.1:${port} (AI extraction disabled)`));
}
