// The DM's Perspective — the DM's request box.
//
// On the DM's device only, whichever app is open: players' requests that need the DM show up as a small banner.
//   - Ammunition dice: a player recovered ammunition and asks to step their die back up. Approve or Deny right here;
//     the player's sheet follows (it's sent under that character's own secret key: c/<key>/ask and c/<key>/ans).
//   - Shops: a player waiting at a shop while the Shops app isn't open, and offers the General Store owes a price.
//     These open the Shops app, where they're answered.
// Answering in one app clears it in every other app that's open. Nothing here is saved on the device: what's still
// waiting comes back from the live link the next time any app opens.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const dieName = n => (Number(n) >= 4 ? `d${Number(n)}` : Number(n) === 1 ? 'last one' : 'none left');

let S = null, L = null, T = null;
const items = new Map();          // id -> { kind, html, actions, t }
const watchers = new Map();       // character live key -> stop
const hidden = new Set();         // dismissed here (until it changes)
let box = null, shopq = {}, dmq = {}, stopShop = null, stopDmq = null, tick = null;
const inShops = () => /^\/Shops\//i.test(location.pathname);

async function pass() {
  let p = S.signedIn('');
  if (!p && S.refreshNow) p = await S.refreshNow().catch(() => null);
  return p?.value || null;
}

