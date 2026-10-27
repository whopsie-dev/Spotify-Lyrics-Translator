(() => {
  'use strict';
  if (window.__sltLoaded) return;
  window.__sltLoaded = true;

  const DEFAULTS = {
    target: 'en',
    auto: true,
    fontSize: 80,
    opacity: 80,
    lineSpacing: 0,
    italic: true,
    onlyTranslated: false
  };
  let settings = { ...DEFAULTS };

  const state = {
    key: null,
    map: null,
    job: 0,
    startTimer: null,
    scanTimer: null,
    toastTimer: null,
    suppressed: null,
    failed: null,
    remeasure: true,
    heurAt: 0,
    heurEls: null,
    method: null
  };

  const LINE_SELECTOR = [
    '[data-testid="fullscreen-lyric"]',
    '[data-testid="lyrics-line"]',
    '[data-testid^="lyrics-line"]',
    '[data-testid^="lyric-line"]'
  ].join(',');

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const hasLetters = (s) => /\p{L}/u.test(s);
  const strip = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const same = (a, b) => strip(a) === strip(b);

  function langName(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code); }
    catch { return code; }
  }

  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function getText(el) {
    let s = '';
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.nodeType === 1 && !c.classList.contains('slt-tr')) walk(c);
      }
    })(el);
    return norm(s);
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(r);
        });
      } catch {
        resolve({ ok: false, error: 'Extension was reloaded. Refresh the page.' });
      }
    });
  }

  function toast(msg, { err = false, sticky = false } = {}) {
    let el = document.getElementById('slt-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'slt-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('err', err);
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(state.toastTimer);
    if (!sticky) state.toastTimer = setTimeout(hideToast, err ? 4500 : 2400);
  }

  function hideToast() {
    clearTimeout(state.toastTimer);
    const el = document.getElementById('slt-toast');
    if (el) el.classList.remove('on');
  }

  function bySelector() {
    const all = [...document.querySelectorAll(LINE_SELECTOR)].filter((e) => !e.closest('.slt-tr'));
    const set = new Set(all);
    return all.filter((e) => ![...e.querySelectorAll(LINE_SELECTOR)].some((c) => set.has(c)));
  }

  function byHeuristic() {
    const now = Date.now();
    if (now - state.heurAt < 1500 && state.heurEls && state.heurEls.every((e) => e.isConnected)) {
      return state.heurEls;
    }
    state.heurAt = now;

    const root = document.querySelector('main') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });

    const groups = new Map();
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (el.closest('.slt-tr, a, input, textarea, script, style, nav, header, footer')) continue;
      if ([...el.children].some((c) => !c.classList.contains('slt-tr') && c.textContent.trim())) continue;
      const t = getText(el);
      if (!t || t.length > 160) continue;

      let r = el;
      while (r.parentElement && r.parentElement !== root && r.parentElement.children.length === 1) {
        r = r.parentElement;
      }
      const p = r.parentElement;
      if (!p) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    }

    let best = null;
    for (const list of groups.values()) {
      if (list.length < 6 || (best && list.length <= best.length)) continue;
      if (parseFloat(getComputedStyle(list[0]).fontSize) >= 22) best = list;
    }
    state.heurEls = best;
    return best;
  }

  function findLines() {
    let els = bySelector();
    let method = 'selector';
    if (els.length < 2) {
      els = byHeuristic() || [];
      method = 'heuristic';
    }
    if (els.length < 2) {
      state.method = null;
      return null;
    }
    if (state.method !== method) {
      state.method = method;
      console.debug(`[SLT] lyrics found via ${method} (${els.length} lines)`);
    }
    return els;
  }

  function applyVars() {
    const r = document.documentElement;
    r.style.setProperty('--slt-scale', String(settings.fontSize / 100));
    r.style.setProperty('--slt-opacity', String(settings.opacity / 100));
    r.style.setProperty('--slt-gap', String(settings.lineSpacing / 100));
    r.style.setProperty('--slt-style', settings.italic ? 'italic' : 'normal');
    if (settings.onlyTranslated) r.setAttribute('data-slt-only', '');
    else r.removeAttribute('data-slt-only');
  }

  function removeAll() {
    document.querySelectorAll('.slt-tr').forEach((n) => n.remove());
    document.querySelectorAll('[data-slt]').forEach((e) => e.removeAttribute('data-slt'));
  }

  function applyAll(els, texts) {
    if (!state.map) return;
    const root = document.documentElement;
    const only = settings.onlyTranslated;
    if (only) root.removeAttribute('data-slt-only');

    els.forEach((el, i) => {
      const t = texts[i];
      const tr = state.map[t];
      let node = el.querySelector(':scope > .slt-tr');

      if (!tr || same(t, tr)) {
        if (node) node.remove();
        el.removeAttribute('data-slt');
        return;
      }

      let fresh = false;
      if (!node) {
        node = document.createElement('div');
        node.className = 'slt-tr';
        node.textContent = tr;
        el.appendChild(node);
        fresh = true;
      } else if (node.textContent !== tr) {
        node.textContent = tr;
      }

      if (el.getAttribute('data-slt') !== '1') el.setAttribute('data-slt', '1');
      if (fresh || state.remeasure) {
        el.style.setProperty('--slt-fs', parseFloat(getComputedStyle(el).fontSize) + 'px');
      }
    });

    state.remeasure = false;
    if (only) root.setAttribute('data-slt-only', '');
  }

  function resetState() {
    state.key = null;
    state.map = null;
    state.job++;
    clearTimeout(state.startTimer);
    removeAll();
    hideToast();
  }

  function scan() {
    const els = findLines();
    if (!els) {
      if (state.key !== null) resetState();
      return null;
    }
    const texts = els.map(getText);
    const key = hash(settings.target + '\n' + texts.join('\n'));

    if (key !== state.key) {
      resetState();
      state.key = key;
      state.startTimer = setTimeout(() => start(key), 600);
    } else if (state.map) {
      applyAll(els, texts);
    }
    return { els, texts };
  }

  function schedule(delay = 250) {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scan, delay);
  }

  async function start(key, { manual = false } = {}) {
    if (key !== state.key) return;
    const els = findLines();
    if (!els) return;

    const texts = els.map(getText);
    const unique = [...new Set(texts.filter(hasLetters))];
    if (!unique.length) return;

    if (manual) {
      state.suppressed = null;
      state.failed = null;
    } else if (state.suppressed === key || state.failed === key) {
      return;
    }

    const job = ++state.job;
    const waiting = setTimeout(() => toast('Translating lyrics…', { sticky: true }), 350);

    const res = await send({
      type: 'translate',
      key,
      target: settings.target,
      lines: unique,
      cacheOnly: !(manual || settings.auto)
    });
    clearTimeout(waiting);
    if (job !== state.job || key !== state.key) return;

    if (!res || !res.ok) {
      state.failed = key;
      toast((res && res.error) || 'Translation failed. Press Alt+T to retry.', { err: true });
      return;
    }
    if (res.miss) {
      hideToast();
      return;
    }

    state.map = res.map;
    state.remeasure = true;
    const cur = findLines();
    if (cur) applyAll(cur, cur.map(getText));

    if (Object.keys(res.map).length === 0) toast(`Lyrics are already in ${langName(settings.target)}`);
    else if (manual || !res.cached) toast(res.cached ? 'Translation loaded from cache' : `Translated to ${langName(settings.target)}`);
    else hideToast();
  }

  function manualTranslate() {
    const r = scan();
    if (!r) {
      toast('Open the lyrics view on Spotify first', { err: true });
      return;
    }
    clearTimeout(state.startTimer);
    start(state.key, { manual: true });
  }

  async function resetCurrent() {
    const r = scan();
    if (!r) return;
    const key = state.key;
    clearTimeout(state.startTimer);
    await send({ type: 'clear', key });
    state.job++;
    state.map = null;
    state.suppressed = key;
    state.failed = null;
    removeAll();
    toast('Translation reset. Press Alt+T to translate again.');
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m && m.type === 'translate-now') manualTranslate();
    else if (m && m.type === 'reset') resetCurrent();
    reply({ ok: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const prev = settings;
    settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
    applyVars();
    if (prev.onlyTranslated !== settings.onlyTranslated) state.remeasure = true;
    if (!prev.auto && settings.auto && state.key && !state.map) start(state.key);
    scan();
  });

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

    if (e.code === 'KeyT') {
      e.preventDefault();
      manualTranslate();
    } else if (e.code === 'KeyH') {
      e.preventDefault();
      settings.onlyTranslated = !settings.onlyTranslated;
      state.remeasure = true;
      applyVars();
      chrome.storage.local.set({ settings });
      scan();
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      resetCurrent();
    }
  }, true);

  function isOwn(m) {
    const n = m.target;
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (el && el.closest && el.closest('.slt-tr, #slt-toast')) return true;
    return (
      m.type === 'childList' &&
      m.removedNodes.length === 0 &&
      m.addedNodes.length > 0 &&
      [...m.addedNodes].every((x) => x.nodeType === 1 && (x.classList.contains('slt-tr') || x.id === 'slt-toast'))
    );
  }

  function init() {
    applyVars();
    new MutationObserver((muts) => {
      if (muts.every(isOwn)) return;
      schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    window.addEventListener('resize', () => {
      state.remeasure = true;
      schedule(400);
    });
    scan();
  }

  chrome.storage.local.get('settings').then(({ settings: s }) => {
    settings = { ...DEFAULTS, ...(s || {}) };
    init();
  });
})();
