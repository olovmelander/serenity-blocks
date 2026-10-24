/**
 * The release trailer, as data: the music edit, the shot list, the cut list and the title layer.
 *
 * Everything is timed to the soundtrack. The music is the game's own "Falling Pieces"
 * (public/assets/music/falling-pieces.mp3, ≈130.8 BPM, one bar ≈ 1.834 s), cut on downbeats into
 * four pieces: the opening riser and groove, the build into the first breakdown and drop, the
 * second breakdown and drop, and the final hit with its tail. The downbeats were found with
 * librosa's beat tracker (bass-onset phase picks the bar's first beat); `T` below is trailer time.
 *
 *   music  0.000– 21.595  →  T  0.000– 21.595   riser (groove from 6.92), 8 bars
 *   music 109.552–144.358 →  T 21.595– 56.401   8-bar build, breakdown at 36.247, drop at 41.750
 *   music 188.569–210.559 →  T 56.401– 78.391   breakdown, drop at 63.716
 *   music 252.703–263.100 →  T 78.391– 88.788   last hit and tail
 *
 * To re-cut: change a shot's theme or setup in SHOTS, move a cut in EDIT (keep cuts on the bar
 * times), or edit the copy in OVERLAY; then re-run capture for the shots you touched
 * (`--only=id,id`) and assemble.
 */

export const BAR = 1.8344;

/**
 * How each shot is set up in the running game. `kind` picks the driver in capture.mjs:
 *   single | infinity — that mode with a CPU bot playing the board, in `theme`
 *   stillfall         — a Stillfall puzzle with the bot solving it
 *   versus            — Local Versus, every seat a bot
 *   serenity          — Serenity Mode on `theme` (no board)
 *   hale              — a Hale breathing session
 *   odyssey           — the Odyssey journey map, or `level` (an orb) played by the bot
 * Board shots open on a lived-in stack: before recording, the bot places `prefill` pieces at
 * once (default 18, Infinity 40; 0 for an empty well), then plays live at `difficulty` (1–10,
 * default 8) from `seed`. `settle` is real ms to wait after the theme is ready (default 4000),
 * `preroll` virtual seconds stepped before the first recorded frame.
 */
export const SHOTS = {
    open: { kind: 'serenity', theme: 'koi-pond' },
    'stack-a': { kind: 'single', theme: 'aurora' },
    'stack-b': { kind: 'single', theme: 'neon-district' },
    'stack-c': { kind: 'single', theme: 'sakura-twilight' },
    infinity: { kind: 'infinity', theme: 'galaxy' },
    stillfall: { kind: 'stillfall', theme: 'crystal-cave' },
    versus: { kind: 'versus', theme: 'synthwave-sunset', seats: 4 },
    'stack-d': { kind: 'single', theme: 'pyrestorm' },
    'stack-e': { kind: 'single', theme: 'ocean' },
    breakdown: { kind: 'single', theme: 'painted-ages' },
    m1: { kind: 'single', theme: 'golden-forest' },
    m2: { kind: 'single', theme: 'kaleidosonic' },
    m3: { kind: 'single', theme: 'high-coast' },
    m4: { kind: 'single', theme: 'voltage-storm' },
    m5: { kind: 'single', theme: 'winter' },
    m6: { kind: 'single', theme: 'nebula-flow' },
    m7: { kind: 'single', theme: 'summer' },
    m8: { kind: 'single', theme: 'wolfhour' },
    serenity: { kind: 'serenity', theme: 'stillwater' },
    hale: { kind: 'hale' },
    'odyssey-map': { kind: 'odyssey' },
    'ody-a': { kind: 'odyssey', level: 1 }, // Ashen Dawn, the Earth's core
    'ody-b': { kind: 'odyssey', level: 7 }, // Sunken Depths
    'ody-c': { kind: 'odyssey', level: 23 }, // Everest Ascent
    'ody-d': { kind: 'odyssey', level: 37 }, // Stellar Flare
    'ody-e': { kind: 'odyssey', level: 47 }, // The Singularity
    end: { kind: 'serenity', theme: 'sunset' },
};

