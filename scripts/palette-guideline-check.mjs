#!/usr/bin/env node
/**
 * Palette gate: every piece palette is the game's own.
 *
 * Screens every theme's piece palette (plus the default COLORS in src/core/constants.js) against
 * the colour each shape usually wears in falling-block games (I cyan, O yellow, T purple, S green,
 * Z red, J blue, L orange). It reads the first configured hue per shape, in two passes:
 *   - exact:   the hue bands below, as they are
 *   - widened: the same bands opened by WIDEN_DEGREES on each side, so a palette cannot pass by
 *              sitting a few degrees outside a band
 *
 * Policy:
 *   - FAIL  if either pass finds more than MAX_USUAL of a palette's 7 shapes in their usual bands
 *           (every palette in the game is at 3/7 or below in both)
 *   - WARN  if a *-tetrominos.js config is not referenced by its theme
 *           (dead config: the board silently falls back to the default palette)
 *
 * It is a screen of hues, nothing more: it does not judge how a palette looks.
 *
 * Usage: node scripts/palette-guideline-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** The most shapes a palette may leave in their usual hue bands, in either pass. */
export const MAX_USUAL = 3;
/** How far the second pass opens every band, on each side (hue degrees). */
export const WIDEN_DEGREES = 12;

/** The hue each shape usually wears (degrees). */
export const USUAL_BANDS = {
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

/** Hue of a #rrggbb colour in degrees [0, 360), or null for a grey. */
export function hexToHue(hex) {
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

/**
 * Whether a hue sits in one of the bands, each opened by `widen` degrees on both sides. The hue
 * circle wraps: a band opened past 0 or 360 carries on at the other end.
 */
export function inBands(hue, bands, widen = 0) {
    if (hue === null) return false;
    return bands.some(([lo, hi]) => [hue - 360, hue, hue + 360]
        .some((h) => h >= lo - widen && h <= hi + widen));
}

/** Extract the first configured color per shape from a *-tetrominos.js source. */
export function extractPalette(source) {
    const palette = {};
    for (const shape of SHAPES) {
        // Modern format:  I: '#7deeff'   (inside a colors: {...} block)
        // Legacy format:  I: { color: '#F5C542' }
        const re = new RegExp(
            `\\b${shape}\\s*:\\s*(?:\\{[^}]*?color\\s*:\\s*)?['"](#[0-9a-fA-F]{6})['"]`,
        );
        const m = source.match(re);
        if (m) palette[shape] = m[1];
    }
    return palette;
}

/** The shapes of a palette that sit in their usual bands, opened by `widen` degrees. */
export function usualShapes(palette, widen = 0) {
    return SHAPES.filter((shape) => palette[shape]
        && inBands(hexToHue(palette[shape]), USUAL_BANDS[shape], widen));
}

/** Both passes over one palette. */
export function screenPalette(name, palette) {
    const exact = usualShapes(palette, 0);
    const widened = usualShapes(palette, WIDEN_DEGREES);
    return {
        name,
        exact,
        widened,
        complete: Object.keys(palette).length === SHAPES.length,
        failed: exact.length > MAX_USUAL || widened.length > MAX_USUAL,
    };
}

/**
 * Screen the default palette and every theme's, and check each theme's config is wired.
 * @param {string} [root] the repository root
 * @returns {{ results: ReturnType<typeof screenPalette>[], warnings: string[] }}
 */
export function screenRepository(root = repoRoot) {
    const themesDir = path.join(root, 'src', 'themes');
    const warnings = [];
    const results = [];

    // 1. Default palette in constants.js
    const constantsSrc = fs.readFileSync(path.join(root, 'src', 'core', 'constants.js'), 'utf8');
    const colorsBlock = constantsSrc.match(/export const COLORS = \{[\s\S]*?\};/);
    if (!colorsBlock) throw new Error('could not locate COLORS in src/core/constants.js');
    results.push(screenPalette('default (src/core/constants.js)', extractPalette(colorsBlock[0])));

    // 2. Every theme tetromino config, plus a wiring check for dead configs.
    for (const dir of fs.readdirSync(themesDir, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const themeDir = path.join(themesDir, dir.name);
        const files = fs.readdirSync(themeDir);
        const configFile = files.find((f) => f.endsWith('-tetrominos.js'));
        if (!configFile) continue;

        const source = fs.readFileSync(path.join(themeDir, configFile), 'utf8');
        const palette = extractPalette(source);
        results.push(screenPalette(`${dir.name}/${configFile}`, palette));

        // Runtime resolvers read only config.colors[shape]; legacy top-level
        // `I: { color: ... }` configs are silently ignored (default palette wins).
        if (Object.keys(palette).length > 0 && !/\bcolors\s*:/.test(source)) {
            warnings.push(
                `${dir.name}: ${configFile} uses the legacy top-level format — not read by the `
                    + 'runtime resolvers (board falls back to the default palette)',
            );
        }

        const exportName = source.match(/export const (\w+)/)?.[1];
        if (exportName) {
            const wired = files.some((f) => {
                if (f === configFile) return false;
                if (!/\.(js|ts)$/.test(f)) return false;
                return fs.readFileSync(path.join(themeDir, f), 'utf8').includes(exportName);
            });
            if (!wired) {
                warnings.push(
                    `${dir.name}: ${configFile} exports ${exportName} but no theme file references it `
                        + '(dead config — board falls back to the default palette)',
                );
            }
        }
    }
    return { results, warnings };
}

function main() {
    let screened;
    try {
        screened = screenRepository();
    } catch (error) {
        console.error(`palette-gate: ${error.message}`);
        process.exit(1);
    }
    const { results, warnings } = screened;
    const wide = `widened by ${WIDEN_DEGREES}°`;

    for (const result of results) {
        const { name, exact, widened, complete } = result;
        const counts = `exact ${exact.length}/7  widened ${widened.length}/7`;
        const label = `${counts}${complete ? '' : ' (incomplete config)'}`;
        if (!result.failed) {
            console.log(`ok    ${label}  ${name}`);
            continue;
        }
        const reasons = [];
        if (exact.length > MAX_USUAL) {
            reasons.push(`${exact.length} shapes in their usual hue bands [${exact.join(',')}]`);
        }
        if (widened.length > MAX_USUAL) {
            reasons.push(`${widened.length} shapes in their usual hue bands ${wide} [${widened.join(',')}]`);
        }
        console.error(`FAIL  ${label}  ${name} — ${reasons.join('; ')}`);
    }

    for (const w of warnings) console.warn(`WARN  ${w}`);
    const overExact = results.filter((r) => r.exact.length > MAX_USUAL).length;
    const overWidened = results.filter((r) => r.widened.length > MAX_USUAL).length;
    const failed = results.some((r) => r.failed);
    if (failed) {
        console.error(
            `palette-gate: FAILED — a palette puts more than ${MAX_USUAL} shapes in their usual hue `
                + `bands (exact, or ${wide}). Give those shapes other colours (moving the palette's `
                + 'own colours between shapes keeps the theme\'s look).',
        );
    }
    // The summary is the last line on stdout: the release gate prints it.
    console.log(
        `palette-gate: ${results.length} palettes screened; over ${MAX_USUAL}/7: ${overExact} on the exact bands, `
            + `${overWidened} on the bands ${wide}; ${warnings.length} warnings`,
    );
    if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
