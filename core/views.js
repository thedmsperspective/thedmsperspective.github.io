// The DM's Perspective — what a player's sheet shows from each app.
//
// One copy of these rules, used everywhere: the app that owns the data sends it to the sheet over the live link
// the moment it changes, and the Character Sheet on the DM's device saves the same thing into the sheet file on
// Drive. Both come from here, so they always agree. Only player-safe information leaves these functions.
//
// Each item and disease also carries its effects (what it does to the character's numbers), read from its text by
// effects.js, or the DM's own corrections where they made some. The sheet applies them.
import { parseEffects, worksWhileCarried, describe } from './effects.js';
// each effect also carries its plain-words line (txt), so the sheet can list it as is
const withText = fx => fx.map(e => ({ ...e, txt: describe(e) }));

/* ---------- Session Notes: deaths, Favor of Fate, diseases, survival ---------- */
// A disease shows once symptoms start (on its own), or while incubating only if the DM revealed it. Only what's
// affecting the character right now: every effect in force at the current stage (stages build on each other),
// never the stages still to come, the save DC, or how their saves have gone.
/* ---------- Loot the DM gave this character (Session Notes' Loot tab). Never its true value: only what they were told
   (an appraisal the DM revealed, which may not be the truth). Coins are their share. The sheet adds each find once. */
export function lootView(sn, pc) {
  const out = [];
  for (const l of sn?.loot || []) {
    if (l.deleted || !l.given) continue;
    if (l.kind === 'coins') { const share = l.given.shares?.[pc.id]; if (share) out.push({ id: l.id, coins: share, place: l.place || '' }); continue; }
    if (l.given.to !== pc.id) continue;
    out.push({ id: l.id, name: l.name || 'Something', sec: l.sec || 'treasure', wt: Number(l.wt) || 0, qty: Math.max(1, Number(l.qty) || 1), desc: l.desc || '', eqId: l.eqId || '', shown: l.shown || '' });
  }
  return out;
}

export function snView(sn, pc) {
  if (!pc) return null;
  const dis = new Map((sn?.diseases || []).map(d => [d.id, d]));
  const cases = (sn?.cases || []).filter(cs => cs.pcId === pc.id && !cs.deleted
    && (['sick', 'declining'].includes(cs.state) || (cs.state === 'incubating' && cs.revealed)));
  const sv = pc.survival || {};
  return {
    pcId: pc.id,
    deaths: (pc.deaths || []).length,
    favorSpent: !!pc.favor?.spent,
    levelOk: Number(pc.levelOk) || 0, // when the DM last allowed a level up (Table Rules: When I allow it)
    loot: lootView(sn, pc),
    survival: sv.hunger != null ? { hunger: sv.hunger, thirst: sv.thirst, fatigue: sv.fatigue } : null,
    diseases: cases.map(cs => {
      const d = dis.get(cs.diseaseId) || {};
      const stage = cs.state === 'incubating' ? 0 : Math.max(0, cs.stage || 0);
      const texts = (d.stages || []).slice(0, stage);
      // what the stages in force do to the numbers (the DM's own list for a stage, where they made one)
      const fx = withText(texts.flatMap((t, i) => (Array.isArray(d.stageFx?.[i]) ? d.stageFx[i] : parseEffects(t))));
      return { id: cs.id, name: d.name || 'Disease', state: cs.state, effects: texts, fx };
    }),
  };
}

