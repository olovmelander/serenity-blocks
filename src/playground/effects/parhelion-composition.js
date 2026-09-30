/**
 * Parhelion composition: the three-free frame math every Parhelion surface shares.
 *
 * The theme hides the sun behind the Vigil Stone at screen centre and hangs the 22° halo,
 * both sundogs and the hound pillars around the live board card. Every placement below is
 * derived from ONE rest camera, (0, 25, 0) pitched up to the sun's elevation, so the dome
 * shader, the stone solver, the mote spawns and the unit tests agree on where things land.
 *
 * Conventions:
 * - Screen fractions are y-down, (0, 0) top-left: the DOM's space.
 * - Rects are `{ x0, y0, x1, y1 }` screen fractions (the calm-rect vec4 order).
 * - Vectors are plain `{ x, y, z }`; a THREE.Vector3 works as an `out` target.
 * - Helpers that can run per frame take an `out` and allocate nothing. The stone solver runs
 *   on setLayout() only (resize, mode start, the delayed rect re-reads), never per frame.
 *
 * No DOM, GPU or three import: unit tests import this module in Node.
 */

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// Frame constants (§2.2)
// ---------------------------------------------------------------------------------------

/** Sun elevation E (rad). The rest camera pitches to it, so the look direction IS the sun. */
export const E = 9.5 * DEG;
const SIN_E = Math.sin(E);
const COS_E = Math.cos(E);

/**
 * Vertical field of view (deg), fixed at every aspect. Tunable 45–47 in this module only
 * (risk 4). 46 needs no tuning: the right sundog's core clears the HUD glass at all six
 * measured viewports, tightest at 1366×768 (7.6 px at rest, 4 px at worst breathing).
 */
export const VFOV_DEG = 46;
export const TAN_V = Math.tan((VFOV_DEG * DEG) / 2);
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 12000;

/** Rest camera position (m). There is no pointer parallax: it would slide the stone against the card. */
export const CAM_REST = Object.freeze({ x: 0, y: 25, z: 0 });

/** Rest camera basis: S = look direction = sun, R = right, U = up (R = S × U). */
export const S = Object.freeze({ x: 0, y: SIN_E, z: -COS_E });
export const R = Object.freeze({ x: 1, y: 0, z: 0 });
export const U = Object.freeze({ x: 0, y: COS_E, z: SIN_E });

/** 22° halo radius (rad). */
export const R22 = 22 * DEG;
export const TAN_R22 = Math.tan(R22);
const COS_R22 = Math.cos(R22);
const SIN_R22 = Math.sin(R22);

/** Ice refractive index and the Bravais effective index for plate crystals at elevation E. */
export const ICE_N = 1.31;
export const ICE_N_EFF = Math.sqrt(ICE_N * ICE_N - SIN_E * SIN_E) / COS_E;

/**
 * Sundog azimuth (rad, 22.414°): the minimum deviation of a 60° prism at the effective index,
 * `2·asin(n'/2) − 60°` with n' = 1.31763. Kept as the spec literal so every shader agrees.
 */
export const DOG_AZ = 0.391197;

/** Reaction motes live on a plane this far in front of the rest camera (m, along S). */
export const MOTE_PLANE_DEPTH = 55;

/**
 * Camera breathing (§2.5): amplitudes (rad, m) and periods (s). Rotation-dominant, and the
 * stone solver's margin absorbs the worst case. Reduced motion scales it by 0.3.
 */
export const BREATHING = Object.freeze({
    YAW: 0.20 * DEG,
    YAW_PERIOD: 47,
    PITCH: 0.15 * DEG,
    PITCH_PERIOD: 61,
    X: 0.4,
    X_PERIOD: 37,
    Y: 0.3,
    Y_PERIOD: 53,
    REDUCED_MOTION_SCALE: 0.3,
});

/**
 * Breathing pose at time `t` (s), allocation-free. Apply with rotation order 'YXZ':
 * `camera.position = CAM_REST + (x, y, 0)`, `rotation.y = yaw` (three's sign: positive turns
 * left), `rotation.x = E + pitch`. Fixed phase offsets keep the four sines from aligning.
 * @param {number} t seconds (the integrated, seekable clock)
 * @param {number} scale 1, or BREATHING.REDUCED_MOTION_SCALE
 * @param {{yaw:number,pitch:number,x:number,y:number}} out
 */
