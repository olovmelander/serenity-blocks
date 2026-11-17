/**
 * How the portal passage into (and back out of) an orb looks: made of the chapter you are in,
 * in the colours of the world you are going to, a little different every time.
 *
 * The colours used to come from one UI accent per theme (theme-presentation.js), pushed to a
 * deep saturated value: a golden prairie storm whose accent is a storm-cloud grey got a blue
 * passage (audit 2026-11-17). They now come from the picture the orb itself wears
 * (theme-passage-palettes.js, baked from the theme icons): its key light, its two strongest
 * hues and its shadow. The UI accent is only the fallback for a theme without a picture.
 */
import { getOdysseyChapterLook, odysseyLookHex } from '../../core/odyssey/data/chapter-looks.js';
import { ODYSSEY_THEME_PASSAGE_PALETTES } from '../../core/odyssey/theme-passage-palettes.js';
import { getOdysseyThemePresentationPalette } from '../../core/odyssey/theme-presentation.js';

/** How many times each orb has been entered this session: the passage's second seed. */
const visits = new Map();

/** A different run of passages every session (the page's start, in seconds). */
function sessionSalt() {
    const origin = Number(globalThis.performance?.timeOrigin);
    return Number.isFinite(origin) ? Math.floor(origin / 1000) % 65521 : 0;
}

/** One 32-bit seed from an orb, a visit and a salt. */
export function passageSeed(levelId, visit, salt = 0) {
    let h = Math.imul((Number(levelId) || 0) + 1, 2654435761) ^ Math.imul((visit || 0) + 1, 2246822519) ^ Math.imul(salt + 1, 3266489917);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return (h ^ (h >>> 16)) >>> 0;
}

/** The theme whose picture gives an orb's passage its colours. */
function passageThemeId(levelConfig) {
    return levelConfig?.transitionPaletteThemeId
        || levelConfig?.theme?.transitionPalette
        || levelConfig?.theme?.primary
        || null;
}

/**
 * The passage's colours for a theme: { primary, accent, highlight, shadow, key }. `primary` and
 * `accent` are the picture's two strongest hues (the passage's walls), `highlight` its key
 * light (the streaks, the rim, the light ahead), `shadow` its dark, `key` its brightness.
 * @param {string|null} themeId
 * @returns {{primary: string, accent: string, highlight: string, shadow: string, key: number}|null}
 */
export function getOdysseyPassagePalette(themeId) {
    const row = ODYSSEY_THEME_PASSAGE_PALETTES[themeId];
    if (row) {
        const [light, body, second, deep, key] = row;
        return {
            primary: body, accent: second, highlight: light, shadow: deep, key,
        };
    }
    const fallback = getOdysseyThemePresentationPalette(themeId);
    return fallback ? { ...fallback, key: 0.4 } : null;
}

/**
 * Everything a journey transition needs to draw one passage.
 * @param {object|null} levelConfig the orb (LevelRegistry.resolveLevelPresentation)
 * @param {object} [options]
 * @param {boolean} [options.returning] coming back out: the same visit as the way in
 * @param {number} [options.salt] the session's salt (tests)
 * @returns {{primary: string, accent: string, highlight: string, shadow: string,
 *   look: {kind: string, seed: number, key: number, world: string, chapter: number}}}
 */
export function resolveOdysseyPassage(levelConfig, { returning = false, salt = sessionSalt() } = {}) {
    const chapter = getOdysseyChapterLook(levelConfig?.chapter);
    const palette = getOdysseyPassagePalette(passageThemeId(levelConfig)) || {
        // No theme at all: the chapter's own light.
        primary: odysseyLookHex(chapter.accent),
        accent: odysseyLookHex(chapter.light),
        highlight: '#ffffff',
        shadow: odysseyLookHex(chapter.glassDeep),
        key: 0.4,
    };
    const levelId = Number(levelConfig?.id) || 0;
    const visit = (visits.get(levelId) || 0) + (returning ? 0 : 1);
    if (!returning) visits.set(levelId, visit);
    const { key, ...colors } = palette;
    return {
        ...colors,
        look: {
            kind: chapter.passage,
            // The way back out is the same visit seen from the other side: its own layout.
            seed: passageSeed(levelId, visit * 2 + (returning ? 1 : 0), salt),
            key,
            world: odysseyLookHex(chapter.light),
            chapter: chapter.id,
        },
    };
}

/**
 * What to bake before the first portal: the wall and the matter of the chapter the player is
 * in (portal-gate.js warmPortalGate, portal-gate-remote.js warmPortalGateWorker).
 * @param {number|string|null|undefined} chapterId
 * @returns {{kind: string}}
 */
export function odysseyPassageWarmLook(chapterId) {
    return { kind: getOdysseyChapterLook(chapterId).passage };
}

/** Test seam: forget this session's visits. */
export function resetOdysseyPassageVisitsForTests() {
    visits.clear();
}
