/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — what moves in the air: the fireflies, the luna moths round the lanterns,
 * the dust and pollen that glitter in the moonbeams, and the dew a hard drop shakes from the glass.
 *
 * Nothing here is simulated. Every creature and every mote has its whole life as a closed form in
 * the world clock (U.time) and its own seeds, baked once on the CPU into one static interleaved
 * buffer a part, so a seek or a replay lands on exactly the same frame, and the CPU writes nothing
 * per frame. Every pool is always drawn: what is not out (a firefly the swarm has not called, a
 * drop of a curtain that has not fallen) collapses to a point of no size in the vertex stage, so
 * the first frame compiles every pipeline and the cost of what is dormant is its vertices alone.
 *
 *   FIREFLIES  camera-facing glows that wander on slow Lissajous paths round the beds, the bed
 *              fronts and low over the canal. Each blinks on its own rhythm, the fireflyFlash()
 *              of moonlit-greenhouse-core.js written once for both arithmetics (flashWith: the
 *              shader's and the tests' CPU twin), so a chain pulls them into step exactly as the
 *              world's own estimate of their light says: rolling waves of flashes down the house,
 *              then the whole swarm as one. A flash is the courtship stroke of Photinus: the
 *              firefly dips and hooks upward as its lantern burns, and on the richer tiers it
 *              leaves a dotted J of light hanging where it flashed, fading before the next.
 *   MOTHS      luna moths: two hinged wing quads each, pale mint with long trailing tails, a
 *              maroon leading edge and eye-spots with a clear window, cut out by a signed distance
 *              (alpha-tested, depth-writing). They circle the nearest lanterns on lazy loops, dart
 *              at the glass, and now and then sail out on a long loop through the open air. Lit
 *              as the house is lit (mgSurface), and the wings glow warm where the moth's own lamp
 *              is behind them and silver where the moon is.
 *   MOTES      dust and pollen in the nave, each a spark of a couple of pixels whose light is the
 *              moonlight that reaches it (mgMoonVis: the glazing's lattice, the blinds, the palms'
 *              fronds; the same function the post stack's beams are marched with) scattered
 *              forward toward the eye, so the beams glitter and the shadows between them are
 *              empty air. Flakes of dust turn and glint; pollen burns steadily.
 *   DEW        a hard drop's curtain: drops shaken from the purlins all over the vault fall under
 *              gravity and drag as short streaks stretched along their motion on screen, catching
 *              the moon and the lanterns as they pass through the beams, and burst into a spark
 *              where they meet the water or the stones. At rest a few drips gather on the glass,
 *              hang glinting, and fall now and then, each from its own place on its own beat.
 *
 * The T-spin's turn of the air (U.turn) wheels the fireflies, the moths and the motes about the
 * vertical axis through (turn.z, turn.w): an elliptical vortex stretched down the nave, strongest
 * at its heart; each thing goes round with it and slides home as it dies (turnOfTheAir).
 *
 * Four draw calls: the fireflies (and their trails), the moths' wings, the motes, the dew.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, dot, exp, float,
    floor, fract, frontFacing, fwidth, length, log, max, min, mix, normalize, positionGeometry, select, sin,
    smoothstep, sqrt, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import {
    ARC, FLASH, FLOOR, HOUSE, lerp, mulberry32, smooth, vaultHeightAt,
} from './moonlit-greenhouse-core.js';
import {
    mgLanterns, mgMax3, mgMoonVis, mgSurface,
} from './moonlit-greenhouse-tsl.js';

const TAU = Math.PI * 2;

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────

/**
 * The fireflies.
 *   peak         a flash's light at its hot core (scene-linear): well over the bloom's knee
 *   ember        the lantern between flashes, a share of the peak, breathing slowly (a drifting spark)
 *   glow         the glow's reach in metres at rest and added at the height of a flash
 *   core         the hot core's radius (metres); never finer than `coreLeast` pixels
 *   halo         the soft glow round the core, as a share of the core's light
 *   least        the glow is never drawn smaller than this many pixels in radius
 *   hook         the J of a flash: how far the firefly dips forward and climbs (metres)
 *   trail        dots of the J left hanging on the richer tiers, their light, size and fade
 *   floodGain    how much brighter every firefly burns when the moonlight floods (the Queen)
 */
export const FIREFLY = Object.freeze({
    peak: 5.0,
    ember: 0.12,
    glow: Object.freeze([0.085, 0.15]),
    core: 0.013,
    coreLeast: 0.85,
    halo: 0.3,
    least: 2.5,
    hook: Object.freeze([0.2, 0.28]),
    trailGain: 0.34,
    trailRadius: 0.026,
    trailFade: 0.5,
    floodGain: 0.6,
});

/**
 * The luna moths.
 *   span         half the wingspan (metres; twice life, so a moth reads beside the card at four metres)
 *   least        the half-span never shrinks under this many pixels
 *   orbit        radius of the loop round the lamp, least..most; `speed` its angular rate (rad/s)
 *   flap         wing beats a second, least..most
 *   roam         seconds between the long loops out into the open air, least..most
 *   picks        which lanterns (nearest first) the moths are given, in turn: the near ones most
 */
export const MOTH = Object.freeze({
    span: Object.freeze([0.11, 0.13]),
    least: 4.0,
    orbit: Object.freeze([0.36, 0.7]),
    speed: Object.freeze([1.2, 2.1]),
    flap: Object.freeze([5.0, 7.5]),
    roam: Object.freeze([20, 38]),
    picks: Object.freeze([0, 1, 0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3]),
});

/**
 * The motes.
 *   box          the air they fill: |x|, y from..to, z near..far
 *   pixels       the spark's radius on screen, least..most
 *   gain         the light of a mote in a beam, looking at the moon through it
 *   forward      the forward-scattering lobe (Henyey–Greenstein g) of fine dust
 *   glinting     the share that are turning flakes (the rest are steady pollen)
 */
export const MOTE = Object.freeze({
    box: Object.freeze({
        x: 6.5, from: 0.3, to: 9.0, near: 3.0, far: -35.0,
    }),
    pixels: Object.freeze([1.0, 1.6]),
    gain: 7.0,
    forward: 0.62,
    glinting: 0.42,
});

/**
 * The dew.
 *   gravity      m/s²; drops fall against drag toward `terminal` (m/s, least..most), the shake
 *                giving each a start of `kick` m/s (least..most)
 *   glass        the curtain's share shaken from the vault's purlins (the rest from the palms'
 *                fronds, the baskets and the vines over the beds, lower down)
 *   shutter      seconds of motion a streak shows (a film camera's 1/30)
 *   least        a streak is never shorter than this many pixels, `width` (half-width) never
 *                thinner than `thin` pixels
 *   shake        seconds over which a hard drop shakes the drops loose, nearest the card first
 *   splash       seconds a drop's burst lasts where it lands
 *   drips        resting drips: their share of the curtain's pool (at least `fewest`) and the
 *                seconds between one drip's falls, least..most
 */
export const DEW = Object.freeze({
    gravity: 9.81,
    terminal: Object.freeze([7.5, 11.0]),
    kick: Object.freeze([0.4, 2.2]),
    glass: 0.45,
    shutter: 0.033,
    least: 1.6,
    width: 0.0016,
    thin: 0.8,
    shake: 0.3,
    splash: 0.16,
    drips: 0.06,
    fewest: 10,
    dripEvery: Object.freeze([6.5, 15.0]),
    moonLight: 0.7,
    moonGlint: 4.0,
    lanternGlint: 2.0,
});

/**
 * The T-spin's turn of the air: an elliptical vortex about the vertical axis through
 * (turn.z, turn.w), `reach` metres across and down the nave, strongest at its heart (falloff),
 * lifting what it carries a little.
 */
export const TURN = Object.freeze({
    reachX: 6.5,
    reachZ: 14.0,
    falloff: 1.5,
    lift: 0.45,
    wall: 6.7,
});

// ── The flash: one formula, two arithmetics ─────────────────────────────────────────────────

/** Plain numbers: the CPU twin the tests hold against fireflyFlash(). */
export const JS_MATH = Object.freeze({
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    max: (a, b) => Math.max(a, b),
    fract: (x) => x - Math.floor(x),
    sin: Math.sin,
    smooth: (e0, e1, x) => smooth(e0, e1, x),
    below: (x, edge, a, b) => (x < edge ? a : b),
    mix: (a, b, w) => lerp(a, b, w),
});

const node = (v) => (typeof v === 'number' ? float(v) : v);

/** TSL nodes: the shader's arithmetic, the same formula. */
export const TSL_MATH = Object.freeze({
    add: (a, b) => node(a).add(b),
    sub: (a, b) => node(a).sub(b),
    mul: (a, b) => node(a).mul(b),
    div: (a, b) => node(a).div(b),
    max: (a, b) => max(node(a), node(b)),
    fract: (x) => fract(node(x)),
    sin: (x) => sin(node(x)),
    smooth: (e0, e1, x) => smoothstep(e0, e1, node(x)),
    below: (x, edge, a, b) => select(node(x).lessThan(edge), node(a), node(b)),
    mix: (a, b, w) => mix(node(a), node(b), node(w)),
});

/** One flash: sin² over the first FLASH.width of the period, dark for the rest. */
function pulseWith(m, f) {
    const x = m.div(f, FLASH.width);
    const s = m.sin(m.mul(x, Math.PI));
    return m.below(x, 1, m.mul(s, s), 0);
}

/**
 * fireflyFlash() (moonlit-greenhouse-core.js) in the arithmetic `m`: a firefly's light at `t`
 * (0..1) for its rhythm `seed`, at `z` down the house, with the swarm in step by `sync`. Also
 * hands back what the flight is drawn from: each rhythm's phase (0..1 through its period), the
 * firefly's own period, and the weight of the shared beat.
 */
export function flashWith(m, t, seed, z, sync) {
    const own = m.add(1.4, m.mul(seed, 1.6));
    const fOwn = m.fract(m.add(m.div(t, own), m.mul(seed, 7.13)));
    const lag = m.mul(m.mul(FLASH.lag, m.sub(1, m.smooth(0.7, 1, sync))), m.max(0, m.mul(z, -1)));
    const fSync = m.fract(m.div(m.sub(t, lag), FLASH.beat));
    const w = m.smooth(0.15, 0.85, sync);
    return {
        flash: m.mix(pulseWith(m, fOwn), pulseWith(m, fSync), w), fOwn, fSync, own, w,
    };
}

// ── Shared ──────────────────────────────────────────────────────────────────────────────────

/**
 * A quad (corners at ±1, wound to face +z) for `count` instances, its per-instance data in one
 * static interleaved buffer of vec4s exposed under `names` (WebGPU binds at most eight vertex
 * buffers; this is two).
 */
export function airQuads(count, data, names) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
    ], 3));
    const stride = names.length * 4;
    const buffer = new THREE.InstancedInterleavedBuffer(data, stride, 1);
    names.forEach((name, k) => {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** An additive light: adds its rgb, leaves the target's alpha alone. */
function lightMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = name;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

function airPart(mesh, extra = {}) {
    return {
        mesh,
        ...extra,
        dispose() {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            mesh.material.dispose();
        },
    };
}

function airMesh(geometry, material, name, order) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
}

/**
 * The T-spin's turn of the air at a point: the vortex about the vertical axis through
 * (turn.z, turn.w), measured in an ellipse stretched down the nave so what it carries keeps
 * inside the house. A point goes round by turn.x (the turn's angle so far) as far as the vortex
 * holds it (its strength turn.y, falling off from the heart), so mid-turn the air wheels and as
 * the turn dies everything slides back home; it rises a little while it is carried.
 */
function turnOfTheAir(p, U) {
    const reach = vec2(TURN.reachX, TURN.reachZ);
    const rel = p.xz.sub(U.turn.zw).div(reach);
    const held = exp(dot(rel, rel).mul(-TURN.falloff)).mul(U.turn.y);
    const c = cos(U.turn.x);
    const s = sin(U.turn.x);
    const turned = vec2(rel.x.mul(c).sub(rel.y.mul(s)), rel.x.mul(s).add(rel.y.mul(c)));
    const xz = mix(rel, turned, held).mul(reach).add(U.turn.zw);
    return vec3(clamp(xz.x, -TURN.wall, TURN.wall), p.y.add(held.mul(TURN.lift)), xz.y);
}

/** Where a falling drop meets the garden: the canal's water, the path, or a bed's soil (groundAt). */
function groundUnder(x, z) {
    const ax = abs(x);
    const canal = ax.lessThan(FLOOR.canal.half).and(z.lessThan(FLOOR.canal.head)).and(z.greaterThan(FLOOR.canal.end));
    const dry = select(ax.lessThan(FLOOR.path.outer), float(0.0), float(FLOOR.bed.soil));
    return select(canal, float(FLOOR.canal.water), dry);
}

/** The vault's inner height over x (vaultHeightAt). */
function vaultOver(x) {
    const dx = min(abs(x), HOUSE.halfSpan).add(ARC.offset);
    return sqrt(max(float(ARC.radius * ARC.radius).sub(dx.mul(dx)), 0.0)).add(HOUSE.spring);
}

// ── Fireflies ───────────────────────────────────────────────────────────────────────────────

/** Dots of a flash's J left hanging per firefly (0: no trails on this tier). */
export function trailDotsFor(tier) {
    if (tier.fireflies >= 300) return 6;
    if (tier.fireflies >= 200) return 5;
    return 0;
}

/**
 * The swarm, as instance data (12 floats an instance: aFlyA, aFlyB, aFlyC):
 *   aFlyA  home (x, y, z) and the share of the swarm it belongs to (out while swarm > it)
 *   aFlyB  rhythm seed, phase seed, glow radius, trail dot (0 the firefly itself, 1..dots)
 *   aFlyC  wander rates across, along and up the house (rad/s), and its reach (metres)
 * Homes: round the beds, along the bed fronts and the paths' edges, low over the canal and up
 * among the crowns; denser near the eye (what is far is mostly behind the card).
 */
export function fireflyPlan(tier, seed = 1861) {
    const rand = mulberry32((seed * 7919) ^ 0xf1ef1e);
    const count = Math.max(1, tier.fireflies | 0);
    const dots = trailDotsFor(tier);
    const homes = [];
    for (let i = 0; i < count; i += 1) {
        const side = rand() < 0.5 ? -1 : 1;
        const reach = lerp(0.35, 1.0, rand());
        const pick = rand();
        let x;
        let y;
        let z;
        if (pick < 0.42) {
            // Over the beds, among the ferns and the bananas.
            x = side * Math.min(lerp(3.9, 6.3, rand()), 6.45 - reach);
            y = lerp(0.8, 2.7, rand() ** 1.3);
            z = lerp(1.8, -40, rand() ** 1.7);
        } else if (pick < 0.62) {
            // Along the bed fronts and the paths' edges.
            x = side * lerp(2.7, 4.1, rand());
            y = lerp(0.6, 2.2, rand());
            z = lerp(2.0, -36, rand() ** 1.7);
        } else if (pick < 0.84) {
            // Low over the canal, among the reeds and the lilies.
            x = lerp(-2.1, 2.1, rand());
            y = lerp(0.48, 1.0, rand());
            z = lerp(1.4, -30, rand() ** 1.6);
        } else {
            // Up among the crowns and the baskets.
            x = side * Math.min(lerp(2.8, 6.2, rand()), 6.45 - reach);
            y = lerp(2.6, 3.7, rand());
            z = lerp(1.5, -36, rand() ** 1.5);
        }
        homes.push({
            x,
            y,
            z,
            out: rand(),
            rhythm: rand(),
            phase: rand(),
            radius: lerp(FIREFLY.radius[0], FIREFLY.radius[1], rand()),
            wx: lerp(0.12, 0.34, rand()),
            wz: lerp(0.1, 0.3, rand()),
            wy: lerp(0.25, 0.6, rand()),
            reach,
        });
    }
    const instances = count * (1 + dots);
    const data = new Float32Array(instances * 12);
    let at = 0;
    for (let j = 0; j <= dots; j += 1) {
        for (let i = 0; i < count; i += 1) {
            const h = homes[i];
            data.set([h.x, h.y, h.z, h.out, h.rhythm, h.phase, h.radius, j, h.wx, h.wz, h.wy, h.reach], at);
            at += 12;
        }
    }
    return {
        count, dots, instances, data, homes,
    };
}

/** The fireflies part. ctx = { tier, U, seed }. */
export function createFireflies({ tier, U, seed = 1861 }) {
    const plan = fireflyPlan(tier, seed);
    const geometry = airQuads(plan.instances, plan.data, ['aFlyA', 'aFlyB', 'aFlyC']);
    const material = lightMaterial('moonlit-greenhouse-fireflies');
    const A = attribute('aFlyA', 'vec4');
    const B = attribute('aFlyB', 'vec4');
    const C = attribute('aFlyC', 'vec4');
    const { night } = U;
    const vLight = varyingProperty('vec3', 'mgFlyLight');
    const vShape = varyingProperty('vec2', 'mgFlyShape');
    const dots = plan.dots;

    material.vertexNode = Fn(() => {
        const t = U.time;
        const ph = B.y.mul(TAU).toVar();
        const reach = C.w;
        // The slow wander: two incommensurate waves across and along the house, one up, and the
        // quick small bob of a beetle's flight.
        const wander = (tau) => {
            const x = A.x.add(reach.mul(
                sin(tau.mul(C.x).add(ph)).mul(0.7).add(sin(tau.mul(C.x.mul(2.3)).add(ph.mul(2.7))).mul(0.3)),
            ));
            const z = A.z.add(reach.mul(1.4).mul(
                sin(tau.mul(C.y).add(ph.mul(1.9))).mul(0.7).add(sin(tau.mul(C.y.mul(1.7)).add(ph.mul(3.3))).mul(0.3)),
            ));
            const y = A.y.add(reach.mul(0.3).mul(sin(tau.mul(C.z).add(ph.mul(4.1)))))
                .add(sin(tau.mul(6.3).add(ph.mul(5.0))).mul(0.022));
            return vec3(clamp(x, -6.45, 6.45), max(y, 0.32), z);
        };
        // The J of a flash: forward and a touch down as the lantern lights, hooking up as it burns;
        // after it the firefly drifts back down to its wander over the dark rest of the period.
        const hook = (f) => {
            const s = clamp(f.div(FLASH.width * 1.15), 0.0, 1.0);
            const a = s.mul(Math.PI / 2);
            const settle = float(1.0).sub(smoothstep(FLASH.width * 1.15, 1.0, f));
            return vec2(sin(a), float(1.0).sub(cos(a)).sub(sin(a.mul(2.0)).mul(0.15))).mul(settle);
        };
        const heading = vec2(cos(ph.mul(3.7)), sin(ph.mul(3.7)));
        const flight = (tau) => {
            const home = wander(tau).toVar();
            const fl = flashWith(TSL_MATH, tau, B.x, home.z, U.sync);
            const j = mix(hook(fl.fOwn), hook(fl.fSync), fl.w);
            const along = heading.mul(j.x.mul(FIREFLY.hook[0]));
            return { p: home.add(vec3(along.x, j.y.mul(FIREFLY.hook[1]), along.y)), flash: fl.flash, fl };
        };

        const now = flight(t);
        const out = smoothstep(0.0, 0.04, U.swarm.sub(A.w));
        const dark = float(1.0).sub(U.hush);
        const live = out.mul(dark).toVar();
        const light = vec3(0.0).toVar();
        const radius = float(0.0).toVar();
        const where = now.p.toVar();
        if (dots > 0) {
            // A trail's dot: the firefly where it was at a moment of its latest flash (of the rhythm
            // it mostly keeps), lit as it was then, fading as time goes on and gone before the next.
            const dot = B.w;
            const useBeat = now.fl.w.greaterThan(0.5);
            const period = select(useBeat, float(FLASH.beat), now.fl.own);
            const phase = select(useBeat, now.fl.fSync, now.fl.fOwn);
            const began = t.sub(phase.mul(period));
            const tau = began.add(dot.sub(0.5).div(dots).mul(FLASH.width).mul(period));
            const then = flight(tau);
            const since = t.sub(tau);
            const kept = select(since.greaterThan(0.0), float(1.0), float(0.0))
                .mul(exp(max(since, 0.0).mul(-1.0 / FIREFLY.trailFade)))
                .mul(float(1.0).sub(smoothstep(0.72, 0.97, phase)));
            const isDot = dot.greaterThan(0.5);
            const dotLight = night.firefly.mul(then.flash.mul(kept).mul(FIREFLY.peak * FIREFLY.trailGain));
            const glow = max(now.flash, U.flood);
            const flyLight = night.firefly.mul(float(FIREFLY.ember).add(glow).mul(FIREFLY.peak)
                .mul(U.flood.mul(FIREFLY.floodGain).add(1.0)));
            light.assign(select(isDot, dotLight, flyLight).mul(live));
            radius.assign(select(isDot, float(FIREFLY.trailRadius), B.z.mul(glow.mul(0.7).add(0.5))));
            where.assign(select(isDot, then.p, now.p));
        } else {
            const glow = max(now.flash, U.flood);
            light.assign(night.firefly.mul(float(FIREFLY.ember).add(glow).mul(FIREFLY.peak)
                .mul(U.flood.mul(FIREFLY.floodGain).add(1.0))).mul(live));
            radius.assign(B.z.mul(glow.mul(0.7).add(0.5)));
        }
        const p = turnOfTheAir(where, U);
        const view = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.05);
        const perPixel = depth.mul(U.pixelAngle);
        const px = radius.div(perPixel);
        // Never under a couple of pixels; the floor's extra area is paid back in light.
        const shown = mgMax3(light).greaterThan(0.002);
        const pxDrawn = select(shown, max(px, FIREFLY.least), float(0.0));
        const paid = clamp(px.div(max(pxDrawn, 1e-3)), 0.55, 1.0);
        vLight.assign(light.mul(paid.mul(paid)));
        // The hot core's sharpness in quad units, never finer than a pixel.
        vShape.assign(vec2(min(float(34.0), pxDrawn.mul(pxDrawn).mul(1.4)), select(B.w.greaterThan(0.5), float(0.0), float(0.32))));
        const at = view.xy.add(positionGeometry.xy.mul(pxDrawn.mul(perPixel)));
        return cameraProjectionMatrix.mul(vec4(at, view.z, 1.0));
    })();

    material.outputNode = Fn(() => {
        const q = positionGeometry.xy;
        const r2 = dot(q, q);
        const core = exp(r2.mul(vShape.x).negate());
        const halo = exp(r2.mul(-4.2)).mul(vShape.y);
        const edge = float(1.0).sub(smoothstep(0.55, 1.0, r2));
        // The core burns whiter than the halo (a hot point in a green-gold bloom).
        const hot = mix(vLight, vec3(mgMax3(vLight)).mul(vec3(1.0, 1.0, 0.82)), 0.42);
        return vec4(hot.mul(core).add(vLight.mul(halo)).mul(edge), 0.0);
    })();

    const mesh = airMesh(geometry, material, 'moonlit-greenhouse-fireflies', 64);
    return airPart(mesh, { count: plan.count, dots: plan.dots, instances: plan.instances });
}

