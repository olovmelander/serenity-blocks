/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the board's flowers: the night blooms a lock opens in the beds and on the
 * canal, and the Queen of the Night, the four lines' set piece.
 *
 * THE BLOOMS. Where a lock's seed of light comes down, a flower opens in the piece's colour.
 *   In a bed: a night-blooming flower on a short stem with two leaves, that sprouts from the
 *   soil the moment the seed lands, holds a furled bud a breath, and unfurls it: the petals
 *   untwist from their spiral and spring open into a cupped star, a trumpet like a moonflower's,
 *   then settle with a little bounce, a band of light running out along them as they go. The
 *   head nods toward the eye (it is a flower even when it is a few pixels across), sways in the
 *   house's air, in the gusts and in a T-spin's turn. Its petals are translucent and glow from
 *   within: brightest in the throat, where they are whitened by the heat of the heart, their
 *   colour deepening out toward the tips, the midrib, the veins and the thin margins catching
 *   more light, the outside of the cup lit through; a few fine stamens glow in the throat. Its
 *   heart is a point of light (scene-linear 4.5, so it blooms) in a soft halo, and it lights the
 *   garden round it: lights() hands the world one light a bloom, which every surface adds up.
 *   The beds' fronts are fringed with ferns, so a bloom stands at the front of its bed (slid
 *   along the eye's line to it, which keeps its place on the screen) and its head is drawn a
 *   few metres nearer the eye along each point's own line of sight: the same picture, but the
 *   flower looks out through the leaves in front of it instead of being lost behind them.
 *   On the canal: a water lily in the piece's colour on its own little pad. The pad slaps down
 *   with the seed and bobs as the ring runs out (the world rings the water), the lily opens
 *   in two whorls of pointed petals over it, and its heart, a little above the water, is the
 *   light the water's mirror draws its image from.
 *   A hard drop opens its flower larger and faster; a landing flares (a burst of light and six
 *   soft rays in the piece's colour), and in a chain the hearts flash with the fireflies' beat
 *   and their haloes widen.
 *   When a clear releases a bloom (the world sends its pollen up through the beams) the petals
 *   fold back into a bud, the flower withers into the soil (the lily sinks) and its light goes.
 *
 * Instancing: one InstancedMesh per kind (the bed flower, the water lily) and one of camera-facing
 * quads for the hearts' glow, all reading one pool of slots from two InstancedInterleavedBuffers:
 *   static   aBloomPos (x, y, z, size)        aBloomSeed (seed, kind, 0, 0)
 *   dynamic  aBloomTint (r, g, b, hard)        aBloomTime (opens at, closes at, 0, 0)
 * so each draw binds four vertex buffers (position, aPart and the two). Every vertex is a point
 * of a parametric sheet (s along, c across, which petal) and the vertex shader builds the whole
 * flower from the slot's numbers and the clock, in closed form: opening and closing are curves of
 * U.time, nothing is animated on the CPU. A slot with no flower has size 0 and collapses to a
 * point (every pool is always drawn, so the first frame compiles every pipeline).
 *
 * THE QUEEN OF THE NIGHT (Epiphyllum oxypetalum), the four lines' set piece: a giant luminous
 * flower that opens behind the card, so the card sits at her heart and her long petals reach
 * out round it on every side. She stands on the camera's resting central ray, her face turned a
 * little from the eye (a 3/4 view). Two whorls of long narrow petals: the outer tepals the
 * narrowest, amber at the base and pale gold-pink out to their tips, which twist and recurve;
 * the inner pure white (cream where the heart's warmth comes through, moonlit silver at the
 * tips), raised into a cup toward the eye, each curving a little its own way. Inside, a crown of
 * golden stamens with glowing anthers and the star of the stigma; at the centre a radiant heart.
 * The petals are translucent (blended over the house, the whorls laid back to front) and lit from
 * within: hot at the base, glowing at their thin margins and where the eye sees them edge-on,
 * finely veined. The petals unfurl in a wave round the whorl while a band of light runs out
 * from the heart to the tips; then she turns slowly, breathes (a faint pulse running outward now
 * and then) and closes again the way she opened. A lower petal that would pass under the canal
 * spreads on the water instead. A perfect clear opens a second, warm white-gold whorl that turns
 * the other way. She is driven by U.queen (open, glow, birth, perfect); at rest she collapses to
 * nothing. Her light is handed to the world with the blooms' (lights()), so the garden, the mist
 * and the canal's mirror all carry it.
 *
 * Every TSL helper here is an inline builder called inside a material's Fn (none is laid out).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, atan, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot,
    exp, float, fract, frontFacing, fwidth, length, max, min, mix, normalize, positionGeometry, pow, select, sin,
    smoothstep, step, uniform, varyingProperty, vec3, vec4,
} from 'three/tsl';
import {
    DEG, EYE, FLOOR, TIMING, clamp as clampJs, clamp01, lerp, smooth,
} from './moonlit-greenhouse-core.js';
import { fovForAspect } from './moonlit-greenhouse-composition.js';
import { mgSurface } from './moonlit-greenhouse-tsl.js';

const TAU = Math.PI * 2;
/** A time far in the future: a bloom that is not closing closes then. */
const NEVER = 1e6;

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────

/**
 * The night blooms.
 *   reach, least, most   a bed flower's petal length (metres) is this share of its distance from
 *                        the eye, so an open flower spans ≈4 % of a 16:9 frame's height wherever
 *                        it lands; clamped least..most
 *   hardSize, hardPace   a hard drop's flower is this much larger and opens in this share of the time
 *   stem, lean           the stem's height and its bow toward the eye, in petal lengths
 *   bedFront, canalOpen  a bloom slides along the eye's ray to stand no further across than
 *                        this (metres from the axis): in front of a bed's plants, in the open
 *                        water clear of the reeds, so the eye sees the flower, not its glow
 *   pull, headPull, lilyPull   and it is drawn this much nearer the eye along each point's own
 *                        line of sight (its place on the screen exactly kept): the stem and leaves
 *                        a little, the flower's head more, so the head looks out through the
 *                        foliage in front of it while its stem may stay hidden; a lily a little
 *   face                 how far the flower's axis turns from upright toward the eye
 *   heartLift            the heart above the flower's base (petal lengths)
 *   lily, lilyFace, lilyLift, pad   a water lily's petal length (share of a bed flower's), its
 *                        turn toward the eye, its heart over the water and its pad's radius
 *   sprout               share of the opening spent sprouting (the stem rising, the bud forming)
 *   spare                slots beyond the open capacity, for blooms still closing
 *   petalGlow, throat    a petal's light from within (scene-linear, × the piece's colour) and the
 *                        whitened throat's
 *   heart, halo, flare   the heart's peak, its halo's, and a landing's flare
 *   haloReach, heartReach, flareReach   their radii (petal lengths)
 *   lightRadius, lightPerReach   the reach of the light a bloom throws (metres, plus per petal length)
 */
export const BLOOM = Object.freeze({
    reach: 0.021,
    least: 0.09,
    most: 0.5,
    hardSize: 1.3,
    hardPace: 0.62,
    stem: 3.3,
    lean: 0.25,
    bedFront: 3.9,
    canalOpen: 1.75,
    pull: 0.8,
    headPull: 3.5,
    lilyPull: 0.35,
    face: 0.5,
    heartLift: 0.24,
    lily: 1.2,
    lilyFace: 0.4,
    lilyLift: 0.28,
    pad: 1.55,
    sprout: 0.3,
    spare: 0.5,
    petalGlow: 0.75,
    throat: 1.8,
    heart: 4.5,
    halo: 0.07,
    flare: 1.6,
    haloReach: 3.4,
    heartReach: 0.12,
    flareReach: 3.8,
    lightRadius: 1.2,
    lightPerReach: 3.0,
    lightStrength: 1.5,
});

/** What a bloom's vertex is (aPart.x). */
export const BLOOM_PART = Object.freeze({
    stem: 0, leaf: 1, petal: 2, sepal: 3, pad: 4, outer: 5, inner: 6, stamen: 7,
});

/** A slot's kind (aBloomSeed.y). */
export const BLOOM_KIND = Object.freeze({ bed: 0, water: 1 });

/**
 * The Queen of the Night.
 *   distance, lift       her heart on the resting central ray, this far from the eye (metres),
 *                        lifted this much above it
 *   reachWide, reachTall her outer tepals' reach, in half-heights of the frame at her distance, on
 *                        a wide screen and an upright one (16:9: 1.5 × the card's half-height)
 *   turn, tilt           her face turned from the eye toward the moon's side and down (a 3/4 view)
 *   innerShare           share of the tier's petals in the inner whorl (the rest are outer tepals)
 *   wave                 share of the opening the unfurling takes to run round a whorl
 *   spin, counterSpin    the whorls' slow turn (radians a second)
 *   petal, heart, anther the light from within (scene-linear): a petal's peak, the heart's, an anther's
 *   halo, rays           her radiance round the heart
 *   fold                 the lower petals spread on the canal where they would pass under the water
 *   lightStrength, lightReach   the light she throws on the garden (× her radius)
 */
export const QUEEN = Object.freeze({
    distance: 12.7,
    lift: 0.0,
    reachWide: 1.05,
    reachTall: 0.8,
    turn: 0.16,
    tilt: 0.1,
    innerShare: 0.42,
    wave: 0.42,
    spin: 0.03,
    counterSpin: -0.045,
    petal: 1.5,
    heart: 6.0,
    anther: 4.0,
    halo: 0.12,
    rays: 0.08,
    fold: true,
    lightStrength: 1.6,
    lightReach: 0.9,
});

