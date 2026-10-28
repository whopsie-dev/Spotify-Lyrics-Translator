const MAX_SONGS = 1500;
const MAX_LYRICS = 800;
const MAX_CHARS = 4000;
const MAX_FIND_CANDIDATES = 3;
const SPOTIFY = /^https:\/\/open\.spotify\.com\//;
const YOUTUBE = /^https:\/\/www\.youtube\.com\//;
const LRCLIB = 'https://lrclib.net';
const MANIFEST_VERSION = (() => {
  try { return chrome.runtime.getManifest().version; } catch { return '1.4.0'; }
})();
const LRCLIB_HEADERS = {
  'Lrclib-Client': `Spotify Lyrics Translator v${MANIFEST_VERSION} (https://github.com/whopsie-dev/Spotify-Lyrics-Translator)`,
  'X-User-Agent': `Spotify Lyrics Translator v${MANIFEST_VERSION} (https://github.com/whopsie-dev/Spotify-Lyrics-Translator)`
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRANSLATE_COOLDOWN = 2 * 60 * 1000;
const TRANSLATE_PROVIDERS = ['google', 'mozhi', 'lingva'];
let translateBlocks = null;
let translateBlocksLoading = null;

function loadTranslateBlocks() {
  if (!translateBlocksLoading) {
    translateBlocksLoading = chrome.storage.local.get(['translateBlocks', 'translateBlockedUntil'])
      .then(({ translateBlocks: stored, translateBlockedUntil: legacy }) => {
        translateBlocks = { ...(stored || {}) };
        const old = Number(legacy);
        if (old > Date.now()) {
          translateBlocks.google = Math.max(Number(translateBlocks.google) || 0, old);
        }
      })
      .catch(() => { translateBlocks = {}; });
  }
  return translateBlocksLoading;
}

function isBlocked(name) {
  return !!translateBlocks && Number(translateBlocks[name]) > Date.now();
}

async function blockProvider(name) {
  await loadTranslateBlocks();
  translateBlocks[name] = Date.now() + TRANSLATE_COOLDOWN;
  try { await chrome.storage.local.set({ translateBlocks }); } catch {}
}

function cooldownError(names) {
  const now = Date.now();
  const times = names
    .map((n) => Number(translateBlocks && translateBlocks[n]) || 0)
    .filter((t) => t > now);
  const mins = times.length ? Math.max(1, Math.ceil((Math.min(...times) - now) / 60000)) : 2;
  const onlyGoogle = names.length === 1 && names[0] === 'google';
  const label = onlyGoogle ? 'Google Translate rate limit reached' : 'Translation services are rate-limited';
  const hint = onlyGoogle ? ' Fallback services are off in the popup.' : '';
  return new Error(`${label}. Translations paused for ~${mins} min.${hint} Press Alt+T to retry.`);
}

function sendTranslateStatus(tabId, key, text, requestId) {
  if (!tabId || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') return;
  try {
    const sent = chrome.tabs.sendMessage(tabId, { type: 'translate-status', key, text, requestId });
    if (sent && typeof sent.catch === 'function') sent.catch(() => {});
  } catch {}
}

function attemptSummary(attempts) {
  return attempts
    .filter((a) => a.error)
    .map((a) => {
      const label = PROVIDER_LABELS[a.provider] || a.provider;
      if (a.error === 'rate-limited') return `${label} is rate-limited`;
      if (a.error === 'cooldown') return `${label} is paused`;
      return `${label} failed`;
    })
    .join('; ');
}

function syncAction(tabId, url) {
  if (url && (SPOTIFY.test(url) || YOUTUBE.test(url))) chrome.action.enable(tabId);
  else chrome.action.disable(tabId);
}

function initAction() {
  chrome.action.disable();
  chrome.tabs.query(
    { url: ['https://open.spotify.com/*', 'https://www.youtube.com/*'] },
    (tabs) => tabs.forEach((t) => chrome.action.enable(t.id))
  );
}

chrome.runtime.onInstalled.addListener(initAction);
chrome.runtime.onStartup.addListener(initAction);
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (info.url || info.status) syncAction(id, tab.url);
});
chrome.tabs.onActivated.addListener(({ tabId }) =>
  chrome.tabs.get(tabId, (t) => t && syncAction(tabId, t.url))
);

let writeChain = Promise.resolve();

async function getCached(key) {
  const k = 'song:' + key;
  const o = await chrome.storage.local.get(k);
  return o[k] || null;
}

