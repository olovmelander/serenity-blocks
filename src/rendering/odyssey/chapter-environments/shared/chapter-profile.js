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

/**
 * The ONE Odyssey daylight sun — high-front, down-corridor (2026-08, Wave D). Shared by the shading
 * rig (profile lightDir, below) AND every in-shader disc/water/key const so the light never teleports
 * across Ch3→Ch4→Ch5. Plain array (this module is intentionally THREE-free); consumers wrap it in
 * THREE.Vector3().normalize() and the director normalizes the profile copy. Points TOWARD the sun
 * (all Odyssey light dirs use that convention).
 */
export const ODYSSEY_SUN = Object.freeze([0.35, 0.62, -0.70]);

/**
 * The RE-SOLVED journey sun (One World, Wave 0/1). `ODYSSEY_SUN`'s negative Z back-lit the
 * corridor — the world's sun was re-derived from the actual travel direction, and this is that
 * answer. It lives here, in the import-free leaf, because a light direction that only one
 * renderer can see is how the journey ended up with three of them: this used to be declared in
 * `odyssey-world-renderer.js` and imported by nobody.
 *
 * Independent corroboration that this, not `ODYSSEY_SUN`, is the correct canonical direction:
 * Ch6's hero gas giant was hand-tuned by eye until it looked right, using a VIEW-space light.
 * Driving the real camera over the real spline and converting that light to world space at each
 * frame gives a best fit of [-0.279, 0.185, 0.942] — **24.3 degrees from this vector, but 130.1
 * degrees from `ODYSSEY_SUN`.** The eye had already voted for the world's sun.
 *
 * `ODYSSEY_SUN` survives as the LEGACY profile sun, still read by chapters 1/7/8 and the
 * fallback Act II chapters. Converging the two (115.6 degrees apart) is the open half of Wave
 * 0.2 and needs those chapters captured first — see the plan.
 */