/** What a Queen vertex is (aPart.x). */
export const QUEEN_PART = Object.freeze({
    outer: 0, inner: 1, second: 2, stamen: 3, stigma: 4, heart: 5,
});

// ── The closed form, on the CPU (the shaders evaluate the same curves) ─────────────────────

/** How far a bloom has opened (0..1) `age` seconds after its seed landed. */
export function bloomOpenness(age, hard = false) {
    const pace = TIMING.bloomOpen * (hard ? BLOOM.hardPace : 1);
    return age <= 0 ? 0 : smooth(0, pace, age);
}

/** How far a released bloom has closed (0..1) `age` seconds after its release. */
export function bloomClosing(age) {
    return age <= 0 ? 0 : smooth(0, TIMING.bloomClose, age);
}

/**
 * Where a bloom stands for a landing at (x, z): slid along the eye's ray (which keeps its place on
 * the screen) until it is no further across than the bed's front or the canal's open water.
 */
export function bloomPlace(x, z, onWater, out = { x: 0, z: 0 }) {
    const most = onWater ? BLOOM.canalOpen : BLOOM.bedFront;
    const across = Math.abs(x - EYE.x);
    let t = 1;
    if (across > most) t = most / across;
    out.x = EYE.x + (x - EYE.x) * t;
    out.z = Math.min(EYE.z + (z - EYE.z) * t, onWater ? FLOOR.canal.head - 0.4 : 1.0);
    return out;
}

/** A bloom's petal length (metres) where it lands: a share of its distance from the eye. */
export function bloomReach(x, y, z, hard = false, onWater = false) {
    const d = Math.hypot(x - EYE.x, y - EYE.y, z - EYE.z);
    const k = clampJs(d * BLOOM.reach, BLOOM.least, BLOOM.most);
    return k * (hard ? BLOOM.hardSize : 1) * (onWater ? BLOOM.lily : 1);
}

const norm3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};

/** (x, y, z) normalised into `out` (allocates nothing: queenPose runs every frame). */
const unit3 = (out, x, y, z) => {
    const l = Math.hypot(x, y, z) || 1;
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
    return out;
};
const toEyeScratch = [0, 0, 0];

/**
 * Where a bloom's heart is (the light it throws, the pollen it gives up): the top of its stem in
 * a bed, a little over its pad on the canal, the flower turned toward the eye. CPU twin of the
 * shaders' bedHead / lilyHead (without the sway).
 */
export function bloomHeart(x, y, z, k, onWater, out = { x: 0, y: 0, z: 0 }) {
    const tx = EYE.x - x;
    const tz = EYE.z - z;
    const l = Math.max(Math.hypot(tx, tz), 1e-3);
    const h = BLOOM.stem * k;
    const f = onWater ? [x, y + 0.012, z] : [x + (tx / l) * BLOOM.lean * h, y + h, z + (tz / l) * BLOOM.lean * h];
    const face = onWater ? BLOOM.lilyFace : BLOOM.face;
    const lift = onWater ? BLOOM.lilyLift : BLOOM.heartLift;
    const v = norm3([EYE.x - f[0], EYE.y - f[1], EYE.z - f[2]]);
    const a = norm3([v[0] * face, 1 - face + v[1] * face, v[2] * face]);
    out.x = f[0] + a[0] * lift * k;
    out.y = f[1] + a[1] * lift * k;
    out.z = f[2] + a[2] * lift * k;
    return out;
}

/**
 * A petal-like strip (CPU twin of the shaders' strip()): it leaves `base` along the unit `R`,
 * bending toward the unit `A` (perpendicular to R) from `th0` to `th1` radians over the plane
 * they span (a circular arc of length `len`); `c` in −1..1 across, `half` its half-width there,
 * `cup` the lift of its margins toward its inner side. Returns { p, n }: the point and the inner
 * normal (the side the strip bends toward), which is cross(∂p/∂s, ∂p/∂c), so a sheet laid
 * counter-clockwise in (s, c) faces its inner side.
 */
export function stripPoint(base, R, A, th0, th1, len, s, c, half, cup) {
    const side = [A[1] * R[2] - A[2] * R[1], A[2] * R[0] - A[0] * R[2], A[0] * R[1] - A[1] * R[0]];
    let d = th1 - th0;
    d = d >= 0 ? Math.max(d, 0.02) : Math.min(d, -0.02);
    const th = th0 + d * s;
    const k = len / d;
    const rho = (Math.sin(th) - Math.sin(th0)) * k;
    const ax = (Math.cos(th0) - Math.cos(th)) * k;
    const N = [A[0] * Math.cos(th) - R[0] * Math.sin(th), A[1] * Math.cos(th) - R[1] * Math.sin(th),
        A[2] * Math.cos(th) - R[2] * Math.sin(th)];
    const lift = cup * c * c * half;
    const p = [0, 1, 2].map((i) => base[i] + R[i] * rho + A[i] * ax + side[i] * c * half + N[i] * lift);
    const n = norm3([0, 1, 2].map((i) => N[i] - side[i] * 2 * cup * c));
    return { p, n };
}

/**
 * Where the Queen stands and how large she is for the frame (world.frame: its pitch and how
 * tall the screen is) and the aspect: { centre, axis (toward the eye), right, up, radius }.
 */
export function queenPose(frame, aspect, out = {
    centre: [0, 0, 0], axis: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], radius: 1,
}) {
    const pitch = (frame?.pitch ?? EYE.pitch) * DEG;
    const tall = frame?.tall ?? 0;
    const d = QUEEN.distance;
    const c = out.centre;
    c[0] = EYE.x;
    c[1] = EYE.y + Math.sin(pitch) * d + QUEEN.lift;
    c[2] = EYE.z - Math.cos(pitch) * d;
    // She faces the eye, turned a little toward the moon's side and down toward the canal.
    const toEye = unit3(toEyeScratch, EYE.x - c[0], EYE.y - c[1], EYE.z - c[2]);
    const axis = unit3(out.axis, toEye[0] - QUEEN.turn, toEye[1] - QUEEN.tilt, toEye[2]);
    // right = up × axis, up' = axis × right: right × up' = axis.
    const right = unit3(out.right, axis[2], 0, -axis[0]);
    const { up } = out;
    up[0] = axis[1] * right[2] - axis[2] * right[1];
    up[1] = axis[2] * right[0] - axis[0] * right[2];
    up[2] = axis[0] * right[1] - axis[1] * right[0];
    const half = Math.tan((fovForAspect(aspect) * DEG) / 2) * d;
    out.radius = half * lerp(QUEEN.reachWide, QUEEN.reachTall, clamp01(tall));
    return out;
}

// ── Geometry: parametric sheets ─────────────────────────────────────────────────────────────

/**
 * A sheet of parametric points: each vertex is (s, c, index) in `position` and (part, count) in
 * aPart; the vertex shader makes the shape. Grids are wound counter-clockwise in (s, c), so a
 * strip faces cross(∂p/∂s, ∂p/∂c) (its inner side, see stripPoint) and a tube its outside.
 */
class ParamSheet {
    constructor() {
        this.position = [];
        this.part = [];
        this.index = [];
    }

    /** A grid of `rows` steps along s (0..1) by the listed c values. */
    grid(part, count, which, rows, cs) {
        const first = this.position.length / 3;
        for (let i = 0; i <= rows; i += 1) {
            const s = i / rows;
            for (let j = 0; j < cs.length; j += 1) {
                this.position.push(s, cs[j], which);
                this.part.push(part, count);
            }
        }
        const n = cs.length;
        for (let i = 0; i < rows; i += 1) {
            for (let j = 0; j < n - 1; j += 1) {
                const a = first + i * n + j;
                const b = a + n;
                // a = (s, c), b = (s + ds, c), a + 1 = (s, c + dc), b + 1 = (s + ds, c + dc).
                this.index.push(a, b, b + 1, a, b + 1, a + 1);
            }
        }
    }

    /** A strip: c from −1 to 1 in `cols` points. */
    strip(part, count, which, rows, cols) {
        const cs = Array.from({ length: cols }, (_, j) => (j / (cols - 1)) * 2 - 1);
        this.grid(part, count, which, rows, cs);
    }

    /** A tube (or a disc): c from 0 to 1 round it in `sides` steps (the seam doubled). */
    tube(part, count, which, rows, sides) {
        const cs = Array.from({ length: sides + 1 }, (_, j) => j / sides);
        this.grid(part, count, which, rows, cs);
    }

    geometry() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 2));
        g.setIndex(this.index);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
        return g;
    }
}

/** How finely a tier draws a bloom. */
export function bloomDetail(tier) {
    const fine = tier.petals >= 7;
    const least = tier.petals <= 5;
    return {
        petals: tier.petals,
        petalRows: fine ? 7 : 5,
        petalCols: least ? 3 : 5,
        leafRows: fine ? 6 : 4,
        stemRows: fine ? 6 : 4,
        stemSides: least ? 4 : 5,
        sepals: 5,
        stamens: least ? 0 : 5,
        lilyPetals: tier.petals + 1,
        padRows: least ? 2 : 3,
        padSides: fine ? 20 : 14,
    };
}

/** The bed flower: a stem, two leaves, five sepals, the tier's petals and a few stamens. */
export function buildBedBloomGeometry(tier) {
    const d = bloomDetail(tier);
    const sheet = new ParamSheet();
    sheet.tube(BLOOM_PART.stem, 1, 0, d.stemRows, d.stemSides);
    for (let i = 0; i < 2; i += 1) sheet.strip(BLOOM_PART.leaf, 2, i, d.leafRows, 3);
    for (let i = 0; i < d.sepals; i += 1) sheet.strip(BLOOM_PART.sepal, d.sepals, i, 3, 3);
    for (let i = 0; i < d.petals; i += 1) sheet.strip(BLOOM_PART.petal, d.petals, i, d.petalRows, d.petalCols);
    for (let i = 0; i < d.stamens; i += 1) sheet.strip(BLOOM_PART.stamen, d.stamens, i, 3, 2);
    return sheet.geometry();
}

