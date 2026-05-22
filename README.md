# Say & See

A tiny PWA for kids learning to spell. Hold the mic, say a word, see how it's spelled. Tap the word to hear it again.

Pure HTML/CSS/JS — no framework, no backend, no API key. Uses the browser's built-in `SpeechRecognition` (transcription) and `SpeechSynthesis` (read-back).

## Browser support

- Chrome (desktop + Android): ✅ full support
- Safari (iOS 14.5+ / macOS): ✅ full support
- Edge: ✅ full support
- Firefox: ❌ no `SpeechRecognition` — the app shows a friendly fallback message

HTTPS is required for the microphone (Coolify gives you that automatically via its reverse proxy + Let's Encrypt).

## Run locally

Anything that serves static files works. Quickest:

```bash
cd public
python3 -m http.server 8080
# open http://localhost:8080
```

Or build the Docker image:

```bash
docker build -t say-and-see .
docker run --rm -p 8080:80 say-and-see
```

Note: `SpeechRecognition` requires either `localhost` or HTTPS — it will not work over `http://<lan-ip>:8080` from another device. Use Coolify's HTTPS URL for testing on the kids' tablet.

## Deploy on Coolify

Same pattern as `cmd-drive`:

1. Push this folder to a GitHub repo (e.g. `say-and-see`).
2. In Coolify → **New Resource → Application → Public/Private Repository**.
3. **Build pack**: Dockerfile. Path: `/Dockerfile`. Base directory: `/`.
4. **Port**: `80` (exposed by nginx in the container).
5. **Domain**: e.g. `spell.cmdward.xyz` — Coolify will provision HTTPS via Let's Encrypt and route through your Cloudflare tunnel.
6. Deploy. Subsequent `git push` to the configured branch auto-deploys.

No environment variables, no volumes, no database.

## File layout

```
say-and-see/
├── Dockerfile           # nginx:alpine static serve
├── nginx.conf           # SPA fallback, no-cache for HTML/SW, mic permissions header
├── .dockerignore
├── .gitignore
├── README.md
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js              # press-and-hold mic, transcribe, speak back
    ├── manifest.webmanifest
    ├── service-worker.js   # offline app-shell cache
    └── icons/
        ├── icon.svg
        ├── icon-192.png
        └── icon-512.png
```

## Updating the icon

Edit `public/icons/icon.svg`, then regenerate the PNGs:

```bash
cd public/icons
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
```

## Bumping cached assets

The service worker uses a single cache key (`say-and-see-v1` in `service-worker.js`). When you ship a CSS/JS change and want every device to drop its old copy, bump the version (e.g. `v2`). Old caches are deleted on the next activate.
