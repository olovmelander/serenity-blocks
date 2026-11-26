// Writes the Linux icon set (public/assets/branding/linux/<size>x<size>.png) from the committed
// Windows icon, byte for byte: scripts/app-icon/linux-icons.mjs says which sizes and why.
// Run after scripts/generate-app-icon.mjs has redrawn the .ico:
//   node scripts/generate-linux-icons.mjs
// tests/unit/linux-app-icon.test.js fails while the two disagree.
import {
    mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINUX_ICON_DIR, linuxIconsFromIco } from './app-icon/linux-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, LINUX_ICON_DIR);
const icons = linuxIconsFromIco(readFileSync(path.join(root, 'public', 'assets', 'branding', 'serenity-blocks.ico')));

mkdirSync(outDir, { recursive: true });
// A size dropped from the set must not linger: electron-builder ships every sized PNG it finds
// here. Only this script's own files are removed.
const keep = new Set(icons.map((icon) => icon.name));
for (const name of readdirSync(outDir)) {
    if (/^\d+x\d+\.png$/.test(name) && !keep.has(name)) rmSync(path.join(outDir, name));
}
for (const icon of icons) writeFileSync(path.join(outDir, icon.name), icon.png);
console.log(`[app-icon] ${LINUX_ICON_DIR}: ${icons.map((icon) => icon.name).join(', ')}`);