/** The water lily: its pad, and two whorls of petals. */
export function buildWaterBloomGeometry(tier) {
    const d = bloomDetail(tier);
    const sheet = new ParamSheet();
    sheet.tube(BLOOM_PART.pad, 1, 0, d.padRows, d.padSides);
    for (let i = 0; i < d.lilyPetals; i += 1) sheet.strip(BLOOM_PART.outer, d.lilyPetals, i, d.petalRows, d.petalCols);
    for (let i = 0; i < d.lilyPetals; i += 1) sheet.strip(BLOOM_PART.inner, d.lilyPetals, i, d.petalRows, d.petalCols);
    return sheet.geometry();
}

/** The Queen's counts for a tier. */
export function queenCounts(tier) {
    const inner = Math.round(tier.queenPetals * QUEEN.innerShare);
    const outer = tier.queenPetals - inner;
    return {
        outer,
        inner,
        second: inner,
        stamens: clampJs(Math.round(tier.queenPetals * 1.6), 24, 64),
        stigma: 10,
        rows: tier.queenPetals >= 30 ? 14 : 10,
        cols: tier.queenPetals >= 26 ? 5 : 3,
    };
}

/** The Queen of the Night: both whorls, the second whorl, the stamens, the stigma, the heart. */
export function buildQueenGeometry(tier) {
    const n = queenCounts(tier);
    const sheet = new ParamSheet();
    for (let i = 0; i < n.outer; i += 1) sheet.strip(QUEEN_PART.outer, n.outer, i, n.rows, n.cols);
    for (let i = 0; i < n.inner; i += 1) sheet.strip(QUEEN_PART.inner, n.inner, i, n.rows, n.cols);
    for (let i = 0; i < n.second; i += 1) sheet.strip(QUEEN_PART.second, n.second, i, n.rows - 2, n.cols);
    for (let i = 0; i < n.stamens; i += 1) sheet.strip(QUEEN_PART.stamen, n.stamens, i, 8, 2);
    for (let i = 0; i < n.stigma; i += 1) sheet.strip(QUEEN_PART.stigma, n.stigma, i, 3, 3);
    sheet.tube(QUEEN_PART.heart, 1, 0, 3, 18);
    return sheet.geometry();
}

/** A camera-facing quad (corners at ±1). */
function quadGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    return g;
}

// ── TSL ─────────────────────────────────────────────────────────────────────────────────────

const num = (x) => (typeof x === 'number' ? float(x) : x);

/** A turn kept clear of zero (the arc's closed form divides by it), keeping its sign. */
const turnSafe = (d) => select(d.greaterThanEqual(0.0), max(d, 0.02), min(d, -0.02));

/** sin(π·x)^e on 0..1, never a negative base (sin(π) is a hair below zero in float). */
const lobe = (x, e) => pow(max(sin(max(x, 0.0).mul(Math.PI)), 0.0), e);

/**
 * A petal-like strip (twin of stripPoint): { p, n } for the sheet's (s, c), its half-width
 * `half` there. All of base, R, A are vec3 nodes; the angles, length, width and cup may be
 * numbers or nodes.
 */
function strip(base, R, A, th0In, th1In, lenIn, s, c, halfIn, cupIn, twist = null) {
    const th0 = num(th0In);
    const len = num(lenIn);
    const half = num(halfIn);
    const cup = num(cupIn);
    const d = turnSafe(num(th1In).sub(th0));
    const th = th0.add(d.mul(s));
    const k = len.div(d);
    const rho = sin(th).sub(sin(th0)).mul(k);
    const ax = cos(th0).sub(cos(th)).mul(k);
    let side = cross(A, R);
    let N = A.mul(cos(th)).sub(R.mul(sin(th)));
    if (twist) {
        // The blade turns about its own spine by `twist` radians at its tip.
        const tau = num(twist).mul(s);
        const turnedSide = side.mul(cos(tau)).add(N.mul(sin(tau)));
        N = N.mul(cos(tau)).sub(side.mul(sin(tau)));
        side = turnedSide;
    }
    const p = base.add(R.mul(rho)).add(A.mul(ax)).add(side.mul(c.mul(half)))
        .add(N.mul(cup.mul(c).mul(c).mul(half)));
    const n = normalize(N.sub(side.mul(cup.mul(c).mul(2.0))));
    return { p, n };
}

/** A unit vector, or `fallback` where it has no length. */
const unit = (v, fallback) => select(length(v).greaterThan(1e-6), v.div(max(length(v), 1e-6)), fallback);

/**
 * A bloom slot's numbers and its moment, from the instance attributes and the clock.
 * `kind` (BLOOM_KIND) zeroes the slots of the other kind; null keeps both.
 */
function bloomInstance(U, kind) {
    const A = attribute('aBloomPos', 'vec4');
    const B = attribute('aBloomSeed', 'vec4');
    const C = attribute('aBloomTint', 'vec4');
    const D = attribute('aBloomTime', 'vec4');
    const age = U.time.sub(D.x).toVar();
    const pace = mix(float(TIMING.bloomOpen), float(TIMING.bloomOpen * BLOOM.hardPace), C.w);
    const u = clamp(age.div(pace), 0.0, 1.0).toVar();
    const open = u.mul(u).mul(float(3.0).sub(u.mul(2.0)));
    const sprout = smoothstep(0.0, BLOOM.sprout, u);
    const unfurl = smoothstep(BLOOM.sprout * 0.45, 1.0, u);
    const close = smoothstep(0.0, TIMING.bloomClose, U.time.sub(D.y)).toVar();
    const wither = smoothstep(0.55, 1.0, close);
    const landed = step(0.0, age);
    const mine = kind === null ? float(1.0) : select(abs(B.y.sub(kind)).lessThan(0.5), float(1.0), float(0.0));
    const size = A.w.mul(sprout).mul(float(1.0).sub(wither)).mul(landed).mul(mine)
        .toVar();
    // The petals spring open past their rest and settle: a damped wobble once nearly open.
    const after = max(age.sub(pace.mul(0.8)), 0.0);
    const spring = sin(after.mul(11.0)).mul(exp(after.mul(-3.2))).mul(0.16).mul(step(0.8, u));
    const po = unfurl.mul(float(1.0).sub(close.mul(0.92))).toVar();
    const glow = open.mul(float(1.0).sub(close)).toVar();
    const flash = exp(max(age, 0.0).mul(-7.0)).mul(landed).mul(float(1.0).sub(close)).mul(mine);
    return {
        base: A.xyz,
        k: A.w.mul(mine),
        seed: B.x,
        kind: B.y,
        rgb: C.xyz,
        hard: C.w,
        age,
        open,
        close,
        size,
        po,
        spring,
        glow,
        flash,
    };
}

/**
 * A bed flower's head: its stem's top F (swaying), the flower's axis a (turned toward the eye)
 * and a frame (e1, e2) across it with e1 × e2 = a; the stem's height H, the unit toward the eye
 * along the ground and the unit across it.
 */
function bedHead(I, U) {
    const up = vec3(0.0, 1.0, 0.0);
    const t = U.time;
    const d = U.eye.xz.sub(I.base.xz);
    const toEye = vec3(d.x, 0.0, d.y).div(max(length(d), 1e-3)).toVar();
    const side = vec3(toEye.z.negate(), 0.0, toEye.x).toVar();
    const H = I.size.mul(BLOOM.stem).toVar();
    // The house's air, a gust and a T-spin's turn nod the flower on its stem.
    const ph = I.seed.mul(40.0);
    const nod = sin(t.mul(1.05).add(ph)).mul(0.03)
        .add(sin(t.mul(2.6).add(ph.mul(0.7))).mul(U.gust).mul(0.1))
        .add(sin(t.mul(1.7).add(ph.mul(1.3))).mul(U.turn.y).mul(0.14))
        .toVar();
    const sway = side.mul(nod).add(toEye.mul(nod.mul(0.3))).mul(H);
    const F = I.base.add(up.mul(H)).add(toEye.mul(H.mul(BLOOM.lean))).add(sway).toVar();
    const v = unit(U.eye.sub(F), toEye);
    const a = normalize(mix(up, v, BLOOM.face).add(side.mul(nod.mul(0.8)))).toVar();
    const e1 = normalize(side.sub(a.mul(dot(side, a)))).toVar();
    const e2 = cross(a, e1).toVar();
    const heart = F.add(a.mul(I.size.mul(BLOOM.heartLift)));
    return {
        up, toEye, side, H, F, a, e1, e2, heart,
    };
}

/** A water lily's head: its pad's centre F (bobbing), the axis a and a frame across it. */
function lilyHead(I, U) {
    const up = vec3(0.0, 1.0, 0.0);
    const t = U.time;
    const age = max(I.age, 0.0);
    // The pad slaps down with the seed and bobs as its ring runs out; then the canal's slow breath.
    const bob = sin(age.mul(8.5)).mul(exp(age.mul(-3.2))).mul(-0.16).mul(I.k)
        .add(sin(t.mul(0.9).add(I.seed.mul(30.0))).mul(0.004));
    const sink = smoothstep(0.4, 1.0, I.close).mul(I.k).mul(0.3);
    const F = vec3(I.base.x, I.base.y.add(0.012).add(bob).sub(sink), I.base.z).toVar();
    const d = U.eye.xz.sub(I.base.xz);
    const toEye = vec3(d.x, 0.0, d.y).div(max(length(d), 1e-3)).toVar();
    const side = vec3(toEye.z.negate(), 0.0, toEye.x).toVar();
    const v = unit(U.eye.sub(F), toEye);
    const a = normalize(mix(up, v, BLOOM.lilyFace)).toVar();
    const e1 = normalize(side.sub(a.mul(dot(side, a)))).toVar();
    const e2 = cross(a, e1).toVar();
    const heart = F.add(a.mul(I.size.mul(BLOOM.lilyLift)));
    return {
        up, toEye, side, F, a, e1, e2, heart,
    };
}

