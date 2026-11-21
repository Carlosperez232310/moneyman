/* MoneyMan — private money tracker PWA. Data arrives as an AES-GCM encrypted blob (data.enc.json) and is
   decrypted only in the browser with a key derived from Carlos's passcode (PBKDF2-SHA256, 600k iterations).
   All money math is done by tools/mm_engine.py when the data is built; the app adds this phone's cash entries,
   bill ticks and dismissed alerts, and keeps dates live (days left, overdue, month rollover). */
(() => {
'use strict';
const VER = '__VER__';
const TZ = 'America/Los_Angeles';
const K_KEY = 'moneyman.key.v1', K_CASH = 'moneyman.cash.v1', K_TIP = 'moneyman.tip.v1', K_TAB = 'moneyman.tab.v1', K_PAID = 'moneyman.paid.v1',
  K_TOAST = 'moneyman.toast.v1', K_DISMISS = 'moneyman.dismiss.v1';
const $ = (s, r = document) => r.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();
const S = { env: null, key: null, data: null, tab: 'home', filter: 'all', q: '', weekIdx: 0, actView: 'list', lastFetch: 0, showCancelled: false, showPaid: false };
const TABS = ['home', 'week', 'bills', 'activity', 'goals'];

/* ---------------- icons ---------------- */
const P = {
  food: '<path d="M4 3v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V3M7 3v18M20 15V3a5 5 0 0 0-4 5v5a2 2 0 0 0 2 2h2zm0 0v6"/>',
  groceries: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 3h2.2l2.5 11.6a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.5L21.5 7H5.6"/>',
  fun: '<path d="M6.5 11h4M8.5 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6C2.6 9.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4A2 2 0 0 1 9.8 16h4.4a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-6.6-.7-7.3A4 4 0 0 0 17.3 5z"/>',
  gamepad: '<path d="M6.5 11h4M8.5 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6C2.6 9.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4A2 2 0 0 1 9.8 16h4.4a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-6.6-.7-7.3A4 4 0 0 0 17.3 5z"/>',
  subs: '<rect x="2.5" y="6.5" width="19" height="13.5" rx="2.5"/><path d="m16.5 2.5-4.5 4-4.5-4"/>',
  tv: '<rect x="2.5" y="6.5" width="19" height="13.5" rx="2.5"/><path d="m16.5 2.5-4.5 4-4.5-4"/>',
  shopping: '<path d="M6 2.5 3 6.5v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-13l-3-4z"/><path d="M3 6.5h18M16 10.5a4 4 0 0 1-8 0"/>',
  bag: '<path d="M6 2.5 3 6.5v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-13l-3-4z"/><path d="M3 6.5h18M16 10.5a4 4 0 0 1-8 0"/>',
  gas: '<path d="M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5"/>',
  bills: '<path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  fees: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>',
  income: '<path d="M17 7 7 17M17 17H7V7"/>',
  transfer: '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a2 2 0 0 1-2 2h-4v-6h-5v6h-4a2 2 0 0 1-2-2z"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h3"/>',
  shield: '<path d="M12 2.8 4.5 5.6v5.6c0 4.8 3.2 8.6 7.5 10 4.3-1.4 7.5-5.2 7.5-10V5.6z"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/>',
  wifi: '<path d="M12 19.5h.01M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  chef: '<path d="M17 21a1 1 0 0 0 1-1v-5.4c0-.4.3-.8.7-1a4 4 0 0 0-2.1-7.6 5 5 0 0 0-9.2 0 4 4 0 0 0-2.1 7.6c.4.2.7.6.7 1V20a1 1 0 0 0 1 1z"/><path d="M6 17h12"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7L3 16"/><path d="M8 16H3v5"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
};
Object.assign(P, {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>', chevR: '<path d="m9 6 6 6-6 6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  savings: '<path d="M19 9.5c0-3-3.1-5.5-7-5.5S5 6.5 5 9.5c0 1.6.8 3 2.1 4L7 19h3v-2h4v2h3l-.1-5.5c1.3-1 2.1-2.4 2.1-4z"/><path d="M15 9h.01"/>',
  refund: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  smoke: '<path d="M3 16h14v4H3zM19 16v4M21 16v4M18 12c0-2-2-2-2-4s2-2 2-4"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
});
const ic = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.other}</svg>`;
const CAT = { food: 'Eating out', groceries: 'Groceries & snacks', fun: 'Fun', subs: 'Subscription', shopping: 'Shopping', gas: 'Gas',
  bills: 'Bill', fees: 'Bank fee', income: 'Income', refund: 'Refund', transfer: 'Transfer', cash: 'Cash withdrawal', other: 'Other' };
const bucketOf = c => (c === 'food' || c === 'groceries') ? 'food' : (c === 'fun' || c === 'shopping') ? 'fun' : null;
const FILTERS = [['all', 'All'], ['food', 'Eating out', ['food']], ['groceries', 'Groceries', ['groceries']], ['fun', 'Fun', ['fun', 'shopping']],
  ['gas', 'Gas', ['gas']], ['bills', 'Bills', ['bills', 'fees', 'subs']], ['income', 'Income', ['income', 'refund']], ['transfer', 'Transfers', ['transfer', 'cash']]];

/* ---------------- formatting & dates ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, cents = true) => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const fmt0 = v => fmt(Math.round(v), false);
const smart = v => (Math.abs(v - Math.round(v)) < 0.005 ? fmt0(v) : fmt(v));
const r2 = v => Math.round(v * 100) / 100;
function moneyHTML(v, opts = {}) {
  const neg = v < 0, a = Math.abs(v), whole = Math.floor(a + 1e-9), c = Math.round((a - whole) * 100);
  const w = whole + (c === 100 ? 1 : 0), cc = c === 100 ? 0 : c;
  const cents = opts.cents === false || (opts.auto && cc === 0) ? '' : `<span class="c">.${String(cc).padStart(2, '0')}</span>`;
  return `${neg ? '−' : ''}$${w.toLocaleString('en-US')}${cents}`;
}
const ptParts = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit' })
  .formatToParts(d).map(p => [p.type, p.value]));
function todayISO() {
  const o = new URLSearchParams(location.search).get('today'); if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  const p = ptParts(); return `${p.year}-${p.month}-${p.day}`;
}
const dn = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const isoOf = n => new Date(n * 864e5).toISOString().slice(0, 10);
const dfmt = (iso, o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(new Date(dn(iso) * 864e5));
const shortDate = iso => dfmt(iso, { month: 'short', day: 'numeric' });
const wdShort = iso => dfmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
const wd = iso => dfmt(iso, { weekday: 'short' });
const relDay = iso => { const d = dn(iso) - dn(todayISO()); return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : d > 1 ? `in ${d} days` : `${-d} days ago`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function updatedLabel(ts) {
  const d = new Date(ts); if (isNaN(d)) return 'Updated';
  const p = ptParts(d), t = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
  const iso = `${p.year}-${p.month}-${p.day}`, rel = dn(todayISO()) - dn(iso);
  return `Updated ${rel === 0 ? '' : rel === 1 ? 'yesterday ' : shortDate(iso) + ', '}${t} PT`;
}
/* ---------------- data schedule (all in America/Los_Angeles) ----------------
   The 'MoneyMan app refresh' routine republishes data.enc.json at 9:02 AM and 9:02 PM PT (the 4:14 PM check-in is paused).
   The bank (OnPoint via Plaid) syncs new transactions about once a day, so purchases can take a day to show. */
const SCHEDULE = [[9, 2], [21, 2]];
const PENDING_MS = 30 * 60e3, EARLY_MS = 10 * 60e3, STALE_MS = 14 * 3600e3;
const BANK_NOTE = 'New purchases can take up to a day to show up (the bank syncs about once a day).';
const ptISO = ms => { const p = ptParts(new Date(ms)); return `${p.year}-${p.month}-${p.day}`; };
function ptOffsetMin(ms) {
  const p = ptParts(new Date(ms));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60e3) * 60e3) / 60e3);
}
function ptEpoch(iso, h, m) {
  const [y, mo, d] = iso.split('-').map(Number), wall = Date.UTC(y, mo - 1, d, h, m);
  return wall - ptOffsetMin(wall - ptOffsetMin(wall) * 60e3) * 60e3;
}
function nextUpdate(now = Date.now(), gen) {
  const d0 = dn(ptISO(now)), slots = [];
  for (let k = -1; k <= 2; k++) for (const [h, m] of SCHEDULE) slots.push(ptEpoch(isoOf(d0 + k), h, m));
  const g = new Date(gen).getTime(), last = slots.filter(s => s <= now).pop();
  if (last != null && now - last < PENDING_MS && !(g >= last - EARLY_MS)) return { at: last, pending: true };
  return { at: slots.find(s => s > now), pending: false };
}
const tfmt = ms => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(/\s/g, ' ');
function whenPT(ts, now = Date.now()) {
  const ms = new Date(ts).getTime(); if (isNaN(ms)) return 'an unknown time';
  const rel = dn(ptISO(ms)) - dn(ptISO(now));
  return `${rel === 0 ? '' : rel === -1 ? 'yesterday ' : rel === 1 ? 'tomorrow ' : shortDate(ptISO(ms)) + ', '}${tfmt(ms)} PT`;
}
const nextLabel = (gen, now = Date.now()) => { const n = nextUpdate(now, gen); return n.pending ? `Next update due now (${tfmt(n.at)} PT run)` : `Next update ~${whenPT(n.at, now)}`; };
function newestMsg(gen, now = Date.now()) {
  const n = nextUpdate(now, gen);
  return `This is the newest data (from ${whenPT(gen, now)}). ` + (n.pending ? `The ${tfmt(n.at)} PT update should land in a few minutes.` : `Next update around ${whenPT(n.at, now)}.`);
}
const isStale = (gen, now = Date.now()) => now - new Date(gen).getTime() > STALE_MS;
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

/* ---------------- crypto ---------------- */
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64e = u => btoa(String.fromCharCode(...new Uint8Array(u)));
const normPass = p => p.trim().toLowerCase().replace(/[\s_]+/g, '-');
async function deriveKey(pass, env, extractable) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normPass(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(env.kdf.salt), iterations: env.kdf.iterations },
    base, { name: 'AES-GCM', length: 256 }, extractable, ['decrypt']);
}
async function decryptEnv(key, env) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.cipher.iv), additionalData: enc.encode(env.cipher.aad || '') }, key, b64d(env.ct));
  return JSON.parse(dec.decode(pt));
}
function savedKey(env) {
  try { const s = JSON.parse(localStorage.getItem(K_KEY) || 'null'); if (s && (!env || (s.salt === env.kdf.salt && s.iter === env.kdf.iterations))) return s.k; } catch (e) {}
  return null;
}
async function fetchEnv(fresh) {
  const r = await fetch('data.enc.json?t=' + Date.now() + (fresh ? '&fresh=1' : ''), { cache: 'no-store' });
  if (!r.ok) throw new Error('offline');
  const env = await r.json(); if (!env.ct) throw new Error('bad data');
  S.fromCache = r.headers.get('X-MM-Source') === 'cache';
  if (!S.fromCache) S.lastFetch = Date.now();
  return env;
}

/* ---------------- lock screen ---------------- */
function showLock(msg) {
  $('#app').hidden = true; const L = $('#lock'); L.hidden = false; L.classList.remove('unlocking');
  $('#lock-err').textContent = msg || '';
  setTimeout(() => { if (!matchMedia('(pointer:coarse)').matches) $('#pass').focus(); }, 300);
}
async function onUnlock(e) {
  e.preventDefault();
  const pass = $('#pass').value, btn = $('#unlock'), field = $('#field'), err = $('#lock-err');
  field.classList.remove('bad'); err.textContent = '';
  if (!pass.trim()) { field.classList.add('bad'); err.textContent = 'Type your passcode first.'; haptic(20); return; }
  if (!S.env) { try { S.env = await fetchEnv(); } catch (x) { err.textContent = "Can't reach MoneyMan. Connect to the internet and try again."; return; } }
  btn.classList.add('busy'); btn.querySelector('.lbl').textContent = 'Unlocking…'; btn.disabled = true;
  await new Promise(r => setTimeout(r, 30));
  const remember = $('#remember').checked;
  try {
    const key = await deriveKey(pass, S.env, remember);
    const data = await decryptEnv(key, S.env);
    if (remember) localStorage.setItem(K_KEY, JSON.stringify({ salt: S.env.kdf.salt, iter: S.env.kdf.iterations, k: b64e(await crypto.subtle.exportKey('raw', key)) }));
    else localStorage.removeItem(K_KEY);
    S.key = key; S.data = data; haptic(12);
    $('#lock').classList.add('unlocking'); $('#pass').value = '';
    setTimeout(() => startApp(), 380);
  } catch (x) {
    void field.offsetWidth; field.classList.add('bad'); haptic(30);
    err.textContent = "Hmm, that's not it. Check the words and try again.";
  } finally { btn.classList.remove('busy'); btn.querySelector('.lbl').textContent = 'Unlock'; btn.disabled = false; }
}

/* ---------------- model helpers ---------------- */
const D = () => S.data;
const acct = kind => (D().accounts || []).find(a => a.kind === kind || a.id === kind) || null;
const store = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def; } catch (e) { return def; } };
const cashAll = () => store(K_CASH, []) || [];
const cashFor = start => cashAll().filter(e => e.week === start);
function weekList() {  // oldest -> newest
  const d = D(); if (d.weeks && d.weeks.length) return d.weeks;
  const w = d.week; return w ? [{ ...w, budgets: w.budgets || { food: Math.round(w.budget * 0.7), fun: r2(w.budget - Math.round(w.budget * 0.7)) } }] : [];
}
function nextPayday() {
  const p = D().paycheck || {}; let n = p.next_date ? dn(p.next_date) : null; const t = dn(todayISO());
  if (n == null) return null; while (n < t) n += 7; return isoOf(n);
}
function weekCalc(idx = 0) {
  const ws = weekList(); const w = ws[ws.length - 1 - idx]; if (!w) return null;
  const t = dn(todayISO()), st = dn(w.start), en = dn(w.end), isCur = idx === 0;
  const tx = (D().transactions || []).filter(x => x.date >= w.start && x.date <= w.end);
  const cash = cashFor(w.start).map(x => ({ id: x.id, date: x.date, amount: -x.amount, merchant: x.note || (x.cat === 'fun' ? 'Cash · fun' : 'Cash · food'),
    category: x.cat === 'fun' ? 'fun' : 'food', cash: true }));
  const items = [...tx.filter(x => bucketOf(x.category) || x.category === 'gas'), ...cash].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  const sum = cats => r2(items.filter(x => cats.includes(x.category)).reduce((s, x) => s - x.amount, 0));
  const b = w.budgets || {}, foodB = +b.food || 0, funB = +b.fun || 0;
  const daysLeft = Math.max(0, Math.min(en - st + 1, en - Math.max(t, st) + 1));
  const elapsed = Math.min(1, Math.max(0, (t - st + 1) / (en - st + 1)));
  const mk = (key, budget, cats) => {
    const its = items.filter(i => cats.includes(i.category)), spent = r2(its.reduce((s, i) => s - i.amount, 0)), left = r2(budget - spent);
    const pct = budget > 0 ? spent / budget : (spent > 0 ? 2 : 0), tone = pct > 1 ? 'red' : pct > 0.85 ? 'amber' : '';
    const status = left < 0 ? ['red', `Over by ${fmt(-left)}`] : !isCur ? ['', `${fmt(left)} left over`] : pct > 0.85 ? ['amber', 'Almost gone'] : pct > elapsed + 0.1 ? ['amber', 'Spending fast'] : ['mint', 'On track'];
    return { key, budget, spent, left, pct, tone, status, items: its, perDay: daysLeft ? Math.max(0, left) / daysLeft : 0 };
  };
  const food = mk('food', foodB, ['food', 'groceries']), fun = mk('fun', funB, ['fun', 'shopping']);
  food.eatingOut = sum(['food']); food.groceries = r2(food.spent - food.eatingOut);
  const gasItems = items.filter(i => i.category === 'gas'), gas = r2(gasItems.reduce((s, i) => s - i.amount, 0));
  return { w, idx, isCur, isFuture: st > t, ended: t > en, food, fun, gas, gasItems, daysLeft, elapsed, budget: +w.budget || r2(foodB + funB),
    left: r2(food.left + fun.left), spent: r2(food.spent + fun.spent) };
}
function safeCalc() {
  const s = D().safe, wk = weekCalc(0); if (!wk) return null;
  const budgetLeft = Math.max(0, wk.left), cf = s ? +s.cashflow : budgetLeft;
  const amount = Math.max(0, Math.min(cf, budgetLeft));
  const days = wk.daysLeft || 1;
  return { amount: r2(amount), cashflow: r2(cf), budgetLeft: r2(wk.left), perDay: r2(amount / days), days: wk.daysLeft, limited: cf < budgetLeft ? 'bills' : 'budget',
    ended: wk.ended, wk };
}

/* ---------------- bills: monthly instances, paid state ---------------- */
const slug = s => String(s || 'bill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const paidMap = () => store(K_PAID, {}) || {};
function setPaid(key, val, auto) {
  const m = paidMap(); if (!!val === !!auto) delete m[key]; else m[key] = !!val;
  const cutoff = isoOf(dn(todayISO()) - 120).slice(0, 7);
  for (const k of Object.keys(m)) if ((k.split(':').pop() || '') < cutoff) delete m[k];
  localStorage.setItem(K_PAID, JSON.stringify(m));
}
const pad2 = n => String(n).padStart(2, '0');
function billInstances() {
  const bills = D().bills || {}, defs = bills.items || bills.upcoming || [], per = todayISO().slice(0, 7);
  const [y, m] = per.split('-').map(Number), dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), local = paidMap(), out = [];
  for (const b of defs) {
    const id = b.id || slug(b.name), key = `${id}:${per}`;
    const date = b.due_day ? `${per}-${pad2(Math.min(+b.due_day, dim))}` : b.date;
    const post = b.due_day ? isoOf(dn(date) + (+b.post_offset || 0)) : date;
    const samePer = (b.period || (b.date || '').slice(0, 7)) === per;
    let auto = null;
    if (samePer && b.paid) auto = { date: b.paid_date || null, amount: b.paid_amount != null ? +b.paid_amount : null, source: 'bank' };
    const paid = key in local ? local[key] : !!auto;
    out.push({ ...b, id, key, date, post, period: per, auto, paid, sa: samePer ? b.set_aside : null });
  }
  return out;
}
const byDue = (x, y) => String(x.post || x.date).localeCompare(String(y.post || y.date));
const billAmt = b => (b.paid && b.auto && b.auto.amount != null ? b.auto.amount : !b.paid && b.id === 'rent' && b.sa ? +b.sa.left_to_set_aside : b.amount ? +b.amount : 0);
const billSum = list => list.reduce((s, b) => s + billAmt(b), 0);
function dismissed() { return store(K_DISMISS, {}) || {}; }
function alerts() { const d = dismissed(); return (D().alerts || []).filter(a => !d[a.id] && !String(a.id).startsWith('hold-')); }
function goalOf() {
  const g = (D().goals || []).find(x => x.featured) || (D().goals || [])[0]; if (!g) return null;
  const saved = g.saved != null ? +g.saved : (g.sources || []).reduce((s, x) => s + (+x.amount || 0), 0);
  const p = g.projection || {}, target = +g.target, togo = Math.max(0, target - saved);
  const np = nextPayday(), left = p.paydays_left ? p.paydays_left.filter(d => d >= (np || '')) : [];
  const need = left.length ? togo / left.length : togo;
  return { g, saved, target, togo, pct: target ? Math.min(1, saved / target) : 0, left, need, p, days: g.due ? dn(g.due) - dn(todayISO()) : null };
}

/* ---------------- render helpers ---------------- */
const countM = (v, cls = '', o = {}) => `<span class="money ${cls}" data-count="${v}" data-fmt="${o.cents === false ? 'm0' : 'm'}">${moneyHTML(v, o)}</span>`;
const bar = (pct, tone = '', tick) => `<div class="bar ${tone}"><b data-w="${Math.min(100, Math.max(0, pct * 100))}"></b>${tick != null ? `<span class="tick" style="left:calc(${(tick * 100).toFixed(1)}% - 1px)"></span>` : ''}</div>`;
const pill = (tone, text) => `<span class="pill ${tone}"><i></i>${esc(text)}</span>`;
const secH = (title, right = '', action = '') => `<div class="sec-h"><h3>${esc(title)}</h3>${right ? `<span ${action}>${right}</span>` : ''}</div>`;
const tagHTML = tags => (tags || []).map(t => `<span class="tag ${esc(String(t).toLowerCase())}">${esc(t)}</span>`).join('');
function greeting() { const h = +ptParts().hour; return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function staleBanner() {
  const gen = D().generated_at; if (!isStale(gen)) return '';
  return `<button class="banner amber" data-action="refresh">${ic('clock')}<span><b>These numbers are from ${esc(whenPT(gen))}.</b> Tap to check for newer data.</span></button>`;
}
function syncLine() {
  const d = D(), bank = d.bank_synced_at;
  return `<p class="sched-note">${ic('refresh')}<span>${bank ? `Bank synced ${esc(whenPT(bank))} · ` : ''}pulled ${esc(whenPT(d.generated_at))}. ${esc(nextLabel(d.generated_at))}.</span></p>`;
}

/* ---------------- Home ---------------- */
function vHome() {
  const d = D(), sc = safeCalc(), chk = acct('checking'), sav = acct('savings'), np = nextPayday(), wk = sc && sc.wk;
  let h = `<div class="greet"><div class="date">${esc(dfmt(todayISO(), { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
    <h1 class="h-title">${greeting()}, ${esc(d.name || 'Carlos')}</h1></div>${staleBanner()}`;
  if (sc) {
    const tone = sc.amount <= 0 ? 'red' : sc.perDay < 10 ? 'amber' : 'mint';
    h += `<button class="card hero ${tone}" data-action="safe" aria-label="How safe to spend is worked out">
      <div class="hero-top"><span class="eyebrow">${ic('wallet')}Safe to spend</span><span class="hero-until">until ${esc(np ? wdShort(np) : 'payday')}</span></div>
      <div class="hero-amt">${countM(sc.amount)}</div>
      <div class="hero-sub">${sc.ended ? 'This week ended. New numbers arrive with the next update.' : sc.amount > 0 ? `<b>${fmt(sc.perDay)}</b>/day for ${plural(sc.days, 'day')}` : 'Hold off on extra spending until payday'}</div>
      <div class="hero-note">${sc.limited === 'bills' && sc.budgetLeft > sc.amount
        ? `${ic('info')}<span>Your food + fun budget has ${fmt0(sc.budgetLeft)} left, but bills and rent cash coming up need the rest.</span>`
        : `${ic('check')}<span>Bills before payday are covered.${d.week && d.week.estimate ? ' Budget uses an estimated paycheck.' : ''}</span>`}<span class="more">How?${ic('chevR')}</span></div>
    </button>`;
  }
  h += `<div class="tiles">
    <button class="card tile" data-action="acct" data-k="checking"><div class="lbl">${ic('wallet')}Checking</div>
      <div class="v">${chk ? countM(chk.available) : '—'}</div><div class="s">Available${chk && chk.current - chk.available > 0.004 ? ` · ${fmt(chk.current - chk.available)} on hold` : ''}</div></button>
    <button class="card tile" data-action="nav" data-tab="goals"><div class="lbl">${ic('savings')}Savings</div>
      <div class="v">${sav ? countM(sav.current) : '—'}</div><div class="s">Steam Frame fund</div></button></div>`;
  if (wk) {
    const row = (b, name, icon) => `<div class="bk-row"><div class="bk-h"><span class="bk-n">${ic(icon)}${name}</span><span class="bk-v ${b.left < 0 ? 'neg' : ''}">${b.left < 0 ? `${fmt(-b.left)} over` : `${fmt(b.left)} left`}</span></div>
      ${bar(b.pct, b.tone, wk.isCur ? wk.elapsed : null)}<div class="bk-s"><span>${fmt(b.spent)} of ${smart(b.budget)}</span><span>${wk.daysLeft && b.left > 0 ? `${fmt(b.perDay)}/day` : ''}</span></div></div>`;
    h += `<button class="card week-card" data-action="nav" data-tab="week"><div class="wc-h"><span class="eyebrow">This week · ${esc(shortDate(wk.w.start))}–${esc(shortDate(wk.w.end))}</span>${wk.w.estimate ? pill('amber', 'Estimate') : ''}</div>
      ${row(wk.food, 'Food', 'food')}${row(wk.fun, 'Fun', 'fun')}</button>`;
  }
  const al = alerts();
  if (al.length) h += secH('Heads up', `${al.length}`) + `<div class="alerts">${(S.allAlerts ? al : al.slice(0, 2)).map(alertCard).join('')}
    ${al.length > 2 ? `<button class="more-btn" data-action="more-alerts">${S.allAlerts ? 'Show less' : `Show ${al.length - 2} more`}${ic(S.allAlerts ? 'chevL' : 'chevD')}</button>` : ''}</div>`;
  const before = beforePayday();
  if (before.length) h += secH(`Before payday · ${np ? wd(np) + ' ' + shortDate(np) : ''}`, 'Bills', 'data-action="nav" data-tab="bills" class="link"') +
    `<div class="card list timeline">${before.map(tlRow).join('')}</div>`;
  const go = goalOf();
  if (go) h += `<button class="card goal-mini" data-action="nav" data-tab="goals"><div class="gm-ring">${ring(go.pct, 58, 7, 'rgm')}</div>
    <div class="mid"><div class="t1">${ic('gamepad')}${esc(go.g.name)}</div><div class="t2">${fmt(go.togo)} to go · needs ${fmt0(go.need)}/payday to hit ${esc(shortDate(go.g.due))}</div></div>${ic('chevR', 'chev')}</button>`;
  h += syncLine();
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (ios && !standalone && !localStorage.getItem(K_TIP)) h += `<div class="card install"><div class="mid">Install: tap <b>Share</b> then <b>Add to Home Screen</b> to open MoneyMan like an app.</div><button class="x" data-action="tip" aria-label="Dismiss">${ic('x')}</button></div>`;
  return h;
}
function alertCard(a) {
  return `<div class="card alert ${esc(a.tone || 'info')}"><div class="ai">${ic(a.icon || 'alert')}</div><div class="mid"><div class="t1">${esc(a.title)}</div><div class="t2">${esc(a.text)}</div></div>
    <button class="x" data-action="dismiss" data-id="${esc(a.id)}" aria-label="Dismiss">${ic('x')}</button></div>`;
}
function beforePayday() {  // what has to come out of checking before next payday
  const np = nextPayday(), t = todayISO(), out = [];
  if (!np) return out;
  for (const b of billInstances()) if (!b.paid && b.id !== 'rent' && b.post >= t && b.post < np) out.push({ name: b.name, date: b.post, amount: billAmt(b), icon: b.icon, kind: 'bill', approx: b.approx });
  for (const b of billInstances()) if (!b.paid && b.id !== 'rent' && b.post < t) out.push({ name: b.name, date: b.post, amount: billAmt(b), icon: b.icon, kind: 'late', approx: b.approx });
  const r = D().rent; if (r && r.owed_now > 0) out.push({ name: 'Rent cash to set aside', date: t, amount: r.owed_now, icon: 'home', kind: 'rent', note: `${fmt0(r.withdrawn)} of ${fmt0(r.amount)} withdrawn` });
  const st = D().steam; if (st && st.owed > 0) out.push({ name: 'Steam Frame transfer', date: t, amount: st.owed, icon: 'savings', kind: 'steam', note: `${fmt0(st.done)} of ${fmt0(st.per_payday)} moved this week` });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function tlRow(x) {
  const dd = dn(x.date) - dn(todayISO());
  const when = x.kind === 'late' ? 'not seen yet' : x.kind === 'rent' || x.kind === 'steam' ? 'this week' : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : wd(x.date) + ' ' + shortDate(x.date);
  return `<div class="row"><div class="ico ${x.kind === 'steam' ? 'income' : 'bills'}">${ic(x.icon || 'bills')}</div><div class="mid"><div class="t1"><span class="nm">${esc(x.name)}</span></div>
    <div class="t2">${esc(x.note || (x.kind === 'late' ? `Expected ${shortDate(x.date)}, not in the bank yet` : 'Comes out of checking'))}</div></div>
    <div class="amt">${x.approx ? '~' : ''}${fmt(x.amount)}<small class="when ${dd <= 1 || x.kind === 'late' ? 'soon' : ''}">${esc(when)}</small></div></div>`;
}
function ring(pct, size = 142, stroke = 13, id = 'rg') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="${id}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ef0b0"/><stop offset="1" stop-color="#34c8ff"/></linearGradient></defs>
    <circle class="trk" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="val" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#${id})" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - Math.max(pct, 0.015))}"/>
  </svg>${size > 90 ? `<div class="ctr"><div class="pct num">${Math.round(pct * 100)}<small>%</small></div><div class="of">saved</div></div>` : `<div class="ctr sm"><div class="pct num">${Math.round(pct * 100)}<small>%</small></div></div>`}</div>`;
}

/* ---------------- Week ---------------- */
function vWeek() {
  const n = weekList().length, idx = Math.min(S.weekIdx, n - 1), c = weekCalc(idx);
  if (!c) return `<h1 class="h-title">This week</h1><div class="card empty">No week data yet.</div>`;
  const w = c.w, label = idx === 0 ? 'This week' : idx === 1 ? 'Last week' : `${idx} weeks ago`;
  let h = `<div class="page-h"><div class="eyebrow">Food & fun · Wed–Tue</div><h1 class="h-title">${label}</h1></div>
    <div class="switcher" role="group" aria-label="Choose week">
      <button class="sw-btn" data-action="week" data-d="1" ${idx >= n - 1 ? 'disabled' : ''} aria-label="Earlier week">${ic('chevL')}</button>
      <div class="sw-mid"><b>${esc(wdShort(w.start))} – ${esc(shortDate(w.end))}</b><span>${c.isCur ? `Day ${Math.max(1, Math.round(c.elapsed * 7))} of 7` : c.left >= 0 ? `Finished ${fmt(c.left)} under` : `Finished ${fmt(-c.left)} over`}</span></div>
      <button class="sw-btn" data-action="week" data-d="-1" ${idx === 0 ? 'disabled' : ''} aria-label="Later week">${ic('chevR')}</button></div>`;
  h += `<div class="card pad-s split"><div class="split-h"><span class="eyebrow">Spending money</span><span class="money">${smart(c.budget)}</span></div>
    <div class="formula"><span>${w.estimate ? 'Paycheck <i class="est">estimate</i>' : 'Paycheck'} <b>${fmt(+w.paycheck || 0)}</b></span><span>− Steam <b>$147</b></span><span>− Bills <b>$275</b></span></div>
    ${w.estimate ? `<div class="fine">${ic('info')}Paycheck hasn't posted yet, so this uses your recent average. It updates when the real one lands.</div>` : ''}</div>`;
  for (const b of [c.food, c.fun]) h += budgetCard(b, c);
  if (c.isCur) h += `<button class="btn mint block" data-action="cash">${ic('plus')}I spent cash</button>`;
  h += `<div class="card pad-s gas-row"><div class="ico gas">${ic('gas')}</div><div class="mid"><div class="t1">Gas</div><div class="t2">Not part of food or fun</div></div><div class="amt">${fmt(c.gas)}</div></div>`;
  for (const b of [c.food, c.fun]) {
    const name = b.key === 'food' ? 'Food' : 'Fun';
    h += secH(`${name} purchases`, `${b.items.length} · ${fmt(b.spent)}`) + `<div class="card list">${b.items.length ? b.items.map(txRow).join('') : `<div class="empty">No ${name.toLowerCase()} spending ${c.isCur ? 'yet' : 'that week'}.</div>`}</div>`;
  }
  return h;
}
function budgetCard(b, c) {
  const name = b.key === 'food' ? 'Food' : 'Fun';
  const split = b.key === 'food' ? `<div class="sub-split"><span><i class="dot-eat"></i>Eating out <b>${fmt(b.eatingOut)}</b></span><span><i class="dot-gro"></i>Groceries & snacks <b>${fmt(b.groceries)}</b></span></div>` : '';
  return `<div class="card bucket ${b.key}"><div class="top"><div class="bh"><div class="ico ${b.key}">${ic(b.key)}</div>
      <div><div class="eyebrow">${name} · left</div><div class="big ${b.left < 0 ? 'neg' : ''}">${countM(b.left)}</div></div></div>${pill(b.status[0], b.status[1])}</div>
    ${bar(b.pct, b.tone, c.isCur ? c.elapsed : null)}
    <div class="meta"><span><b>${fmt(b.spent)}</b> of ${smart(b.budget)}</span><span>${c.isCur && c.daysLeft ? (b.left > 0 ? `<b>${fmt(b.perDay)}</b>/day · ${plural(c.daysLeft, 'day')} left` : `${plural(c.daysLeft, 'day')} to go`) : ''}</span></div>${split}</div>`;
}
function txRow(t) {
  const cat = t.cash ? 'cash' : (t.category || 'other'), inn = t.amount > 0;
  const tag = t.cash ? '<span class="tag cash">CASH</span>' : t.pending ? '<span class="tag pend">PENDING</span>' : t.manual ? '<span class="tag manual">MANUAL</span>' : '';
  const sub = t.cash ? 'Cash · logged on this phone' : t.note || `${CAT[t.category] || 'Other'}${S.tab !== 'activity' ? ' · ' + wdShort(t.date) : ''}`;
  return `<button class="row tx" ${t.cash ? '' : `data-action="tx" data-id="${esc(t.id)}"`}><div class="ico ${cat}">${ic(cat)}</div><div class="mid"><div class="t1"><span class="nm">${esc(t.merchant)}</span>${tag}</div>
    <div class="t2">${esc(sub)}</div></div><div class="amt ${inn ? 'in' : ''}">${inn ? '+' : ''}${fmt(t.amount)}</div>
    ${t.cash ? `<span class="x sm" role="button" tabindex="0" data-action="del-cash" data-id="${esc(t.id)}" aria-label="Remove cash entry">${ic('x')}</span>` : ''}</button>`;
}

/* ---------------- Bills ---------------- */
function billRow(b) {
  const t = todayISO(), dd = dn(b.post) - dn(t), isRent = b.id === 'rent';
  let t2, amt, when = '', soon = false;
  if (b.paid) {
    t2 = b.auto && b.auto.date && !(b.key in paidMap()) ? `Paid ${shortDate(b.auto.date)} · seen in bank` : 'Marked paid on this phone';
    amt = fmt(billAmt(b));
  } else {
    const late = dd < 0;
    t2 = isRent ? (b.sa ? `Cash · ${fmt0(b.sa.withdrawn)} of ${fmt0(b.sa.amount)} set aside` : 'Pay in cash')
      : late ? `Expected ${shortDate(b.post)} · not in the bank yet` : b.post !== b.date ? `Due ${ordinal(+b.due_day)} · usually posts ${shortDate(b.post)}` : `Due ${shortDate(b.date)}`;
    if (b.note && !isRent) t2 += ` · ${b.note}`;
    amt = (b.approx ? '~' : '') + smart(+b.amount);
    when = late ? 'late' : dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : `in ${dd}d`; soon = dd <= 3;
  }
  return `<div class="row bill ${b.paid ? 'is-paid' : ''} ${!b.paid && dd < 0 ? 'late' : ''}" data-key="${esc(b.key)}">
    <button class="chk ${b.paid ? 'on' : ''}" role="checkbox" aria-checked="${b.paid}" data-action="paid" data-key="${esc(b.key)}" aria-label="${b.paid ? 'Mark unpaid' : 'Mark paid'}: ${esc(b.name)}">${ic(b.icon || 'bills', 'bi')}${ic('check', 'ck')}</button>
    <div class="mid"><div class="t1"><span class="nm">${esc(b.name)}</span>${tagHTML(b.tags)}</div><div class="t2">${esc(t2)}</div></div>
    <div class="amt">${esc(amt)}${when ? `<small class="when ${soon ? 'soon' : ''}">${esc(when)}</small>` : ''}</div></div>`;
}
const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
function vBills() {
  const d = D(), bills = d.bills || {}, all = billInstances(), np = nextPayday(), t = todayISO();
  const rentB = all.find(b => b.id === 'rent'), up = all.filter(b => !b.paid && b.id !== 'rent').sort(byDue), paid = all.filter(b => b.paid).sort(byDue);
  const soon = up.filter(b => b.post < (np || '9999')), later = up.filter(b => b.post >= (np || '9999'));
  const month = dfmt(`${t.slice(0, 7)}-01`, { month: 'long' });
  let h = `<div class="page-h"><div class="eyebrow">Money out · ${esc(month)}</div><h1 class="h-title">Bills</h1></div>`;
  const prog = all.length ? paid.length / all.length : 0;
  const toGo = billSum(up) + (rentB && !rentB.paid ? billAmt(rentB) : 0);
  h += `<div class="card pad-s bill-prog"><div class="bp-top"><span><b>${paid.length}</b> of ${all.length} paid</span><span>~${esc(fmt0(toGo))} still to go</span></div>${bar(prog, 'mint')}</div>`;
  const r = d.rent;
  if (r && rentB && !rentB.paid) {
    const pct = Math.min(1, r.withdrawn / r.amount);
    h += `<div class="card rent bill" data-key="${esc(rentB.key)}"><div class="rent-h"><button class="chk" role="checkbox" aria-checked="false" data-action="paid" data-key="${esc(rentB.key)}" aria-label="Mark paid: Rent">${ic('home', 'bi')}${ic('check', 'ck')}</button><div class="mid"><div class="t1">Rent · ${fmt0(r.amount)} cash</div><div class="t2">Due ${esc(wdShort(r.due))} · ${fmt0(r.per_payday)} from paydays ${r.paydays.map(x => esc(shortDate(x))).join(' & ')}</div></div></div>
      ${bar(pct, pct >= 0.99 ? 'mint' : '')}<div class="meta"><span><b>${fmt0(r.withdrawn)}</b> set aside</span><span>${r.left_to_set_aside > 0 ? `${fmt0(r.left_to_set_aside)} to go${r.owed_now > 0 ? ` · ${fmt0(r.owed_now)} due now` : ''}` : 'All set'}</span></div></div>`;
  }
  h += secH(`Before payday${np ? ' · ' + wd(np) + ' ' + shortDate(np) : ''}`, soon.length ? `${soon.length} · ~${fmt0(billSum(soon))}` : 'Nothing due') +
    `<div class="card list" id="bills-up">${soon.length ? soon.map(billRow).join('') : `<div class="empty">Nothing else comes out before payday.</div>`}</div>`;
  if (later.length) h += secH('Later this month', `${later.length} · ~${fmt0(billSum(later))}`) + `<div class="card list" id="bills-later">${later.map(billRow).join('')}</div>`;
  h += `<div class="sec-h"><h3>Paid</h3><span>${paid.length ? `${paid.length} · ${esc(fmt(billSum(paid)))}` : 'Tap a circle when you pay'}</span></div>
    <div class="card list paid-list" id="bills-paid">${paid.length ? paid.map(billRow).join('') : `<div class="empty">Nothing paid yet this month.</div>`}</div>`;
  if (bills.weekly_reserve) {
    const load = bills.load, need = load ? load.weekly + 150 : null, ok = need == null || bills.weekly_reserve >= need - 1;
    h += secH('Weekly bill reserve') + `<div class="card reserve"><div class="ico">${ic('shield')}</div><div class="mid"><div class="v money">${moneyHTML(+bills.weekly_reserve, { auto: true })}<small> / week</small></div>
      <div class="s">${esc(bills.reserve_note || '')}</div>${need != null ? `<div class="chip-row">${pill(ok ? 'mint' : 'amber', ok ? `Covers ${fmt0(need)}/wk of bills + rent` : `Short: bills + rent are ${fmt0(need)}/wk`)}</div>` : ''}</div></div>`;
  }
  const subs = d.subscriptions, can = bills.cancelled || [];
  if (subs && subs.active) {
    h += secH('Subscriptions', `${fmt(subs.monthly_total)}/mo`) + `<div class="card list">${subs.active.map(s => `<div class="row"><div class="ico subs">${ic(s.icon || 'subs')}</div><div class="mid"><div class="t1"><span class="nm">${esc(s.name)}</span></div><div class="t2">Around the ${ordinal(s.day)} · ${fmt0(s.amount * 12)}/yr</div></div><div class="amt">${fmt(s.amount)}</div></div>`).join('')}</div>`;
  }
  if (can.length) {
    const flagged = can.filter(c => c.charged_after && c.charged_after.length), saved = can.reduce((s, c) => s + (+c.amount || 0), 0);
    h += `<div class="card list cancelled ${S.showCancelled ? "open" : ""}"><button class="cancel-toggle" data-action="toggle-cancelled" aria-expanded="${S.showCancelled}">
      <span class="mid"><span class="t1">Cancelled</span><span class="t2">${can.length} cancelled · saves ~${fmt0(saved)}/mo${flagged.length ? ` · <b class="neg">${flagged.length} still charging</b>` : ''}</span></span>${ic('chevD', 'chev')}</button>
      ${(S.showCancelled ? can : flagged).map(c => `<div class="row"><div class="ico subs">${ic(c.icon || 'subs')}</div><div class="mid"><div class="t1"><span class="nm">${esc(c.name)}</span></div>
        <div class="t2">${c.charged_after && c.charged_after.length ? `<b class="neg">Charged after cancel:</b> ${esc(c.charged_after.map(x => `${fmt(x.amount)} ${shortDate(x.date)}`).join(' · '))}` : `${c.via ? 'via ' + esc(c.via) + ' · ' : ''}Cancelled`}</div></div>
        <div class="amt strike">${fmt(+c.amount)}</div></div>`).join('')}</div>`;
  }
  return h;
}

/* ---------------- Activity ---------------- */
function txList() {
  const d = D(), f = FILTERS.find(x => x[0] === S.filter) || FILTERS[0], q = S.q.trim().toLowerCase();
  const cash = cashAll().map(x => ({ id: x.id, date: x.date, merchant: x.note || 'Cash spend', amount: -x.amount, category: x.cat === 'fun' ? 'fun' : 'food', cash: true }));
  let tx = [...cash, ...(d.transactions || [])];
  if (f[2]) tx = tx.filter(t => f[2].includes(t.category));
  if (q) tx = tx.filter(t => (t.merchant + ' ' + (t.desc || '') + ' ' + (CAT[t.category] || '') + ' ' + (t.note || '') + ' ' + Math.abs(t.amount).toFixed(2)).toLowerCase().includes(q));
  return tx.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
}
function vActivity() {
  const chk = acct('checking'), sav = acct('savings');
  let h = `<div class="page-h"><div class="eyebrow">Checking ••${esc((chk || {}).mask || '')}${sav ? ` · Savings ••${esc(sav.mask)}` : ''}</div><h1 class="h-title">Activity</h1></div>
    <div class="seg2" role="tablist"><button role="tab" class="${S.actView === 'list' ? 'on' : ''}" data-action="actview" data-v="list" aria-selected="${S.actView === 'list'}">Transactions</button>
      <button role="tab" class="${S.actView === 'insights' ? 'on' : ''}" data-action="actview" data-v="insights" aria-selected="${S.actView === 'insights'}">Insights</button></div>`;
  if (S.actView === 'insights') return h + vInsights();
  h += `<label class="search">${ic('search')}<input id="q" type="search" placeholder="Search merchant, amount, category" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search transactions">${S.q ? `<button class="x sm" data-action="clear-q" aria-label="Clear search">${ic('x')}</button>` : ''}</label>
    <div class="filters" role="tablist">${FILTERS.map(x => `<button class="fchip ${x[0] === S.filter ? 'on' : ''}" data-action="filter" data-f="${x[0]}" aria-pressed="${x[0] === S.filter}">${x[1]}</button>`).join('')}</div><div id="tx-list">${txGroups()}</div>`;
  return h;
}
function txGroups() {
  const tx = txList();
  if (!tx.length) return `<div class="card empty">${S.q ? `No matches for “${esc(S.q)}”.` : 'No transactions here.'}</div>`;
  const tot = tx.reduce((s, t) => s + t.amount, 0);
  let h = `<div class="list-sum">${plural(tx.length, 'transaction')} · net ${tot > 0 ? '+' : ''}${fmt(tot)}</div>`;
  const groups = []; for (const t of tx.slice(0, 200)) { const g = groups[groups.length - 1]; if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] }); }
  for (const g of groups) {
    const rel = dn(todayISO()) - dn(g.date), label = rel === 0 ? 'Today' : rel === 1 ? 'Yesterday' : dfmt(g.date, { weekday: 'long', month: 'short', day: 'numeric' });
    const net = g.items.reduce((s, t) => s + t.amount, 0);
    h += `<div class="day-h"><span>${esc(label)}</span><span>${net > 0 ? '+' : ''}${fmt(net)}</span></div><div class="card list">${g.items.map(txRow).join('')}</div>`;
  }
  return h;
}
function vInsights() {
  const ins = D().insights; if (!ins) return `<div class="card empty">Insights arrive with the next data update.</div>`;
  const wk = weekCalc(0), rows = [['Food', 'food', wk ? wk.food.spent : ins.this_week.food, 'food'], ['Eating out', 'eating_out', wk ? wk.food.eatingOut : ins.this_week.eating_out, 'food'],
    ['Groceries & snacks', 'groceries', wk ? wk.food.groceries : ins.this_week.groceries, 'groceries'], ['Fun', 'fun_total', wk ? wk.fun.spent : ins.this_week.fun_total, 'fun'], ['Gas', 'gas', wk ? wk.gas : ins.this_week.gas, 'gas']];
  const mx = Math.max(1, ...rows.map(r => Math.max(r[2], ins.avg_4w[r[1]] || 0)));
  const mon = dfmt(`${ins.month}-01`, { month: 'long' });
  let h = secH('This week vs your 4-week average') + `<div class="card pad-s cmp">${rows.map(([n, k, v, ic_]) => {
    const a = ins.avg_4w[k] || 0, diff = v - a;
    return `<div class="cmp-row"><div class="cmp-h"><span>${ic(ic_)}${n}</span><span><b>${fmt0(v)}</b> <small class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? '+' : '−'}${fmt0(Math.abs(diff))} vs avg</small></span></div>
      <div class="cmp-bars"><i class="now" style="width:${(v / mx * 100).toFixed(1)}%"></i><i class="avg" style="width:${(a / mx * 100).toFixed(1)}%"></i></div></div>`; }).join('')}
    <div class="cmp-key"><span><i class="now"></i>This week (so far)</span><span><i class="avg"></i>Avg of last 4 weeks</span></div></div>`;
  h += `<div class="tiles">
    <div class="card tile"><div class="lbl">${ic('food')}Eating out · ${esc(mon)}</div><div class="v">${countM(ins.eating_out_month, '', { cents: false })}</div><div class="s">${plural(ins.eating_out_count, 'visit')} · fast food ${fmt0(ins.fast_food_month)}</div></div>
    <div class="card tile"><div class="lbl">${ic('groceries')}Groceries · ${esc(mon)}</div><div class="v">${countM(ins.groceries_month, '', { cents: false })}</div><div class="s">Gas ${fmt0(ins.gas_month)} · Fun ${fmt0(ins.fun_month)}</div></div></div>`;
  if (ins.top_merchants.length) h += secH(`Top places · ${mon}`) + `<div class="card list">${ins.top_merchants.map((m, i) => `<button class="row" data-action="search" data-q="${esc(m.merchant)}"><div class="rank">${i + 1}</div><div class="mid"><div class="t1"><span class="nm">${esc(m.merchant)}</span></div><div class="t2">${plural(m.count, 'purchase')}</div></div><div class="amt">${fmt(m.amount)}</div></button>`).join('')}</div>`;
  const subs = D().subscriptions;
  if (subs) h += secH('Subscriptions', `${fmt(subs.monthly_total)}/mo · ${fmt0(subs.monthly_total * 12)}/yr`, 'data-action="nav" data-tab="bills" class="link"');
  const since = isoOf(dn(todayISO()) - 30), recent = (D().transactions || []).filter(t => t.date >= since);
  const inn = recent.filter(t => t.amount > 0 && (t.category === 'income' || t.category === 'refund')).reduce((s, t) => s + t.amount, 0);
  const out = recent.filter(t => t.amount < 0 && t.category !== 'transfer').reduce((s, t) => s - t.amount, 0);
  h += `<div class="tiles"><div class="card tile"><div class="lbl">${ic('income')}In · 30 days</div><div class="v pos">${countM(inn, '', { cents: false })}</div><div class="s">Paychecks & refunds</div></div>
    <div class="card tile"><div class="lbl">${ic('trend')}Out · 30 days</div><div class="v">${countM(out, '', { cents: false })}</div><div class="s">Not counting transfers</div></div></div>`;
  return h;
}

