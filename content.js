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
    onlyTranslated: false,
    findLyrics: true,
    autoShowFound: false,
    fallbackTranslators: true
  };
  let settings = { ...DEFAULTS };

  const state = {
    key: null,
    map: null,
    job: 0,
    startTimer: null,
    waitTimer: null,
    pending: null,
    scanTimer: null,
    toastTimer: null,
    suppressed: null,
    failed: null,
    remeasure: true,
    heurAt: 0,
    heurEls: null,
    method: null,
    track: null,
    findTimer: null,
    findJob: 0,
    finding: null,
    findRetryAt: 0,
    found: null,
    panel: null,
    promptTimer: null,
    promptedFor: null,
    noLyricsFor: null,
    dismissedFor: null,
    lastManualTranslateAt: 0,
    lastManualFindAt: 0,
    trackDebugAt: 0
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

  const PLAYER_BAR = [
    '[data-testid="now-playing-bar"]',
    '[data-testid="main-view-player-bar"]',
    '[data-testid="bottom-bar"]'
  ].join(',');

  const LYRICS_PANE = [
    '[data-testid="lyrics-container"]',
    '[data-testid="lyrics-line-always-visible"]',
    '[data-testid^="lyrics-line"]',
    '[data-testid="fullscreen-lyric"]',
    '[data-testid="lyrics-unavailable"]',
    '[data-testid="lyrics-no-content"]',
    '[data-testid="lyrics-empty"]'
  ].join(',');

  function parseClock(text) {
    const parts = String(text || '').trim().split(':').map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  function textOfLinks(el) {
    if (!el) return '';
    const links = el.matches('a') ? [el] : [...el.querySelectorAll('a')];
    const list = links.length ? links.map((a) => norm(a.textContent)) : [norm(el.textContent)];
    return list.filter(Boolean).join(', ');
  }

  function trackFromTextLeaves(container) {
    const texts = [...container.querySelectorAll('*')]
      .filter((el) => !el.children.length && !el.closest('.slt-tr') && !/^\d{1,2}:\d{2}$/.test(el.textContent))
      .map((el) => norm(el.textContent))
      .filter((t) => t && /\p{L}|\p{N}/u.test(t));
    if (!texts.length) return null;
    const title = texts[0];
    const artist = [...new Set(texts.slice(1))].join(', ');
    return title && artist ? { title, artist } : null;
  }

  function getTrackInfo() {
    const npw = document.querySelector('[data-testid="now-playing-widget"]')
      || document.querySelector('[data-testid*="now-playing-widget" i]');
    const bar = document.querySelector(PLAYER_BAR)
      || (npw && (npw.closest('footer') || npw.parentElement))
      || document.querySelector('footer')
      || npw;
    if (!bar) {
      if (Date.now() - state.trackDebugAt > 5000) {
        state.trackDebugAt = Date.now();
        console.debug('[SLT] track not detected — no player bar or now-playing widget found in DOM');
      }
      return null;
    }

    const titleWrap = bar.querySelector('[data-testid="context-item-info-title"]');
    let titleEl = (titleWrap && titleWrap.querySelector('[data-testid="context-item-link"], a'))
      || bar.querySelector('[data-testid="context-item-link"], [data-testid="now-playing-widget-title"] a, [data-testid="nowplaying-track-link"], .track-info__name a')
      || titleWrap;
    let artistEl = bar.querySelector('[data-testid="context-item-info-subtitles"], [data-testid="context-item-info-artist"], [data-testid="nowplaying-artist"], [data-testid="now-playing-widget-artist"] a, .track-info__artists a');

    if (!titleEl) titleEl = bar.querySelector('[data-testid*="title" i]');
    if (!artistEl) artistEl = bar.querySelector('[data-testid*="artist" i], [data-testid*="subtitle" i]');

    let title = titleEl ? norm(titleEl.textContent) : '';
    let artist = textOfLinks(artistEl);

    if (!title || !artist) {
      const fromText = trackFromTextLeaves(npw || bar);
      if (fromText) {
        title = fromText.title;
        artist = fromText.artist;
      }
    }

    if (!title || !artist || /^advertisement$/i.test(title)) {
      if (Date.now() - state.trackDebugAt > 5000) {
        state.trackDebugAt = Date.now();
        const widget = bar.querySelector('[data-testid="now-playing-widget"]') || bar;
        console.debug('[SLT] track not detected — bar testid:', bar.getAttribute('data-testid'),
          '| title:', JSON.stringify(title), '| artist:', JSON.stringify(artist),
          '| widget HTML:', widget.outerHTML.slice(0, 600));
      }
      return null;
    }

    const href = (titleEl && (titleEl.getAttribute('href') || titleEl.href)) || '';
    const trackHref = bar.querySelector('a[href*="/track/"]');
    const idMatch = [href, trackHref ? trackHref.getAttribute('href') : '']
      .map((h) => h.match(/\/track\/([A-Za-z0-9]+)/))
      .find(Boolean);

    const durationEl = bar.querySelector('[data-testid="playback-duration"], [data-testid="playback_duration"]');
    const duration = durationEl ? Math.max(0, parseClock(durationEl.textContent)) : 0;

    return {
      id: idMatch ? idMatch[1] : '',
      title,
      artist,
      duration,
      key: idMatch ? 'trk:' + idMatch[1] : 'q:' + hash(artist + '\n' + title)
    };
  }

  function lyricsPaneOpen() {
    if (document.querySelector(LYRICS_PANE)) return true;
    return !!document.querySelector('[data-testid^="lyrics"]:not([data-testid^="lyrics-line"])');
  }

  function syncTrack() {
    const track = getTrackInfo();
    if (!track) return;
    if (state.track && state.track.key === track.key) {
      state.track = track;
      return;
    }

    if (state.panel) {
      state.panel.remove();
      state.panel = null;
      resetState();
    }

    state.track = track;
    state.found = null;
    state.promptedFor = null;
    state.noLyricsFor = null;
    state.dismissedFor = null;
    state.finding = null;
    state.findRetryAt = 0;
    state.findJob++;
    cancelFind();
    hidePrompt();
  }

  function lyricLines(lyrics) {
    if (!lyrics) return [];
    let text = String(lyrics.synced || '');
    if (text.trim()) {
      text = text.split('\n')
        .map((line) => line
          .replace(/^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, '')
          .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
          .replace(/^\s*\[(?:ar|al|ti|by|offset|re|ve|length):[^\]]*\]\s*$/i, '')
          .trim())
        .filter(Boolean)
        .join('\n');
    }
    if (!text.trim()) text = String(lyrics.plain || '');
    return text.split('\n').map(norm).filter((l) => l && hasLetters(l)).slice(0, 800);
  }

  function promptEl() {
    let el = document.getElementById('slt-prompt');
    if (!el) {
      el = document.createElement('div');
      el.id = 'slt-prompt';
      el.setAttribute('role', 'dialog');
      el.innerHTML = '<span class="slt-prompt-text">Found lyrics, show?</span>'
        + '<span class="slt-prompt-actions">'
        + '<button type="button" class="slt-prompt-show">Show</button>'
        + '<button type="button" class="slt-prompt-hide">Not now</button>'
        + '</span>';
      document.body.appendChild(el);
    }
    return el;
  }

  function showPrompt(trackKey) {
    if (!state.found || state.found.trackKey !== trackKey) return;
    const el = promptEl();
    el.querySelector('.slt-prompt-show').onclick = () => showFound(trackKey);
    el.querySelector('.slt-prompt-hide').onclick = () => {
      state.dismissedFor = trackKey;
      hidePrompt();
    };
    el.classList.add('on');
    clearTimeout(state.promptTimer);
    state.promptTimer = setTimeout(() => {
      state.dismissedFor = trackKey;
      hidePrompt();
    }, 15000);
  }

  function hidePrompt() {
    clearTimeout(state.promptTimer);
    const el = document.getElementById('slt-prompt');
    if (el) el.classList.remove('on');
  }

  function showFound(trackKey) {
    if (!state.found || state.found.trackKey !== trackKey || state.panel) return;
    if (!state.track || state.track.key !== trackKey) return;
    const lines = lyricLines(state.found.lyrics);
    hidePrompt();
    if (!lines.length) {
      state.noLyricsFor = trackKey;
      toast(state.found.lyrics.instrumental ? 'This track is instrumental' : 'No lyrics found on LRCLIB', { err: true });
      return;
    }

    const el = document.createElement('div');
    el.id = 'slt-lrc';
    el.innerHTML = '<div class="slt-lrc-head">'
      + '<span class="slt-lrc-heading"><span class="slt-lrc-title">Lyrics</span><span class="slt-lrc-src">LRCLIB</span></span>'
      + '<button type="button" class="slt-lrc-close" aria-label="Close lyrics" title="Close">×</button>'
      + '</div><div class="slt-lrc-body"></div>';

    el.querySelector('.slt-lrc-close').addEventListener('click', () => closePanel());
    const body = el.querySelector('.slt-lrc-body');
    for (const text of lines) {
      const line = document.createElement('div');
      line.className = 'slt-lrc-line';
      line.textContent = text;
      body.appendChild(line);
    }

    document.body.appendChild(el);
    state.panel = el;
    state.dismissedFor = null;
    scan();
  }

  function closePanel() {
    const el = state.panel;
    state.panel = null;
    if (el) el.remove();
    state.dismissedFor = state.found ? state.found.trackKey : (state.track ? state.track.key : null);
    state.found = null;
    resetState();
    scan();
  }

  function cancelFind() {
    clearTimeout(state.findTimer);
    state.findTimer = null;
  }

  function scheduleFind() {
    if (!settings.findLyrics || state.panel || !state.track) return;
    if (!lyricsPaneOpen()) return;
    if (state.findTimer) return;
    if (Date.now() < state.findRetryAt) return;

    const key = state.track.key;
    if (state.finding === key) return;
    if (state.noLyricsFor === key || state.dismissedFor === key || state.promptedFor === key) return;
    state.findTimer = setTimeout(() => runFind(false), 2200);
  }

  async function runFind(force) {
    cancelFind();
    const track = state.track;
    if (!track || state.panel) return;

    if (!force) {
      if (!settings.findLyrics || !lyricsPaneOpen()) return;
      if (state.finding === track.key) return;
      if (state.noLyricsFor === track.key || state.dismissedFor === track.key || state.promptedFor === track.key) return;
    }

    const job = ++state.findJob;
    state.finding = track.key;
    toast('Searching LRCLIB…', { sticky: true });

    const res = await send({
      type: 'find-lyrics',
      key: track.key,
      track: track.title,
      artist: track.artist,
      duration: track.duration,
      refresh: !!force
    });
    if (job !== state.findJob || !state.track || state.track.key !== track.key) {
      hideToast();
      return;
    }
    state.finding = null;
    state.findRetryAt = 0;
    hideToast();
    if (!force && (!settings.findLyrics || findLines() || !lyricsPaneOpen())) return;

    if (!res || !res.ok) {
      toast((res && res.error) || 'Could not reach LRCLIB', { err: true });
      if (!force) state.findRetryAt = Date.now() + 60000;
      return;
    }
    const hasText = !!(res.lyrics && ((res.lyrics.synced || '').trim() || (res.lyrics.plain || '').trim()));
    if (!res.found || !hasText) {
      state.noLyricsFor = track.key;
      state.promptedFor = track.key;
      const msg = res.instrumental || (res.lyrics && res.lyrics.instrumental) ? 'This track is instrumental' : 'No lyrics found on LRCLIB';
      toast(msg, { err: !!force });
      return;
    }

    state.found = { trackKey: track.key, lyrics: res.lyrics };
    state.promptedFor = track.key;
    if (settings.autoShowFound) showFound(track.key);
    else showPrompt(track.key);
  }

  function manualFind() {
    const track = getTrackInfo();
    if (!track) {
      toast('Play a song on Spotify first', { err: true });
      return;
    }
    if (state.panel && state.track && state.track.key === track.key) {
      toast('Lyrics are already shown');
      return;
    }
    if (state.finding) {
      toast('Already searching LRCLIB…', { sticky: true });
      return;
    }
    const now = Date.now();
    if (now - state.lastManualFindAt < 3000) {
      toast('Wait a few seconds between searches');
      return;
    }
    state.lastManualFindAt = now;
    if (state.panel) {
      state.panel.remove();
      state.panel = null;
      resetState();
    }
    state.track = track;
    state.found = null;
    state.promptedFor = null;
    state.noLyricsFor = null;
    state.dismissedFor = null;
    hidePrompt();
    state.findJob++;
    runFind(true);
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
    const mine = [...document.querySelectorAll('#slt-lrc .slt-lrc-line')];
    if (mine.length) {
      if (state.method !== 'panel') {
        state.method = 'panel';
        console.debug(`[SLT] lyrics found via panel (${mine.length} lines)`);
      }
      return mine;
    }

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
    clearTimeout(state.waitTimer);
    state.waitTimer = null;
    state.pending = null;
    removeAll();
    hideToast();
  }

  function scan() {
    syncTrack();

    const els = findLines();
    if (!els) {
      if (state.key !== null) resetState();
      scheduleFind();
      return null;
    }

    cancelFind();
    if (!state.panel && state.found && (!state.track || state.found.trackKey !== state.track.key)) {
      state.found = null;
      hidePrompt();
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
    state.pending = job;
    clearTimeout(state.waitTimer);
    state.waitTimer = setTimeout(() => toast('Translating lyrics…', { sticky: true }), 350);

    const res = await send({
      type: 'translate',
      key,
      target: settings.target,
      lines: unique,
      cacheOnly: !(manual || settings.auto),
      fallback: settings.fallbackTranslators !== false,
      requestId: job
    });
    if (state.pending === job) state.pending = null;
    clearTimeout(state.waitTimer);
    state.waitTimer = null;
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
    else if (manual || !res.cached) {
      const via = res.providerLabel ? ` via ${res.providerLabel}` : '';
      toast(res.cached ? `Loaded from cache${via}` : `Translated to ${langName(settings.target)}${via}`);
    } else hideToast();
  }

  function manualTranslate() {
    if (state.pending) {
      toast('Already translating…', { sticky: true });
      return;
    }
    const now = Date.now();
    if (now - state.lastManualTranslateAt < 2000) {
      toast('Wait a couple of seconds between retries');
      return;
    }
    state.lastManualTranslateAt = now;
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
    else if (m && m.type === 'find-lyrics-now') manualFind();
    else if (m && m.type === 'translate-status') {
      if (m.requestId != null ? m.requestId !== state.pending : (m.key && m.key !== state.key)) {
        return reply({ ok: true });
      }
      clearTimeout(state.waitTimer);
      state.waitTimer = null;
      if (m.text) toast(String(m.text), { sticky: true });
    }
    reply({ ok: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const prev = settings;
    settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
    applyVars();
    if (prev.onlyTranslated !== settings.onlyTranslated) state.remeasure = true;
    if (prev.findLyrics && !settings.findLyrics) cancelFind();
    if (!prev.findLyrics && settings.findLyrics) {
      state.noLyricsFor = null;
      state.dismissedFor = null;
    }
    if (!prev.auto && settings.auto && state.key && !state.map) start(state.key);
    if (!prev.autoShowFound && settings.autoShowFound && state.found && !state.panel) {
      showFound(state.found.trackKey);
    }
    scan();
  });

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

    if (e.code === 'KeyT') {
      e.preventDefault();
      manualTranslate();
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      manualFind();
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
    if (el && el.closest && el.closest('.slt-tr, #slt-toast, #slt-prompt, #slt-lrc')) return true;
    if (m.type !== 'childList') return false;
    const nodes = [...m.addedNodes, ...m.removedNodes];
    if (nodes.length === 0) return true;
    return nodes.every((x) => x.nodeType === 1 && (
      (x.classList && x.classList.contains('slt-tr'))
      || x.id === 'slt-toast'
      || x.id === 'slt-prompt'
      || x.id === 'slt-lrc'
    ));
  }

  function restoreNow() {
  if (!state.map) return false;
  const els = findLines();
  if (!els) return false;
  const texts = els.map(getText);
  if (hash(settings.target + '\n' + texts.join('\n')) !== state.key) return false;
  applyAll(els, texts);
  return true;
}

  function init() {
    console.info(`[SLT] v${chrome.runtime.getManifest().version} content script active`);
    applyVars();
    new MutationObserver((muts) => {
      if (muts.every(isOwn)) return;
      if (!state.map) { schedule(); return; }
      if (!restoreNow()) schedule();
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
