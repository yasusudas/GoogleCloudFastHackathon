// Data model, sample data, persistence and all money calculations (no UI).

export const CATEGORIES = { food: '食料品', daily: '日用品', dining: '外食', transport: '交通', personal: 'お小遣い', other: 'その他' };
export const UNITS = { piece: '個', g: 'g', ml: 'ml', pack: 'パック', unknown: '不明' };
const STORAGE_KEY = 'receipt-kakeibo:v1';
export const SAMPLE_HOUSEHOLD = 'サンプル家族';
export const SAMPLE_SELF = 'メンバーA';

export const yen = (n) => (n < 0 ? '−¥' : '¥') + Math.abs(Math.round(n)).toLocaleString('ja-JP');
export const ymOf = (date) => date.slice(0, 7);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export const monthLabel = (ym) => `${Number(ym.slice(5, 7))}月`;
export const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// ---- item / receipt math -------------------------------------------------
export function lineAmount(it) {
  if (it.unitPrice === null || it.unitPrice === undefined || it.unitPrice === '') return null;
  return Math.round(Number(it.quantity) * Number(it.unitPrice)) - Number(it.discount || 0);
}
export function computeTotals(r) {
  const lines = r.items.map(lineAmount);
  const unknownLines = lines.filter((v) => v === null).length;
  const subtotal = lines.reduce((s, v) => s + (v ?? 0), 0);
  const additionalTax = r.additionalTax ?? 0;
  const computed = subtotal - Number(r.receiptDiscount || 0) + additionalTax;
  const printed = r.printedTotal ?? null;
  return {
    subtotal, computed, printed, unknownLines,
    taxUnknown: r.additionalTax === null || r.taxMode === 'unknown',
    mismatch: printed !== null && unknownLines === 0 && printed !== computed,
    amount: printed ?? computed, // what was actually paid if printed total is known
  };
}
export function receiptIssues(r) {
  const t = computeTotals(r);
  const issues = [];
  if (!r.storeName.trim()) issues.push('店名を入力してください');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) issues.push('購入日を入力してください');
  if (r.items.length === 0) issues.push('品目を1件以上入力してください');
  const review = r.items.filter((i) => i.needsReview).length;
  if (review) issues.push(`要確認の品目が${review}件あります。タップして確認してください`);
  if (t.unknownLines) issues.push(`金額が不明な品目が${t.unknownLines}件あります`);
  if (r.additionalTax === null) issues.push('外税（合計に加算する税額）を確認してください。内税なら0です');
  return issues;
}

// ---- visibility -----------------------------------------------------------
// Family views never include private receipts; "お小遣い" lines are removed when the owner hides them.
export function familyAmount(r, settings) {
  if (r.visibility !== 'family') return 0;
  const t = computeTotals(r);
  if (!settings.hideAllowance) return t.amount;
  const hidden = r.items.filter((i) => i.category === 'personal').reduce((s, i) => s + (lineAmount(i) ?? 0), 0);
  return t.amount - hidden;
}
export function scopedReceipts(state, scope) {
  if (scope === 'me') return state.receipts.filter((r) => r.payerId === state.selfId);
  return state.receipts.filter((r) => r.visibility === 'family');
}
export function scopedAmount(r, state, scope) {
  return scope === 'me' ? computeTotals(r).amount : familyAmount(r, state.settings);
}
export function monthTotal(state, ym, scope = 'family') {
  return scopedReceipts(state, scope).filter((r) => ymOf(r.date) === ym).reduce((s, r) => s + scopedAmount(r, state, scope), 0);
}