/* ---------------- Goals ---------------- */
function vGoals() {
  const go = goalOf(); let h = `<div class="page-h"><div class="eyebrow">Savings goal</div><h1 class="h-title">Goals</h1></div>`;
  if (!go) return h + `<div class="card empty">No goals yet.</div>`;
  const { g, p } = go, sav = acct('savings'), st = D().steam;
  const onTrack = go.left.length && go.need <= (+g.per_payday || 0) + 0.005;
  h += `<div class="card goal-hero">${ring(go.pct)}<div class="info"><div class="gname">${ic(g.icon || 'gamepad')}${esc(g.name)}</div>
      <div class="big">${countM(go.saved)}</div><div class="sub">of ${smart(go.target)} · by ${esc(dfmt(g.due, { month: 'short', day: 'numeric', year: 'numeric' }))}</div>
      ${pill(go.saved >= go.target ? 'violet' : onTrack ? 'mint' : 'amber', go.saved >= go.target ? 'Funded' : onTrack ? 'On pace' : 'Behind plan')}</div></div>
    <div class="stats"><div class="stat"><div class="k">To go</div><div class="v">${fmt0(go.togo)}</div></div><div class="stat"><div class="k">Paydays left</div><div class="v">${go.left.length}</div></div>
      <div class="stat"><div class="k">Needed / payday</div><div class="v ${onTrack ? '' : 'neg'}">${fmt0(go.need)}</div></div></div>`;
  const eta = iso => iso ? esc(dfmt(iso, { month: 'short', day: 'numeric', year: 'numeric' })) : 'not at this pace';
  h += secH('When you\'ll get there') + `<div class="card list proj">
    <div class="row"><div class="ico income">${ic('target')}</div><div class="mid"><div class="t1">To hit ${esc(shortDate(g.due))}</div><div class="t2">${fmt(go.need)} every payday for ${plural(go.left.length, 'payday')}</div></div><div class="amt">${fmt0(go.need)}<small class="when">/payday</small></div></div>
    ${p.plan_per_payday ? `<div class="row"><div class="ico fun">${ic('calendar')}</div><div class="mid"><div class="t1">At your plan, ${fmt0(p.plan_per_payday)}/payday</div><div class="t2">If nothing comes back out of savings</div></div><div class="amt sm">${eta(p.eta_plan)}</div></div>` : ''}
    ${p.actual_per_payday ? `<div class="row"><div class="ico transfer">${ic('transfer')}</div><div class="mid"><div class="t1">At what you've moved, ${fmt0(p.actual_per_payday)}/wk</div><div class="t2">Average transfer in over 8 weeks</div></div><div class="amt sm">${eta(p.eta_actual)}</div></div>` : ''}
    ${p.net_weekly_8w != null ? `<div class="row"><div class="ico ${p.net_weekly_8w > 0 ? 'groceries' : 'fees'}">${ic('trend')}</div><div class="mid"><div class="t1">Real growth, ${p.net_weekly_8w >= 0 ? '+' : ''}${fmt0(p.net_weekly_8w)}/wk</div><div class="t2">After money pulled back out (${fmt0(Math.abs(D().savings_pulled_8w || 0))} in 8 weeks)</div></div><div class="amt sm">${eta(p.eta_net)}</div></div>` : ''}</div>`;
  if (st) h += `<div class="card pad-s"><div class="bp-top"><span>This week's transfer</span><span><b>${fmt0(st.done)}</b> of ${fmt0(st.per_payday)}</span></div>${bar(st.done / st.per_payday, st.done >= st.per_payday ? 'mint' : '')}</div>`;
  const series = D().savings_series;
  if (series && series.length > 7) h += secH('Savings balance', `last ${Math.round(series.length / 7)} weeks`) + `<div class="card pad-s chart">${savingsChart(series, go.target)}</div>`;
  if (sav) h += `<p class="fine">${ic('info')}Counts Member Savings ••${esc(sav.mask)}${sav.current - sav.available > 0.004 ? ` (${fmt(sav.current - sav.available)} of it is held by the bank, likely the membership share)` : ''}.</p>`;
  return h;
}
function savingsChart(series, target) {
  const W = 340, H = 140, pad = 6, vals = series.map(s => s[1]), max = Math.max(...vals, 50) * 1.1, n = series.length;
  const x = i => pad + i * (W - 2 * pad) / (n - 1), y = v => H - pad - (v / max) * (H - 2 * pad - 14);
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s[1]).toFixed(1)}`).join(' ');
  const hi = vals.indexOf(Math.max(...vals)), last = vals[n - 1];
  const lbl = (i, v, anchor) => `<text x="${x(i).toFixed(1)}" y="${(y(v) - 7).toFixed(1)}" text-anchor="${anchor}">${fmt0(v)}</text>`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings balance over time, now ${fmt0(last)}, peak ${fmt0(vals[hi])}">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ef0b0" stop-opacity=".35"/><stop offset="1" stop-color="#3ef0b0" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${x(0)},${H - pad} ${pts} ${x(n - 1)},${H - pad}" fill="url(#sg)"/><polyline points="${pts}" fill="none" stroke="#3ef0b0" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="${x(hi)}" cy="${y(vals[hi])}" r="3.5" fill="#3ef0b0"/>${lbl(hi, vals[hi], hi > n * 0.7 ? 'end' : 'middle')}
    <circle cx="${x(n - 1)}" cy="${y(last)}" r="4" fill="#fff"/>${hi !== n - 1 ? lbl(n - 1, last, 'end') : ''}</svg>
    <div class="chart-x"><span>${esc(shortDate(series[0][0]))}</span><span>${esc(shortDate(series[n - 1][0]))}</span></div>`;
}

