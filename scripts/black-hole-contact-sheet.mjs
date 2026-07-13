#!/usr/bin/env node
// Build a single self-contained contact-sheet.html from the four deterministic Black Hole
// captures in artifacts/themes/black-hole/ (plan §0.10). Images are embedded as base64 so
// the sheet is one portable file. artifacts/ is git-ignored, so run this after
// regenerating the captures:  node scripts/black-hole-contact-sheet.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('artifacts/themes/black-hole');
const tiles = [
    { file: 'webgpu.png', label: 'Idle', note: 'WebGPU idle composition — deterministic phase (t=8s)' },
    { file: 'webgpu-lock.png', label: 'Piece lock', note: 'Lock: compression → lens ripple → matter-stream beat' },
    { file: 'webgpu-combo.png', label: 'Combo (tier 8)', note: 'Gravitational-caustic moment + analytic debris waves' },
    { file: 'webgl2.png', label: 'WebGL2 parity', note: 'Forced-WebGL2 backend at the same idle phase' },
];

const missing = tiles.filter((t) => !existsSync(resolve(dir, t.file)));
if (missing.length) {
    console.error(`[contact-sheet] missing captures: ${missing.map((t) => t.file).join(', ')}`);
    console.error('Regenerate the captures first, then re-run this script.');
    process.exit(1);
}

const cards = tiles.map((t) => {
    const b64 = readFileSync(resolve(dir, t.file)).toString('base64');
    return `      <figure>
        <img alt="${t.label}" src="data:image/png;base64,${b64}" />
        <figcaption><strong>${t.label}</strong><span>${t.note}</span><code>${t.file}</code></figcaption>
      </figure>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Black Hole — capture contact sheet</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #05060a; color: #e7e9f2; font: 14px/1.5 system-ui, sans-serif; }
  header { padding: 24px 28px 8px; }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: .3px; }
  header p { margin: 0; color: #9aa0b8; max-width: 70ch; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding: 18px 28px 32px; }
  figure { margin: 0; background: #0c0e16; border: 1px solid #1c2030; border-radius: 12px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  figcaption { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px 14px; }
  figcaption strong { font-size: 15px; }
  figcaption span { color: #9aa0b8; }
  figcaption code { color: #6f77a0; font-size: 12px; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <header>
    <h1>Black Hole — capture contact sheet</h1>
    <p>Production-theme captures at 1600&times;900, High preset, recorded through Chrome DevTools MCP with
       <code>noBootWarp=1</code>, <code>blackHoleSeed=20260713</code>, fixed visual time 8&nbsp;s. Idle, lock, and
       combo are immediately distinguishable; the WebGL2 tile confirms backend parity.</p>
  </header>
  <section class="grid">
${cards}
  </section>
</body>
</html>
`;

const out = resolve(dir, 'contact-sheet.html');
writeFileSync(out, html);
console.log(`[contact-sheet] wrote ${out} (${(html.length / 1024).toFixed(0)} kB)`);
