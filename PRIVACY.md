# Privacy Policy

**Spotify Lyrics Translator** respects your privacy. Here is exactly what the extension does and does not do with your data.

## Data Collected

**None.** The extension does not collect, transmit, or store any personal data.

## Network Requests

The extension sends lyric text to Google Translate's public API (`translate.googleapis.com`) solely to obtain translations. If Google is rate-limited and fallback translators are enabled, lyric text is sent to Mozhi (`mozhi.aryak.me`, `mozhi.ducks.party`, or `translate.projectsegfau.lt`) and then Lingva (`lingva.ml`). When Spotify has no lyrics for the current track, or when a lyrics lookup is requested for a YouTube video, the extension sends the track's title, artist, and duration to LRCLIB (`lrclib.net`) to look up lyrics. No other network requests are made. No data is sent to any server owned or operated by the extension's author.

## Local Storage

Translated lyrics and lyrics found on LRCLIB are cached in your browser's local extension storage (`chrome.storage.local`) so the same song doesn't need to be translated or looked up twice. "Not found" results are cached too, to avoid repeated requests. This data never leaves your browser. You can clear the cache at any time from the extension popup.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `storage` | Save your settings and the translation/lyrics cache locally |
| `unlimitedStorage` | Allow the cache to grow beyond the default 5 MB limit |
| Host: `open.spotify.com` | Inject the content script that reads and annotates lyrics |
| Host: `www.youtube.com` | Inject the content script that reads video metadata and shows/translates found lyrics |
| Host: `translate.googleapis.com` | Send translation requests to Google Translate |
| Host: `mozhi.*`, `translate.projectsegfau.lt` | Fallback translation requests to Mozhi instances |
| Host: `lingva.ml` | Fallback translation requests to Lingva |
| Host: `lrclib.net` | Look up lyrics when Spotify doesn't have them |

## Third-Party Services

- **Google Translate** — lyric text is sent to Google's public translation endpoint. Google's own privacy policy applies to that data in transit.
- **Mozhi** — an open-source, community-run translation front-end. When fallback translators are enabled and Google is rate-limited, lyric text is sent to one of the Mozhi instances listed above; Mozhi then forwards it to the selected translation engine (Google).
- **Lingva** — an open-source, community-run Google Translate front-end. Used as the last fallback when both Google and Mozhi are rate-limited; lyric text is sent to `lingva.ml`, which forwards it to Google.
- **LRCLIB** — track or video title, artist, and duration are sent to this free, community-run lyrics database when a lookup is needed. See [lrclib.net](https://lrclib.net) for details.

## Changes

If this policy changes, the update will be reflected in this file in the repository.

## Contact

If you have questions, open an issue on the GitHub repository, message **@xocn** on Discord, or join the Discord server at [https://discord.gg/CKCvBckGVJ](https://discord.gg/CKCvBckGVJ).