// ---------- the banner
function ensureBox() {
  if (box) return box;
  const st = document.createElement('style');
  st.textContent = `
#dmpReq { position: fixed; top: 10px; right: 10px; z-index: 2147482000; display: flex; flex-direction: column; gap: 8px; width: min(380px, calc(100vw - 20px)); pointer-events: none; font: 15px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
#dmpReq .rq { pointer-events: auto; background: #2a241d; color: #f3ece0; border: 1px solid #6b5a43; border-radius: 12px; box-shadow: 0 8px 26px rgba(0,0,0,.35); padding: 10px 12px; animation: dmpReqIn .18s ease-out; }
#dmpReq .rq .rq-k { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
#dmpReq .rq .rq-t { margin: 2px 0 8px; }
#dmpReq .rq .rq-b { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
#dmpReq .rq button { all: unset; box-sizing: border-box; cursor: pointer; padding: 6px 12px; border-radius: 8px; font-weight: 600; font-size: 14px; border: 1px solid #6b5a43; }
#dmpReq .rq button.ok { background: #e3c27a; color: #2a241d; border-color: #e3c27a; }
#dmpReq .rq button.no { color: #f3ece0; }
#dmpReq .rq button.x { border: 0; opacity: .65; padding: 6px 8px; }
#dmpReq .rq button:disabled { opacity: .5; cursor: default; }
html[data-red="1"] #dmpReq .rq { background: #000; color: #f00; border-color: #f00; }
html[data-red="1"] #dmpReq .rq button.ok { background: #f00; color: #000; border-color: #f00; }
@keyframes dmpReqIn { from { transform: translateY(-6px); opacity: 0; } to { transform: none; opacity: 1; } }
@media print { #dmpReq { display: none; } }`;
  document.head.append(st);
  box = document.createElement('div'); box.id = 'dmpReq'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Requests from players');
  box.addEventListener('click', onClick);
  document.body.append(box);
  return box;
}
function draw() {
  const list = [...items.entries()].filter(([id]) => !hidden.has(id)).sort((a, b) => (a[1].t || 0) - (b[1].t || 0));
  if (!list.length) { if (box) box.innerHTML = ''; return; }
  ensureBox().innerHTML = list.slice(0, 4).map(([id, it]) => `<div class="rq" data-rq="${esc(id)}" role="status">
    <div class="rq-k">${esc(it.kind)}</div><div class="rq-t">${it.html}</div>
    <div class="rq-b">${it.actions.map(a => `<button type="button" class="${a.cls || ''}" data-a="${a.a}">${esc(a.label)}</button>`).join('')}<button type="button" class="x" data-a="hide" aria-label="Hide for now" title="Hide for now">✕</button></div></div>`).join('')
    + (list.length > 4 ? `<div class="rq"><div class="rq-t">${list.length - 4} more waiting.</div></div>` : '');
}
async function onClick(e) {
  const b = e.target.closest('button[data-a]'), card = e.target.closest('[data-rq]'); if (!b || !card) return;
  const id = card.dataset.rq, it = items.get(id); if (!it) return;
  if (b.dataset.a === 'hide') { hidden.add(id); draw(); return; }
  card.querySelectorAll('button').forEach(x => { x.disabled = true; });
  try { await it.run(b.dataset.a); } catch (err) { console.warn('request', err); card.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
}

// ---------- requests from characters (under each character's own key)
function charRequest(ch, key, rid, req) {
  const id = `c:${key.slice(0, 8)}:${rid}`;
  if (!req) { items.delete(id); hidden.delete(id); draw(); return; }
  const who = String(req.who || ch.name || 'A player').slice(0, 60);
  // magic items to take out of the Magic Items app (it does it, the next time it's open): c/<key>/gone/<id>
  const gone = async (cids, why) => L.cput(key, `gone/${rid}`, { cids: cids.map(String).slice(0, 4), why: String(why).slice(0, 120), who, t: Date.now() });
  if (req.kind === 'rift') {
    // a Bag of Holding put inside a Portable Hole (or the like). The player wasn't warned: this one is yours to play out.
    const a = String(req.a || 'a Bag of Holding').slice(0, 60), b = String(req.b || 'another extradimensional space').slice(0, 60);
    items.set(id, {
      kind: 'Astral rift', t: Number(req.t) || Date.now(),
      html: `<b>${esc(who)}</b> put ${esc(a)} inside ${esc(b)}. That opens a gate to the Astral Plane: both are destroyed, and any creature within 10 feet is pulled through.`,
      actions: [{ a: 'yes', label: 'Destroy both', cls: 'ok' }, { a: 'no', label: 'Let it be', cls: 'no' }],
      run: async x => {
        if (x === 'yes') await gone(Array.isArray(req.cids) ? req.cids : [], 'an Astral rift');
        await L.cput(key, `ans/${rid}`, { ok: x === 'yes', t: Date.now() });
        await L.cput(key, `ask/${rid}`, null);
      },
    });
    hidden.delete(id); draw(); return;
  }
  if (req.kind === 'destroy') {
    // the last charge used, and the d20 came up 1
    const what = String(req.name || 'a magic item').slice(0, 60);
    items.set(id, {
      kind: 'Magic item', t: Number(req.t) || Date.now(),
      html: `<b>${esc(who)}</b> says ${esc(what)} was destroyed (its last charge was used, and the roll came up 1).`,
      actions: [{ a: 'yes', label: 'Approve', cls: 'ok' }, { a: 'no', label: 'Deny', cls: 'no' }],
      run: async x => {
        if (x === 'yes') await gone([req.cid], 'its last charge');
        await L.cput(key, `ans/${rid}`, { ok: x === 'yes', t: Date.now() });
        await L.cput(key, `ask/${rid}`, null);
      },
    });
    hidden.delete(id); draw(); return;
  }
  if (req.kind !== 'ammo') return;
  const what = String(req.name || 'ammunition').slice(0, 60);
  items.set(id, {
    kind: 'Ammunition', t: Number(req.t) || Date.now(),
    html: `<b>${esc(who)}</b> recovered ${esc(what)}: ${esc(dieName(req.from))} → <b>${esc(dieName(req.to))}</b>`,
    actions: [{ a: 'yes', label: 'Approve', cls: 'ok' }, { a: 'no', label: 'Deny', cls: 'no' }],
    run: async a => {
      await L.cput(key, `ans/${rid}`, { ok: a === 'yes', t: Date.now() });
      await L.cput(key, `ask/${rid}`, null);
    },
  });
  hidden.delete(id);
  draw();
}
function watchCharacters() {
  const chars = (S.cachedParty?.() || []).filter(c => c.liveKey && String(c.liveKey).length >= 24);
  const want = new Map(chars.map(c => [c.liveKey, c]));
  for (const [k, stop] of watchers) if (!want.has(k)) { stop(); watchers.delete(k); for (const id of [...items.keys()]) if (id.startsWith(`c:${k.slice(0, 8)}:`)) items.delete(id); }
  for (const [k, ch] of want) {
    if (watchers.has(k)) continue;
    watchers.set(k, L.cwatchEach(k, 'ask', (rid, req) => charRequest(ch, k, rid, req), { removed: true }));
  }
  draw();
}

// ---------- the Shops app's requests
const KIND_TEXT = { buy: 'wants to buy something', sell: 'wants to sell something', quote: 'wants an offer from the General Store', repair: 'wants a repair', awaken: 'wants magic awakened', donate: 'wants to make a donation', refill: 'wants ammunition refilled', decline: 'is answering an offer' };
function shopItems() {
  for (const id of [...items.keys()]) if (id.startsWith('s:')) items.delete(id);
  if (!inShops()) {
    // a player waiting at a shop for a few seconds: the Shops app isn't answering anywhere
    const now = Date.now();
    for (const [uid, reqs] of Object.entries(shopq || {})) for (const [rid, req] of Object.entries(reqs || {})) {
      if (!req || now - (Number(req.t) || 0) < 3000) continue;
      items.set(`s:q:${uid}:${rid}`, { kind: 'Shops', t: Number(req.t) || now, html: `<b>${esc(String(req.who || 'A player').slice(0, 60))}</b> ${esc(KIND_TEXT[req.kind] || 'is waiting at a shop')} and is waiting for your Shops app.`, actions: [{ a: 'open', label: 'Open Shops', cls: 'ok' }], run: async () => openShops() });
    }
    // what the Shops app has waiting for you (offers to price)
    for (const [rid, x] of Object.entries(dmq?.shops || {})) {
      if (!x) continue;
      items.set(`s:d:${rid}`, { kind: 'Shops', t: Number(x.t) || 0, html: `<b>${esc(String(x.who || 'A player').slice(0, 60))}</b> ${esc(String(x.text || 'is waiting for you').slice(0, 160))}`, actions: [{ a: 'open', label: 'Open Shops', cls: 'ok' }], run: async () => openShops() });
    }
  }
  draw();
}
function openShops() { const w = window.open('/Shops/index.html', 'dmp-shops'); if (!w) location.href = '/Shops/index.html'; }
async function watchShops() {
  const tid = S.currentTable?.()?.id; if (!tid || stopShop) return;
  T = T || await S.tables?.(); if (!T?.watchShopQueue) return;
  const tok = await pass(); if (!tok) return;
  stopShop = T.watchShopQueue(tok, tid, v => { shopq = v; shopItems(); });
  stopDmq = T.watchDmQueue(tok, tid, v => { dmq = v; shopItems(); });
  tick = setInterval(shopItems, 2500); // a request turns into a banner once it's been waiting a few seconds
}

let started = false;
export async function start() {
  if (started || typeof document === 'undefined') return;
  started = true;
  try { S = await import('/core/suite.js'); } catch { return; }
  if (S.tableRole?.() !== 'dm') return; // only the DM's device gets the box
  try { L = await S.live?.(); } catch { L = null; }
  if (L?.cwatchEach) {
    watchCharacters();
    setInterval(watchCharacters, 60000); // a character added to the party shows up within a minute
    window.addEventListener('storage', e => { if (/party/i.test(e.key || '')) watchCharacters(); });
  }
  watchShops().catch(() => {});
}
if (typeof document !== 'undefined') {
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', () => start());
}
