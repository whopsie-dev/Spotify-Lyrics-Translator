# Spotify Lyrics Translator

A Chrome extension that shows translated lyrics below the original lines on the [Spotify Web Player](https://open.spotify.com). Translations are cached locally so the same song never needs to be translated twice.

![Chrome Web Store](https://img.shields.io/badge/platform-Chrome-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-MIT-blue)

> **Questions, feedback or bug reports?** Message **@xocn** on Discord, or [join the Discord server](https://discord.gg/CKCvBckGVJ).

## Features

- **Inline translations** — translated text appears directly under each lyric line
- **Auto-translate** — lyrics are translated as soon as they appear (can be toggled off)
- **37 languages** — English, Spanish, French, German, Japanese, Korean, Chinese, and many more
- **Local cache** — translations are stored in your browser; no account or server needed
- **Customisable** — font size, opacity, line spacing, italic toggle, "show only translated" mode
- **Keyboard shortcuts** — `Alt+T` translate, `Alt+H` toggle original, `Alt+R` reset
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

1. Open the Spotify Web Player and play a song that has lyrics
2. The extension automatically detects and translates the lyrics
3. Click the extension icon in the toolbar to open the settings popup

### Settings

| Setting | Description |
|---|---|
| **Translate to** | Target language for translations |
| **Translate automatically** | Translate lyrics as soon as they appear |
| **Font size** | Size of the translated text relative to the original |
| **Opacity** | Transparency of the translated text |
| **Line spacing** | Extra space between the original and translated lines |
| **Italic** | Render translated text in italic |
| **Show only translated** | Hide the original lyrics, show only the translation |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+T` | Translate current lyrics |
| `Alt+H` | Toggle between original + translated and translated only |
| `Alt+R` | Reset translation for the current song |

## How It Works

The content script watches the Spotify Web Player DOM for lyric lines using known `data-testid` selectors, with a layout-heuristic fallback. When lyrics are found, they are sent to the background service worker, which translates them via Google Translate's public API and caches the results in `chrome.storage.local`. Translated text is injected as a child element of each lyric line so it inherits Spotify's styling and click-to-seek behaviour.

## Project Structure

```
spotify-lyrics-translator/
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — translation + cache
├── content.js         # Content script — DOM observation + rendering
├── content.css        # Styles for translated lines and toast
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

No data is collected. Lyric text is sent to Google Translate for translation; nothing else leaves your browser. See [PRIVACY.md](PRIVACY.md) for full details.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support & Contact

Need help, found a bug, or have a feature request? Reach out on Discord:

- **Discord:** `@xocn`
- **Discord server:** [https://discord.gg/CKCvBckGVJ](https://discord.gg/CKCvBckGVJ)

## License

[MIT](LICENSE)