// ---- unit price comparison ------------------------------------------------
// Only same normalized name AND same declared content (quantity + unit) are compared.
const norm = (s) => s.replace(/\s+/g, '').replace(/[？?]/g, '').toLowerCase();
export function comparisonKey(it) {
  if (!it.comparisonQuantity || !it.comparisonUnit || it.comparisonUnit === 'unknown') return null;
  return `${norm(it.name)}|${it.comparisonQuantity}${it.comparisonUnit}`;
}
export function effectiveUnitPrice(it) {
  const line = lineAmount(it);
  if (line === null || !it.quantity) return null;
  let per = line / Number(it.quantity);
  if (it.taxIncluded === false && it.taxRate) per *= 1 + Number(it.taxRate) / 100;
  return per;
}
function priceRecords(state, receipts) {
  const out = [];
  for (const r of receipts) for (const it of r.items) {
    if (state.settings.hideAllowance && it.category === 'personal') continue;
    const key = comparisonKey(it);
    const price = effectiveUnitPrice(it);
    if (!key || price === null || it.needsReview) continue;
    out.push({ key, name: it.name, price, qty: Number(it.quantity), store: r.storeName, date: r.date, payerId: r.payerId, category: it.category, sample: r.sample, it });
  }
  return out;
}
const wavg = (rows) => rows.reduce((s, x) => s + x.price * x.qty, 0) / rows.reduce((s, x) => s + x.qty, 0);

export function unitPriceReport(state, ym) {
  const fam = scopedReceipts(state, 'family');
  const prevMonths = [addMonths(ym, -3), addMonths(ym, -2), addMonths(ym, -1)];
  const cur = priceRecords(state, fam.filter((r) => ymOf(r.date) === ym));
  const base = priceRecords(state, fam.filter((r) => prevMonths.includes(ymOf(r.date))));
  const rows = [];
  for (const key of new Set(cur.map((x) => x.key))) {
    const c = cur.filter((x) => x.key === key);
    const b = base.filter((x) => x.key === key);
    if (!b.length) continue;
    const before = wavg(b), after = wavg(c);
    const qty = c.reduce((s, x) => s + x.qty, 0);
    const cheapest = [...c].sort((a, z) => a.price - z.price)[0];
    rows.push({ key, name: c[0].name, before, after, qty, saved: Math.round((before - after) * qty), pct: Math.round(((after - before) / before) * 100), store: cheapest.store });
  }
  rows.sort((a, z) => z.saved - a.saved);
  return { rows, net: rows.reduce((s, x) => s + x.saved, 0) };
}

// Alternatives come only from the family's own purchase history (no web prices).
export function suggestions(state, today = todayISO()) {
  const from = new Date(today); from.setDate(from.getDate() - 90);
  const fromISO = todayISO(from);
  let pool = state.receipts.filter((r) => r.date >= fromISO && r.date <= today && (r.visibility === 'family' || r.payerId === state.selfId));
  if (!state.settings.shareSuggestions) pool = pool.filter((r) => r.payerId === state.selfId);
  const recs = priceRecords(state, pool);
  const out = [];
  for (const key of new Set(recs.map((x) => x.key))) {
    const rows = recs.filter((x) => x.key === key).sort((a, z) => a.date.localeCompare(z.date));
    const byStore = {};
    for (const x of rows) (byStore[x.store] ||= []).push(x);
    const stores = Object.entries(byStore).map(([store, xs]) => ({ store, count: xs.length, latest: xs[xs.length - 1] }));
    if (stores.length < 2) continue;
    const usual = [...stores].sort((a, z) => z.count - a.count || z.latest.date.localeCompare(a.latest.date))[0];
    const best = [...stores].sort((a, z) => a.latest.price - z.latest.price)[0];
    if (best.store === usual.store || best.latest.price >= usual.latest.price) continue;
    const perMonth = rows.reduce((s, x) => s + x.qty, 0) / 3;
    const diff = Math.round(usual.latest.price - best.latest.price);
    out.push({
      key, name: rows[0].name, category: rows[0].category, perMonth, diff,
      monthly: Math.round(diff * perMonth), usual: usual.latest, best: best.latest, usualStore: usual.store, bestStore: best.store,
    });
  }
  return out.sort((a, z) => z.monthly - a.monthly);
}

