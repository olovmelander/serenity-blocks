/**
 * Bioluminescence — what lives in the air of the grotto.
 *
 *  - Glow-worms: colonies of points on the vault, in rivers where the rock runs damp. A third of
 *    them are lit at rest; a chain kindles the rest, a clear's wave ripples through them, and the
 *    nearest hang a beaded thread that catches their light.
 *  - Vines: roots that hang from the vault over the two courts, dark against the glow, carrying
 *    pods of light. They sway, and swing when the air turns.
 *  - Motes: spores adrift, rising. Closed form: a mote's place is a function of the clock, the
 *    grotto's lift and its seed, so nothing is simulated and both backends draw the same thing.
 *  - Jellies: three residents drift over the pool. Currents bring passing visitors, and a chain
 *    raises more swimmers from the water until it breaks.
 *
 * The first frame draws each part to compile its pipeline. Once a jelly sinks, its slot leaves
 * the instance draw until the swimmer returns.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    ELDER,
    blAtmosphere,
    blBell,
    blClearLight,
    blFogAmount,
    blFxMaterial,
    blPart,
    blQuadGeometry,
    blShockReach,
    mulberry32,
} from './bioluminescence-tsl.js';
import { Envelope } from './bioluminescence-envelope.js';
import { MEDUSA_INDICES, MEDUSA_VERTICES } from './bioluminescence-medusa-model.js';
import { capCentre } from './bioluminescence-layout.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Glow-worms ──────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {object} plan
 * @param {number} count    worms drawn (the plan's first N: nearest first)
 * @param {number} threads  how many of them hang a thread
 */
export function createWorms(u, plan, count, threads = 0) {
    const n = Math.min(count, plan.worms.length);
    const aWorm = new Float32Array(Math.max(1, n) * 4);
    const aSeed = new Float32Array(Math.max(1, n) * 2);
    for (let i = 0; i < n; i++) {
        const w = plan.worms[i];
        aWorm.set([w.x, w.y, w.z, w.thread], i * 4);
        aSeed.set([w.seed, w.rank], i * 2);
    }
    /** What a worm gives off now (vertex stage): lit by rank, winking, flaring as a wave passes. */
    const lightOf = (worm, seed) => {
        const lit = smoothstep(seed.y.sub(0.06), seed.y.add(0.02), u.wake);
        const wink = sin(u.time.mul(seed.x.mul(1.1).add(0.35)).add(seed.x.mul(90.0))).mul(0.5).add(0.5);
        const clear = blClearLight(u, worm.xyz);
        const shock = blShockReach(u, length(worm.xz.sub(vec2(ELDER.x, ELDER.z))));
        const tone = mix(u.worm, u.primary, step(0.78, fract(seed.x.mul(7.3))));
        return tone.mul(lit.mul(wink.mul(0.6).add(0.4)).mul(u.power.mul(0.6).add(1.0)).mul(u.breath)
            .add(clear.w.mul(0.9).mul(u.breath))
            .add(shock.mul(1.6).mul(u.breath)))
            .add(clear.rgb.mul(1.3));
    };

    const geometry = blQuadGeometry(n, { aWorm: [aWorm, 4], aSeed: [aSeed, 2] });
    const worm = attribute('aWorm', 'vec4');
    const seed = attribute('aSeed', 'vec2');
    const material = blFxMaterial('BioluminescenceWorms');
    const clip = viewProjection(worm.xyz);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(seed.x.mul(0.06).add(0.08).mul(pxPerMetre), u.viewport.y.mul(0.0023), u.viewport.y.mul(0.008));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const fade = float(1.0).sub(blFogAmount(clip.w, worm.y).mul(0.82));
    const vLight = varying(lightOf(worm, seed).mul(fade), 'blWorm');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        return vec4(vLight.mul(exp(d.mul(d).mul(-7.0)).add(exp(d.mul(-4.0)).mul(0.12))).mul(smoothstep(1.0, 0.7, d)).mul(2.6), 0.0);
    })();
    const worms = blPart('BioluminescenceWorms', geometry, material, 8);
    worms.count = n;

    let threadPart = null;
    const tn = Math.min(threads, n);
    if (tn > 0) {
        const threadGeometry = blQuadGeometry(tn, {
            aWorm: [aWorm.slice(0, tn * 4), 4], aSeed: [aSeed.slice(0, tn * 2), 2],
        });
        const threadMaterial = blFxMaterial('BioluminescenceThreads');
        const along = positionGeometry.y.add(0.5);
        const hang = float(1.0).sub(along).mul(worm.w);
        const drift = sin(u.time.mul(0.7).add(seed.x.mul(30.0))).mul(0.02).mul(hang).mul(hang);
        const at = viewProjection(worm.xyz.add(vec3(drift, hang.negate(), 0.0)));
        const widthPx = clamp(float(0.012).mul(u.viewport.y.mul(1.05).div(max(at.w, 0.3))), 1.1, 3.0);
        threadMaterial.vertexNode = vec4(at.xy.add(vec2(positionGeometry.x.mul(widthPx).mul(2.0).div(half.x), 0.0).mul(at.w)), at.z, at.w);
        const threadFade = float(1.0).sub(blFogAmount(at.w, worm.y).mul(0.9)).mul(float(1.0).sub(smoothstep(30.0, 70.0, at.w)));
        const vThread = varying(lightOf(worm, seed).mul(threadFade), 'blThread');
        const vHang = varying(vec2(along, worm.w), 'blThreadHang');
        threadMaterial.colorNode = Fn(() => {
            const across = float(1.0).sub(abs(uv().x.sub(0.5)).mul(2.0));
            // Beads of glue down the silk, brighter near the worm.
            const beads = blBell(fract(float(1.0).sub(vHang.x).mul(vHang.y).mul(14.0)).sub(0.5).mul(3.0));
            const near = vHang.x.mul(vHang.x);
            return vec4(vThread.mul(across).mul(beads.mul(0.9).add(0.12)).mul(near.mul(0.8).add(0.2)).mul(0.7), 0.0);
        })();
        threadPart = blPart('BioluminescenceThreads', threadGeometry, threadMaterial, 7);
        threadPart.count = tn;
    }
    return { worms, threads: threadPart };
}