/**
 * A point drawn `pull` metres nearer the eye along its own line of sight: the same place on the
 * screen, only nearer in depth (never past half the way to the eye).
 */
const towardEye = (p, pull) => {
    const d = cameraPosition.sub(p);
    const l = length(d);
    return p.add(d.mul(min(num(pull), l.mul(0.5)).div(max(l, 1e-3))));
};

/** A pixel's footprint in metres at p. */
const footprint = (p) => max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z))).add(0.001);

/**
 * A petal's light from within: brightest in the throat (whitened), deepening toward the tips,
 * the midrib and the thin margins brighter, fine veins, the outside of the cup lit through.
 * Returns the light (× the piece's colour, × the bloom's glow).
 */
function petalLight(rgb, s, c, inner, glow, opening = null) {
    const ac = abs(c);
    const throat = exp(s.mul(-6.0));
    const body = mix(float(0.75), float(0.22), s);
    const mid = exp(c.div(0.12).mul(c.div(0.12)).negate()).mul(float(1.0).sub(s.mul(0.5))).mul(0.3);
    const veins = pow(abs(cos(c.mul(Math.PI * 3.5))), 10.0).mul(float(1.0).sub(s.mul(0.7))).mul(0.25);
    const rim = smoothstep(0.75, 1.0, ac).mul(0.35).add(smoothstep(0.9, 1.0, s).mul(0.15));
    // The colour deepens out toward the tips (its brightest channel stays at 1) and whitens in
    // the throat; seen from outside, the light through the cup is the deeper colour, dimmer.
    const deep = rgb.mul(rgb);
    const hue = mix(mix(deep, rgb, float(1.0).sub(s)), vec3(1.0), throat.mul(0.6));
    let level = body.add(mid).add(veins).add(rim).mul(BLOOM.petalGlow)
        .add(throat.mul(BLOOM.throat));
    if (opening) {
        // As the petals unfurl a band of light runs from the throat out to their tips.
        const run = s.sub(opening).div(0.2);
        level = level.add(exp(run.mul(run).negate()).mul(float(1.0).sub(opening)).mul(0.9));
    }
    return select(inner, hue.mul(level), deep.mul(level).mul(0.6)).mul(glow);
}

/** The board's light on the blooms: in a chain their light breathes with the fireflies; the hush dims it. */
const bloomMood = (U) => float(1.0).add(U.sync.mul(U.fireflyGlow).mul(0.6)).add(U.flood.mul(0.5))
    .mul(float(1.0).sub(U.hush.mul(0.85)));

/** The bed flower's material. */
function bedBloomMaterial(U) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'moonlit-greenhouse-bloom-bed';
    const part = attribute('aPart', 'vec2');
    const vP = varyingProperty('vec3', 'mgBloomP');
    const vN = varyingProperty('vec3', 'mgBloomN');
    const vSC = varyingProperty('vec3', 'mgBloomSC');
    const vState = varyingProperty('vec4', 'mgBloomState');

    material.positionNode = Fn(() => {
        const I = bloomInstance(U, BLOOM_KIND.bed);
        const h = bedHead(I, U);
        const g = positionGeometry;
        const s = g.x;
        const c = g.y;
        const which = g.z;
        const kind = part.x;
        const P = vec3(I.base).toVar();
        const N = vec3(0.0, 1.0, 0.0).toVar();
        // The stem: a quadratic from the soil, bowed toward the eye, up to the swaying head.
        const B0 = I.base;
        const B1 = I.base.add(h.up.mul(h.H.mul(0.55))).add(h.toEye.mul(h.H.mul(0.05)));
        const stemAt = (u) => B0.mul(float(1.0).sub(u).mul(float(1.0).sub(u)))
            .add(B1.mul(u.mul(float(1.0).sub(u)).mul(2.0))).add(h.F.mul(u.mul(u)));
        If(kind.lessThan(0.5), () => {
            const tangent = B1.sub(B0).mul(float(1.0).sub(s).mul(2.0)).add(h.F.sub(B1).mul(s.mul(2.0)));
            const t = unit(tangent, h.up);
            const n1 = normalize(cross(t, h.side).add(vec3(0.0, 0.0, 1e-5)));
            const n2 = cross(t, n1);
            const th = c.mul(TAU);
            const out = n1.mul(cos(th)).sub(n2.mul(sin(th)));
            const r = I.size.mul(0.034).mul(float(1.0).sub(s.mul(0.35)));
            P.assign(stemAt(s).add(out.mul(r)));
            N.assign(out);
        }).ElseIf(kind.lessThan(1.5), () => {
            // Two leaves low on the stem, either side, arching out and down.
            const left = which.lessThan(0.5);
            const at = select(left, float(0.2), float(0.4));
            const sgn = select(left, float(1.0), float(-1.0));
            const beta = I.seed.sub(0.5).mul(0.9).add(which.mul(0.5)).sub(0.25);
            const R = normalize(h.side.mul(sgn.mul(cos(beta))).add(h.toEye.mul(sin(beta))));
            const half = I.size.mul(0.27).mul(lobe(s, 0.8));
            const leaf = strip(
                stemAt(at),
                R,
                h.up,
                select(left, float(0.95), float(0.8)),
                -0.6,
                I.size.mul(1.6),
                s,
                c,
                half,
                0.3,
            );
            P.assign(leaf.p);
            N.assign(leaf.n);
        }).ElseIf(kind.lessThan(2.5), () => {
            // A petal: furled in a spiral in the bud, it untwists and springs open into the star.
            const { po } = I;
            const f = which.div(part.y);
            const jit = fract(which.mul(0.618).add(I.seed.mul(3.1))).sub(0.5).mul(0.12);
            const phi = f.mul(TAU).add(I.seed.mul(TAU)).add(float(1.15).mul(float(1.0).sub(po)).mul(s));
            const R = h.e1.mul(cos(phi)).add(h.e2.mul(sin(phi)));
            const th0 = mix(float(1.42), float(0.98), po).add(jit);
            const th1 = mix(float(1.66), float(-0.22), po).add(I.spring).add(jit.mul(0.5));
            const len = I.size.mul(mix(float(0.82), float(1.0), po));
            const half = I.size.mul(0.33).mul(mix(float(0.55), float(1.0), po)).mul(lobe(pow(max(s, 1e-4), 0.8), 0.75));
            const petal = strip(
                h.F.add(R.mul(I.size.mul(0.06))),
                R,
                h.a,
                th0,
                th1,
                len,
                s,
                c,
                half,
                mix(float(0.55), float(0.22), po),
            );
            P.assign(petal.p);
            N.assign(petal.n);
        }).ElseIf(kind.lessThan(3.5), () => {
            // The sepals: green, hugging the bud, then spread back under the open flower.
            const { po } = I;
            const phi = which.add(0.5).div(part.y).mul(TAU).add(I.seed.mul(TAU));
            const R = h.e1.mul(cos(phi)).add(h.e2.mul(sin(phi)));
            const half = I.size.mul(0.11).mul(lobe(pow(max(s, 1e-4), 0.8), 0.7));
            const sepal = strip(
                h.F.add(R.mul(I.size.mul(0.05))),
                R,
                h.a,
                mix(float(1.25), float(0.35), po),
                mix(float(1.45), float(-0.6), po),
                I.size.mul(0.42),
                s,
                c,
                half,
                0.3,
            );
            P.assign(sepal.p);
            N.assign(sepal.n);
        })
            .Else(() => {
            // The stamens: fine filaments arching out of the heart, glowing at their tips.
                const { po } = I;
                const hs = fract(which.mul(0.381).add(I.seed.mul(7.7)));
                const phi = which.add(hs.mul(0.5)).div(part.y).mul(TAU).add(I.seed.mul(TAU));
                const R = h.e1.mul(cos(phi)).add(h.e2.mul(sin(phi)));
                const knob = smoothstep(0.7, 0.9, s);
                const half = I.size.mul(0.012).mul(knob.mul(1.8).add(1.0));
                const stamen = strip(
                    h.F.add(R.mul(I.size.mul(0.03))),
                    R,
                    h.a,
                    mix(float(1.5), float(1.2), po),
                    mix(float(1.5), float(0.55), po),
                    I.size.mul(0.4).mul(hs.mul(0.3).add(0.85)).mul(po.mul(0.6).add(0.4)),
                    s,
                    c,
                    half,
                    0.0,
                );
                P.assign(stamen.p);
                N.assign(stamen.n);
            });
        vP.assign(P);
        vN.assign(N);
        vSC.assign(vec3(s, c, kind));
        vState.assign(vec4(I.glow, I.flash, I.close, I.po));
        const head = kind.greaterThan(1.5);
        return towardEye(P, select(head, float(BLOOM.headPull), float(BLOOM.pull)));
    })();

    material.colorNode = Fn(() => {
        const rgb = attribute('aBloomTint', 'vec4').xyz;
        const p = vP;
        const s = clamp(vSC.x, 0.0, 1.0);
        const c = clamp(vSC.y, -1.0, 1.0);
        const kind = vSC.z;
        const inner = frontFacing;
        const nG = normalize(vN);
        const n = select(inner, nG, nG.negate());
        const v = normalize(p.sub(cameraPosition));
        const isPetal = kind.greaterThan(1.5).and(kind.lessThan(2.5));
        const isLeaf = kind.greaterThan(0.5).and(kind.lessThan(1.5));
        const isStamen = kind.greaterThan(BLOOM_PART.stamen - 0.5);
        // The green parts: a dark stem, glossy leaves with a paler midrib, the sepals tinged with
        // the flower's colour where they hug it.
        const midrib = exp(c.div(0.12).mul(c.div(0.12)).negate());
        const green = select(
            isLeaf,
            mix(vec3(0.045, 0.11, 0.04), vec3(0.08, 0.16, 0.06), midrib),
            mix(vec3(0.04, 0.09, 0.035), rgb.mul(0.12), float(1.0).sub(s).mul(0.5)),
        );
        const albedo = select(isPetal, mix(rgb, vec3(1.0), 0.55).mul(0.5), green);
        const lit = mgSurface(p, n, albedo, U, {
            translucency: select(isPetal, float(0.0), float(0.7)), soft: footprint(p), view: v,
        });
        // The cup's walls, turned from the eye, are a little dimmer than the faces that meet it.
        const facing = clamp(abs(dot(n, v)), 0.0, 1.0);
        const glow = petalLight(rgb, s, c, inner, vState.x, vState.w).mul(facing.mul(0.4).add(0.6)).mul(bloomMood(U));
        const anther = mix(rgb, vec3(1.0), 0.6).mul(smoothstep(0.65, 0.9, s).mul(2.4).add(0.5)).mul(vState.x)
            .mul(bloomMood(U));
        const own = select(isPetal, glow, select(isStamen, anther, vec3(0.0)));
        return vec4(lit.add(own), 1.0);
    })();
    return material;
}