/** The cut list: each entry holds its shot from `at` to the next entry's `at`. */
export const EDIT = [
    { at: 0, shot: 'open' },
    { at: 12.423, shot: 'stack-a' },
    { at: 16.091, shot: 'stack-b' },
    { at: 19.760, shot: 'stack-c' },
    { at: 21.595, shot: 'infinity' },
    { at: 25.263, shot: 'stillfall' },
    { at: 28.932, shot: 'versus' },
    { at: 32.601, shot: 'stack-d' },
    { at: 34.435, shot: 'stack-e' },
    { at: 36.247, shot: 'breakdown', fade: 0.4 },
    { at: 41.750, shot: 'm1' },
    { at: 43.584, shot: 'm2' },
    { at: 45.395, shot: 'm3' },
    { at: 47.230, shot: 'm4' },
    { at: 49.064, shot: 'm5' },
    { at: 50.898, shot: 'm6' },
    { at: 52.733, shot: 'm7' },
    { at: 54.567, shot: 'm8' },
    { at: 56.401, shot: 'serenity', fade: 0.6 },
    { at: 60.070, shot: 'hale', fade: 0.6 },
    { at: 63.716, shot: 'odyssey-map' },
    { at: 67.384, shot: 'ody-a' },
    { at: 69.219, shot: 'ody-b' },
    { at: 71.053, shot: 'ody-c' },
    { at: 72.887, shot: 'ody-d' },
    { at: 74.721, shot: 'ody-e' },
    { at: 78.391, shot: 'end' },
];

const themeName = (at, end, text) => ({
    type: 'line', size: 'sm', position: 'lower-right', start: at + 0.12, end: end - 0.12, fadeIn: 0.2, fadeOut: 0.2, text,
});

/**
 * The title layer. Types: scrim (vignette | lower | full | black), logo, section (the big
 * word), mode (a mode's wordmark and a caption), line (sm | md | lg), flash. Copy comes from the
 * game's own menu text (src/ui/main-menu/main-menu.js) so every claim matches the build.
 */
