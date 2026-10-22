/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — the shore: the sea, the surf, the swash and the beach in one surface.
 *
 * One fan of rings round the eye's foot, out to the horizon. Its vertices take the sand's height
 * on the beach and the surf's on the sea: a train of crests comes in at a slant to the shore, bent
 * a little along their length, steepens over the bar, breaks (in sections, the break running
 * along each crest: the peel), and goes on as a foaming bore to the waterline, where it runs up
 * the sand as a thin sheet and drains back.
 *
 * The fragment draws what the water is (dark, mirroring the night and the far coast's lamps in
 * long streaks), what the sand is (dry, a wrack line of dark weed along the top of the wash; wet
 * and glossy where the swash has been), and above all where the sea's light is. The sea is full of
 * plankton that flash blue when the water is torn, so the light is the lip of a breaking wave, the
 * front of a bore and the foam behind it, the leading edge of the swash, the lace of the backwash,
 * the rain's hits, and the drops and the waves the board throws into it. That light is mostly
 * sparks: a field of tiny points at three sizes, more of them lit the harder the water is shaken,
 * each folded into its mean where a pixel holds many; under them a fainter glow that follows the
 * foam's threads.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, atan, cameraPosition, clamp, dot, exp, float, floor, fract, int, length, max, min, mix, normalize,
    positionGeometry, positionWorld, select, sin, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import {
    DEG, SHORE_FRAME, SURF, SWASH, TAU,
} from './luminous-tides-core.js';
import {
    TUNE, breakOf, coastHeight, coastLamps, crestOf, glintLobe, hash22, horizonHaze, sandOf, shoreOf, skyColour,
    surfPhaseOf, swashOf,
} from './luminous-tides-tsl.js';

/** The fan: rings round the eye's foot from NEAR to FAR metres, HALF degrees each side of the view line. */
export const SHORE_FAN = Object.freeze({ near: 0.6, far: 9000, half: 88 });

/** The radius of ring `i` of `rings` (0 the nearest). */
export function fanRadius(i, rings) {
    return SHORE_FAN.near * (SHORE_FAN.far / SHORE_FAN.near) ** (i / Math.max(1, rings - 1));
}

/** The fan of rings round the eye's foot (positions, an upward normal, the indices). */
export function buildShoreFan(rings, spokes) {
    const half = SHORE_FAN.half * DEG;
    const positions = new Float32Array(rings * spokes * 3);
    for (let i = 0; i < rings; i += 1) {
        const r = fanRadius(i, rings);
        for (let j = 0; j < spokes; j += 1) {
            const a = -half + (2 * half * j) / (spokes - 1);
            const at = (i * spokes + j) * 3;
            positions[at] = r * Math.sin(a);
            positions[at + 1] = 0;
            positions[at + 2] = -r * Math.cos(a);
        }
    }
    const indices = new Uint32Array((rings - 1) * (spokes - 1) * 6);
    let k = 0;
    for (let i = 0; i < rings - 1; i += 1) {
        for (let j = 0; j < spokes - 1; j += 1) {
            const a = i * spokes + j;
            const b = a + spokes;
            indices[k++] = a;
            indices[k++] = a + 1;
            indices[k++] = b;
            indices[k++] = a + 1;
            indices[k++] = b + 1;
            indices[k++] = b;
        }
    }
    return { positions, indices };
}

const { along: ALONG, out: SEAWARD } = SHORE_FRAME;
const LEAN = Math.sin(SURF.oblique * DEG);
/** A crest's length on the water from one to the next (metres). */
const WAVE = SURF.period * SURF.speed;
/** Moving seaward by a metre takes a place this much further behind the crest ahead of it. */
const GRAD = [SEAWARD.x - LEAN * ALONG.x, SEAWARD.z - LEAN * ALONG.z];
const AVERAGE = SURF.height;

const step01 = (v) => smoothstep(0.0, 0.001, v);

/**
 * One of the board's waves of light at (a, s) and time t (rows ra, rb: a0, s0, t0, strength / H,
 * speed, sBreak, peel): vec2(its lift, d(lift)/ds). It stands up as it comes in, taller in the
 * middle of its length and tapering at its ends, its height wandering along it, and lies down as
 * it breaks, the break running along the peel.
 */