/** The water lily's material. */
function waterBloomMaterial(U) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'moonlit-greenhouse-bloom-water';
    const part = attribute('aPart', 'vec2');
    const vP = varyingProperty('vec3', 'mgLilyP');
    const vN = varyingProperty('vec3', 'mgLilyN');
    const vSC = varyingProperty('vec3', 'mgLilySC');
    const vState = varyingProperty('vec4', 'mgLilyState');
    const { night } = U;

    material.positionNode = Fn(() => {
        const I = bloomInstance(U, BLOOM_KIND.water);
        const h = lilyHead(I, U);
        const g = positionGeometry;
        const s = g.x;
        const c = g.y;
        const which = g.z;
        const kind = part.x;
        const P = vec3(I.base).toVar();
        const N = vec3(0.0, 1.0, 0.0).toVar();
        If(kind.lessThan(BLOOM_PART.pad + 0.5), () => {
            // The pad: a flat disc cleft by its notch, spreading as it lands, its rim just proud.
            const age = max(I.age, 0.0);
            const spread = smoothstep(0.0, 0.35, age).mul(0.25).add(0.75);
            const notch = float(0.22);
            const ang = notch.add(c.mul(float(TAU).sub(notch.mul(2.0)))).add(I.seed.mul(TAU));
            // e1 × e2 = up, so radial × tangential faces up.
            const e1 = h.side;
            const e2 = cross(h.up, e1);
            const radial = e1.mul(cos(ang)).add(e2.mul(sin(ang)));
            const rad = I.size.mul(BLOOM.pad).mul(spread);
            const rim = smoothstep(0.82, 1.0, s).mul(I.size).mul(0.025);
            P.assign(h.F.sub(h.up.mul(0.006)).add(radial.mul(rad.mul(s))).add(h.up.mul(rim)));
            N.assign(normalize(h.up.sub(radial.mul(smoothstep(0.82, 1.0, s).mul(0.4)))));
        }).Else(() => {
            // Two whorls of pointed petals: the outer nearly flat on the pad, the inner raised
            // into a cup; in the bud both stand closed over the heart.
            const { po } = I;
            const isOuter = kind.lessThan(BLOOM_PART.outer + 0.5);
            const f = which.add(select(isOuter, float(0.0), float(0.5))).div(part.y);
            const jit = fract(which.mul(0.618).add(I.seed.mul(5.3))).sub(0.5).mul(0.1);
            const phi = f.mul(TAU).add(I.seed.mul(TAU)).add(float(0.6).mul(float(1.0).sub(po)).mul(s));
            const R = h.e1.mul(cos(phi)).add(h.e2.mul(sin(phi)));
            const th0 = select(isOuter, mix(float(1.35), float(0.2), po), mix(float(1.45), float(0.86), po)).add(jit);
            const th1 = select(isOuter, mix(float(1.62), float(0.42), po), mix(float(1.64), float(1.1), po))
                .add(I.spring.mul(0.6));
            const len = I.size.mul(select(isOuter, float(1.0), float(0.84))).mul(mix(float(0.78), float(1.0), po));
            const half = I.size.mul(select(isOuter, float(0.21), float(0.18))).mul(lobe(pow(max(s, 1e-4), 0.9), 0.7));
            const petal = strip(
                h.F.add(R.mul(I.size.mul(0.04))),
                R,
                h.a,
                th0,
                th1,
                len,
                s,
                c,
                half,
                select(isOuter, float(0.35), float(0.45)),
            );
            P.assign(petal.p);
            N.assign(petal.n);
        });
        vP.assign(P);
        vN.assign(N);
        vSC.assign(vec3(s, c, kind));
        vState.assign(vec4(I.glow, I.flash, I.close, I.po));
        return towardEye(P, BLOOM.lilyPull);
    })();

    material.colorNode = Fn(() => {
        const rgb = attribute('aBloomTint', 'vec4').xyz;
        const p = vP;
        const s = clamp(vSC.x, 0.0, 1.0);
        const c = vSC.y;
        const kind = vSC.z;
        const inner = frontFacing;
        const nG = normalize(vN);
        const n = select(inner, nG, nG.negate());
        const v = normalize(p.sub(cameraPosition));
        const isPad = kind.lessThan(BLOOM_PART.pad + 0.5);
        // The pad: dark waxy green, its veins radiating, a paler rim; the lily lights it round itself.
        const veins = pow(abs(cos(c.mul(Math.PI * 22.0))), 12.0).mul(smoothstep(0.1, 0.4, s)).mul(0.25);
        const padAlbedo = mix(vec3(0.03, 0.065, 0.035), vec3(0.06, 0.1, 0.05), veins.add(smoothstep(0.9, 1.0, s)));
        const albedo = select(isPad, padAlbedo, mix(rgb, vec3(1.0), 0.55).mul(0.5));
        const lit = mgSurface(p, n, albedo, U, {
            translucency: select(isPad, float(0.5), float(0.0)), soft: footprint(p), view: v,
        }).toVar();
        // The pad's wax mirrors the sky a little where the eye looks across it.
        const grazing = float(1.0).sub(clamp(abs(dot(n, v)), 0.0, 1.0));
        const sheen = night.horizon.mul(grazing.mul(grazing).mul(grazing).mul(2.5))
            .mul(select(isPad, float(1.0), float(0.0)));
        const glow = petalLight(rgb, s, clamp(c, -1.0, 1.0), inner, vState.x, vState.w).mul(bloomMood(U));
        return vec4(lit.add(sheen).add(select(isPad, vec3(0.0), glow)), 1.0);
    })();
    return material;
}

/** The hearts' glow: a point of light, its halo, and a landing's flare, camera-facing, additive. */
function heartGlowMaterial(U) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    material.name = 'moonlit-greenhouse-bloom-hearts';
    const vQ = varyingProperty('vec4', 'mgHeartQ');
    const vR = varyingProperty('vec4', 'mgHeartR');
    const vState = varyingProperty('vec4', 'mgHeartState');

    material.vertexNode = Fn(() => {
        const I = bloomInstance(U, null);
        const water = I.kind.greaterThan(0.5);
        const bed = bedHead(I, U);
        const lily = lilyHead(I, U);
        const heart = select(water, lily.heart, bed.heart);
        // Drawn a little toward the eye, so its own petals do not cut it, and pulled as its flower is.
        const toCam = normalize(cameraPosition.sub(heart));
        const pull = select(water, float(BLOOM.lilyPull), float(BLOOM.headPull));
        const ahead = min(I.size.mul(0.6).add(I.k.mul(0.2)).add(pull), length(cameraPosition.sub(heart)).mul(0.5));
        const at = heart.add(toCam.mul(ahead));
        const view = cameraViewMatrix.mul(vec4(at, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.05);
        const px = depth.mul(U.pixelAngle);
        const flareR = I.k.mul(BLOOM.flareReach).mul(step(0.02, I.flash));
        const haloR = I.size.mul(BLOOM.haloReach).mul(U.sync.mul(0.6).add(1.0));
        const live = step(1e-5, I.k);
        const radius = max(max(haloR, flareR), px.mul(6.0)).mul(live);
        const q = positionGeometry.xy;
        vQ.assign(vec4(q, radius, px));
        vR.assign(vec4(I.size, I.k, I.age, 0.0));
        vState.assign(vec4(I.glow, I.flash, I.close, 0.0));
        return cameraProjectionMatrix.mul(vec4(view.xyz.add(vec3(q.mul(radius), 0.0)), 1.0));
    })();

    const shape = Fn(() => {
        const rgb = attribute('aBloomTint', 'vec4').xyz;
        const q = vQ.xy;
        const d = length(q).mul(vQ.z);
        const px = vQ.w;
        const size = vR.x;
        const k = vR.y;
        const glow = vState.x;
        const flash = vState.y;
        // The heart: never smaller than a pixel or so, its light kept as it shrinks below that.
        const want = size.mul(BLOOM.heartReach);
        const heartR = max(want, px.mul(1.3));
        const keep = want.div(heartR).mul(want.div(heartR));
        const h = d.div(heartR);
        const core = exp(h.mul(h).negate()).mul(keep).mul(BLOOM.heart);
        // A chain widens the halo as the fireflies fall into step.
        const haloR = max(size.mul(BLOOM.haloReach * 0.5).mul(U.sync.mul(0.6).add(1.0)), px.mul(2.0));
        const g = d.div(haloR);
        const halo = exp(g.mul(g).negate()).mul(BLOOM.halo).add(exp(g.mul(-1.6)).mul(BLOOM.halo * 0.25));
        // A landing: a burst of light and six soft rays that open out and fade.
        const fr = d.div(max(k.mul(BLOOM.flareReach).mul(float(1.0).sub(flash).mul(0.5).add(0.5)), px));
        const ang = atan(q.y, q.x).add(vR.w.add(k.mul(97.0)));
        const rays = pow(abs(cos(ang.mul(3.0))), 40.0).mul(exp(fr.mul(-3.5))).mul(0.45);
        const burst = exp(fr.mul(fr).mul(-30.0)).mul(2.0);
        const flare = rays.add(burst).mul(flash).mul(BLOOM.flare);
        const hot = mix(rgb, vec3(1.0), 0.55);
        const light = hot.mul(core.mul(glow)).add(rgb.mul(halo.mul(glow).add(flare)));
        const edge = float(1.0).sub(smoothstep(0.8, 1.0, length(q)));
        return light.mul(bloomMood(U)).mul(edge);
    });
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = vec4(shape(), 0.0);
    return material;
}