export function breathingPose(t, scale, out) {
    out.yaw = BREATHING.YAW * scale * Math.sin((TWO_PI * t) / BREATHING.YAW_PERIOD);
    out.pitch = BREATHING.PITCH * scale * Math.sin((TWO_PI * t) / BREATHING.PITCH_PERIOD + 1.3);
    out.x = BREATHING.X * scale * Math.sin((TWO_PI * t) / BREATHING.X_PERIOD + 2.1);
    out.y = BREATHING.Y * scale * Math.sin((TWO_PI * t) / BREATHING.Y_PERIOD + 0.7);
    return out;
}

/** Ring stations: 12 clock positions, station 0 at the top, clockwise. */
export const STATION_COUNT = 12;

/** Outer pillar lane: `az = ±min(OUTER_LANE_MAX_AZ, atan(OUTER_LANE_FILL · tanH))`. */
export const OUTER_LANE_MAX_AZ = 30 * DEG;
export const OUTER_LANE_FILL = 0.86;

/**
 * Hound pillars (§5.6): ground distance, quad width and height (m). Lanes 0/1 are the
 * left/right dogs, 2/3 the left/right outer lanes, 4/5 echo spares beside the dogs, pushed
 * SPARE_OFFSET metres outward (away from the card).
 */
export const PILLAR = Object.freeze({
    COUNT: 6,
    DIST: 180,
    WIDTH: 3.2,
    HEIGHT: 260,
    SPARE_OFFSET: 1.5,
});

/**
 * Vigil Stone constants (§2.4, §5.1). Unit space is the authored mesh before the solver's
 * `stone.scale.set(sx, sy, sx · DEPTH_SCALE)`: the core radius is 1, the base sits at y 0.
 * The lean is an OBJECT rotation (`stone.rotation.z = -LEAN`, top leans right), applied
 * after the scale, so the solver can account for it in world metres.
 */
export const STONE = Object.freeze({
    /** Slab centre z (m). The front face sits DEPTH_SCALE · sx nearer (≈ −117 at the default). */
    Z: -124,
    DEPTH_SCALE: 0.28,
    LEAN: 0.035,
    /**
     * Unit height of the shoulder: the top of the profile bands, above which the rounded crown
     * (parhelion-geometry.js STONE_LATHE) narrows quickly.
     */
    UNIT_SHOULDER: 0.93,
    /**
     * Unit height (highest vertex, jitter included) and x of the crown peak: the slanted crown
     * stands highest on the windward (left) shoulder.
     */
    UNIT_CROWN: 1.071,
    UNIT_CROWN_X: -0.345,
    /**
     * Default world dims: sx is the core half-width (m); sy scales unit height to metres, so the
     * default shoulder is 80 m and the crown peak ≈ 92 m — under the crown cap at 16:9.
     */
    DEFAULT_SX: 25.5,
    DEFAULT_SY: 80 / 0.93,
    /** Solver clamps relative to the defaults, widened for short windows (addendum item 3). */
    SCALE_MIN: 0.7,
    SCALE_MAX: 1.6,
    /** Solver margin (deg): 1.0° coverage + 0.5° for breathing and shake. */
    MARGIN_DEG: 1.5,
    /** Height bands of the inner-silhouette profile. */
    BANDS: 12,
    /** An off-centre card (|centre − 0.5| beyond this) is never stone-backed. */
    CENTRE_TOLERANCE: 0.04,
});

/**
 * Default inner-silhouette profile: for each of STONE.BANDS equal bands of unit height
 * [0, UNIT_SHOULDER], the MINIMUM over the band of min(left, right) silhouette half-width of
 * the un-leaned unit stone, normalised so the core radius is 1. Measured from the real mesh by
 * parhelion-geometry.js measureStoneProfile() for the default seed (a unit test keeps the two
 * equal): outward-only jitter keeps the body >= 0.99; the two top bands are the rounded
 * shoulder, narrowed on the right by the asymmetric crown.
 */
export const DEFAULT_STONE_PROFILE = new Float32Array([
    1.114, 1.125, 1.093, 1.082, 1.069, 1.034,
    1.001, 0.995, 0.990, 0.991, 0.878, 0.802,
]);

/**
 * Crown cap (design rule, binding at every aspect): the stone's crown top stays at or below
 * this screen y (y-down), so the ring top (y ~ 0.024), the upper tangent arc and the crown of
 * light always stay visible above the stone. Where the card reaches higher than the capped
 * stone, the card's top sits over the dusky lens instead (the card is near-opaque dark glass).
 */