function putCached(key, entry) {
  writeChain = writeChain.then(async () => {
    const { cacheIndex = [] } = await chrome.storage.local.get('cacheIndex');
    const idx = cacheIndex.filter((k) => k !== key);
    idx.push(key);
    const evict = [];
    while (idx.length > MAX_SONGS) evict.push('song:' + idx.shift());
    await chrome.storage.local.set({ ['song:' + key]: entry, cacheIndex: idx });
    if (evict.length) await chrome.storage.local.remove(evict);
  }).catch((e) => console.warn('[SLT] cache write failed', e));
  return writeChain;
}

async function clearCached(key) {
  writeChain = writeChain.then(async () => {
    const { cacheIndex = [] } = await chrome.storage.local.get('cacheIndex');
    await chrome.storage.local.remove('song:' + key);
    await chrome.storage.local.set({ cacheIndex: cacheIndex.filter((k) => k !== key) });
  });
  return writeChain;
}

let lyricsChain = Promise.resolve();

async function getCachedLyrics(key) {
  const k = 'lyrics:' + key;
  const o = await chrome.storage.local.get(k);
  return o[k] || null;
}

function putCachedLyrics(key, entry) {
  lyricsChain = lyricsChain.then(async () => {
    const { lyricsIndex = [] } = await chrome.storage.local.get('lyricsIndex');
    const idx = lyricsIndex.filter((k) => k !== key);
    idx.push(key);
    const evict = [];
    while (idx.length > MAX_LYRICS) evict.push('lyrics:' + idx.shift());
    await chrome.storage.local.set({ ['lyrics:' + key]: entry, lyricsIndex: idx });
    if (evict.length) await chrome.storage.local.remove(evict);
  }).catch((e) => console.warn('[SLT] lyrics cache write failed', e));
  return lyricsChain;
}

const NORM = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function words(s) {
  return NORM(s).split(' ').filter((w) => w.length > 2);
}

function overlaps(a, b) {
  const wa = words(a);
  const wb = new Set(words(b));
  return wa.some((w) => wb.has(w));
}

function hasLyrics(rec) {
  return !!(rec && ((rec.plainLyrics && rec.plainLyrics.trim()) || (rec.syncedLyrics && rec.syncedLyrics.trim())));
}

function lyricLinesOf(rec) {
  const plain = String((rec && rec.plainLyrics) || '');
  const synced = String((rec && rec.syncedLyrics) || '');
  const raw = plain.trim()
    ? plain
    : synced
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, ' ')
      .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, ' ');
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

// LRCLIB also holds placeholder/spam records with the right title and artist
// but no actual lyrics (a single "probe" line, for example). Those would
// otherwise win a lookup and show up instead of the real text.
function hasUsableLyrics(rec) {
  const lines = lyricLinesOf(rec);
  if (lines.length >= 2) return true;
  return lines.join(' ').length >= 200;
}

function lyricsEntry(rec) {
  return {
    found: true,
    plain: rec.plainLyrics || '',
    synced: rec.syncedLyrics || '',
    trackName: rec.trackName || '',
    artistName: rec.artistName || '',
    albumName: rec.albumName || '',
    duration: Number(rec.duration) || null,
    instrumental: !!rec.instrumental,
    ts: Date.now()
  };
}

