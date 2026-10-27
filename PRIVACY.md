# Privacy Policy

**Spotify Lyrics Translator** respects your privacy. Here is exactly what the extension does and does not do with your data.

## Data Collected

**None.** The extension does not collect, transmit, or store any personal data.

## Network Requests

The extension sends lyric text to Google Translate's public API (`translate.googleapis.com`) solely to obtain translations. No other network requests are made. No data is sent to any server owned or operated by the extension's author.

## Local Storage

Translated lyrics are cached in your browser's local extension storage (`chrome.storage.local`) so the same song doesn't need to be translated twice. This data never leaves your browser. You can clear the cache at any time from the extension popup.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `storage` | Save your settings and the translation cache locally |
| `unlimitedStorage` | Allow the cache to grow beyond the default 5 MB limit |
| Host: `open.spotify.com` | Inject the content script that reads and annotates lyrics |
| Host: `translate.googleapis.com` | Send translation requests to Google Translate |

## Third-Party Services

- **Google Translate** — lyric text is sent to Google's public translation endpoint. Google's own privacy policy applies to that data in transit.

## Changes

If this policy changes, the update will be reflected in this file in the repository.

## Contact

If you have questions, open an issue on the GitHub repository, message **@xocn** on Discord, or join the Discord server at [https://discord.gg/CKCvBckGVJ](https://discord.gg/CKCvBckGVJ).

