/**
 * @fileoverview Odyssey Chapter Profiles — the per-world source of truth
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 0 — spine scaffolding).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5.
 *
 * Each chapter declares one profile object: act, palette, atmosphere (grounded in
 * the values authored in core/odyssey/data/chapters.js so the look is preserved),
 * diegetic path style, level-node identity, camera profile, audio track, and the
 * outgoing transition id. The OdysseyDirector and every subsystem (atmosphere,
 * path, nodes, camera, post) read from here — one source of truth per world.
 *
 * This module is intentionally THREE-free: it holds plain data + pure numeric
 * helpers so it stays trivially unit-testable. Colors are hex integers; color
 * blending happens in the director with reusable scratch THREE.Color instances.
 */

/** Narrative acts (see plan §3.1). */
export const ODYSSEY_ACTS = Object.freeze({
    ORIGIN: 'origin', // I — Earth Core, Deep Ocean — close & enclosed
    LIVING: 'living', // II — Surface, Mountains — open & grounded
    BEYOND: 'beyond', // III — Sky, Space — vast & slow
    TRANSCENDENCE: 'transcendence', // IV — Black Hole, Urban — abstract → kinetic
});

/** Diegetic path material styles (see plan §4.4). */
export const ODYSSEY_PATH_STYLES = Object.freeze({
    LAVA_CRUST: 'lavaCrust',
    CAUSTIC_CURRENT: 'causticCurrent',
    LEY_LINE: 'leyLine',
    CAIRN_RIDGE: 'cairnRidge',
    JET_STREAM: 'jetStream',
    STELLAR_STREAM: 'stellarStream',
    HORIZON_FILAMENT: 'horizonFilament',
    NEON_DATA_LINE: 'neonDataLine',
});

/** Level-node shell identities (see plan §4.5). */
export const ODYSSEY_NODE_STYLES = Object.freeze({
    MAGMA_GEODE: 'magmaGeode',
    BUBBLE_PEARL: 'bubblePearl',
    SEED_LANTERN: 'seedLantern',
    CAIRN_LANTERN: 'cairnLantern',
    CLOUD_WISP: 'cloudWisp',
    STARLIT_ORB: 'starlitOrb',
    LENSED_SHARD: 'lensedShard',
    NEON_SIGN: 'neonSign',
});

export const DEFAULT_ODYSSEY_TRANSITION = Object.freeze({
    seamWidth: 0.018,
    beatDurationMs: 850,
    preloadDistance: 0.05,
    fxPreset: 'standard',
    crossfadeDurationMs: 3500,
    stinger: null,
});

/**
 * Per-act camera language (see plan §3.1 / §7). These are forward-looking targets
 * consumed from Phase 7; declared here so the director can already blend toward
 * them and the debug overlay can show them. `followDistance`/`fovBase` describe the
 * intended framing; `sway`/`bob` scale the existing cinematic breathing.
 */
export const ODYSSEY_CAMERA_PROFILES = Object.freeze({
    [ODYSSEY_ACTS.ORIGIN]: Object.freeze({
        followDistance: 24, fovBase: 58, sway: 0.7, bob: 0.7, drift: 0.85,
    }),
    [ODYSSEY_ACTS.LIVING]: Object.freeze({
        followDistance: 30, fovBase: 60, sway: 1.0, bob: 1.0, drift: 1.0,
    }),
    [ODYSSEY_ACTS.BEYOND]: Object.freeze({
        followDistance: 42, fovBase: 66, sway: 1.25, bob: 0.8, drift: 0.7,
    }),
    [ODYSSEY_ACTS.TRANSCENDENCE]: Object.freeze({
        followDistance: 36, fovBase: 64, sway: 1.1, bob: 0.9, drift: 1.15,
    }),
});

/**
 * The eight chapter profiles. `atmosphere` mirrors the current authored values in
 * core/odyssey/data/chapters.js so Phase 2 can adopt these without changing the look.
 * `path` / `node` / `transitionOut` are forward-looking declarations for P3–P6.
 */