export const CROWN_CAP_Y = 0.085;
/** Screen-y allowance for breathing (pitch +-0.15 deg, y +-0.3 m) so the cap holds at the extremes. */
export const CROWN_CAP_MARGIN = 0.006;

// ---------------------------------------------------------------------------------------
// Measured layouts (§15 addendum, real game, single player). y-down screen fractions.
// ---------------------------------------------------------------------------------------

function rect(x0, y0, x1, y1) {
    return Object.freeze({
        x0, y0, x1, y1,
    });
}

function viewport(width, height, card, board, next, hud) {
    return Object.freeze({
        width,
        height,
        aspect: width / height,
        card,
        board,
        next,
        hud,
    });
}

/**
 * Step-0 DOM rects at the six measured viewports. `card` is `.single-player-card` (the
 * stone target), `board` the board canvas (row mapping, spawn exclusion), `next` the
 * next-queue and `hud` `.single-player-stats-bar`.
 */
export const MEASURED_VIEWPORTS = Object.freeze([
    viewport(
        1920,
        1080,
        rect(0.4089, 0.1542, 0.5911, 0.8597),
        rect(0.4234, 0.2819, 0.5797, 0.8375),
        rect(0.4219, 0.1884, 0.5781, 0.2718),
        rect(0.6354, 0.3205, 0.7083, 0.6795),
    ),
    viewport(
        1680,
        1050,
        rect(0.3958, 0.1443, 0.6042, 0.8700),
        rect(0.4125, 0.2757, 0.5911, 0.8471),
        rect(0.4107, 0.1795, 0.5893, 0.2652),
        rect(0.6548, 0.3153, 0.7381, 0.6847),
    ),
    viewport(
        2560,
        1080,
        rect(0.4316, 0.1542, 0.5684, 0.8597),
        rect(0.4426, 0.2819, 0.5598, 0.8375),
        rect(0.4414, 0.1884, 0.5586, 0.2718),
        rect(0.6016, 0.3205, 0.6563, 0.6795),
    ),
    viewport(
        1584,
        787,
        rect(0.3995, 0.0654, 0.6005, 0.9536),
        rect(0.4171, 0.2408, 0.5866, 0.9231),
        rect(0.4152, 0.1125, 0.5848, 0.2268),
        rect(0.6305, 0.2536, 0.7189, 0.7464),
    ),
    viewport(
        1366,
        768,
        rect(0.3869, 0.0671, 0.6131, 0.9525),
        rect(0.4074, 0.2467, 0.5970, 0.9212),
        rect(0.4052, 0.1152, 0.5948, 0.2324),
        rect(0.6479, 0.2475, 0.7504, 0.7525),
    ),
    viewport(
        1280,
        800,
        rect(0.3730, 0.0644, 0.6270, 0.9544),
        rect(0.3949, 0.2369, 0.6098, 0.9244),
        rect(0.3926, 0.1106, 0.6074, 0.2231),
        rect(0.6641, 0.2576, 0.7734, 0.7424),
    ),
]);

/** Default solo layout (16:9): the card is the stone and calm target (addendum item 1). */
export const DEFAULT_LAYOUT = MEASURED_VIEWPORTS[0];

/** Calm rect when a non-Serenity mode has no board canvas (§6). */
export const FALLBACK_RECT = rect(0.36, 0.08, 0.64, 0.94);

/** Card fallback when `.single-player-card` is absent: the board canvas expanded (addendum item 1). */
export const CARD_FROM_BOARD_PAD = Object.freeze({
    x: 0.015,
    top: 0.12,
    bottom: 0.02,
});

/**
 * Expands a board canvas rect into the card rect it sits in (used when the card is absent).
 * @param {{x0:number,y0:number,x1:number,y1:number}} board
 * @param {{x0:number,y0:number,x1:number,y1:number}} out
 */
export function cardFromBoard(board, out) {
    out.x0 = Math.max(0, board.x0 - CARD_FROM_BOARD_PAD.x);
    out.y0 = Math.max(0, board.y0 - CARD_FROM_BOARD_PAD.top);
    out.x1 = Math.min(1, board.x1 + CARD_FROM_BOARD_PAD.x);
    out.y1 = Math.min(1, board.y1 + CARD_FROM_BOARD_PAD.bottom);
    return out;
}

