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
 * Bar lines (T): 6.920 8.754 10.588 12.423 14.257 16.091 17.926 19.760 21.595 23.429 25.263
 * 27.098 28.932 30.767 32.601 34.435 36.247 38.081 39.915 41.750 43.584 45.395 47.230 49.064
 * 50.898 52.733 54.567 56.401 58.259 60.070 61.904 63.716 65.573 67.384 69.219 71.053 72.887
 * 74.721 76.555 78.391.
 *
 * Every mode is in it (Single Player, Infinity, Stillfall, Local Versus, Online Versus,
 * Serenity, Hale Sessions, Odyssey) and 29 different themes (plus a breathing world and the Odyssey
 * journey), no theme shown twice.
 *
 * To re-cut: change a shot's theme or setup in SHOTS, move a cut in EDIT (keep cuts on the bar
 * times), or edit the copy in OVERLAY; then re-run capture for the shots you touched
 * (`--only=id,id`), render-overlay and assemble.
 */

export const BAR = 1.8344;

/**
 * The drop's world flip: one continuous game in which the world changes around the same board on
 * every half-bar (`at` is seconds into the shot; the shot starts on the drop at T 41.750).
 */
export const WORLDS = [
    { at: 0, theme: 'golden-forest', name: 'Golden Forest' },
    { at: 0.917, theme: 'kaleidosonic', name: 'Kaleidosonic' },
    { at: 1.834, theme: 'high-coast', name: 'High Coast' },
    { at: 2.740, theme: 'voltage-storm', name: 'Voltage Storm' },
    { at: 3.645, theme: 'pyrestorm', name: 'Pyrestorm' },
    { at: 4.562, theme: 'ocean', name: 'Ocean' },
    { at: 5.480, theme: 'winter', name: 'Winter' },
    { at: 6.397, theme: 'nebula-flow', name: 'Nebula Flow' },
    { at: 7.314, theme: 'rainbow-terraces', name: 'Rainbow Terraces' },
    { at: 8.231, theme: 'chromatic-impasto', name: 'Chromatic Impasto' },
    { at: 9.148, theme: 'vesper-chrysalis', name: 'Vesper Chrysalis' },
    { at: 10.066, theme: 'summer', name: 'Midsommar' },
    { at: 10.983, theme: 'ice-temple', name: 'Ice Temple' },
    { at: 11.900, theme: 'blood-moon', name: 'Blood Moon' },
    { at: 12.817, theme: 'sunbraid', name: 'Sunbraid' },
    { at: 13.734, theme: 'wolfhour', name: 'Wolfhour' },
];
const WORLDS_START = 41.750;
const WORLDS_END = 56.401;

/**
 * How each shot is set up in the running game. `kind` picks the driver in capture.mjs:
 *   single | infinity — that mode with a CPU bot playing the board, in `theme`
 *                       (`worlds`: switch the world at those times, the game paused meanwhile)
 *   stillfall         — Stillfall `puzzle`, its stored solution played (`presolve` moves before the
 *                       shot, `thinkMs` over each choice on camera)
 *   versus            — Local Versus, every seat a bot
 *   online            — Online Versus over the mock transport, `players` seats, every one a bot
 *   serenity          — Serenity Mode on `theme` (no board)
 *   hale              — a Hale breathing session (`session`)
 *   odyssey           — an orb (`level`) played by the bot, or the journey flown over from one
 *                       chapter's start to another's (`flyover: { from, to }`, chapters from 0)
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
    // Watchtower (tier 12): four pieces stacked on the tower before the shot, then the T fires
    // four waves deep on camera.
    stillfall: { kind: 'stillfall', theme: 'crystal-cave', puzzle: 'watchtower', presolve: 4, thinkMs: 450 },
    // The versus matches play a few seconds before the shot, so the boards have stacks and garbage.
    versus: { kind: 'versus', theme: 'synthwave-sunset', seats: 4, preroll: 7 },
    // Two seats: more peer windows than one cannot all stay joined under software rendering. A light
    // theme, so the host answers the join handshake in time (a heavy one held it past the peer's
    // patience).
    online: { kind: 'online', theme: 'tornado', players: 2, preroll: 6 },
    breakdown: { kind: 'single', theme: 'painted-ages' },
    worlds: { kind: 'single', theme: WORLDS[0].theme, worlds: WORLDS, difficulty: 9 },
    serenity: { kind: 'serenity', theme: 'stillwater' },
    hale: { kind: 'hale', session: 'FIRST' },
    // The journey flown over: the Earth's core up through the ocean to the surface; later the
    // last air into space; and the climb into the black hole.
    'odyssey-map': { kind: 'odyssey', flyover: { from: 0, to: 2 } },
    // Orbs start on their own authored boards (no prefill: a goal must not be met before the shot).
    'ody-a': { kind: 'odyssey', level: 1, prefill: 0, preroll: 1.2 }, // Ashen Dawn, the Earth's core
    'ody-b': { kind: 'odyssey', level: 7, prefill: 0, preroll: 1.2 }, // Sunken Depths
    'odyssey-space': { kind: 'odyssey', flyover: { from: 4, to: 5 } },
    'odyssey-hole': { kind: 'odyssey', flyover: { from: 5, to: 6 } },
    end: { kind: 'serenity', theme: 'sunset' },
};

/**
 * The cut list: each entry holds its shot from `at` to the next entry's `at`. `fade` makes it
 * cross-dissolve in; `move` is a camera move made in post (assemble.mjs MOVES): push, pull,
 * pushSlow, driftLeft, driftRight, rise.
 */