// ── The blooms ─────────────────────────────────────────────────────────────────────────────

/** The blooms part. ctx = { tier, U }. API: see the header and the world (onLock, onClear). */
export function createBlooms({ tier, U }) {
    const capacity = Math.max(1, tier.blooms | 0);
    const slots = capacity + Math.ceil(capacity * BLOOM.spare);
    const stat = new Float32Array(slots * 8);
    const dyn = new Float32Array(slots * 8);
    const statBuffer = new THREE.InstancedInterleavedBuffer(stat, 8, 1);
    const dynBuffer = new THREE.InstancedInterleavedBuffer(dyn, 8, 1);
    statBuffer.setUsage(THREE.DynamicDrawUsage);
    dynBuffer.setUsage(THREE.DynamicDrawUsage);
    const attach = (geometry) => {
        geometry.setAttribute('aBloomPos', new THREE.InterleavedBufferAttribute(statBuffer, 4, 0));
        geometry.setAttribute('aBloomSeed', new THREE.InterleavedBufferAttribute(statBuffer, 4, 4));
        geometry.setAttribute('aBloomTint', new THREE.InterleavedBufferAttribute(dynBuffer, 4, 0));
        geometry.setAttribute('aBloomTime', new THREE.InterleavedBufferAttribute(dynBuffer, 4, 4));
        return geometry;
    };
    const make = (geometry, material, name, order) => {
        const mesh = new THREE.InstancedMesh(attach(geometry), material, slots);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        return mesh;
    };
    const bed = make(buildBedBloomGeometry(tier), bedBloomMaterial(U), 'moonlit-greenhouse-blooms-bed', 5);
    const water = make(buildWaterBloomGeometry(tier), waterBloomMaterial(U), 'moonlit-greenhouse-blooms-water', 6);
    const hearts = make(quadGeometry(), heartGlowMaterial(U), 'moonlit-greenhouse-blooms-hearts', 59);
    const group = new THREE.Group();
    group.name = 'moonlit-greenhouse-blooms';
    group.add(bed, water, hearts);

    /** Every slot: null when free, else its bloom. */
    const pool = new Array(slots).fill(null);
    /** The open blooms (not closing), oldest first. */
    const open = [];
    const rows = Array.from({ length: slots + 1 }, () => ({
        x: 0, y: 0, z: 0, strength: 0, rgb: [1, 1, 1], radius: 1, score: 0,
    }));
    const lit = [];
    const pose = queenPose(null, 16 / 9);
    const place = { x: 0, z: 0 };
    let now = 0;
    let hush = 0;
    let order = 0;

    const writeStatic = (i, b) => {
        const o = i * 8;
        stat[o] = b ? b.x : 0;
        stat[o + 1] = b ? b.y : 0;
        stat[o + 2] = b ? b.z : 0;
        stat[o + 3] = b ? b.k : 0;
        stat[o + 4] = b ? Math.floor(b.seed * 997) / 997 : 0;
        stat[o + 5] = b && b.onWater ? BLOOM_KIND.water : BLOOM_KIND.bed;
        statBuffer.needsUpdate = true;
    };
    const writeDynamic = (i, b) => {
        const o = i * 8;
        dyn[o] = b ? b.rgb[0] : 0;
        dyn[o + 1] = b ? b.rgb[1] : 0;
        dyn[o + 2] = b ? b.rgb[2] : 0;
        dyn[o + 3] = b && b.hard ? 1 : 0;
        dyn[o + 4] = b ? b.at : -NEVER;
        dyn[o + 5] = b ? b.closeAt : NEVER;
        dynBuffer.needsUpdate = true;
    };
    const closeBloom = (b, at) => {
        b.closeAt = at;
        writeDynamic(b.slot, b);
    };
    const free = (i) => {
        pool[i] = null;
        writeStatic(i, null);
        writeDynamic(i, null);
    };
    const finished = (b, t) => b.closeAt < NEVER && t >= b.closeAt + TIMING.bloomClose;
    /** A slot for a new bloom: a free one, one whose bloom has closed, else the one closest to closed. */
    const takeSlot = (t) => {
        let best = -1;
        let bestClose = Infinity;
        for (let i = 0; i < slots; i += 1) {
            const b = pool[i];
            if (!b || finished(b, t)) return i;
            if (b.closeAt < bestClose) {
                bestClose = b.closeAt;
                best = i;
            }
        }
        return best;
    };

    /**
     * A bloom: { x, y, z, rgb, at, hard, onWater, seed }. It opens at `at` (it may be in the future
     * while the seed is in flight). Returns its record, or null.
     */
    const add = (b) => {
        if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z) || !Number.isFinite(b.at)) return null;
        const hard = b.hard === true;
        const onWater = b.onWater === true;
        const t = Math.max(now, b.at - TIMING.seedFlight);
        // Full: the oldest open bloom closes as the new one opens.
        if (open.length >= capacity) closeBloom(open.shift(), b.at);
        const slot = takeSlot(t);
        if (slot < 0) return null;
        const ground = onWater ? FLOOR.canal.water : FLOOR.bed.soil;
        const y = Number.isFinite(b.y) ? b.y : ground;
        const at = bloomPlace(b.x, b.z, onWater, place);
        const k = bloomReach(at.x, y, at.z, hard, onWater);
        const rgb = Array.isArray(b.rgb) ? [b.rgb[0], b.rgb[1], b.rgb[2]] : [1, 0.84, 0.52];
        const record = {
            slot,
            x: at.x,
            y,
            z: at.z,
            rgb,
            at: b.at,
            hard,
            onWater,
            seed: Number.isFinite(b.seed) ? clamp01(b.seed) : 0.5,
            k,
            closeAt: NEVER,
            order: order += 1,
            heart: bloomHeart(at.x, y, at.z, k, onWater),
        };
        // A stolen slot's bloom was already closing; it simply goes.
        pool[slot] = record;
        writeStatic(slot, record);
        writeDynamic(slot, record);
        open.push(record);
        return record;
    };

    /** Close the oldest `count` open blooms (Infinity: all) from `at`; push { x, y, z, rgb, at } into `out`. */
    const release = (count, at, out = []) => {
        const n = Math.min(Math.max(0, count), open.length);
        for (let i = 0; i < n; i += 1) {
            const b = open.shift();
            closeBloom(b, at);
            out.push({
                x: b.heart.x, y: b.heart.y, z: b.heart.z, rgb: b.rgb, at,
            });
        }
        return out;
    };

    /** The light the blooms (and the Queen) throw on the garden at `clock`: { x, y, z, strength, rgb, radius }. */
    const lights = (clock) => {
        lit.length = 0;
        const dim = 1 - hush * 0.85;
        for (let i = 0; i < slots; i += 1) {
            const b = pool[i];
            if (!b) continue;
            const strength = bloomOpenness(clock - b.at, b.hard) * (1 - bloomClosing(clock - b.closeAt))
                * BLOOM.lightStrength * (b.hard ? 1.25 : 1) * dim;
            if (strength <= 0.01) continue;
            const row = rows[i];
            row.x = b.heart.x;
            row.y = b.heart.y;
            row.z = b.heart.z;
            row.strength = strength;
            row.rgb[0] = b.rgb[0];
            row.rgb[1] = b.rgb[1];
            row.rgb[2] = b.rgb[2];
            row.radius = BLOOM.lightRadius + BLOOM.lightPerReach * b.k;
            row.queen = false;
            lit.push(row);
        }
        // The Queen of the Night's light, from her heart.
        const q = U.queen.value;
        if (q.x > 0.001) {
            const row = rows[slots];
            row.x = pose.centre[0] + pose.axis[0] * pose.radius * 0.12;
            row.y = pose.centre[1] + pose.axis[1] * pose.radius * 0.12;
            row.z = pose.centre[2] + pose.axis[2] * pose.radius * 0.12;
            row.strength = QUEEN.lightStrength * smooth(0, 0.4, q.x) * (0.45 + 0.55 * q.y);
            row.rgb[0] = 1;
            row.rgb[1] = 0.9;
            row.rgb[2] = 0.74;
            row.radius = pose.radius * QUEEN.lightReach;
            row.queen = true;
            lit.push(row);
        }
        return lit;
    };

    const reset = () => {
        for (let i = 0; i < slots; i += 1) free(i);
        open.length = 0;
    };
    reset();

    return {
        mesh: group,
        capacity,
        slots,
        add,
        release,
        lights,
        count: () => open.length,
        reset,
        update(world) {
            now = world.clock;
            hush = world.U?.hush?.value ?? 0;
            queenPose(world.frame, world.aspect, pose);
            for (let i = 0; i < slots; i += 1) {
                const b = pool[i];
                if (b && finished(b, now)) free(i);
            }
        },
        dispose() {
            group.removeFromParent();
            [bed, water, hearts].forEach((m) => {
                m.geometry.dispose();
                m.material.dispose();
                m.dispose();
            });
        },
    };
}

