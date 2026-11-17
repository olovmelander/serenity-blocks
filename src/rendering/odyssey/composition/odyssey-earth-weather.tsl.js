/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE EARTH'S WEATHER AND ITS NIGHT (2026-11-17, the Odyssey masterpiece pass).
 *
 * "Leaving the Earth" is one of the journey's three great moments, and the planet below read as
 * blotchy pink smears by day and flat black with a few orange blobs by night. This is what the
 * round Earth (odyssey-orbit-earth.js `earthLook`) now reads its cloud cover and its night from:
 *
 *   - WEATHER WITH STRUCTURE. The sphere is laid flat about the point beneath the eye
 *     (stereographic, so a shape keeps its form to the limb) and the grain
 *     (odyssey-earth-weather-bake.js) is read on that plane at five scales, each through the
 *     texture unit's own mips and anisotropy (explicit gradients), so cloud stays crisp where the
 *     view grazes the limb and never shimmers. The broadest read lays out the systems: where the
 *     sky is clear and where it is overcast, long frontal bands along the lanes between its cells,
 *     and two cyclones wound into spirals with an eye. Under them the decks break into cells with
 *     clear lanes between, and the finest reads are the cumulus.
 *   - LIT AS RELIEF. The same field read a little way toward the light says how the cloud stands
 *     there: a billow's side toward the sun is lit warm, its far side falls into the sky's cool
 *     shade, and its shadow lies long on the sea at a low sun. By night the light is the moon's.
 *   - A NIGHT THAT IS ALIVE. Towns at the knots of a web of roads, thick along the coasts and the
 *     plains; lightning flickering inside the storm systems (through `flashScale`); cloud tops
 *     silvered by the moon.
 *
 * Everything here is called inside `earthLook`'s Fn. All of it is a function of the direction
 * from the Earth's centre and the clock: nothing is keyed on progress, so there is nothing to pop.
 */
import * as THREE from 'three/webgpu';
import {
    atan,
    clamp,
    cos,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    log,
    max,
    normalize,
    select,
    smoothstep,
    sqrt,
    texture,
    vec2,
    vec3,
} from 'three/tsl';
import { keepOdysseyTexture } from '../chapter-environments/shared/odyssey-resident-textures.js';
import { latticeNoise3 } from '../chapter-environments/shared/odyssey-lattice-noise.js';
import { EARTH_WEATHER_NOISE, getEarthWeatherNoise } from './odyssey-earth-weather-bake.js';

/**
 * The weather's reads: the tile's side in cells (ORBIT_EARTH.cells to a radian of arc, ~91 km
 * each), its turn (degrees) and its offset (tiles), so no two reads line up.
 */