export const ODYSSEY_WORLD_SUN = Object.freeze([-0.46, 0.36, 0.61]);

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
            // Creative plan (Ch1 Transition Out): widen the Steam Quench pre-roll
            // (0.018 default → 0.03, the 3→4 model) so the ember→steam veils and the
            // orange→cyan transformation play across multiple frames instead of
            // popping at the 16→17 equivalent.
            seamWidth: 0.03,
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
            skyColor: 0x5aa8e0,
            // PAINTERLY-ASCENT REPALETTE (2026-08, Wave A): warm golden-hour fog (0xb8a47e) → the
            // SHARED bright light-cyan daylight haze anchor (~0xbcd8ec). This is the #1 cohesion
            // lever — Ch3/4/5 all breathe the same air, so the range/distance reads as one bright
            // afternoon instead of gold→winter→indigo. Density stays low (0.0016) per the anchor.
            fogColor: 0xbcd8ec,
            // Density pulled back (0.0016 → 0.0011) after the Wave-A capture read too milky/washed —
            // aerial haze should hug the far mountains, not veil the whole mid-ground. Keeps the
            // reference's crisp saturated depth (deep water, readable peaks) under the bright sky.
            fogDensity: 0.0011,
            // Neutral-cool daylight ambient (was warm 0xfff8e7) + high-key exposure so the meadow
            // reads luminous. lightDir stays until the Wave-D shared-sun pass; colour whitened to
            // the shared warm-white sun (~0xfff4e0).
            ambientLight: 0xeaf2ff,
            ambientIntensity: 0.58,
            skyFeatures: ['sun', 'distantRange', 'clouds'],
            lightDir: [...ODYSSEY_SUN],
            lightColor: 0xfff4e0,
            lightIntensity: 1.15,
            exposure: 1.02,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.LEY_LINE,
            baseColor: 0x1d4a22,
            // Creative plan Ch3 item 7: a sun-warmed chlorophyll leyline (the old lime
            // 0x9be84f clashed with the golden hour instead of belonging to it).
            // Masterplan D2: dimmed further (0x96a842 → 0x687d31) — live capture showed the
            // ch3 path was the single worst figure-ground offender in the journey (a neon-green
            // slab that out-read the whole meadow). Keeps the chlorophyll identity, recedes.
            emissiveColor: 0x687d31,
            flowSpeed: 0.7,
            widthScale: 0.9,
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
            // PAINTERLY-ASCENT REPALETTE (2026-08, Wave B): dark-slate/grey-blue dusk atmosphere →
            // the shared BRIGHT DAYLIGHT anchor. skyColor daylight azure, fog → shared light-cyan
            // haze (0xbcd8ec) at low density (was 0.005, a 3× spike that closed the world in at the
            // mountains — now 0.0015, only marginally hazier than Ch3 for airy alpine aerial
            // perspective). Ambient bright cool-white; sun colour warm-white (matches Ch3).
            skyColor: 0x5aa8e0,
            fogColor: 0xbcd8ec,
            fogDensity: 0.0015,
            ambientLight: 0xeaf2ff,
            ambientIntensity: 0.6,
            skyFeatures: ['heroSummit', 'aerialHaze', 'snowPlume'],
            lightDir: [...ODYSSEY_SUN],
            lightColor: 0xfff4e0,
            lightIntensity: 1.05,
            exposure: 1.02,
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
            // PAINTERLY-ASCENT REPALETTE (2026-08, Wave C): Ch5 flipped from dark warm-violet
            // twilight to the shared BRIGHT DAYLIGHT anchor — this is the top of the ascent, drifting
            // above a sunlit cloud-sea, so it should be the BRIGHTEST chapter, not the darkest. Sky
            // azure, fog → shared light-cyan haze, ambient bright cool-white (was 0x2f3850@0.34, which
            // lit the sky chapter like night — a ~9× fill collapse), exposure lifted to high-key.
            skyColor: 0x3f7fd0,
            fogColor: 0xbcd8ec,
            fogDensity: 0.0022,
            ambientLight: 0xeaf2ff,
            ambientIntensity: 0.6,
            skyFeatures: ['cloudDeck', 'aurora', 'rainVeil'],
            lightDir: [...ODYSSEY_SUN],
            lightColor: 0xfff4e0,
            lightIntensity: 1.0,
            exposure: 1.02,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.JET_STREAM,
            baseColor: 0x0b1426,
            emissiveColor: 0x5f8db8,
            flowSpeed: 1.2,
            widthScale: 0.94,
        },
        node: { style: ODYSSEY_NODE_STYLES.CLOUD_WISP },
        anchor: 'cloudBreak',
        audioTrack: 'Starlight',
        transitionOut: '5-6',
        transition: {
            id: '5-6',
            // 5->6 carries the aurora out of Sky before Space fully asserts itself.
            // Keep the widened seam so the handoff has room, but Chapter 6 now stages its
            // own star/hero/clutter reveal instead of pre-igniting everything in Sky.
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
            skyColor: 0x160c2a,
            fogColor: 0x160c2a,
            fogDensity: 0.012,
            ambientLight: 0x261132,
            ambientIntensity: 0.24,
            skyFeatures: ['accretionDisk', 'lensing', 'infall'],
            // No key — accretion glow only.
            lightDir: [0.0, 0.1, -1.0],
            lightColor: 0xff8844,
            lightIntensity: 0.4,
            exposure: 1.2,
        },
        path: {
            style: ODYSSEY_PATH_STYLES.HORIZON_FILAMENT,
            baseColor: 0x0e0310,
            emissiveColor: 0x9a2d76,
            flowSpeed: 1.6,
            widthScale: 0.84,
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
            baseColor: 0x080816,
            // Wave R Ch8: keep the data line readable without letting electric cyan
            // overpower the Retrosun/facade value hierarchy.
            emissiveColor: 0x18b9c8,
            flowSpeed: 1.5,
            widthScale: 0.82,
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
