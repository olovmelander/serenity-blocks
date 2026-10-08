/**
 * Bioluminescence — the mushrooms, and the light they hold.
 *
 * Three species, each one instanced draw of a lathe (a fourth draw gives the elder a finer one):
 *
 *   parasol  the wide umbrella caps of the two courts and the elder: you stand under them and
 *            look up into the gills, which are the lamp;
 *   bell     thin stems with a hanging bell (the tufts on the islets, the fairy rings);
 *   globe    a lantern on a short foot (the drifts of accent light on the banks).
 *
 * Nothing is lit by a light and nothing is a texture. A cap is thin: the gills' light comes
 * through it, more toward the rim, where the gills themselves show as striations; it carries
 * pale spots; its skin has a velvet edge. The underside is the gills, drawn as lines of light
 * that whiten toward the stem. The stem is fibrous and takes its light from the gills above.
 *
 * The grotto is one organism and these are its fruit. A lock's swimmer reaches a mushroom's foot:
 * the light climbs the stem, the cap blooms in the piece's colour (it swells for a moment) and
 * KEEPS that colour, fading over half a minute. A clear lets everything go: as the wave passes a
 * mushroom its held colour flares out and is gone. A chain raises the fairy rings.
 *
 * Per-mushroom state lives in four instanced attributes (one interleaved buffer per draw) written
 * only when gameplay happens:
 *   aStore  rgb = light held at time w           → rgb · e^(−(t − w)/STORE_HOLD), void after the cut
 *   aPrev   rgb = what it held before that (as of w): shown until the swimmer arrives at w
 *   aPulse  rgb = flash colour, w = when the light starts up the stem (the cap blooms STEM_CLIMB later)
 *   aCut    when a clear's wave voids what it holds
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    PULSE_FADE,
    STEM_CLIMB,
    STORE_HOLD,
    STORE_MAX,
    TAU,
    blAtmosphere,
    blBell,
    blClearLight,
    blHash22,
    blLamps,
    blLockLight,
    blMax3,
    blPart,
    blPulseAt,
    clearPassTime,
} from './bioluminescence-tsl.js';
import { BELL, GLOBE, PARASOL } from './bioluminescence-layout.js';

const NEVER = 1e9;
/** Added to an instance's rank when it belongs to a court (see the plan's `court`). */
const COURT = 4;
const STEM = 0;
const TOP = 1;
const GILLS = 2;

// ── Lathe templates ─────────────────────────────────────────────────────────────

/**
 * Spin a profile round the axis. Cap points are in cap radii (y from the stem's top); stem points
 * are (stem radii, height 0..1). Rings of different kinds are not joined (they meet in space).
 * `aPart` = (kind, v, angle 0..1): v runs apex → rim on the top, rim → stem on the gills, and is
 * the height on the stem.
 */
function lathe(points, sides) {
    const n = points.length;
    const position = [];
    const normal = [];
    const part = [];
    const index = [];
    for (let k = 0; k < n; k++) {
        const here = points[k];
        const same = (q) => (q.kind === STEM) === (here.kind === STEM);
        const a = k > 0 && same(points[k - 1]) ? points[k - 1] : here;
        const b = k < n - 1 && same(points[k + 1]) ? points[k + 1] : here;
        const dr = b.r - a.r;
        // A stem is far taller than it is wide: its flank faces outward.
        const dy = (b.y - a.y) * (here.kind === STEM ? 12 : 1);
        const len = Math.hypot(dr, dy) || 1;
        const nr = -dy / len;
        const ny = dr / len;
        for (let i = 0; i <= sides; i++) {
            const t = (i / sides) * TAU;
            position.push(Math.cos(t) * here.r, here.y, Math.sin(t) * here.r);
            normal.push(Math.cos(t) * nr, ny, Math.sin(t) * nr);
            part.push(here.kind, here.v, i / sides);
        }
    }
    const row = sides + 1;
    for (let k = 0; k < n - 1; k++) {
        if (points[k].kind !== points[k + 1].kind) continue;
        for (let i = 0; i < sides; i++) {
            const a = k * row + i;
            index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
        }
    }
    return {
        position, normal, part, index,
    };
}

