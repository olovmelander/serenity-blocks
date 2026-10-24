/**
 * The trailer's title layer: logo, section words, mode wordmarks, lines of copy and the end card,
 * drawn as a transparent HTML page over the captured footage.
 *
 * Every element is placed by `window.__overlay.render(t)` from the timeline alone (no CSS
 * animation), so frame N is always the same picture. Fonts and artwork are inlined from
 * public/ (the game's own Unbounded and Manrope, the logo and the mode wordmarks), so the page
 * needs no server.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fontFace = (root, family, file) => {
    const data = readFileSync(path.join(root, 'public', 'fonts', file)).toString('base64');
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');`
        + 'font-weight:100 900;font-display:block}';
};

const svg = (root, file) => readFileSync(path.join(root, 'public', 'assets', 'branding', file), 'utf8')
    // Two wordmarks on one page must not share gradient ids.
    .replace(/id="([^"]+)"/g, (m, id) => `id="${file.replace(/\W/g, '')}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${file.replace(/\W/g, '')}-${id})`)
    .replace(/aria-labelledby="[^"]*"/g, '');

const escapeHtml = (text) => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One timeline item → its markup. Positioning and motion live in render(). */
function itemMarkup(root, item, index) {
    const id = `item-${index}`;
    switch (item.type) {
    case 'scrim':
        return `<div id="${id}" class="scrim scrim-${item.style || 'vignette'}"></div>`;
    case 'logo':
        return `<div id="${id}" class="logo-block ${item.position || 'center'}">
            <div class="logo">${svg(root, 'serenity-blocks-logo.svg')}</div>
            ${item.tagline ? `<div class="tagline">${item.tagline.map((word) => `<span>${escapeHtml(word)}</span>`).join('<i></i>')}</div>` : ''}
            ${item.line ? `<div class="end-line">${escapeHtml(item.line)}</div>` : ''}
            ${item.subline ? `<div class="end-subline">${escapeHtml(item.subline)}</div>` : ''}
        </div>`;
    case 'section':
        return `<div id="${id}" class="section ${item.position || 'center'}">
            <div class="section-word">${escapeHtml(item.text)}<b></b></div>
            ${item.sub ? `<div class="section-sub">${escapeHtml(item.sub)}</div>` : ''}
        </div>`;
    case 'mode':
        return `<div id="${id}" class="mode ${item.position || 'lower-left'}">
            <div class="mode-mark">${svg(root, `modes/${item.mode}.svg`)}</div>
            ${item.caption ? `<div class="mode-caption">${escapeHtml(item.caption)}</div>` : ''}
        </div>`;
    case 'line':
        return `<div id="${id}" class="line ${item.position || 'center'} ${item.size || 'md'}">${escapeHtml(item.text)}</div>`;
    case 'flash':
        return `<div id="${id}" class="flash"></div>`;
    case 'letterbox':
        return `<div id="${id}" class="letterbox"><i class="bar-top"></i><i class="bar-bottom"></i></div>`;
    default:
        throw new Error(`overlay: unknown item type ${item.type}`);
    }
}

export function buildOverlayHtml(root, timeline, { width, height }) {
    const items = timeline.map((item, index) => itemMarkup(root, item, index)).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace(root, 'Unbounded', 'unbounded/unbounded-latin-wght-normal.woff2')}
${fontFace(root, 'Manrope', 'manrope/manrope-latin-wght-normal.woff2')}
html,body{margin:0;width:${width}px;height:${height}px;background:transparent;overflow:hidden}
body{position:relative;color:#fff6e9;font-family:Manrope,sans-serif;
  --u:${height / 1080}px;-webkit-font-smoothing:antialiased}