// ── Moths ───────────────────────────────────────────────────────────────────────────────────

/**
 * The moths, as instance data (two instances a moth, one a wing; 12 floats: aMothA, aMothB, aMothC):
 *   aMothA  the flame of its lantern (x, y, z) and the wing's side (−1 left, +1 right)
 *   aMothB  orbit radius, angular rate (signed), phase seed, half-span
 *   aMothC  wing beats a second, seconds between roams, roam phase, a tint seed
 * Lanterns are taken nearest first (the plan's lanterns sorted by z descending), the near pair
 * most often: those are the moths the eye sees beside the card.
 */
export function mothPlan(tier, plan, seed = 1861) {
    const rand = mulberry32((seed * 104729) ^ 0x10a3);
    const count = Math.max(1, tier.moths | 0);
    const lamps = [...(plan?.lanterns || [])].sort((a, b) => b.z - a.z);
    if (!lamps.length) lamps.push({ x: -3.15, y: 3.7, z: -0.05 });
    const data = new Float32Array(count * 2 * 12);
    const moths = [];
    for (let i = 0; i < count; i += 1) {
        const lamp = lamps[MOTH.picks[i % MOTH.picks.length] % lamps.length];
        // The world lights the house from the flame, 0.18 below the lantern's plan point.
        const flame = [lamp.x, lamp.y - 0.18, lamp.z];
        const moth = {
            flame,
            orbit: lerp(MOTH.orbit[0], MOTH.orbit[1], rand()),
            rate: lerp(MOTH.speed[0], MOTH.speed[1], rand()) * (rand() < 0.5 ? -1 : 1),
            phase: rand(),
            span: lerp(MOTH.span[0], MOTH.span[1], rand()),
            flap: lerp(MOTH.flap[0], MOTH.flap[1], rand()),
            roam: lerp(MOTH.roam[0], MOTH.roam[1], rand()),
            roamPhase: rand(),
            tint: rand(),
        };
        moths.push(moth);
        [-1, 1].forEach((side, k) => {
            data.set([
                ...flame, side, moth.orbit, moth.rate, moth.phase, moth.span,
                moth.flap, moth.roam, moth.roamPhase, moth.tint,
            ], (i * 2 + k) * 12);
        });
    }
    return {
        count, instances: count * 2, data, moths,
    };
}