const STEM_PROFILE = [
    [1, 0.85], [0.86, 0.88], [0.7, 0.95], [0.5, 1.0], [0.3, 1.08], [0.14, 1.25], [0.04, 1.55], [0, 1.78],
];
const stemPoints = () => STEM_PROFILE.map(([t, r]) => ({
    r, y: t, kind: STEM, v: t,
}));

function parasolProfile(topRings, gillRings) {
    const pts = [];
    for (let k = 0; k <= topRings; k++) {
        const v = k / topRings;
        pts.push({
            r: v ** 0.9, y: 0.34 * (1 - v ** 2.2) + 0.045 * Math.exp(-((v / 0.2) ** 2)) - 0.05 * v ** 8, kind: TOP, v,
        });
    }
    pts.push({
        r: 1.0, y: -0.088, kind: TOP, v: 1,
    });
    for (let k = 0; k <= gillRings; k++) {
        const w = k / gillRings;
        pts.push({
            r: 1.0 - w * 0.93, y: -0.088 + 0.1 * w ** 0.8, kind: GILLS, v: w,
        });
    }
    return pts.concat(stemPoints());
}

function bellProfile(topRings, gillRings) {
    const pts = [];
    for (let k = 0; k <= topRings; k++) {
        const v = k / topRings;
        pts.push({
            r: v ** 0.7 * (0.9 + 0.1 * v ** 4), y: 1.15 * (1 - v ** 1.6) - 0.5, kind: TOP, v,
        });
    }
    pts.push({
        r: 1.03, y: -0.56, kind: TOP, v: 1,
    });
    for (let k = 0; k <= gillRings; k++) {
        const w = k / gillRings;
        pts.push({
            r: 1.03 - w * 0.94, y: -0.56 + 0.52 * w ** 0.6, kind: GILLS, v: w,
        });
    }
    return pts.concat(stemPoints());
}

function globeProfile(rings) {
    const pts = [];
    for (let k = 0; k <= rings; k++) {
        const v = k / rings;
        const phi = v * 0.88 * Math.PI;
        pts.push({
            r: Math.sin(phi), y: 1 + Math.cos(phi), kind: TOP, v,
        });
    }
    return pts.concat(stemPoints());
}

/** What makes one species' draw differ from another's. */
const SPECIES = {
    elder: {
        profile: () => parasolProfile(14, 7), sides: 96, gills: 132, spots: [38, 9], gillGain: 2.0, sway: 0.004, lantern: false, spotCut: 0.3,
    },
    [PARASOL]: {
        profile: () => parasolProfile(8, 4), sides: 40, gills: 52, spots: [15, 5], gillGain: 3.3, sway: 0.012, lantern: false, spotCut: 0.4,
    },
    [BELL]: {
        profile: () => bellProfile(6, 3), sides: 12, gills: 16, spots: [9, 4], gillGain: 3.0, sway: 0.03, lantern: false, spotCut: 0.72,
    },
    [GLOBE]: {
        profile: () => globeProfile(7), sides: 12, gills: 1, spots: [8, 4], gillGain: 2.0, sway: 0.02, lantern: true, spotCut: 2,
    },
};

// ── One draw ────────────────────────────────────────────────────────────────────

const FIXED = 12;
const LIVE = 12;

