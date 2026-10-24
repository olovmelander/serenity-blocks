/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE EARTH BELOW — the round planet the climb leaves, and its aurora (2026-10-24, steps 2 and 3
 * of docs/ODYSSEY_INTO_SPACE_2026-10.md).
 *
 * Olov wanted "a visually perfect journey into space", and the aurora to "fit into all of this".
 * After the climb (step 1) the world below was still flat: a straight limb line, and a band of
 * cloud painted ABOVE the horizon by the cloud bank, with the aurora standing on it as a wall and
 * the gas giant sitting on it like a ball on a floor. This is the planet instead: one exact sphere
 * below the eye, drawn from each view direction on a backdrop sphere round the camera.
 *
 *   - THE SURFACE is a sea of cloud (weather systems, clear ocean between them), lit by the sun:
 *     white on the day side, orange and red along the terminator (the sunset seen from above),
 *     dim slate on the night side, green under the aurora. Toward the limb the view crosses more
 *     air, so the surface sinks into it.
 *   - THE ATMOSPHERE is a thin rim just outside the limb: blue where the sun lights it, layered
 *     red to blue where the terminator meets the limb, deep blue on the night side with a faint
 *     airglow line above it.
 *   - THE SUN SETS as the eye rises (`orbitEarthAt`): the terminator comes in over the horizon
 *     ahead and passes under the eye, so the journey flies into the night.
 *   - THE AURORA lives on that night side: an oval round a pole beyond the horizon, its near arc
 *     crossing the night below, its far arc standing at the limb. Its curtains are real volumes,
 *     walked along each view ray through the air between their foot and their top (a sharp green
 *     foot, a green body dying upward, a faint crimson top, vertical rays), so the eye sees them
 *     from below while it is under them, edge-on at the limb, and from above as it climbs past.
 *
 * The geometry is solved in units of the Earth's radius with the eye at the origin, so the limb
 * keeps its precision at any height: a ray meets the sphere where `(k d.y)^2 > h (2 + h)` (k = 1 + h,
 * h the eye's height in radii), and the altitude of its closest approach, `k sqrt(1 - d.y^2) - 1`,
 * is negative exactly inside the disc. That one signed number anti-aliases the limb (over its own
 * screen derivative) and drives the rim's glow.
 *
 * DRAW ORDER. The Earth is the nearest thing in the sky: in front of everything in space, behind
 * the journey (the rail, the orbs). A transparent backdrop, renderOrder -0.5: after the sky domes
 * (-100), before every transparent thing at 0 or above (the orb glass, the rail's glow), which so
 * draw over it. Premultiplied: the disc whole, the rim a little, the aurora not at all (it only
 * adds light), and depth-tested so whatever is near and opaque stays in front. It writes no depth,
 * so the stars behind the aurora and the rim show. It sits at `radius`, inside every far thing
 * (the world's sea below the climbing eye, the giant) and outside the journey, so it comes in OVER
 * the world's far surfaces (see THE SEAM) and, once it covers the world (presence 1, when the
 * board hides the world's surfaces), a depth-only twin (`occluder`) marks its disc in the depth
 * buffer, so everything farther that draws after it (the star shells, the nebula, the giant's
 * rings, the black hole) is hidden behind the planet by depth, whatever its own draw order.
 *
 * THE SEAM (2026-10-24, Olov: "the earth just pops up and feel totally disconnected to the world
 * with mountains ocean and clouds"). The Earth never replaces the world in one frame. It comes in
 * over the world from the horizon down (`frontSin`, a front sweeping from the limb to the nadir as
 * it arrives), wearing the world's own air: veiled (`veil`) in exactly the colour the world gives
 * its far sea and its sky for that direction (`haze`, handed in by the world), which is also what
 * the world melts its sea and its clouds into just ahead of the front. So where the Earth arrives
 * nothing changes; then, above the haze, the veil clears and the round Earth comes up out of it.
 */
import * as THREE from 'three/webgpu';
import {
    Discard,
    Fn,
    If,
    Loop,
    abs,
    acos,
    atan,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fwidth,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    select,
    sin,
    smoothstep,
    sqrt,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';
import { latticeNoise3, LATTICE_NOISE_PERIOD } from '../chapter-environments/shared/odyssey-lattice-noise.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { AURORA_PALETTE } from '../chapter-environments/odyssey-planet-aurora.js';

export const ORBIT_EARTH = Object.freeze({
    /** The backdrop sphere's radius round the eye (world units) while the world shows (behind it:
     * the world shows the Earth on its own surfaces), and once the Earth covers the world: inside
     * every far hero (the giant is >= ~600 u away while the Earth shows), outside the journey (the
     * orbs ahead are <= ~430 u, above the limb). See DRAW ORDER. */
    radius: 1650,
    nearRadius: 320,
    /** Weather cells per radian of the Earth's arc (the broad systems; detail is finer). */
    cells: 70,
    /** Scale height of the rim's glow, in Earth radii. */
    rimHeight: 0.0055,
    /** The airglow line's height (Earth radii, the aurora's foot) and half-width. */
    airglowAlt: 0.0035,
    airglowWidth: 0.0009,
    /** How much air the view crosses straight down (the limb crosses ~1 / mu times as much). */
    airTau: 0.055,
});

/**
 * THE AURORAL OVAL, in the eye's own frame (it keeps its place under the sun as the eye travels).
 * The pole lies `poleArc` from the point beneath the eye toward the night (the sun's opposite
 * bearing); the oval is `radius` round it, so its near arc passes ~3.4 deg of arc ahead of the eye,
 * across the night side below, and curves toward the limb on both sides. Curtains stand from `foot`
 * to `top` (Earth radii; well below the climbing eye, as Earth's aurora is below an orbit), as three
 * folded sheets each `width` thick (radians of arc). The eye climbs past their tops a little after
 * they light, so they are seen at the limb first and then from above.
 */
export const ORBIT_EARTH_AURORA = Object.freeze({
    poleArc: 0.41,
    radius: 0.35,
    foot: 0.0035,
    top: 0.011,
    width: 0.0028,
    fold: 0.024,
    steps: 28,
    /** The longest path a ray may spend inside one sheet (radii), where it runs along it. */
    maxPath: 0.01,
    /** The soft glow round the sheets (their thickness), against their crossings. */
    soft: 0.06,
    gain: 170,
    /** The light's soft shoulder: seen edge-on at the limb the curtains are many times brighter
     * than from above, and this keeps both readable. */
    shoulder: 1.4,
});

/**
 * THE SCHEDULE, in fractions of chapter 6's span around the 5->6 boundary (so a re-layout carries
 * it). The Earth fades in over the flat world's far ground as the climb leaves it, the eye keeps
 * climbing (the limb dips further below the level), the sun sets (crossing the eye's horizon a
 * little before the boundary, so the terminator comes in over the horizon ahead and passes under
 * the eye), the aurora lights on the night side and fades before the black hole grows, and the
 * view leans down over the Earth, then lifts back to the rail as the Earth sinks out.
 */
export const ORBIT_EARTH_SCHEDULE = Object.freeze({
    /** Presence: in across [b - inFrom, b - inTo], out across [b + outFrom, b + outTo]. */
    inFrom: 0.55,
    inTo: 0.36,
    outFrom: 0.45,
    outTo: 0.55,
    /** The limb's dip below the level (degrees): from the flat world's own horizon... */
    dipStart: 5.4,
    /** ...growing by this much by b + outFrom, eased by this power. */
    dipGrowth: 40,
    dipPower: 3,
    /** The sun's elevation at the eye (degrees): from the world sun's, it sets (crosses 0) at
     * ~b - 0.17 span, so the night comes in time for the aurora, is at sunAtBoundary at the
     * boundary and sunEnd by b + outFrom. */
    sunAtBoundary: -7,
    sunEnd: -18,
    /** The aurora: in across [b - auroraIn[0], b - auroraIn[1]], out across
     * [b + auroraOut[0], b + auroraOut[1]]. */
    auroraIn: Object.freeze([0.20, 0.08]),
    auroraOut: Object.freeze([0.06, 0.16]),
    /** The view leans down by this much (degrees) on a lens this much wider (the Earth below
     * and the next orbs above both fit): in across [b - inFrom, b - leanIn], held to b + holdTo,
     * back across [b + holdTo, b + leanOut]. */
    lean: 26,
    widen: 8,
    leanIn: 0.30,
    holdTo: 0.10,
    leanOut: 0.38,
    /** THE PLANETRISE (step 4): the ringed giant hangs `riseDeg` below its seat (seen from the
     * rail at the rise's middle), behind the limb, and rises to it across [b - rise[0],
     * b + rise[1]], so it comes up over the Earth's edge while the aurora is up. */
    rise: Object.freeze([0.105, 0.15]),
    riseDeg: 27,
    /** THE SEAM: the Earth's front sweeps from its limb to the nadir as it arrives (eased by this
     * power, so it crosses the frame's lower half early), and its veil of the world's air clears
     * across [b - veil[0], b - veil[1]], once the front has crossed the frame. */
    frontPower: 1.5,
    veil: Object.freeze([0.36, 0.20]),
    /** The world's clouds go into the Earth (melt into what it shows behind them) across
     * [b - clouds[0], b - clouds[1]], once the climb has made them small; the Earth covers the
     * world when they have and it has fully arrived. */
    clouds: Object.freeze([0.44, 0.28]),
});

/** The presence at which the Earth covers the world: the board hides the world's surfaces, and
 * the Earth moves in front of the far heroes (see DRAW ORDER). */
export const ORBIT_EARTH_COVERS = 0.999;

const WORLD_SUN_ELEVATION = Math.asin(ODYSSEY_WORLD_SUN[1] / Math.hypot(...ODYSSEY_WORLD_SUN));
/** The world sun's bearing in the xz plane (from +x toward +z), which the setting sun keeps. */
export const ORBIT_EARTH_SUN_AZIMUTH = Math.atan2(ODYSSEY_WORLD_SUN[2], ODYSSEY_WORLD_SUN[0]);

const smooth01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/**
 * Where the Earth is at journey progress `p` (pure).
 * @param {number} p journey progress 0..1
 * @param {number[]} chapterPositions the live chapter boundaries
 * @returns {{ presence: number, dip: number, altitude: number, sunElevation: number,
 *   aurora: number, lookDownDeg: number, widenDeg: number, planetRise: number, frontSin: number,
 *   veil: number, cloudsAway: number, covers: boolean }} dip and sunElevation in radians; altitude in Earth radii; aurora 0..1; the
 *   view's lean (negative = down) and lens widening in degrees; planetRise 0..1, how far the giant
 *   has risen from behind the limb to its seat (1 without a layout); frontSin, the sine of the
 *   depression the Earth has come in to from its limb (1 = all of it); veil 0..1, how much of the
 *   world's air it still wears; cloudsAway 0..1, how far the world's clouds have gone into it;
 *   covers, whether it now covers the world (the world's surfaces are hidden)
 */
export function orbitEarthAt(p, chapterPositions) {
    const S = ORBIT_EARTH_SCHEDULE;
    const b = chapterPositions?.[5];
    const c = chapterPositions?.[6];
    const none = {
        presence: 0,
        dip: 0,
        altitude: 0,
        sunElevation: WORLD_SUN_ELEVATION,
        aurora: 0,
        lookDownDeg: 0,
        widenDeg: 0,
        planetRise: 1,
        frontSin: 1,
        veil: 0,
        cloudsAway: 0,
        covers: false,
    };
    if (!Number.isFinite(p) || !Number.isFinite(b) || !Number.isFinite(c) || c <= b) return none;
    const span = c - b;
    const start = b - (span * S.inFrom);
    const settle = b + (span * S.outFrom);
    const arrive = smooth01((p - start) / (span * (S.inFrom - S.inTo)));
    const presence = arrive * (1 - smooth01((p - settle) / (span * (S.outTo - S.outFrom))));
    const u = Math.min(1, Math.max(0, (p - start) / (settle - start)));
    const dipDeg = S.dipStart + (S.dipGrowth * (u ** S.dipPower));
    const dip = dipDeg * (Math.PI / 180);
    const toB = smooth01((p - start) / (b - start));
    const pastB = smooth01((p - b) / (settle - b));
    const sunElevation = WORLD_SUN_ELEVATION
        + ((((S.sunAtBoundary * Math.PI) / 180) - WORLD_SUN_ELEVATION) * toB)
        + ((((S.sunEnd - S.sunAtBoundary) * Math.PI) / 180) * pastB);
    const aurora = smooth01((p - (b - (span * S.auroraIn[0]))) / (span * (S.auroraIn[0] - S.auroraIn[1])))
        * (1 - smooth01((p - (b + (span * S.auroraOut[0]))) / (span * (S.auroraOut[1] - S.auroraOut[0]))));
    const leanIn = smooth01((p - start) / (span * (S.inFrom - S.leanIn)));
    const leanOut = smooth01((p - (b + (span * S.holdTo))) / (span * (S.leanOut - S.holdTo)));
    const lean = leanIn * (1 - leanOut);
    const cloudsAway = smooth01((p - (b - (span * S.clouds[0]))) / (span * (S.clouds[0] - S.clouds[1])));
    return {
        presence,
        dip,
        altitude: (1 / Math.cos(dip)) - 1,
        sunElevation,
        aurora: aurora * presence,
        lookDownDeg: -S.lean * lean,
        widenDeg: S.widen * lean,
        planetRise: smooth01((p - (b - (span * S.rise[0]))) / (span * (S.rise[0] + S.rise[1]))),
        frontSin: Math.sin(dip + (((Math.PI / 2) - dip) * (arrive ** S.frontPower))),
        veil: 1 - smooth01((p - (b - (span * S.veil[0]))) / (span * (S.veil[0] - S.veil[1]))),
        cloudsAway,
        covers: presence >= ORBIT_EARTH_COVERS && cloudsAway >= 0.999,
    };
}

/**
 * The elevation (radians) of the airglow line: over the Earth's limb at the airglow layer's height
 * once the eye is above that layer, and before that sinking from the line's old place a few
 * degrees over the level (continuous where the eye crosses the layer).
 * @param {number} altitude the eye's height in Earth radii
 * @param {number} presence 0..1, how far the Earth has arrived
 */
export function orbitEarthAirglowElevation(altitude, presence) {
    const a = ORBIT_EARTH.airglowAlt;
    const h = Math.max(Number.isFinite(altitude) ? altitude : 0, 0);
    const before = Math.asin(0.075);
    const over = h > a ? -Math.acos((1 + a) / (1 + h)) : before * (1 - (h / a));
    const pr = Math.min(Math.max(Number.isFinite(presence) ? presence : 0, 0), 1);
    return before + ((over - before) * pr);
}

/** The sun's direction (world frame) at an elevation, on the world sun's bearing. */
export function orbitEarthSunDirection(elevation, out = new THREE.Vector3()) {
    return out.set(
        Math.cos(ORBIT_EARTH_SUN_AZIMUTH) * Math.cos(elevation),
        Math.sin(elevation),
        Math.sin(ORBIT_EARTH_SUN_AZIMUTH) * Math.cos(elevation),
    );
}

const OCEAN = [0.010, 0.030, 0.070];
const CLOUD = [0.86, 0.89, 0.93];
const SUNLIGHT = [1.0, 0.97, 0.92];
const SUNSET = [1.0, 0.40, 0.14];
const SUNSET_DEEP = [0.75, 0.13, 0.07];
const NIGHT_LIGHT = [0.010, 0.014, 0.028];
const AIR_DAY = [0.26, 0.46, 0.95];
const AIR_NIGHT = [0.004, 0.009, 0.026];
const AIRGLOW = [0.20, 0.78, 0.46];
const TWO_PI = Math.PI * 2;
/** The aurora's three parallel sheets: which component of the march's distances, and how bright
 * (a real arc is a stack of curtains, the poleward ones fainter). */
const SHEETS = [['x', 1], ['y', 0.6], ['z', 0.35]];
/** The path a ray spends inside one sheet, per unit of how fast it crosses it (radians per radius):
 * the integral of the sheet's Gaussian profile `width` wide. */
const SHEET_PATH = Math.sqrt(Math.PI) * ORBIT_EARTH_AURORA.width;
/** How far from the oval's mean radius its sheets and their glow can reach (radians): the folds,
 * the wander, the poleward sheets' offsets and own folds, and the glow round them. */
const OVAL_REACH = (ORBIT_EARTH_AURORA.fold * (1 + 0.3 + 0.45)) + (ORBIT_EARTH_AURORA.width * (5.4 + 3.2 * 2.5));

// ── ONE EARTH, ONE LOOK ──────────────────────────────────────────────────────────────
// The Earth's state is the module's, not one mesh's: its backdrop draws it, and while it arrives
// the world's own sea, ground and clouds show it on their surfaces (THE SEAM, orbitEarthOver).
const U = {
    alt: uniform(0.01),
    sun: uniform(new THREE.Vector3(0, 1, 0)),
    presence: uniform(0),
    // The sine of the depression its front has come in to from its limb; -2 = not begun.
    frontSin: uniform(-2),
    veil: uniform(0),
    cloudsAway: uniform(0),
    aurora: uniform(0),
    track: uniform(new THREE.Vector3(0, 0, 0)),
    time: uniform(0),
};
// The oval's pole and two axes round it (world frame, from the sun's bearing): fixed.
const NIGHT_AZIMUTH = ORBIT_EARTH_SUN_AZIMUTH + Math.PI;
const POLE = new THREE.Vector3(
    Math.sin(ORBIT_EARTH_AURORA.poleArc) * Math.cos(NIGHT_AZIMUTH),
    Math.cos(ORBIT_EARTH_AURORA.poleArc),
    Math.sin(ORBIT_EARTH_AURORA.poleArc) * Math.sin(NIGHT_AZIMUTH),
).normalize();
const AXIS1 = new THREE.Vector3().crossVectors(POLE, new THREE.Vector3(0, 1, 0)).normalize();
const uPole = uniform(POLE);
const uAxis1 = uniform(AXIS1);
const uAxis2 = uniform(new THREE.Vector3().crossVectors(POLE, AXIS1).normalize());
const N_LAT = LATTICE_NOISE_PERIOD;
/** How far behind its front (in the sine of the depression) the Earth has cleared of the world's
 * air: it arrives in the world's haze and comes up out of it just behind its edge. */
const VEIL_BEHIND = 0.16;

// The oval at a point `n` on the unit sphere (its direction from the centre): its angle from
// the pole, the folded centre line of its sheets there, the sheets' activity and rays (which
// run along the oval, so a curtain seen side-on shows them upright, field-aligned), and a broad
// glow round their feet for the light they cast on the cloud below.
function ovalAt(n) {
    const ang = acos(clamp(dot(n, uPole), -1, 1));
    const phi = atan(dot(n, uAxis2), dot(n, uAxis1));
    const turn = phi.div(TWO_PI).add(0.5); // 0..1 round the oval, seamless
    const t = U.time;
    // Folds fast enough round the oval that the stretch in view meanders (only ~1/10 of the
    // oval is ever on screen): integer frequencies, so the seam round the oval joins.
    const fold = sin(phi.mul(11).add(t.mul(0.031))).mul(0.5)
        .add(sin(phi.mul(27).sub(t.mul(0.047)).add(1.7)).mul(0.3))
        .add(sin(phi.mul(53).add(t.mul(0.083)).add(4.1)).mul(0.2));
    const wander = latticeNoise3(vec3(turn.mul(N_LAT * 4), 7.1, t.mul(0.04))).sub(0.5);
    const centre = float(ORBIT_EARTH_AURORA.radius).add(fold.mul(ORBIT_EARTH_AURORA.fold))
        .add(wander.mul(ORBIT_EARTH_AURORA.fold * 0.6));
    // The poleward sheets keep their own folds, so the stack is never three copies.
    const own2 = sin(phi.mul(19).add(t.mul(0.057)).add(2.3)).mul(ORBIT_EARTH_AURORA.fold * 0.35);
    const own3 = sin(phi.mul(37).sub(t.mul(0.069)).add(5.2)).mul(ORBIT_EARTH_AURORA.fold * 0.45);
    const near = ang.sub(centre.sub(ORBIT_EARTH_AURORA.width * 2.6)).div(0.03);
    const glow = exp(near.mul(near).negate());
    const activity = smoothstep(0.32, 0.74, latticeNoise3(vec3(turn.mul(N_LAT * 3), 3.3, t.mul(0.05))))
        .mul(0.92).add(0.08);
    const ray = latticeNoise3(vec3(turn.mul(N_LAT * 20).add(fold.mul(2.4)), 1.0, t.mul(0.22)));
    const rays = ray.mul(ray).mul(1.6);
    return {
        ang, centre, own2, own3, activity, rays, glow,
    };
}

/**
 * The Earth along the unit view direction `dir` (world frame) from the eye, inside a Fn: its
 * colour, premultiplied by how much of the view it fills (the surface inside the disc, the air's
 * rim a little outside it), worn in the world's `air` (a colour node) just behind its front while
 * it arrives, and `alpha`, how much of the view it covers once its front and its presence are
 * counted. The aurora's curtains are the backdrop's own (createOrbitEarth).
 */
function earthLook(dir, air = null) {
    const E = ORBIT_EARTH;
    const h = U.alt;
    const k = h.add(1).toVar();
    const dy = dir.y.toVar();
    const disc = k.mul(k).mul(dy).mul(dy)
        .sub(h.mul(h.add(2)))
        .toVar();
    // The altitude of the ray's closest approach to the planet (radii): negative inside the
    // disc. A ray that climbs is nearest at the eye itself.
    const cosH = sqrt(max(float(1).sub(dy.mul(dy)), 0)).toVar();
    const aClose = select(dy.lessThan(0), k.mul(cosH).sub(1), h).toVar();

    // ── THE SURFACE (evaluated at the limb for rays that miss: finite, then blended away) ──
    const t = k.mul(dy).negate().sub(sqrt(max(disc, 0))).toVar();
    const N = normalize(dir.mul(t).add(vec3(0, k, 0))).toVar();
    const mu = clamp(dot(N, dir.negate()), 0, 1).toVar();
    // The cloud sea, as weather seen from orbit: broad systems swirled by a slow warp, a cloud
    // fraction that runs from clear ocean to overcast across them, and detail octaves that
    // fade out where their cells fall under a pixel (they would only shimmer there). The
    // domain slides with the eye's travel and a slow drift.
    const p0 = N.mul(E.cells).add(U.track).add(vec3(U.time.mul(0.002), 0, U.time.mul(-0.0015))).toVar();
    const foot = length(fwidth(p0)).toVar();
    const room = (freq) => float(1).sub(smoothstep(0.22, 0.55, foot.mul(freq)));
    const warp = vec3(
        latticeNoise3(p0.mul(0.35).add(vec3(3.1, 7.7, 1.9))),
        0.5,
        latticeNoise3(p0.mul(0.35).add(vec3(11.3, 2.2, 5.4))),
    ).sub(0.5).mul(2.2);
    const pw = p0.add(warp).toVar();
    const n1 = latticeNoise3(pw);
    const n2 = mix(float(0.5), latticeNoise3(pw.mul(2.03).add(vec3(17.1, 3.3, 9.7))), room(2.03));
    const n3 = mix(float(0.5), latticeNoise3(pw.mul(4.11).add(vec3(5.2, 31.4, 13.6))), room(4.11));
    const n4 = mix(float(0.5), latticeNoise3(pw.mul(8.3).add(vec3(29.7, 13.1, 3.8))), room(8.3));
    const cloudN = n1.mul(0.5).add(n2.mul(0.25)).add(n3.mul(0.15))
        .add(n4.mul(0.10))
        .toVar();
    const fraction = latticeNoise3(p0.mul(0.18).add(vec3(23.0, 9.0, 17.0)));
    const thresh = mix(float(0.62), float(0.38), fraction).toVar();
    const cover = smoothstep(thresh.sub(0.10), thresh.add(0.08), cloudN).toVar();
    const thick = smoothstep(thresh, thresh.add(0.22), cloudN);
    const albedo = mix(vec3(...OCEAN), vec3(...CLOUD).mul(thick.mul(0.28).add(0.72)), cover).toVar();
    // The sun: light reaches a little past the terminator (twilight), warm along it.
    const sd = dot(N, U.sun).toVar();
    const lit = smoothstep(-0.07, 0.10, sd);
    const warm = float(1).sub(smoothstep(0.0, 0.32, sd));
    const sunCol = mix(
        mix(vec3(...SUNLIGHT), vec3(...SUNSET), warm),
        vec3(...SUNSET_DEEP),
        float(1).sub(smoothstep(-0.05, 0.03, sd)),
    );
    const night = float(1).sub(smoothstep(-0.10, 0.05, sd)).toVar();
    const surf = albedo.mul(sunCol).mul(lit).add(albedo.mul(vec3(...NIGHT_LIGHT))).toVar();
    // The aurora lights the cloud tops under it green (a broad glow round the oval's foot).
    If(U.aurora.greaterThan(0.001), () => {
        const under = ovalAt(N);
        surf.addAssign(albedo.mul(vec3(...AURORA_PALETTE.greenWarm)).mul(under.glow.mul(under.activity))
            .mul(U.aurora.mul(night).mul(0.16)));
    });
    // The air between the eye and the surface: more of it toward the limb.
    const airT = float(1).sub(exp(float(E.airTau).negate().div(max(mu, 0.03)))).toVar();
    const day = smoothstep(-0.12, 0.25, sd);
    const airCol = mix(vec3(...AIR_NIGHT), vec3(...AIR_DAY).mul(0.55), day)
        .add(vec3(...SUNSET).mul(warm.mul(day).mul(0.35)));
    const surface = mix(surf, airCol, airT.mul(0.92));

    // ── THE RIM: the air seen edge-on just outside the limb ──
    const tc = max(k.mul(dy).negate(), 0);
    const Q = normalize(dir.mul(tc).add(vec3(0, k, 0)));
    const sdRim = dot(Q, U.sun).toVar();
    const above = max(aClose, 0);
    // Only rays that look down toward the limb see the rim: it tapers from the limb to nothing
    // at the level, over the limb's own dip, so the sky above belongs to the dome (and to the
    // dark) however high the eye, with no edge where the taper ends.
    const sinDip = sqrt(h.mul(h.add(2))).div(k);
    const glow = exp(above.div(E.rimHeight).negate())
        .mul(smoothstep(0.0, sinDip, dy.negate())).toVar();
    const dayRim = smoothstep(-0.10, 0.20, sdRim);
    const warmRim = float(1).sub(smoothstep(-0.02, 0.30, sdRim)).mul(smoothstep(-0.16, 0.0, sdRim));
    // Layered at the sunset: red low, blue above it.
    const layered = mix(vec3(...SUNSET), vec3(...AIR_DAY), smoothstep(0.0, E.rimHeight * 2.2, above));
    const rimCol = mix(vec3(...AIR_NIGHT).mul(2.2), vec3(...AIR_DAY).mul(0.55), dayRim)
        .add(layered.mul(warmRim).mul(0.9));
    const airglowLine = exp(above.sub(E.airglowAlt).div(E.airglowWidth).pow2().negate())
        .mul(float(1).sub(dayRim)).mul(0.07);
    const rim = rimCol.mul(glow).add(vec3(...AIRGLOW).mul(airglowLine));
    const rimAlpha = clamp(glow.mul(mix(float(0.25), float(0.55), dayRim)), 0, 1);

    // ── ONE EDGE: coverage of the disc over the limb's own screen derivative ──
    const edge = max(fwidth(aClose), 1e-7);
    const coverage = clamp(float(0.5).sub(aClose.div(edge)), 0, 1);
    const rgb = mix(rim, surface, coverage).toVar();
    const alpha = mix(rimAlpha, float(1), coverage).toVar();
    // THE SEAM: it arrives in the world's air and clears just behind its front, and it covers the
    // view only where its front has come in, from the horizon down.
    const down = dy.negate();
    if (air) {
        const veil = float(1).sub(smoothstep(float(0), float(VEIL_BEHIND), U.frontSin.sub(down))).mul(U.veil);
        rgb.assign(mix(rgb, air.mul(alpha), veil));
    }
    const arrived = float(1).sub(smoothstep(U.frontSin.sub(0.03), U.frontSin.add(0.03), down))
        .mul(U.presence)
        .toVar();
    return {
        colour: rgb, alpha: alpha.mul(arrived).toVar(), arrived, h, k, dy, disc, t,
    };
}

/**
 * THE SEAM, for the world's own surfaces: what the eye sees along `dir` where the world's `air` (a
 * colour node: what the world's far sea and sky meet in there) lies behind the Earth: the Earth
 * where it has come in, the air elsewhere. Call inside a Fn.
 */
export function orbitEarthOver(dir, air) {
    const look = earthLook(dir, air);
    return look.colour.add(air.mul(float(1).sub(look.alpha)));
}

/** The Earth's live seam state for the world's materials: its presence, its front (sine of the
 * depression; -2 before it begins) and how far the world's clouds have gone into it (0..1). */
export const ORBIT_EARTH_SEAM = Object.freeze({
    presence: U.presence,
    frontSin: U.frontSin,
    cloudsAway: U.cloudsAway,
});

/**
 * @param {object} [opts]
 * @param {number} [opts.radius] backdrop radius (world units)
 * @param {(dir: *) => *} [opts.haze] the world's air for a view direction (a TSL node builder:
 *   the colour the world gives its far sea and sky there), which the Earth wears while it arrives
 * @returns {{
 *   mesh: THREE.Mesh,
 *   occluder: THREE.Mesh,
 *   update: (s: { altitude: number, sun: {x:number,y:number,z:number}, presence: number,
 *     aurora?: number, track?: {x:number,y:number,z:number}, eye: {x:number,y:number,z:number},
 *     time?: number, frontSin?: number, veil?: number, cloudsAway?: number,
 *     covers?: boolean }) => void,
 *   dispose: () => void,
 * }}
 */
export function createOrbitEarth({ radius = ORBIT_EARTH.radius, haze = null } = {}) {
    const E = ORBIT_EARTH;
    const A = ORBIT_EARTH_AURORA;
    const greenWarm = vec3(...AURORA_PALETTE.greenWarm);
    const greenCool = vec3(...AURORA_PALETTE.greenCool);
    const crimson = vec3(...AURORA_PALETTE.crimson);
    const shade = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const look = earthLook(dir, haze ? haze(dir) : null);
        const {
            k, dy, disc, t,
        } = look;

        // ── THE AURORA'S CURTAINS: walked along the ray through the air they stand in ──
        // The ray's stretch inside the shell between the curtains' foot (r1) and top (r2), in
        // front of the surface: [outer in, inner in] and [inner out, outer out], clipped to the eye
        // and the ground. The closest approach is at tStar = -k dy, radius^2 rMin2 there.
        const light = vec3(0).toVar();
        If(U.aurora.greaterThan(0.001), () => {
            // The point `tv` along the ray, in the Earth's frame (radii, its centre at the origin).
            const along = (tv) => vec3(dir.x.mul(tv), dir.y.mul(tv).add(k), dir.z.mul(tv));
            const r1 = 1 + A.foot;
            const r2 = 1 + A.top;
            const tStar = k.mul(dy).negate().toVar();
            const rMin2 = k.mul(k).mul(float(1).sub(dy.mul(dy))).toVar();
            const s2 = sqrt(max(float(r2 * r2).sub(rMin2), 0)).toVar();
            const s1 = sqrt(max(float(r1 * r1).sub(rMin2), 0)).toVar();
            const inOuter = rMin2.lessThan(r2 * r2);
            const inInner = rMin2.lessThan(r1 * r1);
            const ground = select(disc.greaterThan(0).and(dy.lessThan(0)), t, float(1e6)).toVar();
            const a0 = max(tStar.sub(s2), 0).toVar();
            const a1 = min(select(inInner, tStar.sub(s1), tStar.add(s2)), ground).toVar();
            const b0 = max(tStar.add(s1), 0).toVar();
            const b1 = min(tStar.add(s2), ground).toVar();
            const lenA = select(inOuter, max(a1.sub(a0), 0), float(0)).toVar();
            const lenB = select(inOuter.and(inInner), max(b1.sub(b0), 0), float(0)).toVar();
            const total = lenA.add(lenB).toVar();
            // Only rays whose stretch through the shell comes near the oval march (the shell is
            // thin, so its ends and middle bound how far from the pole the stretch reaches).
            const angOf = (tv) => acos(clamp(dot(normalize(along(tv)), uPole), -1, 1));
            const first = select(lenA.greaterThan(0), a0, b0);
            const last = select(lenB.greaterThan(0), b1, a1);
            const angA = angOf(first).toVar();
            const angB = angOf(last).toVar();
            const angM = angOf(first.add(last).mul(0.5)).toVar();
            const reach = float(A.radius - OVAL_REACH);
            const beyond = float(A.radius + OVAL_REACH);
            const nearOval = max(angA, max(angB, angM)).greaterThan(reach)
                .and(min(angA, min(angB, angM)).lessThan(beyond));
            If(total.greaterThan(1e-6).and(nearOval), () => {
                // The sheets are surfaces (cones round the pole, folded): sample how far each is
                // from the ray at the ends of each step, and where the sign turns the ray crossed
                // it. Each crossing is lit by its height (a sharp green foot, a body dying upward,
                // a faint crimson top) and its rays, over the path the ray spends inside a sheet
                // `width` thick there, which brightens a curtain seen edge-on.
                const step = total.div(A.steps).toVar();
                const prevT = float(0).toVar();
                const prevF = vec3(0).toVar();
                Loop({
                    start: int(0), end: int(A.steps + 1), type: 'int', condition: '<',
                }, ({ i }) => {
                    const s = float(i).mul(step).toVar();
                    const tt = select(s.lessThanEqual(lenA).and(lenA.greaterThan(0)), a0.add(s), b0.add(s.sub(lenA)))
                        .toVar();
                    const Xs = along(tt).toVar();
                    const o = ovalAt(normalize(Xs));
                    const d = o.ang.sub(o.centre).toVar();
                    const f = vec3(d, d.add(o.own2).add(A.width * 2.6), d.add(o.own3).add(A.width * 5.4)).toVar();
                    // The sheets' thickness: a soft glow round each, sampled (the ray just past a
                    // fold's silhouette still passes through the curtain's edge).
                    const altS = length(Xs).sub(1);
                    const fw = f.div(A.width * 3.2);
                    const near = exp(fw.x.mul(fw.x).negate())
                        .add(exp(fw.y.mul(fw.y).negate()).mul(0.6))
                        .add(exp(fw.z.mul(fw.z).negate()).mul(0.35));
                    light.addAssign(greenWarm.mul(near.mul(step).mul(A.soft)
                        .mul(smoothstep(A.foot - 0.0004, A.foot + 0.0004, altS))
                        .mul(exp(altS.sub(A.foot).div(0.003).negate()))));
                    If(i.greaterThan(int(0)), () => {
                        const dt = max(tt.sub(prevT), 1e-6).toVar();
                        SHEETS.forEach(([c, weight]) => {
                            const fa = prevF[c];
                            const fb = f[c];
                            If(fa.mul(fb).lessThan(0), () => {
                                const X = along(prevT.add(dt.mul(fa.div(fa.sub(fb))))).toVar();
                                const r = length(X).toVar();
                                const alt = r.sub(1).toVar();
                                const oc = ovalAt(X.div(r));
                                const crossing = abs(fb.sub(fa)).div(dt);
                                const inside = float(SHEET_PATH).div(max(crossing, SHEET_PATH / A.maxPath));
                                const lower = smoothstep(A.foot - 0.00025, A.foot + 0.00012, alt);
                                const body = exp(alt.sub(A.foot).div(0.003).negate());
                                const high = exp(alt.sub(A.top - 0.0025).div(0.002).pow2().negate()).mul(0.16);
                                const green = mix(greenWarm, greenCool, oc.rays)
                                    .mul(lower.mul(body).mul(oc.rays.mul(0.7).add(0.3)));
                                light.addAssign(green.add(crimson.mul(high)).mul(oc.activity.mul(weight).mul(inside)));
                            });
                        });
                    });
                    prevF.assign(f);
                    prevT.assign(tt);
                });
            });
            light.mulAssign(A.gain);
            // The soft shoulder (by the brightest channel, so the hue holds).
            light.divAssign(max(light.x, max(light.y, light.z)).mul(A.shoulder).add(1));
            light.mulAssign(U.aurora);
        });
        const out = look.alpha;
        // Nothing outside the disc, its rim and the aurora (it only adds light, so no alpha).
        Discard(out.lessThan(0.004).and(dot(light, vec3(1)).lessThan(0.002)));
        return vec4(look.colour.add(light).mul(look.arrived), out);
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyOrbitEarth';
    // Premultiplied, written whole as the output (one build of the shading): the light is added
    // and the sky behind is covered by the alpha (the disc whole, the rim a little).
    material.outputNode = shade;
    material.premultipliedAlpha = true;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.side = THREE.BackSide;
    material.fog = false;
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), material);
    mesh.name = 'odyssey-orbit-earth';
    mesh.renderOrder = -0.5;
    mesh.frustumCulled = false;
    mesh.visible = false;

    // The disc in the depth buffer once the Earth covers the world (DRAW ORDER): the same sphere a
    // hair outside the backdrop (so the backdrop passes in front of it), no colour, depth only
    // where the view ray meets the planet. Opaque, so it is written before anything transparent.
    const occluderMaterial = new THREE.MeshBasicNodeMaterial();
    occluderMaterial.name = 'OdysseyOrbitEarthOccluder';
    occluderMaterial.colorWrite = false;
    occluderMaterial.depthWrite = true;
    occluderMaterial.depthTest = true;
    occluderMaterial.side = THREE.BackSide;
    occluderMaterial.fog = false;
    occluderMaterial.outputNode = Fn(() => {
        const dy = normalize(positionWorld.sub(cameraPosition)).y.toVar();
        const k = U.alt.add(1);
        Discard(dy.greaterThanEqual(0).or(k.mul(k).mul(dy).mul(dy).lessThanEqual(U.alt.mul(U.alt.add(2)))));
        return vec4(0, 0, 0, 1);
    })();
    const occluder = new THREE.Mesh(mesh.geometry, occluderMaterial);
    occluder.name = 'odyssey-orbit-earth-occluder';
    occluder.scale.setScalar(1.006);
    occluder.frustumCulled = false;
    occluder.visible = false;
    mesh.add(occluder);

    return {
        mesh,
        occluder,
        update({
            altitude, sun, presence, aurora = 0, track = null, eye, time = 0, frontSin = 1, veil = 0,
            cloudsAway = 0, covers = false,
        }) {
            const pr = Math.min(Math.max(Number.isFinite(presence) ? presence : 0, 0), 1);
            mesh.visible = pr > 0.001 && !!eye;
            // The seam state is read by the world's materials too: nothing while there is no Earth.
            U.presence.value = mesh.visible ? pr : 0;
            U.frontSin.value = mesh.visible && Number.isFinite(frontSin) ? frontSin : -2;
            U.cloudsAway.value = mesh.visible ? Math.min(Math.max(Number.isFinite(cloudsAway) ? cloudsAway : 0, 0), 1) : 0;
            U.veil.value = Math.min(Math.max(Number.isFinite(veil) ? veil : 0, 0), 1);
            if (!mesh.visible) return;
            U.aurora.value = Math.min(Math.max(Number.isFinite(aurora) ? aurora : 0, 0), 1);
            U.alt.value = Math.max(Number.isFinite(altitude) ? altitude : 0.01, 1e-5);
            U.sun.value.set(sun.x, sun.y, sun.z).normalize();
            if (track) U.track.value.set(track.x, track.y, track.z);
            U.time.value = time;
            mesh.position.set(eye.x, eye.y, eye.z);
            // Behind the world while it shows (the world shows the Earth on its own surfaces); in
            // front of the far heroes, its disc in depth, once it covers the world.
            mesh.scale.setScalar(covers ? E.nearRadius / radius : 1);
            occluder.visible = !!covers;
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
            occluderMaterial.dispose();
        },
    };
}