/** A smooth union of two distances (k metres of blend, in wing units). */
const smin = (a, b, k) => {
    const h = clamp(float(0.5).add(b.sub(a).mul(0.5 / k)), 0.0, 1.0);
    return mix(b, a, h).sub(h.mul(float(1.0).sub(h)).mul(k));
};

/** Distance (roughly, in units of the half-span) to an ellipse at `c`, semi-axes `r`, turned `turn` rad. */
function ellipse(q, c, r, turn) {
    const d = q.sub(vec2(...c));
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const e = vec2(d.x.mul(cs).add(d.y.mul(sn)), d.y.mul(cs).sub(d.x.mul(sn))).div(vec2(...r));
    return { d: length(e).sub(1.0).mul(Math.min(r[0], r[1])), e };
}

/** Distance to a tapering capsule from a to b (radii ra, rb), and how far along it the nearest point is. */
function taper(q, a, b, ra, rb) {
    const pa = q.sub(vec2(...a));
    const ba = vec2(b[0] - a[0], b[1] - a[1]);
    const h = clamp(dot(pa, ba).div(ba[0] * ba[0] + ba[1] * ba[1] || 1), 0.0, 1.0);
    return { d: length(pa.sub(ba.mul(h))).sub(mix(float(ra), float(rb), h)), h };
}

