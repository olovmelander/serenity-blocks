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
 *   - THE SURFACE is the planet (ORBIT_EARTH_SURFACE): oceans and continents under weather
 *     systems, lit by the sun: day colours on the day side, orange and red along the terminator
 *     (the sunset seen from above), dim slate and the lights of towns on the night side, green
 *     under the aurora. Toward the limb the view crosses more air, so the surface sinks into it.
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
    cos,
    cross,
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
    reflect,
    select,
    sin,
    smoothstep,
    sqrt,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';
import {
    latticeNoise3,
    latticeNoise3Cpu,
    LATTICE_NOISE_PERIOD,
} from '../chapter-environments/shared/odyssey-lattice-noise.js';
import { AURORA_PALETTE } from '../chapter-environments/odyssey-planet-aurora.js';

export const ORBIT_EARTH = Object.freeze({
    /** The backdrop sphere's radius round the eye (world units) while the world shows: behind
     * everything the world draws (its sea runs out to the camera's far plane, 9000), so the world
     * shows the Earth on its own surfaces and the backdrop only past them; and once the Earth
     * covers the world: inside every far hero (the giant is >= ~600 u away while the Earth shows),
     * outside the journey (the orbs ahead are <= ~430 u, above the limb). See DRAW ORDER. */
    radius: 8800,
    nearRadius: 320,
    /** THE ONE ALTITUDE (2026-10-26): the world's scale, metres per world unit. The Earth stands at
     * the eye's own climbed height over the sea in these units (the mountain is ~3 km, the cumulus
     * tops ~8.5 km, the eye ~150 km at the 5->6 boundary, where the old schedule had put it too). */
    metresPerUnit: 4.9,
    earthRadiusM: 6.371e6,
    /** Weather cells per radian of the Earth's arc (the broad systems; detail is finer). */
    cells: 70,
    /** How far the weather slides under the eye per world unit it travels (cells): the pace the
     * world's own sea passes under it at the seam (cells x altitude / the climbed eye's height
     * there, ~9e-5), so the far Earth never runs faster than the near clouds over it (2026-10-25:
     * at 0.2 it ran ~2000x faster; its weather rushed past while the sea above it stood still,
     * and a touchpad swipe turned it into a blur). */
    trackPerUnit: 9e-5,
    /** Scale height of the rim's glow, in Earth radii, and the eye's heights (radii) across which
     * the glowing edge comes up (below them the horizon is the world's haze). */
    rimHeight: 0.0055,
    rimFrom: Object.freeze([0.0022, 0.0065]),
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
 * THE PLANET ITSELF (2026-10-25). Olov, at the top of the climb: "When we start to see the earth
 * above the cloud, can we make it look like the earth with ocean, landmasses and contintents? And
 * can we improve the clouds?" It was an ocean under soft blobs of cloud.
 *
 * - CONTINENTS: a height field on the sphere (warped octaves of the baked lattice, the finest
 *   faded where they fall under a pixel), cut at `seaLevel`. Open sea is kept round the point
 *   beneath the eye (`homeOcean`): the world's own sea becomes this ocean in place at the seam.
 *   `orbitEarthLandHeight` is its CPU twin (the same bytes), so the layout is pinned by tests.
 * - LAND by latitude from the pole (`poleArc` from beneath the eye, toward the night): ice cap,
 *   tundra, boreal and temperate forest, steppe and desert where it is dry, rock and snow on the
 *   ridges; shallows round the coasts; the sun's glint on open water.
 * - CLOUDS: weather systems wound round two cyclones, crisper cumulus edges (antialiased by the
 *   field's own derivative, not a wide blur), thin and thick cloud (the sea shows through thin),
 *   lit on the side toward the sun and casting shadows on the ground, and a veil of cirrus.
 * - NIGHT: the coasts and plains glow with towns, under the clouds.
 */
export const ORBIT_EARTH_SURFACE = Object.freeze({
    /** The broadest continent features per radian of arc, and the warp that bends their coasts. */
    landScale: 2.8,
    landWarp: 1.1,
    /** Where in the lattice the continents are cut (the layout; see orbit-earth tests). */
    landSeed: Object.freeze([59.91, 9.01, 10.52]),
    /** The height field's sea level (0..1; ~a third land). */
    seaLevel: 0.53,
    /** Open sea kept round the point beneath the eye (radians of arc), and how deep it is cut. */
    homeOcean: 0.005,
    homeDepth: 0.3,
    /** How far below sea level the shallows reach (height units). */
    shelf: 0.014,
    /** The geographic pole: this far (radians) from beneath the eye, toward the night. The ice cap
     * reaches `iceCap` from it. */
    poleArc: 0.85,
    iceCap: 0.3,
    /** The cloud layer's height (radii): how long its shadows fall at a low sun. */
    cloudHeight: 0.0016,
    /** Night lights: how bright the towns glow (linear). */
    cityGain: 0.08,
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
    /** Presence: in across [b - arriveFrom, b - arriveTo] (2026-10-26: as the departure begins,
     * before the world's sky deepens, the Earth is simply there beneath and beyond the world, at
     * the eye's own height, in the world's own air; nothing sweeps in), out across
     * [b + outFrom, b + outTo]. `inFrom` still anchors the dip, the sunset and the lean. */
    arriveFrom: 1.05,
    arriveTo: 0.92,
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
     * [b + auroraOut[0], b + auroraOut[1]] (up until the giant is clear of the limb). */
    auroraIn: Object.freeze([0.20, 0.08]),
    auroraOut: Object.freeze([0.14, 0.24]),
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
    rise: Object.freeze([0.06, 0.30]),
    riseDeg: 38,
    /** ...slanted this far (degrees, about the line to it): it comes up from lower right, so it
     * rises in the right third of the frame, clear of the rail and the orbs on it (2026-10-25:
     * rising straight up it stood behind the rail with an orb in front of it). Depth, slant and
     * window were searched on the real camera: its rings keep >= 0.16 (ndc height) from every orb
     * and from the rail at 16:9 and 4:3, where the old rise overlapped both (by 0.26 and 0.17).
     * The orb that passes level with its seat (p ~0.77) is why it rises slowly: it is still low
     * and to the right when that orb goes by. */
    riseSlant: -45,
    /** THE ONE ALTITUDE: the schedule's own height (the dip below) takes over from the eye's
     * climbed height across [b - late[0], b - late[1]] (the two within ~10 % there; from the
     * boundary on the schedule's alone, as the world is gone and the eye rises faster than it). */
    late: Object.freeze([0.25, 0.08]),
    /** The world's clouds go into the Earth (melt into what it shows behind them) across
     * [b - clouds[0], b - clouds[1]], once the climb has made them small; the Earth covers the
     * world when they have and it has fully arrived. */
    clouds: Object.freeze([0.38, 0.28]),
});

/** The presence at which the Earth covers the world: the board hides the world's surfaces, and
 * the Earth moves in front of the far heroes (see DRAW ORDER). */
export const ORBIT_EARTH_COVERS = 0.999;

// The sun the departure was composed under (the sunset's timing, the aurora's place on the night
// side, the planetrise beside it), pinned: the world's own sun turned to the side for Act II
// (2026-10-25), and the Earth's sun sits behind the eye at the seam either way.
const EARTH_SUN = Object.freeze([-0.46, 0.36, 0.61]);
const WORLD_SUN_ELEVATION = Math.asin(EARTH_SUN[1] / Math.hypot(...EARTH_SUN));
/** The world sun's bearing in the xz plane (from +x toward +z), which the setting sun keeps. */
export const ORBIT_EARTH_SUN_AZIMUTH = Math.atan2(EARTH_SUN[2], EARTH_SUN[0]);

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
export function orbitEarthAt(p, chapterPositions, eyeHeight = null) {
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
    const arrive = smooth01((p - (b - (span * S.arriveFrom))) / (span * (S.arriveFrom - S.arriveTo)));
    const presence = arrive * (1 - smooth01((p - settle) / (span * (S.outTo - S.outFrom))));
    const u = Math.min(1, Math.max(0, (p - start) / (settle - start)));
    const dipDeg = S.dipStart + (S.dipGrowth * (u ** S.dipPower));
    // THE ONE ALTITUDE (2026-10-26): the eye's own climbed height over the sea, in Earth radii,
    // until the schedule's height (which runs on past the world) takes over near the boundary.
    // Without the eye's height (the scroll pace, the playground) the schedule alone.
    const scheduled = (1 / Math.cos(dipDeg * (Math.PI / 180))) - 1;
    let altitude = scheduled;
    if (Number.isFinite(eyeHeight) && eyeHeight > 0) {
        const own = (eyeHeight * ORBIT_EARTH.metresPerUnit) / ORBIT_EARTH.earthRadiusM;
        const late = smooth01((p - (b - (span * S.late[0]))) / (span * (S.late[0] - S.late[1])));
        altitude = Math.max(own, scheduled * late);
    }
    const dip = Math.acos(1 / (1 + altitude));
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
    // No front and no veil any more: the Earth is there wherever it is seen, in the world's air.
    const veil = 0;
    return {
        presence,
        dip,
        altitude,
        sunElevation,
        aurora: aurora * presence,
        lookDownDeg: -S.lean * lean,
        widenDeg: S.widen * lean,
        planetRise: smooth01((p - (b - (span * S.rise[0]))) / (span * (S.rise[0] + S.rise[1]))),
        frontSin: 1.5,
        veil,
        cloudsAway,
        covers: presence >= ORBIT_EARTH_COVERS && cloudsAway >= 0.999 && veil <= 0.001,
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
const OCEAN_DEEP = [0.004, 0.017, 0.048];
const OCEAN_SHALLOW = [0.020, 0.072, 0.085];
const ICE = [0.70, 0.74, 0.80];
const LAND_TUNDRA = [0.112, 0.104, 0.084];
const LAND_BOREAL = [0.036, 0.066, 0.036];
const LAND_TEMPERATE = [0.068, 0.114, 0.040];
const LAND_STEPPE = [0.138, 0.126, 0.070];
const LAND_DESERT = [0.300, 0.215, 0.120];
const LAND_ROCK = [0.110, 0.096, 0.082];
const CITY_LIGHT = [1.0, 0.70, 0.34];
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
    // The sine of its limb's depression under the level, times its presence (0 with no Earth).
    limbSin: uniform(0),
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
/** How much sooner the haze lifts looking straight down than at the limb (share of the veil): it
 * lifts as it would climbing out of an atmosphere, the limb last (2026-10-25: clearing right behind
 * the Earth's arriving edge, the sunlit cloud at the limb came out first, a white band that popped). */
const VEIL_NADIR_LEAD = 0.45;

// ── THE PLANET'S LAND (ORBIT_EARTH_SURFACE) ──────────────────────────────────────────
// The height field's octaves: weight and lattice offset (lacunarity 2.03, so they never re-align).
const LAND_OCTAVES = Object.freeze([
    [0.5, [0, 0, 0]],
    [0.25, [17.1, 3.3, 9.7]],
    [0.125, [5.2, 31.4, 13.6]],
    [0.0625, [29.7, 13.1, 3.8]],
    [0.035, [11.9, 22.4, 7.3]],
    [0.02, [3.6, 9.2, 27.5]],
    [0.012, [23.3, 5.7, 15.1]],
    [0.007, [8.8, 27.9, 21.4]],
]);
const LAND_WEIGHT = LAND_OCTAVES.reduce((sum, [w]) => sum + w, 0);
const LAND_WARP = Object.freeze([[5.3, 1.1, 9.4], [2.8, 8.6, 3.7], [7.9, 4.4, 6.2]]);
const LACUNARITY = 2.03;
// Only the broadest octaves follow the warp. The warp is the broadest field of all (a cell spans
// more than a radian) and the texture unit blends with ~8 bits of weight, so it moves in small
// steps; an octave sampled through it jumps by the step times its own frequency, and the finest
// drew a grid of faint blocks over the sea seen from just above the clouds. The detail octaves
// sample the unwarped domain (the same holds for the clouds' detail, below).
const LAND_WARPED = 3;
// Where in the lattice the weather systems are cut (clear sky over the coast as the haze lifts).
const WEATHER_SEED = [23.0, 5.0, 13.0];

/**
 * The continents' height above sea level at a point `n` on the unit sphere (the eye's frame: the
 * point beneath the eye is +y), on the CPU: the shader's own field at full detail. > 0 is land.
 * @param {{x:number,y:number,z:number}} n unit vector
 * @returns {number}
 */
export function orbitEarthLandHeight(n) {
    return orbitEarthLandHeightWith(n, ORBIT_EARTH_SURFACE.landSeed, true);
}

/** orbitEarthLandHeight for another seed (and scale), with or without the open sea kept beneath the eye. */
export function orbitEarthLandHeightWith(n, seed, home = true, scale = ORBIT_EARTH_SURFACE.landScale) {
    const S = ORBIT_EARTH_SURFACE;
    const q = [
        (n.x * scale) + seed[0],
        (n.y * scale) + seed[1],
        (n.z * scale) + seed[2],
    ];
    const qw = q.map((c, i) => c + ((latticeNoise3Cpu(
        (q[0] * 0.5) + LAND_WARP[i][0],
        (q[1] * 0.5) + LAND_WARP[i][1],
        (q[2] * 0.5) + LAND_WARP[i][2],
    ) - 0.5) * S.landWarp));
    let h = 0;
    LAND_OCTAVES.forEach(([w, o], k) => {
        const f = LACUNARITY ** k;
        const d = k < LAND_WARPED ? qw : q;
        h += latticeNoise3Cpu((d[0] * f) + o[0], (d[1] * f) + o[1], (d[2] * f) + o[2]) * w;
    });
    const basin = home ? S.homeDepth * Math.exp(-(1 - n.y) / ((S.homeOcean * S.homeOcean) / 2)) : 0;
    return (h / LAND_WEIGHT) - basin - S.seaLevel;
}

/** A unit direction `arc` radians from beneath the eye (+y) on the bearing `azimuth` (from +x
 * toward +z, as ORBIT_EARTH_SUN_AZIMUTH). */
function onSphere(arc, azimuth) {
    return new THREE.Vector3(
        Math.sin(arc) * Math.cos(azimuth),
        Math.cos(arc),
        Math.sin(arc) * Math.sin(azimuth),
    );
}
// The geographic pole, toward the night like the aurora's (a little farther off).
const uGeoPole = uniform(onSphere(ORBIT_EARTH_SURFACE.poleArc, NIGHT_AZIMUTH));
// The weather's two cyclones: where (arc from beneath the eye, bearing), how wide (radians) and
// how far their eyes wind the field (radians of turn). The rail looks out on a bearing of about
// -0.28 rad from 2026-10 layout's 5->6 seam: the near one sits ahead and to the left, in view as
// the haze lifts; the wide one off to the right, in view from higher up.
const CYCLONES = Object.freeze([
    { at: onSphere(0.075, -0.62), radius: 0.035, turn: 1.3 },
    { at: onSphere(0.34, 0.2), radius: 0.13, turn: 1.7 },
]);

// Add `weight` x the octave `sample()` faded to its mean (0.5) by `room` to the var `sum`, sampling
// only where it shows: the fade is a function of distance, so whole regions of the screen skip the
// fetch together (most of a far view's fine octaves).
function addFadedOctave(sum, room, weight, sample) {
    const r = room.toVar();
    sum.addAssign(weight * 0.5);
    If(r.greaterThan(0.002), () => {
        sum.addAssign(sample().sub(0.5).mul(r).mul(weight));
    });
}

// Turn the unit vector `v` about `axis` by an angle that is `turn` at the axis and falls off over
// `radius` (a cyclone's spiral). Rodrigues' rotation.
function swirl(v, { at, radius, turn }) {
    const axis = vec3(at.x, at.y, at.z);
    const c = dot(v, axis);
    // (falling off as 1 / (1 + d^2): a Gaussian wound the field into rings round the eye)
    const theta = float(turn).div(float(1).add(float(1).sub(c).div((radius * radius) / 2)));
    const cs = cos(theta);
    return v.mul(cs).add(cross(axis, v).mul(sin(theta))).add(axis.mul(c.mul(float(1).sub(cs))));
}

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
function earthLook(dir, air = null, surfaceAir = air, worldAir = null) {
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
    const S = ORBIT_EARTH_SURFACE;
    // How much arc one pixel covers here: octaves finer than that fade to their mean (they would
    // only shimmer).
    const footN = length(fwidth(N)).toVar();
    const roomAt = (perRadian) => float(1).sub(smoothstep(0.22, 0.55, footN.mul(perRadian)));
    // The sun: light reaches a little past the terminator (twilight), warm along it.
    const sd = dot(N, U.sun).toVar();
    const lit = smoothstep(-0.07, 0.10, sd);
    const warm = float(1).sub(smoothstep(0.0, 0.32, sd));
    const sunCol = mix(
        mix(vec3(...SUNLIGHT), vec3(...SUNSET), warm),
        vec3(...SUNSET_DEEP),
        float(1).sub(smoothstep(-0.05, 0.03, sd)),
    ).toVar();
    const night = float(1).sub(smoothstep(-0.10, 0.05, sd)).toVar();

    // ── THE LAND (orbitEarthLandHeight is its CPU twin) ──
    const q = N.mul(S.landScale).add(vec3(...S.landSeed)).toVar();
    const qw = q.add(vec3(
        latticeNoise3(q.mul(0.5).add(vec3(...LAND_WARP[0]))),
        latticeNoise3(q.mul(0.5).add(vec3(...LAND_WARP[1]))),
        latticeNoise3(q.mul(0.5).add(vec3(...LAND_WARP[2]))),
    ).sub(0.5).mul(S.landWarp)).toVar();
    const heightSum = float(0).toVar();
    LAND_OCTAVES.forEach(([w, o], octave) => {
        const f = LACUNARITY ** octave;
        const sample = () => latticeNoise3((octave < LAND_WARPED ? qw : q).mul(f).add(vec3(...o)));
        if (octave < 4) heightSum.addAssign(sample().mul(w));
        else addFadedOctave(heightSum, roomAt(S.landScale * f), w, sample);
    });
    const basin = exp(float(1).sub(N.y).div((S.homeOcean * S.homeOcean) / 2).negate()).mul(S.homeDepth);
    const depth = heightSum.div(LAND_WEIGHT).sub(S.seaLevel).toVar();
    const elev = depth.sub(basin).toVar();
    const coastAA = max(fwidth(elev), 0.0015);
    const land = smoothstep(coastAA.negate(), coastAA, elev).toVar();
    // Latitude from the pole, moisture, and the ridges of the high ground.
    const colat = acos(clamp(dot(N, uGeoPole), -1, 1)).toVar();
    const temperature = colat.div(Math.PI / 2).sub(max(elev, 0).mul(1.6)).toVar();
    const moisture = latticeNoise3(qw.mul(2.6).add(vec3(41.2, 7.7, 19.9)))
        .add(float(1).sub(smoothstep(0.0, 0.07, elev)).mul(0.22)).toVar();
    const ridge = float(1).sub(abs(latticeNoise3(qw.mul(9.5).add(vec3(3.9, 51.2, 8.1))).mul(2).sub(1)));
    const mountain = smoothstep(0.72, 0.95, ridge).mul(smoothstep(0.015, 0.09, elev)).toVar();
    const vegetation = mix(vec3(...LAND_BOREAL), vec3(...LAND_TEMPERATE), smoothstep(0.42, 0.62, temperature));
    const arid = mix(vec3(...LAND_STEPPE), vec3(...LAND_DESERT), smoothstep(0.62, 0.82, temperature));
    const landCol = mix(arid, vegetation, smoothstep(0.34, 0.52, moisture)).toVar();
    landCol.assign(mix(landCol, vec3(...LAND_TUNDRA), float(1).sub(smoothstep(0.24, 0.36, temperature))));
    landCol.assign(mix(landCol, vec3(...LAND_ROCK), mountain.mul(0.75)));
    landCol.assign(mix(landCol, vec3(...ICE), mountain.mul(float(1).sub(smoothstep(0.3, 0.55, temperature)))));
    const iceEdge = colat.add(latticeNoise3(qw.mul(6.1).add(vec3(9.1, 2.2, 33.3))).sub(0.5).mul(0.09));
    const ice = float(1).sub(smoothstep(S.iceCap - 0.03, S.iceCap + 0.03, iceEdge)).toVar();
    // The sea: deep, open, and the shallows round the coasts (sea ice by the pole).
    const oceanCol = mix(vec3(...OCEAN_DEEP), vec3(...OCEAN), smoothstep(-0.16, -0.03, depth))
        .toVar();
    oceanCol.assign(mix(oceanCol, vec3(...OCEAN_SHALLOW), smoothstep(-S.shelf, 0.0, depth).mul(0.6)));
    const ground = mix(mix(oceanCol, vec3(...ICE).mul(0.92), ice.mul(0.85)), mix(landCol, vec3(...ICE), ice), land)
        .toVar();

    // ── THE WEATHER ──
    // Systems swirled by a slow warp, wound round two cyclones, a cloud fraction that runs from
    // clear sky to overcast across them, and detail octaves that fade where their cells fall under
    // a pixel. The domain slides with the eye's travel and a slow drift.
    const Nc = swirl(swirl(N, CYCLONES[0]), CYCLONES[1]);
    const p0 = Nc.mul(E.cells).add(U.track).add(vec3(U.time.mul(0.002), 0, U.time.mul(-0.0015))).toVar();
    const room = (freq) => roomAt(E.cells * freq);
    const warp = vec3(
        latticeNoise3(p0.mul(0.35).add(vec3(3.1, 7.7, 1.9))),
        0.5,
        latticeNoise3(p0.mul(0.35).add(vec3(11.3, 2.2, 5.4))),
    ).sub(0.5).mul(1.5);
    const pw = p0.add(warp).toVar();
    const broad = latticeNoise3(pw).mul(0.46)
        .add(latticeNoise3(pw.mul(2.03).add(vec3(17.1, 3.3, 9.7))).mul(0.24))
        .toVar();
    // Billowed (1 - |2n - 1|): the cauliflower of cumulus, not smooth blobs.
    const billow = (freq, offset) => float(1).sub(abs(latticeNoise3(p0.mul(freq).add(vec3(...offset))).mul(2).sub(1)));
    const detail = float(0).toVar();
    [
        [4.11, 0.13, [5.2, 31.4, 13.6]],
        [8.3, 0.08, [29.7, 13.1, 3.8]],
        [16.9, 0.055, [1.7, 19.4, 24.6]],
        [34.4, 0.035, [14.2, 6.6, 30.1]],
        [69.8, 0.022, [27.1, 11.8, 2.9]],
        [141.7, 0.014, [6.3, 35.5, 18.4]],
    ].forEach(([freq, w, offset]) => addFadedOctave(detail, room(freq), w, () => billow(freq, offset)));
    const cloudN = broad.add(detail).toVar();
    const fraction = smoothstep(0.4, 0.6, latticeNoise3(p0.mul(0.075).add(vec3(...WEATHER_SEED)))
        .mul(0.7).add(latticeNoise3(p0.mul(0.19).add(vec3(4.4, 28.0, 11.0))).mul(0.3))).toVar();
    // More cloud round the cyclones' eyes (their spiral bands), and a ragged clear eye in the middle.
    const stormy = CYCLONES.reduce((sum, cy) => {
        const near = float(1).sub(dot(N, vec3(cy.at.x, cy.at.y, cy.at.z))).div((cy.radius * cy.radius) / 2);
        return sum.add(exp(near.mul(0.35).negate()).sub(exp(near.mul(30).negate()).mul(1.2)));
    }, float(0));
    const thresh = mix(float(0.74), float(0.40), fraction).sub(stormy.mul(0.12)).toVar();
    // Crisp edges, as cumulus look from above, antialiased by the field's own derivative.
    const cloudEdge = max(fwidth(cloudN).mul(1.2), 0.018);
    const cover = smoothstep(thresh.sub(cloudEdge), thresh.add(cloudEdge), cloudN).toVar();
    const thick = smoothstep(thresh, thresh.add(0.13), cloudN).toVar();
    // A veil of cirrus, drawn out along the jet.
    const cirrusN = latticeNoise3(p0.mul(vec3(0.32, 0.32, 2.4)).add(vec3(6.6, 40.1, 12.5)));
    const cirrus = smoothstep(0.6, 0.86, cirrusN).mul(0.3).mul(smoothstep(0.25, 0.7, fraction));
    const cloudA = cover.mul(mix(float(0.58), float(1), thick)).toVar();
    cloudA.assign(cloudA.add(cirrus.mul(float(1).sub(cloudA))));
    // Toward the sun: the cloud there shades the ground beneath (its shadow falls long at a low
    // sun) and darkens the cloud's own far side; the side facing the sun is lit.
    // (Only where the sun reaches: every term it feeds is lit by it.)
    const shadow = float(0).toVar();
    const cloudShade = float(1).toVar();
    If(sd.greaterThan(-0.07), () => {
        const toSun = normalize(U.sun.sub(N.mul(sd)).add(vec3(1e-5, 0, 0)));
        // (the cloud's height over the tangent of the sun's elevation there, in radians of arc)
        const sunCot = sqrt(max(float(1).sub(sd.mul(sd)), 0)).div(max(sd, 0.04));
        const reach = clamp(sunCot.mul(S.cloudHeight), 0, 0.03);
        const ps = pw.add(toSun.mul(reach.mul(E.cells)));
        const sunward = latticeNoise3(ps).mul(0.46)
            .add(latticeNoise3(ps.mul(2.03).add(vec3(17.1, 3.3, 9.7))).mul(0.24))
            .add(0.17)
            .toVar();
        shadow.assign(smoothstep(thresh.sub(0.05), thresh.add(0.05), sunward).mul(0.72));
        cloudShade.assign(float(1).sub(clamp(sunward.sub(broad.add(0.17)).mul(2.6), -0.22, 0.38)));
    });
    // Brighter where it is thick and where its billows rise.
    const cloudCol = vec3(...CLOUD).mul(thick.mul(0.22).add(0.7).add(detail.sub(0.17).mul(0.9))).toVar();

    // ── TOGETHER, LIT ──
    const albedo = mix(ground, cloudCol, cloudA).toVar();
    // The sun's glint on open water (never through cloud or on land).
    const glintCos = clamp(dot(reflect(dir, N), U.sun), 0, 1);
    const glint = glintCos.pow(380).mul(1.4).add(glintCos.pow(28).mul(0.06))
        .mul(float(1).sub(land))
        .mul(float(1).sub(ice))
        .mul(float(1).sub(cloudA));
    const groundLit = ground.mul(float(1).sub(shadow.mul(float(1).sub(cover)))).add(glint);
    const cloudLit = cloudCol.mul(cloudShade);
    const surf = mix(groundLit, cloudLit, cloudA).mul(sunCol).mul(lit)
        .add(albedo.mul(vec3(...NIGHT_LIGHT)))
        .toVar();
    // The towns at night: clustered on the plains and along the coasts, under the cloud (only where
    // there is night-side land to hold them).
    const townsHere = land.mul(float(1).sub(ice)).mul(float(1).sub(mountain))
        .mul(float(1).sub(smoothstep(-0.12, 0.02, sd)))
        .mul(float(1).sub(cloudA.mul(0.85)))
        .toVar();
    If(townsHere.greaterThan(0.002), () => {
        const towns = smoothstep(0.52, 0.8, latticeNoise3(qw.mul(11.0).add(vec3(2.4, 17.8, 36.6))))
            .mul(float(1).sub(smoothstep(0.03, 0.14, elev)).mul(0.6).add(0.4))
            .mul(smoothstep(0.3, 0.5, temperature));
        // Bright cores and dimmer sprawl at every scale: a product of three noises, squared, each
        // fading to its own mean where it falls under a pixel (a flat glow there filled each cluster).
        const glowAt = (f, offset) => {
            const g = float(0.27).toVar();
            const r = roomAt(S.landScale * f).toVar();
            If(r.greaterThan(0.002), () => {
                g.assign(mix(float(0.27), latticeNoise3(q.mul(f).add(vec3(...offset))).pow2(), r));
            });
            return g;
        };
        const townPoints = glowAt(31, [7.3, 3.1, 44.4])
            .mul(glowAt(97, [21.5, 40.2, 3.3]))
            .mul(glowAt(290, [4.4, 12.9, 51.7]))
            .mul(16)
            .pow2();
        surf.addAssign(vec3(...CITY_LIGHT).mul(S.cityGain).mul(towns.mul(min(townPoints, 2))).mul(townsHere));
    });
    // The aurora lights the cloud tops under it green (a broad glow round the oval's foot).
    If(U.aurora.greaterThan(0.001), () => {
        const under = ovalAt(N);
        surf.addAssign(albedo.mul(vec3(...AURORA_PALETTE.greenWarm)).mul(under.glow.mul(under.activity))
            .mul(U.aurora.mul(night).mul(0.16)));
    });
    // The air between the eye and the surface: more of it toward the limb. While the world is
    // there it is the WORLD's own air (2026-10-26): its colour for this direction and its column
    // over the eye (the same exponential atmosphere its sea is hazed by), so where the world's far
    // sea gives way to the Earth the haze is the same haze, thick near the horizon from low down
    // and thinning as the eye climbs. Otherwise the Earth's own.
    const day = smoothstep(-0.12, 0.25, sd);
    const ownAir = mix(vec3(...AIR_NIGHT), vec3(...AIR_DAY).mul(0.55), day)
        .add(vec3(...SUNSET).mul(warm.mul(day).mul(0.35)));
    const airT = (worldAir
        ? clamp(float(1).sub(exp(worldAir.column.negate().div(max(mu, 0.03)))), 0, worldAir.ceil)
        : float(1).sub(exp(float(E.airTau).negate().div(max(mu, 0.03)))).mul(0.92)).toVar();
    const airCol = worldAir ? mix(ownAir, worldAir.colour, worldAir.weight) : ownAir;
    const surface = mix(surf, airCol, airT);

    // ── THE RIM: the air seen edge-on just outside the limb ──
    const tc = max(k.mul(dy).negate(), 0);
    const Q = normalize(dir.mul(tc).add(vec3(0, k, 0)));
    const sdRim = dot(Q, U.sun).toVar();
    const above = max(aClose, 0);
    // Only rays that look down toward the limb see the rim: it tapers from the limb to nothing
    // at the level, over the limb's own dip, so the sky above belongs to the dome (and to the
    // dark) however high the eye, with no edge where the taper ends.
    const sinDip = sqrt(h.mul(h.add(2))).div(k);
    // ...and only from the stratosphere up (2026-10-26): from a few kilometres the air at the
    // horizon is a haze, not a glowing edge; the edge comes up as the eye climbs past ~15 km.
    const glow = exp(above.div(E.rimHeight).negate())
        .mul(smoothstep(0.0, sinDip, dy.negate()))
        .mul(smoothstep(E.rimFrom[0], E.rimFrom[1], h)).toVar();
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
    // (capped: straight down the closest approach turns as a square root and its derivative blows up)
    const edge = clamp(fwidth(aClose), 1e-7, 0.01);
    const coverage = clamp(float(0.5).sub(aClose.div(edge)), 0, 1);
    const rgb = mix(rim, surface, coverage).toVar();
    const alpha = mix(rimAlpha, float(1), coverage).toVar();
    // THE SEAM: it arrives wholly in the world's air, which lifts as the eye climbs, first where it
    // looks straight down and last at the limb; and it covers the view only where its front has come
    // in, from the horizon down.
    const down = dy.negate();
    if (air) {
        const toNadir = clamp(down.sub(sinDip).div(float(1).sub(sinDip)), 0, 1);
        const veil = smoothstep(float(0), float(1), U.veil.sub(toNadir.mul(VEIL_NADIR_LEAD)).div(1 - VEIL_NADIR_LEAD));
        // The disc wears `surfaceAir` (on the world's own surfaces, their own colour there), the rim
        // `air` (the sky's): premultiplied like the rest.
        rgb.assign(mix(rgb, mix(air, surfaceAir, coverage).mul(alpha), veil));
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
 * where it has come in, `surfaceAir` elsewhere. While it arrives its disc wears `surfaceAir` (the
 * world surface's own colour there, so where it comes in over the sea nothing changes until the
 * haze lifts); its rim wears `air`. Call inside a Fn.
 *
 * Premultiplied by how far it has ARRIVED, like the backdrop (2026-10-25: the colour was taken
 * whole while the cover was not, so as the Earth faded in the sea showed its veil AND most of the
 * air again on top: a white sheet that swept down from the horizon, "this white pops up from
 * nowhere").
 */
/** The sine of the limb's depression under the level from `altitude` (Earth radii). */
export function orbitEarthLimbSin(altitude) {
    const h = Math.max(Number.isFinite(altitude) ? altitude : 0, 0);
    return Math.sqrt(h * (h + 2)) / (1 + h);
}

export function orbitEarthOver(dir, air, surfaceAir = air, worldAir = null) {
    const look = earthLook(dir, air, surfaceAir, worldAir);
    return look.colour.mul(look.arrived).add(surfaceAir.mul(float(1).sub(look.alpha)));
}

/** The Earth's live seam state for the world's materials: its presence, its front (sine of the
 * depression; -2 before it begins), how far the world's clouds have gone into it (0..1) and the
 * sine of its limb's depression under the level, eased in with its presence (THE HORIZON IS THE
 * LIMB: the world's sky and air measure their elevation from it). */
export const ORBIT_EARTH_SEAM = Object.freeze({
    presence: U.presence,
    frontSin: U.frontSin,
    cloudsAway: U.cloudsAway,
    limbSin: U.limbSin,
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
export function createOrbitEarth({ radius = ORBIT_EARTH.radius, haze = null, worldAir = null } = {}) {
    const E = ORBIT_EARTH;
    const A = ORBIT_EARTH_AURORA;
    const greenWarm = vec3(...AURORA_PALETTE.greenWarm);
    const greenCool = vec3(...AURORA_PALETTE.greenCool);
    const crimson = vec3(...AURORA_PALETTE.crimson);
    const shade = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const look = earthLook(dir, haze ? haze(dir) : null, haze ? haze(dir) : null, worldAir ? worldAir(dir) : null);
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
            U.limbSin.value = 0;
            if (!mesh.visible) return;
            U.aurora.value = Math.min(Math.max(Number.isFinite(aurora) ? aurora : 0, 0), 1);
            U.alt.value = Math.max(Number.isFinite(altitude) ? altitude : 0.01, 1e-5);
            U.limbSin.value = orbitEarthLimbSin(U.alt.value) * pr;
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