export const EDIT = [
    { at: 0, shot: 'open', move: 'pushSlow' },
    { at: 12.423, shot: 'stack-a', move: 'push' },
    { at: 16.091, shot: 'stack-b', move: 'driftLeft' },
    { at: 19.760, shot: 'stack-c', move: 'pull' },
    { at: 21.595, shot: 'infinity', move: 'rise' },
    { at: 25.263, shot: 'stillfall', move: 'push' },
    { at: 28.932, shot: 'versus', move: 'pull' },
    { at: 32.601, shot: 'online', move: 'driftRight' },
    { at: 36.247, shot: 'breakdown', fade: 0.4, move: 'pushSlow' },
    { at: WORLDS_START, shot: 'worlds' },
    { at: WORLDS_END, shot: 'serenity', fade: 0.6, move: 'driftLeft' },
    { at: 60.070, shot: 'hale', fade: 0.6, move: 'pushSlow' },
    { at: 63.716, shot: 'odyssey-map' },
    { at: 67.384, shot: 'ody-a', move: 'push' },
    { at: 69.219, shot: 'ody-b', move: 'pull' },
    { at: 71.053, shot: 'odyssey-space' },
    { at: 74.721, shot: 'odyssey-hole' },
    { at: 78.391, shot: 'end', move: 'pull' },
];

const worldName = ({ at, name }, i) => {
    const end = i + 1 < WORLDS.length ? WORLDS[i + 1].at : WORLDS_END - WORLDS_START;
    return {
        type: 'line', size: 'sm', position: 'lower-right', start: WORLDS_START + at + 0.05,
        end: WORLDS_START + end - 0.05, fadeIn: 0.1, fadeOut: 0.1, text: name,
    };
};

/**
 * The title layer. Types: scrim (vignette | lower | full | black), letterbox, logo, section
 * (the big word), mode (a mode's wordmark and a caption), line (sm | md | lg), flash. Copy comes
 * from the game's own menu text (src/ui/main-menu/main-menu.js) so every claim matches the build.
 */