/** The moths part. ctx = { tier, U, plan, seed }. */
export function createMoths({
    tier, U, plan, seed = 1861,
}) {
    const mp = mothPlan(tier, plan, seed);
    const geometry = airQuads(mp.instances, mp.data, ['aMothA', 'aMothB', 'aMothC']);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'moonlit-greenhouse-moths';
    material.alphaTest = 0.5;
    const A = attribute('aMothA', 'vec4');
    const B = attribute('aMothB', 'vec4');
    const C = attribute('aMothC', 'vec4');
    const { night } = U;
    const vP = varyingProperty('vec3', 'mgMothP');
    const vN = varyingProperty('vec3', 'mgMothN');
    const vWing = varyingProperty('vec2', 'mgMothWing');

    material.vertexNode = Fn(() => {
        const t = U.time;
        const ph = B.z.mul(TAU).toVar();
        const lamp = A.xyz;
        const awaySide = select(A.x.lessThan(0.0), float(1.0), float(-1.0));
        // The lazy loop round the lamp, its radius breathing, now and then a dart at the glass;
        // the flutter of a big soft moth; every so often a long loop out over the bed and back.
        const path = (tau) => {
            const angle = tau.mul(B.y).add(ph);
            const dart = smoothstep(0.86, 1.0, sin(tau.mul(0.23).add(ph.mul(1.7))));
            const r = B.x.mul(sin(tau.mul(0.41).add(ph.mul(2.3))).mul(0.22).add(1.0)).mul(float(1.0).sub(dart.mul(0.5)));
            const orbit = vec3(
                cos(angle).mul(r),
                sin(tau.mul(1.1).add(ph.mul(3.1))).mul(0.16).add(sin(tau.mul(2.7).add(ph)).mul(0.07)).sub(0.02),
                sin(angle).mul(r).mul(0.85),
            );
            const flutter = vec3(
                sin(tau.mul(5.3).add(ph.mul(4.0))),
                sin(tau.mul(6.1).add(ph.mul(5.0))).mul(0.8),
                sin(tau.mul(4.7).add(ph.mul(6.0))),
            ).mul(0.032);
            const u = fract(tau.div(C.y).add(C.z));
            const v = smoothstep(0.0, 1.0, clamp(u.div(0.3), 0.0, 1.0));
            const lobe = sin(v.mul(Math.PI));
            const roam = vec3(
                awaySide.mul(lobe.mul(lobe).mul(0.7)),
                lobe.mul(lobe).mul(1.1).add(sin(v.mul(TAU)).mul(0.35)),
                sin(v.mul(TAU)).mul(-3.2),
            );
            return lamp.add(orbit).add(flutter).add(roam);
        };
        const body = turnOfTheAir(path(t), U).toVar();
        const ahead = turnOfTheAir(path(t.add(0.035)), U);
        const behind = turnOfTheAir(path(t.sub(0.035)), U);
        const run = ahead.sub(behind);
        const level = vec3(run.x, run.y.mul(0.5), run.z);
        // The body points where it flies, nose a little up as a moth flies.
        const forward = normalize(select(length(level).greaterThan(1e-5), level, vec3(0.0, 0.0, -1.0))
            .add(vec3(0.0, length(level).mul(0.3), 0.0))).toVar();
        const side = normalize(vec3(forward.z.negate(), 0.0, forward.x).add(vec3(1e-5, 0.0, 0.0))).toVar();
        const up = normalize(side.cross(forward)).toVar();
        // The beat: an upstroke to near upright and down past level; now and then a glide on
        // wings held open.
        const glide = smoothstep(-0.35, 0.35, sin(t.mul(0.7).add(ph.mul(2.0))));
        const beat = sin(t.mul(C.x.mul(TAU)).add(ph.mul(9.0)));
        const lift = beat.mul(glide.mul(0.62).add(0.12)).add(0.38);
        const wing = side.mul(A.w).mul(cos(lift)).add(up.mul(sin(lift))).toVar();
        const view = cameraViewMatrix.mul(vec4(body, 1.0));
        const depth = max(view.z.negate(), 0.05);
        const span = max(B.w, depth.mul(U.pixelAngle).mul(MOTH.least));
        const g = positionGeometry.xy;
        const a = mix(float(-0.07), float(1.0), g.x.mul(0.5).add(0.5));
        const b = mix(float(-0.98), float(0.36), g.y.mul(0.5).add(0.5));
        const p = body.add(forward.mul(b.mul(span))).add(wing.mul(a.mul(span)));
        vP.assign(p);
        // The quad's own facing (its corners wind about wing × forward); the fragment turns it to the eye.
        vN.assign(normalize(wing.cross(forward)));
        vWing.assign(vec2(a, b));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1.0)));
    })();

    material.colorNode = Fn(() => {
        const q = vWing;
        // ── The wing's outline: the forewing, the round hindwing and its long tail, the body.
        const fore = ellipse(q, [0.47, 0.07], [0.52, 0.19], 0.12);
        const hind = ellipse(q, [0.29, -0.21], [0.31, 0.22], -0.35);
        const tailA = taper(q, [0.3, -0.33], [0.37, -0.66], 0.075, 0.042);
        const tailB = taper(q, [0.37, -0.66], [0.47, -0.95], 0.042, 0.03);
        const spoon = length(q.sub(vec2(0.465, -0.93))).sub(0.042);
        const bodyE = ellipse(q, [0.0, -0.1], [0.055, 0.3], 0.0);
        const tail = min(min(tailA.d, tailB.d), spoon);
        const wingD = smin(smin(fore.d, hind.d, 0.05), tail, 0.035);
        const d = min(wingD, bodyE.d);
        const aa = max(fwidth(d), 1e-4);
        const alpha = float(1.0).sub(smoothstep(aa.negate(), aa, d));
        // ── The colouring: a pale lime-mint, paler and furred at the base, a maroon leading edge,
        // a yellow-pink outer margin, eye-spots ringed dark round an ochre with a clear window.
        const pale = vec3(0.56, 0.7, 0.46);
        const green = mix(vec3(0.4, 0.66, 0.28), vec3(0.46, 0.68, 0.24), C.w);
        const base = mix(pale, green, smoothstep(0.05, 0.45, length(q.sub(vec2(0.0, -0.08)))));
        const costa = smoothstep(0.66, 0.8, fore.e.y).mul(float(1.0).sub(smoothstep(0.82, 0.98, fore.e.x)))
            .mul(float(1.0).sub(smoothstep(-0.01, 0.01, fore.d)));
        const margin = smoothstep(-0.035, -0.012, wingD).mul(smoothstep(0.25, 0.45, q.x));
        const spotAt = (c, r) => {
            const s = length(q.sub(vec2(...c)).div(vec2(1.0, 1.25)));
            const rim = float(1.0).sub(smoothstep(0.009, 0.017, abs(s.sub(r))));
            const inner = float(1.0).sub(smoothstep(r - 0.014, r - 0.006, s));
            const window = float(1.0).sub(smoothstep(r * 0.32, r * 0.42, length(q.sub(vec2(c[0] + 0.012, c[1] + 0.012)))));
            return { rim, inner, window };
        };
        const s1 = spotAt([0.42, 0.09], 0.058);
        const s2 = spotAt([0.3, -0.25], 0.064);
        const rim = max(s1.rim, s2.rim);
        const inner = max(s1.inner, s2.inner);
        const window = max(s1.window, s2.window);
        const isBody = float(1.0).sub(smoothstep(-0.004, 0.004, bodyE.d));
        const albedo = base.toVar();
        albedo.assign(mix(albedo, vec3(0.66, 0.5, 0.26), margin.mul(0.7)));
        albedo.assign(mix(albedo, vec3(0.24, 0.07, 0.11), costa));
        albedo.assign(mix(albedo, vec3(0.62, 0.5, 0.16), inner));
        albedo.assign(mix(albedo, vec3(0.8, 0.78, 0.6), window.mul(0.6)));
        albedo.assign(mix(albedo, vec3(0.13, 0.03, 0.05), rim));
        albedo.assign(mix(albedo, vec3(0.78, 0.8, 0.72), isBody));
        // How much light passes through: the thin membrane, the eye-spot's clear window, little
        // through the scaled edges and the body.
        const transmit = mix(float(0.7), float(0.15), max(max(costa, rim), isBody)).add(window.mul(0.45));
        // ── Light: the house's own (the moon through the glazing, the lanterns, the blooms), the
        // moth's lamp glowing through its wings when the lamp is behind them, the moon too.
        const p = vP;
        const v = normalize(p.sub(cameraPosition)).toVar();
        const nG = normalize(vN);
        const n = select(frontFacing, nG, nG.negate());
        const foot = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z))).add(0.002);
        const vis = mgMoonVis(p, U, foot).toVar();
        const lit = mgSurface(p, n, albedo, U, { soft: foot, vis, view: v });
        const toLamp = A.xyz.sub(p);
        const near = length(toLamp);
        const behind = clamp(dot(v, toLamp.div(max(near, 1e-3))), 0.0, 1.0);
        const back2 = behind.mul(behind);
        const glowLamp = night.lantern.mul(U.lanternGain).mul(back2.mul(back2).mul(0.85).add(0.15))
            .div(near.mul(near).mul(5.0).add(1.0)).mul(transmit).mul(mix(albedo.mul(2.2), vec3(1.0), 0.25));
        const through = clamp(dot(v, U.moon), 0.0, 1.0);
        const glowMoon = night.moonlight.mul(U.moonLight).mul(vis).mul(through.mul(through)).mul(0.3)
            .mul(transmit)
            .mul(albedo);
        return vec4(lit.add(glowLamp.mul(0.9)).add(glowMoon), alpha);
    })();

    const mesh = airMesh(geometry, material, 'moonlit-greenhouse-moths', 7);
    return airPart(mesh, { count: mp.count, instances: mp.instances });
}