// ── The Queen of the Night ─────────────────────────────────────────────────────────────────

/** Her petals' parameters, per whorl: closed and open elevations at base and tip, length, width, cup, r0. */
const WHORL = Object.freeze({
    outer: {
        th0: [1.45, 0.3], th1: [1.55, -0.75], len: 1.1, half: 0.03, cup: 0.3, r0: 0.05, twist: 1.2,
    },
    inner: {
        th0: [1.5, 0.92], th1: [1.55, 0.02], len: 0.84, half: 0.066, cup: 0.42, r0: 0.06, twist: 0.0,
    },
    second: {
        th0: [1.5, 1.1], th1: [1.55, 0.5], len: 0.66, half: 0.055, cup: 0.45, r0: 0.05, twist: 0.0,
    },
});

/** The Queen's material: opaque, her light from within. */
function queenMaterial(U, Q) {
    // Blended over the house, depth written: the whorls are laid outer first, so the petals are
    // drawn back to front and each blends over the ones behind it.
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide, transparent: true, depthWrite: true, fog: false,
    });
    material.name = 'moonlit-greenhouse-queen';
    const part = attribute('aPart', 'vec2');
    const vP = varyingProperty('vec3', 'mgQueenP');
    const vN = varyingProperty('vec3', 'mgQueenN');
    const vSC = varyingProperty('vec4', 'mgQueenSC');
    const { night } = U;

    material.positionNode = Fn(() => {
        const open = U.queen.x;
        const perfect = U.queen.w;
        const age = max(U.time.sub(U.queen.z), 0.0);
        const g = positionGeometry;
        const s = g.x;
        const c = g.y;
        const which = g.z;
        const kind = part.x;
        const count = part.y;
        const grow = smoothstep(0.0, 0.25, open);
        const S = Q.radius.mul(mix(float(0.28), float(1.0), smoothstep(0.04, 0.85, open))).mul(grow).toVar();
        const A = Q.axis;
        const { centre } = Q;
        const h = fract(sin(which.mul(12.9898).add(kind.mul(78.233))).mul(43758.5453)).toVar();
        const P = vec3(centre).toVar();
        const N = vec3(A).toVar();
        const whorlPetal = (w, spin, offset, phase, scaleNode) => {
            const f = which.add(offset).div(count);
            // Each petal curves a little sideways along its length, its own way.
            const curl = fract(h.mul(3.7)).sub(0.5).mul(0.3).mul(s);
            const phi = f.mul(TAU).add(spin).add(h.sub(0.5).mul(select(kind.lessThan(0.5), float(0.2), float(0.14))))
                .add(curl);
            const R = Q.right.mul(cos(phi)).add(Q.up.mul(sin(phi)));
            // The unfurling runs round the whorl: each petal opens a little after the one before.
            const delay = fract(f.add(phase)).mul(QUEEN.wave);
            const o = smoothstep(0.0, 1.0, clamp(open.sub(delay).div(1.0 - QUEEN.wave), 0.0, 1.0));
            const alternate = select(fract(which.mul(0.5)).lessThan(0.25), float(0.03), float(-0.03));
            const jit = h.sub(0.5).mul(0.1).add(alternate);
            const breathe = sin(U.time.mul(0.7).add(which.mul(1.3)).add(kind)).mul(0.04).mul(o);
            const th0 = mix(float(w.th0[0]), float(w.th0[1]), o).add(jit);
            const th1 = mix(float(w.th1[0]), float(w.th1[1]), o).add(breathe).add(jit.mul(0.5));
            const spread = select(kind.lessThan(0.5), float(0.32), float(0.12));
            const len = S.mul(w.len).mul(mix(float(0.55), float(1.0), o)).mul(h.sub(0.5).mul(spread).add(1.0))
                .mul(scaleNode);
            const isOuter = kind.lessThan(0.5);
            const profile = select(isOuter, lobe(pow(max(s, 1e-4), 0.7), 0.6), lobe(pow(max(s, 1e-4), 1.35), 0.7));
            const broad = fract(h.mul(7.31)).mul(0.3).add(0.85);
            const half = S.mul(w.half).mul(mix(float(0.45), float(1.0), o)).mul(profile).mul(broad)
                .mul(scaleNode);
            const twist = w.twist ? h.sub(0.5).mul(2.0 * w.twist) : null;
            return strip(centre.add(R.mul(S.mul(w.r0))), R, A, th0, th1, len, s, c, half, w.cup, twist);
        };
        If(kind.lessThan(0.5), () => {
            const r = whorlPetal(WHORL.outer, age.mul(QUEEN.spin), 0.0, 0.0, float(1.0));
            P.assign(r.p);
            N.assign(r.n);
        }).ElseIf(kind.lessThan(1.5), () => {
            const r = whorlPetal(WHORL.inner, age.mul(QUEEN.spin), 0.5, 0.15, float(1.0));
            P.assign(r.p);
            N.assign(r.n);
        }).ElseIf(kind.lessThan(2.5), () => {
            // The second whorl (a perfect clear), turning the other way.
            const r = whorlPetal(WHORL.second, age.mul(QUEEN.counterSpin), 0.25, 0.3, perfect);
            P.assign(r.p);
            N.assign(r.n);
        }).ElseIf(kind.lessThan(3.5), () => {
            // A stamen: a fine filament arching out of the heart, an anther at its tip.
            const f = which.add(h.mul(0.6)).div(count);
            const phi = f.mul(TAU).add(age.mul(QUEEN.spin)).add(h.sub(0.3).mul(0.9).mul(s));
            const R = Q.right.mul(cos(phi)).add(Q.up.mul(sin(phi)));
            const o = smoothstep(0.15, 0.85, open);
            const len = S.mul(0.3).mul(h.mul(0.4).add(0.8));
            const knob = smoothstep(0.86, 0.94, s).mul(float(1.0).sub(smoothstep(0.97, 1.0, s)));
            const half = S.mul(0.0038).mul(knob.mul(2.4).add(1.0));
            const r = strip(
                centre.add(R.mul(S.mul(0.035))),
                R,
                A,
                mix(float(1.5), float(1.3), o).add(h.mul(0.12)),
                mix(float(1.52), float(0.25), o).sub(h.mul(0.3)),
                len,
                s,
                c,
                half,
                0.0,
            );
            P.assign(r.p);
            N.assign(r.n);
        })
            .ElseIf(kind.lessThan(4.5), () => {
            // The stigma: a star of lobes on the style, out in front of the stamens.
                const phi = which.div(count).mul(TAU).sub(age.mul(QUEEN.spin));
                const R = Q.right.mul(cos(phi)).add(Q.up.mul(sin(phi)));
                const o = smoothstep(0.3, 0.9, open);
                const half = S.mul(0.016).mul(lobe(pow(max(s, 1e-4), 0.8), 0.6));
                const r = strip(
                    centre.add(A.mul(S.mul(0.36).mul(o))).add(R.mul(S.mul(0.01))),
                    R,
                    A,
                    mix(float(1.4), float(0.15), o),
                    mix(float(1.5), float(-0.35), o),
                    S.mul(0.075),
                    s,
                    c,
                    half,
                    0.2,
                );
                P.assign(r.p);
                N.assign(r.n);
            })
            .Else(() => {
            // The heart: a shallow dome where the petals meet.
                const phi = c.mul(TAU);
                const R = Q.right.mul(cos(phi)).add(Q.up.mul(sin(phi)));
                const r = S.mul(0.1).mul(s);
                P.assign(centre.add(R.mul(r)).add(A.mul(S.mul(0.03).mul(float(1.0).sub(s.mul(s))))));
                N.assign(normalize(A.add(R.mul(s.mul(0.6)))));
            });
        // Where a lower petal would pass under the canal's water it spreads on it instead,
        // toward the eye: the length below the waterline is turned along the water.
        if (QUEEN.fold) {
            const level = float(FLOOR.canal.water + 0.04);
            const under = level.sub(P.y);
            const w = float(0.25);
            const excess = select(
                under.lessThan(w.negate()),
                float(0.0),
                select(under.greaterThan(w), under, under.add(w).mul(under.add(w)).div(w.mul(4.0))),
            );
            const bend = clamp(under.add(w).div(w.mul(2.0)), 0.0, 1.0);
            const flat = vec3(A.x, 0.0, A.z).div(max(length(A.xz), 1e-3));
            P.assign(P.add(vec3(0.0, excess, 0.0)).add(flat.mul(excess)));
            // The normal turns with the sheet (a quarter turn about the line across it): what
            // faced the eye faces up, what faced up faces away.
            const nf = dot(N, flat);
            const across = N.sub(flat.mul(nf)).sub(vec3(0.0, N.y, 0.0));
            const turned = across.add(vec3(0.0, nf, 0.0)).sub(flat.mul(N.y));
            N.assign(normalize(mix(N, turned, bend)));
        }
        vP.assign(P);
        vN.assign(N);
        vSC.assign(vec4(s, c, kind, h));
        return P;
    })();

    material.colorNode = Fn(() => {
        const open = U.queen.x;
        const glow = U.queen.y;
        const p = vP;
        const s = clamp(vSC.x, 0.0, 1.0);
        const c = clamp(vSC.y, -1.0, 1.0);
        const kind = vSC.z;
        const h = vSC.w;
        const inner = frontFacing;
        const nG = normalize(vN);
        const n = select(inner, nG, nG.negate());
        const v = normalize(cameraPosition.sub(p));
        const B = float(0.62).add(glow.mul(0.55)).mul(smoothstep(0.0, 0.18, open));
        const facing = clamp(abs(dot(n, v)), 0.0, 1.0);
        const ac = abs(c);
        // A petal's light from within: hot at its base (the heart's light through it), dimming to
        // the tip; fine parallel veins, a brighter midrib, and the thin margins glowing, so where
        // petals overlap each one's edge stands out against the one behind. Seen from behind (a
        // recurved tip) the light comes through dimmer.
        const base = mix(float(1.25), float(0.3), pow(smoothstep(0.0, 1.0, s), 0.7));
        const veins = pow(abs(cos(c.mul(Math.PI * 4.5).add(s.mul(1.5)))), 14.0).mul(float(1.0).sub(s.mul(0.5)))
            .mul(0.3);
        const mid = exp(c.div(0.1).mul(c.div(0.1)).negate()).mul(float(1.0).sub(s.mul(0.5))).mul(0.35);
        const margin = smoothstep(0.78, 1.0, ac).mul(0.7);
        // Light crosses more of the petal where the eye sees it edge-on, so it glows brighter there.
        const graze = float(1.0).sub(facing).mul(float(1.0).sub(facing)).mul(0.6);
        const tipGlow = smoothstep(0.85, 1.0, s).mul(0.25);
        const tip = float(1.0).sub(smoothstep(0.75, 1.0, s).mul(0.3));
        const through = select(inner, float(1.0), float(0.62));
        // She lights from within as she opens: a band of light runs from the heart out to the
        // tips; while she holds, a slow pulse follows it now and then, like breath.
        const age = max(U.time.sub(U.queen.z), 0.0);
        const run = s.sub(age.div(1.7).sub(0.15)).div(0.14);
        const wave = exp(run.mul(run).negate()).mul(float(1.0).sub(smoothstep(1.6, 2.6, age))).mul(1.1);
        const breath = fract(age.div(4.3).sub(s.mul(0.35)));
        const pulse = exp(breath.sub(0.5).div(0.08).mul(breath.sub(0.5).div(0.08)).negate()).mul(0.14)
            .mul(smoothstep(2.0, 3.0, age));
        const petalLevel = base.add(veins).add(mid).add(margin).add(graze)
            .add(tipGlow)
            .add(wave)
            .add(pulse)
            .mul(tip)
            .mul(through)
            .mul(h.mul(0.16).add(0.92))
            .mul(QUEEN.petal);
        // The outer tepals amber at the base, pale gold-pink out to their tips, a deeper line down
        // the middle; the inner whorl pure white; the second whorl warm white-gold.
        const isOuter = kind.lessThan(0.5);
        const amber = mix(
            mix(vec3(1.0, 0.42, 0.28), vec3(1.0, 0.7, 0.52), smoothstep(0.0, 0.45, s)),
            vec3(1.0, 0.9, 0.8),
            smoothstep(0.55, 1.0, s),
        );
        const outerTint = mix(amber, vec3(0.9, 0.36, 0.26), exp(c.div(0.22).mul(c.div(0.22)).negate()).mul(0.4))
            .mul(float(0.72).add(smoothstep(0.7, 1.0, ac).mul(0.4)));
        // The inner whorl: cream where the heart's warmth comes through, cooling to moonlit silver.
        const white = mix(
            mix(vec3(0.95, 1.0, 0.86), vec3(1.0, 0.99, 0.95), smoothstep(0.0, 0.3, s)),
            vec3(0.86, 0.93, 1.0),
            smoothstep(0.45, 1.0, s),
        );
        const whorl = select(kind.lessThan(1.5), white, vec3(1.0, 0.93, 0.78));
        const petal = select(isOuter, outerTint, whorl).mul(petalLevel);
        // The stamens: golden filaments, glowing anthers; the stigma cream; the heart blazing.
        const anther = smoothstep(0.84, 0.92, s);
        const stamen = mix(vec3(1.0, 0.86, 0.5).mul(1.1), vec3(1.0, 0.78, 0.36).mul(QUEEN.anther), anther);
        const stigma = vec3(1.0, 0.97, 0.88).mul(2.6);
        const heart = vec3(1.0, 0.9, 0.7).mul(QUEEN.heart).mul(float(1.0).sub(s.mul(0.5)));
        const isPetal = kind.lessThan(2.5);
        const crown = select(kind.lessThan(3.5), stamen, select(kind.lessThan(4.5), stigma, heart));
        const light = select(isPetal, petal, crown)
            .mul(B);
        // The moon's cold light on her, and four lines' flood of it.
        const moon = night.moonlight.mul(U.moonLight).mul(clamp(dot(n, U.moon), 0.0, 1.0).mul(0.05).add(0.02))
            .add(night.moonlight.mul(U.flood.mul(0.25)));
        // Translucent: the house shows faintly through the thin petals, most at their tips.
        const petalAlpha = mix(float(0.94), float(0.6), smoothstep(0.3, 1.0, s)).add(margin.mul(0.2));
        const alpha = select(isPetal, min(petalAlpha, 1.0), float(1.0)).mul(smoothstep(0.0, 0.12, open));
        return vec4(light.add(moon.mul(smoothstep(0.0, 0.1, open))), alpha);
    })();
    return material;
}