// ---------------------------------------------------------------------------------------
// Projection (rest-camera pinhole)
// ---------------------------------------------------------------------------------------

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/** tan of the horizontal half-FOV at `aspect` (width / height). */
export function tanH(aspect) {
    return TAN_V * aspect;
}

/** Angle subtended by one pixel at screen centre (rad/px) for a drawing buffer `heightPx` tall. */
export function pixelAngle(heightPx) {
    return (2 * TAN_V) / Math.max(1, heightPx);
}

/**
 * Projects a world-space direction through the rest camera.
 * @param {{x:number,y:number,z:number}} dir any length
 * @param {number} aspect width / height
 * @param {{x:number,y:number,depth:number}} [out] reused result
 * @returns `out`: `x`, `y` screen fractions (y-down); `depth` the component along S
 *   (≤ 0 means behind the camera, and x/y are then meaningless).
 */
export function dirToScreen(dir, aspect, out = { x: 0, y: 0, depth: 0 }) {
    const cz = dir.x * S.x + dir.y * S.y + dir.z * S.z;
    const cx = dir.x;
    const cy = dir.x * U.x + dir.y * U.y + dir.z * U.z;
    out.depth = cz;
    if (cz <= 1e-9) {
        out.x = 0.5;
        out.y = 0.5;
        return out;
    }
    out.x = 0.5 + (0.5 * cx) / (cz * TAN_V * aspect);
    out.y = 0.5 - (0.5 * cy) / (cz * TAN_V);
    return out;
}

/**
 * Pinhole helper: projects a WORLD point through the rest camera at CAM_REST.
 * @returns `out` as in dirToScreen(); `depth` is metres along S.
 */
export function projectWorld(point, aspect, out = { x: 0, y: 0, depth: 0 }) {
    const dx = point.x - CAM_REST.x;
    const dy = point.y - CAM_REST.y;
    const dz = point.z - CAM_REST.z;
    const cz = dy * S.y + dz * S.z;
    const cy = dy * U.y + dz * U.z;
    out.depth = cz;
    if (cz <= 1e-9) {
        out.x = 0.5;
        out.y = 0.5;
        return out;
    }
    out.x = 0.5 + (0.5 * dx) / (cz * TAN_V * aspect);
    out.y = 0.5 - (0.5 * cy) / (cz * TAN_V);
    return out;
}

/**
 * Un-projects a screen fraction into a unit world direction through the rest camera.
 * @param {number} sx screen x fraction
 * @param {number} sy screen y fraction (y-down)
 * @param {number} aspect width / height
 * @param {{x:number,y:number,z:number}} out reused result
 */
export function screenToDir(sx, sy, aspect, out) {
    const tx = (sx * 2 - 1) * TAN_V * aspect;
    const ty = (1 - sy * 2) * TAN_V;
    const x = S.x + tx * R.x + ty * U.x;
    const y = S.y + tx * R.y + ty * U.y;
    const z = S.z + tx * R.z + ty * U.z;
    const inv = 1 / Math.sqrt(x * x + y * y + z * z);
    out.x = x * inv;
    out.y = y * inv;
    out.z = z * inv;
    return out;
}

/**
 * World point on the plane `depth` metres in front of the rest camera (along S) that
 * projects to screen (sx, sy): `camRest + depth · (S + ndcX·tanH·R + ndcY·tanV·U)`.
 * Closed form, no Raycaster.
 */
export function screenToWorld(sx, sy, aspect, depth, out) {
    const tx = (sx * 2 - 1) * TAN_V * aspect;
    const ty = (1 - sy * 2) * TAN_V;
    out.x = CAM_REST.x + depth * (S.x + tx * R.x + ty * U.x);
    out.y = CAM_REST.y + depth * (S.y + tx * R.y + ty * U.y);
    out.z = CAM_REST.z + depth * (S.z + tx * R.z + ty * U.z);
    return out;
}

/** screenToWorld() on the reaction-mote plane (55 m): the origin of every burst (§5.5). */
export function screenToWorld55(sx, sy, aspect, out) {
    return screenToWorld(sx, sy, aspect, MOTE_PLANE_DEPTH, out);
}

// ---------------------------------------------------------------------------------------
// Ring, rows, stations, lanes (§7.3)
// ---------------------------------------------------------------------------------------

/**
 * Unit direction of the 22° ring at angle φ: `cos R22·S + sin R22·(cos φ·R + sin φ·U)`.
 * φ = 0 is the right side at the sun's height, π/2 the top; the left side is π − φ.
 */