// ── Vines ───────────────────────────────────────────────────────────────────────

const VINE_SEGMENTS = 14;
/** Half-width of a vine's ribbon (metres): room for a pod's glow either side of the strand. */
const VINE_HALF = 0.42;

/**
 * @param {object} u
 * @param {object} plan
 * @param {number} count
 */
export function createVines(u, plan, count) {
    const n = Math.min(count, plan.vines.length);
    const aVine = new Float32Array(Math.max(1, n) * 4);
    const aKind = new Float32Array(Math.max(1, n) * 4);
    for (let i = 0; i < n; i++) {
        const v = plan.vines[i];
        aVine.set([v.x, v.y, v.z, v.length], i * 4);
        aKind.set([v.seed, v.pods, v.family, 0], i * 4);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1, 1, VINE_SEGMENTS);
    geometry.setIndex(plane.getIndex());
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.setAttribute('aVine', new THREE.InstancedBufferAttribute(aVine, 4));
    geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(aKind, 4));
    geometry.instanceCount = n;

    const vine = attribute('aVine', 'vec4');
    const kind = attribute('aKind', 'vec4');
    const material = blFxMaterial('BioluminescenceVines');
    // 0 at the vault, 1 at the free end.
    const along = float(0.5).sub(positionGeometry.y);
    const a2 = along.mul(along);
    const swing = u.power.mul(0.6).add(u.swirl.mul(3.0)).add(1.0);
    const sway = vec2(
        sin(u.time.mul(0.43).add(kind.x.mul(31.0))).add(sin(u.time.mul(0.91).add(kind.x.mul(17.0)).add(along.mul(2.0))).mul(0.4)),
        cos(u.time.mul(0.37).add(kind.x.mul(23.0))),
    ).mul(a2).mul(vine.w).mul(0.028)
        .mul(swing);
    // A slow curl of its own, so no two hang alike.
    const curl = vec2(sin(along.mul(5.0).add(kind.x.mul(40.0))), cos(along.mul(4.0).add(kind.x.mul(27.0)))).mul(along).mul(0.35);
    const spine = vec3(vine.x.add(sway.x).add(curl.x), vine.y.sub(along.mul(vine.w)), vine.z.add(sway.y).add(curl.y));
    const toCam = normalize(cameraPosition.sub(spine).mul(vec3(1.0, 0.0, 1.0)));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const world = spine.add(right.mul(positionGeometry.x.mul(VINE_HALF * 2)));
    material.vertexNode = viewProjection(world);
    const vWorld = varying(world, 'blVineWorld');
    const vVine = varying(vec4(positionGeometry.x.mul(VINE_HALF * 2), along, vine.w, kind.y), 'blVine');
    const breathe = sin(u.time.mul(0.7).add(kind.x.mul(50.0))).mul(0.25).add(0.75);
    const vPod = varying(
        u.family(kind.z).mul(breathe).mul(u.power.mul(1.1).add(1.0)).mul(u.breath)
            .add(blClearLight(u, vine.xyz).rgb.mul(1.8)),
        'blVinePod',
    );
    const vRnd = varying(kind.x, 'blVineRnd');
    material.colorNode = Fn(() => {
        const { x } = vVine;
        const s = vVine.y;
        const len = vVine.z;
        // The strand: a rope that thins toward its end, with knots where the pods hang.
        const girth = mix(float(0.06), float(0.02), s).add(blBell(fract(s.mul(vVine.w).add(vRnd)).sub(0.5).mul(9.0)).mul(0.02));
        const strand = float(1.0).sub(smoothstep(girth.mul(0.6), girth, abs(x)));
        // Pods: one for every turn of the phase down the vine, hanging on the lower two thirds.
        const turn = fract(s.mul(vVine.w).add(vRnd));
        const dy = turn.sub(0.5).mul(len).div(vVine.w);
        const side = sin(s.mul(vVine.w).floor().mul(2.4).add(vRnd.mul(9.0))).mul(0.09);
        const dx = x.sub(side);
        const d2 = dx.mul(dx).add(dy.mul(dy).mul(0.55));
        const on = smoothstep(0.22, 0.34, s);
        const bulb = exp(d2.mul(-190.0)).mul(1.5).add(exp(d2.mul(-22.0)).mul(0.35)).mul(on);
        const leaf = float(1.0).sub(smoothstep(0.004, 0.009, d2)).mul(on);
        const body = max(strand, leaf.mul(0.9));
        const dark = blAtmosphere(u, vec3(0.006, 0.014, 0.012).add(vPod.mul(leaf).mul(0.3)), vWorld);
        const fade = float(1.0).sub(blFogAmount(length(vWorld.sub(cameraPosition)), vWorld.y).mul(0.85));
        return vec4(dark.mul(body).add(vPod.mul(bulb).mul(fade)), body);
    })();
    const part = blPart('BioluminescenceVines', geometry, material, 6);
    part.count = n;
    return part;
}