const waveLift = /* @__PURE__ */ Fn(([a, s, t, ra, rb]) => {
    const age = max(t.sub(ra.z), 0.0);
    const sE = ra.y.sub(rb.y.mul(age));
    const across = s.sub(sE);
    const off = abs(a.sub(ra.x));
    const late = off.div(max(rb.w, 1.0)).mul(rb.y);
    const standing = smoothstep(rb.z.sub(late).sub(3.0), rb.z.sub(late).add(1.0), sE);
    const reach = rb.w.mul(age);
    const along = smoothstep(reach.add(30.0), reach.sub(10.0), off).mul(smoothstep(60.0, 22.0, off));
    const wander = sin(a.mul(0.23).add(ra.z.mul(3.1))).mul(0.26).add(sin(a.mul(0.61).add(1.3)).mul(0.12)).add(1.0);
    const front = mix(float(0.6), rb.x.mul(0.22).add(0.3), standing);
    const back = mix(float(0.9), rb.x.mul(1.4).add(1.2), standing);
    const w = select(across.lessThan(0.0), front, back);
    const amp = rb.x.mul(wander).mul(mix(float(0.35), float(1.0), standing)).mul(along).mul(ra.w.min(1.0))
        .mul(smoothstep(0.0, 0.4, age))
        .mul(smoothstep(-0.5, 1.5, sE))
        .mul(smoothstep(-0.4, 1.4, s));
    const lift = amp.mul(exp(across.div(w).pow2().negate()));
    return vec2(lift, lift.mul(across.mul(-2.0).div(w.mul(w))));
}).setLayout({
    name: 'lt_waveLift',
    type: 'vec2',
    inputs: [
        { name: 'a', type: 'float' }, { name: 's', type: 'float' }, { name: 't', type: 'float' },
        { name: 'ra', type: 'vec4' }, { name: 'rb', type: 'vec4' },
    ],
});

/**
 * The surf at a place: the two crests either side of it (the last to pass, now shoreward, and the
 * next, still seaward), each either still a wave or already a bore.
 *   h      the water's height
 *   slope  d(h)/d(x, z)        (only with `full`)
 *   lip, bore, foam            the light terms, in units of a mean wave (only with `full`)
 */
function surfAt(a, s, t, full, noise = null) {
    const psi = surfPhaseOf(a, s, t).toVar();
    const k = floor(psi).toVar();
    const f = psi.sub(k).toVar();
    const H = crestOf(k).toVar();
    const Hn = crestOf(k.add(1.0)).toVar();
    const sb = breakOf(H, a).toVar();
    const sbN = breakOf(Hn, a).toVar();
    const dB = f.mul(WAVE).toVar();
    const dA = float(1.0).sub(f).mul(WAVE).toVar();
    // How far each crest has turned into a bore here (0 a wave, 1 a bore).
    const brk = smoothstep(sb, sb.sub(4.0), s).toVar();
    const brkN = smoothstep(sbN, sbN.sub(4.0), s).toVar();
    // A wave steepens and stands up as it nears its break line.
    const steep = smoothstep(sb.add(16.0), sb, s);
    const steepN = smoothstep(sbN.add(16.0), sbN, s).toVar();
    const wF = mix(float(4.2), float(0.9), steepN).toVar();
    const wB = mix(float(5.5), float(3.2), steep).toVar();
    const ampN = Hn.mul(mix(float(0.45), float(1.0), steepN)).toVar();
    const amp = H.mul(mix(float(0.45), float(0.8), steep)).toVar();
    const frontU = exp(dA.div(wF).pow2().negate()).toVar();
    const backU = exp(dB.div(wB).pow2().negate()).toVar();
    // A bore is lower the shallower the water, its front a steep wall, the water behind it raised.
    const hbN = Hn.mul(0.48).mul(clamp(s.div(sbN), 0.0, 1.0).pow(0.7)).add(0.035).toVar();
    const hb = H.mul(0.48).mul(clamp(s.div(sb), 0.0, 1.0).pow(0.7)).add(0.035).toVar();
    const frontB = exp(dA.div(0.5).pow2().negate()).toVar();
    const backB = exp(dB.div(WAVE * 0.32).negate()).toVar();
    // Nothing stands up the beach from the waterline.
    const wet = smoothstep(-0.4, 1.4, s).toVar();
    const trough = H.add(Hn).mul(0.06).mul(float(1.0).sub(brk));
    const h = mix(ampN.mul(frontU), hbN.mul(frontB), brkN).add(mix(amp.mul(backU), hb.mul(backB), brk)).sub(trough)
        .mul(wet);
    if (!full) return { h };

    const g = vec2(GRAD[0], GRAD[1]);
    const dFront = ampN.mul(float(1.0).sub(brkN)).mul(dA.mul(2.0).div(wF.mul(wF))).mul(frontU)
        .add(hbN.mul(brkN).mul(dA.mul(8.0)).mul(frontB));
    const dBack = amp.mul(float(1.0).sub(brk)).mul(dB.mul(-2.0).div(wB.mul(wB))).mul(backU)
        .sub(hb.mul(brk).mul(backB).div(WAVE * 0.32));
    const slope = g.mul(dFront.add(dBack)).mul(wet);

    // Each crest breaks in sections, brighter here and dimmer there, different for every wave.
    const sectionOf = (n) => smoothstep(0.22, 0.78, texture(noise, vec2(a.mul(0.027).add(n.mul(0.173)), n.mul(0.061)
        .add(0.29))).a).mul(0.85).add(0.15);
    const sec = sectionOf(k).toVar();
    const secN = sectionOf(k.add(1.0)).toVar();
    // The light. The lip as a wave breaks, and the burst of foam just behind it; the front of a
    // bore, which keeps its fire right in to the waterline, and the churn it leaves; the foam that
    // trails the bore.
    const lip = Hn.mul(exp(s.sub(sbN.sub(1.0)).div(1.7).pow2().negate())).mul(exp(dA.div(0.85).pow2().negate())).mul(secN)
        .add(H.mul(exp(s.sub(sb.sub(2.2)).div(2.4).pow2().negate())).mul(exp(dB.div(1.4).negate())).mul(sec));
    const shoreward = smoothstep(-0.2, 1.2, s);
    const bore = brkN.mul(Hn).mul(exp(dA.div(0.6).pow2().negate())).mul(secN.mul(0.55).add(0.45))
        .add(brk.mul(H).mul(exp(dB.div(1.1).negate())).mul(sec.mul(0.6).add(0.4)))
        .mul(shoreward);
    const foam = brk.mul(exp(dB.div(WAVE * 0.3).negate())).mul(H.div(AVERAGE)).mul(sec.mul(0.5).add(0.5));
    // The next crest seaward, for the water's mirror of it: how far away (metres across the shore),
    // how high, where it breaks, how brightly this stretch of it breaks.
    const ahead = vec4(dA, Hn, sbN, secN);
    return {
        h, slope, lip: lip.div(AVERAGE).mul(wet), bore: bore.div(AVERAGE).mul(wet), foam: foam.mul(wet), ahead,
    };
}