function pickBest(list, meta) {
  if (!Array.isArray(list)) return null;
  const wantTrack = NORM(meta.track);
  const wantArtist = NORM(meta.artist);
  let best = null;
  let bestScore = -Infinity;

  for (const rec of list) {
    if (!rec || (!hasLyrics(rec) && !rec.instrumental)) continue;
    if (!rec.instrumental && !hasUsableLyrics(rec)) continue;

    const track = NORM(rec.trackName);
    const artist = NORM(rec.artistName);
    let score = 0;

    if (wantTrack && track) {
      if (track === wantTrack) score += 50;
      else if (track.includes(wantTrack) || wantTrack.includes(track)) score += 30;
      else if (overlaps(track, wantTrack)) score += 10;
      else continue;
    }
    if (wantArtist && artist) {
      if (artist === wantArtist) score += 40;
      else if (artist.includes(wantArtist) || wantArtist.includes(artist)) score += 20;
      else if (overlaps(artist, wantArtist)) score += 5;
      else continue;
    }

    if (rec.syncedLyrics && rec.syncedLyrics.trim()) score += 8;
    if (rec.plainLyrics && rec.plainLyrics.trim()) score += 2;
    if (rec.instrumental) score -= 30;

    const dur = Number(rec.duration);
    if (meta.duration && dur) {
      const delta = Math.abs(dur - meta.duration);
      if (delta <= 3) score += 15;
      else if (delta <= 10) score += 8;
      else if (delta > 45) score -= 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return best;
}

const SERVICE_INTERVALS = { lrclib: 1000, google: 350, mozhi: 400, lingva: 400 };
const serviceLastAt = { lrclib: 0, google: 0, mozhi: 0, lingva: 0 };
const serviceQueues = { lrclib: Promise.resolve(), google: Promise.resolve(), mozhi: Promise.resolve(), lingva: Promise.resolve() };

function paced(name, run) {
  const p = serviceQueues[name].then(async () => {
    const wait = SERVICE_INTERVALS[name] - (Date.now() - serviceLastAt[name]);
    if (wait > 0) await sleep(wait);
    serviceLastAt[name] = Date.now();
    return run();
  });
  serviceQueues[name] = p.then(() => {}, () => {});
  return p;
}

async function lrclibRequest(path, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(`${LRCLIB}${path}?${params}`, {
        headers: LRCLIB_HEADERS,
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 404) return null;
    if (res.ok) return await res.json();

    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      let wait = 1000 * (attempt + 1);
      const retryAfter = Number(res.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) wait = Math.min(retryAfter * 1000, 15000);
      await sleep(wait + Math.random() * wait * 0.25);
      continue;
    }

    throw new Error(`LRCLIB is unavailable right now (error ${res.status}) — try again in a minute`);
  }
  throw new Error('LRCLIB did not respond — check your connection and try again');
}

function lrclibFetch(path, params) {
  return paced('lrclib', () => lrclibRequest(path, params));
}

async function lrclibLookup(meta, { qFallback = true } = {}) {
  const getParams = new URLSearchParams({
    track_name: meta.track,
    artist_name: meta.artist
  });
  if (meta.album) getParams.set('album_name', meta.album);
  if (meta.duration) getParams.set('duration', String(meta.duration));

  const exact = await lrclibFetch('/api/get', getParams);
  if (exact && exact.instrumental) return lyricsEntry(exact);
  if (hasLyrics(exact) && hasUsableLyrics(exact)) return lyricsEntry(exact);

  let results = await lrclibFetch('/api/search', new URLSearchParams({
    track_name: meta.track,
    artist_name: meta.artist
  }));
  let best = pickBest(results, meta);
  if (best) return lyricsEntry(best);

  if (qFallback) {
    results = await lrclibFetch('/api/search', new URLSearchParams({
      q: `${meta.track} ${meta.artist}`.trim()
    }));
    best = pickBest(results, meta);
    if (best) return lyricsEntry(best);
  }

  return null;
}

// YouTube titles are messy, so the content script sends several title/artist
// guesses. Try them in order, then fall back to a free-text search of the
// (cleaned) video title.
async function lrclibSearchQuery(q, metas) {
  const text = String(q || '').trim();
  if (!text) return null;
  const results = await lrclibFetch('/api/search', new URLSearchParams({ q: text }));
  if (!Array.isArray(results)) return null;
  for (const meta of metas) {
    const hit = pickBest(results, meta);
    if (hit) return lyricsEntry(hit);
  }
  return null;
}

function findCandidates(msg) {
  const duration = Number(msg.duration) > 0 ? Math.round(Number(msg.duration)) : 0;
  const out = [];
  const seen = new Set();

  const push = (track, artist) => {
    const t = String(track || '').trim();
    const a = String(artist || '').trim();
    if (!t || !a) return;
    const key = `${t}\n${a}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ track: t, artist: a, duration });
  };

  if (Array.isArray(msg.candidates)) {
    for (const cand of msg.candidates) {
      if (cand) push(cand.track, cand.artist);
    }
  }
  // Only fall back to the raw metadata when the content script had no parsed
  // candidates (Spotify), otherwise it just repeats a worse query.
  if (!out.length) push(msg.track, msg.artist);
  return out.slice(0, MAX_FIND_CANDIDATES);
}

async function handleFindLyrics(msg) {
  const key = String(msg.key || '').trim();
  if (!key) throw new Error('Missing track key');

  const cached = await getCachedLyrics(key);
  if (cached && (!msg.refresh || cached.found)) {
    return {
      ok: true,
      found: !!cached.found,
      instrumental: !!cached.instrumental,
      lyrics: cached,
      cached: true
    };
  }

  const candidates = findCandidates(msg);
  if (!candidates.length) throw new Error('Missing track metadata');
  const album = String(msg.album || '').trim();
  const query = String(msg.query || '').trim();

  const existing = inflightFinds.get(key);
  if (existing) return existing;
  const p = (async () => {
    const wait = 2000 - (Date.now() - lastFindLookupAt);
    if (wait > 0) await sleep(wait);
    lastFindLookupAt = Date.now();

    let found = null;
    for (let i = 0; i < candidates.length && !found; i++) {
      const meta = { ...candidates[i], album: i === 0 ? album : '' };
      // When the content script sent a title to search for, that free-text pass
      // below is the same query for every candidate, so skip the per-candidate
      // fallback and spend the request once.
      found = await lrclibLookup(meta, { qFallback: !query && i === candidates.length - 1 });
    }
    if (!found && query) found = await lrclibSearchQuery(query, candidates);

    const entry = found || { found: false, instrumental: false, ts: Date.now() };
    await putCachedLyrics(key, entry);
    return {
      ok: true,
      found: entry.found,
      instrumental: entry.instrumental,
      lyrics: entry,
      cached: false
    };
  })().finally(() => inflightFinds.delete(key));
  inflightFinds.set(key, p);
  return p;
}

const PROVIDER_LIMITS = { google: MAX_CHARS, mozhi: 3500, lingva: 500 };
const PROVIDER_LABELS = { google: 'Google Translate', mozhi: 'Mozhi', lingva: 'Lingva' };
const MOZHI_BASES = [
  'https://mozhi.aryak.me',
  'https://mozhi.ducks.party',
  'https://translate.projectsegfau.lt'
];
const LINGVA_BASE = 'https://lingva.ml';

async function fetchWithTimeout(url, options = {}, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function providerError(name, status) {
  const label = PROVIDER_LABELS[name] || name;
  const err = new Error(`${label} error (${status})`);
  err.provider = name;
  err.status = typeof status === 'number' ? status : null;
  return err;
}

async function googleTranslate(text, target) {
  const base = 'https://translate.googleapis.com/translate_a/single';
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't' });
  let res = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await paced('google', () => fetchWithTimeout(`${base}?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ q: text })
      }));
    } catch {
      if (attempt < 2) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      throw providerError('google', 'network');
    }
    if (res.ok) break;
    if (res.status === 429) throw providerError('google', 429);
    if (res.status >= 500 && attempt < 2) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (text.length <= 900) {
      try {
        res = await paced('google', () => fetchWithTimeout(`${base}?${params}&q=${encodeURIComponent(text)}`));
      } catch {
        throw providerError('google', 'network');
      }
      if (res.ok) break;
      if (res.status === 429) throw providerError('google', 429);
    }
    break;
  }
  if (!res || !res.ok) {
    throw providerError('google', res ? res.status : 'no response');
  }

  const data = await res.json();
  const segs = Array.isArray(data[0]) ? data[0] : [];
  return {
    text: segs.map((s) => (s && s[0] ? s[0] : '')).join(''),
    src: data[2] || null
  };
}

