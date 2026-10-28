# Spotify Lyrics Translator

A Chrome extension that shows translated lyrics below the original lines on the [Spotify Web Player](https://open.spotify.com). Translations are cached locally so the same song never needs to be translated twice.

![Chrome Web Store](https://img.shields.io/badge/platform-Chrome-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-MIT-blue)

> **Questions, feedback or bug reports?** Message **@xocn** on Discord, or [join the Discord server](https://discord.gg/CKCvBckGVJ).

## Features

- **Inline translations** — translated text appears directly under each lyric line
- **Auto-translate** — lyrics are translated as soon as they appear (can be toggled off)
- **Missing lyrics fallback** — when Spotify has no lyrics for a track, the extension searches [LRCLIB](https://lrclib.net) (free, no API key) and offers to show them
- **Translation fallbacks** — if Google Translate rate-limits you, Mozhi and Lingva keep translations working (optional)
- **37 languages** — English, Spanish, French, German, Japanese, Korean, Chinese, and many more
- **Local cache** — translations and found lyrics are stored in your browser; no account or server needed
- **Customisable** — font size, opacity, line spacing, italic toggle, "show only translated" mode
- **Keyboard shortcuts** — `Alt+T` translate, `Alt+L` find lyrics, `Alt+H` toggle original, `Alt+R` reset
- **Lightweight** — no dependencies, no bundler, no build step

## Install

### From source (developer mode)

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser)
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the project folder
5. Open [open.spotify.com](https://open.spotify.com) and play a song with lyrics

### From the Chrome Web Store

*Coming soon.*

## Usage

1. Open the Spotify Web Player and play a song
2. The extension automatically detects and translates the lyrics
3. If Spotify has no lyrics for the track, open the lyrics view and the extension will look them up on LRCLIB
4. Click the extension icon in the toolbar to open the settings popup

### Settings

| Setting | Description |
|---|---|
| **Translate to** | Target language for translations |
| **Translate automatically** | Translate lyrics as soon as they appear |
| **Find missing lyrics** | Search LRCLIB when Spotify has no lyrics for the current track (on by default) |
| **Auto show found lyrics** | Show LRCLIB lyrics immediately instead of asking first (off by default) |
| **Fallback translation services** | Use Mozhi and Lingva when Google Translate is rate-limited (on by default) |
| **Font size** | Size of the translated text relative to the original |
| **Opacity** | Transparency of the translated text |
| **Line spacing** | Extra space between the original and translated lines |
| **Italic** | Render translated text in italic |
| **Show only translated** | Hide the original lyrics, show only the translation |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+T` | Translate current lyrics |
| `Alt+L` | Find lyrics for the current track on LRCLIB |
| `Alt+H` | Toggle between original + translated and translated only |
| `Alt+R` | Reset translation for the current song |

## How It Works

The content script watches the Spotify Web Player DOM for lyric lines using known `data-testid` selectors, with a layout-heuristic fallback. When lyrics are found, they are sent to the background service worker, which translates them via Google Translate's public API and caches the results in `chrome.storage.local`. Translated text is injected as a child element of each lyric line so it inherits Spotify's styling and click-to-seek behaviour.

If Google Translate responds with a rate-limit error (HTTP 429), the extension pauses Google for two minutes and falls back to [Mozhi](https://codeberg.org/aryak/mozhi) and then [Lingva](https://github.com/thedaviddelta/lingva-translate). Rate limits are tracked per service, so a fallback that is also limited is skipped rather than retried. The toast shows which service is being tried, and names the fallback that succeeded. Cached translations always work, even while a service is paused, and `Alt+T` retries after the pause. You can turn the fallbacks off in the popup, in which case only Google Translate is used.

All network requests are paced — one request in flight per service with a minimum gap between requests (about a second for LRCLIB, ~350-400 ms for translators) — and repeated presses of the manual shortcuts are collapsed into a single request, so the extension never spams a service.

If the lyrics view is open but Spotify has no lyrics for the current track, the extension looks the track up on [LRCLIB](https://lrclib.net) using its title, artist, and duration. Found lyrics are shown in a panel on the right and are translated like native lyrics. Both found lyrics and "not found" results are cached locally, so each track is only looked up once. You can also trigger a lookup manually with `Alt+L` or the **Find lyrics now** button in the popup.

## Project Structure

```
spotify-lyrics-translator/
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — translation, LRCLIB lookup + cache
├── content.js         # Content script — DOM observation + rendering
├── content.css        # Styles for translated lines, prompts and the lyrics panel
├── popup.html         # Settings popup markup
├── popup.js           # Settings popup logic
├── popup.css          # Settings popup styles
├── icons/             # Extension icons (16, 32, 48, 128)
├── LICENSE            # MIT
├── PRIVACY.md         # Privacy policy
├── CONTRIBUTING.md    # Contribution guidelines
└── .gitignore
```

## Privacy

No data is collected. Lyric text is sent to Google Translate for translation. If fallback translators are enabled and Google is rate-limited, lyric text is also sent to Mozhi or Lingva. Track metadata (title, artist, duration) is sent to LRCLIB to look up missing lyrics. Nothing else leaves your browser. See [PRIVACY.md](PRIVACY.md) for full details.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support & Contact

Need help, found a bug, or have a feature request? Reach out on Discord:

- **Discord:** `@xocn`
- **Discord server:** [https://discord.gg/CKCvBckGVJ](https://discord.gg/CKCvBckGVJ)

## License

[MIT](LICENSE)

