#!/usr/bin/env node
/**
 * Bake the portal passage's colours from the theme icons (the pictures the orbs wear):
 *   node scripts/bake-odyssey-passage-palettes.mjs          writes the table
 *   node scripts/bake-odyssey-passage-palettes.mjs --check  fails when the table is stale
 * Run it after a theme icon is re-baked or a theme is added
 * (tests/unit/odyssey-passage-palettes.test.js fails until you do).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, extractPassagePalette } from './odyssey-passage-palette-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = path.join(root, 'src', 'themes');
export const PASSAGE_PALETTE_FILE = path.join(root, 'src', 'core', 'odyssey', 'theme-passage-palettes.js');

/** Every theme with an icon, in name order. */
export function listThemeIcons() {
    return readdirSync(themesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ id: entry.name, file: path.join(themesDir, entry.name, `${entry.name}-theme-icon.png`) }))
        .filter((entry) => {
            try {
                readFileSync(entry.file, { flag: 'r' });
                return true;
            } catch {
                return false;
            }
        })
        .sort((a, b) => a.id.localeCompare(b.id));
}

export function bakePassagePalettes() {
    const table = {};
    for (const { id, file } of listThemeIcons()) {
        table[id] = extractPassagePalette(decodePng(readFileSync(file)));
    }
    return table;
}

export function renderPassagePaletteModule(table) {
    const rows = Object.entries(table).map(([id, p]) => {
        const name = /^[a-z]+$/.test(id) ? id : `'${id}'`;
        return `    ${name}: ['${p.light}', '${p.body}', '${p.second}', '${p.deep}', ${p.key}],`;
    });
    return `/**
 * The colours of each orb's world, read from the picture the orb wears (its theme icon):
 * [light, body, second, deep, key]: the scene's key light, its two strongest hues, its shadow
 * and its mean luminance. The portal passage is painted with them (odyssey-passage-look.js).
 *
 * BAKED: do not edit by hand. \`node scripts/bake-odyssey-passage-palettes.mjs\` writes this file
 * from src/themes/<id>/<id>-theme-icon.png; tests/unit/odyssey-passage-palettes.test.js fails
 * when an icon and its row disagree.
 */
export const ODYSSEY_THEME_PASSAGE_PALETTES = Object.freeze({
${rows.join('\n')}
});
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const source = renderPassagePaletteModule(bakePassagePalettes());
    if (process.argv.includes('--check')) {
        let current = '';
        try {
            current = readFileSync(PASSAGE_PALETTE_FILE, 'utf8').replace(/\r\n/g, '\n');
        } catch { /* missing: stale */ }
        if (current !== source) {
            console.error('theme-passage-palettes.js is stale: run node scripts/bake-odyssey-passage-palettes.mjs');
            process.exit(1);
        }
        console.log('theme-passage-palettes.js is up to date');
    } else {
        writeFileSync(PASSAGE_PALETTE_FILE, source);
        console.log(`wrote ${path.relative(root, PASSAGE_PALETTE_FILE)} (${Object.keys(bakePassagePalettes()).length} themes)`);
    }
}
