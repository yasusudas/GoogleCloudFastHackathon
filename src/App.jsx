import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES, UNITS, yen, ymOf, todayISO, addMonths, monthLabel, shortDate, computeTotals, receiptIssues, lineAmount,
  monthTotal, scopedReceipts, scopedAmount, familyAmount, unitPriceReport, suggestions, loadState, saveState, sampleState,
  draftFromApi, emptyDraft, newItem,
} from './domain.js';
import { health, extractReceipt } from './api.js';

const Icon = ({ n, s, className = '' }) => <span aria-hidden="true" className={`ms ${s ? 's' + s : ''} ${className}`}>{n}</span>;
const Gemini = () => <span className="gemini"><Icon n="auto_awesome" s={16} /><span className="t">Gemini</span></span>;
const SourceBadge = ({ r }) => r.source === 'gemini' ? <Gemini />
  : <span className={`badge-plain label-m ${r.sample ? 'badge-caution' : ''}`}><Icon n={r.sample ? 'science' : 'edit_note'} s={16} />{r.sample ? 'サンプル' : '手入力'}</span>;
const WEEK = '日月火水木金土';
const dateJP = (d) => { const x = new Date(d + 'T00:00:00'); return Number.isNaN(x.getTime()) ? '日付未確認' : `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}（${WEEK[x.getDay()]}）`; };
const storeIcon = (name) => /ローソン|ファミ|セブン/.test(name) ? 'local_convenience_store' : /業務|スーパー/.test(name) ? 'shopping_cart' : /薬/.test(name) ? 'local_pharmacy' : 'storefront';
const itemIcon = (name) => /卵/.test(name) ? 'egg' : /牛乳|飲料/.test(name) ? 'local_drink' : /洗剤/.test(name) ? 'soap' : /パン/.test(name) ? 'bakery_dining' : 'shopping_basket';
const man = (v) => (v >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + '万' : v ? yen(v) : '—');

function useRoute() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const f = () => { setHash(location.hash.slice(1) || '/'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return hash;
}
const go = (path) => { location.hash = path; };

function Switch({ checked, onChange, label }) {
  return <label className="switch"><input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} /><span className="track"><span className="thumb" /></span></label>;
}

const NAV = [['/', 'home', 'ホーム'], ['/receipts', 'receipt_long', 'レシート'], ['/report', 'bar_chart', 'レポート'], ['/suggest', 'auto_awesome', '提案'], ['/family', 'group', '家族']];
function NavBar({ active }) {
  return <nav className="navbar" aria-label="メイン">{NAV.map(([p, i, l]) =>
    <a key={p} href={'#' + p} className="navitem" style={{ textDecoration: 'none' }} aria-current={active === p ? 'page' : undefined}>
      <span className="ind"><Icon n={i} /></span><span className="label-m">{l}</span></a>)}</nav>;
}

export default function App() {
  const route = useRoute();
  const [{ state: initial, error: loadErr }] = useState(loadState);
  const [state, setState] = useState(initial);
  const [snack, setSnack] = useState(loadErr);
  const [draft, setDraft] = useState(null);
  const [capture, setCapture] = useState(false);
  const [busy, setBusy] = useState(false);
  const [api, setApi] = useState({ ok: false, geminiConfigured: false, checked: false });
  useEffect(() => { health().then((h) => setApi({ ...h, checked: true })); }, []);
  useEffect(() => { if (!snack) return; const t = setTimeout(() => setSnack(null), 5000); return () => clearTimeout(t); }, [snack]);

  // Persist first; only update UI state if the device save succeeded.
  const commit = (next, okMsg) => {
    const err = saveState(next);
    if (err) { setSnack(err); return false; }
    setState(next); if (okMsg) setSnack(okMsg); return true;
  };
  const toast = setSnack;

  const startManual = () => { setCapture(false); setDraft({ ...emptyDraft(state.selfId, state.settings.defaultVisibility), preview: null }); go('/edit'); };
  const startScan = async (file) => {
    setCapture(false);
    if (!file) return;
    setBusy(true);
    try {
      const res = await extractReceipt(file);
      setDraft({ ...draftFromApi(res, state.selfId, state.settings.defaultVisibility), preview: res.preview });
      go('/edit');
    } catch (e) {
      setDraft({ ...emptyDraft(state.selfId, state.settings.defaultVisibility), preview: null, warnings: [`自動読み取りに失敗しました：${e.message}`] });
      go('/edit');
    } finally { setBusy(false); }
  };
  const editExisting = (r) => { setDraft(structuredClone({ ...r, preview: null })); go('/edit'); };

  const base = route.split('?')[0];
  let screen;
  if (base === '/edit' && draft) screen = <Editor draft={draft} setDraft={setDraft} state={state} commit={commit} toast={toast} onRetake={() => setCapture(true)} />;
  else if (base === '/receipts') screen = <Receipts state={state} onOpen={editExisting} />;
  else if (base === '/report') screen = <Report state={state} />;
  else if (base === '/suggest') screen = <Suggest state={state} commit={commit} />;
  else if (base === '/family') screen = <Family state={state} commit={commit} toast={toast} api={api} />;
  else screen = <Home state={state} onOpen={editExisting} />;
  const showNav = base !== '/edit' || !draft;

  return (
    <div className="app">
      {screen}
      {showNav && base === '/' && <button className="fab" onClick={() => setCapture(true)}><Icon n="photo_camera" /><span className="label-l">レシートを撮る</span></button>}
      {showNav && <NavBar active={NAV.some(([p]) => p === base) ? base : '/'} />}
      {capture && <CaptureSheet api={api} onClose={() => setCapture(false)} onFile={startScan} onManual={startManual} />}
      {busy && <div className="loading" role="status" aria-live="polite"><div className="spin" /><p className="title-m">Geminiで読み取り中…</p><p className="body-m var">読み取り後に内容を確認・修正してから保存します</p></div>}
      {snack && <div className="snackbar" role="status" aria-live="polite">{snack}</div>}
    </div>
  );
}