/* ---------- Magic items that leave something open: which weapon or armor it is, which damage type it resists ---------- */
// The SRD weapons and armor (names as in the Character Sheet's equipment list, so the sheet can find their numbers)
export const WEAPONS = [['Club', 'bludgeoning'], ['Dagger', 'piercing'], ['Greatclub', 'bludgeoning'], ['Handaxe', 'slashing'], ['Javelin', 'piercing'], ['Light hammer', 'bludgeoning'],
  ['Mace', 'bludgeoning'], ['Quarterstaff', 'bludgeoning'], ['Sickle', 'slashing'], ['Spear', 'piercing'], ['Crossbow, light', 'piercing'], ['Dart', 'piercing'], ['Shortbow', 'piercing'],
  ['Sling', 'bludgeoning'], ['Battleaxe', 'slashing'], ['Flail', 'bludgeoning'], ['Glaive', 'slashing'], ['Greataxe', 'slashing'], ['Greatsword', 'slashing'], ['Halberd', 'slashing'],
  ['Lance', 'piercing'], ['Longsword', 'slashing'], ['Maul', 'bludgeoning'], ['Morningstar', 'piercing'], ['Pike', 'piercing'], ['Rapier', 'piercing'], ['Scimitar', 'slashing'],
  ['Shortsword', 'piercing'], ['Trident', 'piercing'], ['War pick', 'piercing'], ['Warhammer', 'bludgeoning'], ['Whip', 'slashing'], ['Blowgun', 'piercing'], ['Crossbow, hand', 'piercing'],
  ['Crossbow, heavy', 'piercing'], ['Longbow', 'piercing']];
export const AMMUNITION = ['Arrow', 'Crossbow bolt', 'Sling bullet', 'Blowgun needle'];
export const ARMORS = [['Padded Armor', 'light'], ['Leather Armor', 'light'], ['Studded Leather Armor', 'light'], ['Hide Armor', 'medium'], ['Chain Shirt', 'medium'], ['Scale Mail', 'medium'],
  ['Breastplate', 'medium'], ['Half Plate Armor', 'medium'], ['Ring Mail', 'heavy'], ['Chain Mail', 'heavy'], ['Splint Armor', 'heavy'], ['Plate Armor', 'heavy']];