// ── Motes ───────────────────────────────────────────────────────────────────────────────────

/**
 * The motes, as instance data (8 floats: aMoteA, aMoteB):
 *   aMoteA  where it starts (x, y, z) and a phase seed
 *   aMoteB  its slow rise (m/s; most sink), its wander's reach, its size (pixels), 1 a glinting flake
 */
export function motePlan(tier, seed = 1861) {
    const rand = mulberry32((seed * 15485863) ^ 0xd057);
    const count = Math.max(1, tier.motes | 0);
    const { box } = MOTE;
    const data = new Float32Array(count * 8);
    for (let i = 0; i < count; i += 1) {
        data.set([
            lerp(-box.x, box.x, rand()),
            lerp(box.from, box.to, rand()),
            lerp(box.near, box.far, rand() ** 1.2),
            rand(),
            lerp(-0.035, 0.018, rand()),
            lerp(0.2, 0.7, rand()),
            lerp(MOTE.pixels[0], MOTE.pixels[1], rand()),
            rand() < MOTE.glinting ? 1 : 0,
        ], i * 8);
    }
    return { count, data };
}

/** The motes part. ctx = { tier, U, seed }. */
export function createMotes({ tier, U, seed = 1861 }) {
    const mp = motePlan(tier, seed);
    const geometry = airQuads(mp.count, mp.data, ['aMoteA', 'aMoteB']);
    const material = lightMaterial('moonlit-greenhouse-motes');
    const A = attribute('aMoteA', 'vec4');
    const B = attribute('aMoteB', 'vec4');
    const { night } = U;
    const { box } = MOTE;
    const vLight = varyingProperty('vec3', 'mgMoteLight');

    material.vertexNode = Fn(() => {
        const t = U.time;
        const ph = A.w.mul(TAU).toVar();
        const height = box.to - box.from;
        // The slow fall (or rise) through the nave, wrapping: it thins out at the ends of its run.
        const run = fract(A.y.sub(box.from).div(height).add(t.mul(B.x).div(height)));
        const fade = smoothstep(0.0, 0.05, run).mul(float(1.0).sub(smoothstep(0.95, 1.0, run)));
        const reach = B.y;
        const drift = vec3(
            sin(t.mul(0.11).add(ph)).mul(0.6).add(sin(t.mul(0.27).add(ph.mul(2.3))).mul(0.4)),
            sin(t.mul(0.19).add(ph.mul(4.3))).mul(0.4),
            sin(t.mul(0.09).add(ph.mul(1.7))).mul(0.6).add(sin(t.mul(0.23).add(ph.mul(3.1))).mul(0.4)),
        ).mul(reach);
        const rest = vec3(A.x, run.mul(height).add(box.from), A.z).add(drift);
        const p = turnOfTheAir(rest, U).toVar();
        // Its light: the moonlight that reaches it, scattered forward toward the eye.
        const vis = mgMoonVis(p, U, float(0.03));
        const toMote = p.sub(cameraPosition);
        const far = length(toMote);
        const c = dot(toMote.div(max(far, 1e-3)), U.moon);
        const g = MOTE.forward;
        const denom = max(float(1 + g * g).sub(c.mul(2 * g)), 1e-3);
        const phase = float(1 - g * g).div(denom.mul(sqrt(denom)));
        // A flake flashes as it turns a face to the moon; pollen burns steadily.
        const turn = sin(t.mul(A.w.mul(2.2).add(0.9)).add(ph.mul(7.0))).mul(0.5).add(0.5);
        const t2 = turn.mul(turn);
        const glint = select(B.w.greaterThan(0.5), t2.mul(t2).mul(t2).mul(2.6).add(0.12), float(0.62));
        const pollen = select(B.w.greaterThan(0.5), vec3(1.0), vec3(1.0, 0.92, 0.74));
        const near = float(1.0).div(far.mul(far).div(140.0).add(1.0));
        const light = night.moonlight.mul(pollen).mul(U.moonLight).mul(vis)
            .mul(phase.mul(0.085).add(0.05))
            .mul(glint)
            .mul(fade)
            .mul(near)
            .mul(MOTE.gain)
            .toVar();
        // A mote in shadow is not drawn at all (most of them, most of the time).
        const shown = mgMax3(light).greaterThan(0.003);
        const view = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.05);
        const size = select(shown, B.z.mul(depth).mul(U.pixelAngle), float(0.0));
        vLight.assign(light);
        const at = view.xy.add(positionGeometry.xy.mul(size));
        return cameraProjectionMatrix.mul(vec4(at, view.z, 1.0));
    })();

    material.outputNode = Fn(() => {
        const q = positionGeometry.xy;
        const r2 = dot(q, q);
        const spark = exp(r2.mul(-3.2)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
        return vec4(vLight.mul(spark), 0.0);
    })();

    const mesh = airMesh(geometry, material, 'moonlit-greenhouse-motes', 63);
    return airPart(mesh, { count: mp.count });
}