export const ODYSSEY_CHAPTER_PROFILES = Object.freeze([
    {
        id: 1,
        name: 'Earth Core',
        act: ODYSSEY_ACTS.ORIGIN,
        palette: { primary: 0xff4400, accent: 0xffaa44, shadow: 0x1a0600 },
        atmosphere: {
            skyColor: 0x1f0c00,
            fogColor: 0x2d1500,
            fogDensity: 0.014,
            ambientLight: 0x331100,
            ambientIntensity: 0.4,
            skyFeatures: ['magmaVault', 'embers'],
            // Low warm key leaking from below the player.
            lightDir: [0.1, -0.6, 0.3],
            lightColor: 0xff6622,
            lightIntensity: 0.9,
            exposure: 1.0,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.LAVA_CRUST,
            baseColor: 0x2a0d05,
            emissiveColor: 0xff5a18,
            flowSpeed: 0.6,
            widthScale: 1.0,
        },
        node: { style: ODYSSEY_NODE_STYLES.MAGMA_GEODE },
        anchor: 'magmaVault',
        audioTrack: 'CinderDrift',
        transitionOut: '1-2',
        transition: {
            id: '1-2',
            stinger: 'steam-quench',
            crossfadeDurationMs: 3000,
        },
    },
    {
        id: 2,
        name: 'Deep Ocean',
        act: ODYSSEY_ACTS.ORIGIN,
        palette: { primary: 0x0088ff, accent: 0x6fe8ff, shadow: 0x001020 },
        atmosphere: {
            skyColor: 0x041a30,
            // FLAGSHIP REMAKE: thin + deepen the fog so the abyss can fall into real
            // darkness and the vertical gradient sphere + set pieces show through
            // (the old 0x06243f/0.008 wrapped the camera in a flat pale-teal wash that
            // flattened the gradient into uniform "pool water"). fogColor -> a deeper
            // indigo-teal, fogDensity halved so the dive reads top-bright/bottom-dark.
            fogColor: 0x041726,
            fogDensity: 0.0035,
            ambientLight: 0x003366,
            ambientIntensity: 0.5,
            skyFeatures: ['lightShaft', 'caustics', 'particulate'],
            // Cool key from the surface far above.
            lightDir: [0.05, 0.9, 0.1],
            lightColor: 0x66ccff,
            lightIntensity: 0.8,
            exposure: 1.0,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.CAUSTIC_CURRENT,
            baseColor: 0x062436,
            emissiveColor: 0x37d6ff,
            flowSpeed: 0.9,
            widthScale: 1.05,
        },
        node: { style: ODYSSEY_NODE_STYLES.BUBBLE_PEARL },
        anchor: 'lightShaft',
        audioTrack: 'OceanDeep',
        transitionOut: '2-3',
        transition: {
            id: '2-3',
            stinger: 'surface-breach',
            crossfadeDurationMs: 4000,
        },
    },
    {
        id: 3,
        name: 'Surface World',
        act: ODYSSEY_ACTS.LIVING,
        palette: { primary: 0x00dd44, accent: 0xfff2c0, shadow: 0x123018 },
        atmosphere: {
            // Deepened (capture review): 0x9ec6e8/0xaec8e0 were so pale that FogExp2
            // washed the upper frame near-white. A richer mid sky-blue reads as a real
            // daytime sky and lets the vegetation/clouds register against it.
            skyColor: 0x6ba3d8,
            fogColor: 0x6f9ec4,
            fogDensity: 0.004,
            ambientLight: 0xfff8e7,
            ambientIntensity: 0.8,
            skyFeatures: ['sun', 'distantRange', 'clouds'],
            // High warm sun.
            lightDir: [0.4, 0.8, 0.45],
            lightColor: 0xfff1d0,
            lightIntensity: 1.15,
            exposure: 1.05,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.LEY_LINE,
            baseColor: 0x1d4a22,
            emissiveColor: 0x9be84f,
            flowSpeed: 0.7,
            widthScale: 0.98,
        },
        node: { style: ODYSSEY_NODE_STYLES.SEED_LANTERN },
        anchor: 'distantRange',
        audioTrack: 'MoonlitForest',
        transitionOut: '3-4',
        transition: {
            id: '3-4',
            seamWidth: 0.03,
            preloadDistance: 0.06,
            stinger: 'ridgeline-rise',
            crossfadeDurationMs: 3000,
        },
    },
    {
        id: 4,
        name: 'Mountains',
        act: ODYSSEY_ACTS.LIVING,
        palette: { primary: 0x88ccff, accent: 0xffd6c0, shadow: 0x1c2a3a },
        atmosphere: {
            skyColor: 0x3a4f66,
            fogColor: 0x7d93ad,
            fogDensity: 0.005,
            ambientLight: 0xbdc3c7,
            ambientIntensity: 0.6,
            skyFeatures: ['heroSummit', 'aerialHaze', 'snowPlume'],
            // Low raking sun (drives alpenglow at peak energy).
            lightDir: [0.7, 0.25, 0.4],
            lightColor: 0xffe0c0,
            lightIntensity: 1.05,
            exposure: 1.05,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.CAIRN_RIDGE,
            baseColor: 0x39424f,
            emissiveColor: 0xbfe6ff,
            flowSpeed: 0.5,
            widthScale: 1.0,
        },
        node: { style: ODYSSEY_NODE_STYLES.CAIRN_LANTERN },
        anchor: 'heroSummit',
        audioTrack: 'HimalayanPeak',
        transitionOut: '4-5',
        transition: {
            id: '4-5',
            seamWidth: 0.06,
            stinger: 'summit-liftoff',
            crossfadeDurationMs: 3500,
        },
    },
    {
        id: 5,
        name: 'Sky & Drift',
        act: ODYSSEY_ACTS.BEYOND,
        palette: { primary: 0xffdd00, accent: 0xaad4ff, shadow: 0x141a2e },
        atmosphere: {
            // Deepened (capture review): 0xc8b6d6/0xb9a6c8 washed the frame near-white.
            // A richer warm-violet keeps the bright/hazy daytime identity while letting
            // the cloud strata, aurora and sun read instead of a flat pale wash.
            skyColor: 0x9a7fb5,
            fogColor: 0x8266a0,
            fogDensity: 0.006,
            ambientLight: 0x4a5568,
            ambientIntensity: 0.5,
            skyFeatures: ['cloudDeck', 'aurora', 'rainVeil'],
            lightDir: [0.2, 0.7, 0.5],
            lightColor: 0xcfe0ff,
            lightIntensity: 0.95,
            exposure: 1.1,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.JET_STREAM,
            baseColor: 0x141d33,
            emissiveColor: 0x9fc6ff,
            flowSpeed: 1.2,
            widthScale: 1.05,
        },
        node: { style: ODYSSEY_NODE_STYLES.CLOUD_WISP },
        anchor: 'cloudBreak',
        audioTrack: 'Starlight',
        transitionOut: '5-6',
        transition: {
            id: '5-6',
            // 5->6 is the journey's WORST seam ("pink soup in space"). Widen the fog/
            // content seam (0.018 default -> 0.03) so the violet haze dissolves toward the
            // black vacuum EARLIER and the ecotone has room to ignite Space's stars across
            // the last ~8% of Sky (ChapterEnvironmentManager 5->6 seam-in handling), so by
            // Space-01 the crisp vacuum reads immediately instead of arriving late.
            seamWidth: 0.03,
            preloadDistance: 0.06,
            stinger: 'atmosphere-edge',
            crossfadeDurationMs: 4000,
        },
    },
    {
        id: 6,
        name: 'Space',
        act: ODYSSEY_ACTS.BEYOND,
        palette: { primary: 0xaa44ff, accent: 0x8fb0ff, shadow: 0x05060f },
        atmosphere: {
            skyColor: 0x05060f,
            fogColor: 0x05060f,
            fogDensity: 0.0006,
            ambientLight: 0x2d3436,
            ambientIntensity: 0.3,
            skyFeatures: ['heroPlanet', 'nebula', 'starfield'],
            // Rim-only starlight.
            lightDir: [0.6, 0.3, -0.7],
            lightColor: 0x99aaff,
            lightIntensity: 0.55,
            // Lowered 1.15 -> 1.08 (plan §3 Space color/grade): the pink nebula over-
            // brightened into flat smoke at 1.15. Let the hero triad's bloom carry the
            // brightness instead, keeping cool indigo vacuum with true-black gaps.
            exposure: 1.08,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.STELLAR_STREAM,
            baseColor: 0x0a0f24,
            emissiveColor: 0xb38bff,
            flowSpeed: 1.4,
            widthScale: 1.0,
        },
        node: { style: ODYSSEY_NODE_STYLES.STARLIT_ORB },
        anchor: 'heroPlanet',
        audioTrack: 'Galaxy',
        transitionOut: '6-7',
        transition: {
            id: '6-7',
            seamWidth: 0.03,
            beatDurationMs: 1100,
            preloadDistance: 0.07,
            fxPreset: 'heavy',
            stinger: 'lensing-engage',
            crossfadeDurationMs: 5000,
        },
    },
    {
        id: 7,
        name: 'Black Hole',
        act: ODYSSEY_ACTS.TRANSCENDENCE,
        palette: { primary: 0xff44aa, accent: 0xffc266, shadow: 0x000000 },
        atmosphere: {
            skyColor: 0x0a0410,
            fogColor: 0x0a0410,
            fogDensity: 0.010,
            ambientLight: 0x1a1a1a,
            ambientIntensity: 0.2,
            skyFeatures: ['accretionDisk', 'lensing', 'infall'],
            // No key — accretion glow only.
            lightDir: [0.0, 0.1, -1.0],
            lightColor: 0xff8844,
            lightIntensity: 0.4,
            exposure: 1.2,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.HORIZON_FILAMENT,
            baseColor: 0x180611,
            emissiveColor: 0xff5fb0,
            flowSpeed: 1.6,
            widthScale: 0.95,
        },
        node: { style: ODYSSEY_NODE_STYLES.LENSED_SHARD },
        anchor: 'accretionDisk',
        audioTrack: 'BlackHole',
        transitionOut: '7-8',
        transition: {
            id: '7-8',
            seamWidth: 0.022,
            beatDurationMs: 900,
            preloadDistance: 0.06,
            fxPreset: 'neon',
            stinger: 'neon-snap',
            crossfadeDurationMs: 6000,
        },
    },
    {
        id: 8,
        name: 'Urban Encore',
        act: ODYSSEY_ACTS.TRANSCENDENCE,
        palette: { primary: 0x00eeff, accent: 0xff66c4, shadow: 0x0a0a1a },
        atmosphere: {
            skyColor: 0x0e0816,
            fogColor: 0x140a1e,
            fogDensity: 0.012,
            ambientLight: 0x2a1a3a,
            ambientIntensity: 0.4,
            skyFeatures: ['citySpire', 'litWindows', 'wetReflection'],
            lightDir: [0.3, 0.5, 0.6],
            lightColor: 0x66f0ff,
            lightIntensity: 0.85,
            exposure: 1.1,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.NEON_DATA_LINE,
            baseColor: 0x0c0a1f,
            emissiveColor: 0x00eaff,
            flowSpeed: 1.5,
            widthScale: 1.0,
        },
        node: { style: ODYSSEY_NODE_STYLES.NEON_SIGN },
        anchor: 'citySpire',
        audioTrack: 'NeonDistrict',
        transitionOut: null,
        transition: {
            id: null,
            crossfadeDurationMs: 4000,
        },
    },
]);