export function ringDir(phi, out) {
    const c = SIN_R22 * Math.cos(phi);
    const s = SIN_R22 * Math.sin(phi);
    out.x = COS_R22 * S.x + c * R.x + s * U.x;
    out.y = COS_R22 * S.y + c * R.y + s * U.y;
    out.z = COS_R22 * S.z + c * R.z + s * U.z;
    return out;
}

/**
 * World point of the ring at angle φ on the plane `depth` metres in front of the rest camera
 * (the same plane screenToWorld() uses, so ring motes and screen-placed motes are coplanar).
 */
export function ringPoint(phi, depth, out) {
    ringDir(phi, out);
    const k = depth / COS_R22;
    out.x = CAM_REST.x + out.x * k;
    out.y = CAM_REST.y + out.y * k;
    out.z = CAM_REST.z + out.z * k;
    return out;
}

/**
 * Board row → right-side ring angle φ0 whose ring point projects at that row's screen
 * height (left side: π − φ0). `rowV` is 0 at the board's top row, 1 at its bottom; the
 * rect is the BOARD CANVAS rect (addendum item 1). Rows above/below the ring clamp to ±π/2.
 */
export function rowToPhi(rowV, boardRect) {
    const y = boardRect.y0 + rowV * (boardRect.y1 - boardRect.y0);
    return Math.asin(clamp(((0.5 - y) * 2 * TAN_V) / TAN_R22, -1, 1));
}

/** Screen height (fraction, y-down) of the ring point at angle φ; the inverse of rowToPhi(). */
export function phiToScreenY(phi) {
    return 0.5 - (TAN_R22 * Math.sin(phi)) / (2 * TAN_V);
}

/**
 * Station k's ring angle: `π/2 − k·π/6` (clockwise from the top), wrapped to (−π, π].
 * Stations whose ring point is below the horizon (φ ≈ −154°…−26°) show as dust glitter only.
 */
export function stationPhi(k) {
    const idx = ((Math.floor(k) % STATION_COUNT) + STATION_COUNT) % STATION_COUNT;
    const phi = HALF_PI - (idx * TWO_PI) / STATION_COUNT;
    return phi <= -Math.PI ? phi + TWO_PI : phi;
}

/**
 * Side-lane anchors (Bluehour formula) for a rect: `xL = x0·0.45`, `xR = x1 + 0.55·(1 − x1)`,
 * both clamped to [0.03, 0.97]. A lock with lockU < 0.5 uses the left lane.
 */
export function laneAnchors(r, out = { xL: 0, xR: 0 }) {
    out.xL = clamp(r.x0 * 0.45, 0.03, 0.97);
    out.xR = clamp(r.x1 + 0.55 * (1 - r.x1), 0.03, 0.97);
    return out;
}

/** Outer pillar lane azimuth magnitude (rad): `min(30°, atan(0.86·tanH))`. */
export function outerLaneAz(aspect) {
    return Math.min(OUTER_LANE_MAX_AZ, Math.atan(OUTER_LANE_FILL * tanH(aspect)));
}

/**
 * Writes the six pillar placements as `uPillarPlace` vec4s (worldX, worldZ, width, height).
 * @param {number} aspect
 * @param {Float32Array|number[]} out length ≥ PILLAR.COUNT · 4
 */
export function writePillarPlaces(aspect, out) {
    const outer = outerLaneAz(aspect);
    const dogX = PILLAR.DIST * Math.sin(DOG_AZ);
    const dogZ = -PILLAR.DIST * Math.cos(DOG_AZ);
    const outerX = PILLAR.DIST * Math.sin(outer);
    const outerZ = -PILLAR.DIST * Math.cos(outer);
    const spareX = PILLAR.SPARE_OFFSET * Math.cos(DOG_AZ);
    const spareZ = PILLAR.SPARE_OFFSET * Math.sin(DOG_AZ);
    for (let lane = 0; lane < PILLAR.COUNT; lane++) {
        const side = (lane & 1) === 0 ? -1 : 1;
        let x = dogX;
        let z = dogZ;
        if (lane === 2 || lane === 3) {
            x = outerX;
            z = outerZ;
        } else if (lane >= 4) {
            // Outward along the dog lane's tangent (d/daz), so an echo never steps toward the card.
            x = dogX + spareX;
            z = dogZ + spareZ;
        }
        const o = lane * 4;
        out[o] = side * x;
        out[o + 1] = z;
        out[o + 2] = PILLAR.WIDTH;
        out[o + 3] = PILLAR.HEIGHT;
    }
    return out;
}