async function mozhiTranslate(text, target) {
  let lastError = null;
  for (const base of MOZHI_BASES) {
    let res;
    try {
      res = await paced('mozhi', () => fetchWithTimeout(`${base}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ engine: 'google', from: 'auto', to: target, text })
      }));
    } catch {
      lastError = providerError('mozhi', 'network');
      continue;
    }
    if (!res.ok) {
      lastError = providerError('mozhi', res.status);
      continue;
    }
    let data;
    try {
      data = await res.json();
    } catch {
      lastError = providerError('mozhi', 'invalid response');
      continue;
    }
    if (data && typeof data['translated-text'] === 'string') {
      return { text: data['translated-text'], src: data.detected || null };
    }
    lastError = providerError('mozhi', 'invalid response');
  }
  throw lastError || providerError('mozhi', 'unavailable');
}

async function lingvaTranslate(text, target) {
  const url = `${LINGVA_BASE}/api/v1/auto/${encodeURIComponent(target)}/${encodeURIComponent(text)}`;
  let res;
  try {
    res = await paced('lingva', () => fetchWithTimeout(url, { headers: { Accept: 'application/json' } }));
  } catch {
    throw providerError('lingva', 'network');
  }
  if (!res.ok) throw providerError('lingva', res.status);
  const data = await res.json();
  if (!data || typeof data.translation !== 'string') {
    throw providerError('lingva', 'invalid response');
  }
  return { text: data.translation, src: (data.info && data.info.detectedSource) || null };
}

function translateWithProvider(name, text, target) {
  if (name === 'google') return googleTranslate(text, target);
  if (name === 'mozhi') return mozhiTranslate(text, target);
  if (name === 'lingva') return lingvaTranslate(text, target);
  return Promise.reject(providerError(name, 'unknown provider'));
}

async function translateChunk(lines, target, provider) {
  const r = await translateWithProvider(provider, lines.join('\n'), target);
  const parts = r.text.split('\n');
  if (parts.length === lines.length) {
    return { out: parts.map((s) => s.trim()), src: r.src };
  }
  const out = [];
  let src = r.src;
  for (const line of lines) {
    const x = await translateWithProvider(provider, line, target);
    out.push(x.text.replace(/\n/g, ' ').trim());
    src = src || x.src;
    await sleep(provider === 'google' ? 120 : 250);
  }
  return { out, src };
}

async function translateLinesWithProvider(lines, target, provider) {
  const limit = PROVIDER_LIMITS[provider] || MAX_CHARS;
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const l of lines) {
    if (cur.length && len + l.length + 1 > limit) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(l);
    len += l.length + 1;
  }
  if (cur.length) chunks.push(cur);

  const map = {};
  let src = null;
  for (const ch of chunks) {
    const r = await translateChunk(ch, target, provider);
    if (provider === 'lingva' && ch.every((line, i) => r.out[i] === line.trim())) {
      throw providerError(provider, 'unchanged');
    }
    ch.forEach((line, i) => { map[line] = r.out[i]; });
    src = src || r.src;
  }
  return { map, src };
}

async function translateLines(lines, target, fallback = true, onStatus) {
  await loadTranslateBlocks();
  const names = fallback === false ? ['google'] : TRANSLATE_PROVIDERS;
  const attempts = [];
  let sawError = false;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (isBlocked(name)) {
      attempts.push({ provider: name, error: 'cooldown' });
      continue;
    }

    const next = names.slice(i + 1).find((n) => !isBlocked(n));
    if (onStatus) onStatus(`Trying ${PROVIDER_LABELS[name]}…`);

    try {
      const result = await translateLinesWithProvider(lines, target, name);
      return { ...result, provider: name, providerLabel: PROVIDER_LABELS[name], attempts };
    } catch (e) {
      if (e && e.status === 429) {
        await blockProvider(name);
        attempts.push({ provider: name, error: 'rate-limited' });
        if (onStatus && next) onStatus(`${PROVIDER_LABELS[name]} is rate-limited — trying ${PROVIDER_LABELS[next]}…`);
      } else {
        sawError = true;
        attempts.push({ provider: name, error: String((e && e.message) || e) });
        if (onStatus && next) onStatus(`${PROVIDER_LABELS[name]} failed — trying ${PROVIDER_LABELS[next]}…`);
      }
    }
  }

  if (!sawError) throw cooldownError(names);
  const detail = attemptSummary(attempts);
  const err = new Error(`Translation failed${detail ? ` (${detail})` : ''}. Press Alt+T to retry.`);
  err.attempts = attempts;
  throw err;
}

const inflightTranslates = new Map();
const inflightFinds = new Map();
let lastFindLookupAt = 0;

async function handleTranslate(msg, onStatus) {
  const dedupe = `${msg.key}|${msg.target}`;
  const existing = inflightTranslates.get(dedupe);
  if (existing) return existing;
  const p = doTranslate(msg, onStatus).finally(() => inflightTranslates.delete(dedupe));
  inflightTranslates.set(dedupe, p);
  return p;
}

async function doTranslate({ key, target, lines, cacheOnly, fallback }, onStatus) {
  const cached = await getCached(key);
  if (cached) return { ok: true, map: cached.map, cached: true, provider: cached.provider || null, providerLabel: cached.providerLabel || null };
  if (cacheOnly) return { ok: true, miss: true };

  const { map, src, provider, providerLabel } = await translateLines(lines, target, fallback !== false, onStatus);
  const sameLang = src && src.split('-')[0] === target.split('-')[0];
  const finalMap = sameLang ? {} : map;
  await putCached(key, { map: finalMap, src, target, ts: Date.now(), provider, providerLabel });
  return { ok: true, map: finalMap, cached: false, provider, providerLabel };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'translate') {
        const tabId = sender && sender.tab && sender.tab.id;
        sendResponse(await handleTranslate(msg, (text) =>
          sendTranslateStatus(tabId, msg.key, text, msg.requestId)));
      } else if (msg.type === 'find-lyrics') sendResponse(await handleFindLyrics(msg));
      else if (msg.type === 'clear') {
        await clearCached(msg.key);
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e), attempts: (e && e.attempts) || null });
    }
  })();
  return true;
});