export const DAMAGE_TYPES = ['acid', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder', 'bludgeoning', 'piercing', 'slashing'];
const RANGED = ['Crossbow, light', 'Dart', 'Shortbow', 'Sling', 'Blowgun', 'Crossbow, hand', 'Crossbow, heavy', 'Longbow'];
const SWORDS = ['Greatsword', 'Longsword', 'Rapier', 'Scimitar', 'Shortsword'], AXES = ['Battleaxe', 'Greataxe', 'Handaxe'];

/**
 * What a magic item leaves for the DM to choose: { kind: 'weapon'|'armor'|'', options: [names], fixed: name, dmg: bool }.
 * "Weapon (any sword)" offers the swords; "Armor (plate)" is plate, no choice; "resistance to one type of damage" asks which.
 */
export function itemChoices(item) {
  const t = String(item?.type || ''), out = { kind: '', options: [], fixed: '', dmg: false };
  // resistance to a damage type left open: said in the text, or a "?" standing for it in the name ("Potion of ? Resistance")
  out.dmg = /resistance\s+to\s+(?:one|a)\s+(?:type\s+of\s+damage|damage\s+type)|one\s+damage\s+type\s+of\s+your\s+choice|resistance\s+to\s+the\s+damage\s+type\s+(?:chosen|determined)/i.test(item?.desc || '')
    || (/\?/.test(item?.name || '') && /resist/i.test(item?.name || ''));
  const w = /^\s*weapon\s*\(([^)]*)\)?/i.exec(t), a = /^\s*armor\s*\(([^)]*)\)?/i.exec(t);
  if (w) {
    out.kind = 'weapon';
    const spec = w[1].toLowerCase().trim();
    if (/^any\b/.test(spec)) {
      let names = [];
      if (/sword/.test(spec)) names.push(...SWORDS);
      if (/\baxe/.test(spec)) names.push(...AXES);
      if (/ammunition/.test(spec)) names.push(...AMMUNITION);
      if (/slashing/.test(spec)) names = names.filter(n => WEAPONS.find(x => x[0] === n)?.[1] === 'slashing');
      if (!names.length && /melee/.test(spec)) names = WEAPONS.map(x => x[0]).filter(n => !RANGED.includes(n)); // "Any Melee Weapon"
      out.options = names.length ? names : WEAPONS.map(x => x[0]);
    } else {
      // one weapon ("longbow"), or a short list ("Glaive, Greatsword, Longsword, or Scimitar")
      const all = [...WEAPONS.map(x => x[0]), ...AMMUNITION];
      const parts = spec.split(/,|\bor\b/).map(x => x.trim().replace(/s$/, '')).filter(Boolean);
      const found = all.filter(n => parts.some(p => n.toLowerCase() === p || n.toLowerCase() === `${p}s`));
      if (found.length > 1) out.options = found; else out.fixed = found[0] || '';
    }
  } else if (a) {
    out.kind = 'armor';
    const spec = a[1].toLowerCase().trim(), open = !/\)/.test(t);
    if (/shield/.test(spec)) out.fixed = 'Shield';
    else if (/\b(light|medium|heavy)\b/.test(spec) || /^any/.test(spec)) {
      // "Armor (light, medium, or heavy)" (sometimes cut short to "Armor (light"); 2024: "Any Medium or Heavy, Except Hide Armor"
      const named = ['light', 'medium', 'heavy'].filter(k => spec.includes(k));
      const kinds = open && spec === 'light' || !named.length ? ['light', 'medium', 'heavy'] : named;
      const except = (/except ([a-z ]+)/.exec(spec) || [])[1] || '';
      out.options = ARMORS.filter(x => kinds.includes(x[1]) && !(except && x[0].toLowerCase().startsWith(except.trim().replace(/ armor$/, '')))).map(x => x[0]);
    } else out.fixed = ARMORS.map(x => x[0]).find(n => n.toLowerCase().startsWith(spec)) || '';
  }
  return out;
}
/** Does handing this item out need the DM to pick something? */
export const needsChoice = item => { const c = itemChoices(item); return c.options.length > 1 || c.dmg; };
/** The name a chosen copy goes by: "Weapon, +1" with a longsword is "Longsword, +1"; "Flame Tongue (Scimitar)". */
export function choiceName(name, ch = {}) {
  let n = String(name || ''); const extra = [];
  // A "?" in the name stands for the choice: "Potion of ? Resistance" + fire → "Potion of Fire Resistance"
  const cap = w => String(w).replace(/\b\w/g, x => x.toUpperCase());
  if (n.includes('?') && (ch.dmg || ch.base)) { n = n.replace('?', cap(ch.dmg || ch.base)); if (ch.dmg) ch = { ...ch, dmg: '' }; else ch = { ...ch, base: '' }; }
  if (ch.base) {
    if (/^(weapon|armor|ammunition)(?=,| \+)/i.test(n)) n = n.replace(/^(weapon|armor|ammunition)(?=,| \+)/i, ch.base); // "Armor, +1" → "Chain Mail, +1" (2024: "Weapon +1")
    else if (!n.toLowerCase().includes(ch.base.toLowerCase().replace(/ armor$/, ''))) extra.push(ch.base);
  }
  if (ch.dmg) extra.push(ch.dmg);
  return extra.length ? `${n} (${extra.join(', ')})` : n;
}

/* ---------- Consumables: things that are used up (a potion is drunk, a torch burns out) ----------
   Magic: potions, oils, scrolls, elixirs, philters, dusts and magic ammunition, unless the DM switched it (i.consumable).
   Mundane: alchemist's fire, acid, antitoxin, holy water, oil, torches, rations, healer's kits and the like. */
const MAGIC_USED_UP = /^(potion|oil|spell scroll|scroll|elixir|philter|dust|ammunition|arrow|bolt|sling bullet|needle)s?\b/i;
export function isConsumable(i) {
  if (!i) return false;
  if (typeof i.consumable === 'boolean') return i.consumable;
  return MAGIC_USED_UP.test(String(i.name || '')) || /^\s*(potion|scroll)\b/i.test(String(i.type || '')) || /\bammunition\b/i.test(String(i.type || ''));
}
const MUNDANE_USED_UP = /^(alchemist'?s fire|acid|antitoxin|holy water|oil|torch|rations?|healer'?s kit|poison|basic poison|candle|caltrops|ball bearings|potion)\b/i;
export const consumableName = n => MUNDANE_USED_UP.test(String(n || '').trim()) || MAGIC_USED_UP.test(String(n || '').trim());

