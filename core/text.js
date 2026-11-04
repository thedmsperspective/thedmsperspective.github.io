// The DM's Perspective — indenting and lists in every text box.
//
// Load it once (import('/core/text.js')) and every multi-line text box in the app can be indented:
//   - Tab / Shift+Tab with a keyboard indents or outdents the line (or every selected line).
//   - On a touchscreen, two small buttons (outdent, indent) float at the top right of the box you're typing in.
//   - Enter on a list line ("- ", "* " or "1. ") starts the next item at the same depth; Enter on an empty item ends the list.
// A text box marked data-plain (lists of months, pasted tables and so on) is left alone.
//
// Indents are stored as tabs (4 spaces read the same). textHTML(text) turns what was typed into HTML for showing it: lines starting "- " or "* " become a bulleted list,
// "1. " a numbered one, and indenting a line under another nests it. Other indented lines keep their indent.

const TAB = '\t';
const BULLET = /^([-*•]|\d+[.)])\s+/;

// ---------- reading the indent of a line: each tab, or each 4 spaces (2 or more counts), is one level
export function levelOf(line) {
  const m = /^[\t ]*/.exec(line)[0];
  let cols = 0;
  for (const ch of m) cols += ch === '\t' ? 4 : 1;
  return cols ? Math.max(1, Math.round(cols / 4)) : 0;
}

const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Typed text to HTML, with nested lists and indented lines. inline(text) formats one line's text (it must escape it);
 *  by default the text is only escaped. */
export function textHTML(text, inline = escHTML) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  let out = '';
  const stack = []; // open lists: { tag, level }
  const close = lv => { while (stack.length && stack[stack.length - 1].level >= lv) out += `</li></${stack.pop().tag}>`; };
  for (const raw of lines) {
    const lv = levelOf(raw), body = raw.replace(/^[\t ]+/, '');
    const b = BULLET.exec(body);
    if (b) {
      const tag = /\d/.test(b[1]) ? 'ol' : 'ul';
      close(lv + 1);
      const top = stack[stack.length - 1];
      if (top && top.level === lv && top.tag === tag) out += '</li><li>';
      else {
        if (top && top.level === lv) out += `</li></${stack.pop().tag}>`;
        const start = tag === 'ol' && parseInt(b[1], 10) !== 1 ? ` start="${parseInt(b[1], 10)}"` : '';
        out += `<${tag} class="dmp-list"${start}><li>`;
        stack.push({ tag, level: lv });
      }
      out += inline(body.slice(b[0].length));
      continue;
    }
    if (!body) { close(0); out += '<div class="dmp-line dmp-gap"></div>'; continue; }
    // A plain line indented under a list item belongs to that item
    const top = stack[stack.length - 1];
    if (top && lv > top.level) { close(lv); out += `<br>${inline(body)}`; continue; }
    close(0);
    out += `<div class="dmp-line"${lv ? ` style="padding-left:${lv * 1.5}em"` : ''}>${inline(body)}</div>`;
  }
  close(0);
  return `<div class="dmp-text">${out}</div>`;
}

// ---------- editing
function lineSpan(ta) {
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
  const a = v.lastIndexOf('\n', s - 1) + 1;
  let b = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e); if (b < 0) b = v.length;
  return { v, s, e, a, b };
}
// Replace a part of the text so the browser's undo still works
function replace(ta, a, b, text) {
  ta.focus();
  ta.setSelectionRange(a, b);
  const want = ta.value.slice(0, a) + text + ta.value.slice(b);
  let ok = false;
  try { ok = a === b && !text ? true : document.execCommand(text ? 'insertText' : 'delete', false, text); } catch { ok = false; }
  if (!ok || ta.value !== want) {
    ta.value = want;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.setSelectionRange(a + text.length, a + text.length);
}
function outdentLine(l) { return l.startsWith(TAB) ? l.slice(1) : l.replace(/^ {1,4}/, ''); }

export function indent(ta, back = false) {
  const { v, s, e, a, b } = lineSpan(ta);
  const lines = v.slice(a, b).split('\n');
  const next = lines.map(l => (back ? outdentLine(l) : (l.trim() || lines.length === 1 ? TAB + l : l)));
  const text = next.join('\n');
  if (text === v.slice(a, b)) return;
  const firstDelta = next[0].length - lines[0].length;
  replace(ta, a, b, text);
  if (s === e) { const p = Math.max(a, s + firstDelta); ta.setSelectionRange(p, p); }
  else ta.setSelectionRange(a, a + text.length);
}

function onKey(e) {
  const ta = e.target;
  if (!(ta instanceof HTMLTextAreaElement) || ta.hasAttribute('data-plain') || ta.readOnly || ta.disabled) return;
  if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); indent(ta, e.shiftKey); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && ta.selectionStart === ta.selectionEnd) {
    const v = ta.value, s = ta.selectionStart, a = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(a, s);
    const m = /^([\t ]*)([-*•]|\d+[.)])(\s+)/.exec(line);
    if (!m) return;
    e.preventDefault();
    if (line.length === m[0].length && v.slice(s, (v.indexOf('\n', s) + 1 || v.length + 1) - 1).trim() === '') {
      // An empty item: Enter ends the list (or steps out one level)
      if (m[1]) replace(ta, a, s, outdentLine(m[1]) + m[2] + m[3]);
      else replace(ta, a, s, '');
      return;
    }
    const num = /^\d+/.exec(m[2]);
    const marker = num ? m[2].replace(/^\d+/, String(+num[0] + 1)) : m[2];
    replace(ta, s, s, '\n' + m[1] + marker + m[3]);
  }
}