export const EARTH_WEATHER = Object.freeze({
    /** The systems: where the sky is unsettled, and the fronts (a tile is ~16,000 km). */
    synoptic: Object.freeze({ tile: 176, turn: 17, offset: Object.freeze([0.31, 0.77]) }),
    /** Cloud masses (a tile ~2,000 km). */
    mass: Object.freeze({ tile: 23, turn: -38, offset: Object.freeze([0.63, 0.12]) }),
    /** Cells and lanes of a broken deck (a tile ~400 km, its cells ~25 km). */
    deck: Object.freeze({ tile: 4.3, turn: 71, offset: Object.freeze([0.18, 0.44]) }),
    /** Cumulus (a tile ~70 km). */
    puff: Object.freeze({ tile: 0.77, turn: 9, offset: Object.freeze([0.52, 0.91]) }),
    /** The finest billows (a tile ~11 km), seen only from just above the clouds. */
    fine: Object.freeze({ tile: 0.12, turn: -57, offset: Object.freeze([0.07, 0.35]) }),
    /** Cirrus: the drift channel drawn out along the jet. */
    cirrus: Object.freeze({
        tile: 6, turn: 24, long: 3.5, offset: Object.freeze([0.4, 0.2]),
    }),
    /** How much each read adds to the cloud's grain (mass, deck, puff, fine). */
    weights: Object.freeze([0.34, 0.26, 0.24, 0.16]),
    /** The grain's mean and spread (the bake's billow channel through those weights). */
    grainMean: 0.66,
    grainSpread: 0.25,
    /**
     * THE SKY'S COVER: the share of the sky the cloud fills at a place (0 clear, 1 overcast; the
     * grain is cut at one minus it, so a low share leaves scattered cumulus and a high one a deck
     * with holes): what the unsettled regions, the cloud masses, a front and a cyclone each add,
     * what the clear sky takes back, and how far a patch of fair-weather cumulus lifts it.
     */
    cover: Object.freeze({
        unsettled: 0.72, mass: 0.75, front: 0.55, spiral: 0.95, clear: 0.42, fair: 0.36,
    }),
    /** The level of the synoptic read's drift channel a front runs along, and its half-width. */
    frontAt: 0.57,
    frontWidth: 0.028,
    /** The drift of the whole field (cells per second, x and z). */
    drift: Object.freeze([0.002, -0.0015]),
    /** Lightning: the storm cells' grid (cells), a flash's radius (grid cells), the clock's slot
     * (seconds) and how often a slot fires in the heart of a storm. */
    boltGrid: 2.2,
    boltRadius: 0.15,
    boltSlot: 2.4,
    boltRate: 0.55,
});

/** The moon: high over the night side (out of the frame), a cool light for the cloud tops. */
export const EARTH_MOON = Object.freeze({
    elevation: THREE.MathUtils.degToRad(58),
    colour: Object.freeze([0.034, 0.044, 0.07]),
});

let weatherTexture = null;