/* ---------- Containers: a Bag of Holding, a Portable Hole… ----------
   i.container (set in the Magic Items app) wins: { on, cap (lb; 0 = no limit), counts (contents count toward carried
   weight), rift (a Bag of Holding inside it, or it inside one, tears a rift to the Astral Plane), pouches }.
   Otherwise the containers from the book come set up. */
const BOOK_CONTAINERS = {
  'bag of holding': { cap: 500, counts: false, rift: true },
  'portable hole': { cap: 0, counts: false, rift: true },
  'handy haversack': { counts: false, rift: true, pouches: [{ id: 'l', name: 'Left pouch', cap: 20 }, { id: 'r', name: 'Right pouch', cap: 20 }, { id: 'c', name: 'Main pouch', cap: 80 }] },
  "heward's handy haversack": 'handy haversack',
  'efficient quiver': { counts: false, rift: false, pouches: [{ id: 'a', name: 'Arrows and bolts', count: 60 }, { id: 'j', name: 'Javelins', count: 18 }, { id: 'b', name: 'Bows and spears', count: 6 }] },
};
const plainName = n => String(n || '').toLowerCase().replace(/\([^)]*\)/g, '').trim();
export function containerOf(i) {
  if (!i) return null;
  if (i.container && typeof i.container === 'object') {
    const x = i.container; if (x.on === false) return null;
    return { cap: Math.max(0, Number(x.cap) || 0), counts: !!x.counts, rift: !!x.rift, pouches: Array.isArray(x.pouches) && x.pouches.length ? x.pouches : null };
  }
  let b = BOOK_CONTAINERS[plainName(i.name)];
  if (typeof b === 'string') b = BOOK_CONTAINERS[b];
  return b ? { cap: b.cap || 0, counts: !!b.counts, rift: !!b.rift, pouches: b.pouches || null } : null;
}