// ── Dew ─────────────────────────────────────────────────────────────────────────────────────

/** Resting drips the tier keeps beside the curtain's pool. */
export function dripsFor(tier) {
    return Math.max(DEW.fewest, Math.round((tier.dew | 0) * DEW.drips));
}

/**
 * A drop let go at `top`, falling to `ground` against drag toward its terminal speed `vt`: its
 * height and speed `age` seconds on, and the moment it lands. The CPU twin of the dew's vertex
 * stage; with DEW.terminal a curtain's drops reach the floor TIMING.dewFall or so after they are
 * shaken loose (the tests hold it to that).
 */
export function dropFall(top, ground, vt, age = 0) {
    const k = DEW.gravity / vt;
    const lands = Math.acosh(Math.exp((Math.max(top - ground, 0.05) * k) / vt)) / k;
    const kt = Math.min(k * Math.max(age, 0), 30);
    const lnCosh = kt + Math.log1p(Math.exp(-2 * kt)) - Math.LN2;
    return { y: top - ((vt * vt) / DEW.gravity) * lnCosh, speed: vt * Math.tanh(kt), lands };
}

/**
 * The dew, as instance data (8 floats: aDewA, aDewB). The curtain first, then the drips:
 *   curtain  aDewA (across 0..1, along 0..1, its share of a curtain, how far below the glass it
 *            hangs), aDewB (0, release delay, terminal speed, sideways shake)
 *   drip     aDewA (x, z, 0, how far below the glass), aDewB (1, seconds between falls, terminal
 *            speed, phase)
 * Each curtain moves its drops by its birth (a hash of it), so no two hard drops shake the same
 * drops; the drips keep their places on the glass.
 */