/* ---------------- render ---------------- */
const VIEWS = { home: vHome, week: vWeek, bills: vBills, activity: vActivity, goals: vGoals };
function render(anim = true, dir = 0) {
  const scr = $('#screen');
  scr.className = 'screen' + (anim ? ' animate' + (dir > 0 ? ' from-r' : dir < 0 ? ' from-l' : '') : '');
  scr.innerHTML = VIEWS[S.tab]();
  document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === S.tab; t.classList.toggle('active', on); t.setAttribute('aria-current', on ? 'page' : 'false'); });
  $('.tab-ind').style.setProperty('--i', TABS.indexOf(S.tab));
  const up = $('#updated'), gen = D().generated_at;
  up.querySelector('span').textContent = updatedLabel(gen).replace(/^Updated yesterday /, 'Yesterday ').replace(/^Updated (?=[A-Z][a-z]{2} \d)/, '').replace(/^Updated /, '');
  up.classList.toggle('stale', isStale(gen));
  up.title = `${updatedLabel(gen)} · ${nextLabel(gen)}. ${BANK_NOTE}`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    scr.querySelectorAll('[data-off]').forEach(c => c.style.strokeDashoffset = c.dataset.off);
    scr.querySelectorAll('[data-w]').forEach(b => b.style.width = Math.max(1.5, +b.dataset.w) + '%');
    if (anim) countUp(scr);
  }));
  if (!anim) scr.querySelectorAll('[data-off]').forEach(c => { c.style.transition = 'none'; });
  const q = $('#q'); if (q) q.addEventListener('input', () => { S.q = q.value; $('#tx-list').innerHTML = txGroups(); const x = q.parentElement.querySelector('.x'); if (!!S.q !== !!x) { const pos = q.selectionStart; render(false); const q2 = $('#q'); q2.focus(); q2.setSelectionRange(pos, pos); } });
}
function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = [...root.querySelectorAll('[data-count]')], t0 = performance.now(), dur = 700, ease = t => 1 - Math.pow(1 - t, 3);
  const paint = (el, v) => { el.innerHTML = moneyHTML(v, { cents: el.dataset.fmt !== 'm0' }); };
  const tick = now => { const k = ease(Math.min(1, (now - t0) / dur)); els.forEach(el => paint(el, +el.dataset.count * k)); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function skeleton() {
  $('#lock').hidden = true; $('#app').hidden = false;
  $('#screen').innerHTML = `<div class="skel"><i class="s1"></i><i class="s2"></i><i class="s3"></i><div class="sk-row"><i></i><i></i></div><i class="s4"></i><i class="s4"></i></div>`;
}

/* ---------------- sheets & toasts ---------------- */
function toast(msg, ms = 2600, tone = '') {
  const t = document.createElement('div'); t.className = 'toast' + (tone ? ' ' + tone : ''); t.setAttribute('role', 'status'); t.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  document.querySelectorAll('#toasts .toast').forEach(o => o.remove());
  $('#toasts').appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}
function openSheet(html, onMount) {
  closeSheet(true);
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><button class="x sheet-x" data-action="close" aria-label="Close">${ic('x')}</button>${html}</div>`;
  o.addEventListener('click', e => { if (e.target === o) closeSheet(); });
  // swipe down to close
  const sh = o.querySelector('.sheet'); let y0 = null, dy = 0;
  sh.addEventListener('touchstart', e => { if (sh.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = dy ? `translateY(${dy}px)` : ''; }, { passive: true });
  sh.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; if (dy > 90) closeSheet(); else sh.style.transform = ''; });
  $('#sheet-root').appendChild(o); onMount && onMount(o);
}
function closeSheet(now) {
  const o = $('#sheet-root .overlay'); if (!o) return;
  if (now) return o.remove();
  o.classList.add('out'); setTimeout(() => { o.remove(); if (S.pendingReload) location.reload(); }, 240);
}
const kv = (k, v, cls = '') => `<div class="kv ${cls}"><span>${k}</span><b>${v}</b></div>`;
function safeSheet() {
  const sc = safeCalc(), cf = D().cashflow || {}, wk = sc.wk, np = nextPayday();
  let h = `<h2>Safe to spend · ${fmt(sc.amount)}</h2><p class="sub">Money you can spend until ${esc(np ? wdShort(np) : 'payday')} without coming up short for bills. It's the smaller of two numbers:</p>`;
  h += `<div class="calc"><div class="calc-h">1 · What checking can spare</div>${kv('Checking available', fmt(cf.available ?? 0))}
    ${(cf.bills_before_payday || []).map(b => kv(`${esc(b.name)} · ${esc(wd(b.date))} ${esc(shortDate(b.date))}`, '−' + fmt(b.amount))).join('')}
    ${cf.rent_owed > 0 ? kv('Rent cash still to set aside', '−' + fmt(cf.rent_owed)) : ''}${cf.steam_owed > 0 ? kv('Steam Frame transfer still to move', '−' + fmt(cf.steam_owed)) : ''}
    ${cf.cushion > 0 ? kv(`Cushion for the bill crunch ahead`, '−' + fmt(cf.cushion)) : ''}${kv('Can spare', fmt(sc.cashflow), 'tot')}</div>`;
  if (cf.cushion > 0 && cf.cushion_weeks) {
    const w = cf.cushion_weeks.find(x => x.net < 0);
    if (w) h += `<p class="fine">${ic('info')}Week of ${esc(shortDate(w.payday))}: ${esc(w.items.map(i => `${i.name} ${fmt0(i.amount)}`).join(', '))} = ${fmt0(w.bills_out)}, but the paycheck's bill reserve only adds ${fmt0(w.reserve_in)}. The cushion keeps that covered.</p>`;
  }
  h += `<div class="calc"><div class="calc-h">2 · Your food + fun budget</div>${kv('Food left', fmt(wk.food.left))}${kv('Fun left', fmt(wk.fun.left))}${kv('Budget left', fmt(sc.budgetLeft), 'tot')}</div>
    <p class="fine">${ic('check')}<span>Safe to spend is the smaller one: <b>${fmt(sc.amount)}</b>. ${sc.days ? `Spread over ${plural(sc.days, 'day')} that's ${fmt(sc.perDay)}/day.` : ''}</span></p>`;
  openSheet(h);
}
function txSheet(id) {
  const t = (D().transactions || []).find(x => x.id === id); if (!t) return;
  const inn = t.amount > 0, a = (D().accounts || []).find(x => x.mask === t.account);
  const sameM = (D().transactions || []).filter(x => x.merchant === t.merchant && x.amount < 0), m30 = sameM.filter(x => x.date >= isoOf(dn(todayISO()) - 30));
  openSheet(`<div class="tx-head"><div class="ico big ${t.category}">${ic(t.category)}</div><h2>${esc(t.merchant)}</h2><div class="tx-amt ${inn ? 'pos' : ''}">${inn ? '+' : ''}${fmt(t.amount)}</div>
      ${t.pending ? pill('amber', 'Pending') : ''}</div>
    <div class="calc">${kv('Date', esc(dfmt(t.date, { weekday: 'long', month: 'long', day: 'numeric' })))}${kv('Category', esc(CAT[t.category] || t.category))}
      ${bucketOf(t.category) ? kv('Counts toward', bucketOf(t.category) === 'food' ? 'Food budget' : 'Fun budget') : ''}
      ${kv('Account', esc(a ? `${a.name} ••${a.mask}` : t.account ? '••' + t.account : '—'))}${t.desc ? kv('Bank says', esc(t.desc)) : ''}${t.note ? kv('Note', esc(t.note)) : ''}
      ${t.od ? kv('What it is', 'Automatic overdraft-protection transfer between your own accounts') : ''}</div>
    ${sameM.length > 1 ? `<p class="fine">${ic('pie')}${esc(t.merchant)}: ${plural(m30.length, 'charge')} in the last 30 days (${fmt(m30.reduce((s, x) => s - x.amount, 0))}), ${plural(sameM.length, 'charge')} since ${esc(shortDate(sameM[sameM.length - 1].date))}.</p>
      <button class="btn ghost block" data-action="search" data-q="${esc(t.merchant)}">${ic('search')}See all ${esc(t.merchant)}</button>` : ''}`);
}
function acctSheet(kind) {
  const a = acct(kind); if (!a) return;
  const holds = (D().holds || []).filter(h => h.account === a.mask), bank = D().bank_synced_at;
  openSheet(`<h2>${esc(a.name)} ••${esc(a.mask)}</h2><p class="sub">${bank ? `Bank synced ${esc(whenPT(bank))}.` : ''} ${esc(BANK_NOTE)}</p>
    <div class="calc">${kv('Available to spend', fmt(a.available), 'tot')}${kv('Current balance', fmt(a.current))}${holds.map(h => kv('On hold', fmt(h.gap))).join('')}</div>
    ${holds.map(h => `<p class="fine">${ic('clock')}${fmt(h.gap)} difference: ${esc(h.why)}.</p>`).join('')}
    <p class="fine">${ic('info')}<span>MoneyMan uses <b>available</b> for safe-to-spend, because that's what the bank will let you spend right now.</span></p>`);
}
function cashSheet(preset) {
  let cat = preset === 'fun' ? 'fun' : 'food';
  openSheet(`<h2>I spent cash</h2><p class="sub">Comes out of this week's Food or Fun budget. Saved only on this phone.</p>
    <div class="amt-in"><span>$</span><input id="cash-amt" type="text" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Amount"></div>
    <div class="quick">${[5, 10, 20, 40].map(v => `<button data-q="${v}">$${v}</button>`).join('')}</div>
    <div class="seg" role="radiogroup" aria-label="Food or fun"><button class="${cat === 'food' ? 'on' : ''}" data-c="food" role="radio" aria-checked="${cat === 'food'}">${ic('food')}Food</button><button class="${cat === 'fun' ? 'on' : ''}" data-c="fun" role="radio" aria-checked="${cat === 'fun'}">${ic('fun')}Fun</button></div>
    <input class="text-in" id="cash-note" type="text" placeholder="What was it? (optional)" maxlength="40" autocomplete="off">
    <button class="btn mint block" id="cash-save">Log cash</button>`, o => {
    const amt = $('#cash-amt', o);
    const fit = () => { amt.style.width = Math.max(1, (amt.value || '0').length) * 0.64 + 0.15 + 'em'; };
    fit(); amt.addEventListener('input', fit); setTimeout(() => amt.focus(), 350);
    o.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { amt.value = b.dataset.q; fit(); haptic(); });
    o.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { cat = b.dataset.c; o.querySelectorAll('[data-c]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); haptic(); });
    $('#cash-save', o).onclick = () => {
      const v = Math.round(parseFloat((amt.value || '').replace(/[^0-9.]/g, '')) * 100) / 100;
      if (!(v > 0 && v < 10000)) { amt.parentElement.classList.remove('pop'); void amt.offsetWidth; amt.parentElement.classList.add('pop'); haptic(25); amt.focus(); return; }
      const all = cashAll(); const cur = weekCalc(0);
      all.push({ id: Date.now().toString(36), amount: v, note: $('#cash-note', o).value.trim(), cat, date: todayISO(), week: cur.w.start });
      localStorage.setItem(K_CASH, JSON.stringify(all.slice(-200)));
      closeSheet(); haptic(12); render(false);
      const wb = weekCalc(0)[cat]; toast(`Logged ${fmt(v)} cash · ${cat === 'fun' ? 'Fun' : 'Food'} left ${fmt(wb.left)}`);
    };
  });
}
function menuSheet() {
  const d = D(), gen = d.generated_at;
  openSheet(`<h2>MoneyMan</h2><p class="sub" id="menu-sched">${esc(updatedLabel(gen))}${d.bank_synced_at ? ` · bank synced ${esc(whenPT(d.bank_synced_at))}` : ''}<br>${esc(nextLabel(gen))}</p>
    <button class="menu-row" data-action="refresh"><span class="ico subs">${ic('refresh')}</span><span class="mid">Refresh now<small>Check for newer data and app updates (or pull down on any screen)</small></span></button>
    ${Object.keys(dismissed()).length ? `<button class="menu-row" data-action="undismiss"><span class="ico bills">${ic('alert')}</span><span class="mid">Show dismissed alerts<small>${plural(Object.keys(dismissed()).length, 'alert')} hidden on this phone</small></span></button>` : ''}
    <button class="menu-row" data-action="lock"><span class="ico fun">${ic('lock')}</span><span class="mid">Lock & forget this device<small>You'll need the passcode next time</small></span></button>
    <p class="menu-note">${ic('clock')}<span>Data updates around 9:02 AM and 9:02 PM PT. ${esc(BANK_NOTE)}</span></p>
    <p class="sub" style="margin:14px 0 0;font-size:12px">Version ${esc(VER)} · AES-256-GCM · PBKDF2 ${((S.env && S.env.kdf.iterations) || 0).toLocaleString()}×</p>`);
}

/* ---------------- data refresh ---------------- */
async function refresh(manual) {
  if (S.refreshing && !manual) return; S.refreshing = true;
  const up = $('#updated'); up.classList.add('loading'); document.body.classList.add('refreshing');
  if (manual) { S.holdReload = true; S.swChanged = false; }
  const appUpdate = manual ? checkAppUpdate() : null, t0 = Date.now();
  let msg, tone = '';
  try {
    const env = await fetchEnv(manual);
    if (S.fromCache) throw new Error('offline');
    const before = S.data && S.data.generated_at;
    if (env.ct !== (S.env && S.env.ct)) {
      let key = S.key;
      if (env.kdf.salt !== S.env.kdf.salt || env.kdf.iterations !== S.env.kdf.iterations) {
        const k = savedKey(env); key = k ? await crypto.subtle.importKey('raw', b64d(k), 'AES-GCM', true, ['decrypt']) : null;
      }
      let data = null; if (key) { try { data = await decryptEnv(key, env); } catch (x) { data = null; } }
      if (!data) { S.env = env; S.key = null; S.data = null; S.refreshing = false; document.body.classList.remove('refreshing'); return showLock('Data was re-keyed — enter your passcode.'); }
      S.data = data; S.env = env; S.key = key; render(false);
      const newer = !before || new Date(data.generated_at) > new Date(before);
      msg = newer ? `Updated with data from ${whenPT(data.generated_at)}` : newestMsg(data.generated_at);
    } else msg = newestMsg(S.data.generated_at);
  } catch (e) { msg = `Offline, showing data from ${whenPT(S.data && S.data.generated_at)}.`; tone = 'amber'; }
  finally { S.refreshing = false; }
  if (!manual) { document.body.classList.remove('refreshing'); return up.classList.remove('loading'); }
  await new Promise(r => setTimeout(r, Math.max(0, 500 - (Date.now() - t0))));
  const w = await appUpdate;
  up.classList.remove('loading'); document.body.classList.remove('refreshing'); S.holdReload = false;
  if (S.swChanged || w) S.pendingToast = 'App updated · ' + msg;
  if (S.swChanged) return reloadNow();
  if (w) return activateWorker(w, msg, tone);
  toast(msg, 5200, tone);
}
async function checkAppUpdate() {
  try {
    const reg = S.reg || ('serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null);
    if (!reg) return null;
    await reg.update();
    return reg.waiting || reg.installing || null;
  } catch (e) { return null; }
}
function reloadNow() {
  if (S.reloading) return; S.reloading = true;
  if (S.pendingToast) sessionStorage.setItem(K_TOAST, S.pendingToast);
  location.reload();
}
function activateWorker(w, msg, tone) {
  let done = false;
  const fail = () => { if (done || S.reloading) return; done = true; S.pendingToast = null; toast(msg, 5200, tone); };
  const step = () => {
    if (w.state === 'installed') w.postMessage('skipWaiting');
    else if (w.state === 'activated') { done = true; reloadNow(); }
    else if (w.state === 'redundant') fail();
  };
  w.addEventListener('statechange', step); step();
  setTimeout(() => { if (w.state === 'activating' || w.state === 'activated') { done = true; reloadNow(); } else fail(); }, 10000);
}

/* ---------------- paid toggles (FLIP animation between lists) ---------------- */
function togglePaid(btn) {
  const key = btn.dataset.key, b = billInstances().find(x => x.key === key); if (!b || S.flipping) return;
  const val = !b.paid; S.flipping = true; haptic(val ? 14 : 8);
  btn.classList.toggle('on', val); btn.setAttribute('aria-checked', val); btn.classList.add('tapped');
  setTimeout(() => {
    setPaid(key, val, !!b.auto);
    const before = {}; document.querySelectorAll('.bill[data-key]').forEach(el => before[el.dataset.key] = el.getBoundingClientRect().top);
    render(false);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('.bill[data-key]').forEach(el => {
      const t0 = before[el.dataset.key]; if (t0 == null || reduce) return;
      const dy = t0 - el.getBoundingClientRect().top; if (Math.abs(dy) < 1) return;
      const moving = el.dataset.key === key;
      if (moving) { el.style.position = 'relative'; el.style.zIndex = 3; el.classList.add('moving'); }
      const an = el.animate(moving ? [{ transform: `translateY(${dy}px) scale(1.02)` }, { transform: 'none' }] : [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: moving ? 520 : 420, easing: 'cubic-bezier(.2,.9,.25,1)' });
      an.onfinish = () => { el.style.zIndex = ''; el.classList.remove('moving'); };
    });
    toast(val ? `${b.name} marked paid` : `${b.name} moved back to upcoming`);
    setTimeout(() => { S.flipping = false; }, 300);
  }, 200);
}

/* ---------------- pull to refresh ---------------- */
function setupPull() {
  const main = $('#main'), ind = $('#ptr'); let y0 = null, dy = 0;
  main.addEventListener('touchstart', e => { if (main.scrollTop <= 0 && !S.refreshing && !$('#sheet-root .overlay')) { y0 = e.touches[0].clientY; dy = 0; } else y0 = null; }, { passive: true });
  main.addEventListener('touchmove', e => {
    if (y0 == null) return; dy = e.touches[0].clientY - y0;
    if (dy <= 0) { ind.style.transform = ''; ind.classList.remove('show', 'ready'); return; }
    const p = Math.min(1, dy / 80); ind.classList.add('show'); ind.classList.toggle('ready', p >= 1);
    ind.style.transform = `translate(-50%, ${Math.min(70, dy * 0.6)}px) rotate(${p * 270}deg)`; ind.style.opacity = p;
  }, { passive: true });
  main.addEventListener('touchend', () => {
    if (y0 == null) return; y0 = null;
    const go = ind.classList.contains('ready'); ind.classList.remove('show', 'ready'); ind.style.transform = ''; ind.style.opacity = '';
    if (go) { haptic(10); refresh(true); }
  });
}

/* ---------------- events & boot ---------------- */
function go(tab) {
  if (!VIEWS[tab]) return; haptic(); closeSheet(true);
  if (tab === S.tab) { $('#main').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const dir = Math.sign(TABS.indexOf(tab) - TABS.indexOf(S.tab));
  S.tab = tab; sessionStorage.setItem(K_TAB, tab); $('#main').scrollTop = 0; render(true, dir);
}
function startApp() {
  $('#lock').hidden = true; $('#app').hidden = false;
  const t = new URLSearchParams(location.search).get('tab') || sessionStorage.getItem(K_TAB);
  if (t && VIEWS[t]) S.tab = t;
  render(true);
  const pend = sessionStorage.getItem(K_TOAST);
  if (pend) { sessionStorage.removeItem(K_TOAST); setTimeout(() => toast(pend, 5200), 450); }
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action;
  if (['cash', 'tip', 'del-cash', 'paid', 'dismiss'].includes(a)) e.stopPropagation();
  if (a === 'nav') go(el.dataset.tab);
  else if (a === 'filter') { S.filter = el.dataset.f; haptic(); const sc = $('.filters').scrollLeft; render(false); $('.filters').scrollLeft = sc; }
  else if (a === 'actview') { S.actView = el.dataset.v; haptic(); render(false); }
  else if (a === 'clear-q') { S.q = ''; render(false); }
  else if (a === 'search') { closeSheet(true); S.q = el.dataset.q; S.filter = 'all'; S.actView = 'list'; if (S.tab !== 'activity') go('activity'); else render(false); }
  else if (a === 'week') { const n = weekList().length; S.weekIdx = Math.max(0, Math.min(n - 1, S.weekIdx + +el.dataset.d)); haptic(); render(true, -el.dataset.d); }
  else if (a === 'cash') { haptic(); cashSheet(el.dataset.b); }
  else if (a === 'paid') togglePaid(el);
  else if (a === 'tx') { haptic(); txSheet(el.dataset.id); }
  else if (a === 'safe') { haptic(); safeSheet(); }
  else if (a === 'acct') { haptic(); acctSheet(el.dataset.k); }
  else if (a === 'dismiss') { const d = dismissed(); d[el.dataset.id] = Date.now(); localStorage.setItem(K_DISMISS, JSON.stringify(d)); haptic(); const c = el.closest('.alert'); c.classList.add('gone'); setTimeout(() => render(false), 260); }
  else if (a === 'undismiss') { localStorage.removeItem(K_DISMISS); closeSheet(); render(false); toast('Alerts are back'); }
  else if (a === 'more-alerts') { S.allAlerts = !S.allAlerts; haptic(); render(false); }
  else if (a === 'toggle-cancelled') { S.showCancelled = !S.showCancelled; haptic(); render(false); }
  else if (a === 'del-cash') {
    localStorage.setItem(K_CASH, JSON.stringify(cashAll().filter(c => c.id !== el.dataset.id))); haptic(); render(false); toast('Cash entry removed');
  }
  else if (a === 'tip') { localStorage.setItem(K_TIP, '1'); render(false); }
  else if (a === 'menu') { haptic(); menuSheet(); }
  else if (a === 'close') closeSheet();
  else if (a === 'refresh') { closeSheet(); refresh(true); }
  else if (a === 'lock') { localStorage.removeItem(K_KEY); S.key = null; S.data = null; closeSheet(true); showLock('Locked. Enter your passcode to open MoneyMan.'); }
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
$('#main').addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', $('#main').scrollTop > 4), { passive: true });
$('#lock-form').addEventListener('submit', onUnlock);
$('#eye').addEventListener('click', () => { const p = $('#pass'), on = p.type === 'password'; p.type = on ? 'text' : 'password'; $('#eye').classList.toggle('on', on); });
$('#pass').addEventListener('input', () => { $('#field').classList.remove('bad'); $('#lock-err').textContent = ''; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (S.reg) S.reg.update().catch(() => {});
  if (S.data && Date.now() - S.lastFetch > 5 * 60e3) refresh(false);
  else if (S.data) render(false);  // dates may have rolled over
});
setupPull();

async function boot() {
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || S.reloading) return;
      if (S.holdReload) { S.swChanged = true; return; }
      if ($('#sheet-root .overlay')) { S.reloading = true; if (S.pendingToast) sessionStorage.setItem(K_TOAST, S.pendingToast); S.pendingReload = true; }
      else reloadNow();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { S.reg = r; }).catch(() => {});
  }
  if (savedKey(null)) skeleton();  // remembered device: show the app shell right away while data loads
  try { S.env = await fetchEnv(); } catch (e) { return showLock("Can't reach MoneyMan right now. Connect to the internet and try again."); }
  const k = savedKey(S.env);
  if (k) {
    try {
      S.key = await crypto.subtle.importKey('raw', b64d(k), 'AES-GCM', true, ['decrypt']);
      S.data = await decryptEnv(S.key, S.env); return startApp();
    } catch (e) { localStorage.removeItem(K_KEY); S.key = null; }
  }
  showLock();
}
window.__MM = { S, render, goalOf, weekCalc, safeCalc, todayISO, billInstances, beforePayday, nextUpdate, whenPT, newestMsg, nextLabel, ptEpoch, refresh, isStale, txList };
boot();
})();
