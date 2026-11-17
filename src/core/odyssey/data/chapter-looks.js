/**
 * @fileoverview Each chapter's look for everything between the scenery and the play: the light
 * the UI wears there, the glass its panels are made of, the matter the portal passage is made
 * of and the light the world blooms with when you surface into it.
 *
 * ONE TABLE. The map's header and orb card, the briefing, the chapter sheet, the outcome sheets
 * and the navigator read it through CSS ([data-ody-chapter] in public/styles/odyssey-shared.css,
 * a block generated from this table: `node scripts/sync-odyssey-chapter-looks.mjs`, kept in
 * step by tests/unit/odyssey-chapter-looks.test.js); the journey overlay and the portal gate
 * read it here. Nothing else may hold a chapter colour of its own.
 *
 * Pure data: no DOM, no clock (src/core stays headless).
 */

/**
 * @typedef {object} OdysseyChapterLook
 * @property {number} id chapter 1..8
 * @property {[number, number, number]} accent the chapter's light: eyebrows, rules, meters, focus
 * @property {[number, number, number]} glass a panel's glass at its lit top edge (sRGB)
 * @property {[number, number, number]} glassDeep the same glass at its foot
 * @property {[number, number, number]} light the world's own light there: what blooms through
 *   the gate when you come back out of an orb
 * @property {'embers'|'bubbles'|'petals'|'snow'|'cloud'|'stars'|'facets'|'neon'} passage what
 *   the portal's rim and the matter rushing past are made of (portal-gate-matter.js)
 */

/** @type {ReadonlyArray<Readonly<OdysseyChapterLook>>} */
export const ODYSSEY_CHAPTER_LOOKS = Object.freeze([
    // 1 Earth core: ember light on smoked basalt glass.
    {
        id: 1, accent: [255, 158, 98], glass: [58, 28, 22], glassDeep: [22, 10, 10], light: [255, 170, 96], passage: 'embers',
    },
    // 2 Deep ocean: surface light on deep-sea glass.
    {
        id: 2, accent: [98, 204, 255], glass: [12, 42, 64], glassDeep: [4, 17, 32], light: [128, 222, 255], passage: 'bubbles',
    },
    // 3 Island: leaf light on bottle-green glass.
    {
        id: 3, accent: [172, 228, 134], glass: [20, 46, 40], glassDeep: [8, 21, 24], light: [255, 236, 170], passage: 'petals',
    },
    // 4 Mountains: snow light on slate glass.
    {
        id: 4, accent: [196, 226, 255], glass: [32, 44, 70], glassDeep: [12, 17, 33], light: [226, 240, 255], passage: 'snow',
    },
    // 5 Sky: dawn rose on dusk-plum glass.
    {
        id: 5, accent: [255, 186, 214], glass: [54, 34, 68], glassDeep: [19, 13, 35], light: [255, 214, 150], passage: 'cloud',
    },
    // 6 Space: starlight on near-black indigo glass.
    {
        id: 6, accent: [160, 178, 255], glass: [19, 21, 50], glassDeep: [5, 6, 19], light: [190, 204, 255], passage: 'stars',
    },
    // 7 The fold: violet on deep-violet glass.
    {
        id: 7, accent: [206, 156, 255], glass: [39, 21, 60], glassDeep: [13, 7, 27], light: [232, 196, 255], passage: 'facets',
    },
    // 8 Neon city: magenta on aubergine glass.
    {
        id: 8, accent: [255, 110, 204], glass: [44, 14, 44], glassDeep: [16, 6, 22], light: [255, 132, 214], passage: 'neon',
    },
].map((look) => Object.freeze(look)));

/**
 * How solid the glass is (alpha) at its top and at its foot. Not a taste setting: the lowest
 * values at which every ink below still reads over a WHITE world (cloud tops, snow, the island's
 * sky), asserted for every chapter by the unit test. Lower them and that test fails.
 */
export const ODYSSEY_GLASS_ALPHA = Object.freeze({ top: 0.88, foot: 0.95 });