// ── Motes ───────────────────────────────────────────────────────────────────────

/** The box of air the motes live in (metres; the camera stands near its near end). */
export const MOTE_BOX = Object.freeze({
    halfWidth: 38, depth: 96, near: 6, height: 15,
});

/**
 * @param {object} u
 * @param {number} count
 * @param {object} plan
 * @param {number} [seed]
 */
export function createMotes(u, count, plan, seed = 0x5b0e) {
    const rand = mulberry32(seed);
    const aHome = new Float32Array(Math.max(1, count) * 4);
    const aCap = new Float32Array(Math.max(1, count) * 4);
    const caps = plan.mushrooms.filter((m) => m.kind === 'hero').slice(0, 6)
        .map((m) => [...capCentre(m), m.capR]);
    for (let i = 0; i < count; i++) {
        const x = (rand() + rand() - 1) * MOTE_BOX.halfWidth;
        const z = MOTE_BOX.near - rand() ** 1.25 * MOTE_BOX.depth;
        aHome.set([x, rand(), z, rand()], i * 4);
        if (i % 3 === 0 && caps.length) {
            aCap.set(caps[(i / 3) % caps.length], i * 4);
        }
    }
    const geometry = blQuadGeometry(count, { aHome: [aHome, 4], aCap: [aCap, 4] });
    const home = attribute('aHome', 'vec4');
    const cap = attribute('aCap', 'vec4');
    const material = blFxMaterial('BioluminescenceMotes');

    const s = home.w;
    // Each mote climbs at its own pace and starts over; the grotto's lift carries them all.
    const climb = fract(home.y.add(u.moteLift.mul(s.mul(0.022).add(0.012))));
    const wander = vec2(
        sin(u.driftTime.mul(s.mul(0.2).add(0.13)).add(s.mul(41.0))),
        cos(u.driftTime.mul(s.mul(0.17).add(0.11)).add(s.mul(23.0))),
    ).mul(s.mul(1.3).add(0.6));
    const height = climb.mul(MOTE_BOX.height).add(0.12);
    // Spores from one bank catch the same rising draft. The two banks fruit at different times.
    const current = sin(u.driftTime.mul(0.085).add(home.z.mul(0.12)).add(home.x.mul(0.21)));
    const puff = smoothstep(0.29, 0.94, current);
    // A twist turns the air about the middle of the pool, faster higher up.
    const turn = u.swirl.mul(height.mul(0.09).add(0.4));
    const ox = home.x.add(wander.x).add(puff.mul(sin(climb.mul(7.0).add(home.z.mul(0.22)))).mul(1.7));
    const oz = home.z.add(wander.y).add(22.0);
    const drifting = vec3(
        ox.mul(cos(turn)).sub(oz.mul(sin(turn))),
        height,
        ox.mul(sin(turn)).add(oz.mul(cos(turn))).sub(22.0),
    );
    // In turn, a patch of gills on each bank fruits. The falling spawn unfurls into the
    // cross-current and goes dark before it reaches the water. Its cycle is independent of play.
    const fromGill = step(0.01, cap.w);
    const season = u.driftTime.mul(0.12).add(cap.z.mul(0.26)).add(cap.x.mul(0.34));
    const fall = fract(u.driftTime.mul(0.108).add(home.y));
    const turnInAir = fall.mul(8.8).add(season.mul(0.38)).add(s.mul(4.2));
    const spread = fall.mul(fall).mul(1.7).add(s.mul(0.23));
    const cascade = vec3(
        cap.x.mul(u.squeeze).add(cap.w.mul(0.39).mul(cos(season))).add(spread.mul(sin(turnInAir))),
        cap.y.mul(fall.mul(-0.79).add(0.94)),
        cap.z.add(cap.w.mul(0.42)).add(spread.mul(cos(turnInAir))).add(fall.mul(1.7)),
    );
    const world = mix(drifting, cascade, fromGill);
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(s.mul(0.035).add(0.022).mul(pxPerMetre), u.viewport.y.mul(0.0015), u.viewport.y.mul(0.011));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);

    const twinkle = sin(u.driftTime.mul(s.mul(1.4).add(0.6)).add(s.mul(77.0))).mul(0.5).add(0.5);
    const life = sin(climb.mul(Math.PI));
    const pick = fract(s.mul(7.7));
    const tone = mix(mix(u.primary, u.secondary, step(0.45, pick)), u.accent, step(0.85, pick));
    const dist = length(cameraPosition.sub(world));
    const bloom = smoothstep(-0.26, 0.84, sin(season)).mul(sin(fall.mul(Math.PI))).mul(2.9);
    const gain = mix(twinkle.mul(twinkle).mul(0.9).add(0.1).mul(life), bloom, fromGill)
        .mul(u.power.mul(1.0).add(0.7).add(u.surge.mul(0.8)))
        .mul(float(1.0).sub(blFogAmount(dist, world.y).mul(0.9)))
        .mul(u.breath);
    const sporeColour = mix(tone, u.worm, puff.mul(0.32));
    const vLight = varying(mix(sporeColour, mix(u.primary, u.accent, 0.55), fromGill).mul(gain)
        .mul(mix(puff.mul(1.5).add(0.5), 1.0, fromGill)), 'blMote');
    const tilt = varying(sin(u.driftTime.mul(0.65).add(s.mul(61.0))), 'blSporeTilt');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const husk = vec2(q.x.add(q.y.mul(tilt).mul(0.48)).mul(1.7), q.y);
        const core = exp(dot(husk, husk).mul(-7.0));
        const light = vLight.mul(exp(d.mul(d).mul(-3.8)).mul(0.33).add(core.mul(1.6)));
        return vec4(light.mul(smoothstep(1.0, 0.7, d)), 0.0);
    })();

    const part = blPart('BioluminescenceMotes', geometry, material, 18);
    part.count = count;
    return part;
}