export function dewPlan(tier, seed = 1861) {
    const rand = mulberry32((seed * 32452843) ^ 0xde3);
    const curtain = Math.max(1, tier.dew | 0);
    const drips = dripsFor(tier);
    const data = new Float32Array((curtain + drips) * 8);
    // Shares of the curtain, stratified then shuffled: a weaker shake looses an even scatter.
    const shares = Array.from({ length: curtain }, (_, i) => (i + rand()) / curtain);
    for (let i = shares.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [shares[i], shares[j]] = [shares[j], shares[i]];
    }
    for (let i = 0; i < curtain; i += 1) {
        data.set([
            rand(), rand(), shares[i], rand() * 0.6,
            0, rand() * DEW.shake, lerp(DEW.terminal[0], DEW.terminal[1], rand()), (rand() - 0.5) * 0.6,
        ], i * 8);
    }
    const spots = [];
    for (let i = 0; i < drips; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const x = side * lerp(1.4, 6.3, rand());
        const z = lerp(1.5, -18, rand() ** 1.3);
        spots.push({ x, z, top: vaultHeightAt(x) });
        data.set([
            x, z, 0, rand() * 0.15,
            1, lerp(DEW.dripEvery[0], DEW.dripEvery[1], rand()), lerp(DEW.terminal[0], DEW.terminal[1], rand()), rand(),
        ], (curtain + i) * 8);
    }
    return {
        curtain, drips, instances: curtain + drips, data, spots,
    };
}