/** The inks a glass panel sets its text in (cream at these opacities) and the contrast each must keep. */
export const ODYSSEY_GLASS_INKS = Object.freeze({
    text: Object.freeze({ alpha: 1, minContrast: 7 }),
    muted: Object.freeze({ alpha: 0.74, minContrast: 4.5 }),
    faint: Object.freeze({ alpha: 0.56, minContrast: 4 }),
});

/** Keystone's cream (keystone.css --sb-cream-rgb): the ink of every Odyssey panel. */
export const ODYSSEY_INK_RGB = Object.freeze([255, 246, 233]);

/**
 * @param {number|string|null|undefined} chapterId
 * @returns {Readonly<OdysseyChapterLook>} that chapter's look (chapter 1's for anything else)
 */
export function getOdysseyChapterLook(chapterId) {
    const id = Number(chapterId);
    return ODYSSEY_CHAPTER_LOOKS[Number.isInteger(id) && id >= 1 && id <= ODYSSEY_CHAPTER_LOOKS.length ? id - 1 : 0];
}

const hex2 = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

/** '#rrggbb' of an [r, g, b] triple. */
export function odysseyLookHex(rgb) {
    return `#${rgb.map(hex2).join('')}`;
}

/** WCAG relative luminance of an sRGB triple (0..255 a channel). */
export function relativeLuminance([r, g, b]) {
    const linear = (value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two opaque sRGB triples. */
export function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `over` at `alpha` laid on `under` (both opaque sRGB triples), as a browser composites it. */
export function composite(over, under, alpha) {
    return over.map((value, channel) => value * alpha + under[channel] * (1 - alpha));
}

/**
 * The lowest contrast a chapter's glass gives an ink, over the brightest and the darkest world
 * there can be behind it (white and black), at the glass's most see-through point (its top).
 * @param {Readonly<OdysseyChapterLook>} look
 * @param {number} inkAlpha
 * @param {number} [glassAlpha]
 */
export function worstGlassContrast(look, inkAlpha, glassAlpha = ODYSSEY_GLASS_ALPHA.top) {
    return Math.min(...[[255, 255, 255], [0, 0, 0]].map((world) => {
        const panel = composite(look.glass, world, glassAlpha);
        return contrastRatio(composite(ODYSSEY_INK_RGB, panel, inkAlpha), panel);
    }));
}

/**
 * The stylesheet block that hands the table to CSS: one rule a chapter, for any element that
 * wears `data-ody-chapter` and for the navigator's own `data-chapter`.
 * @returns {string}
 */
export function renderOdysseyChapterLookCss() {
    const rules = ODYSSEY_CHAPTER_LOOKS.map((look) => {
        const selector = `[data-ody-chapter='${look.id}'],\n#odyssey-level-select[data-chapter='${look.id}'],\n`
            + `#odyssey-level-select [data-chapter='${look.id}']`;
        return `${selector} {\n`
            + `    --ody-hue-rgb: ${look.accent.join(', ')};\n`
            + `    --ody-glass-rgb: ${look.glass.join(', ')};\n`
            + `    --ody-glass-deep-rgb: ${look.glassDeep.join(', ')};\n`
            + `    --ody-light-rgb: ${look.light.join(', ')};\n`
            + '}';
    });
    return [
        '/* @odyssey-chapter-looks:start (generated from src/core/odyssey/data/chapter-looks.js:',
        '   run `node scripts/sync-odyssey-chapter-looks.mjs`; do not edit by hand) */',
        ':root {',
        `    --ody-glass-top-a: ${ODYSSEY_GLASS_ALPHA.top};`,
        `    --ody-glass-foot-a: ${ODYSSEY_GLASS_ALPHA.foot};`,
        `    --ody-ink-muted: rgba(${ODYSSEY_INK_RGB.join(', ')}, ${ODYSSEY_GLASS_INKS.muted.alpha});`,
        `    --ody-ink-faint: rgba(${ODYSSEY_INK_RGB.join(', ')}, ${ODYSSEY_GLASS_INKS.faint.alpha});`,
        '}',
        ...rules,
        '/* @odyssey-chapter-looks:end */',
    ].join('\n');
}