/**
 * The swash of one wave on the sand at x metres up from the waterline, laid out (pure):
 * vec4(how far up its edge is, whether it covers x, its edge's light, how far it will run).
 * `back` steps back crests (the swash still draining when the next one arrives).
 */
const swashCore = /* @__PURE__ */ Fn(([a, x, t, cusp, back]) => {
    const psi = surfPhaseOf(a, float(0.0), t).toVar();
    const k = floor(psi).sub(back).toVar();
    const tau = psi.sub(k).mul(SURF.period).toVar();
    const H = crestOf(k).toVar();
    const R = H.mul(SWASH.reachPerH).add(SWASH.reach0).mul(cusp).toVar();
    const top = sqrt(R.mul(2.0 / SWASH.gravity)).toVar();
    const front = swashOf(H, tau).mul(cusp).toVar();
    const covered = smoothstep(front.add(0.04), front.sub(0.2), x).mul(step01(tau.sub(0.02)));
    const rising = smoothstep(top, top.mul(0.82), tau);
    const near = exp(x.sub(front).div(0.24).pow2().negate());
    const pace = float(1.0).sub(tau.div(top)).mul(0.7).add(0.3);
    const edge = near.mul(mix(exp(tau.sub(top).div(1.1).negate().min(0.0)).mul(0.22), pace, rising))
        .mul(H.div(AVERAGE).add(0.4));
    return vec4(front, covered, edge, R);
}).setLayout({
    name: 'lt_swashCore',
    type: 'vec4',
    inputs: [
        { name: 'a', type: 'float' }, { name: 'x', type: 'float' }, { name: 't', type: 'float' },
        { name: 'cusp', type: 'float' }, { name: 'back', type: 'float' },
    ],
});

/**
 * This wave's swash: the laid-out core, and when it reached the waterline, the top of its run and
 * whether it is still running up (the lace drifts with it).
 */
function swashAt(a, x, t, cusp, back) {
    const core = swashCore(a, x, t, cusp, float(back)).toVar();
    if (back > 0) {
        return {
            front: core.x, covered: core.y, edge: core.z, R: core.w,
        };
    }
    const psi = surfPhaseOf(a, float(0.0), t).toVar();
    const tau = fract(psi).mul(SURF.period).toVar();
    const top = sqrt(core.w.mul(2.0 / SWASH.gravity)).toVar();
    const rising = smoothstep(top, top.mul(0.82), tau).toVar();
    return {
        front: core.x, covered: core.y, edge: core.z, R: core.w, tau, top, rising,
    };
}

/**
 * One size of sparks: a point per cell somewhere inside it, lit when the water round it is shaken
 * harder than its own threshold, most of them dim and a few bright, flickering. A point keeps at
 * least half a footprint; where a pixel holds many it folds into the cell's mean. The result is
 * normalised so that the folded mean is the share of points lit.
 */
const sparkLayer = /* @__PURE__ */ Fn(([xz, A, foot, t, cs, seed]) => {
    const cell = floor(xz.div(cs)).toVar();
    const h = hash22(cell.add(vec2(seed, seed.mul(0.53)))).toVar();
    const h2 = fract(h.mul(vec2(7.31, 3.77)).add(vec2(0.13, 0.71))).toVar();
    const pt = cell.add(h.mul(0.7).add(0.15)).mul(cs);
    const d = xz.sub(pt);
    const rd = cs.mul(0.1);
    const reff = max(rd, foot.mul(0.5)).toVar();
    const point = exp(dot(d, d).div(reff.mul(reff)).negate()).mul(rd.div(reff).pow2());
    const mean = rd.mul(rd).mul(Math.PI).div(cs.mul(cs));
    const v = mix(point, mean, smoothstep(cs.mul(0.3), cs.mul(0.8), reff)).div(mean);
    const bright = h2.y.mul(h2.y).mul(h2.y).mul(3.0).add(0.25);
    const on = smoothstep(h2.x.mul(1.6), h2.x.mul(1.6).add(0.35), A);
    const flick = sin(t.mul(h.y.mul(12.0).add(5.0)).add(h.x.mul(40.0))).mul(0.5).add(0.5);
    return v.mul(on).mul(bright).mul(flick.mul(flick).mul(0.75).add(0.25));
}).setLayout({
    name: 'lt_sparkLayer',
    type: 'float',
    inputs: [
        { name: 'xz', type: 'vec2' }, { name: 'A', type: 'float' }, { name: 'foot', type: 'float' },
        { name: 't', type: 'float' }, { name: 'cs', type: 'float' }, { name: 'seed', type: 'float' },
    ],
});