// ---------------------------------------------------------------------------------------
// Vigil Stone solver (§2.4)
// ---------------------------------------------------------------------------------------

const SIN_LEAN = Math.sin(STONE.LEAN);
const COS_LEAN = Math.cos(STONE.LEAN);

/** Card boundary samples per edge used by the solver (corners included). */
const SOLVE_EDGE_SAMPLES = 9;

// Solver scratch (setLayout-time only, but kept static anyway).
const solveRay = {
    az: 0, el: 0, dx: 0, dy: 0, dz: 0,
};

function profileAt(profile, bandUnit) {
    const bands = STONE.BANDS;
    const b = clamp(Math.floor(bandUnit * bands), 0, bands - 1);
    // The ray crosses the slab over a few metres of height: take the neighbouring bands too.
    let p = profile[b];
    if (b > 0) p = Math.min(p, profile[b - 1]);
    if (b < bands - 1) p = Math.min(p, profile[b + 1]);
    return p;
}

function marginedRay(sx, sy, aspect, ox, oy, margin, out) {
    const tx = (sx * 2 - 1) * TAN_V * aspect;
    const ty = (1 - sy * 2) * TAN_V;
    const x = S.x + tx * R.x + ty * U.x;
    const y = S.y + tx * R.y + ty * U.y;
    const z = S.z + tx * R.z + ty * U.z;
    const el = Math.atan2(y, Math.sqrt(x * x + z * z)) + oy * margin;
    const az = Math.atan2(x, -z) + (ox * margin) / Math.cos(el);
    out.el = el;
    out.az = az;
    out.dx = Math.cos(el) * Math.sin(az);
    out.dy = Math.sin(el);
    out.dz = -Math.cos(el) * Math.cos(az);
    return out;
}

/**
 * Height (stone-local, metres) at which a ray from the rest camera enters the front of the
 * elliptic slab of half-width `a` / half-depth `b`, or +Infinity when it misses.
 */
function slabEntryLocalY(ray, a, b) {
    // Ray origin and direction in stone-local space: translate to the slab centre, un-lean.
    const px = CAM_REST.x;
    const py = CAM_REST.y;
    const ox = px * COS_LEAN - py * SIN_LEAN;
    const oy = px * SIN_LEAN + py * COS_LEAN;
    const oz = CAM_REST.z - STONE.Z;
    const dx = ray.dx * COS_LEAN - ray.dy * SIN_LEAN;
    const dy = ray.dx * SIN_LEAN + ray.dy * COS_LEAN;
    const { dz } = ray;
    const ia = 1 / (a * a);
    const ib = 1 / (b * b);
    const qa = dx * dx * ia + dz * dz * ib;
    const qb = 2 * (ox * dx * ia + oz * dz * ib);
    const qc = ox * ox * ia + oz * oz * ib - 1;
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0 || qa <= 0) return Infinity;
    const t = (-qb - Math.sqrt(disc)) / (2 * qa);
    return oy + t * dy;
}

function createSolveResult() {
    return {
        sx: STONE.DEFAULT_SX,
        sy: STONE.DEFAULT_SY,
        coreHalfWidth: STONE.DEFAULT_SX,
        shoulderH: STONE.DEFAULT_SY * STONE.UNIT_SHOULDER,
        crownH: STONE.DEFAULT_SY * STONE.UNIT_CROWN,
        stoneHW: [0, 0, 0, 0],
        requiredSx: 0,
        requiredSy: 0,
        capSy: 0,
        capped: false,
        crownY: 0,
        shoulderY: 0,
        backed: false,
    };
}

/**
 * Screen y (rest camera) of a stone point given in unit space (x, y) on the slab-centre plane,
 * after the solver's scale and the object lean about the base.
 */
function stonePointScreenY(sx, sy, unitX, unitY) {
    const x = unitX * sx;
    const y = unitY * sy;
    const wy = -x * SIN_LEAN + y * COS_LEAN;
    const dy = wy - CAM_REST.y;
    const dz = STONE.Z - CAM_REST.z;
    const cy = dy * U.y + dz * U.z;
    const cz = dy * S.y + dz * S.z;
    return 0.5 - (0.5 * cy) / (cz * TAN_V);
}