export const OVERLAY = [
    // Cold open: out of black into the pond, framed wide.
    { type: 'scrim', style: 'black', start: 0, end: 3.2, fadeIn: 0, fadeOut: 2.8 },
    { type: 'letterbox', start: 0, end: 12.62, fadeIn: 0, fadeOut: 0.4 },
    { type: 'line', size: 'sm', position: 'center', start: 2.4, end: 6.5, fadeIn: 1.0, fadeOut: 0.6, text: 'Find your flow' },
    // Logo on the groove's first downbeat.
    { type: 'scrim', style: 'vignette', start: 6.6, end: 12.3, fadeIn: 0.6, fadeOut: 0.5 },
    { type: 'logo', start: 6.92, end: 12.2, fadeIn: 0.55, fadeOut: 0.45, tagline: ['Stack', 'Breath', 'Ascend'] },

    // STACK
    { type: 'scrim', style: 'vignette', start: 12.423, end: 15.9, fadeIn: 0.15, fadeOut: 0.4, opacity: 0.85 },
    { type: 'section', text: 'STACK', sub: 'Clear lines. Raise the level. Chase your best.', start: 12.423, end: 15.85, fadeIn: 0.18, fadeOut: 0.35 },
    { type: 'scrim', style: 'lower', start: 21.595, end: 36.2, fadeIn: 0.25, fadeOut: 0.3 },
    { type: 'mode', mode: 'infinity', caption: 'A well one thousand rows tall.', start: 21.75, end: 25.15, fadeIn: 0.3, fadeOut: 0.25 },
    { type: 'mode', mode: 'stillfall', caption: 'Gravity waits while you choose. Then the cascade runs.', start: 25.42, end: 28.82, fadeIn: 0.3, fadeOut: 0.25 },
    { type: 'mode', mode: 'local-versus', caption: 'Up to four players on one screen.', start: 29.09, end: 32.5, fadeIn: 0.3, fadeOut: 0.25 },
    { type: 'mode', mode: 'online-versus', caption: 'Free-for-all lobbies for two to eight players.', start: 32.76, end: 36.15, fadeIn: 0.3, fadeOut: 0.25 },

    // Breakdown: the worlds.
    { type: 'scrim', style: 'vignette', start: 36.3, end: 41.7, fadeIn: 0.6, fadeOut: 0.2, opacity: 0.9 },
    { type: 'line', size: 'lg', position: 'center', start: 36.45, end: 38.95, fadeIn: 0.5, fadeOut: 0.3, text: '63 living worlds' },
    { type: 'line', size: 'md', position: 'center', start: 39.05, end: 41.62, fadeIn: 0.4, fadeOut: 0.15, text: 'Each one answers the way you play.' },
    // Drop: the world flips around the same board on every half-bar.
    { type: 'flash', start: 41.75, end: 42.0, fadeIn: 0, fadeOut: 0.25, opacity: 0.55 },
    ...WORLDS.map(worldName),

    // BREATH
    { type: 'scrim', style: 'vignette', start: 56.45, end: 59.95, fadeIn: 0.5, fadeOut: 0.5, opacity: 0.8 },
    { type: 'section', text: 'BREATH', sub: 'Nothing to play. A living world and its music.', start: 56.55, end: 59.9, fadeIn: 0.5, fadeOut: 0.45 },
    { type: 'scrim', style: 'lower', start: 60.1, end: 63.6, fadeIn: 0.4, fadeOut: 0.2 },
    { type: 'mode', mode: 'hale-sessions', caption: 'Nine voice-guided breathing sessions.', start: 60.3, end: 63.55, fadeIn: 0.4, fadeOut: 0.2 },

    // ASCEND
    { type: 'flash', start: 63.716, end: 63.95, fadeIn: 0, fadeOut: 0.23, opacity: 0.55 },
    { type: 'letterbox', start: 63.716, end: 67.55, fadeIn: 0, fadeOut: 0.35 },
    { type: 'scrim', style: 'vignette', start: 63.716, end: 67.3, fadeIn: 0.15, fadeOut: 0.4, opacity: 0.85 },
    { type: 'section', text: 'ASCEND', sub: 'From the molten core of the Earth to the edge of a black hole.', start: 63.716, end: 67.25, fadeIn: 0.18, fadeOut: 0.35 },
    { type: 'scrim', style: 'lower', start: 67.4, end: 71.0, fadeIn: 0.25, fadeOut: 0.25 },
    { type: 'mode', mode: 'odyssey', caption: 'Eight chapters. Sixty orbs.', start: 67.5, end: 70.95, fadeIn: 0.3, fadeOut: 0.25 },
    { type: 'line', size: 'md', position: 'lower', start: 75.0, end: 78.25, fadeIn: 0.5, fadeOut: 0.2, text: '…and beyond.' },

    // End card on the last hit.
    { type: 'flash', start: 78.391, end: 78.75, fadeIn: 0, fadeOut: 0.36, opacity: 0.7 },
    { type: 'scrim', style: 'full', start: 78.391, end: 88.788, fadeIn: 0.25, fadeOut: 0, opacity: 0.45 },
    { type: 'scrim', style: 'vignette', start: 78.391, end: 88.788, fadeIn: 0.25, fadeOut: 0 },
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