function createDraw(u, name, spec, items, renderOrder) {
    const n = items.length;
    const size = Math.max(1, n);
    const aStore = new Float32Array(size * 4);
    const aPrev = new Float32Array(size * 3);
    const aPulse = new Float32Array(size * 4);
    const aCut = new Float32Array(size).fill(NEVER);
    for (let i = 0; i < size; i++) aPulse[i * 4 + 3] = -100;
    const fixed = new Float32Array(size * FIXED);
    const live = new Float32Array(size * LIVE);
    for (let i = 0; i < n; i++) {
        const m = items[i];
        fixed.set([
            m.x, m.y, m.z, m.height,
            m.capR, m.stemR, m.yaw, m.seed,
            m.lean[0], m.lean[1], m.family, (m.kind === 'sprout' ? m.rank : -1) + (m.court ? COURT : 0),
        ], i * FIXED);
    }
    const fixedBuffer = new THREE.InstancedInterleavedBuffer(fixed, FIXED);
    const liveBuffer = new THREE.InstancedInterleavedBuffer(live, LIVE);
    liveBuffer.setUsage(THREE.DynamicDrawUsage);
    const touch = () => {
        for (let i = 0; i < size; i++) {
            const o = i * LIVE;
            live.set(aStore.subarray(i * 4, i * 4 + 4), o);
            live.set(aPrev.subarray(i * 3, i * 3 + 3), o + 4);
            live.set(aPulse.subarray(i * 4, i * 4 + 4), o + 7);
            live[o + 11] = aCut[i];
        }
        liveBuffer.needsUpdate = true;
    };
    touch();

    const shape = lathe(spec.profile(), spec.sides);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(shape.position, 3));
    geometry.setAttribute('aNrm', new THREE.Float32BufferAttribute(shape.normal, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(shape.part, 3));
    geometry.setIndex(shape.index);
    geometry.setAttribute('aRoot', new THREE.InterleavedBufferAttribute(fixedBuffer, 4, 0));
    geometry.setAttribute('aShape', new THREE.InterleavedBufferAttribute(fixedBuffer, 4, 4));
    geometry.setAttribute('aLean', new THREE.InterleavedBufferAttribute(fixedBuffer, 4, 8));
    geometry.setAttribute('aStore', new THREE.InterleavedBufferAttribute(liveBuffer, 4, 0));
    geometry.setAttribute('aPrev', new THREE.InterleavedBufferAttribute(liveBuffer, 3, 4));
    geometry.setAttribute('aPulse', new THREE.InterleavedBufferAttribute(liveBuffer, 4, 7));
    geometry.setAttribute('aCut', new THREE.InterleavedBufferAttribute(liveBuffer, 1, 11));
    geometry.instanceCount = n;

    const root = attribute('aRoot', 'vec4');
    const form = attribute('aShape', 'vec4');
    const leanA = attribute('aLean', 'vec4');
    const store = attribute('aStore', 'vec4');
    const prev = attribute('aPrev', 'vec3');
    const pulse = attribute('aPulse', 'vec4');
    const cut = attribute('aCut', 'float');
    const part = attribute('aPart', 'vec3');
    const nrm = attribute('aNrm', 'vec3');
    const g = positionGeometry;
    const seed = form.w;

    // ── Vertex: grow, lean, sway, bloom ──
    // A sprout of rank r stands once the grotto's growth passes r (everything else has rank −1).
    const court = step(COURT - 2, leanA.w);
    const rank = leanA.w.sub(court.mul(COURT));
    const up = smoothstep(rank.sub(0.1), rank, u.sprout);
    const grow = up.mul(sin(up.mul(Math.PI)).mul(0.22).add(1.0));
    const bloomAge = u.time.sub(pulse.w).sub(STEM_CLIMB);
    const bloomEnv = exp(max(bloomAge, 0.0).div(-PULSE_FADE)).mul(step(0.0, bloomAge));
    const swell = bloomEnv.mul(0.085).mul(blMax3(pulse.rgb).min(1.5)).add(1.0);
    const tall = root.w.mul(grow);
    const capR = form.x.mul(grow).mul(swell);
    const stemR = form.y.mul(grow);
    const sway = vec2(
        sin(u.time.mul(0.6).add(seed.mul(1.3))),
        cos(u.time.mul(0.47).add(seed.mul(2.1))),
    ).mul(spec.sway).mul(u.power.mul(0.8).add(1.0));
    const lean = leanA.xy.add(sway);
    const isStem = float(1.0).sub(step(0.5, part.x));
    const t = mix(float(1.0), g.y, isStem);
    // A court is drawn nearer the middle of the pool on an upright screen, and what stood on its
    // bank stands in the water there.
    const moved = court.mul(u.squeeze.oneMinus().mul(1 / 0.54).clamp(0.0, 1.0));
    const base = vec3(root.x.mul(mix(float(1.0), u.squeeze, court)), mix(root.y, root.y.min(-0.12), moved), root.z);
    const centre = base.add(vec3(lean.x.mul(tall).mul(t).mul(t), tall.mul(t), lean.y.mul(tall).mul(t).mul(t)));
    const cy = cos(form.z);
    const sy = sin(form.z);
    const turn = (v) => vec3(v.x.mul(cy).sub(v.z.mul(sy)), v.y, v.x.mul(sy).add(v.z.mul(cy)));
    const lp = turn(g);
    const ln = turn(nrm);
    // The cap sits square on the stem's top, which leans.
    const axis = normalize(vec3(lean.x.mul(2.0), 1.0, lean.y.mul(2.0)));
    const side = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
    const fwd = cross(side, axis);
    const isGill = step(1.5, part.x);
    const rimness = mix(part.y, float(1.0).sub(part.y), isGill);
    const rim3 = rimness.mul(rimness).mul(rimness);
    // No two rims are alike: a slow wave round the edge.
    const wave = sin(part.z.mul(TAU * 5).add(seed)).mul(0.04).mul(smoothstep(0.45, 1.0, rimness)).add(1.0);
    const droop = rim3.mul(sin(part.z.mul(TAU * 3).add(seed.mul(0.7)))).mul(-0.035);
    const capPoint = centre
        .add(side.mul(lp.x).add(fwd.mul(lp.z)).mul(capR).mul(wave))
        .add(axis.mul(lp.y.add(droop).mul(capR)));
    const stemPoint = centre.add(vec3(lp.x, 0.0, lp.z).mul(stemR));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.positionNode = mix(capPoint, stemPoint, isStem);

    const capNormal = side.mul(ln.x).add(axis.mul(ln.y)).add(fwd.mul(ln.z));
    const vNormal = varying(mix(capNormal, vec3(ln.x, ln.y.mul(0.25), ln.z), isStem), 'blShroomN');
    const vPart = varying(part, 'blShroomPart');
    /** Light held now: the new light only once its swimmer has arrived. */
    // A clear's wave voids what was held when it passed: never the light of a swimmer that
    // arrives after it.
    const uncut = step(u.time, cut);
    const held = mix(prev.mul(uncut), store.rgb.mul(max(uncut, step(cut, store.w))), step(store.w, u.time))
        .mul(exp(u.time.sub(store.w).div(-STORE_HOLD)));
    const vHeld = varying(held, 'blShroomHeld');
    const climbAge = u.time.sub(pulse.w);
    const vPulse = varying(vec4(pulse.rgb, climbAge), 'blShroomPulse');
    const vFlash = varying(pulse.rgb.mul(bloomEnv), 'blShroomFlash');
    // Every living light breathes on its own, swells with the grotto's pulse and wakes with a chain.
    const breathe = sin(u.time.mul(0.62).add(seed.mul(0.71))).mul(0.16).add(0.84);
    const beat = blPulseAt(u, base).mul(u.power).mul(0.4);
    const gain = breathe.mul(u.power.mul(0.4).add(1.0)).add(beat).mul(u.breath).mul(up);
    const vLook = varying(vec4(leanA.z, gain, tall, fract(seed.mul(0.0731))), 'blShroomLook');
    const vRing = varying(blLockLight(u, base), 'blShroomRing');
    const vClear = varying(blClearLight(u, base), 'blShroomClear');

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const face = normalize(vNormal).toVar();
        const facing = dot(face, toCam).toVar();
        const N = face.mul(step(0.0, facing).mul(2.0).sub(1.0)).toVar();
        const ndv = abs(facing).toVar();
        const kind = vPart.x;
        const v = vPart.y.toVar();
        const th = vPart.z;
        const gill = step(1.5, kind).toVar();
        const stem = float(1.0).sub(step(0.5, kind)).toVar();
        const top = float(1.0).sub(gill).sub(stem).toVar();
        const G = vLook.y;
        const rnd = vLook.w;

        // What colour this mushroom is now: its family's, or what it was given to hold.
        const tint = u.family(vLook.x).toVar();
        const heldMag = blMax3(vHeld).toVar();
        const hue = mix(tint, vHeld.div(max(heldMag, 1e-3)), clamp(heldMag.mul(2.2), 0.0, 0.95)).toVar();
        const pale = mix(hue, vec3(1.0), 0.55).toVar();
        const flash = vFlash.toVar();

        // ── Gills: lines of light, with shorter ones between them toward the rim ──
        const gc = th.mul(spec.gills);
        const g1 = blBell(fract(gc).sub(0.5).mul(2.9));
        const g2 = blBell(fract(gc.mul(2.0).add(0.5)).sub(0.5).mul(3.2)).mul(float(1.0).sub(smoothstep(0.3, 0.6, v)));
        // Far away the lines are finer than a pixel: they settle to their own average.
        const blur = clamp(fwidth(gc).mul(1.4), 0.0, 1.0);
        const lines = mix(max(g1, g2.mul(0.75)), float(0.4), blur).toVar();
        // The light is at the heart: the gills burn where they meet the stem and dim to the rim,
        // in faint bands, as a cap grows.
        const inward = mix(float(0.2), float(1.0), clamp(v, 0.0, 1.0).mul(sqrt(clamp(v, 0.0, 1.0))));
        const bands = sin(v.mul(26.0).add(rnd.mul(20.0))).mul(0.12).add(0.88);
        const gillCol = mix(hue, vec3(1.0), lines.mul(v).mul(v).mul(0.6))
            .mul(lines.mul(0.86).add(0.14)).mul(inward).mul(bands)
            .mul(G)
            .mul(spec.gillGain)
            // A bloom burns in the gills themselves: the lines stay lines.
            .add(flash.mul(lines.mul(1.5).add(0.1)).mul(inward.mul(0.6).add(0.4)).mul(1.25))
            .add(vClear.rgb.mul(lines.mul(0.8).add(0.06)).mul(inward.mul(0.5).add(0.5)));

        // ── The cap's skin ──
        const thin = spec.lantern ? ndv.mul(ndv).mul(0.5).add(0.05) : v.mul(v).mul(v);
        const striate = spec.lantern
            ? float(1.0)
            : mix(float(1.0), mix(g1, float(0.4), blur).mul(0.6).add(0.55), smoothstep(0.35, 0.9, v));
        // A globe is a lantern: a hot heart seen through a dim skin.
        const heart = spec.lantern ? exp(float(1.0).sub(ndv).mul(-5.0)).mul(0.85) : float(0.0);
        const through = hue.mul(thin.mul(0.4).add(0.018)).mul(striate).add(mix(hue, vec3(1.0), 0.45).mul(heart));
        const sc = vec2(th.mul(spec.spots[0]), v.mul(spec.spots[1]));
        const cell = floor(sc);
        const jit = blHash22(cell.add(vec2(floor(rnd.mul(61.0)), 3.0))).toVar();
        const sd = length(fract(sc).sub(0.5).sub(jit.sub(0.5).mul(0.5)));
        const spotSize = jit.y.mul(0.16).add(0.09);
        const spot = float(1.0).sub(smoothstep(spotSize.mul(0.55), spotSize, sd)).mul(step(spec.spotCut, jit.x))
            .mul(smoothstep(0.12, 0.26, v))
            .mul(float(1.0).sub(smoothstep(0.8, 0.95, v)));
        const velvet = float(1.0).sub(ndv).mul(float(1.0).sub(ndv));
        const lit = blLamps(u, p, N).toVar();
        // The very edge of the cap is thin enough to burn.
        const edgeGlow = spec.lantern ? float(0.0) : smoothstep(0.9, 1.0, v).mul(0.45);
        const topCol = hue.mul(hue).mul(0.008)
            .add(through.mul(G))
            .add(pale.mul(edgeGlow).mul(G))
            .add(hue.mul(velvet).mul(0.16).mul(G))
            .add(pale.mul(spot).mul(G.mul(0.4).add(heldMag.mul(0.5).mul(u.breath))))
            .add(flash.mul(thin.mul(0.9).add(spot.mul(1.2)).add(0.1)))
            .add(vClear.rgb.mul(thin.add(0.15)).mul(0.7))
            .add(lit.mul(mix(vec3(0.03), hue.mul(0.1), 0.5)));

        // ── The stem: fibres, the gills' light on its top, the mycelium's at its foot ──
        const grain = u.noise(vec2(th.mul(3.0).add(rnd), v.mul(vLook.z).mul(0.12))).r;
        const fibre = grain.mul(0.9).add(0.45).mul(velvet.mul(0.9).add(0.55));
        const under = exp(float(1.0).sub(v).mul(-5.5));
        const foot = exp(v.mul(-9.0));
        const climb = vPulse.w.div(STEM_CLIMB);
        const front = blBell(v.sub(climb).div(0.24)).mul(step(0.0, vPulse.w)).mul(step(climb, 1.35));
        const stemCol = mix(pale, hue, 0.45).mul(under.mul(0.6).add(foot.mul(0.14)).add(0.012)).mul(fibre).mul(G)
            .add(lit.mul(vec3(0.05, 0.055, 0.05)).mul(fibre))
            .add(vPulse.rgb.mul(front).mul(fibre).mul(1.5))
            .add(flash.mul(under).mul(fibre).mul(0.4))
            .add(vRing.mul(foot.mul(1.6).add(0.15)))
            .add(vClear.rgb.mul(foot.add(0.1)));

        const col = topCol.mul(top).add(gillCol.mul(gill)).add(stemCol.mul(stem));
        return blAtmosphere(u, col, p);
    })();

    const draw = blPart(name, geometry, material, renderOrder);
    draw.count = n;
    draw.state = {
        aStore, aPrev, aPulse, aCut,
    };
    draw.touch = touch;
    return draw;
}