/** The largest sy whose crown peak projects at screen y >= capY through the rest camera. */
function crownCapSy(sx, capY) {
    const k = (0.5 - capY) * 2 * TAN_V;
    const dz = STONE.Z - CAM_REST.z;
    const worldY = CAM_REST.y + (dz * (k * S.z - U.z)) / (U.y - k * S.y);
    // Leaned peak height: wy = -x*sinL + y*cosL with x = UNIT_CROWN_X*sx.
    return (worldY + STONE.UNIT_CROWN_X * sx * SIN_LEAN) / (STONE.UNIT_CROWN * COS_LEAN);
}

function writeSolveResult(out, sx, sy, profile) {
    out.sx = sx;
    out.sy = sy;
    out.coreHalfWidth = sx;
    out.shoulderH = sy * STONE.UNIT_SHOULDER;
    out.crownH = sy * STONE.UNIT_CROWN;
    out.crownY = stonePointScreenY(sx, sy, STONE.UNIT_CROWN_X, STONE.UNIT_CROWN);
    out.shoulderY = stonePointScreenY(sx, sy, 0, STONE.UNIT_SHOULDER);
    const hw = out.stoneHW;
    const mid = STONE.BANDS >> 1;
    hw[0] = sx * profile[0];
    hw[1] = sx * 0.5 * (profile[mid - 1] + profile[mid]);
    hw[2] = sx * profile[STONE.BANDS - 1];
    hw[3] = out.shoulderH;
    return out;
}

/**
 * Fits the Vigil Stone to a board card (§2.4 + the crown-cap rule). Samples the card boundary
 * (corners, edges), pushes each sample outward by the margin (sides horizontally, top edge up,
 * top corners both; the base is buried in the snow so the bottom only needs width), then:
 * - shoulder: sy so every margined top-edge ray enters the slab front below the shoulder
 *   (UNIT_SHOULDER · sy) — but CAPPED so the crown peak projects at screen y ≥ CROWN_CAP_Y
 *   (+ the breathing allowance). A capped stone leaves the card's top over the dusky lens;
 * - half-width: every margined side ray that meets the slab-centre plane at or below the
 *   (possibly capped) shoulder lies inside the leaned silhouette of its band (profile · sx).
 *
 * `sx = max(required half-width / profile)`, `sy = min(required shoulder / UNIT_SHOULDER,
 * cap)`, each clamped to [SCALE_MIN, SCALE_MAX]× the default. `backed` means the card is
 * covered horizontally and the sun hidden; `capped` that its top is NOT fully covered. A card
 * that needs more than SCALE_MAX horizontally, or sits off-centre, is NOT stone-backed: the
 * default stone is returned with `backed: false` and the output dims/desaturates that rect.
 *
 * Apply as `stone.scale.set(sx, sy, sx · STONE.DEPTH_SCALE)` with the stone at (0, 0, STONE.Z)
 * and `rotation.z = -STONE.LEAN`; `stoneHW` feeds `uStoneHW` (baseHW, midHW, topHW, shoulderH).
 *
 * @param {object} [options]
 * @param {{x0:number,y0:number,x1:number,y1:number}|null} [options.card] card rect (y-down)
 * @param {number} [options.aspect] width / height
 * @param {ArrayLike<number>} [options.profile] STONE.BANDS inner half-widths (unit core = 1)
 * @param {number} [options.marginDeg] coverage margin in degrees of arc
 * @param {number} [options.capY] crown cap screen y (default CROWN_CAP_Y)
 * @param {object} [out] reused result (from a previous solveStone call)
 */
