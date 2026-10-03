/* MoneyMan — private money tracker PWA. Data arrives as an AES-GCM encrypted blob (data.enc.json) and is
   decrypted only in the browser with a key derived from Carlos's passcode (PBKDF2-SHA256, 600k iterations). */
(() => {
'use strict';
const VER = '__VER__';
const TZ = 'America/Los_Angeles';
const K_KEY = 'moneyman.key.v1', K_CASH = 'moneyman.cash.v1', K_TIP = 'moneyman.tip.v1', K_TAB = 'moneyman.tab.v1';
const $ = (s, r = document) => r.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();
const S = { env: null, key: null, data: null, tab: 'home', filter: 'all', lastFetch: 0, animate: true };

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
const ic = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24">${P[n] || P.other}</svg>`;
const CAT = { food: 'Eating out', groceries: 'Groceries', fun: 'Fun', subs: 'Subscription', shopping: 'Shopping', gas: 'Gas',
  bills: 'Bills', fees: 'Bank fee', income: 'Income', transfer: 'Transfer', cash: 'Cash', other: 'Other' };
const FILTERS = [['all', 'All'], ['food', 'Food', ['food', 'groceries']], ['fun', 'Fun', ['fun', 'subs']], ['shopping', 'Shopping', ['shopping', 'gas']],
  ['bills', 'Bills', ['bills', 'fees']], ['income', 'Income', ['income']], ['transfer', 'Transfers', ['transfer', 'cash']]];

/* ---------------- formatting & dates ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, cents = true) => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const fmt0 = v => fmt(Math.round(v), false);
const smart = v => (Math.abs(v - Math.round(v)) < 0.005 ? fmt0(v) : fmt(v));
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
const relDay = iso => { const d = dn(iso) - dn(todayISO()); return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : d > 1 ? `in ${d} days` : `${-d} days ago`; };
function updatedLabel(ts) {
  const d = new Date(ts); if (isNaN(d)) return 'Updated';
  const p = ptParts(d), t = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
  const iso = `${p.year}-${p.month}-${p.day}`, rel = dn(todayISO()) - dn(iso);
  return `Updated ${rel === 0 ? '' : rel === 1 ? 'yesterday ' : shortDate(iso) + ', '}${t} PT`;
}
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
  try { const s = JSON.parse(localStorage.getItem(K_KEY) || 'null'); if (s && s.salt === env.kdf.salt && s.iter === env.kdf.iterations) return s.k; } catch (e) {}
  return null;
}
async function fetchEnv() {
  const r = await fetch('data.enc.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('offline');
  const env = await r.json(); if (!env.ct) throw new Error('bad data');
  S.lastFetch = Date.now(); return env;
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
const goalSaved = g => g.saved != null ? +g.saved : (g.sources || []).reduce((s, x) => s + (+x.amount || 0), 0);
function nextPayday() {
  const p = D().paycheck || {}; let n = p.next_date ? dn(p.next_date) : null; const t = dn(todayISO());
  if (n == null) return null; while (n < t) n += 7; return isoOf(n);
}
function paydays(fromIso, toIso) { // payday dates from `fromIso` (a payday) every 7 days up to `toIso`
  const out = []; if (!fromIso || !toIso) return out;
  for (let n = dn(fromIso); n <= dn(toIso); n += 7) out.push(isoOf(n)); return out;
}
function goalCalc(g) {
  const saved = goalSaved(g), target = +g.target, togo = Math.max(0, target - saved), np = nextPayday();
  const end = g.window ? (g.due && g.window[1] > g.due ? g.due : g.window[1]) : g.due;
  let left = np && end ? paydays(np, end) : [];
  if (g.window) left = left.filter(d => d >= g.window[0]);
  const per = +g.per_payday || 0, projected = saved + per * left.length;
  const need = left.length ? togo / left.length : togo;
  let status = 'on', label = 'On pace';
  if (saved >= target) { status = 'done'; label = 'Funded'; }
  else if (per && projected + 0.005 < target) { status = 'behind'; label = `Short ${fmt0(target - projected)}`; }
  let hitDate = null;
  if (per && togo > 0) { const k = Math.ceil(togo / per - 1e-9); if (np) hitDate = isoOf(dn(np) + 7 * (k - 1)); }
  const pct = target ? Math.min(1, saved / target) : 0;
  const days = g.due ? dn(g.due) - dn(todayISO()) : null;
  return { saved, target, togo, left, per, projected, need, status, label, hitDate, pct, days, end };
}
function cashEntries() {
  try { return (JSON.parse(localStorage.getItem(K_CASH) || '[]') || []).filter(e => e.week === D().week.start); } catch (e) { return []; }
}
function weekCalc() {
  const w = D().week, cash = cashEntries();
  const spentData = (w.purchases || []).reduce((s, p) => s + (+p.amount || 0), 0);
  const spentCash = cash.reduce((s, c) => s + c.amount, 0);
  const spent = spentData + spentCash, budget = +w.budget, left = budget - spent;
  const t = dn(todayISO()), st = dn(w.start), en = dn(w.end);
  const daysLeft = Math.max(0, Math.min(en - st + 1, en - Math.max(t, st) + 1));
  const elapsed = Math.min(1, Math.max(0, (t - st + 1) / (en - st + 1)));
  const pct = budget ? spent / budget : 0;
  const tone = pct > 1 ? 'red' : pct > 0.8 ? 'amber' : '';
  return { w, cash, spent, budget, left, daysLeft, elapsed, pct, tone, perDay: daysLeft ? Math.max(0, left) / daysLeft : 0 };
}

/* ---------------- render ---------------- */
function ring(pct, size = 142, stroke = 13, id = 'rg') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${size}" y1="${size / 2}" x2="0" y2="${size / 2}"><stop offset="0" stop-color="#3ef0b0"/><stop offset=".6" stop-color="#34c8ff"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs>
    <circle class="trk" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="val" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#${id})" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - Math.max(pct, 0.012))}"/>
  </svg><div class="ctr"><div class="pct num" data-count="${(pct * 100).toFixed(1)}" data-fmt="pct">${Math.round(pct * 100)}<small>%</small></div><div class="of">saved</div></div></div>`;
}
const countM = (v, cls = '', o = {}) => `<span class="money ${cls}" data-count="${v}" data-fmt="${o.cents === false ? 'm0' : 'm'}">${moneyHTML(v, o)}</span>`;
const statusPill = c => `<span class="pill ${c.status === 'behind' ? 'amber' : c.status === 'done' ? 'violet' : ''}"><i></i>${esc(c.label)}</span>`;

function greeting() {
  const h = +ptParts().hour; return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function vHome() {
  const d = D(), g = (d.goals || []).find(x => x.featured) || (d.goals || [])[0], wk = weekCalc(), chk = acct('checking'), np = nextPayday(), pc = d.paycheck || {};
  const bday = (d.goals || []).find(x => x !== g);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let h = `<div class="greet"><div class="date">${esc(dfmt(todayISO(), { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
    <h1 class="h-title">${greeting()}, ${esc(d.name || 'Carlos')}</h1></div>`;
  if (d.headline) h += `<div class="card nudge pressable" data-action="nav" data-tab="week"><div class="ico">${ic('chef')}</div><div><div class="t">${esc(d.headline)}</div>${d.headline_detail ? `<div class="s">${esc(d.headline_detail)}</div>` : ''}</div></div>`;
  if (g) {
    const c = goalCalc(g);
    h += `<div class="card hero-goal pressable" data-action="nav" data-tab="goals">${ring(c.pct)}
      <div class="info"><div class="gname">${ic(g.icon || 'target')}${esc(g.name)}</div>
      <div class="big">${countM(c.saved)}</div><div class="sub">of ${smart(c.target)} goal</div><div class="sub"><b style="color:var(--text);font-weight:600">${fmt(c.togo)}</b> to go</div>${statusPill(c)}</div></div>`;
  }
  const tone = wk.tone;
  h += `<div class="tiles">
    <div class="card tile glow-mint pressable" data-action="nav" data-tab="week"><div><div class="lbl">${ic('food')}Food & fun left</div>
      <div class="v ${wk.left < 0 ? 'red' : ''}">${countM(wk.left)}</div><div class="s">${wk.daysLeft ? `${fmt(wk.perDay)}/day · ${wk.daysLeft} day${wk.daysLeft > 1 ? 's' : ''}` : 'Week ended'}</div></div>
      <div class="mini ${tone}"><b data-w="${Math.min(100, wk.pct * 100)}"></b></div>
      <button class="add" data-action="cash" aria-label="I spent cash">${ic('plus')}</button></div>
    <div class="card tile glow-cyan pressable" data-action="nav" data-tab="activity"><div><div class="lbl">${ic('wallet')}Checking</div>
      <div class="v">${chk ? countM(chk.available) : '—'}</div><div class="s">${chk ? `Available · ••${esc(chk.mask)}` : ''}</div></div></div>
    <div class="card tile glow-violet"><div><div class="lbl">${ic('calendar')}Next payday</div>
      <div class="v money">${np ? esc(shortDate(np)) : '—'}</div>
      <div class="s">${np ? `${esc(dfmt(np, { weekday: 'long' }))} · ${relDay(np)}` : ''}</div>${pc.typical_min ? `<div class="s" style="margin-top:2px">${esc(pc.employer || 'Paycheck')} ~${fmt0(pc.typical_min)}–${fmt0(pc.typical_max)}</div>` : ''}</div></div>`;
  if (bday) {
    const b = goalCalc(bday);
    h += `<div class="card tile glow-pink pressable" data-action="nav" data-tab="goals"><div><div class="lbl">${ic(bday.icon || 'gift')}${esc(bday.short || 'Birthday fund')}</div>
      <div class="v">${countM(b.saved, '', { cents: false })}<span style="font-size:14px;color:var(--dim);font-family:var(--body);font-weight:500;letter-spacing:0"> / ${fmt0(b.target)}</span></div>
      <div class="s">${b.days != null ? `${b.days} days to go` : ''}</div></div><div class="mini pink"><b data-w="${b.pct * 100}"></b></div></div>`;
  }
  h += `</div>`;
  const up = upcomingBills().filter(b => b.date).slice(0, 2);
  if (up.length) h += `<div class="sec-h"><h3>Coming up</h3><span>${esc(fmtTotal(upcomingBills()))} upcoming</span></div>
    <div class="card list pressable" data-action="nav" data-tab="bills">${up.map(billRow).join('')}</div>`;
  if (ios && !standalone && !localStorage.getItem(K_TIP)) h += `<div class="card install"><div class="mid">Install: tap <b>Share</b> then <b>Add to Home Screen</b> to open MoneyMan like an app.</div><button class="del x" data-action="tip" aria-label="Dismiss">${ic('x')}</button></div>`;
  return h;
}

function vGoals() {
  const goals = D().goals || [];
  let h = `<div><div class="eyebrow">Savings goals</div><h1 class="h-title">Goals</h1></div>`;
  for (const g of goals) {
    const c = goalCalc(g), color = g.color || 'mint', barCls = color === 'pink' ? 'pink' : color === 'violet' ? 'violet' : '';
    const dueTxt = g.due ? `${g.window ? '' : 'By '}${dfmt(g.due, { weekday: g.window ? 'short' : undefined, month: 'short', day: 'numeric', year: g.window ? undefined : 'numeric' })}${c.days != null && c.days >= 0 ? ` · ${c.days} days` : ''}` : '';
    h += `<div class="card goal"><div class="goal-head"><div class="ico ${color}">${ic(g.icon || 'target')}</div><div class="mid"><div class="nm">${esc(g.name)}</div><div class="dd">${esc(dueTxt)}</div></div>${statusPill(c)}</div>
      <div class="goal-amt">${countM(c.saved)}<span class="of">of ${smart(c.target)}</span></div>
      <div class="bar ${barCls}"><b data-w="${c.pct * 100}"></b></div>
      <div class="goal-meta"><span><b>${Math.round(c.pct * 100)}%</b> saved</span><span><b>${fmt(c.togo)}</b> to go</span></div>
      <div class="stats"><div class="stat"><div class="k">Paydays left</div><div class="v">${c.left.length}</div></div>
        <div class="stat"><div class="k">Need / payday</div><div class="v">${fmt(c.need)}</div></div>
        <div class="stat"><div class="k">${c.status === 'behind' ? 'At plan pace' : 'Projected'}</div><div class="v">${fmt0(c.projected)}</div></div></div>`;
    if (g.sources && g.sources.length) h += `<div class="chips">${g.sources.map((s, i) => `<span class="chip"><i style="background:${['#3ef0b0', '#34c8ff', '#8b7bff'][i % 3]}"></i>${esc(s.label)} <b>${fmt(+s.amount)}</b></span>`).join('')}</div>`;
    if (g.window) {
      const all = paydays(g.window[0], g.window[1]); let cover = goalSaved(g); const np = nextPayday();
      h += `<div class="paydays">${all.map(d => { const ok = cover >= c.per - 0.005; if (ok) cover -= c.per; const past = d < np;
        const cls = ok ? 'done' : past ? 'miss' : d === np ? 'next' : '';
        return `<div class="pd ${cls}"><i>${ok ? ic('check') : past ? '!' : ''}</i>${esc(shortDate(d))}</div>`; }).join('')}</div>`;
    }
    if (g.per_payday) {
      const ok = c.status !== 'behind';
      const msg = c.status === 'done' ? `Fully funded — nice work.` : ok
        ? `<b>${esc(g.plan_note || `${fmt0(c.per)} each payday`)}</b> gets you to ${smart(c.target)}${c.hitDate ? ` by <b>${esc(wdShort(c.hitDate))}</b>` : ''}. You only need ${fmt(c.need)}/payday — ${fmt(c.per - c.need)} of cushion.`
        : `<b>${esc(g.plan_note || `${fmt0(c.per)} each payday`)}</b> reaches ${fmt0(c.projected)}. Set aside <b>${fmt(c.need)}</b> on each of the next ${c.left.length} paydays${c.target - c.projected > 0 ? `, or ${fmt0(c.target - c.projected)} extra once` : ''}, to hit ${smart(c.target)}.`;
      h += `<div class="plan ${ok ? '' : 'amber'}">${ic(ok ? 'trend' : 'alert')}<div>${msg}</div></div>`;
    }
    if (g.breakdown && g.breakdown.length) {
      const cols = ['#ff7ab6', '#ffb547', '#8b7bff', '#34c8ff', '#3ef0b0'], tot = g.breakdown.reduce((s, b) => s + (+b.amount || 0), 0);
      h += `<div class="bk"><div class="eyebrow" style="margin-top:16px">The plan · ${smart(tot)}</div><div class="stack">${g.breakdown.map((b, i) => `<i style="flex:${b.amount};background:${cols[i % 5]}"></i>`).join('')}</div>
        ${g.breakdown.map((b, i) => `<div class="row"><div class="ico" style="color:${cols[i % 5]};background:${cols[i % 5]}22">${ic(b.icon || 'sparkle')}</div><div class="mid"><div class="t1">${esc(b.label)}</div></div><div class="amt">${b.approx ? '~' : ''}${smart(+b.amount)}</div></div>`).join('')}</div>`;
    }
    h += `</div>`;
  }
  if (!goals.length) h += `<div class="card empty">No goals yet.</div>`;
  return h;
}

function purchaseRow(p) {
  const cat = p.category || 'food';
  const tag = p.cash ? '<span class="tag cash">CASH</span>' : p.manual ? '<span class="tag manual">MANUAL</span>' : '';
  return `<div class="row"><div class="ico ${p.cash ? 'cash' : cat}">${ic(p.cash ? 'cash' : cat)}</div><div class="mid"><div class="t1"><span class="nm">${esc(p.merchant)}</span>${tag}</div>
    <div class="t2">${esc(wdShort(p.date))}${p.note ? ' · ' + esc(p.note) : ' · ' + esc(CAT[cat] || '')}</div></div><div class="amt">${fmt(p.amount)}</div>
    ${p.cash ? `<button class="del" data-action="del-cash" data-id="${esc(p.id)}" aria-label="Remove cash entry">${ic('x')}</button>` : ''}</div>`;
}
function vWeek() {
  const c = weekCalc(), w = c.w;
  const status = c.left < 0 ? ['red', `Over by ${fmt(-c.left)}`] : c.pct > 0.8 ? ['amber', 'Almost gone'] : c.pct > c.elapsed + 0.08 ? ['amber', 'Spending fast'] : ['', 'On track'];
  let h = `<div><div class="eyebrow">Food & fun · Wed–Tue</div><h1 class="h-title">This week</h1><div class="h-sub">${esc(wdShort(w.start))} – ${esc(wdShort(w.end))}</div></div>
    <div class="card week-hero"><div class="top"><div><div class="eyebrow">Left to spend</div><div class="big ${c.left < 0 ? 'red' : ''}">${countM(c.left)}</div></div><span class="pill ${status[0]}"><i></i>${status[1]}</span></div>
      <div class="bar ${c.tone}"><b data-w="${Math.min(100, c.pct * 100)}"></b><span class="tick" style="left:calc(${(c.elapsed * 100).toFixed(1)}% - 1px)"></span></div>
      <div class="goal-meta"><span><b>${Math.round(c.pct * 100)}%</b> spent</span><span>Day ${Math.round(c.elapsed * 7)} of 7</span></div>
      <div class="trio"><div class="stat"><div class="k">Budget</div><div class="v">${fmt0(c.budget)}</div></div><div class="stat"><div class="k">Spent</div><div class="v">${fmt(c.spent)}</div></div><div class="stat"><div class="k">Left</div><div class="v" style="color:${c.left < 0 ? '#ff8792' : 'var(--mint)'}">${fmt(c.left)}</div></div></div>
      ${w.budget_breakdown ? `<div class="formula">${w.budget_breakdown.map((b, i) => `<span>${i ? (b.amount < 0 ? '− ' : '+ ') : ''}${esc(b.label)} <b>${smart(Math.abs(b.amount))}</b></span>`).join('')}<span>= <b>${fmt0(c.budget)}</b></span></div>` : ''}
    </div>
    <div class="card allow"><div class="ico">${ic('clock')}</div><div class="mid"><div class="v money">${c.daysLeft ? moneyHTML(c.perDay) : '$0'}<span style="font-size:14px;color:var(--dim);font-family:var(--body);font-weight:500;letter-spacing:0"> / day</span></div>
      <div class="s">${c.daysLeft ? `for the next ${c.daysLeft} day${c.daysLeft > 1 ? 's' : ''} · new week ${esc(wdShort(isoOf(dn(w.end) + 1)))}` : 'Week is over — fresh budget on payday'}</div></div></div>
    <button class="btn mint block" data-action="cash">${ic('plus')}I spent cash</button>`;
  const items = [...(w.purchases || []), ...c.cash.map(x => ({ ...x, merchant: x.note || (x.cat === 'fun' ? 'Cash · fun' : 'Cash · food'), note: x.note ? 'Cash · this phone' : 'This phone', category: x.cat, cash: true }))]
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  h += `<div class="sec-h"><h3>This week's purchases</h3><span>${items.length} · ${fmt(c.spent)}</span></div>
    <div class="card list">${items.length ? items.map(purchaseRow).join('') : '<div class="empty">Nothing yet this week 🎉</div>'}</div>`;
  return h;
}

function upcomingBills() {
  const b = (D().bills || {}).upcoming || [];
  return [...b].sort((x, y) => (x.date ? 0 : 1) - (y.date ? 0 : 1) || String(x.date).localeCompare(String(y.date)));
}
const fmtTotal = list => { const t = list.reduce((s, b) => s + (b.amount ? +b.amount : 0), 0); return `~${fmt0(t)}`; };
function billRow(b) {
  const tags = (b.tags || []).map(t => `<span class="tag ${esc(t.toLowerCase())}">${esc(t)}</span>`).join('');
  const d = b.date ? dn(b.date) - dn(todayISO()) : null;
  const when = d == null ? '' : d < 0 ? 'past due?' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`;
  return `<div class="row"><div class="ico bills">${ic(b.icon || 'bills')}</div><div class="mid"><div class="t1"><span class="nm">${esc(b.name)}</span>${tags}</div>
    <div class="t2">${esc(b.date_label || (b.date ? shortDate(b.date) : 'Date TBD'))}${b.note ? ' · ' + esc(b.note) : ''}</div></div>
    <div class="amt">${b.amount != null ? (b.approx ? '~' : '') + smart(+b.amount) : 'Varies'}${when ? `<small class="when ${d != null && d <= 3 ? 'soon' : ''}">${when}</small>` : ''}</div></div>`;
}
function vBills() {
  const bills = D().bills || {}, up = upcomingBills(), dated = up.filter(b => b.date), undated = up.filter(b => !b.date), can = bills.cancelled || [];
  const saved = can.reduce((s, c) => s + (+c.amount || 0), 0);
  let h = `<div><div class="eyebrow">Money out</div><h1 class="h-title">Bills</h1></div>`;
  if (bills.weekly_reserve) h += `<div class="card reserve"><div class="ico">${ic('shield')}</div><div><div class="eyebrow">Weekly bill reserve</div>
    <div class="v money" style="margin-top:6px">${moneyHTML(+bills.weekly_reserve, { auto: true })}<small>/ week</small></div><div class="s">${esc(bills.reserve_note || 'Set aside every payday')}</div></div></div>`;
  h += `<div class="sec-h"><h3>Upcoming</h3><span>${dated.length + undated.length} bills</span></div><div class="card list">${dated.map(billRow).join('')}
    <div class="total-row" style="margin-bottom:${undated.length ? 0 : 12}px"><span>Scheduled total</span><span class="money">${esc(fmtTotal(dated))}</span></div></div>`;
  if (undated.length) h += `<div class="sec-h"><h3>Date not set</h3><span>${esc(fmtTotal(undated))}</span></div><div class="card list">${undated.map(billRow).join('')}</div>`;
  if (can.length) h += `<div class="sec-h"><h3>Cancelled</h3><span>${can.length} subscriptions</span></div>
    <div class="card saved-hero"><div class="ico" style="background:rgba(62,240,176,.16);color:var(--mint);width:52px;height:52px;border-radius:17px">${ic('sparkle')}</div>
      <div><div class="eyebrow">You're saving</div><div class="v money" style="margin-top:6px">~${moneyHTML(Math.round(saved), { cents: false })}<span style="font-size:15px;color:var(--dim);font-family:var(--body);font-weight:500;letter-spacing:0;text-shadow:none"> / month</span></div>
      <div class="s">That's ~${fmt0(saved * 12)} a year back in your pocket</div></div></div>
    <div class="card list">${can.map(c => `<div class="row"><div class="ico subs">${ic(c.icon || 'subs')}</div><div class="mid"><div class="t1"><span class="nm">${esc(c.name)}</span></div><div class="t2">${c.via ? 'via ' + esc(c.via) + ' · ' : ''}Cancelled</div></div>
      <div class="amt strike">${fmt(+c.amount)}</div><span class="cancel-ok">${ic('check')}</span></div>`).join('')}</div>`;
  return h;
}

function vActivity() {
  const d = D(), f = FILTERS.find(x => x[0] === S.filter) || FILTERS[0];
  const cash = cashEntries().map(x => ({ date: x.date, merchant: x.note || 'Cash spend', amount: -x.amount, category: x.cat, cashLocal: true }));
  let tx = [...cash, ...(d.transactions || [])];
  if (f[2]) tx = tx.filter(t => f[2].includes(t.category));
  tx.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  const since = isoOf(dn(todayISO()) - 30), recent = (d.transactions || []).filter(t => t.date >= since);
  const inn = recent.filter(t => t.amount > 0 && t.category === 'income').reduce((s, t) => s + t.amount, 0);
  const out = recent.filter(t => t.amount < 0 && !['transfer'].includes(t.category)).reduce((s, t) => s - t.amount, 0);
  let h = `<div><div class="eyebrow">Checking ••${esc((acct('checking') || {}).mask || '')}${acct('savings') ? ` · Savings ••${esc(acct('savings').mask)}` : ''}</div><h1 class="h-title">Activity</h1></div>
    <div class="act-sum"><div class="card tile glow-mint"><div class="lbl">${ic('income')}In · 30 days</div><div class="v money" style="font-size:22px;color:var(--mint)">${moneyHTML(inn, { cents: false })}</div></div>
      <div class="card tile glow-pink"><div class="lbl">${ic('trend')}Out · 30 days</div><div class="v money" style="font-size:22px">${moneyHTML(out, { cents: false })}</div></div></div>
    <div class="filters" role="tablist">${FILTERS.map(x => `<button class="fchip ${x[0] === S.filter ? 'on' : ''}" data-action="filter" data-f="${x[0]}">${x[1]}</button>`).join('')}</div>`;
  if (!tx.length) return h + `<div class="card empty">No ${esc(f[1].toLowerCase())} transactions.</div>`;
  const groups = []; for (const t of tx.slice(0, 120)) { const g = groups[groups.length - 1]; if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] }); }
  for (const g of groups) {
    const rel = dn(todayISO()) - dn(g.date), label = rel === 0 ? 'Today' : rel === 1 ? 'Yesterday' : dfmt(g.date, { weekday: 'long', month: 'short', day: 'numeric' });
    const net = g.items.reduce((s, t) => s + t.amount, 0);
    h += `<div class="day-h"><span>${esc(label)}</span><span>${net > 0 ? '+' : ''}${fmt(net)}</span></div><div class="card list">${g.items.map(t => {
      const cat = t.cashLocal ? 'cash' : (t.category || 'other'), inn = t.amount > 0;
      const tag = t.cashLocal ? '<span class="tag cash">CASH</span>' : t.manual ? '<span class="tag manual">MANUAL</span>' : t.pending ? '<span class="tag">PENDING</span>' : '';
      return `<div class="row"><div class="ico ${cat}">${ic(cat)}</div><div class="mid"><div class="t1"><span class="nm">${esc(t.merchant)}</span>${tag}</div>
        <div class="t2">${esc(t.cashLocal ? 'Cash · logged on this phone' : t.note || (CAT[t.category] || 'Other') + (t.account ? ` · ••${t.account}` : ''))}</div></div>
        <div class="amt ${inn ? 'in' : ''}">${inn ? '+' : ''}${fmt(t.amount)}</div></div>`; }).join('')}</div>`;
  }
  return h;
}

const VIEWS = { home: vHome, goals: vGoals, week: vWeek, bills: vBills, activity: vActivity };
function render(anim = true) {
  const scr = $('#screen'), tabs = Object.keys(VIEWS);
  scr.className = 'screen' + (anim ? ' animate' : '');
  scr.innerHTML = VIEWS[S.tab]();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === S.tab));
  $('.tab-ind').style.setProperty('--i', tabs.indexOf(S.tab));
  const up = $('#updated'); up.querySelector('span').textContent = updatedLabel(D().generated_at);
  up.classList.toggle('stale', Date.now() - new Date(D().generated_at) > 36 * 3600e3);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    scr.querySelectorAll('[data-off]').forEach(c => c.style.strokeDashoffset = anim ? c.dataset.off : c.dataset.off);
    scr.querySelectorAll('[data-w]').forEach(b => b.style.width = Math.max(1.5, +b.dataset.w) + '%');
    if (anim) countUp(scr);
  }));
  if (!anim) scr.querySelectorAll('[data-off]').forEach(c => { c.style.transition = 'none'; });
}
function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = [...root.querySelectorAll('[data-count]')], t0 = performance.now(), dur = 900;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const paint = (el, v) => {
    const f = el.dataset.fmt;
    el.innerHTML = f === 'pct' ? `${Math.round(v)}<small>%</small>` : moneyHTML(v, { cents: f !== 'm0' });
  };
  const tick = now => {
    const k = ease(Math.min(1, (now - t0) / dur));
    els.forEach(el => paint(el, +el.dataset.count * k));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------------- sheets & toasts ---------------- */
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
}
function openSheet(html, onMount) {
  closeSheet(true);
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  o.addEventListener('click', e => { if (e.target === o) closeSheet(); });
  $('#sheet-root').appendChild(o); onMount && onMount(o);
}
function closeSheet(now) {
  const o = $('#sheet-root .overlay'); if (!o) return;
  if (now) return o.remove();
  o.classList.add('out'); setTimeout(() => o.remove(), 240);
}
function cashSheet() {
  let cat = 'food';
  openSheet(`<h2>I spent cash</h2><p class="sub">Comes out of this week's food & fun. Saved only on this phone.</p>
    <div class="amt-in"><span>$</span><input id="cash-amt" type="text" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Amount"></div>
    <div class="quick">${[5, 10, 20, 40].map(v => `<button data-q="${v}">$${v}</button>`).join('')}</div>
    <div class="seg"><button class="on" data-c="food">Food</button><button data-c="fun">Fun</button></div>
    <input class="text-in" id="cash-note" type="text" placeholder="What was it? (optional)" maxlength="40" autocomplete="off">
    <button class="btn mint block" id="cash-save">Log cash</button>`, o => {
    const amt = $('#cash-amt', o);
    const fit = () => { amt.style.width = Math.max(1, (amt.value || '0').length) * 0.64 + 0.15 + 'em'; };
    fit(); amt.addEventListener('input', fit);
    setTimeout(() => amt.focus(), 350);
    o.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { amt.value = b.dataset.q; fit(); haptic(); });
    o.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { cat = b.dataset.c; o.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); haptic(); });
    $('#cash-save', o).onclick = () => {
      const v = Math.round(parseFloat((amt.value || '').replace(/[^0-9.]/g, '')) * 100) / 100;
      if (!(v > 0 && v < 10000)) { amt.parentElement.classList.remove('pop'); void amt.offsetWidth; amt.parentElement.classList.add('pop'); haptic(25); amt.focus(); return; }
      let all = []; try { all = JSON.parse(localStorage.getItem(K_CASH) || '[]'); } catch (e) {}
      all.push({ id: Date.now().toString(36), amount: v, note: $('#cash-note', o).value.trim(), cat, date: todayISO(), week: D().week.start });
      localStorage.setItem(K_CASH, JSON.stringify(all.slice(-200)));
      closeSheet(); haptic(12); render(false);
      toast(`Logged ${fmt(v)} cash · ${fmt(weekCalc().left)} left this week`);
    };
  });
}
function menuSheet() {
  openSheet(`<h2>MoneyMan</h2><p class="sub">${esc(updatedLabel(D().generated_at))} · data refreshes daily</p>
    <button class="menu-row" data-action="refresh"><span class="ico subs">${ic('refresh')}</span><span class="mid">Refresh now<small>Fetch the latest encrypted data</small></span></button>
    <button class="menu-row" data-action="lock"><span class="ico fun">${ic('lock')}</span><span class="mid">Lock & forget this device<small>You'll need the passcode next time</small></span></button>
    <p class="sub" style="margin:14px 0 0;font-size:12px">Version ${esc(VER)} · AES-256-GCM · PBKDF2 ${((S.env && S.env.kdf.iterations) || 0).toLocaleString()}×</p>`);
}