/** The Queen's radiance: a blazing heart and a wide soft glow round her, faint rays; additive. */
function queenGlowMaterial(U, Q) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    material.name = 'moonlit-greenhouse-queen-glow';
    const vQ = varyingProperty('vec4', 'mgQueenGlowQ');
    material.vertexNode = Fn(() => {
        const open = U.queen.x;
        const S = Q.radius.mul(mix(float(0.28), float(1.0), smoothstep(0.04, 0.85, open)))
            .mul(smoothstep(0.0, 0.25, open)).toVar();
        const at = Q.centre.sub(Q.axis.mul(S.mul(0.05)));
        const view = cameraViewMatrix.mul(vec4(at, 1.0)).toVar();
        const radius = S.mul(1.6);
        const q = positionGeometry.xy;
        vQ.assign(vec4(q, radius, S));
        return cameraProjectionMatrix.mul(vec4(view.xyz.add(vec3(q.mul(radius), 0.0)), 1.0));
    })();
    const shape = Fn(() => {
        const glow = U.queen.y;
        const open = U.queen.x;
        const q = vQ.xy;
        const S = max(vQ.w, 1e-4);
        const d = length(q).mul(vQ.z).div(S);
        const B = float(0.62).add(glow.mul(0.55)).mul(smoothstep(0.0, 0.18, open));
        const core = exp(d.div(0.12).mul(d.div(0.12)).negate()).mul(QUEEN.heart);
        const halo = exp(d.div(0.6).mul(d.div(0.6)).negate()).mul(QUEEN.halo)
            .add(exp(d.mul(-1.1)).mul(QUEEN.halo * 0.25));
        const ang = atan(q.y, q.x).add(U.time.mul(0.04));
        const rays = pow(abs(cos(ang.mul(9.0))), 8.0).mul(exp(d.mul(-1.25))).mul(QUEEN.rays)
            .mul(glow.mul(1.5).add(0.4));
        const fade = float(1.0).sub(smoothstep(0.85, 1.0, length(q)));
        return vec3(1.0, 0.9, 0.72).mul(core.add(halo).add(rays)).mul(B).mul(fade);
    });
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = vec4(shape(), 0.0);
    return material;
}

/** The Queen of the Night part. ctx = { tier, U }. */
export function createQueen({ tier, U }) {
    const Q = {
        centre: uniform(new THREE.Vector3(0, 3, -8.5)),
        axis: uniform(new THREE.Vector3(0, 0, 1)),
        right: uniform(new THREE.Vector3(1, 0, 0)),
        up: uniform(new THREE.Vector3(0, 1, 0)),
        radius: uniform(6),
    };
    const geometry = buildQueenGeometry(tier);
    const material = queenMaterial(U, Q);
    const flower = new THREE.Mesh(geometry, material);
    flower.name = 'moonlit-greenhouse-queen';
    flower.frustumCulled = false;
    flower.renderOrder = 50;
    const glowGeometry = quadGeometry();
    const glowMaterial = queenGlowMaterial(U, Q);
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.name = 'moonlit-greenhouse-queen-glow';
    glow.frustumCulled = false;
    glow.renderOrder = 58;
    const group = new THREE.Group();
    group.name = 'moonlit-greenhouse-queen';
    group.add(flower, glow);
    const pose = queenPose(null, 16 / 9);
    const apply = () => {
        Q.centre.value.fromArray(pose.centre);
        Q.axis.value.fromArray(pose.axis);
        Q.right.value.fromArray(pose.right);
        Q.up.value.fromArray(pose.up);
        Q.radius.value = pose.radius;
    };
    apply();
    return {
        mesh: group,
        update(world) {
            queenPose(world.frame, world.aspect, pose);
            apply();
        },
        dispose() {
            group.removeFromParent();
            geometry.dispose();
            material.dispose();
            glowGeometry.dispose();
            glowMaterial.dispose();
        },
    };
}