export function solveStone({
    card = DEFAULT_LAYOUT.card,
    aspect = DEFAULT_LAYOUT.aspect,
    profile = DEFAULT_STONE_PROFILE,
    marginDeg = STONE.MARGIN_DEG,
    capY = CROWN_CAP_Y,
} = {}, out = createSolveResult()) {
    const minSx = STONE.DEFAULT_SX * STONE.SCALE_MIN;
    const maxSx = STONE.DEFAULT_SX * STONE.SCALE_MAX;
    const minSy = STONE.DEFAULT_SY * STONE.SCALE_MIN;
    const maxSy = STONE.DEFAULT_SY * STONE.SCALE_MAX;
    out.requiredSx = 0;
    out.requiredSy = 0;
    out.capSy = 0;
    out.capped = false;
    out.backed = false;
    if (!card || !(card.x1 > card.x0) || !(card.y1 > card.y0) || !(aspect > 0)) {
        return writeSolveResult(out, STONE.DEFAULT_SX, STONE.DEFAULT_SY, profile);
    }
    const margin = marginDeg * DEG;
    const bandTop = STONE.UNIT_SHOULDER;
    const topBand = profile[STONE.BANDS - 1];
    let sx = STONE.DEFAULT_SX;
    let sy = STONE.DEFAULT_SY;
    let reqSx = 0;
    let reqTop = 0;
    let syCap = Infinity;
    // sx depends on sy through the band lookup (and the capped shoulder), the shoulder and the
    // cap on sx through the slab depth and the leaned peak: weak coupling, three passes.
    for (let pass = 0; pass < 3; pass++) {
        // Vertical: the card top (+ margin) under the shoulder, capped by the crown rule.
        reqTop = 0;
        const a = sx * topBand;
        const b = sx * topBand * STONE.DEPTH_SCALE;
        for (let i = 0; i < SOLVE_EDGE_SAMPLES; i++) {
            const f = i / (SOLVE_EDGE_SAMPLES - 1);
            const ox = (i === 0 ? -1 : 0) + (i === SOLVE_EDGE_SAMPLES - 1 ? 1 : 0);
            const ray = marginedRay(card.x0 + f * (card.x1 - card.x0), card.y0, aspect, ox, 1, margin, solveRay);
            let entry = slabEntryLocalY(ray, a, b);
            if (!Number.isFinite(entry)) {
                // Misses the top band's slab: fall back to the slab-centre plane (conservative).
                const t = (CAM_REST.z - STONE.Z) / -ray.dz;
                entry = CAM_REST.y + ray.dy * t;
            }
            reqTop = Math.max(reqTop, entry);
        }
        syCap = crownCapSy(sx, capY + CROWN_CAP_MARGIN);
        sy = clamp(Math.min(reqTop / bandTop, syCap), minSy, maxSy);

        // Horizontal: every side / top-corner sample; above a capped shoulder the card sits over
        // the lens, but its side columns still demand the top band's width (no gap under it).
        reqSx = 0;
        const shoulderUnit = sy * bandTop;
        for (let edge = 0; edge < 3; edge++) {
            for (let i = 0; i < SOLVE_EDGE_SAMPLES; i++) {
                const f = i / (SOLVE_EDGE_SAMPLES - 1);
                let px;
                let py;
                let ox;
                let oy;
                if (edge === 2) {
                    // Top edge, pushed up; its corners are pushed outward as well.
                    px = card.x0 + f * (card.x1 - card.x0);
                    py = card.y0;
                    ox = (i === 0 ? -1 : 0) + (i === SOLVE_EDGE_SAMPLES - 1 ? 1 : 0);
                    oy = 1;
                } else {
                    // Side edges top → bottom, pushed outward; the top corner also up.
                    px = edge === 0 ? card.x0 : card.x1;
                    py = card.y0 + f * (card.y1 - card.y0);
                    ox = edge === 0 ? -1 : 1;
                    oy = i === 0 ? 1 : 0;
                }
                const ray = marginedRay(px, py, aspect, ox, oy, margin, solveRay);
                // Half-width at the slab-centre plane, in the un-leaned local frame.
                const t = (CAM_REST.z - STONE.Z) / -ray.dz;
                const wx = CAM_REST.x + ray.dx * t;
                const wy = CAM_REST.y + ray.dy * t;
                const lx = wx * COS_LEAN - wy * SIN_LEAN;
                const ly = wx * SIN_LEAN + wy * COS_LEAN;
                const p = profileAt(profile, Math.max(0, ly) / shoulderUnit);
                reqSx = Math.max(reqSx, Math.abs(lx) / p);
            }
        }
        sx = clamp(reqSx, minSx, maxSx);
    }
    out.requiredSx = reqSx;
    out.requiredSy = reqTop / bandTop;
    out.capSy = syCap;
    out.capped = out.requiredSy > sy + 1e-6;
    const centre = 0.5 * (card.x0 + card.x1);
    out.backed = reqSx <= maxSx
        && (out.capped || out.requiredSy <= maxSy)
        && Math.abs(centre - 0.5) <= STONE.CENTRE_TOLERANCE;
    if (!out.backed) {
        writeSolveResult(out, STONE.DEFAULT_SX, STONE.DEFAULT_SY, profile);
        out.capped = false;
        return out;
    }
    return writeSolveResult(out, sx, sy, profile);
}