const PROFILE_BY_ID = new Map(ODYSSEY_CHAPTER_PROFILES.map((profile) => [profile.id, profile]));

/**
 * Get a chapter profile by id (1-based). Falls back to chapter 1 for out-of-range ids
 * so callers never have to null-check.
 * @param {number} chapterId
 * @returns {object}
 */
export function getChapterProfile(chapterId) {
    return PROFILE_BY_ID.get(chapterId) || ODYSSEY_CHAPTER_PROFILES[0];
}

/**
 * Get the narrative act for a chapter.
 * @param {number} chapterId
 * @returns {string}
 */
export function getActForChapter(chapterId) {
    return getChapterProfile(chapterId).act;
}

/**
 * Get the camera profile for a chapter (resolved through its act).
 * @param {number} chapterId
 * @returns {{followDistance:number, fovBase:number, sway:number, bob:number, drift:number}}
 */
export function getCameraProfileForChapter(chapterId) {
    return ODYSSEY_CAMERA_PROFILES[getActForChapter(chapterId)]
        || ODYSSEY_CAMERA_PROFILES[ODYSSEY_ACTS.LIVING];
}

export function getChapterTransitionForChapter(chapterId) {
    const profile = getChapterProfile(chapterId);
    return {
        ...DEFAULT_ODYSSEY_TRANSITION,
        ...(profile.transition || {}),
    };
}

/** Linear interpolation for plain numbers. */
export function lerpNumber(a, b, t) {
    return a + (b - a) * t;
}

export default ODYSSEY_CHAPTER_PROFILES;