/* ---------------- capture ---------------- */
function CaptureSheet({ api, onClose, onFile, onManual }) {
  const cam = useRef(null), lib = useRef(null);
  const ready = api.ok && api.geminiConfigured;
  return (
    <div className="sheet" onClick={onClose}><div role="dialog" aria-modal="true" aria-label="レシートを記録" onClick={(e) => e.stopPropagation()}>
      <div className="handle" />
      <div className="col gap8">
        <p className="title-m" style={{ padding: '4px 0 8px' }}>レシートを記録</p>
        {!ready && api.checked && <div className="banner caution"><Icon n="info" /><p className="body-m">読み取りAPIに接続できません（{api.ok ? 'Gemini未設定' : 'サーバー未起動'}）。手入力で記録できます。</p></div>}
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files[0])} />
        <input ref={lib} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={(e) => onFile(e.target.files[0])} />
        <button className="listitem tap" disabled={!ready} style={{ opacity: ready ? 1 : .38 }} onClick={() => cam.current.click()}><span className="leading"><Icon n="photo_camera" /></span><span className="body-l grow">撮影して読み取る</span><Gemini /></button>
        <button className="listitem tap" disabled={!ready} style={{ opacity: ready ? 1 : .38 }} onClick={() => lib.current.click()}><span className="leading"><Icon n="image" /></span><span className="body-l grow">画像を選んで読み取る</span></button>
        <button className="listitem tap" onClick={onManual}><span className="leading"><Icon n="edit_note" /></span><span className="body-l grow">手入力する</span></button>
      </div>
    </div></div>
  );
}

