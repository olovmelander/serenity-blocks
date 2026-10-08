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
 *  - Jellies: medusae of light that swim in the air over the pool. Three drift at rest; every
 *    step of a chain raises more out of the water, and they sink back when it breaks.
 *
 * Every part is one instanced draw of quads and is always drawn (dormant slots collapse to zero
 * size), so the first frame compiles every pipeline.
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
    mulberry32,
} from './bioluminescence-tsl.js';

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
        const shockAge = u.time.sub(u.shock.x);
        const shock = exp(max(shockAge.sub(length(worm.xz.sub(vec2(ELDER.x, ELDER.z))).mul(0.022)), 0.0).mul(-0.9))
            .mul(step(0.0, shockAge)).mul(u.shock.y);
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
 * @param {number} [seed]
 */
export function createMotes(u, count, seed = 0x5b0e) {
    const rand = mulberry32(seed);
    const aHome = new Float32Array(Math.max(1, count) * 4);
    for (let i = 0; i < count; i++) {
        const x = (rand() + rand() - 1) * MOTE_BOX.halfWidth;
        const z = MOTE_BOX.near - rand() ** 1.25 * MOTE_BOX.depth;
        aHome.set([x, rand(), z, rand()], i * 4);
    }
    const geometry = blQuadGeometry(count, { aHome: [aHome, 4] });
    const home = attribute('aHome', 'vec4');
    const material = blFxMaterial('BioluminescenceMotes');

    const s = home.w;
    // Each mote climbs at its own pace and starts over; the grotto's lift carries them all.
    const climb = fract(home.y.add(u.moteLift.mul(s.mul(0.022).add(0.012))));
    const wander = vec2(
        sin(u.time.mul(s.mul(0.2).add(0.13)).add(s.mul(41.0))),
        cos(u.time.mul(s.mul(0.17).add(0.11)).add(s.mul(23.0))),
    ).mul(s.mul(1.3).add(0.6));
    const height = climb.mul(MOTE_BOX.height).add(0.12);
    // A T-spin turns the air about the middle of the pool, faster higher up.
    const turn = u.swirl.mul(height.mul(0.09).add(0.4));
    const ox = home.x.add(wander.x);
    const oz = home.z.add(wander.y).add(22.0);
    const world = vec3(
        ox.mul(cos(turn)).sub(oz.mul(sin(turn))),
        height,
        ox.mul(sin(turn)).add(oz.mul(cos(turn))).sub(22.0),
    );
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(s.mul(0.035).add(0.022).mul(pxPerMetre), u.viewport.y.mul(0.0015), u.viewport.y.mul(0.011));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);

    const twinkle = sin(u.time.mul(s.mul(2.1).add(0.8)).add(s.mul(77.0))).mul(0.5).add(0.5);
    const life = sin(climb.mul(Math.PI));
    const pick = fract(s.mul(7.7));
    const tone = mix(mix(u.primary, u.secondary, step(0.45, pick)), u.accent, step(0.85, pick));
    const dist = length(cameraPosition.sub(world));
    const gain = twinkle.mul(twinkle).mul(0.9).add(0.1).mul(life)
        .mul(u.power.mul(1.0).add(0.7).add(u.surge.mul(0.8)))
        .mul(float(1.0).sub(blFogAmount(dist, world.y).mul(0.9)))
        .mul(u.breath);
    const vLight = varying(tone.mul(gain), 'blMote');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        return vec4(vLight.mul(exp(d.mul(d).mul(-5.5))).mul(smoothstep(1.0, 0.7, d)).mul(1.2), 0.0);
    })();

    const part = blPart('BioluminescenceMotes', geometry, material, 18);
    part.count = count;
    return part;
}

// ── Jellies ─────────────────────────────────────────────────────────────────────