/* ---------- Charges, and once-a-day uses ----------
   i.charges (set in the Magic Items app) wins: { max, rec ('Dawn' | 'Long rest' | 'Short rest' | 'None'), regain (dice
   like "1d6 + 1", a number, or "all"), last (what happens when the last charge is used) }. { max: 0 } switches it off.
   Otherwise it's read from the description: "This wand has 7 charges… regains 1d6 + 1 expended charges daily at dawn",
   or "can't be used again until the next dawn" (once a day). */
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, fifty: 50 };
const numOf = s => (/^\d+$/.test(s) ? Number(s) : WORDS[String(s).toLowerCase()] || 0);
export function chargesOf(i) {
  if (!i) return null;
  if (i.charges && typeof i.charges === 'object') {
    const x = i.charges, max = Math.max(0, Math.floor(Number(x.max) || 0));
    return max ? { max, rec: x.rec || 'Dawn', regain: String(x.regain || 'all'), last: String(x.last || '') } : null;
  }
  const d = String(i.desc || '').replace(/\s+/g, ' ');
  const m = /\bhas (\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty) charges?\b/i.exec(d);
  const when = /\bdawn\b/i.test(d) ? 'Dawn' : /\blong rest\b/i.test(d) ? 'Long rest' : /\bshort rest\b/i.test(d) ? 'Short rest' : 'None';
  if (m) {
    const g = /\bregains? (all(?: of)? (?:its|their) )?(?:(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+) )?(?:expended |spent )?charges?\b/i.exec(d);
    const regain = !g ? (when === 'None' ? '' : 'all') : g[1] ? 'all' : (g[2] || 'all').replace(/\s+/g, ' ');
    // the last-charge rule, with the sentence after it when that's the roll ("On a 1, the wand crumbles…")
    const ss = d.split(/(?<=[.!?])\s+/), li = ss.findIndex(s => /\blast charge\b/i.test(s));
    const last = li < 0 ? '' : [ss[li], /^on an? \d/i.test(ss[li + 1] || '') ? ss[li + 1] : ''].join(' ').trim();
    return { max: numOf(m[1]), rec: g || when !== 'None' ? when : 'None', regain, last };
  }
  // once a day: "can't be used again until the next dawn" and the like
  const once = /\b(?:can(?:no|')t|can not|cannot) (?:be used|use (?:it|this|that)(?: property| feature| action)?|do so|be activated|activate it) again until (?:the next dawn|you finish a (long|short) rest)/i.exec(d)
    || /\bonce per day\b|\bonce a day\b|\bonce each day\b/i.exec(d);
  if (once) return { max: 1, rec: once[1] ? `${once[1][0].toUpperCase()}${once[1].slice(1)} rest` : 'Dawn', regain: 'all', last: '' };
  return null;
}

/* ---------- Magic Items: what a character holds (never what it's worth) ---------- */
export const weightLb = w => { const m = /([\d.]+)\s*lb/i.exec(String(w || '')); return m ? Number(m[1]) : 0; };
export function attuneText(i) {
  const a = i?.attune || {};
  return a.mode === 'required' ? `Requires attunement${a.by ? ` ${a.by}` : ''}` : a.mode === 'optional' ? 'Attunement optional' : '';
}
/**
 * mi: the magic item app's saved data ({ state }), seed: Map of its built-in items by id, holder: its record for
 * this character. Returns { items, limit, held } or null.
 */
export function miView(mi, seed, holder) {
  if (!holder) return null;
  const st = mi?.state || {};
  const items = new Map();
  if (seed) for (const [id, i] of seed) items.set(id, i);
  for (const c of st.custom || []) items.set(c.id, c);
  const get = id => { const i = items.get(id); const e = st.edits?.[id]; return i ? (e ? { ...i, ...e } : i) : null; };
  const held = (st.inv || []).filter(x => x.holder === holder.id);
  const list = held.map(x => {
    const i = get(x.itemId); if (!i) return null;
    // what it does to the numbers: the DM's own list if they made one, otherwise read from its description
    let raw = Array.isArray(i.fx) ? i.fx : (worksWhileCarried(i) ? parseEffects(i.desc) : []);
    // the damage type the DM chose for "resistance to one type of damage"
    const ch = x.choice || {}, ic = itemChoices(i);
    if (ch.dmg) { raw = raw.filter(e => e.k !== 'resist'); raw = [...raw, { k: 'resist', on: ch.dmg }]; }
    const fx = withText(raw);
    const base = ch.base || ic.fixed || '';
    return {
      cid: x.cid, name: choiceName(i.name, { ...ch, base: ch.base || '' }), base, baseKind: base ? ic.kind : '', type: [i.type, i.rarity].filter(Boolean).join(', '),
      attune: attuneText(i), needsAttune: i.attune?.mode === 'required', attuned: !!x.attuned, desc: i.desc || '', weight: weightLb(i.weight), fx,
      // used up when used: a stack (×qty), and the uses the Magic Items app has already counted
      ...(isConsumable(i) ? { consumable: true, qty: Math.max(1, Number(x.qty) || 1), usedIds: (x.usedIds || []).slice(-30) } : {}),
      // a Bag of Holding and the like; charges or a once-a-day use
      ...(containerOf(i) ? { container: containerOf(i) } : {}),
      ...(chargesOf(i) ? { charges: chargesOf(i) } : {}),
    };
  }).filter(Boolean);
  return { items: list, limit: Number(holder.limit) || 3, held: held.length };
}

/* ---------- boons (granted in the Character Sheet's library) ---------- */
export function boonFx(b) { return withText(Array.isArray(b?.fx) ? b.fx : parseEffects(b?.desc || b?.text || '')); }