export const OVERLAY = [
    // Cold open: out of black into the pond.
    { type: 'scrim', style: 'black', start: 0, end: 3.2, fadeIn: 0, fadeOut: 2.8 },
    { type: 'line', size: 'sm', position: 'center', start: 2.4, end: 6.5, fadeIn: 1.0, fadeOut: 0.6, text: 'Find your flow' },
    // Logo on the groove's first downbeat.
    { type: 'scrim', style: 'vignette', start: 6.6, end: 12.3, fadeIn: 0.6, fadeOut: 0.5 },
    { type: 'logo', start: 6.92, end: 12.2, fadeIn: 0.55, fadeOut: 0.45, tagline: ['Stack', 'Breath', 'Ascend'] },

    // STACK
    { type: 'scrim', style: 'vignette', start: 12.423, end: 15.9, fadeIn: 0.15, fadeOut: 0.4, opacity: 0.85 },
    { type: 'section', text: 'STACK', sub: 'Clear lines. Raise the level. Chase your best.', start: 12.423, end: 15.85, fadeIn: 0.18, fadeOut: 0.35 },
    { type: 'scrim', style: 'lower', start: 21.595, end: 32.55, fadeIn: 0.25, fadeOut: 0.3 },
    { type: 'mode', mode: 'infinity', caption: 'A well one thousand rows tall.', start: 21.75, end: 25.15, fadeIn: 0.3, fadeOut: 0.25 },
    { type: 'mode', mode: 'stillfall', caption: 'Gravity waits while you choose. Then the cascade runs.', start: 25.42, end: 28.82, fadeIn: 0.3, fadeOut: 0.25 },
    { type: 'mode', mode: 'local-versus', caption: 'Up to four players on one screen.', start: 29.09, end: 32.5, fadeIn: 0.3, fadeOut: 0.25 },

    // Breakdown: the worlds.
    { type: 'scrim', style: 'vignette', start: 36.3, end: 41.7, fadeIn: 0.6, fadeOut: 0.2, opacity: 0.9 },
    { type: 'line', size: 'lg', position: 'center', start: 36.45, end: 38.95, fadeIn: 0.5, fadeOut: 0.3, text: '63 living worlds' },
    { type: 'line', size: 'md', position: 'center', start: 39.05, end: 41.62, fadeIn: 0.4, fadeOut: 0.15, text: 'Each one answers the way you play.' },
    { type: 'flash', start: 41.75, end: 42.0, fadeIn: 0, fadeOut: 0.25, opacity: 0.55 },
    themeName(41.750, 43.584, 'Golden Forest'),
    themeName(43.584, 45.395, 'Kaleidosonic'),
    themeName(45.395, 47.230, 'High Coast'),
    themeName(47.230, 49.064, 'Voltage Storm'),
    themeName(49.064, 50.898, 'Winter'),
    themeName(50.898, 52.733, 'Nebula Flow'),
    themeName(52.733, 54.567, 'Midsommar'),
    themeName(54.567, 56.401, 'Wolfhour'),

    // BREATH
    { type: 'scrim', style: 'vignette', start: 56.45, end: 59.95, fadeIn: 0.5, fadeOut: 0.5, opacity: 0.8 },
    { type: 'section', text: 'BREATH', sub: 'Nothing to play. A living world and its music.', start: 56.55, end: 59.9, fadeIn: 0.5, fadeOut: 0.45 },
    { type: 'scrim', style: 'lower', start: 60.1, end: 63.6, fadeIn: 0.4, fadeOut: 0.2 },
    { type: 'mode', mode: 'hale-sessions', caption: 'Nine voice-guided breathing sessions.', start: 60.3, end: 63.55, fadeIn: 0.4, fadeOut: 0.2 },

    // ASCEND
    { type: 'flash', start: 63.716, end: 63.95, fadeIn: 0, fadeOut: 0.23, opacity: 0.55 },
    { type: 'scrim', style: 'vignette', start: 63.716, end: 67.3, fadeIn: 0.15, fadeOut: 0.4, opacity: 0.85 },
    { type: 'section', text: 'ASCEND', sub: 'From the molten core of the Earth to the edge of a black hole.', start: 63.716, end: 67.25, fadeIn: 0.18, fadeOut: 0.35 },
    { type: 'scrim', style: 'lower', start: 67.4, end: 71.0, fadeIn: 0.25, fadeOut: 0.25 },
    { type: 'mode', mode: 'odyssey', caption: 'Eight chapters. Sixty orbs.', start: 67.5, end: 70.95, fadeIn: 0.3, fadeOut: 0.25 },
    { type: 'line', size: 'md', position: 'lower', start: 75.0, end: 78.25, fadeIn: 0.5, fadeOut: 0.2, text: '…and beyond.' },

    // End card on the last hit.
    { type: 'flash', start: 78.391, end: 78.75, fadeIn: 0, fadeOut: 0.36, opacity: 0.7 },
    { type: 'scrim', style: 'full', start: 78.391, end: 88.788, fadeIn: 0.25, fadeOut: 0 },
    {
        type: 'logo', start: 78.55, end: 88.788, fadeIn: 0.7, fadeOut: 0, tagline: ['Stack', 'Breath', 'Ascend'],
        line: 'COMING SOON', subline: 'PC · Steam',
    },
    { type: 'scrim', style: 'black', start: 86.4, end: 88.788, fadeIn: 2.2, fadeOut: 0 },
];

export const TRAILER = {
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 88.788,
    outputName: 'serenity-blocks-trailer.mp4',
    music: {
        file: 'public/assets/music/falling-pieces.mp3',
        segments: [
            { from: 0, to: 21.595 },
            { from: 109.552, to: 144.358 },
            { from: 188.569, to: 210.559 },
            { from: 252.703, to: 263.1 },
        ],
        fadeOut: 3.0,
    },
    shots: SHOTS,
    edit: EDIT,
    overlay: OVERLAY,
};