// ── The field: every mushroom in the grotto, under one numbering ────────────────

/**
 * @param {object} u     shared grotto uniforms
 * @param {object} plan  the grotto's plan
 * @param {object} opts
 * @param {number} opts.count    planned mushrooms drawn (the plan's first N; the elder is first)
 * @param {number} opts.sprouts  fairy-ring sprouts drawn
 */
export function createMushrooms(u, plan, { count, sprouts = 0 }) {
    const list = plan.mushrooms.slice(0, Math.max(1, Math.min(count, plan.mushrooms.length)))
        .concat(plan.sprouts.slice(0, Math.max(0, Math.min(sprouts, plan.sprouts.length))));
    const buckets = {
        elder: [], [PARASOL]: [], [BELL]: [], [GLOBE]: [],
    };
    /** For every mushroom: which draw it is in, and where. */
    const where = list.map((m) => {
        const key = m.kind === 'elder' ? 'elder' : m.species;
        buckets[key].push(m);
        return { key, slot: buckets[key].length - 1 };
    });
    const draws = {
        elder: createDraw(u, 'BioluminescenceElder', SPECIES.elder, buckets.elder, -32),
        [PARASOL]: createDraw(u, 'BioluminescenceParasols', SPECIES[PARASOL], buckets[PARASOL], -31),
        [BELL]: createDraw(u, 'BioluminescenceBells', SPECIES[BELL], buckets[BELL], -30),
        [GLOBE]: createDraw(u, 'BioluminescenceGlobes', SPECIES[GLOBE], buckets[GLOBE], -30),
    };
    const n = list.length;
    const storeT0 = new Float32Array(n);
    const cutAt = new Float32Array(n).fill(NEVER);
    const passes = new Float32Array(n);
    const dirty = new Set();
    const flush = () => {
        dirty.forEach((key) => draws[key].touch());
        dirty.clear();
    };
    const view = (i) => {
        const { key, slot } = where[i];
        dirty.add(key);
        return {
            state: draws[key].state, o4: slot * 4, o3: slot * 3, slot,
        };
    };
    const peek = (i) => {
        const { key, slot } = where[i];
        return { state: draws[key].state, o4: slot * 4, o3: slot * 3 };
    };

    /**
     * How much of what mushroom `i` holds is alive at `time` (0 or the decay factor): before the
     * swimmer arrives it is what the cap held before, which a clear's wave voids; after, it is
     * the new light, which a wave voids only if it was already there when the wave passed.
     */
    const alive = (i, time) => {
        const pending = time < storeT0[i];
        if (time > cutAt[i] && (pending || storeT0[i] < cutAt[i])) return 0;
        return Math.exp(-(time - storeT0[i]) / STORE_HOLD);
    };
    const heldAt = (i, time) => {
        const k = alive(i, time);
        if (k === 0) return 0;
        const { state, o4, o3 } = peek(i);
        if (time < storeT0[i]) return Math.max(state.aPrev[o3], state.aPrev[o3 + 1], state.aPrev[o3 + 2]) * k;
        return Math.max(state.aStore[o4], state.aStore[o4 + 1], state.aStore[o4 + 2]) * k;
    };

    const field = {
        list,
        count: n,
        draws,
        /** The parts to add to the scene, in draw order. */
        parts: [
            ['elder', draws.elder], ['parasols', draws[PARASOL]], ['bells', draws[BELL]], ['globes', draws[GLOBE]],
        ],
        heldAt,
        /** Everything the grotto holds at `time`. */
        totalHeld(time) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += heldAt(i, time);
            return sum;
        },
        /** The colour mushroom `i` holds at `time` (scene-linear, into `out`). */
        heldColor(i, time, out = [0, 0, 0]) {
            const { state, o4, o3 } = peek(i);
            const k = alive(i, time);
            const from = time < storeT0[i] ? state.aPrev : state.aStore;
            const o = time < storeT0[i] ? o3 : o4;
            out[0] = from[o] * k;
            out[1] = from[o + 1] * k;
            out[2] = from[o + 2] * k;
            return out;
        },
        /** The bloom flash of mushroom `i` at `time`: its colour × envelope (into `out`). */
        flashAt(i, time, out = [0, 0, 0]) {
            const { state, o4 } = peek(i);
            const age = time - state.aPulse[o4 + 3] - STEM_CLIMB;
            const env = age >= 0 ? Math.exp(-age / PULSE_FADE) : 0;
            out[0] = state.aPulse[o4] * env;
            out[1] = state.aPulse[o4 + 1] * env;
            out[2] = state.aPulse[o4 + 2] * env;
            return out;
        },
        /**
         * Light reaches the foot of mushroom `i` at `time` (which may be a moment ahead of `now`):
         * it climbs the stem, the cap blooms in `rgb` and keeps `amount` of it.
         * @returns {number} when the cap blooms
         */
        strike(i, rgb, time, amount = 1, now = time) {
            if (!(i >= 0 && i < n)) return time;
            const { state, o4, o3 } = view(i);
            const bloom = time + STEM_CLIMB;
            let carried;
            if (storeT0[i] > now) {
                // An earlier swimmer is still on its way: the cap goes on showing what it showed
                // (re-based to the new bloom), and the light on its way adds to how much.
                const rebase = Math.exp(-(bloom - storeT0[i]) / STORE_HOLD);
                for (let c = 0; c < 3; c++) state.aPrev[o3 + c] *= rebase;
                carried = Math.max(state.aStore[o4], state.aStore[o4 + 1], state.aStore[o4 + 2]);
            } else {
                // What it shows until the bloom is what it holds NOW (a wave still on its way
                // voids that when it passes, in the shader); what carries into the new light is
                // what would still be there at the bloom.
                const decay = Math.exp(-(bloom - storeT0[i]) / STORE_HOLD);
                const showing = alive(i, now) > 0 ? decay : 0;
                state.aPrev.set([0, 1, 2].map((c) => state.aStore[o4 + c] * showing), o3);
                const kept = alive(i, bloom) > 0 ? decay : 0;
                carried = Math.max(state.aStore[o4], state.aStore[o4 + 1], state.aStore[o4 + 2]) * kept;
            }
            // The newest colour wins the cap (two pieces' colours summed would only wash out);
            // what it already held adds to how much.
            const mag = Math.min(STORE_MAX, carried * 0.6 + amount * 0.75);
            state.aStore.set([rgb[0] * mag, rgb[1] * mag, rgb[2] * mag, bloom], o4);
            storeT0[i] = bloom;
            // A wave still on its way to this cap would void the new colour unseen: it keeps it.
            if (cutAt[i] > bloom) {
                cutAt[i] = NEVER;
                state.aCut[where[i].slot] = NEVER;
            }
            state.aPulse.set([rgb[0] * amount * 1.5, rgb[1] * amount * 1.5, rgb[2] * amount * 1.5, time], o4);
            flush();
            return bloom;
        },
        /**
         * A clear: a wave leaves (hx, hz) at `time` and every mushroom answers as it passes — in
         * the wave's colour and in whatever colour it was holding, which is then gone.
         * @returns {{ released: number, passes: Float32Array }}  light let go, and each pass time
         */
        release(time, hx, hz, rgb, strength = 1, { squeeze = 1 } = {}) {
            let released = 0;
            for (let i = 0; i < n; i++) {
                const m = list[i];
                const { state, o4 } = view(i);
                const pass = time + clearPassTime(Math.hypot((m.court ? m.x * squeeze : m.x) - hx, m.z - hz));
                passes[i] = pass;
                const k = alive(i, pass);
                const o3 = where[i].slot * 3;
                if (storeT0[i] > pass) {
                    // A swimmer arrives after the wave has gone by: the wave takes what the cap
                    // was showing, and the bloom on its way is left to fire.
                    released += Math.max(state.aPrev[o3], state.aPrev[o3 + 1], state.aPrev[o3 + 2]) * k;
                } else {
                    const had = [state.aStore[o4] * k, state.aStore[o4 + 1] * k, state.aStore[o4 + 2] * k];
                    released += Math.max(had[0], had[1], had[2]);
                    state.aPulse.set([
                        had[0] * 2.0 + rgb[0] * strength * 0.3,
                        had[1] * 2.0 + rgb[1] * strength * 0.3,
                        had[2] * 2.0 + rgb[2] * strength * 0.3,
                        pass - STEM_CLIMB,
                    ], o4);
                }
                cutAt[i] = pass;
                state.aCut[where[i].slot] = pass;
            }
            flush();
            return { released, passes };
        },
        /** Fire one mushroom's bloom without touching what it holds (the elder's Great Bloom). */
        fire(i, rgb, time, amount = 1) {
            if (!(i >= 0 && i < n)) return;
            const { state, o4 } = view(i);
            state.aPulse.set([rgb[0] * amount, rgb[1] * amount, rgb[2] * amount, time - STEM_CLIMB], o4);
            flush();
        },
        reset() {
            Object.keys(draws).forEach((key) => {
                const { state } = draws[key];
                state.aStore.fill(0);
                state.aPrev.fill(0);
                state.aCut.fill(NEVER);
                for (let i = 0; i < state.aCut.length; i++) state.aPulse.set([0, 0, 0, -100], i * 4);
                draws[key].touch();
            });
            storeT0.fill(0);
            cutAt.fill(NEVER);
        },
    };
    return field;
}