/* ---------------- 01 home ---------------- */
function Home({ state, onOpen }) {
  const [scope, setScope] = useState('family');
  const today = todayISO();
  const ym = ymOf(today);
  const total = monthTotal(state, ym, scope);
  const prev = monthTotal(state, addMonths(ym, -1), scope);
  const daysLeft = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate() - Number(today.slice(8, 10)) + 1;
  const pct = Math.min(100, (total / state.budget) * 100);
  const unit = unitPriceReport(state, ym);
  const sugg = suggestions(state, today).filter((s) => !state.dismissed.includes(s.key))[0];
  const recent = [...scopedReceipts(state, scope === 'me' ? 'me' : 'family'), ...state.receipts.filter((r) => r.visibility === 'private' && r.payerId === state.selfId && scope === 'family')]
    .sort((a, z) => (z.date + z.time).localeCompare(a.date + a.time)).slice(0, 3);
  const name = (id) => state.members.find((m) => m.id === id)?.name ?? '不明';
  const d = new Date();
  const saved = prev - total;
  const top = unit.rows.filter((r) => r.saved > 0).slice(0, 2).map((r) => r.name);
  return (<>
    <header className="topbar home">
      <div className="grow col">
        <p className="body-m var">{d.getMonth() + 1}月{d.getDate()}日（{WEEK[d.getDay()]}）</p>
        <h1 className="headline-s ellipsis">{state.householdName}の家計簿</h1>
      </div>
      <a href="#/family" className="row" aria-label="家族メンバー" style={{ textDecoration: 'none', paddingRight: 8 }}>
        {state.members.slice(0, 3).map((m) => <span key={m.id} className={`avatar tone-${m.tone}`}>{m.name[0]}</span>)}
      </a>
    </header>
    <main className="content with-nav">
      <section className="card r28 pad20 col gap8" aria-label="今月の支出">
        <div className="row between var">
          <h2 className="title-m" style={{ margin: 0 }}>{monthLabel(ym)}の支出</h2>
          <label className="chipsel"><span className="label-m">{scope === 'family' ? '家族全体' : '自分'}</span><Icon n="arrow_drop_down" s={18} />
            <select aria-label="集計の範囲" value={scope} onChange={(e) => setScope(e.target.value)}><option value="family">家族全体</option><option value="me">自分（非公開含む）</option></select></label>
        </div>
        <p className="num-display">{yen(total)}</p>
        <div className={`progress ${total > state.budget ? 'over' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="予算の消化率"><div style={{ width: pct + '%' }} /></div>
        <div className="row between body-m var"><span>予算 {yen(state.budget)}</span>
          <span className={total > state.budget ? 'err' : ''}>{total > state.budget ? `予算超過 ${yen(total - state.budget)}` : `残り ${yen(state.budget - total)} ・ あと${daysLeft}日`}</span></div>
      </section>
      <a href="#/report" className="card tertcard col gap8" style={{ borderRadius: 24, padding: '16px 20px', textDecoration: 'none' }}>
        <span className="badge-plain label-m" style={{ background: 'var(--surface-container-lowest)' }}><Icon n="calculate" s={16} />履歴から計算</span>
        <div className="row gap4 baseline" style={{ flexWrap: 'wrap' }}>
          <span className="title-m">先月より</span><span className="num-headline">{yen(Math.abs(saved))}</span><span className="title-m">{saved >= 0 ? '節約できました' : '増えました'}</span>
        </div>
        <p className="body-m">{top.length ? `${top.join('と')}を前3か月より安い単価で買えたのが効いています。` : '同じ品目の単価比較はまだありません。'}</p>
        <span className="row gap4 tert label-l">節約レポートを見る<Icon n="arrow_forward" s={18} /></span>
      </a>
      {sugg && <a href="#/suggest" className="card r20 outlined row gap12" style={{ padding: '12px 12px 12px 16px', textDecoration: 'none', color: 'inherit' }}>
        <span className="leading tone-secondary" style={{ borderRadius: 12 }}><Icon n={itemIcon(sugg.name)} /></span>
        <span className="grow col gap2"><span className="label-l">{sugg.name.split(' ')[0]}は{sugg.bestStore.split(' ')[0]}が {yen(sugg.diff)} 安い</span><span className="body-s var">家族の購入履歴より（{shortDate(sugg.best.date)}）</span></span>
        <Icon n="chevron_right" className="var" />
      </a>}
      <div className="section-h"><h2 className="title-m" style={{ margin: 0 }}>最近のレシート</h2><a href="#/receipts" className="label-l prim" style={{ textDecoration: 'none' }}>すべて表示</a></div>
      <div className="card py4">{recent.length ? recent.map((r) => <ReceiptRow key={r.id} r={r} state={state} scope={scope} onOpen={onOpen} name={name} />)
        : <p className="body-m var" style={{ padding: 16 }}>まだレシートがありません。</p>}</div>
    </main>
  </>);
}

function ReceiptRow({ r, state, scope = 'family', onOpen, name }) {
  const amt = r.visibility === 'private' ? computeTotals(r).amount : scopedAmount(r, state, scope);
  return (
    <button className="listitem" onClick={() => onOpen(r)}>
      <span className="leading"><Icon n={storeIcon(r.storeName)} /></span>
      <span className="grow col gap2" style={{ overflow: 'hidden' }}>
        <span className="body-l ellipsis">{r.storeName || '店名未入力'}</span>
        <span className="body-m var ellipsis">{shortDate(r.date)} · {name(r.payerId)}{r.visibility === 'private' ? ' · 非公開' : ''}{r.sample ? ' · サンプル' : ''}</span>
      </span>
      <span className="num-title">{yen(amt)}</span>
    </button>
  );
}

/* ---------------- receipts list (extra state) ---------------- */
function Receipts({ state, onOpen }) {
  const [filter, setFilter] = useState('all');
  const name = (id) => state.members.find((m) => m.id === id)?.name ?? '不明';
  const visible = state.receipts.filter((r) => r.visibility === 'family' || r.payerId === state.selfId);
  const list = visible.filter((r) => filter === 'all' || (filter === 'me' ? r.payerId === state.selfId : filter === 'private' ? r.visibility === 'private' : r.source !== 'sample' && !r.sample))
    .sort((a, z) => (z.date + z.time).localeCompare(a.date + a.time));
  const months = [...new Set(list.map((r) => ymOf(r.date)))];
  return (<>
    <header className="topbar"><h1 className="title-l">レシート</h1></header>
    <div className="chips" role="radiogroup" aria-label="絞り込み" style={{ padding: '4px 16px 8px' }}>
      {[['all', 'すべて'], ['me', '自分'], ['private', '非公開'], ['real', '記録済み']].map(([k, l]) =>
        <button key={k} className="chip label-l" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>{filter === k && <Icon n="check" s={18} />}{l}</button>)}
    </div>
    <main className="content with-nav">
      {months.length === 0 && <p className="body-m var" style={{ padding: 8 }}>該当するレシートはありません。</p>}
      {months.map((m) => <section key={m} className="col gap8">
        <h2 className="title-m" style={{ margin: 0, padding: '4px 4px 0' }}>{m.slice(0, 4)}年{monthLabel(m)}</h2>
        <div className="card py4">{list.filter((r) => ymOf(r.date) === m).map((r) => <ReceiptRow key={r.id} r={r} state={state} onOpen={onOpen} name={name} />)}</div>
      </section>)}
    </main>
  </>);
}

/* ---------------- 02 receipt review / edit ---------------- */
function Editor({ draft, setDraft, state, commit, toast, onRetake }) {
  const [editing, setEditing] = useState(null);
  const [head, setHead] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [errors, setErrors] = useState([]);
  const existing = state.receipts.some((r) => r.id === draft.id);
  const t = computeTotals(draft);
  const review = draft.items.filter((i) => i.needsReview).length;
  const shown = expanded ? draft.items : draft.items.slice(0, 5);
  const set = (patch) => setDraft({ ...draft, ...patch });
  const dup = !existing && state.receipts.find((r) => r.storeName === draft.storeName && r.date === draft.date && computeTotals(r).amount === t.amount);

  const save = () => {
    const issues = receiptIssues(draft);
    setErrors(issues);
    if (issues.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const { preview, warnings, ...clean } = draft;
    const receipts = existing ? state.receipts.map((r) => (r.id === draft.id ? { ...clean, sample: false } : r)) : [...state.receipts, { ...clean, sample: false }];
    if (commit({ ...state, receipts }, existing ? '変更を保存しました' : '家計簿に保存しました')) { setDraft(null); go(existing ? '/receipts' : '/'); }
  };
  const remove = () => {
    if (!confirm('このレシートを削除しますか？')) return;
    if (commit({ ...state, receipts: state.receipts.filter((r) => r.id !== draft.id) }, '削除しました')) { setDraft(null); go('/receipts'); }
  };
  const close = () => { if (existing || confirm('入力中の内容を破棄して閉じますか？')) { setDraft(null); history.length > 1 ? history.back() : go('/'); } };
  const title = draft.source === 'gemini' ? '読み取り結果' : existing ? 'レシートの編集' : 'レシートを入力';

  return (<>
    <header className="topbar back">
      <button className="iconbtn" style={{ color: 'var(--on-surface)' }} aria-label="閉じる" onClick={close}><Icon n="close" /></button>
      <h1 className="title-l">{title}</h1>
      {existing && <button className="iconbtn" aria-label="このレシートを削除" onClick={remove}><Icon n="delete" /></button>}
    </header>
    <main className="content with-action">
      <button className="card pad16 row gap16" style={{ textAlign: 'left' }} onClick={() => setHead(true)} aria-label="店名・日付・合計を編集">
        <span className="thumb">{draft.preview ? <img src={draft.preview} alt="撮影したレシート" /> : <Icon n="receipt_long" s={32} />}</span>
        <span className="grow col gap4">
          <SourceBadge r={draft} />
          <span className={`title-l ellipsis ${draft.storeName ? '' : 'err'}`}>{draft.storeName || '店名を入力'}</span>
          <span className={`body-m ${draft.date ? 'var' : 'err'}`}>{draft.date ? dateJP(draft.date) : '購入日を入力'}{draft.time ? ' ' + draft.time : ''}</span>
          <span className="body-m var">{draft.source === 'gemini' ? `${draft.items.length}品目を読み取りました` : `${draft.items.length}品目`}</span>
        </span>
        <Icon n="edit" s={20} className="var" />
      </button>

      <div className="col gap8" style={{ padding: '4px 0 0 4px' }}>
        <h2 className="title-m" style={{ margin: 0 }} id="payer-l">支払った人</h2>
        <div className="chips" role="radiogroup" aria-labelledby="payer-l">{state.members.map((m) =>
          <button key={m.id} className="chip label-l" role="radio" aria-checked={draft.payerId === m.id} onClick={() => set({ payerId: m.id })}>{draft.payerId === m.id && <Icon n="check" s={18} />}{m.name}</button>)}</div>
      </div>

      {errors.length > 0 && <div className="banner error" role="alert"><Icon n="error" /><div className="col gap2">{errors.map((e) => <p key={e} className="body-m">{e}</p>)}</div></div>}
      {review > 0 && <div className="banner caution"><Icon n="help" /><p className="body-m grow">{review}件、読み取りに自信がない項目があります。タップして確認してください。</p></div>}
      {(draft.warnings || []).filter((w) => !/要確認|自信/.test(w)).map((w) => <div key={w} className="banner info"><Icon n="info" /><p className="body-m grow">{w}</p></div>)}
      {t.mismatch && <div className="banner caution"><Icon n="calculate" /><p className="body-m grow">明細からの計算 {yen(t.computed)} とレシート記載の合計 {yen(t.printed)} が一致しません（差額 {yen(t.printed - t.computed)}）。値引き・税・品目を確認してください。</p></div>}
      {dup && <div className="banner caution"><Icon n="content_copy" /><p className="body-m grow">同じ店・日付・合計のレシートが保存済みです。二重登録に注意してください。</p></div>}

      <section className="card py8" aria-label="品目">
        {shown.map((it) => {
          const line = lineAmount(it);
          return (
            <button key={it.id} className={`itemrow ${it.needsReview ? 'review' : ''}`} onClick={() => setEditing(it)}>
              <span className="grow col gap2" style={{ overflow: 'hidden' }}>
                <span className="row gap6"><span className="body-l ellipsis">{it.name || '品名未入力'}{it.comparisonQuantity && it.comparisonUnit !== 'unknown' && !it.name.includes(String(it.comparisonQuantity)) ? ` ${it.comparisonQuantity}${UNITS[it.comparisonUnit]}` : ''}{it.quantity !== 1 ? ` ×${it.quantity}` : ''}</span>
                  {it.needsReview && <span className="tag caution label-m" style={{ background: 'var(--surface-container-lowest)', gap: 2, padding: '2px 8px 2px 6px' }}><Icon n="help" s={14} />要確認</span>}</span>
                {it.originalName && <span className="body-s var ellipsis">原文：{it.originalName}</span>}
                {it.discount > 0 && <span className="body-s tert">値引き −{yen(it.discount).slice(1)}（{yen(Math.round(it.quantity * it.unitPrice))}から）</span>}
              </span>
              <span className="num-title">{line === null ? '¥ ?' : yen(line)}</span>
              {it.needsReview && <Icon n="edit" s={20} />}
            </button>
          );
        })}
        {draft.receiptDiscount > 0 && <div className="itemrow"><span className="grow body-l tert">値引き（レシート全体）</span><span className="num-title tert">−{yen(draft.receiptDiscount).slice(1)}</span></div>}
        {draft.additionalTax > 0 && <div className="itemrow"><span className="grow body-l">外税</span><span className="num-title">{yen(draft.additionalTax)}</span></div>}
        {draft.items.length > 5 && <button className="row gap4 prim label-l" style={{ padding: '10px 16px 6px' }} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? '折りたたむ' : `他${draft.items.length - 5}品目を表示`}<Icon n={expanded ? 'expand_less' : 'expand_more'} s={18} /></button>}
        <button className="row gap4 prim label-l" style={{ padding: '10px 16px 6px' }} onClick={() => setEditing(newItem())}><Icon n="add" s={18} />品目を追加</button>
        <div className="divider" style={{ marginTop: 8 }} />
        <div className="row between" style={{ padding: '12px 16px 8px' }}>
          <span className="title-m">合計（税込）</span>
          <span className="num-headline">{t.unknownLines ? '確認中' : yen(t.amount)}</span>
        </div>
        {t.printed !== null && <p className="body-s var" style={{ padding: '0 16px 8px', textAlign: 'right' }}>レシート記載 {yen(t.printed)} ・ 明細から計算 {t.unknownLines ? '金額不明あり' : yen(t.computed)}</p>}
      </section>

      <div className="card r20 row gap16" style={{ padding: '12px 16px' }}>
        <Icon n={draft.visibility === 'family' ? 'group' : 'lock'} className="var" />
        <span className="grow col gap2"><span className="body-l">家族に公開</span><span className="body-s var">オフにすると自分だけの記録になります</span></span>
        <Switch label="家族に公開" checked={draft.visibility === 'family'} onChange={(v) => set({ visibility: v ? 'family' : 'private' })} />
      </div>
    </main>
    <div className="actionbar">
      {draft.source === 'gemini' ? <button className="btn outlined" onClick={onRetake}><Icon n="photo_camera" s={18} />撮り直す</button>
        : <button className="btn outlined" onClick={() => setEditing(newItem())}><Icon n="add" s={18} />品目</button>}
      <button className="btn filled grow" onClick={save}><Icon n="check" s={18} />{existing ? '変更を保存' : '家計簿に保存'}</button>
    </div>
    {editing && <ItemSheet item={editing} onClose={() => setEditing(null)}
      onSave={(it) => { const exists = draft.items.some((x) => x.id === it.id); set({ items: exists ? draft.items.map((x) => (x.id === it.id ? it : x)) : [...draft.items, it] }); setEditing(null); setErrors([]); }}
      onDelete={(id) => { set({ items: draft.items.filter((x) => x.id !== id) }); setEditing(null); }} />}
    {head && <HeadSheet draft={draft} onClose={() => setHead(false)} onSave={(p) => { set(p); setHead(false); }} />}
  </>);
}

const toInt = (v) => (v === '' || v === null || v === undefined ? null : Math.round(Number(v)));
function ItemSheet({ item, onClose, onSave, onDelete }) {
  const [f, setF] = useState({ ...item, unitPrice: item.unitPrice ?? '', comparisonQuantity: item.comparisonQuantity ?? '' });
  const [err, setErr] = useState('');
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    const q = Number(f.quantity), p = toInt(f.unitPrice), d = toInt(f.discount) ?? 0;
    if (!f.name.trim()) return setErr('品名を入力してください');
    if (!(q > 0)) return setErr('数量は0より大きい数にしてください');
    if (p === null || p < 0) return setErr('単価を入力してください（不明な場合はレシートを確認）');
    if (d < 0 || d > Math.round(q * p)) return setErr('値引きは0円以上、商品の金額以下にしてください');
    onSave({ ...f, name: f.name.trim(), quantity: q, unitPrice: p, discount: d, taxRate: f.taxRate === '' || f.taxRate === null ? null : Number(f.taxRate),
      taxIncluded: f.taxIncluded === 'null' ? null : f.taxIncluded === true || f.taxIncluded === 'true',
      comparisonQuantity: f.comparisonQuantity === '' ? null : Number(f.comparisonQuantity), comparisonUnit: f.comparisonQuantity === '' ? 'unknown' : f.comparisonUnit, needsReview: false });
  };
  return (
    <div className="sheet" onClick={onClose}><form role="dialog" aria-modal="true" aria-label="品目を確認・修正" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: '100%', maxWidth: 480, maxHeight: '90dvh', overflow: 'auto', background: 'var(--surface-container-lowest)', borderRadius: '28px 28px 0 0', padding: '12px 20px calc(20px + env(safe-area-inset-bottom))' }}>
      <div className="handle" />
      <div className="col gap12">
        <p className="title-m">品目を確認・修正</p>
        {item.originalName && <p className="body-m var">原文：{item.originalName}</p>}
        <label className="field"><span className="label-l">品名</span><input value={f.name} onChange={up('name')} autoFocus enterKeyHint="next" /></label>
        <div className="grid2">
          <label className="field"><span className="label-l">単価（円）</span><input inputMode="numeric" pattern="[0-9]*" value={f.unitPrice} onChange={up('unitPrice')} /></label>
          <label className="field"><span className="label-l">数量</span><input inputMode="decimal" value={f.quantity} onChange={up('quantity')} /></label>
          <label className="field"><span className="label-l">値引き（円）</span><input inputMode="numeric" pattern="[0-9]*" value={f.discount} onChange={up('discount')} /></label>
          <label className="field"><span className="label-l">カテゴリ</span><select value={f.category} onChange={up('category')}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span className="label-l">価格の表示</span><select value={String(f.taxIncluded)} onChange={up('taxIncluded')}><option value="true">税込</option><option value="false">税抜</option><option value="null">不明</option></select></label>
          <label className="field"><span className="label-l">税率</span><select value={f.taxRate ?? ''} onChange={up('taxRate')}><option value="8">8%</option><option value="10">10%</option><option value="">不明</option></select></label>
          <label className="field"><span className="label-l">内容量</span><input inputMode="decimal" placeholder="例：10" value={f.comparisonQuantity} onChange={up('comparisonQuantity')} /></label>
          <label className="field"><span className="label-l">単位</span><select value={f.comparisonUnit} onChange={up('comparisonUnit')}>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <p className="body-s var">単価の比較は、同じ品名・同じ内容量どうしだけで行います。</p>
        {err && <p className="body-m err" role="alert">{err}</p>}
        <div className="row gap8" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn text" onClick={() => onDelete(item.id)}>削除</button>
          <button type="button" className="btn text" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn filled"><Icon n="check" s={18} />確認済みにする</button>
        </div>
      </div>
    </form></div>
  );
}

function HeadSheet({ draft, onClose, onSave }) {
  const [f, setF] = useState({ storeName: draft.storeName, date: draft.date, time: draft.time || '', printedTotal: draft.printedTotal ?? '', additionalTax: draft.additionalTax ?? '', receiptDiscount: draft.receiptDiscount ?? 0 });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="sheet" onClick={onClose}><form role="dialog" aria-modal="true" aria-label="レシート情報" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave({ storeName: f.storeName.trim(), date: f.date, time: f.time, printedTotal: toInt(f.printedTotal), additionalTax: toInt(f.additionalTax), receiptDiscount: toInt(f.receiptDiscount) ?? 0 }); }}
      style={{ width: '100%', maxWidth: 480, maxHeight: '90dvh', overflow: 'auto', background: 'var(--surface-container-lowest)', borderRadius: '28px 28px 0 0', padding: '12px 20px calc(20px + env(safe-area-inset-bottom))' }}>
      <div className="handle" />
      <div className="col gap12">
        <p className="title-m">レシート情報</p>
        <label className="field"><span className="label-l">店名</span><input value={f.storeName} onChange={up('storeName')} required /></label>
        <div className="grid2">
          <label className="field"><span className="label-l">購入日</span><input type="date" value={f.date} onChange={up('date')} required /></label>
          <label className="field"><span className="label-l">時刻</span><input type="time" value={f.time} onChange={up('time')} /></label>
          <label className="field"><span className="label-l">レシート記載の合計</span><input inputMode="numeric" pattern="[0-9]*" placeholder="未入力" value={f.printedTotal} onChange={up('printedTotal')} /></label>
          <label className="field"><span className="label-l">外税（加算分）</span><input inputMode="numeric" pattern="[0-9]*" placeholder="内税なら0" value={f.additionalTax} onChange={up('additionalTax')} /></label>
          <label className="field"><span className="label-l">全体の値引き</span><input inputMode="numeric" pattern="[0-9]*" value={f.receiptDiscount} onChange={up('receiptDiscount')} /></label>
        </div>
        <div className="row gap8" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn text" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn filled"><Icon n="check" s={18} />反映</button>
        </div>
      </div>
    </form></div>
  );
}

/* ---------------- 03 report ---------------- */
function Report({ state }) {
  const nowYm = ymOf(todayISO());
  const [ym, setYm] = useState(nowYm);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5));
  const totals = months.map((m) => monthTotal(state, m));
  const cur = totals[5], prev = totals[4];
  const withData = totals.filter((v) => v > 0);
  const avg = withData.length ? Math.round(withData.reduce((s, v) => s + v, 0) / withData.length) : 0;
  const max = Math.max(...totals, 1);
  const unit = unitPriceReport(state, ym);
  const diff = prev - cur;
  const selectable = Array.from({ length: 12 }, (_, i) => addMonths(nowYm, -i));
  const lowest = cur > 0 && withData.length >= 3 && cur === Math.min(...withData);
  const annual = Math.round((unit.net * 12) / 100) * 100;
  return (<>
    <header className="topbar" style={{ paddingRight: 12 }}>
      <h1 className="title-l">節約レポート</h1>
      <label className="chipsel outlined"><span className="label-l">{ym.slice(0, 4)}年{monthLabel(ym)}</span><Icon n="arrow_drop_down" s={18} />
        <select aria-label="対象の月" value={ym} onChange={(e) => setYm(e.target.value)}>{selectable.map((m) => <option key={m} value={m}>{m.slice(0, 4)}年{monthLabel(m)}</option>)}</select></label>
    </header>
    <main className="content with-nav">
      <section className="card r28 tertcard col gap8" style={{ padding: '16px 20px 20px' }}>
        <span className="badge-plain label-m"><Icon n="calculate" s={16} />履歴から計算</span>
        <h2 className="title-m" style={{ margin: 0 }}>{monthLabel(ym)}の{diff >= 0 ? '節約額' : '支出の増加'}</h2>
        <p className="num-display">{yen(Math.abs(diff))}</p>
        <div className="row gap8" style={{ alignItems: 'stretch' }}>
          <div className="card grow col gap2" style={{ borderRadius: 16, padding: '10px 12px' }}>
            <span className="label-m var">総額（先月比）</span>
            <span className={`num-title ${diff >= 0 ? 'tert' : 'err'}`}>{diff >= 0 ? '−' : '+'}{yen(Math.abs(diff)).replace('−', '')}</span>
            <span className="body-s var">{yen(prev)} → {yen(cur)}</span>
          </div>
          <div className="card grow col gap2" style={{ borderRadius: 16, padding: '10px 12px' }}>
            <span className="label-m var">単価の改善</span>
            <span className={`num-title ${unit.net >= 0 ? 'tert' : 'err'}`}>{unit.net >= 0 ? '−' : '+'}{yen(Math.abs(unit.net)).replace('−', '')}</span>
            <span className="body-s var">同じ品目・同じ容量を前3か月平均と比較（{unit.rows.length}品目）</span>
          </div>
        </div>
        <p className="body-m">
          {lowest ? 'ここ半年でいちばん支出が少ない月です。' : ''}
          {diff < 0 && unit.net > 0 ? '総額は増えましたが、単価は下がっています。' : ''}
          {unit.net > 0 ? `単価の改善（月${yen(unit.net)}）が12か月続いた場合、年間で約${yen(annual)}の試算です（購入量・価格が変わらない前提）。` : '単価の改善はまだ計算できません。'}
        </p>
      </section>
      <section className="card col gap16" style={{ padding: '16px 20px' }}>
        <div className="row between"><h2 className="title-m" style={{ margin: 0 }}>月別の支出</h2><span className="body-m var">平均 {yen(avg)}</span></div>
        <div className="bars">{months.map((m, i) => (
          <button key={m} className="bar" aria-pressed={m === ym} onClick={() => setYm(m)} aria-label={`${monthLabel(m)} ${totals[i].toLocaleString()}円`}>
            <span className={`num-label ${m === ym ? 'prim' : 'var'}`}>{man(totals[i])}</span>
            <span className="rect" style={{ height: Math.max(2, Math.round((totals[i] / max) * 110)) }} />
            <span className="label-m" style={{ color: m === ym ? 'var(--on-surface)' : 'var(--on-surface-variant)' }}>{monthLabel(m)}</span>
          </button>))}
        </div>
      </section>
      <h2 className="title-m" style={{ margin: 0, padding: '4px 0 0 4px' }}>単価が下がった品目</h2>
      <div className="card py4">
        {unit.rows.filter((r) => r.saved > 0).length === 0 && <p className="body-m var" style={{ padding: 16 }}>前3か月と比べられる品目はまだありません。</p>}
        {unit.rows.filter((r) => r.saved > 0).map((r) => (
          <div key={r.key} className="listitem">
            <span className="leading tone-tertiary"><Icon n="trending_down" /></span>
            <span className="grow col gap2"><span className="body-l ellipsis">{r.name}</span><span className="body-m var ellipsis">{yen(Math.round(r.before))} → {yen(Math.round(r.after))} ・ {r.store}</span></span>
            <span className="num-title tert">{r.pct}%</span>
          </div>))}
      </div>
      <p className="body-s var" style={{ padding: '0 4px' }}>家族に公開されたレシートのみ集計。金額は1包装あたりの税込単価（値引き後）で、前3か月の平均と今月の平均を比べています。</p>
    </main>
  </>);
}

/* ---------------- 04 suggestions ---------------- */
function Suggest({ state, commit }) {
  const [filter, setFilter] = useState('all');
  const name = (id) => (id === state.selfId ? 'あなた' : state.members.find((m) => m.id === id)?.name ?? '家族');
  const all = suggestions(state).filter((s) => !state.dismissed.includes(s.key));
  const list = all.filter((s) => filter === 'all' || (filter === 'food' ? s.category === 'food' : filter === 'daily' ? s.category === 'daily' : s.perMonth >= 2));
  const monthly = list.reduce((s, x) => s + x.monthly, 0);
  return (<>
    <header className="topbar" style={{ gap: 8, paddingRight: 16 }}><h1 className="title-l">かしこい買い替え</h1><span className="badge-plain label-m" style={{ background: 'var(--surface-container-high)' }}><Icon n="history" s={16} />購入履歴から</span></header>
    <div className="chips" role="radiogroup" aria-label="絞り込み" style={{ padding: '4px 16px 8px' }}>
      {[['all', 'すべて'], ['food', '食料品'], ['daily', '日用品'], ['freq', 'よく買う']].map(([k, l]) =>
        <button key={k} className="chip label-l" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>{filter === k && <Icon n="check" s={18} />}{l}</button>)}
    </div>
    <main className="content with-nav">
      {list.length > 0 && <div className="primcard row gap12" style={{ borderRadius: 20, padding: '14px 16px' }}>
        <Icon n="savings" s={28} />
        <div className="col grow"><p className="body-m">{list.length}件の提案をすべて試すと</p>
          <div className="row gap4 baseline"><span className="title-m">月</span><span className="num-headline">{yen(monthly)}</span><span className="title-m">ほど節約できそう</span></div></div>
      </div>}
      {list.length === 0 && <div className="card pad20"><p className="body-m var">同じ品目・同じ容量を別の店で買った記録が2店以上あると、ここに提案が出ます。</p></div>}
      {list.map((s) => {
        const planned = state.planned.includes(s.key);
        return (
          <article key={s.key} className="card outlined col gap12" style={{ padding: '16px 16px 12px' }}>
            <div className="row gap12">
              <span className="leading tone-secondary" style={{ width: 44, height: 44, borderRadius: 12 }}><Icon n={itemIcon(s.name)} /></span>
              <div className="grow col"><h3 className="title-m ellipsis" style={{ margin: 0 }}>{s.name} {s.usual.it.comparisonQuantity}{UNITS[s.usual.it.comparisonUnit]}</h3><p className="body-s var">月{Math.max(1, Math.round(s.perMonth))}回くらい購入</p></div>
              <span className="savechip label-m"><Icon n="arrow_downward" s={16} />月{yen(s.monthly)}</span>
            </div>
            <div className="row gap8">
              <div className="cmpbox"><span className="label-m var">いつも・{shortDate(s.usual.date)}</span><span className="body-m">{s.usualStore}</span><span className="num-title">{yen(Math.round(s.usual.price))}</span></div>
              <Icon n="arrow_forward" s={20} className="var" />
              <div className="cmpbox best"><span className="label-m">おすすめ・{shortDate(s.best.date)}</span><span className="body-m">{s.bestStore}</span><span className="num-title">{yen(Math.round(s.best.price))}</span></div>
            </div>
            <p className="row gap6 body-s var"><Icon n="history" s={16} />根拠：{name(s.best.payerId)}の購入履歴（{shortDate(s.best.date)}{s.best.sample ? '・サンプル' : ''}）。現在の店頭価格ではありません</p>
            <div className="row gap4" style={{ justifyContent: 'flex-end' }}>
              <button className="btn text" onClick={() => commit({ ...state, dismissed: [...state.dismissed, s.key] }, '提案を非表示にしました')}>今回はいい</button>
              <button className="btn tonal" aria-pressed={planned} onClick={() => commit({ ...state, planned: planned ? state.planned.filter((k) => k !== s.key) : [...state.planned, s.key] })}>
                <Icon n={planned ? 'check' : 'add_shopping_cart'} s={18} />{planned ? '試す予定' : '次から試す'}</button>
            </div>
          </article>);
      })}
      <p className="body-s var" style={{ padding: '0 4px' }}>試算は過去90日の購入回数と、記録時の税込単価（値引き後）の差から計算した目安です。同じ品名・同じ内容量のみ比較し、Web上の価格は使っていません。</p>
      {state.dismissed.length > 0 && <button className="btn text" style={{ alignSelf: 'flex-start' }} onClick={() => commit({ ...state, dismissed: [] })}>非表示にした提案を戻す（{state.dismissed.length}件）</button>}
    </main>
  </>);
}

/* ---------------- 05 family ---------------- */
function Family({ state, commit, toast, api }) {
  const ym = ymOf(todayISO());
  const [sheet, setSheet] = useState(null);
  const fam = state.receipts.filter((r) => r.visibility === 'family' && ymOf(r.date) === ym);
  const total = fam.reduce((s, r) => s + familyAmount(r, state.settings), 0);
  const per = state.members.map((m) => {
    const rs = fam.filter((r) => r.payerId === m.id);
    return { m, amount: rs.reduce((s, r) => s + familyAmount(r, state.settings), 0), count: rs.length };
  });
  const setSetting = (k, v) => commit({ ...state, settings: { ...state.settings, [k]: v } });
  const hasSample = state.receipts.some((r) => r.sample) || state.members.some((m) => m.sample);
  return (<>
    <header className="topbar">
      <h1 className="title-l">家族</h1>
      <button className="iconbtn" aria-label="家族を招待" onClick={() => document.getElementById('invite')?.scrollIntoView({ behavior: 'smooth' })}><Icon n="person_add" /></button>
      <button className="iconbtn" aria-label="設定" onClick={() => setSheet('settings')}><Icon n="settings" /></button>
    </header>
    <main className="content with-nav">
      <section className="card r28 col gap12" style={{ padding: '16px 20px' }}>
        <div className="col gap2"><h2 className="headline-s" style={{ margin: 0 }}>{state.householdName}</h2><p className="body-m var">{state.members.length}人 ・ {monthLabel(ym)}の支出 {yen(total)}</p></div>
        <div className="row" style={{ gap: 3 }} role="img" aria-label={per.map((p) => `${p.m.name} ${total ? Math.round((p.amount / total) * 100) : 0}%`).join('、')}>
          {per.filter((p) => p.amount > 0).map((p) => <div key={p.m.id} className={`tone-${p.m.tone}`} style={{ height: 12, borderRadius: 6, flex: p.amount }} />)}
          {total === 0 && <div style={{ height: 12, borderRadius: 6, flex: 1, background: 'var(--surface-container)' }} />}
        </div>
        <div className="row gap16" style={{ flexWrap: 'wrap' }}>{per.map((p) => <span key={p.m.id} className="row gap6 body-s var"><span className={`dot tone-${p.m.tone}`} />{p.m.name} {total ? Math.round((p.amount / total) * 100) : 0}%</span>)}</div>
      </section>
      <section className="card py4" aria-label="メンバー">
        {per.map(({ m, amount, count }) => (
          <div key={m.id} className="row gap16" style={{ padding: '8px 8px 8px 16px' }}>
            <span className={`leading tone-${m.tone} title-m`}>{m.name[0]}</span>
            <div className="grow col gap2">
              <div className="row gap8"><span className="body-l">{m.name}</span><span className="tag label-m">{m.id === state.selfId ? 'あなた・管理者' : 'メンバー'}</span>{m.sample && <span className="tag caution label-m">サンプル</span>}</div>
              <p className="body-m var">今月 {yen(amount)} ・ レシート {count}枚</p>
            </div>
            <button className="iconbtn" aria-label={`${m.name}の操作`} onClick={() => toast(m.id === state.selfId ? '名前の変更は設定から行えます' : '家族アカウントは未接続のため、メンバー管理はまだ使えません')}><Icon n="more_vert" /></button>
          </div>))}
      </section>
      <section className="card col" style={{ padding: '12px 0 4px' }}>
        <h2 className="title-m" style={{ margin: 0, padding: '0 16px 4px' }}>プライバシー</h2>
        <div className="setrow"><Icon n="visibility" className="var" /><div className="grow col gap2"><span className="body-l">レシートを家族に公開</span><span className="body-s var">新しいレシートの初期設定</span></div>
          <Switch label="レシートを家族に公開" checked={state.settings.defaultVisibility === 'family'} onChange={(v) => setSetting('defaultVisibility', v ? 'family' : 'private')} /></div>
        <div className="setrow"><Icon n="lock" className="var" /><div className="grow col gap2"><span className="body-l">お小遣いは自分だけに表示</span><span className="body-s var">「お小遣い」カテゴリは家族の集計に含めません</span></div>
          <Switch label="お小遣いは自分だけに表示" checked={state.settings.hideAllowance} onChange={(v) => setSetting('hideAllowance', v)} /></div>
        <div className="setrow"><Icon n="auto_awesome" className="var" /><div className="grow col gap2"><span className="body-l">提案に家族の履歴を使う</span><span className="body-s var">オフにすると自分の購入履歴だけで提案します</span></div>
          <Switch label="提案に家族の履歴を使う" checked={state.settings.shareSuggestions} onChange={(v) => setSetting('shareSuggestions', v)} /></div>
      </section>
      <section id="invite" className="primcard col gap12" style={{ borderRadius: 24, padding: '16px 20px' }}>
        <h2 className="title-m" style={{ margin: 0 }}>家族を招待</h2>
        <div className="row between" style={{ background: 'var(--surface-container-lowest)', borderRadius: 14, padding: '6px 8px 6px 16px' }}>
          <span className="num-headline var" style={{ letterSpacing: 2 }}>未発行</span>
          <button className="iconbtn" disabled aria-label="招待コードをコピー（未発行）" style={{ opacity: .38 }}><Icon n="content_copy" /></button>
        </div>
        <div className="row gap8">
          <button className="btn filled" onClick={() => toast('家族共有サーバーが未接続のため、招待リンクはまだ発行できません')}><Icon n="share" s={18} />リンクを共有</button>
          <button className="btn outlined" style={{ background: 'var(--surface-container-lowest)' }} onClick={() => toast('家族共有サーバーが未接続のため、QRコードはまだ発行できません')}><Icon n="qr_code_2" s={18} />QRコード</button>
        </div>
        <p className="body-s">家族アカウントの認証・同期は未接続です。記録はこの端末だけに保存されます。</p>
      </section>
    </main>
    {sheet === 'settings' && <SettingsSheet state={state} commit={commit} api={api} hasSample={hasSample} onClose={() => setSheet(null)} />}
  </>);
}

function SettingsSheet({ state, commit, api, hasSample, onClose }) {
  const [f, setF] = useState({ householdName: state.householdName, budget: String(state.budget), myName: state.members.find((m) => m.id === state.selfId)?.name ?? '' });
  const [err, setErr] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const budget = toInt(f.budget);
    if (!f.householdName.trim() || !f.myName.trim()) return setErr('名前を入力してください');
    if (budget === null || budget <= 0) return setErr('予算は1円以上で入力してください');
    if (commit({ ...state, householdName: f.householdName.trim(), budget, members: state.members.map((m) => (m.id === state.selfId ? { ...m, name: f.myName.trim() } : m)) }, '設定を保存しました')) onClose();
  };
  const clearSample = () => {
    if (!confirm('サンプルのレシートとメンバーを削除しますか？自分で記録したレシートは残ります。')) return;
    if (commit({ ...state, receipts: state.receipts.filter((r) => !r.sample), members: state.members.filter((m) => !m.sample), dismissed: [], planned: [] }, 'サンプルデータを削除しました')) onClose();
  };
  const reset = () => { if (confirm('サンプルを含む初期状態に戻しますか？記録したレシートは削除されます。') && commit(sampleState(), '初期状態に戻しました')) onClose(); };
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="sheet" onClick={onClose}><form role="dialog" aria-modal="true" aria-label="設定" onClick={(e) => e.stopPropagation()} onSubmit={submit}
      style={{ width: '100%', maxWidth: 480, maxHeight: '90dvh', overflow: 'auto', background: 'var(--surface-container-lowest)', borderRadius: '28px 28px 0 0', padding: '12px 20px calc(20px + env(safe-area-inset-bottom))' }}>
      <div className="handle" />
      <div className="col gap12">
        <p className="title-m">設定</p>
        <label className="field"><span className="label-l">家計簿の名前</span><input value={f.householdName} onChange={up('householdName')} /></label>
        <div className="grid2">
          <label className="field"><span className="label-l">あなたの表示名</span><input value={f.myName} onChange={up('myName')} /></label>
          <label className="field"><span className="label-l">月の予算（円）</span><input inputMode="numeric" pattern="[0-9]*" value={f.budget} onChange={up('budget')} /></label>
        </div>
        {err && <p className="body-m err" role="alert">{err}</p>}
        <div className="banner info"><Icon n="cloud_off" /><div className="col gap2 body-m">
          <p>レシート読み取り：{api.ok ? (api.geminiConfigured ? 'Gemini 接続済み（ローカルAPI）' : 'API起動中・Gemini未設定') : 'APIに接続できません'}</p>
          <p>家族アカウント・同期：未接続（この端末にのみ保存）</p></div></div>
        <div className="row gap8" style={{ flexWrap: 'wrap' }}>
          {hasSample && <button type="button" className="btn outlined" onClick={clearSample}><Icon n="delete" s={18} />サンプルを削除</button>}
          <button type="button" className="btn text" onClick={reset}>初期状態に戻す</button>
        </div>
        <div className="row gap8" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn text" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn filled"><Icon n="check" s={18} />保存</button>
        </div>
      </div>
    </form></div>
  );
}