/** The sparks at a place: up to three sizes of point, averaged. */
function sparkField(xz, A, foot, t, layers) {
    const sizes = [0.24, 0.085, 0.034];
    const weights = [0.6, 0.8, 1.0];
    const n = Math.max(1, Math.min(3, layers));
    let total = float(0.0);
    let weight = 0;
    for (let i = 0; i < n; i += 1) {
        total = total.add(sparkLayer(xz, A, foot, t, float(sizes[i]), float(13.7 + i * 17.3)).mul(weights[i]));
        weight += weights[i];
    }
    return total.div(weight);
}

/** One size of rain on the water: each drop a spark where it hits and a small ring. */
const rainLayer = /* @__PURE__ */ Fn(([xz, t, rate, foot, sc, period, seed]) => {
    const cell = floor(xz.div(sc)).toVar();
    const h = hash22(cell.add(vec2(seed, 11.1))).toVar();
    const ph = t.div(period).add(h.x.mul(7.0)).toVar();
    const n = floor(ph);
    const age = fract(ph).mul(period).toVar();
    const hh = hash22(cell.add(vec2(n.mul(1.37), n.mul(0.71)))).toVar();
    const on = smoothstep(hh.x.sub(0.02), hh.x, rate);
    const pt = cell.add(hh.mul(0.6).add(0.2)).mul(sc);
    const d = length(xz.sub(pt)).toVar();
    const r = age.mul(0.42).add(0.02);
    const w = max(foot.mul(0.6), float(0.025));
    const flash = exp(age.div(-0.09)).mul(exp(d.div(max(foot, float(0.05))).pow2().negate()));
    const ring = exp(d.sub(r).div(w).pow2().negate()).mul(exp(age.div(-0.26))).mul(0.35);
    return on.mul(flash.add(ring));
}).setLayout({
    name: 'lt_rainLayer',
    type: 'float',
    inputs: [
        { name: 'xz', type: 'vec2' }, { name: 't', type: 'float' }, { name: 'rate', type: 'float' },
        { name: 'foot', type: 'float' }, { name: 'sc', type: 'float' }, { name: 'period', type: 'float' },
        { name: 'seed', type: 'float' },
    ],
});

