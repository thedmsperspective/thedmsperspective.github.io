// The DM's Perspective — resizable table columns in every app.
//
// Every table gets a thin handle on the right edge of each column heading. Drag it (finger or mouse) to make the
// column wider or thinner. Double-tap (or double-click) a handle to put that table back the way it was.
// Each table remembers its widths on this device (by app and by its column headings).
// A table marked data-noresize is left alone, and so is one whose heading row has merged cells.

const KEY = 'dmp-cols:';
const MIN = 36;

function headRow(t) { return t.tHead?.rows[0] || t.rows[0] || null; }
function cellsOf(t) {
  const r = headRow(t); if (!r) return null;
  const cs = [...r.cells];
  if (cs.length < 2 || cs.some(c => c.colSpan > 1)) return null;
  return cs;
}
function keyOf(t, cs) {
  const names = cs.map(c => c.textContent.trim().replace(/\s+/g, ' ').slice(0, 24)).join('|');
  return KEY + location.pathname.replace(/index\.html$/, '') + ':' + (t.className || '') + ':' + names;
}
function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function save(k, v) { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch {} }

// Fix every column at a width, so a column can be made thinner than its contents would like
function apply(t, cs, widths) {
  cs.forEach((c, i) => { c.style.width = `${widths[i]}px`; c.style.minWidth = ''; });
  t.style.tableLayout = 'fixed';
  t.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
  t.style.maxWidth = 'none';
  t.classList.add('dmp-cols-set');
  // A table wider than its box scrolls sideways instead of pushing the page wider
  const p = t.parentElement;
  if (p && getComputedStyle(p).overflowX === 'visible') p.style.overflowX = 'auto';
}
function reset(t, cs, k) {
  cs.forEach(c => { c.style.width = ''; });
  t.style.tableLayout = ''; t.style.width = ''; t.style.maxWidth = '';
  t.classList.remove('dmp-cols-set');
  save(k, null);
}

function attach(t) {
  if (t.dataset.dmpCols === '1' || t.hasAttribute('data-noresize') || t.closest('[data-noresize]')) return;
  const cs = cellsOf(t); if (!cs) return;
  t.dataset.dmpCols = '1';
  const k = keyOf(t, cs);
  const saved = load(k);
  if (Array.isArray(saved) && saved.length === cs.length) apply(t, cs, saved);
  cs.forEach((c, i) => {
    if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
    const h = document.createElement('span');
    h.className = 'dmp-col-grip'; h.setAttribute('aria-hidden', 'true');
    h.title = 'Drag to make this column wider or thinner. Double-tap to reset the table.';
    c.appendChild(h);
    let x0 = 0, ws = null, lastTap = 0, moved = false;
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const now = Date.now();
      if (now - lastTap < 350) { reset(t, cs, k); lastTap = 0; return; }
      lastTap = now;
      ws = cs.map(x => x.getBoundingClientRect().width);
      apply(t, cs, ws);
      x0 = e.clientX; moved = false;
      h.setPointerCapture(e.pointerId);
      h.classList.add('on');
    });
    h.addEventListener('pointermove', e => {
      if (!ws) return;
      if (Math.abs(e.clientX - x0) > 3) moved = true;
      const w = ws.slice(); w[i] = Math.max(MIN, Math.round(ws[i] + e.clientX - x0));
      apply(t, cs, w);
    });
    const end = () => {
      if (!ws) return;
      ws = null; h.classList.remove('on');
      if (moved) lastTap = 0; // a drag isn't the first tap of a double-tap
      save(k, cs.map(x => Math.round(x.getBoundingClientRect().width)));
    };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    // Don't let the heading's own tap (sorting and so on) fire from the handle
    h.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  });
}

function scan(root = document) { root.querySelectorAll?.('table').forEach(attach); }

let started = false;
export function start() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const st = document.createElement('style');
  st.textContent = `
.dmp-col-grip { position: absolute; top: 0; right: -6px; width: 12px; height: 100%; cursor: col-resize; touch-action: none; z-index: 2; }
.dmp-col-grip::after { content: ''; position: absolute; top: 20%; bottom: 20%; left: 5px; width: 2px; border-radius: 2px; background: currentColor; opacity: .18; }
.dmp-col-grip:hover::after, .dmp-col-grip.on::after { opacity: .6; }
tr > :last-child > .dmp-col-grip { right: 0; }
table.dmp-cols-set td, table.dmp-cols-set th { overflow-wrap: anywhere; }
table.dmp-cols-set td input, table.dmp-cols-set td select, table.dmp-cols-set td textarea { max-width: 100%; min-width: 0; box-sizing: border-box; }
`;
  document.head.appendChild(st);
  scan();
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'TABLE') attach(n); else scan(n); } })
    .observe(document.body, { childList: true, subtree: true });
}
start();