// ---- sample data (clearly flagged; removable from 家族 > 設定) -------------
function item(name, unitPrice, opt = {}) {
  return { id: uid(), originalName: opt.raw ?? name, name, category: opt.cat ?? 'food', quantity: opt.q ?? 1, unitPrice, discount: opt.disc ?? 0,
    taxRate: opt.rate ?? 8, taxIncluded: true, comparisonQuantity: opt.cq ?? null, comparisonUnit: opt.cu ?? 'unknown', needsReview: false };
}
function receipt(date, storeName, payerId, items, extra = {}) {
  return { id: uid(), storeName, date, time: '', payerId, visibility: 'family', source: 'sample', sample: true, taxMode: 'inclusive',
    receiptDiscount: 0, additionalTax: 0, printedTotal: null, items, ...extra };
}
const egg = (p) => item('卵 Mサイズ', p, { cq: 10, cu: 'piece', raw: 'タマゴMS10' });
const milk = (p) => item('牛乳', p, { cq: 1000, cu: 'ml' });
const bread = (p) => item('食パン 6枚切り', p, { cq: 6, cu: 'piece' });
const soap = (p) => item('食器用洗剤', p, { cq: 240, cu: 'ml', cat: 'daily', rate: 10 });
const filler = (amount) => item('その他の食品・日用品（サンプル）', amount);

export function sampleState() {
  const R = [];
  const monthTargets = { '2026-05': 98100, '2026-06': 94300, '2026-07': 102200, '2026-08': 97200, '2026-09': 91240 };
  const payers = ['me', 'mom', 'dad'];
  for (const [ym, total] of Object.entries(monthTargets)) {
    const tracked = [];
    tracked.push(receipt(`${ym}-06`, 'ライフ 野田店', 'mom', [egg(258), milk(228), bread(178)]));
    tracked.push(receipt(`${ym}-20`, 'ライフ 野田店', 'mom', [egg(258), milk(228), milk(228)]));
    if (ym === '2026-09') tracked.push(receipt('2026-09-20', 'ライフ 野田店', 'me', [soap(248), egg(258)]));
    const used = tracked.reduce((s, r) => s + computeTotals(r).amount, 0);
    const rest = total - used;
    const parts = [0.4, 0.45, 0.15].map((f) => Math.round(rest * f));
    parts[2] = rest - parts[0] - parts[1];
    parts.forEach((amt, i) => tracked.push(receipt(`${ym}-${10 + i * 5}`, ['ライフ 野田店', '業務スーパー 福島店', 'ローソン 野田駅前店'][i], payers[i], [filler(amt)])));
    R.push(...tracked);
  }
  // October: per-member family totals メンバーA 32,180 / 母 41,060 / 父 13,180
  const oct = [
    receipt('2026-10-08', '業務スーパー 福島店', 'mom', [egg(198), milk(178), milk(178)]),
    receipt('2026-10-12', 'スギ薬局', 'dad', [soap(178)]),
    receipt('2026-10-17', '業務スーパー 福島店', 'mom', [egg(198), milk(178)]),
    receipt('2026-10-20', 'ライフ 野田店', 'me', [bread(148)]),
    receipt('2026-10-29', '業務スーパー 福島店', 'mom', [egg(198), milk(178), filler(3566)]),
    receipt('2026-10-29', 'ローソン 野田駅前店', 'dad', [filler(698)]),
    receipt('2026-10-30', 'ライフ 野田店', 'me', [
      item('卵 Mサイズ', 258, { cq: 10, cu: 'piece', raw: 'タマゴMS10' }), item('食パン 6枚切り', 178, { cq: 6, cu: 'piece', raw: 'チョウジュク6' }),
      item('鶏むね肉', 412, { cq: 300, cu: 'g', raw: 'トリムネ', disc: 82 }), item('乳酸菌飲料', 238, { raw: 'ニュウサン7P' }), filler(1380),
    ], { time: '18:42' }),
  ];
  const targets = { me: 32180, mom: 41060, dad: 13180 };
  for (const p of payers) {
    const used = oct.filter((r) => r.payerId === p).reduce((s, r) => s + computeTotals(r).amount, 0);
    oct.push(receipt('2026-10-03', ['ライフ 野田店', '業務スーパー 福島店', 'ローソン 野田駅前店'][payers.indexOf(p)], p, [filler(targets[p] - used)]));
  }
  R.push(...oct);
  return {
    version: 1, selfId: 'me', householdName: SAMPLE_HOUSEHOLD, budget: 100000,
    members: [
      { id: 'me', name: SAMPLE_SELF, tone: 'primary', role: 'admin', sample: false },
      { id: 'mom', name: '母', tone: 'tertiary', role: 'member', sample: true },
      { id: 'dad', name: '父', tone: 'caution', role: 'member', sample: true },
    ],
    settings: { defaultVisibility: 'family', hideAllowance: true, shareSuggestions: true },
    receipts: R, dismissed: [], planned: [],
  };
}

