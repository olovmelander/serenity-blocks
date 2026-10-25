/**
 * The Serenity Blocks app mark: the logo's O with its separated coral corner, on a night tile.
 * One mark for the browser tab (public/favicon.svg), the Windows .exe, installer and taskbar
 * (public/assets/branding/serenity-blocks.ico) and store art
 * (public/assets/branding/serenity-blocks-app-icon.svg). docs/desktop-icons.md has the rules.
 *
 * From 40 px up the O is the logo's own outline. At 32 px and below a scaled outline smears its
 * gaps into the stroke, so those sizes are drawn on the pixel grid instead: whole-pixel stroke,
 * whole-pixel gaps round the tile, the tile a little larger than the logo's so it survives.
 * Regenerate the files with `node scripts/generate-app-icon.mjs`.
 */

export const APP_MARK_COLORS = Object.freeze({
    lavender: '#b8a4ff',
    aqua: '#9ee8ed',
    mint: '#c5f1cf',
    coral: '#ffac88',
    cream: '#fff6e9',
    plateTop: '#231e52',
    plateBottom: '#0c0a22',
});

/** The logo's O (scripts/generate-mode-wordmarks.mjs) and its tile, in the logo's 100-unit cap height. */
const LOGO_O = 'M30 0H50V22H31Q22 22 22 32V68Q22 78 31 78H51Q60 78 60 68V32H82V70Q82 100 52 100H30Q0 100 0 70V30Q0 0 30 0Z';
const LOGO = Object.freeze({
    width: 82, height: 100, tile: 26, lift: 4, tileRadius: 3,
});

/**
 * The pixel-grid cuts. The O is `w` x `h` at (`x`, `y`) with a `t` stroke and `R` / `r` corners;
 * the top bar stops at `bar` and the right stem starts at `stem`, leaving a gap each side of the
 * `k` tile, which sits `lift` above the O. `plate` is the tile's corner radius.
 */
export const APP_MARK_CUTS = Object.freeze({
    16: Object.freeze({
        w: 11, h: 11, t: 3, R: 3.5, r: 1, bar: 5, stem: 5, k: 5, lift: 1, x: 2, y: 3, plate: 3.5,
    }),
    20: Object.freeze({
        w: 13, h: 13, t: 3, R: 4, r: 1, bar: 7, stem: 5, k: 5, lift: 1, x: 4, y: 4, plate: 4.5,
    }),
    24: Object.freeze({
        w: 16, h: 17, t: 4, R: 5, r: 1.5, bar: 9, stem: 6, k: 6, lift: 1, x: 4, y: 4, plate: 5.5,
    }),
    32: Object.freeze({
        w: 20, h: 23, t: 6, R: 7, r: 2, bar: 10, stem: 8, k: 8, lift: 2, x: 6, y: 6, plate: 7,
    }),
});

/** Every size the Windows icon carries: the cuts, then the logo outline. */
export const APP_ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);

/** The O open at the top right, as one outline (the logo's path, parametrised for the cuts). */
function cutOutline({
    w, h, t, R, r, bar, stem,
}) {
    return `M${R} 0H${bar}V${t}H${t + r}Q${t} ${t} ${t} ${t + r}V${h - t - r}Q${t} ${h - t} ${t + r} ${h - t}`
        + `H${w - t - r}Q${w - t} ${h - t} ${w - t} ${h - t - r}V${stem}H${w}V${h - R}Q${w} ${h} ${w - R} ${h}`
        + `H${R}Q0 ${h} 0 ${h - R}V${R}Q0 0 ${R} 0Z`;
}

const fmt = (n) => String(Math.round(n * 1000) / 1000);

/**
 * The mark as a standalone SVG document.
 * @param {number} size the pixel size it is drawn for (16, 20, 24 and 32 use the grid cuts)
 * @returns {string}
 */
export function appMarkSvg(size) {
    const c = APP_MARK_COLORS;
    const cut = APP_MARK_CUTS[size];
    let plateRadius;
    let mark;
    if (cut) {
        plateRadius = cut.plate;
        mark = `<g transform="translate(${cut.x} ${cut.y})">`
            + `<path fill="url(#sb-mark-spectrum)" d="${cutOutline(cut)}"/>`
            + `<rect x="${cut.w - cut.k}" y="${-cut.lift}" width="${cut.k}" height="${cut.k}" rx="${fmt(cut.k * 0.18)}" fill="${c.coral}"/></g>`;
    } else {
        // The logo outline, 64 % of the tile tall, centred.
        const scale = (size * 0.64) / (LOGO.height + LOGO.lift);
        const x = (size - LOGO.width * scale) / 2;
        const y = (size - (LOGO.height + LOGO.lift) * scale) / 2 + LOGO.lift * scale;
        plateRadius = size * 0.225;
        mark = `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})">`
            + `<path fill="url(#sb-mark-spectrum)" d="${LOGO_O}"/>`
            + `<rect x="${LOGO.width - LOGO.tile}" y="${-LOGO.lift}" width="${LOGO.tile}" height="${LOGO.tile}" rx="${LOGO.tileRadius}" fill="${c.coral}"/></g>`;
    }
    // Light rises from below in the logo's spectrum, as on the loading screen; too faint to keep under 48 px.
    const glow = size >= 48;
    const r = fmt(plateRadius);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
        + '<title>Serenity Blocks</title><defs>'
        + `<linearGradient id="sb-mark-plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.plateTop}"/><stop offset="1" stop-color="${c.plateBottom}"/></linearGradient>`
        + `<linearGradient id="sb-mark-spectrum" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.lavender}"/><stop offset=".5" stop-color="${c.aqua}"/><stop offset="1" stop-color="${c.mint}"/></linearGradient>${
            glow ? `<radialGradient id="sb-mark-rise" cx=".5" cy="1.08" r=".62"><stop offset="0" stop-color="${c.aqua}" stop-opacity=".3"/><stop offset="1" stop-color="${c.aqua}" stop-opacity="0"/></radialGradient>` : ''
        }</defs>`
        + `<rect width="${size}" height="${size}" rx="${r}" fill="url(#sb-mark-plate)"/>${
            glow ? `<rect width="${size}" height="${size}" rx="${r}" fill="url(#sb-mark-rise)"/>` : ''
        // A hairline rim so the night tile keeps its edge on a dark taskbar.
        }<rect x=".5" y=".5" width="${size - 1}" height="${size - 1}" rx="${fmt(plateRadius - 0.5)}" fill="none" stroke="${c.cream}" stroke-opacity=".13"/>`
        + `${mark}</svg>\n`;
}