// ── Jellies ─────────────────────────────────────────────────────────────────────

/** Seconds a jelly takes to rise out of the pool to its place, and to sink away. */
export const JELLY_RISE = 2.6;
export const JELLY_SINK = 1.5;
/** A jelly flash falls to 1/e in 1/this seconds. */
export const JELLY_FLASH_FADE = 1.6;
const NEVER = 1e9;

/** Blender's medusa, shared by every swimmer. Position, normal and pigmentation share a buffer. */
function medusaGeometry() {
    const decode = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const source = new DataView(decode(MEDUSA_VERTICES).buffer);
    const stride = 9;
    const packed = new Float32Array((source.byteLength / 12) * stride);
    for (let b = 0, i = 0; b < source.byteLength; b += 12, i += stride) {
        for (let k = 0; k < 3; k++) {
            packed[i + k] = source.getInt16(b + 2 * k, true) / 4096;
            packed[i + 3 + k] = source.getInt8(b + 6 + k) / 127;
        }
        packed[i + 6] = source.getUint8(b + 9);
        packed[i + 7] = source.getUint8(b + 10) / 255;
        packed[i + 8] = source.getUint8(b + 11) / 255;
    }
    const geometry = new THREE.InstancedBufferGeometry();
    const buffer = new THREE.InterleavedBuffer(packed, stride);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('aMedusaNormal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setAttribute('aAnatomy', new THREE.InterleavedBufferAttribute(buffer, 3, 6));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(decode(MEDUSA_INDICES).buffer), 1));
    return geometry;
}

/**
 * @param {object} u
 * @param {object} plan
 * @param {number} count  jelly slots (the plan's first N; the first three are up at rest)
 */
export function createJellies(u, plan, count) {
    const n = Math.min(count, plan.jellies.length);
    const aHome = new Float32Array(Math.max(1, n) * 4);
    const aLook = new Float32Array(Math.max(1, n) * 2);
    const aLife = new Float32Array(Math.max(1, n) * 2);
    for (let i = 0; i < n; i++) {
        const j = plan.jellies[i];
        aHome.set([j.x, j.y, j.z, j.size], i * 4);
        aLook.set([j.seed, j.family], i * 2);
        aLife.set([NEVER, NEVER], i * 2);
    }
    const geometry = medusaGeometry();
    geometry.instanceCount = n;
    geometry.setAttribute('aHome', new THREE.InstancedBufferAttribute(aHome, 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(aLook, 2));
    geometry.setAttribute('aLife', new THREE.InstancedBufferAttribute(aLife, 2));
    geometry.getAttribute('aLife').setUsage(THREE.DynamicDrawUsage);
    const home = attribute('aHome', 'vec4');
    const look = attribute('aLook', 'vec2');
    const life = attribute('aLife', 'vec2');
    /**
     * Every jelly flashes at once: how bright the flash is now. The world's events add to one
     * swell (a flash that comes while another still burns adds to it, and one scheduled a moment
     * ahead never darkens what is lit before it arrives); update() writes what it reads.
     */
    const flash = uniform(0);
    const flashSwell = new Envelope({
        release: 1 / JELLY_FLASH_FADE, ceiling: 1.9, knee: 1.3,
    });
    const material = blFxMaterial('BioluminescenceJellies');

    const seed = look.x;
    const risen = clamp(u.time.sub(life.x).div(JELLY_RISE), 0.0, 1.0);
    const up = risen.mul(risen).mul(float(3.0).sub(risen.mul(2.0)));
    const sunk = clamp(u.time.sub(life.y).div(JELLY_SINK), 0.0, 1.0);
    const alive = step(life.x, u.time).mul(float(1.0).sub(sunk));
    // A rowing stroke compresses the bell before the animal gains height. The fringe follows late.
    const clock = u.driftTime;
    const phase = clock.mul(seed.mul(0.85).add(2.2)).add(seed.mul(23.0));
    const stroke = sin(phase);
    const course = clock.mul(seed.mul(0.017).add(0.048)).add(seed.mul(41.0));
    const drift = vec3(
        sin(course).mul(2.2).add(sin(course.mul(1.61)).mul(0.65)),
        cos(course.mul(1.27)).mul(1.12).add(sin(phase.sub(1.1)).mul(0.16)),
        cos(course).mul(2.65),
    );
    const centre = vec3(home.x.mul(u.squeeze), mix(float(-0.6), home.y, up).sub(sunk.mul(1.2)), home.z)
        .add(drift.mul(up));
    const size = home.w.mul(1.23).mul(alive.mul(0.4).add(0.6)).mul(step(0.001, alive));
    const anatomy = attribute('aAnatomy', 'vec3');
    const src = positionGeometry;
    const fall = max(src.y.negate(), 0.0);
    const delay = smoothstep(0.0, 2.5, fall);
    const radius = stroke.mul(-0.13).add(seed.mul(0.22).add(0.96));
    const lateral = sin(phase.sub(fall.mul(1.55))).mul(0.105).add(cos(course).mul(-0.19));
    const local = vec3(
        src.x.mul(radius).add(fall.mul(lateral)),
        src.y.mul(mix(stroke.mul(0.15).add(1.04), seed.mul(0.37).add(0.82), delay)),
        src.z.mul(radius).add(sin(clock.mul(0.61).add(fall.mul(2.1)).add(seed.mul(33))).mul(delay).mul(0.19)),
    );
    const yaw = seed.mul(6.28).add(course.mul(0.58));
    const pitch = sin(course.mul(1.22)).mul(0.44).add(stroke.mul(0.055)).sub(0.07);
    const roll = cos(course).mul(-0.27);
    const orient = (v) => {
        const x = v.x.mul(cos(yaw)).sub(v.z.mul(sin(yaw)));
        const z = v.x.mul(sin(yaw)).add(v.z.mul(cos(yaw)));
        const y = v.y.mul(cos(pitch)).sub(z.mul(sin(pitch)));
        return vec3(
            x.mul(cos(roll)).sub(y.mul(sin(roll))),
            x.mul(sin(roll)).add(y.mul(cos(roll))),
            v.y.mul(sin(pitch)).add(z.mul(cos(pitch))),
        );
    };
    const world = centre.add(orient(local).mul(size));
    material.vertexNode = viewProjection(world);
    const fade = float(1.0).sub(blFogAmount(length(cameraPosition.sub(centre)), centre.y).mul(0.85)).mul(alive);
    const facing = abs(dot(orient(attribute('aMedusaNormal', 'vec3')), normalize(cameraPosition.sub(centre))));
    const vSkin = varying(vec3(facing, phase, fade), 'blMedusaSkin');
    const vTone = varying(u.family(look.y), 'blMedusaTint');

    material.colorNode = Fn(() => {
        const kind = anatomy.x;
        const s = anatomy.y;
        const t = anatomy.z;
        const shell = step(0.5, kind).oneMinus();
        const pouch = blBell(kind.sub(1.0));
        const arm = blBell(kind.sub(2.0));
        const silk = step(2.5, kind);
        // Delicate radial canals converge at the apex. A broken necklace follows the scalloped lip.
        const canalAngle = s.mul(75.3982).add(sin(t.mul(7.4).add(s.mul(18.85))).mul(0.32));
        const canals = smoothstep(0.80, 0.995, cos(canalAngle));
        const rim = smoothstep(0.78, 0.99, t);
        const pearls = smoothstep(0.26, 0.97, cos(s.mul(150.7964)));
        const grazing = clamp(vSkin.x, 0.0, 1.0).oneMinus();
        const edge = grazing.mul(grazing);
        const wave = sin(t.mul(14.0).sub(vSkin.y.mul(1.5))).mul(0.5).add(0.5);
        const membrane = edge.mul(0.48).add(canals.mul(0.35).mul(wave.mul(0.6).add(0.4)))
            .add(rim.mul(pearls.mul(0.84).add(0.45))).add(0.043);
        const frill = sin(t.mul(89.0).sub(s.mul(3.1))).mul(0.5).add(0.5);
        const warm = mix(vTone, u.accent, arm.mul(0.46).add(shell.mul(rim).mul(0.24)));
        const pigment = mix(warm, vec3(0.94, 1.0, 1.0), pouch.mul(0.29).add(shell.mul(edge).mul(0.24)));
        const body = membrane.mul(shell).add(pouch.mul(0.67)).add(arm.mul(frill.mul(0.37).add(0.17)))
            .add(silk.mul(t.mul(-0.62).add(0.88)));
        const gain = u.breath.mul(u.power.mul(0.48).add(1.0)).mul(1.18);
        const flare = mix(pigment, vec3(1.0), 0.38).mul(flash).mul(1.3);
        const cover = shell.mul(0.13).add(arm.mul(0.30)).add(pouch.mul(0.20)).mul(vSkin.z);
        return vec4(pigment.mul(gain).add(flare).mul(body).mul(vSkin.z), cover);
    })();

    const part = blPart('BioluminescenceJellies', geometry, material, 20);
    part.count = n;
    part.up = 0;
    part.uniforms = { flash };
    const push = () => {
        geometry.getAttribute('aLife').needsUpdate = true;
    };
    /** Raise or sink jellies so that `target` are up; the change starts at `time`. */
    part.setTarget = (target, time) => {
        const want = Math.max(0, Math.min(n, Math.round(target)));
        for (let i = 0; i < n; i++) {
            const isUp = aLife[i * 2] <= time + 1e-6 && aLife[i * 2 + 1] > time;
            const sinking = aLife[i * 2] <= time && aLife[i * 2 + 1] <= time && time - aLife[i * 2 + 1] < JELLY_SINK;
            if (i < want && isUp) {
                aLife[i * 2 + 1] = NEVER; // wanted again: a sink scheduled ahead is called off
            } else if (i < want && sinking) {
                // Caught on its way down. Barely gone, it simply stays (the sink and the rise are
                // not the same path, so there is no joining them mid-way); mostly gone, it comes
                // up again from the water.
                const gone = (time - aLife[i * 2 + 1]) / JELLY_SINK;
                aLife[i * 2] = gone < 0.5 ? time - JELLY_RISE : time;
                aLife[i * 2 + 1] = NEVER;
            } else if (i < want) {
                // One after another, not all at once.
                aLife[i * 2] = time + Math.max(0, i - part.up) * 0.28;
                aLife[i * 2 + 1] = NEVER;
            } else if (i >= want && isUp) {
                aLife[i * 2 + 1] = time + (i - want) * 0.12;
            } else if (i >= want && aLife[i * 2] > time) {
                aLife[i * 2] = NEVER; // it had not started up yet
            }
        }
        part.up = want;
        push();
    };
    /** Every jelly flashes at `time` (which may be a moment ahead), on top of any flash still lit. */
    part.flash = (time, strength = 1) => {
        flashSwell.hit(strength, time);
    };
    /** How bright the jellies' flash is at `time`. */
    part.flashAt = (time) => flashSwell.valueAt(time);
    /** Back to rest at `time`: the first three have always been up. */
    part.reset = (time = 0) => {
        for (let i = 0; i < n; i++) aLife.set([i < 3 ? time - 100 : NEVER, NEVER], i * 2);
        part.up = Math.min(3, n);
        geometry.instanceCount = part.up;
        flashSwell.reset();
        flash.value = 0;
        push();
    };
    part.update = (time) => {
        // Retiring swimmers keep their slots until they have sunk. Empty water costs no skinning.
        let drawn = Math.max(part.up, geometry.instanceCount);
        while (drawn > part.up) {
            const slot = (drawn - 1) * 2;
            if (aLife[slot] < NEVER && time < aLife[slot + 1] + JELLY_SINK) break;
            drawn--;
        }
        geometry.instanceCount = drawn;
        flashSwell.advance(time);
        flash.value = flashSwell.valueAt(time);
    };
    part.reset(0);
    return part;
}
