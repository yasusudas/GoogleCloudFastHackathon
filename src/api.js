// Browser side of the receipt API. The Gemini key lives only in server/ (proxied via /api).
const MAX_BYTES = 6 * 1024 * 1024;

export async function health() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { ok: false, geminiConfigured: false };
    return await res.json();
  } catch {
    return { ok: false, geminiConfigured: false };
  }
}

// Downscale large photos to JPEG so they stay under the 6MB API limit.
async function toPayload(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2.5 * 1024 * 1024) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    file = new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
  }
  if (file.size > MAX_BYTES) throw new Error('画像を6MB以下にしてください。');
  const dataUrl = await new Promise((ok, ng) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = () => ng(new Error('画像を読み込めませんでした。'));
    fr.readAsDataURL(file);
  });
  return { mimeType: file.type, imageBase64: String(dataUrl).split(',')[1], preview: dataUrl };
}

export async function extractReceipt(file) {
  const { mimeType, imageBase64, preview } = await toPayload(file);
  let res;
  try {
    res = await fetch('/api/receipts/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mimeType, imageBase64 }),
    });
  } catch {
    throw new Error('読み取りサーバーに接続できませんでした。手入力で記録できます。');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.receipt) throw new Error(body?.error?.message || '読み取りに失敗しました。手入力で記録できます。');
  return { ...body, preview };
}