/** The dew part. ctx = { tier, U, seed }. */
export function createDew({ tier, U, seed = 1861 }) {
    const dp = dewPlan(tier, seed);
    const geometry = airQuads(dp.instances, dp.data, ['aDewA', 'aDewB']);
    const material = lightMaterial('moonlit-greenhouse-dew');
    const A = attribute('aDewA', 'vec4');
    const B = attribute('aDewB', 'vec4');
    const { night } = U;
    const vLight = varyingProperty('vec3', 'mgDewLight');
    const vShape = varyingProperty('vec2', 'mgDewShape');
    const g = DEW.gravity;

    material.vertexNode = Fn(() => {
        const t = U.time;
        const isDrip = B.x.greaterThan(0.5);
        // ── The curtain: the hard drop's birth moves the drops (no two curtains alike); the shake
        // looses those nearest the card first.
        const birth = U.dew.x;
        const hb = fract(birth.mul(0.6180339).add(0.37));
        const cx = mix(float(-6.4), float(6.4), fract(A.x.add(hb)));
        const cz = mix(float(1.0), float(-22.0), fract(A.y.add(hb.mul(1.73))));
        const cAge = t.sub(birth).sub(B.y).sub(abs(cx).mul(0.03));
        const cOn = A.z.lessThan(U.dew.y);
        // ── A drip: hangs gathering on the glass, falls on its own beat from its own place.
        const period = B.y;
        const local = fract(t.div(period).add(B.w)).mul(period);
        const x = select(isDrip, A.x, cx).toVar();
        const z = select(isDrip, A.y, cz).toVar();
        const top = vaultOver(x).sub(0.2).sub(A.w);
        const ground = groundUnder(x, z);
        const vt = B.z;
        const k = float(g).div(vt);
        // Fall against drag: y = top − vt²/g · ln cosh(k·age), v = vt · tanh(k·age). It lands when
        // ln cosh reaches the drop's height in those units.
        const height = max(top.sub(ground), 0.05);
        const u = exp(height.mul(k).div(vt));
        const lands = log(u.add(sqrt(max(u.mul(u).sub(1.0), 0.0)))).div(k);
        const cycle = lands.add(DEW.splash + 0.08);
        const dAge = local.sub(max(period.sub(cycle), 0.0));
        const age = select(isDrip, dAge, cAge).toVar();
        const falling = max(age, 0.0);
        const kt = min(k.mul(falling), 30.0);
        const lnCosh = kt.add(log(exp(kt.mul(-2.0)).add(1.0))).sub(Math.LN2);
        const speed = vt.mul(float(1.0).sub(float(2.0).div(exp(kt.mul(2.0)).add(1.0))));
        const landed = age.greaterThan(lands);
        const since = age.sub(lands);
        const shake = select(isDrip, float(0.0), B.w);
        const fallY = top.sub(vt.mul(vt).div(g).mul(lnCosh));
        const head = vec3(x.add(shake.mul(min(falling, lands))), select(landed, ground.add(0.03), fallY), z).toVar();
        const vel = select(landed, vec3(0.0), vec3(shake, speed.negate(), 0.0));
        // ── Alive: a curtain's drop from its release until its burst is over; a drip always (it
        // hangs between falls), its burst over just before it gathers again.
        const curtainAlive = cOn.and(age.greaterThanEqual(0.0)).and(since.lessThan(DEW.splash));
        const dripAlive = since.lessThan(DEW.splash);
        const alive = select(isDrip, dripAlive, curtainAlive);
        // ── Its light: the moon through the glazing, refracted forward toward the eye most, and
        // the lanterns it passes; a burst where it lands; a drip gathering glints faintly.
        const toDrop = head.sub(cameraPosition);
        const far = length(toDrop);
        const view = toDrop.div(max(far, 1e-3)).toVar();
        const vis = mgMoonVis(head, U, float(0.02));
        const fw = clamp(dot(view, U.moon), 0.0, 1.0);
        const fw2 = fw.mul(fw);
        const moon = night.moonlight.mul(U.moonLight).mul(vis).mul(fw2.mul(fw2).mul(fw2).mul(DEW.moonGlint).add(0.22));
        const lamps = mgLanterns(head, view.negate(), U).mul(DEW.lanternGlint);
        const burst = select(landed, exp(max(since, 0.0).mul(-1.0 / 0.05)).mul(2.4).add(0.3), float(1.0));
        const gather = select(age.lessThan(0.0), smoothstep(-2.5, 0.0, age).mul(0.3), float(1.0));
        const strength = select(isDrip, float(0.75), clamp(U.dew.y, 0.0, 1.0));
        const light = moon.add(lamps).mul(burst).mul(gather).mul(strength).toVar();
        // ── The streak: the drop's path over the shutter, on screen, at the drop's own depth.
        const hv = cameraViewMatrix.mul(vec4(head, 1.0)).xyz.toVar();
        const tv = cameraViewMatrix.mul(vec4(head.sub(vel.mul(DEW.shutter)), 1.0)).xyz;
        const depth = max(hv.z.negate(), 0.05);
        const sh = hv.xy.div(depth);
        const st = tv.xy.div(max(tv.z.negate(), 0.05));
        const seg = sh.sub(st);
        const segLength = length(seg);
        const dir = select(segLength.greaterThan(1e-7), seg.div(max(segLength, 1e-7)), vec2(0.0, 1.0));
        const across = vec2(dir.y.negate(), dir.x);
        const pa = U.pixelAngle;
        const len = max(segLength, pa.mul(DEW.least));
        const half = select(alive, max(float(DEW.width).div(depth), pa.mul(DEW.thin)), float(0.0));
        const lenDrawn = select(alive, len, float(0.0));
        // Spread over a longer streak, the same light is fainter in each pixel.
        vLight.assign(light.div(len.div(half.mul(4.0).add(1e-6)).add(1.0)));
        vShape.assign(vec2(lenDrawn.div(pa), half.div(pa)));
        const corner = positionGeometry.xy;
        const mid = sh.sub(dir.mul(len.mul(0.5)));
        const s = mid.add(dir.mul(corner.y.mul(lenDrawn.mul(0.5).add(half)))).add(across.mul(corner.x.mul(half)));
        return cameraProjectionMatrix.mul(vec4(s.mul(depth), depth.negate(), 1.0));
    })();

    material.outputNode = Fn(() => {
        const corner = positionGeometry.xy;
        const lenPx = vShape.x;
        const halfPx = max(vShape.y, 1e-3);
        const along = corner.y.mul(lenPx.mul(0.5).add(halfPx));
        const acrossPx = corner.x.mul(halfPx);
        const outside = max(abs(along).sub(lenPx.mul(0.5)), 0.0);
        const d = length(vec2(outside, acrossPx)).div(halfPx);
        const body = exp(d.mul(d).mul(-1.6)).mul(float(1.0).sub(smoothstep(0.75, 1.0, d)));
        // Brightest at the drop itself, the streak fading behind it.
        const toward = clamp(along.div(max(lenPx.mul(0.5), 1e-3)).mul(0.5).add(0.5), 0.0, 1.0);
        return vec4(vLight.mul(body).mul(toward.mul(toward).mul(0.8).add(0.3)), 0.0);
    })();

    const mesh = airMesh(geometry, material, 'moonlit-greenhouse-dew', 65);
    return airPart(mesh, { count: dp.curtain, drips: dp.drips, instances: dp.instances });
}