// ---------- the touch buttons
let bar = null, cur = null;
function makeBar() {
  bar = document.createElement('div');
  bar.className = 'dmp-indent-bar';
  bar.innerHTML = '<button type="button" data-d="out" aria-label="Outdent" title="Outdent (Shift+Tab)">⇤</button><button type="button" data-d="in" aria-label="Indent" title="Indent (Tab)">⇥</button><button type="button" data-d="list" aria-label="Bullet" title="Make this line a bullet">•</button>';
  // Keep the text box focused (so the keyboard stays up) while a button is pressed
  bar.addEventListener('pointerdown', e => e.preventDefault());
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !cur) return;
    if (b.dataset.d === 'list') toggleBullet(cur); else indent(cur, b.dataset.d === 'out');
    place();
  });
}
function toggleBullet(ta) {
  const { v, a, b } = lineSpan(ta);
  const lines = v.slice(a, b).split('\n');
  const all = lines.every(l => !l.trim() || BULLET.test(l.replace(/^[\t ]+/, '')));
  const text = lines.map(l => {
    const ind = /^[\t ]*/.exec(l)[0], body = l.slice(ind.length);
    if (all) return ind + body.replace(BULLET, '');
    return !body && lines.length > 1 ? l : BULLET.test(body) ? l : `${ind}- ${body}`;
  }).join('\n');
  const end = ta.selectionStart === ta.selectionEnd;
  replace(ta, a, b, text);
  if (end) { const lineEnd = a + text.split('\n')[0].length; ta.setSelectionRange(lineEnd, lineEnd); }
}
function wanted(ta) {
  return ta instanceof HTMLTextAreaElement && !ta.hasAttribute('data-plain') && !ta.readOnly && !ta.disabled;
}
function place() {
  if (!bar || !cur || !cur.isConnected || document.activeElement !== cur) { hide(); return; }
  const host = cur.closest('dialog[open]') || document.body;
  if (bar.parentNode !== host) host.appendChild(bar);
  const r = cur.getBoundingClientRect();
  const vv = window.visualViewport;
  const vTop = (vv ? vv.offsetTop : 0) + 4, h = bar.offsetHeight || 38;
  const top = r.top - h - 2 >= vTop ? r.top - h - 2 : Math.max(r.top + 4, vTop);
  bar.hidden = false;
  if (r.bottom < 30 || r.top > (vv ? vv.offsetTop + vv.height : innerHeight)) { bar.hidden = true; return; }
  // Fixed to the window; a parent with a transform would shift it, so measure and correct
  bar.style.top = '0px'; bar.style.left = '0px';
  const o = bar.getBoundingClientRect();
  bar.style.top = `${top - o.top}px`;
  bar.style.left = `${r.right - bar.offsetWidth - 6 - o.left}px`;
}
function hide() { if (bar) { bar.hidden = true; bar.remove(); } cur = null; }

let started = false;
export function start() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const st = document.createElement('style');
  st.textContent = `
textarea:not([data-plain]) { tab-size: 6; -moz-tab-size: 6; }
.dmp-indent-bar { position: fixed; z-index: 2147483000; display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: rgba(40,34,28,.88); box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.dmp-indent-bar[hidden] { display: none; }
.dmp-indent-bar button { all: unset; box-sizing: border-box; min-width: 36px; height: 32px; padding: 0 8px; border-radius: 7px; color: #fff; font: 600 18px/32px system-ui, sans-serif; text-align: center; cursor: pointer; }
.dmp-indent-bar button:hover, .dmp-indent-bar button:active { background: rgba(255,255,255,.18); }
.dmp-text { overflow-wrap: anywhere; }
.dmp-text .dmp-line { min-height: 1.2em; }
.dmp-text .dmp-gap { height: .6em; min-height: 0; }
.dmp-text .dmp-list { margin: .2em 0; padding-left: 1.5em; }
.dmp-text .dmp-list .dmp-list { margin: 0; }
.dmp-text ul.dmp-list ul.dmp-list { list-style-type: circle; }
.dmp-text ul.dmp-list ul.dmp-list ul.dmp-list { list-style-type: square; }
`;
  document.head.appendChild(st);
  makeBar();
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', e => { if (wanted(e.target)) { cur = e.target; place(); } });
  document.addEventListener('focusout', () => setTimeout(() => { if (document.activeElement !== cur) hide(); }, 0));
  const again = () => { if (cur) place(); };
  addEventListener('scroll', again, true); addEventListener('resize', again);
  window.visualViewport?.addEventListener('resize', again); window.visualViewport?.addEventListener('scroll', again);
  document.addEventListener('input', again);
}
start();
if (typeof window !== 'undefined') { window.DMPText = { textHTML, indent, levelOf }; window.dispatchEvent(new Event('dmp-text-ready')); }
