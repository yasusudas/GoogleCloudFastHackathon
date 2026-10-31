export function GET() {
  return Response.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || 'gemini-3.8-flash' }, { headers: { 'Cache-Control': 'no-store' } });
}
