/* eslint-disable import/no-extraneous-dependencies */
/**
 * Starlight — Reaction Director ↔ theme subsystem bridge.
 *
 * Binds the pure StarlightReactionDirector's abstract `adapters` (subsystem calls)
 * and `resolvers` (board-space origins) to a live StarlightTheme instance. This is
 * the seam that lets the director stay renderer-free and testable while the theme
 * owns the actual Three subsystems.
 *
 * Origin mapping is ported verbatim from the legacy StarlightEmitters so this
 * integration preserves today's on-screen placement exactly: central board actions
 * are shunted to side lanes (they would otherwise hide behind the playfield). The
 * plan's §4.6 board-rect projection — which lets the stellar seal ignite at the
 * piece's TRUE cell centers — is a follow-up that must be verified in real gameplay;
 * until then the `seal` adapter is a no-op and the lock cue stays "First Light"
 * (twinkle-wave + inward tug), identical to the previous behavior.
 */
import { IMPULSE } from './starlight-reaction-director.js';
import { IMPULSE_TYPE } from './impulse-types.js';
import { RING_PRESET } from './shockwave-system.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../../core/constants.js';

// Backdrop world-space mapping (matches the legacy emitters).
const ORIGIN_SPAN_X = 9.0;
const ORIGIN_SPAN_Y = 5.2;
const ORIGIN_Z = -3.5;
const CENTER_CLEAR_X = 3.2;
const SIDE_LANE_MIN_X = 6.6;
const VORTEX_AXIS = { x: 0, y: 0, z: 1 };

// Screen-spread "sky lanes" the classic emitters fanned reactions across so a combo
// fills the WHOLE canopy, not just one spot. The director's _spread() cycles these.
const SKY_LANES = Object.freeze([
    [-8.8, 4.7], [8.7, 4.2], [-8.4, -2.8], [8.5, -3.7],
    [-5.8, 5.1], [5.9, 5.0], [-7.2, 0.6], [7.3, -0.3],
]);

const IMPULSE_MAP = {
    [IMPULSE.ATTRACTOR]: IMPULSE_TYPE.ATTRACTOR,
    [IMPULSE.RADIAL]: IMPULSE_TYPE.RADIAL,
    [IMPULSE.VORTEX]: IMPULSE_TYPE.VORTEX,
};

/** Map a grid cell (col, HIDDEN_ROWS-adjusted row) into visible backdrop world space. */
function cellToWorld(col, row, laneSeed = 0) {
    const safeCol = Number.isFinite(col) ? col : COLS / 2 - 0.5;
    const safeRow = Number.isFinite(row) ? row : ROWS / 2 - 0.5;
    const cx = Math.max(0, Math.min(1, (safeCol + 0.5) / COLS));
    const cy = Math.max(0, Math.min(1, (safeRow + 0.5) / ROWS));
    const rawX = (cx * 2 - 1) * ORIGIN_SPAN_X;
    const y = ((1 - cy) * 2 - 1) * ORIGIN_SPAN_Y;
    let x = rawX;
    if (Math.abs(rawX) < CENTER_CLEAR_X) {
        const fallbackSide = Math.floor(laneSeed) % 2 === 0 ? -1 : 1;
        const side = Math.abs(rawX) > 0.001 ? Math.sign(rawX) : fallbackSide;
        const centerT = 1 - Math.abs(rawX) / CENTER_CLEAR_X;
        x = side * (SIDE_LANE_MIN_X + centerT * 1.2);
    }
    return { x, y, z: ORIGIN_Z };
}

/** Filled cells of a piece as {col, row} (row already offset out of the hidden rows). */
function pieceCells(piece) {
    if (!piece || !Array.isArray(piece.shape)) return [];
    const px = piece.x || 0;
    const py = piece.y || 0;
    const cells = [];
    for (let y = 0; y < piece.shape.length; y += 1) {
        const rowArr = piece.shape[y];
        for (let x = 0; x < rowArr.length; x += 1) {
            if (rowArr[x] > 0) cells.push({ col: px + x, row: py + y - HIDDEN_ROWS });
        }
    }
    return cells;
}

