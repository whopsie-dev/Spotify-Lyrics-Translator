const MAX_SONGS = 1500;
const MAX_CHARS = 4000;
const SPOTIFY = /^https:\/\/open\.spotify\.com\//;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function syncAction(tabId, url) {
  if (url && SPOTIFY.test(url)) chrome.action.enable(tabId);
  else chrome.action.disable(tabId);
}

function initAction() {
  chrome.action.disable();
  chrome.tabs.query({ url: 'https://open.spotify.com/*' }, (tabs) =>
    tabs.forEach((t) => chrome.action.enable(t.id))
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

async function google(text, target) {
  const base = 'https://translate.googleapis.com/translate_a/single';
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't' });
  let res = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${base}?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ q: text })
    });
    if (res.ok) break;
    if (res.status === 429 || res.status >= 500) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (text.length <= 900) {
      res = await fetch(`${base}?${params}&q=${encodeURIComponent(text)}`);
      if (res.ok) break;
    }
    break;
  }
  if (!res || !res.ok) {
    throw new Error(`Translation service error (${res ? res.status : 'no response'})`);
  }

  const data = await res.json();
  const segs = Array.isArray(data[0]) ? data[0] : [];
  return {
    text: segs.map((s) => (s && s[0] ? s[0] : '')).join(''),
    src: data[2] || null
  };
}

async function translateChunk(lines, target) {
  const r = await google(lines.join('\n'), target);
  const parts = r.text.split('\n');
  if (parts.length === lines.length) {
    return { out: parts.map((s) => s.trim()), src: r.src };
  }
  const out = [];
  let src = r.src;
  for (const line of lines) {
    const x = await google(line, target);
    out.push(x.text.replace(/\n/g, ' ').trim());
    src = src || x.src;
    await sleep(120);
  }
  return { out, src };
}

async function translateLines(lines, target) {
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const l of lines) {
    if (cur.length && len + l.length + 1 > MAX_CHARS) {
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
    const r = await translateChunk(ch, target);
    ch.forEach((line, i) => { map[line] = r.out[i]; });
    src = src || r.src;
  }
  return { map, src };
}

async function handleTranslate({ key, target, lines, cacheOnly }) {
  const cached = await getCached(key);
  if (cached) return { ok: true, map: cached.map, cached: true };
  if (cacheOnly) return { ok: true, miss: true };

  const { map, src } = await translateLines(lines, target);
  const sameLang = src && src.split('-')[0] === target.split('-')[0];
  const finalMap = sameLang ? {} : map;
  await putCached(key, { map: finalMap, src, target, ts: Date.now() });
  return { ok: true, map: finalMap, cached: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'translate') sendResponse(await handleTranslate(msg));
      else if (msg.type === 'clear') {
        await clearCached(msg.key);
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});
