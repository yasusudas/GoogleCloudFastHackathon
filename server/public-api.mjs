const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export function archiveHealth() {
  return json({ ok: true, mode: 'archive', geminiConfigured: false, extractionEnabled: false });
}

// Permanent archive endpoint. Do not read the body, credentials, or import the
// historical extractor: even an accidentally configured key must remain unused.
export function handleReceiptRequest() {
  return json({ error: {
    code: 'ARCHIVE_READ_ONLY',
    message: 'アーカイブ版ではAI読み取りを停止しています。手入力で記録できます。',
  } }, 410);
}