/** The grain as a texture: half floats (the relief is a difference of two reads), mipmapped. */
export function getEarthWeatherTexture() {
    if (weatherTexture) return weatherTexture;
    const n = EARTH_WEATHER_NOISE.size;
    const field = getEarthWeatherNoise();
    const half = new Uint16Array(field.length);
    for (let i = 0; i < field.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(field[i]);
    const tex = new THREE.DataTexture(half, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.name = 'odyssey-earth-weather';
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    weatherTexture = keepOdysseyTexture(tex);
    return tex;
}

/**
 * A read's 2 x 2 matrix (plane cells -> tile coordinates), rows [a, b] and [c, d]. `long` draws the
 * grain out along the read's own first axis (a tile that many times longer that way).
 */
function readMatrix({ tile, turn, long = 1 }) {
    const a = THREE.MathUtils.degToRad(turn);
    const u = tile * long;
    return [Math.cos(a) / u, -Math.sin(a) / u, Math.sin(a) / tile, Math.cos(a) / tile];
}

/**
 * The sphere laid flat about the point beneath the eye, in cells: a unit vector `n` (the eye's
 * frame, +y beneath the eye) -> its place on the plane. Stereographic, so shapes keep their form.
 */
export function earthPlaneOf(n, cells) {
    return n.xz.mul(float(2 * cells).div(n.y.add(1)));
}

/** The same on the CPU (a unit vector {x, y, z}): [x, z] in cells. */
export function earthPlaneOfCpu(n, cells) {
    const k = (2 * cells) / (1 + n.y);
    return [n.x * k, n.z * k];
}

/**
 * A cyclone's cloud at plane point `s` (cells): spiral arms round a clear eye, and the turn it
 * winds the field by there. `at` its centre (cells), `radius` its reach (cells), `arms`, `pitch`.
 */
function cycloneAt(s, cy, time) {
    const d = s.sub(vec2(cy.at[0], cy.at[1])).toVar();
    const r = length(d).div(cy.radius).toVar();
    const theta = atan(d.y, d.x);
    // A logarithmic spiral, slowly turning (a cyclone turns in days: the eye sees it creep).
    const phase = theta.mul(cy.arms).add(log(r.add(0.04)).mul(cy.pitch)).sub(time.mul(cy.spin));
    const arm = cos(phase).mul(0.5).add(0.5);
    const band = arm.mul(arm).mul(arm.mul(-2).add(3));
    const reach = exp(r.mul(r).mul(-0.42));
    const shield = exp(r.mul(r).mul(-7));
    const eye = exp(r.mul(r).mul(-190));
    // Cloud along the arms and clear air between them (a cyclone's arms are seen by the gaps),
    // a solid shield round the centre, and the eye.
    return reach.mul(band.mul(1.5).sub(0.62)).add(shield.mul(0.9)).sub(eye.mul(2.2));
}

/**
 * The weather at a point of the Earth, inside a Fn.
 * @param {object} c
 * @param {*} c.N the point's unit normal (the eye's frame), a var
 * @param {*} c.plane the point on the plane (earthPlaneOf), a var
 * @param {*} c.gx the plane point's screen derivatives (dFdx, dFdy), vars
 * @param {*} c.gy
 * @param {*} c.sd N . sun, a var
 * @param {*} c.sun the sun's direction (a uniform vec3)
 * @param {*} c.moon the moon's direction (a vec3 node)
 * @param {*} c.track the weather's slide with the eye's travel (a uniform vec3, cells)
 * @param {*} c.time the clock (a uniform, seconds)
 * @param {number} c.cloudHeight the cloud layer's height (radii): its shadows' length at a low sun
 * @param {number} c.cells cells per radian
 * @param {object[]} c.cyclones [{ at: [x, z] cells, radius, arms, pitch, spin }]
 * @returns {{ cover: *, thick: *, veil: *, relief: *, fineRelief: *, shadow: *, storm: *,
 *   plane: *, read: Function }} cover 0..1 (cumulus edge), thick 0..1 (how deep the cloud is),
 *   veil 0..1 (cirrus), relief -1..1 (how the cloud faces the light: broad), fineRelief (the
 *   billows'), shadow 0..1 (cloud between this point and the light), storm 0..1 (deep convection)
 */
export function earthWeatherAt(c) {
    const W = EARTH_WEATHER;
    const tex = getEarthWeatherTexture();
    // The field's own place: the plane, slid by the eye's travel and the wind.
    const w = c.plane.add(vec2(c.track.x, c.track.z))
        .add(vec2(c.time.mul(W.drift[0]), c.time.mul(W.drift[1]))).toVar();
    const read = (spec, at = w, lod = 1) => {
        const m = readMatrix(spec);
        const uv = vec2(
            at.x.mul(m[0]).add(at.y.mul(m[1])).add(spec.offset[0]),
            at.x.mul(m[2]).add(at.y.mul(m[3])).add(spec.offset[1]),
        );
        const gx = vec2(c.gx.x.mul(m[0]).add(c.gx.y.mul(m[1])), c.gx.x.mul(m[2]).add(c.gx.y.mul(m[3]))).mul(lod);
        const gy = vec2(c.gy.x.mul(m[0]).add(c.gy.y.mul(m[1])), c.gy.x.mul(m[2]).add(c.gy.y.mul(m[3]))).mul(lod);
        return texture(tex, uv).grad(gx, gy);
    };

    // ── THE SYSTEMS ──
    const syn = read(W.synoptic).toVar();
    const mass = read(W.mass).toVar();
    const spiral = c.cyclones.reduce((sum, cy) => sum.add(cycloneAt(c.plane, cy, c.time)), float(0)).toVar();
    // Where the sky is unsettled, and the fronts: long winding bands along the edge of the
    // unsettled air (a contour of the same smooth field: the broad read is magnified forty
    // times from just above the clouds, and its cell lanes would show their texels as stairs).
    const unsettled = smoothstep(0.36, 0.68, syn.a).toVar();
    const offFront = syn.a.sub(W.frontAt).div(W.frontWidth);
    const front = exp(offFront.mul(offFront).negate()).toVar();
    const fill = unsettled.mul(W.cover.unsettled)
        .add(mass.a.sub(0.5).mul(W.cover.mass))
        .add(front.mul(W.cover.front))
        .add(spiral.mul(W.cover.spiral))
        .sub(W.cover.clear)
        .toVar();
    // Fair-weather cumulus: where the sky is otherwise clear, fields of small heaps stand in
    // patches (only the grain's highest peaks rise through so low a fill: scattered puffs).
    const deck = read(W.deck).toVar();
    fill.assign(max(fill, smoothstep(0.38, 0.72, deck.a).mul(W.cover.fair).sub(0.34)));
    // Layered cloud (sheets and decks) away from the broad cells' hearts, heaped cloud near them.
    const sheet = smoothstep(0.3, 0.62, syn.g).mul(float(1).sub(front.mul(0.7))).toVar();

    // ── THE CLOUD'S GRAIN ──
    const puff = read(W.puff).toVar();
    const fine = read(W.fine).toVar();
    // A deck breaks into cells with clear lanes between them (not everywhere along a lane).
    const laneOf = (d, p) => float(1).sub(smoothstep(0.0, 0.3, d.b)).mul(smoothstep(0.38, 0.62, p.a)).mul(sheet);
    const broadGrain = mass.r.mul(W.weights[0]).add(deck.r.mul(W.weights[1])).toVar();
    // (a sheet keeps less of the billows' grain than a heap does)
    const billows = puff.r.sub(W.grainMean).mul(W.weights[2]).add(fine.r.sub(W.grainMean).mul(W.weights[3]))
        .mul(float(1).sub(sheet.mul(0.45)))
        .toVar();
    const toDepth = (grain, lane) => grain.sub(W.grainMean * (W.weights[0] + W.weights[1])).add(billows)
        .div(W.grainSpread)
        .sub(lane.mul(0.16))
        .sub(0.5)
        .add(fill);
    // How far inside the cloud this point is (0 on its edge; the grain cut at one minus the fill).
    const depth = toDepth(broadGrain, laneOf(deck, puff)).toVar();
    // Crisp where the eye can resolve it: the edge is as wide as the field changes across a pixel
    // (and softer in a sheet, which has no cauliflower edge).
    const edge = clamp(length(vec2(dFdx(depth), dFdy(depth))).mul(1.1), 0.05, 0.3).add(sheet.mul(0.1));
    const cover = smoothstep(edge.negate(), edge, depth).toVar();
    const thick = smoothstep(0.0, 0.55, depth).toVar();
    // Cirrus: fibres drawn out along the jet, a veil over the unsettled sky.
    const fibre = read(W.cirrus).a;
    const veil = smoothstep(0.5, 0.9, fibre).mul(smoothstep(0.2, 0.7, unsettled)).mul(0.26).toVar();
    // Deep convection: the thick heart of a front or a cyclone.
    const storm = smoothstep(0.35, 0.9, depth).mul(clamp(front.add(spiral.mul(0.8)).add(unsettled.mul(0.3)), 0, 1))
        .toVar();

    // ── TOWARD THE LIGHT ──
    // The sun by day and through the dusk, the moon by night: one read toward whichever lights
    // this point (they hand over where neither does: the relief is weighed by its own light).
    const day = c.sd.greaterThan(-0.09);
    const lightDir = vec3(
        select(day, c.sun.x, c.moon.x),
        select(day, c.sun.y, c.moon.y),
        select(day, c.sun.z, c.moon.z),
    ).toVar();
    const ld = dot(c.N, lightDir).toVar();
    const tangent = lightDir.sub(c.N.mul(ld)).toVar();
    // The plane's own direction for it (the projection's derivative along the tangent).
    const toward = normalize(tangent.xz.sub(c.N.xz.mul(tangent.y.div(c.N.y.add(1)))).add(vec2(1e-5, 0))).toVar();
    // How far the light's ray runs over the ground before it is a cloud's height up (cells).
    const cot = sqrt(max(float(1).sub(ld.mul(ld)), 0)).div(max(ld, 0.05));
    const reach = clamp(cot.mul(c.cloudHeight), 0.0006, 0.022).mul(c.cells).toVar();
    const at = w.add(toward.mul(reach)).toVar();
    const massS = read(W.mass, at, 1.5).toVar();
    const deckS = read(W.deck, at, 1.5).toVar();
    const sunwardGrain = massS.r.mul(W.weights[0]).add(deckS.r.mul(W.weights[1])).toVar();
    // The cloud between here and the light.
    const shadow = smoothstep(-0.12, 0.22, toDepth(sunwardGrain, laneOf(deckS, puff))).toVar();
    // Lower toward the light = this side faces it.
    const relief = clamp(broadGrain.sub(sunwardGrain).mul(9), -1, 1).toVar();
    // The billows' own sides, a fine step toward the light.
    const step = toward.mul(max(reach.mul(0.05), 0.012));
    const puffS = read(W.puff, w.add(step)).r;
    const fineS = read(W.fine, w.add(step.mul(0.18))).r;
    const fineRelief = clamp(puff.r.sub(puffS).mul(4.5).add(fine.r.sub(fineS).mul(2.2)), -1, 1).toVar();
    return {
        cover, thick, veil, relief, fineRelief, shadow, storm, sheet, plane: w, billow: puff.r, fineBillow: fine.r,
    };
}

/**
 * Lightning inside the storm systems, at weather-plane point `w` (cells): 0..1.5, the light a
 * flash throws into the cloud round it. Two staggered grids of storm cells; each cell fires on its
 * own clock (a slot of `boltSlot` seconds: whether, when and where in the cell are read from the
 * lattice at whole numbers), a hard stroke and a weaker second one. Call where there is a storm
 * and night (it reads four lattice values).
 */
export function earthLightningAt(w, time) {
    const W = EARTH_WEATHER;
    let sum = float(0);
    [[0, 0, 3.5, 0], [0.5, 0.5, 21.5, 0.47]].forEach(([ox, oy, seed, phase]) => {
        const g = w.div(W.boltGrid).add(vec2(ox, oy)).toVar();
        const cell = floor(g).toVar();
        const local = fract(g);
        // The cell's own offset on the clock, then the slot it is in.
        const own = latticeNoise3(vec3(cell.x, cell.y, seed)).toVar();
        const clock = time.div(W.boltSlot).add(own.mul(7.3)).add(phase).toVar();
        const slot = floor(clock).toVar();
        const into = fract(clock).mul(W.boltSlot);
        const dice = latticeNoise3(vec3(cell.x.add(slot.mul(3)), cell.y.add(slot.mul(5)), slot.add(seed))).toVar();
        const fires = float(1).sub(smoothstep(W.boltRate - 0.02, W.boltRate, dice));
        // Where in the cell and when in the slot (from the same throw).
        const where = vec2(fract(dice.mul(7.13)), fract(dice.mul(13.7))).mul(0.5).add(0.25);
        const since = into.sub(fract(dice.mul(29.3)).mul(W.boltSlot * 0.6)).toVar();
        const stroke = exp(max(since, 0).mul(-11)).mul(smoothstep(-0.02, 0.0, since))
            .add(exp(max(since.sub(0.17), 0).mul(-15)).mul(smoothstep(0.15, 0.17, since)).mul(0.55));
        const dist = local.sub(where).div(W.boltRadius);
        sum = sum.add(exp(dot(dist, dist).negate()).mul(stroke).mul(fires));
    });
    return sum;
}

/**
 * The towns' lights at land point `plane` (cells, fixed to the land): 0..~3, already shaped as
 * light (bright cores, dim sprawl, the web of roads between). `people` 0..1 is how settled the
 * land is there (the coasts and the plains); `c.gx`/`c.gy` the plane's screen derivatives.
 */
export function earthTownLights(c, people) {
    const tex = getEarthWeatherTexture();
    const read = (tile, turn, offset) => {
        const m = readMatrix({ tile, turn });
        const uv = vec2(
            c.plane.x.mul(m[0]).add(c.plane.y.mul(m[1])).add(offset[0]),
            c.plane.x.mul(m[2]).add(c.plane.y.mul(m[3])).add(offset[1]),
        );
        const gx = vec2(c.gx.x.mul(m[0]).add(c.gx.y.mul(m[1])), c.gx.x.mul(m[2]).add(c.gx.y.mul(m[3])));
        const gy = vec2(c.gy.x.mul(m[0]).add(c.gy.y.mul(m[1])), c.gy.x.mul(m[2]).add(c.gy.y.mul(m[3])));
        return texture(tex, uv).grad(gx, gy);
    };
    // Night lights are not dots on a grid: settlement gathers at every scale, so a few places
    // are very bright, most are dim, and the dim ones lie round the bright ones. The billow
    // channel read at two scales and multiplied is that kind of field; what it is MADE of is
    // single lights (the finest read's cell points) and the web of roads between them.
    const region = read(12.5, 33, [0.21, 0.67]).toVar();
    const district = read(2.3, -21, [0.83, 0.29]).toVar();
    const block = read(0.45, 58, [0.47, 0.05]).toVar();
    const metro = smoothstep(0.6, 0.97, region.r).toVar();
    const quarter = smoothstep(0.55, 0.95, district.r).toVar();
    // (not every cell holds a lamp, and no two are alike: the drift channel's finest grain says)
    const lamps = exp(block.g.mul(block.g).mul(-70)).mul(smoothstep(0.36, 0.72, block.a)).mul(1.8).toVar();
    const streets = float(1).sub(smoothstep(0.0, 0.06, block.b));
    // The roads: the lanes between the districts' cells near a city, the highways between cities.
    const road = float(1).sub(smoothstep(0.0, 0.03, district.b)).mul(metro.mul(0.85).add(0.1));
    const highway = float(1).sub(smoothstep(0.0, 0.02, region.b)).mul(smoothstep(0.4, 0.62, region.a));
    // Towns and cities: their lamps and streets, denser where the region is; a city's heart glows.
    const made = lamps.mul(2.2).add(streets.mul(0.7)).add(0.25);
    const urban = quarter.mul(metro.mul(0.75).add(0.25)).mul(made).mul(2.6).add(metro.mul(quarter).mul(1.5));
    const country = lamps.mul(metro.mul(0.6).add(0.25)).mul(0.5).add(road.mul(0.26)).add(highway.mul(0.3));
    return urban.mul(smoothstep(0.05, 0.45, people)).add(country.mul(people));
}

/**
 * The land's patchwork at land point `c.plane` (cells): a factor round 1 for its colour (fields,
 * woods, dry and wet ground at two scales from one read each).
 */
export function earthLandMottle(c) {
    const tex = getEarthWeatherTexture();
    const read = (tile, turn, offset) => {
        const m = readMatrix({ tile, turn });
        const uv = vec2(
            c.plane.x.mul(m[0]).add(c.plane.y.mul(m[1])).add(offset[0]),
            c.plane.x.mul(m[2]).add(c.plane.y.mul(m[3])).add(offset[1]),
        );
        const gx = vec2(c.gx.x.mul(m[0]).add(c.gx.y.mul(m[1])), c.gx.x.mul(m[2]).add(c.gx.y.mul(m[3])));
        const gy = vec2(c.gy.x.mul(m[0]).add(c.gy.y.mul(m[1])), c.gy.x.mul(m[2]).add(c.gy.y.mul(m[3])));
        return texture(tex, uv).grad(gx, gy);
    };
    const broad = read(7.5, 12, [0.11, 0.59]);
    const near = read(0.9, -44, [0.71, 0.33]);
    return broad.a.sub(0.5).mul(0.7).add(near.a.sub(0.5).mul(0.4)).add(near.r.sub(0.66).mul(0.3))
        .add(1);
}
