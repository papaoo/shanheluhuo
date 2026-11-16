'use strict';
// Локализация. Ключ словаря = русский исходник (как в gettext): игровой код и сейвы хранят id и русский текст
// как раньше, перевод подставляется на выходе (HUD, DOM, canvas, confirm). Язык — только локальный:
// в коопе сервер шлёт те же русские строки-ключи, каждый клиент переводит их у себя.
//
//   t('Построено: {0} зданий', n)  — явный вызов (параметры {0} {1} … переводятся тоже);
//   всё остальное, что игра выводит по-русски, переводится автоматически на «стоках» (ниже).
// Словари: js/i18n/en*.js → I18N.add('en', { 'ключ': 'перевод', 'Дней: {0}': 'Days: {0}' }).
// Проверка полноты: node tools/i18n-extract.js --missing ; в игре: I18N.missing() (в en-режиме).
(function (g) {
  const LS = 'og_lang';
  const CYR = /[А-Яа-яЁё]/;
  const EN_FILES = ['en-ui', 'en-world', 'en-hero', 'en-misc', 'en-manual', 'en-systems', 'en-oaths', 'en-abil', 'en-lore', 'en-manifest', 'en-n1', 'en-n2', 'en-n3', 'en-n4', 'en-n5', 'en-n6', 'en-n7', 'en-n8', 'en-n9', 'en-n10', 'en-traitor', 'en-unions', 'en-sea', 'en-dz', 'en-fire', 'en-campaign', 'en-pc', 'en-pets2', 'en-coopkit', 'en-arena', 'en-skins', 'en-runs', 'en-profs', 'en-gear'];   // js/i18n/<имя>.js (отсутствующие молча пропускаются)
  const LANGS = { ru: 'Русский', en: 'English', 'zh-CN': '简体中文' };
  const ORDER = ['ru', 'en', 'zh-CN'];
  const ZH_FILES = EN_FILES.map(f => f.replace(/^en-/, 'zh-CN-')).concat('zh-CN-extra');
  const CJK_FONT = '"Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';
  const cache = new Map();
  function normalize(l) {
    const s = String(l || '').replace(/_/g, '-').toLowerCase();
    if (/^zh(?:-|$)/.test(s)) return 'zh-CN';
    if (/^ru(?:-|$)/.test(s)) return 'ru';
    if (/^en(?:-|$)/.test(s)) return 'en';
    return null;
  }

  function pick() {
    let q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    q = normalize(q);
    if (q) { try { localStorage.setItem(LS, q); } catch (e) {} return q; }
    try { const s = normalize(localStorage.getItem(LS)); if (s) return s; } catch (e) {}
    // This edition defaults to Simplified Chinese on every browser.
    return 'zh-CN';
  }

  const I = g.I18N = {
    lang: pick(), LANGS, dict: { en: {}, 'zh-CN': {} }, seen: new Set(),
    add(lang, o) { Object.assign(this.dict[lang] || (this.dict[lang] = {}), o); this._built = false; cache.clear(); },
    locale() { return this.lang === 'ru' ? 'ru-RU' : this.lang === 'zh-CN' ? 'zh-CN' : 'en-GB'; },
    normalize,
    files(l = this.lang) { return l === 'zh-CN' ? ZH_FILES.slice() : l === 'en' ? EN_FILES.slice() : []; },
    setLang(l) {
      l = normalize(l);
      if (!l) return;
      try { localStorage.setItem(LS, l); } catch (e) {}
      I.lang = l;
      I._built = false; cache.clear(); I.seen.clear();
      I.other = LANGS[ORDER[(ORDER.indexOf(l) + 1) % ORDER.length]];
      try { document.documentElement.lang = l; } catch (e) {}
    },
    missing() { return [...I.seen]; },
  };
  try { document.documentElement.lang = I.lang; } catch (e) {}

  // ---------- t(): явный перевод ----------
  function fill(tpl, args) {
    if (!args || !args.length) return tpl;
    return tpl.replace(/\{(\d+)\}/g, (m, i) => (i < args.length ? String(args[i]) : m));
  }
  g.t = function (key) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (I.lang === 'ru') return fill(key, args);
    const a = args.map(x => (typeof x === 'string' ? tr(x) : x)), v = dictionary()[key];
    return fill(v != null ? v : tr(key), a);
  };

  // переключатель: сохраняем выбор, автосохраняем идущую игру и перезагружаем страницу
  I.toggle = function () {
    const next = ORDER[(ORDER.indexOf(I.lang) + 1) % ORDER.length];
    try {
      if (typeof Game !== 'undefined' && Game.units && Game.units.length && typeof saveGame === 'function' && !(typeof StartMenu !== 'undefined' && StartMenu.open)) saveGame('auto');
    } catch (e) {}
    I.setLang(next);
    try { const u = new URL(location.href); u.searchParams.delete('lang'); history.replaceState(null, '', u); } catch (e) {}   // ?lang= иначе перебьёт выбор
    location.reload();
  };
  // подпись кнопки — всегда название ДРУГОГО языка на нём самом
  const other = LANGS[ORDER[(ORDER.indexOf(I.lang) + 1) % ORDER.length]];
  const fixLabels = () => document.querySelectorAll('.lang-name').forEach(e => { e.setAttribute('translate', 'no'); e.textContent = I.other; });
  I.other = other;
  document.addEventListener('DOMContentLoaded', fixLabels);

  // Load only the selected language. Russian remains the source language.
  for (const f of I.files()) document.write('<script src="js/i18n/' + f + '.js"><\/script>');

  // ---------- перевод строки ----------
  let pats = null, wild = null, buckets = null, alias = {};
  function dictionary() { return I.dict[I.lang] || {}; }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function build() {
    pats = []; wild = []; buckets = new Map();
    const d = dictionary();
    for (const k in d) {
      if (!/\{\d+\}/.test(k)) continue;
      const parts = k.split(/\{(\d+)\}/);   // чёт — литерал, нечёт — номер
      let re = '^', lit = 0; const idx = [];
      const short = parts[0] === '' && parts.filter((x, i) => i % 2 === 0).join('').trim().length <= 3;   // «{0}с» не должно съедать «каменотёс»
      const short2 = !short && parts.filter((x, i) => i % 2 === 0).join('').trim().length <= 4;   // «за {0}» не должно съедать целые фразы
      for (let i = 0; i < parts.length; i++) {
        if (i % 2) { re += short ? '([0-9.,:]+)' : short2 ? '([^.!?]{0,30}?)' : '(.*?)'; idx.push(+parts[i]); } else { re += esc(parts[i]); lit += parts[i].length; }
      }
      const p = { re: new RegExp(re + '$', 's'), idx, to: d[k], lit };
      const first = parts[0];
      if (first.length === 0) wild.push(p);
      else { const b = first.slice(0, Math.min(3, first.length)); p.bl = b.length; (buckets.get(b) || buckets.set(b, []).get(b)).push(p); }
    }
    // «Достроить до уровня 2: {0}» в DOM приходит кусками: текст и (отдельно) разметка — заводим псевдоним без плейсхолдера
    alias = {};
    for (const k in d) {
      const m = /^(.*?)\s*\{0\}$/.exec(k), e = /^(.*?)\s*\{0\}$/.exec(d[k]);
      if (m && e && m[1].length > 3 && !/\{\d+\}/.test(m[1]) && !/\{\d+\}/.test(e[1]) && d[m[1]] == null) alias[m[1]] = e[1];
    }
    wild.sort((a, b) => b.lit - a.lit);
    for (const l of buckets.values()) l.sort((a, b) => b.lit - a.lit);
    I._built = true; I._alias = alias;
  }
  function dec(s) { return s.replace(/&nbsp;/g, ' '); }

  function matchPat(s) {
    if (!I._built) build();
    let cand = wild;
    for (let L = 1; L <= 3; L++) { const l = buckets.get(s.slice(0, L)); if (l) cand = cand === wild ? l.concat(wild) : cand.concat(l); }
    if (cand.length > 1) cand = cand.slice().sort((a, b) => b.lit - a.lit);
    for (const p of cand) {
      const m = p.re.exec(s);
      if (!m) continue;
      const args = [];
      for (let i = 0; i < p.idx.length; i++) args[p.idx[i]] = tr(m[i + 1]);
      return fill(p.to, args);
    }
    return null;
  }
  // цельная нормализованная строка без \n
  function core(s) {
    const d = dictionary();
    let v = d[s];
    if (v != null) return v;
    if (!I._built) build();
    if (alias[s] != null) return alias[s];
    v = matchPat(s);
    if (v != null) return v;
    // игра часто вставляет названия в нижнем регистре («трудяга») — ищем с заглавной и опускаем первую букву
    const c0 = s.charAt(0);
    if (c0 !== c0.toUpperCase()) {
      const up = c0.toUpperCase() + s.slice(1);
      v = d[up] != null ? d[up] : matchPat(up);
      if (v != null) return v.charAt(0).toLowerCase() + v.slice(1);
    }
    return null;
  }
  // запасной путь: переводим по кускам между числами и знаками, чтобы «5 зданий» не оставалось русским
  const NUMS = /(\d[\d.,:]*)/;
  const SPLIT = /(\d[\d.,:]*|[«»"“”()\[\]|/×·•→←↑↓+=%!?,.;:—–-]+)/;
  const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;   // значки и знаки по краям: «✔ жители», «(носит по 1)»
  // склейка из нескольких известных кусков: «испёк хлеб в» + «пекарне»
  function segment(s) {
    const w = s.split(' ');
    if (w.length < 2 || w.length > 60) return null;
    const d = dictionary(), best = [0], from = [];
    for (let i = 1; i <= w.length; i++) {
      best[i] = Infinity;
      for (let j = Math.max(0, i - 40); j < i; j++) {
        if (best[j] === Infinity) continue;
        const piece = w.slice(j, i).join(' ');
        if (d[piece] != null && best[j] + 1 < best[i]) { best[i] = best[j] + 1; from[i] = j; }
      }
    }
    if (best[w.length] === Infinity) return null;
    const out = []; for (let i = w.length; i > 0; i = from[i]) out.unshift(d[w.slice(from[i], i).join(' ')]);
    return out.join(I.lang === 'zh-CN' ? '' : ' ');
  }
  // кусок без чисел: целиком → без краевых знаков → из известных частей → по знакам внутри
  function chunk(raw, deep) {
    const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0], mid = raw.trim();
    if (!mid) return null;
    let v = core(mid);
    if (v != null) return lead + v + trail;
    const m2 = mid.replace(EDGE, '');
    if (m2 && m2 !== mid) {
      v = core(m2) || segment(m2);
      if (v != null) { const i0 = mid.indexOf(m2); return lead + mid.slice(0, i0) + v + mid.slice(i0 + m2.length) + trail; }
    }
    v = segment(mid);
    if (v != null) return lead + v + trail;
    if (deep) return null;
    const parts = mid.split(SPLIT); let ch = false;
    for (let i = 0; i < parts.length; i += 2) { if (!CYR.test(parts[i])) continue; const r = chunk(parts[i], true); if (r != null) { parts[i] = r; ch = true; } }
    return ch ? lead + parts.join('') + trail : null;
  }
  function pieces(s) {
    const out = s.split(NUMS);
    let changed = false;
    for (let i = 0; i < out.length; i += 2) {
      if (!CYR.test(out[i])) continue;
      const r = chunk(out[i], false);
      if (r != null) { out[i] = r; changed = true; }
    }
    return changed ? out.join('') : null;
  }
  function tr(s) {
    if (I.lang === 'ru' || typeof s !== 'string' || !CYR.test(s)) return s;
    let r = cache.get(s);
    if (r !== undefined) return r;
    r = trUncached(s);
    if (cache.size > 6000) cache.clear();
    cache.set(s, r);
    return r;
  }
  function trUncached(s) {
    s = dec(s);
    if (s.indexOf('\n') >= 0) return s.split('\n').map(tr).join('\n');
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    const mid = s.trim().replace(/\s+/g, ' ');
    let v = core(mid);
    if (v == null) {   // «(носит по 1)»: знаки по краям снимаем и возвращаем
      for (const re of [/^[^\p{L}\p{N}]+/u, /[^\p{L}\p{N}]+$/u, EDGE]) {   // только слева, только справа, с обеих сторон
        const m2 = mid.replace(re, '');
        if (m2 && m2 !== mid && CYR.test(m2)) { const c2 = core(m2); if (c2 != null) { const i0 = mid.indexOf(m2); v = mid.slice(0, i0) + c2 + mid.slice(i0 + m2.length); break; } }
      }
    }
    if (v == null && (mid.indexOf(' · ') > 0 || mid.indexOf(' | ') > 0)) {   // склейка из значений через разделитель
      const sep = mid.indexOf(' · ') > 0 ? ' · ' : ' | ';
      const ps = mid.split(sep).map((x, i) => {
        if (i > 0 && CYR.test(x)) { const r = tr(sep.trim() + ' ' + x); if (r.indexOf(sep.trim() + ' ') === 0 && !CYR.test(r)) return r.slice(2); }   // ключ мог начинаться с «· »
        return tr(x);
      });
      if (ps.some((x, i) => x !== mid.split(sep)[i])) v = ps.join(sep);
    }
    if (v == null) v = segment(mid);   // «Трудяга» + «дорос до 2-го уровня: …»
    if (v == null) {
      v = pieces(mid);
      if (v == null || CYR.test(v)) {
        // часть кусков не нашлась: отметим для отладки
        const rest = (v == null ? mid : v);
        if (CYR.test(rest)) I.seen.add(mid);
      }
    }
    return v == null ? s : lead + v + trail;
  }
  I.tr = tr;

  // User-provided names are data, even when they happen to equal a source key.
  // Keep the boundary in the DOM so later MutationObserver passes respect it.
  const htmlEscape = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  I.userHTML = value => I.lang === 'zh-CN' ? '<span translate="no" data-i18n-user>' + htmlEscape(value) + '</span>' : htmlEscape(value);
  I.userFormatHTML = function (key, ...values) {
    return fill(I.lang === 'zh-CN' ? tr(key) : key, values.map(I.userHTML));
  };
  // Native dialogs stringify this after the translation hook, preserving the
  // inserted values. It is a transient display object, never a save value.
  I.userMessage = function (key, ...values) {
    return I.lang === 'zh-CN' ? new String(fill(tr(key), values)) : fill(key, values);
  };
  let userCanvasDepth = 0;
  I.canvasUserText = function (ctx, method, ...args) {
    if (!['fillText', 'strokeText', 'measureText'].includes(method)) throw new Error('Invalid text method');
    if (I.lang !== 'zh-CN') return ctx[method](...args);
    userCanvasDepth++;
    try { return ctx[method](...args); } finally { userCanvasDepth--; }
  };

  // Canvas text is measured and drawn with the same CJK fallback, without
  // changing the font kept by the game's renderer for its next drawing pass.
  I.canvasFont = function (font) {
    if (I.lang !== 'zh-CN') return font;
    return String(font).replace(/((?:\d*\.)?\d+(?:px|pt|em|rem|%)\s+(?:\/\s*[^\s]+\s+)?)(.+)$/, (m, size, family) =>
      size + (family.includes('Noto Sans CJK SC') ? family : CJK_FONT + ', ' + family));
  };
  const graphemes = s => typeof Intl !== 'undefined' && Intl.Segmenter
    ? Array.from(new Intl.Segmenter(I.locale(), { granularity: 'grapheme' }).segment(s), x => x.segment)
    : Array.from(s);
  // Unlike split(' '), this can wrap Chinese dialogue. Keep Latin words,
  // shortcuts and grapheme clusters intact where they fit; respect newlines.
  I.wrapText = function (ctx, text, width) {
    const translated = tr(String(text));
    if (!(width > 0)) return translated.split('\n');
    const original = ctx.font;
    ctx.font = I.canvasFont(original);
    const lines = [], closing = /^[，。！？；：、）】》〉」』〕…,.!?;:%]/u, opening = /[（【《〈「『〔]$/u;
    const measure = s => ctx.measureText(s).width;
    try {
      for (const paragraph of translated.split('\n')) {
        if (!paragraph.trim()) { lines.push(''); continue; }
        const tokens = [];
        for (const c of graphemes(paragraph)) {
          const last = tokens[tokens.length - 1];
          if (last && (closing.test(c) || opening.test(last) || (/^[A-Za-z0-9_./:+%-]+$/.test(last) && /^[A-Za-z0-9_./:+%-]$/.test(c)))) tokens[tokens.length - 1] += c;
          else tokens.push(c);
        }
        let line = '';
        const put = token => {
          if (!line && /^\s+$/.test(token)) return;
          if (line && measure(line + token) > width) { lines.push(line.trimEnd()); line = ''; }
          line += token;
        };
        for (const token of tokens) {
          if (measure(token) <= width) put(token);
          else for (const c of graphemes(token)) put(c);
        }
        if (line.trim()) lines.push(line.trimEnd());
      }
      return lines;
    } finally { ctx.font = original; }
  };

  // ---------- HTML-строки: переводим только текст между тегами и title/alt/placeholder ----------
  const ATTR = /\b(title|alt|placeholder|aria-label|value)=("([^"]*)"|'([^']*)')/g;
  const RAW_TAGS = /^(script|style|code|pre|textarea)$/i;
  const VOID_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  function protectedElement(e) {
    if (!e) return false;
    if (RAW_TAGS.test(e.tagName || '')) return true;
    if (typeof e.getAttribute !== 'function') return false;
    const editable = e.getAttribute('contenteditable');
    return e.getAttribute('translate') === 'no' || e.hasAttribute('data-i18n-skip') || (editable != null && editable !== 'false');
  }
  function protectedNode(n) {
    for (let e = n && (n.nodeType === 1 ? n : n.parentElement); e; e = e.parentElement) if (protectedElement(e)) return true;
    return false;
  }
  function unent(s) { return s.replace(/&(nbsp|amp|lt|gt|quot|mdash|ndash|times|laquo|raquo|hellip|middot|minus|rarr|larr);|&#(\d+);/g, (m, n, c) => c ? String.fromCharCode(+c) : ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', mdash: '—', ndash: '–', times: '×', laquo: '«', raquo: '»', hellip: '…', middot: '·', minus: '−', rarr: '→', larr: '←' })[n]); }
  function reent(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function trText(seg) {
    if (!CYR.test(seg)) return seg;
    const r = tr(seg.indexOf('&') >= 0 ? unent(seg) : seg);
    return r === seg ? seg : (seg.indexOf('&') >= 0 || /[<>&]/.test(r) ? reent(r) : r);
  }
  function trHtml(h) {
    if (I.lang === 'ru' || typeof h !== 'string' || !CYR.test(h)) return h;
    const stack = [];
    return h.split(/(<!--[\s\S]*?-->|<[^>]*>)/).map(p => {
      if (p.charAt(0) === '<' && p.length > 1) {
        if (/^<!--/.test(p)) return p;
        const tag = /^<\s*(\/?)([\w:-]+)/.exec(p);
        if (!tag) return p;
        const name = tag[2].toLowerCase();
        if (tag[1]) {
          const pos = stack.map(x => x.name).lastIndexOf(name);
          if (pos >= 0) stack.length = pos;
          return p;
        }
        const skip = (stack.length && stack[stack.length - 1].skip) || RAW_TAGS.test(name)
          || /\btranslate\s*=\s*["']?no\b/i.test(p) || /\bdata-i18n-skip\b/i.test(p)
          || (/\bcontenteditable\b/i.test(p) && !/\bcontenteditable\s*=\s*["']?false\b/i.test(p));
        if (!VOID_TAGS.test(name) && !/\/\s*>$/.test(p)) stack.push({ name, skip });
        if (skip || !CYR.test(p)) return p;
        return p.replace(ATTR, (m, a, q, v1, v2) => {
          // Chinese output never rewrites a player's name or a form's data value.
          if (a === 'value' && I.lang === 'zh-CN') return m;
          const v = v1 != null ? v1 : v2;
          return a + '="' + trText(v).replace(/"/g, '&quot;') + '"';
        });
      }
      if (stack.length && stack[stack.length - 1].skip) return p;
      return trText(p);
    }).join('');
  }
  I.trHtml = trHtml;

  // ---------- стоки ----------
  if (I.lang === 'ru' || typeof Node === 'undefined' || typeof MutationObserver === 'undefined') return;   // без DOM (сервер коопа, simhost) — только словарь и t()
  const def = (proto, prop, wrap) => {
    const dsc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!dsc) return;
    if (dsc.set) Object.defineProperty(proto, prop, { configurable: true, enumerable: dsc.enumerable, get: dsc.get, set: wrap(dsc.set) });
    else if (typeof dsc.value === 'function') proto[prop] = wrap(dsc.value);
  };
  const setStr = fn => function (v) {
    const detachedText = I.lang === 'zh-CN' && this.nodeType === 3 && !this.parentElement;
    return fn.call(this, typeof v === 'string' && !detachedText && !protectedNode(this) ? tr(v) : v);
  };
  const setHtml = fn => function (v) { return fn.call(this, typeof v === 'string' && !protectedNode(this) ? trHtml(v) : v); };
  def(Node.prototype, 'textContent', setStr);
  def(Node.prototype, 'nodeValue', setStr);
  def(CharacterData.prototype, 'data', setStr);
  def(HTMLElement.prototype, 'innerText', setStr);
  def(HTMLElement.prototype, 'title', setStr);
  def(HTMLInputElement.prototype, 'placeholder', setStr);
  if (I.lang === 'en') def(HTMLInputElement.prototype, 'value', setStr);   // retain the existing English default-name behaviour
  def(HTMLImageElement.prototype, 'alt', setStr);
  def(Element.prototype, 'innerHTML', setHtml);
  def(Element.prototype, 'outerHTML', setHtml);
  def(Element.prototype, 'insertAdjacentHTML', fn => function (pos, h) { return fn.call(this, pos, protectedNode(this) ? h : trHtml(h)); });
  def(Element.prototype, 'setAttribute', fn => function (n, v) { return fn.call(this, n, (typeof v === 'string' && !protectedNode(this) && /^(title|alt|placeholder|aria-label)$/.test(n)) ? tr(v) : v); });
  // At creation time the node has no parent yet, so its protection boundary
  // is unknown. Chinese nodes are translated by walk once they are attached.
  if (I.lang === 'en') def(Document.prototype, 'createTextNode', fn => function (s) { return fn.call(this, tr(String(s))); });
  def(Document.prototype, 'write', fn => function () { return fn.apply(this, Array.prototype.map.call(arguments, trHtml)); });
  const origTitle = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  if (origTitle && origTitle.set) Object.defineProperty(document, 'title', { configurable: true, get() { return origTitle.get.call(document); }, set(v) { origTitle.set.call(document, tr(v)); } });
  for (const n of ['alert', 'confirm', 'prompt']) { const f = g[n]; if (f) g[n] = function (m, d) { return f.call(g, tr(m), d); }; }

  const C2 = g.CanvasRenderingContext2D && g.CanvasRenderingContext2D.prototype;
  if (C2) for (const n of ['fillText', 'strokeText', 'measureText']) {
    const f = C2[n];
    C2[n] = function (s) {
      if (!userCanvasDepth && typeof s === 'string' && CYR.test(s)) arguments[0] = tr(s);
      const original = this.font;
      this.font = I.canvasFont(original);
      try { return f.apply(this, arguments); } finally { this.font = original; }
    };
  }

  // ---------- статический HTML и всё, что просочилось мимо сеттеров ----------
  // меняем только если перевод отличается — иначе наблюдатель зациклится на непереведённом
  function fixText(n) { const d = n.data; if (!protectedNode(n) && CYR.test(d)) { const r = tr(d); if (r !== d) n.data = r; } }
  function fixAttr(e, a) { const v = e.getAttribute(a); if (!protectedNode(e) && v && CYR.test(v)) { const r = tr(v); if (r !== v) e.setAttribute(a, r); } }
  function walk(root) {
    if (protectedNode(root)) return;
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) for (const a of ['title', 'alt', 'placeholder', 'aria-label']) { fixAttr(root, a); }
    for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
  }
  I.walk = walk;
  function boot() {
    walk(document.documentElement);
    document.title = document.title;
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'characterData') fixText(m.target);
        else if (m.type === 'attributes') fixAttr(m.target, m.attributeName);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'alt', 'placeholder', 'aria-label'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
