#!/usr/bin/env node
/**
 * Palette separation gate (tetris_legal_review.md v4.0, PAL-1 / remediation P0.4).
 *
 * Static screen of every theme tetromino palette (plus the default COLORS in
 * src/core/constants.js) against the familiar Guideline shape->hue roles
 * (I cyan, O yellow, T purple, S green, Z red, J blue, L orange).
 *
 * This is a conservative engineering screen, NOT a legal test: it looks only at
 * the first configured hue per shape. Policy (from the review):
 *   - FAIL  if any palette maps all 7 shapes into their familiar hue bands
 *   - WARN  at 6/7 (requires documented human review)
 *   - WARN  if a *-tetrominos.js config is not referenced by its theme
 *           (dead config: the board silently falls back to the default palette)
 *
 * Usage: node scripts/palette-guideline-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = path.join(repoRoot, 'src', 'themes');
const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Screening bands (hue degrees) per tetris_legal_review.md §Copyright / v3.0 §8.1.
const GUIDELINE_BANDS = {
    I: [[160, 210]], // cyan / blue-cyan
    O: [[32, 75]], // yellow / gold
    T: [[245, 315]], // purple / magenta
    S: [[90, 170]], // green / mint
    Z: [
        [320, 360],
        [0, 20],
    ], // red / pink
    J: [[200, 250]], // blue / indigo
    L: [[20, 50]], // orange / amber
};

function hexToHue(hex) {
    const n = hex.replace('#', '');
    const r = parseInt(n.slice(0, 2), 16) / 255;
    const g = parseInt(n.slice(2, 4), 16) / 255;
    const b = parseInt(n.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null; // achromatic — never counts as a band match
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return (h + 360) % 360;
}

function inBands(hue, bands) {
    if (hue === null) return false;
    return bands.some(([lo, hi]) => hue >= lo && hue <= hi);
}

/** Extract the first configured color per shape from a *-tetrominos.js source. */
function extractPalette(source) {
    const palette = {};
    for (const shape of SHAPES) {
        // Modern format:  I: '#7deeff'   (inside a colors: {...} block)
        // Legacy format:  I: { color: '#F5C542' }
        const re = new RegExp(
            `\\b${shape}\\s*:\\s*(?:\\{[^}]*?color\\s*:\\s*)?['"](#[0-9a-fA-F]{6})['"]`
        );
        const m = source.match(re);
        if (m) palette[shape] = m[1];
    }
    return palette;
}

function screenPalette(name, palette) {
    const matched = [];
    for (const shape of SHAPES) {
        const hex = palette[shape];
        if (!hex) continue;
        if (inBands(hexToHue(hex), GUIDELINE_BANDS[shape])) matched.push(shape);
    }
    return { name, matched, complete: Object.keys(palette).length === SHAPES.length };
}

let failed = false;
const warnings = [];
const results = [];

// 1. Default palette in constants.js
const constantsSrc = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'constants.js'), 'utf8');
const colorsBlock = constantsSrc.match(/export const COLORS = \{[\s\S]*?\};/);
if (!colorsBlock) {
    console.error('palette-gate: could not locate COLORS in src/core/constants.js');
    process.exit(1);
}
results.push(screenPalette('default (src/core/constants.js)', extractPalette(colorsBlock[0])));

// 2. Every theme tetromino config, plus a wiring check for dead configs.
for (const dir of fs.readdirSync(themesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const themeDir = path.join(themesDir, dir.name);
    const files = fs.readdirSync(themeDir);
    const configFile = files.find(f => f.endsWith('-tetrominos.js'));
    if (!configFile) continue;

    const source = fs.readFileSync(path.join(themeDir, configFile), 'utf8');
    const palette = extractPalette(source);
    results.push(screenPalette(`${dir.name}/${configFile}`, palette));

    // Runtime resolvers read only config.colors[shape]; legacy top-level
    // `I: { color: ... }` configs are silently ignored (default palette wins).
    if (Object.keys(palette).length > 0 && !/\bcolors\s*:/.test(source)) {
        warnings.push(
            `${dir.name}: ${configFile} uses the legacy top-level format — not read by the ` +
                'runtime resolvers (board falls back to the default palette)'
        );
    }

    const exportName = source.match(/export const (\w+)/)?.[1];
    if (exportName) {
        const wired = files.some(f => {
            if (f === configFile) return false;
            if (!/\.(js|ts)$/.test(f)) return false;
            return fs.readFileSync(path.join(themeDir, f), 'utf8').includes(exportName);
        });
        if (!wired) {
            warnings.push(
                `${dir.name}: ${configFile} exports ${exportName} but no theme file references it ` +
                    '(dead config — board falls back to the default palette)'
            );
        }
    }
}

for (const { name, matched, complete } of results) {
    const count = matched.length;
    const label = `${count}/7${complete ? '' : ' (incomplete config)'}`;
    if (count === 7) {
        failed = true;
        console.error(
            `FAIL  ${label}  ${name} — full Guideline hue-role mapping [${matched.join(',')}]`
        );
    } else if (count === 6) {
        warnings.push(
            `${name}: 6/7 Guideline hue roles [${matched.join(',')}] — needs documented human review`
        );
        console.warn(`WARN  ${label}  ${name} [${matched.join(',')}]`);
    } else {
        console.log(`ok    ${label}  ${name}`);
    }
}

for (const w of warnings) console.warn(`WARN  ${w}`);
console.log(
    `palette-gate: ${results.length} palettes screened, ` +
        `${results.filter(r => r.matched.length === 7).length} full matches, ${warnings.length} warnings`
);

if (failed) {
    console.error(
        'palette-gate: FAILED — a selectable palette reproduces the complete familiar ' +
            'shape->hue mapping. Derange at least two roles (see tetris_legal_review.md).'
    );
    process.exit(1);
}