body>div{position:absolute;opacity:0;will-change:opacity,transform}
.scrim{inset:0}
.scrim-vignette{background:radial-gradient(ellipse 70% 60% at 50% 50%,rgba(6,6,18,.55),rgba(6,6,18,.15) 60%,rgba(6,6,18,0) 80%)}
.scrim-lower{background:linear-gradient(0deg,rgba(6,6,18,.72),rgba(6,6,18,0) 42%)}
.scrim-black{background:#05050d}
.scrim-full{background:rgba(6,6,18,.62)}
.center{left:0;right:0;top:50%;display:flex;flex-direction:column;align-items:center;text-align:center}
.upper{left:0;right:0;top:16%;display:flex;flex-direction:column;align-items:center;text-align:center}
.lower{left:0;right:0;bottom:12%;display:flex;flex-direction:column;align-items:center;text-align:center}
.lower-left{left:calc(96*var(--u));bottom:calc(92*var(--u))}
.lower-right{right:calc(96*var(--u));bottom:calc(92*var(--u));display:flex;flex-direction:column;align-items:flex-end;text-align:right}
.upper-left{left:calc(96*var(--u));top:calc(88*var(--u))}
.logo{width:calc(760*var(--u));filter:drop-shadow(0 calc(10*var(--u)) calc(40*var(--u)) rgba(0,0,0,.45))}
.logo svg{width:100%;height:auto;display:block}
.tagline{margin-top:calc(34*var(--u));display:flex;align-items:center;gap:calc(26*var(--u));
  font:700 calc(24*var(--u)) Manrope;letter-spacing:.42em;text-transform:uppercase;color:#e9e3ff;text-shadow:0 2px 18px rgba(0,0,0,.5)}
.tagline i{width:calc(9*var(--u));height:calc(9*var(--u));border-radius:2px;background:#ffac88;display:block;margin-right:.42em}
.end-line{margin-top:calc(54*var(--u));font:700 calc(40*var(--u)) Unbounded;letter-spacing:.18em;color:#fff6e9;
  text-shadow:0 2px 24px rgba(0,0,0,.55)}
.end-subline{margin-top:calc(18*var(--u));font:600 calc(22*var(--u)) Manrope;letter-spacing:.32em;color:#c9c2e6;text-transform:uppercase}
.section-word{position:relative;font:800 calc(150*var(--u))/1 Unbounded;letter-spacing:.06em;
  background:linear-gradient(100deg,#b8a4ff,#9ee8ed 48%,#c5f1cf);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 calc(8*var(--u)) calc(36*var(--u)) rgba(0,0,0,.45))}
.section-word b{position:absolute;right:calc(-34*var(--u));top:calc(-6*var(--u));width:calc(30*var(--u));height:calc(30*var(--u));
  border-radius:calc(4*var(--u));background:#ffac88}
.section-sub{margin-top:calc(30*var(--u));font:600 calc(32*var(--u)) Manrope;letter-spacing:.04em;color:#fff6e9;
  text-shadow:0 2px 20px rgba(0,0,0,.6)}
.mode-mark{height:calc(64*var(--u))}
.mode-mark svg{height:100%;width:auto;display:block;filter:drop-shadow(0 4px 20px rgba(0,0,0,.5))}
.mode-caption{margin-top:calc(16*var(--u));font:600 calc(28*var(--u)) Manrope;color:#fff6e9;letter-spacing:.02em;
  text-shadow:0 2px 16px rgba(0,0,0,.7)}
.line{font-weight:600;color:#fff6e9;text-shadow:0 2px 24px rgba(0,0,0,.65);letter-spacing:.01em}
.line.md{font-size:calc(46*var(--u))}
.line.lg{font:700 calc(64*var(--u)) Unbounded;letter-spacing:.02em}
.line.sm{font-size:calc(28*var(--u));letter-spacing:.3em;text-transform:uppercase;color:#e9e3ff}
.flash{inset:0;background:#fff6e9}
.letterbox{inset:0;opacity:1}
.letterbox i{position:absolute;left:0;right:0;height:calc(138*var(--u));background:#05050d;display:block}
.letterbox .bar-top{top:0;transform-origin:top}
.letterbox .bar-bottom{bottom:0;transform-origin:bottom}
</style></head><body>
${items}
<script>
const timeline = ${JSON.stringify(timeline)};
const els = timeline.map((_, i) => document.getElementById('item-' + i));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
function envelope(item, t) {
    const fadeIn = item.fadeIn ?? 0.45;
    const fadeOut = item.fadeOut ?? 0.45;
    if (t < item.start || t > item.end) return { a: 0, inP: 0, outP: 1 };
    const inP = fadeIn > 0 ? clamp01((t - item.start) / fadeIn) : 1;
    const outP = fadeOut > 0 ? clamp01((item.end - t) / fadeOut) : 1;
    return { a: Math.min(ease(inP), ease(outP)), inP, outP };
}
window.__overlay = {
    duration: Math.max(...timeline.map((item) => item.end)),
    /** True when nothing is drawn at time t (the capture can reuse a blank frame). */
    isBlank(t) { return timeline.every((item) => t < item.start || t > item.end); },
    render(t) {
        timeline.forEach((item, i) => {
            const el = els[i];
            const { a, inP } = envelope(item, t);
            const peak = item.opacity ?? 1;
            el.style.opacity = String(a * peak);
            const local = t - item.start;
            let transform = '';
            const centered = el.classList.contains('center');
            if (item.type === 'logo') {
                const s = 1.06 - 0.06 * easeOut(local / 1.6) + 0.012 * Math.max(0, local - 1.6) / 4;
                transform = 'scale(' + s.toFixed(5) + ')';
            } else if (item.type === 'section') {
                const s = 1.12 - 0.12 * easeOut(local / 0.7) + 0.02 * clamp01((local - 0.7) / 3);
                transform = 'scale(' + s.toFixed(5) + ')';
                const word = el.querySelector('.section-word');
                word.style.letterSpacing = (0.02 + 0.06 * easeOut(local / 1.2)).toFixed(4) + 'em';
            } else if (item.type === 'letterbox') {
                // 2.39:1 bars that slide in and out rather than fade.
                el.style.opacity = a > 0 ? '1' : '0';
                const k = a.toFixed(4);
                el.querySelectorAll('i').forEach((bar) => { bar.style.transform = 'scaleY(' + k + ')'; });
                return;
            } else if (item.type === 'mode' || item.type === 'line') {
                transform = 'translateY(' + ((1 - easeOut(inP)) * 18).toFixed(2) + 'px)';
            }
            el.style.transform = (centered ? 'translateY(-50%) ' : '') + transform;
        });
    },
};
window.__overlay.render(0);
</script></body></html>`;
}