// ---- persistence ----------------------------------------------------------
// Earlier builds seeded real-looking names. Rename only those exact seeded values;
// names the user chose and all receipts/amounts are left untouched.
const LEGACY_HOUSEHOLD = '山本家';
const LEGACY_SELF = 'しゅう';
export function migrateState(s) {
  let changed = false;
  let next = s;
  if (s.householdName === LEGACY_HOUSEHOLD) { next = { ...next, householdName: SAMPLE_HOUSEHOLD }; changed = true; }
  if (Array.isArray(s.members) && s.members.some((m) => m.id === s.selfId && m.name === LEGACY_SELF)) {
    next = { ...next, members: s.members.map((m) => (m.id === s.selfId && m.name === LEGACY_SELF ? { ...m, name: SAMPLE_SELF } : m)) };
    changed = true;
  }
  return { state: next, changed };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: sampleState(), error: null };
    const s = JSON.parse(raw);
    if (s.version !== 1 || !Array.isArray(s.receipts)) throw new Error('bad');
    const { state, changed } = migrateState(s);
    // Best effort: if writing back fails, the renamed state is still shown and retried on the next save.
    if (changed) saveState(state);
    return { state, error: null };
  } catch {
    return { state: sampleState(), error: '保存データを読み込めませんでした。サンプルで表示しています。' };
  }
}
export function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return null; }
  catch (e) { return e && e.name === 'QuotaExceededError' ? '端末の保存容量が不足しています。保存できませんでした。' : 'この端末に保存できませんでした。もう一度お試しください。'; }
}

// ---- Gemini API response -> app draft ---------------------------------------
export function draftFromApi(res, payerId, visibility) {
  const r = res.receipt;
  return {
    id: uid(), storeName: r.storeName || '', date: r.purchasedAt || '', time: '', payerId, visibility,
    source: 'gemini', model: res.model, sample: false, taxMode: r.taxMode,
    receiptDiscount: r.receiptDiscount ?? 0, additionalTax: r.additionalTax, printedTotal: r.total,
    printedSubtotal: r.subtotal, printedTax: r.taxAmount, warnings: res.warnings || [],
    items: r.items.map((it) => ({
      id: it.id || uid(), originalName: it.originalName, name: it.normalizedName, category: it.category, quantity: it.quantity,
      unitPrice: it.unitPrice, discount: it.discount, taxRate: it.taxRate, taxIncluded: it.taxIncluded,
      comparisonQuantity: it.comparisonQuantity, comparisonUnit: it.comparisonUnit, needsReview: it.needsReview,
    })),
  };
}
export function emptyDraft(payerId, visibility) {
  return { id: uid(), storeName: '', date: todayISO(), time: '', payerId, visibility, source: 'manual', sample: false, taxMode: 'inclusive',
    receiptDiscount: 0, additionalTax: 0, printedTotal: null, warnings: [], items: [] };
}
export function newItem() {
  return { id: uid(), originalName: '', name: '', category: 'food', quantity: 1, unitPrice: null, discount: 0, taxRate: 8, taxIncluded: true, comparisonQuantity: null, comparisonUnit: 'unknown', needsReview: true };
}