export function createShore({
    tier, U, rows, skyNoise, seaNoise, seaVariance,
}) {
    const fan = buildShoreFan(tier.rings, tier.spokes);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.positions, 3));
    const normals = new Float32Array(fan.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SHORE_FAN.far);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide, fog: false });
    material.name = 'luminous-tides-shore';

    // ── The surface's height, in the vertex stage ──
    const rest = positionGeometry.xz;
    material.positionNode = Fn(() => {
        const sh = shoreOf(rest).toVar();
        const a = sh.x;
        const s = sh.y;
        const sand = sandOf(s).toVar();
        const water = surfAt(a, s, U.time, false).h.toVar();
        // The board's waves of light stand up too while they come in.
        Loop({
            start: int(0), end: int(U.counts.y), type: 'int', condition: '<', name: 'wv',
        }, ({ wv }) => {
            const ra = rows.breakers.element(wv.mul(2));
            const rb = rows.breakers.element(wv.mul(2).add(1));
            water.addAssign(waveLift(a, s, U.time, ra, rb).x);
        });
        const wetSheet = smoothstep(0.6, -0.6, s).mul(0.012);
        return vec3(rest.x, max(sand.add(wetSheet), water), rest.y);
    })();

    // ── The fragment ──
    const ripples = Math.min(3, Math.max(1, tier.ripples));
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const dist = max(length(toEye), 1e-3).toVar();
        const V = toEye.div(dist).toVar();
        const grazing = max(V.y, 0.012);
        // A pixel's footprint along the view, metres: what the surface can still resolve.
        const foot = dist.mul(U.pixelAngle).div(grazing).toVar();
        const xz = P.xz.toVar();
        const t = U.time;
        const { light } = U;
        const sh = shoreOf(xz).toVar();
        const a = sh.x.toVar();
        const s = sh.y.toVar();
        const x = s.negate().toVar(); // metres up the beach from the waterline

        // ── The surf ──
        const surf = surfAt(a, s, t, true, seaNoise);
        const slope = surf.slope.toVar();
        const variance = float(TUNE.glintFloor).toVar();
        // Ripples from the noise, drifting with the breeze.
        const drifts = [vec2(0.012, -0.018), vec2(-0.025, -0.033), vec2(0.046, -0.051)];
        for (let i = 0; i < ripples; i += 1) {
            const tile = TUNE.rippleTile[i];
            const strength = TUNE.ripple[i];
            const at = xz.div(tile).add(drifts[i].mul(t)).add(vec2(i * 0.37, i * 0.71));
            const sl = texture(seaNoise, at).rg.sub(0.5).mul(2.0 * strength);
            const seen = float(1.0).sub(smoothstep(tile / 90, tile / 6, foot));
            slope.addAssign(sl.mul(seen));
            variance.addAssign(float(seaVariance * strength * strength * 0.5).mul(float(1.0).sub(seen)));
        }

        // ── The swash ──
        const cuspNoise = texture(seaNoise, vec2(a.mul(0.021), 0.37)).a;
        const cusp = sin(a.mul(TAU / 8.3).add(sin(a.mul(0.11)).mul(1.3))).mul(0.16).add(cuspNoise.sub(0.5).mul(0.22))
            .add(1.0)
            .toVar();
        const sw = swashAt(a, x, t, cusp, 0);
        const covered = sw.covered.toVar();
        const edge = sw.edge.toVar();
        const wetTop = sw.R.toVar();
        if (tier.backwash) {
            const prev = swashAt(a, x, t, cusp, 1);
            covered.assign(max(covered, prev.covered));
            edge.assign(max(edge, prev.edge.mul(float(1.0).sub(sw.covered))));
            wetTop.assign(max(wetTop, prev.R));
        }
        const edgeAt = cuspNoise.sub(0.5).mul(1.3).add(sin(a.mul(0.37).add(0.8)).mul(0.25));
        const onLand = smoothstep(-0.3, 0.3, x.sub(edgeAt)).toVar(); // 0 on the sea, 1 up the beach
        const sheet = covered.mul(onLand).toVar();
        const wet = max(smoothstep(wetTop.add(0.9), wetTop.sub(0.25), x), float(1.0).sub(onLand)).toVar();
        // The lace: a torn net of foam threads, drifting with the water (up the sand while the swash
        // runs up, back down as it drains), on the sheet and on the foam behind a bore.
        const flow = mix(sw.tau.mul(-0.35), sw.tau.sub(sw.top).mul(0.6).max(0.0).sub(sw.top.mul(0.35)), float(1.0).sub(sw.rising));
        const laceBase = vec2(a.mul(0.62), s.add(flow.mul(onLand)).add(t.mul(0.05).mul(float(1.0).sub(onLand))).mul(0.9));
        const warp = texture(seaNoise, laceBase.mul(0.23).add(vec2(0.17, 0.43))).rg.sub(0.5).mul(0.55);
        const laceAt = laceBase.add(warp);
        const lace = texture(seaNoise, laceAt).b.toVar();
        const laceFine = texture(seaNoise, laceAt.mul(2.3).add(vec2(0.31, 0.57))).b;
        // Foam gathers in patches: where the broad field is high the net is dense, elsewhere torn open.
        const patches = smoothstep(0.35, 0.75, texture(seaNoise, laceBase.mul(0.11).add(vec2(0.61, 0.07))).a);
        const threads = lace.pow(1.6).mul(0.75).add(laceFine.pow(2.0).mul(0.5)).mul(patches.mul(0.8).add(0.2))
            .toVar();

        // ── How hard the water is shaken (the sea's light, in units of a mean breaker) ──
        // The play shakes it too (U.stir, 0 calm): the surf's own breakers burn brighter, and the
        // open bay most of all (the near water keeps its dark between the board's waves).
        const stirred = U.stir.mul(smoothstep(4.0, 30.0, dist)).toVar();
        const agitation = surf.lip.mul(TUNE.lip).add(surf.bore.mul(TUNE.bore))
            .add(surf.foam.mul(threads.mul(0.8).add(0.25)).mul(TUNE.foam))
            .mul(U.stir.mul(0.6).add(1.0))
            .toVar();
        // The swash: its leading edge, and the lace on the sheet behind it.
        const behindEdge = exp(sw.front.sub(x).max(0.0).div(-1.6));
        const draining = float(1.0).sub(sw.rising).mul(exp(sw.tau.sub(sw.top).div(-2.4)));
        const sheetLight = sheet.mul(threads).mul(behindEdge.mul(0.7).add(draining.mul(0.55)).add(0.06)).mul(TUNE.lace);
        agitation.addAssign(edge.mul(TUNE.edge).mul(onLand.mul(0.8).add(0.2)).add(sheetLight));
        // Calm water keeps a faint fire where its ripples tip; shaken by the play, it sparks.
        const ripple = length(slope).toVar();
        agitation.addAssign(smoothstep(0.06, 0.24, ripple).mul(stirred.mul(TUNE.calm * 4).add(TUNE.calm))
            .mul(float(1.0).sub(onLand)));
        // A perfect clear lights the whole bay; a fever, the open bay.
        const watered = max(float(1.0).sub(onLand), sheet).toVar();
        agitation.addAssign(U.bayBloom.add(stirred.mul(0.3)).mul(threads.mul(1.2).add(0.8))
            .mul(max(watered, wet.mul(0.4))));

        // ── The board: drops and waves of light ──
        const tint = vec3(0.0).toVar();
        const sparkBoost = float(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.x), type: 'int', condition: '<', name: 'sp',
        }, ({ sp }) => {
            const ra = rows.splashes.element(sp.mul(2));
            const rb = rows.splashes.element(sp.mul(2).add(1));
            const age = U.time.sub(ra.z).toVar();
            const live = step01(age);
            const off = xz.sub(ra.xy);
            const d = length(off).toVar();
            const ag = age.max(0.0);
            // A crown of light: rays round the drop's hole, a burst, a quick small ripple of
            // sparks running out, then the sparks dying away.
            const rays = sin(atan(off.y, off.x).mul(9.0).add(ra.z.mul(13.0))).mul(0.5).add(0.5);
            const radius = rb.w.mul(ag.mul(0.35).add(0.25));
            const patch = exp(d.div(radius).pow2().negate()).mul(rays.mul(0.6).add(0.4));
            const burst = exp(ag.div(-0.18)).mul(1.8).add(exp(ag.div(-1.6)).mul(0.7)).add(exp(ag.div(-5.0)).mul(0.12));
            const ringAt = sqrt(ag).mul(rb.w.mul(1.3)).add(0.06);
            const ring = exp(d.sub(ringAt).div(rb.w.mul(0.1).add(0.02)).pow2().negate()).mul(exp(ag.div(-0.45))).mul(0.6);
            const splash = patch.mul(burst).add(ring.mul(threads.mul(1.5).min(1.0).mul(0.7).add(0.3))).mul(ra.w)
                .mul(live)
                .mul(wet.mul(0.85).add(0.15))
                .toVar();
            agitation.addAssign(splash.mul(0.3));
            sparkBoost.addAssign(splash.mul(1.1));
            const core = exp(d.div(rb.w.mul(0.3)).pow2().negate()).mul(exp(ag.div(-0.4)));
            tint.addAssign(rb.xyz.mul(core).mul(ra.w).mul(live));
        });
        Loop({
            start: int(0), end: int(U.counts.y), type: 'int', condition: '<', name: 'wv',
        }, ({ wv }) => {
            const ra = rows.breakers.element(wv.mul(2));
            const rb = rows.breakers.element(wv.mul(2).add(1));
            const age = U.time.sub(ra.z).toVar();
            const live = step01(age);
            const ag = age.max(0.0);
            const sE = ra.y.sub(rb.y.mul(ag)).toVar();
            const reach = rb.w.mul(ag);
            const off = abs(a.sub(ra.x));
            const lit = smoothstep(reach.add(8.0), reach.sub(4.0), off).toVar();
            const front = exp(off.sub(reach).div(9.0).pow2().negate());
            const late = off.div(max(rb.w, 1.0)).mul(rb.y);
            const broken = smoothstep(rb.z.sub(late).add(0.5), rb.z.sub(late).sub(2.0), sE).toVar();
            const across = s.sub(sE).toVar();
            // The crest: glowing from within as it stands up, a wall of sparks once it breaks.
            const crest = exp(across.div(mix(float(1.8), float(0.9), broken)).pow2().negate())
                .mul(mix(float(0.55), float(1.6), broken));
            const burst = exp(sE.sub(rb.z.sub(late)).div(1.5).pow2().negate()).mul(exp(across.div(2.6).pow2().negate()))
                .mul(2.6);
            const trail = step01(across).mul(exp(across.div(rb.y.mul(0.5)).negate())).mul(broken)
                .mul(threads.mul(1.3).add(0.08));
            const inSea = float(1.0).sub(onLand).mul(smoothstep(-1.0, 0.5, sE));
            const wl = waveLift(a, s, U.time, ra, rb).toVar();
            const face = clamp(wl.x.div(max(rb.x, 0.1)), 0.0, 1.0).pow(3.0).mul(float(1.0).sub(broken)).mul(1.2);
            const sea = crest.add(burst).add(trail).mul(lit.add(front.mul(broken).mul(0.8))).add(face)
                .mul(inSea)
                .mul(threads.mul(1.6).min(1.0).mul(0.6).add(0.4));
            slope.addAssign(vec2(SEAWARD.x, SEAWARD.z).mul(wl.y));
            // Over the waterline it runs on up the sand as a swash.
            const tauE = sE.negate().div(rb.y).toVar();
            const frontE = swashOf(rb.x.mul(1.6), tauE).mul(cusp).toVar();
            const ashore = step01(tauE);
            const edgeE = exp(x.sub(frontE).div(0.3).pow2().negate()).mul(float(1.0).sub(smoothstep(0.0, 9.0, tauE)));
            const sheetE = smoothstep(frontE.add(0.05), frontE.sub(0.3), x).mul(threads)
                .mul(exp(frontE.sub(x).max(0.0).div(-2.0)).mul(0.8).add(0.2)).mul(exp(tauE.div(-3.5)));
            const land = edgeE.mul(2.0).add(sheetE.mul(0.9)).mul(ashore).mul(onLand)
                .mul(lit.add(0.3).min(1.0));
            agitation.addAssign(sea.add(land).mul(ra.w).mul(live));
            covered.assign(max(covered, smoothstep(frontE.add(0.05), frontE.sub(0.2), x).mul(ashore).mul(live)));
        });

        // Rain.
        const rain = rainLayer(xz, t, U.rain, foot, float(0.55), float(0.5), float(31.7))
            .add(rainLayer(xz, t, U.rain, foot, float(1.9), float(0.75), float(37.0)))
            .mul(U.rain.mul(4.0).min(1.0)).toVar();
        agitation.addAssign(rain.mul(2.2).mul(max(watered, wet.mul(0.7))));

        // ── The surface ──
        const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const cosV = clamp(dot(V, N), 0.0, 1.0);
        const m = float(1.0).sub(cosV);
        const m2 = m.mul(m);
        const fresnel = float(0.02).add(m2.mul(m2).mul(m).mul(0.98)).toVar();
        const R0 = V.negate().reflect(N);
        const R = normalize(vec3(R0.x, max(R0.y, 0.004), R0.z)).toVar();
        const mirrored = skyColour(R, U, skyNoise, {
            slices: tier.mirror,
            fine: false,
            stars: true,
            milky: false,
            coast: true,
            lamps: false,
        }).toVar();
        // The far coast's lamps on the water. Each lamp lays a road of glints toward the eye: the
        // facets that happen to tilt just so mirror it, more of them the rougher the water, so the
        // road runs down the water from below its lamp and fades as the tilt it asks for grows.
        // It is laid from a level sea's mirror ray, swayed a little by the ripples the water
        // resolves (a lamp mirrored point for point through those ripples drew the contours of a
        // smooth slope field: stacks of crescents), and broken into glints, short horizontal dashes
        // that come and go, in cells of bearing and depression a few pixels wide at any range.
        const level = vec3(V.x.negate(), V.y, V.z.negate()).toVar();
        const brgLevel = atan(level.x, level.z.negate()).toVar();
        const brgRay = atan(R.x, R.z.negate());
        const brg = mix(brgLevel, brgRay, TUNE.lampWander).mul(1 / DEG).toVar();
        const road = coastLamps(brg, float(0.0), U, coastHeight(brg, skyNoise), float(40.0));
        const toLamp = normalize(vec3(level.x, length(level.xz).mul(0.004), level.z));
        const lobe = glintLobe(vec2(0.0), variance.add(TUNE.lampRough), V, toLamp);
        const pa = max(U.pixelAngle, 1e-5);
        const glintAt = vec2(brgLevel.div(pa.mul(4.6)), V.y.div(pa.mul(1.7))).toVar();
        const glintCell = floor(glintAt);
        const within = fract(glintAt);
        const beat = t.mul(TUNE.glintRate).add(hash22(glintCell).x.mul(7.0)).toVar();
        const g0 = hash22(glintCell.add(vec2(floor(beat).mul(17.13), 3.7))).x;
        const g1 = hash22(glintCell.add(vec2(floor(beat).add(1.0).mul(17.13), 3.7))).x;
        const g = mix(g0, g1, smoothstep(0.0, 1.0, fract(beat)));
        // A glint's light: most dim, a few bright (x^6 has a mean of 1/7), on a soft dash.
        const dash = exp(within.y.sub(0.5).mul(3.6).pow2().negate()).mul(sin(within.x.mul(Math.PI)));
        const glint = g.pow(6.0).mul(7.0 * 2.6).mul(dash);
        // Torn water and foam mirror nothing: the road breaks off over a breaking wave.
        const mirror = float(1.0).sub(smoothstep(0.15, 1.1, agitation)).mul(float(1.0).sub(surf.foam.min(1.0)));
        const streaks = road.mul(lobe).mul(glint).mul(TUNE.lampRoad).mul(mirror)
            .mul(float(1.0).sub(smoothstep(0.05, 0.16, V.y)));

        // The sea's fire in its own mirror. A breaking wave stands up out of the water, so the water
        // in front of it mirrors its lit lip and the wall of its bore: the mirror ray from here climbs
        // at the view's grazing angle and meets the next crest seaward while it is still lower than
        // the crest's lit top. The light it finds there is that crest's own lip and bore light.
        // The ray is the water's own mirror ray, through the ripples it resolves: a long crest is
        // wide enough that the facets tilted toward it draw it in wavering streaks (a point lamp,
        // mirrored the same way, was a stack of crescents; its road is drawn above).
        const ahead = surf.ahead.toVar();
        const across = vec2(GRAD[0], GRAD[1]).normalize();
        const toward = dot(normalize(R.xz.add(vec2(1e-5, 0.0))), across).toVar();
        const run = ahead.x.div(max(toward, 0.05));
        const rise = run.mul(R.y.div(max(length(R.xz), 1e-3)));
        const crestTop = ahead.y.mul(0.9).add(0.15);
        // Rough water blurs the image: a long, soft fall-off as the ray climbs past the crest's top,
        // and less of it the further the crest is.
        const meets = float(1.0).div(rise.div(crestTop).pow2().add(1.0)).mul(exp(run.div(-22.0)))
            .mul(smoothstep(0.05, 0.25, toward));
        const crestAt = s.add(ahead.x);
        const lipThere = exp(crestAt.sub(ahead.z.sub(1.0)).div(1.7).pow2().negate());
        const boreThere = smoothstep(ahead.z, ahead.z.sub(4.0), crestAt).mul(smoothstep(-0.2, 1.2, crestAt));
        const fireThere = ahead.y.div(AVERAGE).mul(lipThere.mul(TUNE.lip).add(boreThere.mul(TUNE.bore)))
            .mul(ahead.w);
        const fireMirror = light.glow.mul(U.glowPower).mul(fireThere.mul(meets).mul(fresnel))
            .mul(mirror).mul(TUNE.mirrorFire);

        // The water: dark looked into; the night in its mirror, and the surf's fire; the lamps'
        // roads of glints.
        const seaBody = light.sea.mul(float(1.0).add(surf.foam.mul(0.4))).toVar();
        const water = seaBody.mul(float(1.0).sub(fresnel)).add(mirrored.mul(fresnel)).add(streaks).add(fireMirror)
            .toVar();

        // The sand: dry, its grain and wind ripples, a wrack line of dark weed along the top of the
        // wash; wet and dark where the swash has been, glossy; a thin sheet of water over it where
        // the swash is now.
        const grain = texture(seaNoise, xz.mul(0.37)).a.mul(0.5).add(texture(seaNoise, xz.mul(1.9)).a.mul(0.5));
        const grainSeen = mix(grain, float(0.5), smoothstep(0.02, 0.3, foot));
        const broad = texture(seaNoise, vec2(a.mul(0.013), x.mul(0.05)).add(vec2(0.3, 0.8))).a;
        const ripplesDry = texture(seaNoise, vec2(dot(xz, vec2(ALONG.x, ALONG.z)).mul(0.6), dot(xz, vec2(SEAWARD.x, SEAWARD.z))
            .mul(1.6))).a;
        const wrackAt = wetTop.add(3.2).add(texture(seaNoise, vec2(a.mul(0.035), 0.71)).a.sub(0.5).mul(2.4));
        const wrack = exp(x.sub(wrackAt).div(0.55).pow2().negate())
            .mul(smoothstep(0.45, 0.7, texture(seaNoise, vec2(a.mul(0.41), x.mul(0.9))).b.add(grain.mul(0.3))));
        const dry = light.sand.mul(grainSeen.mul(0.5).add(0.75)).mul(ripplesDry.mul(0.25).add(0.88))
            .mul(broad.mul(0.5).add(0.75)).mul(float(1.0).sub(wrack.mul(0.75)));
        const rills = smoothstep(0.42, 0.7, texture(seaNoise, vec2(a.mul(0.9), x.mul(0.12)).add(vec2(0.11, 0.37))).a);
        const wetSand = light.wetSand.mul(grainSeen.mul(0.3).add(0.75)).mul(float(1.0).sub(rills.mul(0.45)));
        const glints = smoothstep(0.38, 0.78, texture(seaNoise, xz.mul(vec2(0.85, 1.7)).add(vec2(0.53, 0.19))).b
            .add(texture(seaNoise, xz.mul(0.31)).a.mul(0.5)));
        const gloss = mix(glints.mul(0.16).add(0.03), float(0.5), sheet).mul(fresnel.mul(4.0).min(1.0))
            .mul(float(1.0).sub(rills.mul(0.6)));
        const sandLit = mix(dry, wetSand, wet).mul(float(1.0).sub(gloss.mul(0.6))).add(mirrored.mul(gloss).mul(wet)).toVar();
        const surface = mix(water, sandLit, onLand).toVar();

        // ── The sea's light: sparks, and a fainter glow along the foam's threads ──
        const A = agitation.max(0.0).toVar();
        const sparks = sparkField(xz, A.add(sparkBoost), foot, t, tier.sparkle).toVar();
        const hot = smoothstep(2.0, 6.0, A);
        const hue = mix(light.glow, light.glowHot, hot.mul(0.7));
        const foamLight = clamp(threads.mul(1.4), 0.0, 1.0).mul(0.65).add(0.35);
        const diffuse = A.mul(foamLight).mul(0.3).div(A.mul(0.1).add(1.0));
        const emission = hue.mul(diffuse.add(sparks.mul(TUNE.sparkle))).mul(U.glowPower).toVar();
        emission.addAssign(tint.mul(1.6));
        // The swash's light falls on the sand round it, faintly.
        const lapping = exp(x.div(0.35).pow2().negate()).mul(threads.mul(0.8).add(0.2)).mul(0.06);
        const spill = edge.mul(0.1).add(sheet.mul(0.025)).mul(onLand).add(lapping);
        const lit = surface.add(light.glow.mul(spill).mul(U.glowPower)).add(emission);

        // ── The air over the far sea ──
        const reachHaze = float(1.0).sub(exp(dist.div(-TUNE.hazeReach)));
        const mist = float(1.0).sub(exp(dist.mul(U.haze).mul(-0.012)));
        const haze = max(reachHaze.mul(min(reachHaze.mul(1.4), 1.0)), mist).toVar();
        const far = horizonHaze(V.negate(), U).add(light.mist.mul(U.haze.mul(0.5)));
        const out = mix(lit, far, haze);
        // Keep a far crest's light over the haze a little: it shines through the mist.
        return vec4(out.add(emission.mul(haze).mul(0.25)).max(0.0), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'luminous-tides-shore';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
