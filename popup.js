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

const LANGS = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
  ['pl', 'Polish'], ['cs', 'Czech'], ['sk', 'Slovak'], ['sl', 'Slovenian'],
  ['hr', 'Croatian'], ['sr', 'Serbian'], ['bg', 'Bulgarian'], ['ro', 'Romanian'],
  ['hu', 'Hungarian'], ['el', 'Greek'], ['tr', 'Turkish'], ['nl', 'Dutch'],
  ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'], ['fi', 'Finnish'],
  ['ar', 'Arabic'], ['he', 'Hebrew'], ['fa', 'Persian'], ['hi', 'Hindi'],
  ['bn', 'Bengali'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['id', 'Indonesian'],
  ['ms', 'Malay'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)']
];

const $ = (id) => document.getElementById(id);
const SLIDERS = ['fontSize', 'opacity', 'lineSpacing'];
const TOGGLES = ['auto', 'italic', 'onlyTranslated', 'findLyrics', 'autoShowFound', 'fallbackTranslators'];
let s = { ...DEFAULTS };

function paint(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--p', p + '%');
  $(el.id + 'V').textContent = el.value + '%';
}

function render() {
  $('target').value = s.target;
  TOGGLES.forEach((id) => { $(id).checked = !!s[id]; });
  $('autoShowFound').disabled = !s.findLyrics;
  SLIDERS.forEach((id) => { $(id).value = s[id]; paint($(id)); });
}

const save = () => chrome.storage.local.set({ settings: s });

async function toTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return false;
  try { await chrome.tabs.sendMessage(tab.id, msg); return true; }
  catch { return false; }
}

async function refreshCount() {
  const { cacheIndex = [], lyricsIndex = [] } = await chrome.storage.local.get(['cacheIndex', 'lyricsIndex']);
  const n = cacheIndex.length + lyricsIndex.length;
  $('cacheCount').textContent = n === 1 ? '1 item cached' : `${n} items cached`;
}

async function action(type) {
  $('status').textContent = '';
  if (!(await toTab({ type }))) {
    $('status').textContent = 'Open open.spotify.com and refresh the tab first.';
  }
}

(async function init() {
  $('target').innerHTML = LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  $('extVersion').textContent = 'v' + chrome.runtime.getManifest().version;

  const { settings } = await chrome.storage.local.get('settings');
  s = { ...DEFAULTS, ...(settings || {}) };
  render();
  refreshCount();

  $('target').addEventListener('change', (e) => { s.target = e.target.value; save(); });
  TOGGLES.forEach((id) => $(id).addEventListener('change', (e) => {
    s[id] = e.target.checked;
    if (id === 'findLyrics') $('autoShowFound').disabled = !s.findLyrics;
    save();
  }));
  SLIDERS.forEach((id) => $(id).addEventListener('input', (e) => {
    s[id] = Number(e.target.value);
    paint(e.target);
    save();
  }));

  $('defaults').addEventListener('click', () => {
    s = { ...DEFAULTS, target: s.target, auto: s.auto };
    render();
    save();
  });
  $('translate').addEventListener('click', () => action('translate-now'));
  $('reset').addEventListener('click', () => action('reset'));
  $('find').addEventListener('click', () => action('find-lyrics-now'));

  $('clearCache').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('song:') || k.startsWith('lyrics:'));
    await chrome.storage.local.remove([...keys, 'cacheIndex', 'lyricsIndex']);
    refreshCount();
  });

  chrome.storage.onChanged.addListener((c) => { if (c.cacheIndex || c.lyricsIndex) refreshCount(); });
})();