/* ---------------- data refresh ---------------- */
async function refresh(manual) {
  const up = $('#updated'); up.classList.add('loading');
  try {
    const env = await fetchEnv();
    if (env.ct !== (S.env && S.env.ct)) {
      let key = S.key;
      if (env.kdf.salt !== S.env.kdf.salt || env.kdf.iterations !== S.env.kdf.iterations) {
        const k = savedKey(env); key = k ? await crypto.subtle.importKey('raw', b64d(k), 'AES-GCM', true, ['decrypt']) : null;
      }
      if (!key) { S.env = env; S.key = null; S.data = null; return showLock('Data was re-keyed — enter your passcode.'); }
      S.data = await decryptEnv(key, env); S.env = env; S.key = key; render(false);
      if (manual) toast('Fresh data loaded');
    } else if (manual) toast('Already up to date');
  } catch (e) { if (manual) toast("Offline — showing your last data"); }
  finally { up.classList.remove('loading'); }
}

/* ---------------- events & boot ---------------- */
function startApp() {
  $('#lock').hidden = true; $('#app').hidden = false;
  const t = new URLSearchParams(location.search).get('tab') || sessionStorage.getItem(K_TAB);
  if (t && VIEWS[t]) S.tab = t;
  render(true);
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action;
  if (a === 'cash' || a === 'tip' || a === 'del-cash') e.stopPropagation();
  if (a === 'nav') { const t = el.dataset.tab; haptic(); closeSheet(true); if (t === S.tab) { $('#main').scrollTo({ top: 0, behavior: 'smooth' }); return; }
    S.tab = t; sessionStorage.setItem(K_TAB, t); $('#main').scrollTop = 0; render(true); }
  else if (a === 'filter') { S.filter = el.dataset.f; haptic(); const sc = $('.filters').scrollLeft; render(false); $('.filters').scrollLeft = sc; }
  else if (a === 'cash') { haptic(); cashSheet(); }
  else if (a === 'del-cash') {
    let all = []; try { all = JSON.parse(localStorage.getItem(K_CASH) || '[]'); } catch (x) {}
    localStorage.setItem(K_CASH, JSON.stringify(all.filter(c => c.id !== el.dataset.id))); haptic(); render(false); toast('Cash entry removed');
  }
  else if (a === 'tip') { localStorage.setItem(K_TIP, '1'); render(false); }
  else if (a === 'menu') { haptic(); menuSheet(); }
  else if (a === 'refresh') { closeSheet(); refresh(true); }
  else if (a === 'lock') { localStorage.removeItem(K_KEY); S.key = null; S.data = null; closeSheet(true); showLock('Locked. Enter your passcode to open MoneyMan.'); }
}, true);
$('#main').addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', $('#main').scrollTop > 4), { passive: true });
$('#lock-form').addEventListener('submit', onUnlock);
$('#eye').addEventListener('click', () => { const p = $('#pass'), on = p.type === 'password'; p.type = on ? 'text' : 'password'; $('#eye').classList.toggle('on', on); });
$('#pass').addEventListener('input', () => { $('#field').classList.remove('bad'); $('#lock-err').textContent = ''; });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.data && Date.now() - S.lastFetch > 5 * 60e3) refresh(false); });

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
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
window.__MM = { S, render, goalCalc, weekCalc, todayISO };
boot();
})();