/**
 * Build the { adapters, resolvers } pair for `theme` (a StarlightTheme). Subsystems
 * are read lazily off the theme each call, so a missing one (e.g. stardustSim on the
 * WebGL2 fallback) simply no-ops rather than throwing.
 */
export function createReactionAdapters(theme) {
    let laneSeed = 0;
    const nextSeed = () => { laneSeed = (laneSeed + 1) % 100000; return laneSeed; };

    // Subsystems read origins as plain {x,y,z} (pushImpulse/spawn use .x/.y/.z), so no
    // Three vector is needed here — the module stays pure JS and renderer-free-testable.
    const adapters = {
        // Deferred until board-rect projection lands + is verified in gameplay. Until
        // then the lock cue's dominant beat is the twinkle-wave + inward tug below.
        seal: () => {},
        wave: (origin, opts) => theme.starfield?.triggerWave?.(origin, opts),
        impulse: (origin, strength, kind) => {
            theme.stardustSim?.pushImpulse(origin, strength, VORTEX_AXIS, IMPULSE_MAP[kind] ?? IMPULSE_TYPE.RADIAL);
        },
        ring: (origin, opts) => theme.shockwaves?.spawn(origin, RING_PRESET, opts),
        echo: (origin, opts) => theme.shockwaves?.spawnEcho(origin, opts),
        meteor: (kind, opts) => {
            const m = theme.meteors;
            if (!m) return;
            if (kind === 'fireball') m.spawnFireball();
            else if (kind === 'bright') m.spawnBright();
            else if (kind === 'shower') m.spawnShower(opts?.count ?? 2, 0.55);
            else m.spawnFaint();
        },
        sign: (name, opts) => {
            const c = theme.constellations;
            if (!c) return;
            const n = opts?.count ?? 1;
            if (n > 1 && typeof c.triggerMany === 'function') c.triggerMany(n, name);
            else c.trigger?.(name);
        },
        camera: (kind, amount, extra) => {
            const cam = theme.cameraDirector;
            if (!cam) return;
            if (kind === 'fovPunch') cam.fovPunch(amount);
            else if (kind === 'vertigo') cam.vertigo(amount);
            else if (kind === 'shake') cam.shake?.(amount, extra ?? 120);
            else cam.dolly(amount);
        },
        fx: (field, value) => {
            const fx = theme.fxState;
            if (fx && field in fx) fx[field] = Math.max(fx[field] || 0, value);
        },
        aurora: (strength, ms) => theme.aurora?.surge?.(strength, ms),
    };

    const resolvers = {
        // Shunt the GRID centroid once (matches the legacy emitters). Mapping each cell
        // then averaging would split a center-straddling piece across both side lanes and
        // collapse the centroid back to the middle — the wrong origin.
        lockOrigin: (piece) => {
            const cells = pieceCells(piece);
            if (!cells.length) return cellToWorld(COLS / 2 - 0.5, ROWS / 2 - 0.5, nextSeed());
            const mc = cells.reduce((a, c) => a + c.col, 0) / cells.length;
            const mr = cells.reduce((a, c) => a + c.row, 0) / cells.length;
            return cellToWorld(mc, mr, nextSeed());
        },
        lockCells: (piece) => pieceCells(piece).map((c) => cellToWorld(c.col, c.row, nextSeed())),
        rowsOrigin: (rows) => {
            if (!Array.isArray(rows) || !rows.length) {
                return cellToWorld(COLS / 2 - 0.5, ROWS - 1 - HIDDEN_ROWS, nextSeed());
            }
            const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
            return cellToWorld(COLS / 2 - 0.5, mean - HIDDEN_ROWS, nextSeed());
        },
        rowOrigins: (rows) => (rows || []).map((r) => cellToWorld(COLS / 2 - 0.5, r - HIDDEN_ROWS, nextSeed())),
        // A screen-spread sky lane, cycled by index — the classic full-canopy fan-out.
        skyLane: (index) => {
            const lane = SKY_LANES[((index % SKY_LANES.length) + SKY_LANES.length) % SKY_LANES.length];
            return { x: lane[0], y: lane[1], z: ORIGIN_Z - 0.4 };
        },
    };

    return { adapters, resolvers };
}