/** Seconds a jelly takes to rise out of the pool to its place, and to sink away. */
export const JELLY_RISE = 2.6;
export const JELLY_SINK = 1.5;
/** The quad a jelly is painted in, in bell widths: (width, height); the bell sits near the top. */
const JELLY_QUAD = [2.4, 5.2];
const NEVER = 1e9;

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
    const geometry = blQuadGeometry(n, { aHome: [aHome, 4], aLook: [aLook, 2], aLife: [aLife, 2] });
    geometry.getAttribute('aLife').setUsage(THREE.DynamicDrawUsage);
    const home = attribute('aHome', 'vec4');
    const look = attribute('aLook', 'vec2');
    const life = attribute('aLife', 'vec2');
    /** Every jelly flashes at once: (time, strength). */
    const flash = uniform(new THREE.Vector2(-100, 0));
    const material = blFxMaterial('BioluminescenceJellies');

    const seed = look.x;
    const risen = clamp(u.time.sub(life.x).div(JELLY_RISE), 0.0, 1.0);
    const up = risen.mul(risen).mul(float(3.0).sub(risen.mul(2.0)));
    const sunk = clamp(u.time.sub(life.y).div(JELLY_SINK), 0.0, 1.0);
    const alive = step(life.x, u.time).mul(float(1.0).sub(sunk));
    // It swims: a slow beat of the bell, and it gains a little height on every stroke.
    const rate = seed.mul(0.25).add(0.42).mul(u.power.mul(0.7).add(1.0));
    const phase = u.time.mul(rate).add(seed.mul(20.0));
    const stroke = sin(phase.mul(6.2832));
    const bob = sin(phase.mul(6.2832).sub(1.1)).mul(0.14);
    const drift = vec3(
        sin(u.time.mul(0.11).add(seed.mul(33.0))).mul(1.5),
        sin(u.time.mul(0.07).add(seed.mul(57.0))).mul(0.7).add(bob),
        cos(u.time.mul(0.09).add(seed.mul(41.0))).mul(1.3),
    );
    const centre = vec3(home.x.mul(u.squeeze), mix(float(-0.6), home.y, up).sub(sunk.mul(1.2)), home.z).add(drift.mul(up));
    const toCam = normalize(cameraPosition.sub(centre).mul(vec3(1.0, 0.0, 1.0)));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const size = home.w.mul(alive.mul(0.4).add(0.6)).mul(step(0.001, alive));
    // It leans the way it drifts.
    const tilt = cos(u.time.mul(0.11).add(seed.mul(33.0))).mul(0.16);
    const local = vec2(positionGeometry.x.mul(JELLY_QUAD[0]), positionGeometry.y.sub(0.34).mul(JELLY_QUAD[1]));
    const world = centre
        .add(right.mul(local.x.add(local.y.mul(tilt))).mul(size))
        .add(vec3(0.0, 1.0, 0.0).mul(local.y.mul(size)));
    material.vertexNode = viewProjection(world);
    const flashAge = u.time.sub(flash.x);
    const flashEnv = exp(max(flashAge, 0.0).mul(-1.6)).mul(step(0.0, flashAge)).mul(flash.y);
    const dist = length(cameraPosition.sub(centre));
    const fade = float(1.0).sub(blFogAmount(dist, centre.y).mul(0.85)).mul(alive);
    const tone = u.family(look.y);
    const vTone = varying(vec4(tone.mul(fade), flashEnv.mul(fade)), 'blJellyTone');
    const vBeat = varying(vec3(stroke, seed, u.power.mul(0.8).add(1.0).mul(u.breath)), 'blJellyBeat');
    material.colorNode = Fn(() => {
        // q: x in bell widths (−1.2..1.2), y in bell widths with 0 at the bell's rim, up positive.
        const st = uv();
        const q = vec2(st.x.sub(0.5).mul(JELLY_QUAD[0]), st.y.sub(0.5).sub(0.34).mul(JELLY_QUAD[1]).add(0.0)).toVar();
        const beat = vBeat.x;
        const rnd = vBeat.y;
        // The bell closes on the stroke: narrower and taller.
        const wide = beat.mul(-0.11).add(0.92);
        const tallness = beat.mul(0.09).add(0.78);
        const bx = q.x.div(wide);
        const by = q.y.div(tallness);
        const dome = bx.mul(bx).add(by.mul(by));
        const inBell = float(1.0).sub(smoothstep(0.86, 1.0, dome)).mul(step(0.0, q.y.add(0.04)));
        // A glass bell: bright at its skin, darker within, with ribs that run from crown to rim.
        const skin = smoothstep(0.35, 1.0, dome);
        // (The root's argument is floored first: a NaN here would reach the bloom.)
        const ribs = blBell(fract(bx.div(max(float(1.0).sub(by.mul(by)), 0.04).sqrt()).mul(2.6).add(0.5)).sub(0.5).mul(3.4));
        const crown = exp(q.x.mul(q.x).mul(-9.0).sub(by.sub(0.55).mul(by.sub(0.55)).mul(12.0)));
        const rim = blBell(q.y.div(0.12)).mul(float(1.0).sub(smoothstep(0.8, 1.02, abs(bx))));
        const bell = inBell.mul(skin.mul(0.75).add(ribs.mul(0.35)).add(0.16)).add(crown.mul(inBell).mul(0.9)).add(rim.mul(0.9));

        // Tendrils: lines that trail below the rim, waving, fading as they fall.
        const fall = q.y.negate();
        const under = step(0.0, fall);
        const tendrils = float(0.0).toVar();
        for (let k = 0; k < 5; k++) {
            const x0 = (k - 2) * 0.34;
            const wave = sin(fall.mul(2.2 + k * 0.3).sub(u.time.mul(1.6)).add(rnd.mul(30.0)).add(k * 1.7))
                .mul(fall.mul(0.11).add(0.02));
            const dx = q.x.sub(wave).sub(x0 * 1.0).sub(beat.mul(x0).mul(-0.12));
            const reach = 2.2 + ((k * 7) % 5) * 0.25;
            const lineK = exp(dx.mul(dx).mul(-520.0)).add(exp(dx.mul(dx).mul(-60.0)).mul(0.18));
            tendrils.addAssign(lineK.mul(float(1.0).sub(smoothstep(reach * 0.35, reach, fall))));
        }
        // The frilled arms at the heart, short and bright.
        const arms = exp(q.x.mul(q.x).mul(-26.0)).mul(float(1.0).sub(smoothstep(0.2, 1.3, fall)))
            .mul(sin(fall.mul(13.0).sub(u.time.mul(2.5))).mul(0.3).add(0.7));
        const below = tendrils.mul(0.55).add(arms.mul(0.7)).mul(under);

        const light = bell.add(below);
        const tint = vTone.rgb;
        const hot = mix(tint, vec3(1.0), crown.mul(inBell).mul(0.6).add(rim.mul(0.3)));
        const ex = st.x.mul(2.0).sub(1.0);
        const ey = st.y.mul(2.0).sub(1.0);
        const inside = clamp(float(1.0).sub(ex.mul(ex)), 0.0, 1.0).mul(clamp(float(1.0).sub(ey.mul(ey)), 0.0, 1.0));
        const glow = exp(q.x.mul(q.x).add(q.y.sub(0.3).mul(q.y.sub(0.3)).mul(0.6)).mul(-1.6)).mul(0.07).mul(inside).mul(inside);
        const gain = vBeat.z.mul(beat.mul(0.12).add(1.0)).mul(1.5);
        const flare = mix(tint, vec3(1.0), 0.5).mul(light.add(glow.mul(3.0))).mul(vTone.w).mul(2.2);
        return vec4(hot.mul(light).mul(gain).add(tint.mul(glow).mul(gain)).add(flare), 0.0);
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
    /** Every jelly flashes at `time`. */
    part.flash = (time, strength = 1) => {
        flash.value.set(time, strength);
    };
    /** Back to rest at `time`: the first three have always been up. */
    part.reset = (time = 0) => {
        for (let i = 0; i < n; i++) aLife.set([i < 3 ? time - 100 : NEVER, NEVER], i * 2);
        part.up = Math.min(3, n);
        flash.value.set(-100, 0);
        push();
    };
    part.update = () => {};
    part.reset(0);
    return part;
}
