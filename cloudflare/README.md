# Cloudflare Pages

The web build also runs at https://serenity-blocks.pages.dev (GitHub Pages stays the one CI deploys). This folder holds
what Cloudflare needs beyond the build: `functions/` answers byte ranges for the music and the voices
(`byte-range.js`), which Pages itself does not. Without it a song cannot be sought and Safari may not play it.

Deploy from **this folder** (wrangler reads `functions/` from where it runs), with `dist/` built from a clean main:

```bash
npm run build
cd cloudflare
npx wrangler@4 pages deploy ../dist --project-name serenity-blocks --branch main
```

Any other `--branch` gives a preview address instead. Check afterwards:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Range: bytes=0-99" https://serenity-blocks.pages.dev/assets/music/echoes-of-the-soul.mp3   # 206
```
