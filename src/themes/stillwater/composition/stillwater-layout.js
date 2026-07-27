/**
 * Pure responsive-composition policy for Stillwater.
 *
 * The theme is prewarmed before every game-mode surface is necessarily mounted, so
 * callers pass the current presentation context explicitly and may resolve it again
 * on activation/resume. This module intentionally has no DOM or renderer dependency.
 */

export const STILLWATER_LAYOUT_IDS = Object.freeze([
    'solo',
    'duo',
    'quad',
    'odyssey',
]);

export const STILLWATER_NARROW_ASPECT = 1.68;

const DEFAULT_ASPECT = 16 / 9;
const BASE_CAMERA_Z = 39;

const BOARD_SAFE_REGIONS = {
    solo: [
        {
            x: 0.32, y: 0.09, width: 0.36, height: 0.82,
        },
    ],
    duo: [
        {
            x: 0.16, y: 0.13, width: 0.27, height: 0.74,
        },
        {
            x: 0.57, y: 0.13, width: 0.27, height: 0.74,
        },
    ],
    quad: [
        {
            x: 0.035, y: 0.20, width: 0.19, height: 0.60,
        },
        {
            x: 0.282, y: 0.20, width: 0.19, height: 0.60,
        },
        {
            x: 0.529, y: 0.20, width: 0.19, height: 0.60,
        },
        {
            x: 0.776, y: 0.20, width: 0.19, height: 0.60,
        },
    ],
    odyssey: [
        {
            x: 0.37, y: 0.08, width: 0.31, height: 0.84,
        },
        {
            x: 0.055,
            y: 0.14,
            width: 0.22,
            height: 0.72,
            role: 'hud-exclusion',
        },
    ],
};

export const STILLWATER_BOARD_SAFE_REGIONS = Object.freeze(
    Object.fromEntries(
        Object.entries(BOARD_SAFE_REGIONS).map(([layout, regions]) => [
            layout,
            Object.freeze(regions.map((region) => Object.freeze({ ...region }))),
        ]),
    ),
);

const LAYOUT_PULLBACKS = Object.freeze({
    solo: 0,
    duo: 3,
    quad: 7,
    odyssey: 0,
});

const LAYOUT_ALIASES = Object.freeze({
    solo: 'solo',
    single: 'solo',
    'single-player': 'solo',
    1: 'solo',
    duo: 'duo',
    dual: 'duo',
    'two-player': 'duo',
    2: 'duo',
    quad: 'quad',
    'four-player': 'quad',
    3: 'quad',
    4: 'quad',
    odyssey: 'odyssey',
    journey: 'odyssey',
});

function normalizeToken(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-');
}

function normalizeLayoutOverride(value) {
    return LAYOUT_ALIASES[normalizeToken(value)] || null;
}

function normalizeGameMode(value) {
    const token = normalizeToken(value);
    if (token === 'odyssey') return 'odyssey';
    if ([
        'local',
        'local-multiplayer',
        'local-multi-player',
        'local-mp',
    ].includes(token)) return 'local-multiplayer';
    if ([
        'online',
        'online-multiplayer',
        'online-multi-player',
        'online-mp',
        'network',
        'networked',
    ].includes(token)) return 'online-multiplayer';
    return token || 'single';
}

function collectionSize(value) {
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(value?.size)) return value.size;
    if (Number.isFinite(value?.length)) return value.length;
    return null;
}

function normalizePlayerCount(source) {
    const candidate = source.playerCount
        ?? source.numPlayers
        ?? source.participantCount
        ?? collectionSize(source.players)
        ?? 1;
    const count = Number(candidate);
    return Number.isFinite(count) && count > 0 ? Math.max(1, Math.trunc(count)) : 1;
}

function normalizeAspect(source) {
    const explicit = Number(source.aspect ?? source.aspectRatio);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const width = Number(source.viewportWidth ?? source.width ?? source.viewport?.width);
    const height = Number(source.viewportHeight ?? source.height ?? source.viewport?.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        return width / height;
    }
    return DEFAULT_ASPECT;
}

/**
 * Normalize the varied game/runtime shapes used by theme activation into a stable,
 * immutable policy input.
 *
 * @param {object|null|undefined} input
 * @returns {{
 *   override: ('solo'|'duo'|'quad'|'odyssey'|null),
 *   gameMode: string,
 *   playerCount: number,
 *   isOdyssey: boolean,
 *   isLocalMultiplayer: boolean,
 *   isOnlineMultiplayer: boolean,
 *   aspect: number,
 *   narrow: boolean
 * }}
 */
export function normalizeStillwaterLayoutInput(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const override = normalizeLayoutOverride(source.stillwaterLayout);
    const gameMode = normalizeGameMode(
        source.gameMode ?? source.modeId ?? source.mode,
    );
    const isOdyssey = source.isOdyssey === true
        || source.odyssey === true
        || gameMode === 'odyssey';
    const isLocalMultiplayer = source.isLocalMultiplayer === true
        || source.localMultiplayer === true
        || gameMode === 'local-multiplayer';
    const isOnlineMultiplayer = source.isOnlineMultiplayer === true
        || source.onlineMultiplayer === true
        || gameMode === 'online-multiplayer';
    const aspect = normalizeAspect(source);

    return Object.freeze({
        override,
        gameMode,
        playerCount: normalizePlayerCount(source),
        isOdyssey,
        isLocalMultiplayer,
        isOnlineMultiplayer,
        aspect,
        narrow: source.narrow === true
            || (source.narrow !== false && aspect < STILLWATER_NARROW_ASPECT),
    });
}

function chooseLayout(context) {
    if (context.override) return context.override;
    if (context.isOdyssey) return 'odyssey';
    if (context.isLocalMultiplayer) {
        if (context.playerCount === 2) return 'duo';
        if (context.playerCount === 3 || context.playerCount === 4) return 'quad';
        return 'solo';
    }
    if (context.isOnlineMultiplayer) {
        if (context.playerCount === 2) return 'duo';
        if (context.playerCount >= 3) return 'quad';
    }
    return 'solo';
}

/**
 * Resolve immutable camera framing and normalized screen-space board-safe regions.
 *
 * Camera pullback is additive: solo/Odyssey +0, duo +3, quad +7, with another +4
 * for viewports narrower than 1.68.
 *
 * @param {object|null|undefined} input
 * @returns {Readonly<object>}
 */
export function resolveStillwaterLayout(input = {}) {
    const context = normalizeStillwaterLayoutInput(input);
    const layout = chooseLayout(context);
    const layoutPullback = LAYOUT_PULLBACKS[layout];
    const narrowPullback = context.narrow ? 4 : 0;
    const totalPullback = layoutPullback + narrowPullback;

    const camera = Object.freeze({
        position: Object.freeze([0, 14.5, BASE_CAMERA_Z + totalPullback]),
        target: Object.freeze([0, 3.8, -15]),
        fov: context.aspect > 2.05 ? 43 : 46,
        near: 0.1,
        far: 520,
        layoutPullback,
        narrowPullback,
        totalPullback,
    });

    return Object.freeze({
        layout,
        aspect: context.aspect,
        narrow: context.narrow,
        playerCount: context.playerCount,
        camera,
        boardSafeRegions: STILLWATER_BOARD_SAFE_REGIONS[layout],
    });
}
