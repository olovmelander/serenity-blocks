/**
 * Bioluminescence — the pool.
 *
 * Still, black water that mirrors the whole grotto: on the showcase tiers a planar reflector()
 * renders the scene from the mirrored camera at reduced resolution and the water reads it through
 * its own slopes (the rings of a lock, the swell of a clear, drips from the vault). Lower tiers
 * mirror the cave's own glow and the lamps' halos instead.
 *
 * The water is alive. It is full of plankton that light where the water is disturbed: a lock's
 * ring is a ring of blue sparks, a clear rolls a band of them across the whole pool and leaves
 * the water glittering behind it, a drip lights its own small circle, and a thin line of light
 * lies wherever the water meets stone. Looking down near your feet the mirror gives way to the
 * bed, where the mycelium runs.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
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
    pow,
    reflect,
    reflector,
    screenUV,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    ELDER,
    LOCK_SLOTS,
    RING_FADE,
    RING_REACH,
    RING_TAU,
    TERRAIN,
    blAtmosphere,
    blBell,
    blClearLight,
    blFogColor,
    blFxMaterial,
    blHash22,
    blLampImage,
    blLockLight,
    blPart,
    blQuadGeometry,
    blScatter,
} from './bioluminescence-tsl.js';

/** How fast a drip's ring spreads (m/s) and how long it lives (s). */
const DRIP_SPEED = 1.15;
const DRIP_LIFE = 3.2;

/**
 * @param {object} u  shared grotto uniforms
 * @param {object} plan
 * @param {object} [opts]
 * @param {number} [opts.reflectionScale=0]  reflector resolution scale (0 = mirror the cave's glow)
 * @param {boolean} [opts.sparkle=true]      the plankton's individual sparks
 */
export function createWater(u, plan, opts = {}) {
    const reflectionScale = opts.reflectionScale ?? 0;
    const sparkle = opts.sparkle !== false;
    const reflection = reflectionScale > 0
        ? reflector({ resolutionScale: reflectionScale, bounces: false, generateMipmaps: true })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'BioluminescenceReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'BioluminescenceWater';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();
        const st = p.xz.toVar();

        // ── Depth: the bed under this point ──
        const inside = step(TERRAIN.x0 + 1, p.x).mul(step(p.x, TERRAIN.x1 - 1))
            .mul(step(TERRAIN.z0 + 1, p.z)).mul(step(p.z, TERRAIN.z1 - 1));
        const depth = mix(float(1.2), max(u.height(st).negate(), 0.0), inside).toVar();

        // ── The water's slope: it barely moves, until something touches it ──
        const w1 = u.noise(st.mul(0.031).add(vec2(u.time.mul(0.0031), u.time.mul(0.0019)))).toVar();
        const w2 = u.noise(st.mul(0.13).sub(vec2(u.time.mul(0.0082), u.time.mul(-0.0051)))).toVar();
        const slope = w1.rg.sub(0.5).mul(0.6).add(w2.ba.sub(0.5).mul(0.22)).mul(u.power.mul(0.6).add(1.0))
            .mul(0.034)
            .toVar();
        /** How disturbed the water is here: what wakes the plankton. */
        const stir = float(0.0).toVar();
        const light = vec3(0.0).toVar();

        // ── Drips from the vault: each lights its own small circle ──
        for (let i = 0; i < plan.drips.length; i++) {
            const drip = plan.drips[i];
            const age = fract(u.time.div(drip.period).add(drip.phase)).mul(drip.period);
            const o = st.sub(vec2(drip.x, drip.z));
            const d = length(o);
            const x = d.sub(age.mul(DRIP_SPEED));
            const env = exp(age.mul(-1.3)).mul(step(age, DRIP_LIFE));
            const wave = sin(x.mul(9.0)).mul(exp(x.mul(x).mul(-3.0))).mul(env);
            slope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.085));
            stir.addAssign(blBell(x.div(0.5)).mul(env).mul(0.7).add(exp(d.mul(d).mul(-9.0)).mul(exp(age.mul(-5.0))).mul(1.5)));
        }

        // ── Lock rings: a crisp front with a soft wake, and the slope they give the surface ──
        If(u.ringsLive.greaterThan(0.5), () => {
            for (let i = 0; i < LOCK_SLOTS; i++) {
                const A = u.lockA[i];
                const age = u.time.sub(A.z);
                const radius = u.lockC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
                const o = st.sub(A.xy);
                const d = length(o);
                const x = d.sub(radius);
                const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
                const front = blBell(x.div(0.4)).mul(0.9).add(blBell(x.add(1.2).div(2.2)).mul(0.06));
                light.addAssign(u.lockC[i].rgb.mul(front.mul(env)));
                stir.addAssign(blBell(x.add(1.2).div(4.2)).mul(env).mul(1.3));
                const wave = sin(x.mul(2.1)).mul(exp(x.mul(x).mul(-0.14))).mul(env);
                slope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.13));
            }
        });
        // ── The clear's swell ──
        const clear = vec4(0.0).toVar();
        If(u.clearLive.greaterThan(0.5), () => {
            clear.assign(blClearLight(u, p));
            for (let i = 0; i < CLEAR_SLOTS; i++) {
                const A = u.clearA[i];
                // (Each clear swells out from where it started.)
                const fromHeart = st.sub(u.clearH[i]);
                const heartDist = length(fromHeart);
                const far = clamp(heartDist.div(CLEAR_REACH), 0.0, 1.0);
                const pass = float(CLEAR_TRAVEL).mul(pow(far, 1 / CLEAR_SHAPE));
                const since = u.time.sub(A.x).sub(pass);
                const swell = sin(since.mul(20.0)).mul(exp(since.mul(since).mul(-30.0))).mul(A.z);
                slope.addAssign(fromHeart.div(max(heartDist, 1e-3)).mul(swell).mul(0.09));
            }
        });
        // The Great Bloom's ring over the pool.
        const shockAge = u.time.sub(u.shock.x);
        const shockX = length(st.sub(vec2(ELDER.x, ELDER.z))).sub(shockAge.mul(34.0));
        const shock = blBell(shockX.div(3.5)).mul(exp(shockAge.mul(-0.9))).mul(step(0.0, shockAge)).mul(u.shock.y);
        stir.addAssign(clear.w.mul(0.75).add(shock.mul(2.0)));

        // ── The mirror ──
        const cosT = clamp(V.y.negate(), 0.0, 1.0);
        const oneMinus = float(1.0).sub(cosT);
        const o2 = oneMinus.mul(oneMinus);
        const fres = mix(float(0.02).add(float(0.98).mul(o2.mul(o2).mul(oneMinus))), float(1.0), 0.34).toVar();
        const mirror = vec3(0.0).toVar();
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.05).add(1.0));
            const ruv = screenUV.flipX().add(vec2(slope.x, slope.y.mul(1.7)).mul(reach).mul(0.55));
            mirror.assign(reflection.sample(ruv).level(reach.mul(1.3)).rgb);
        } else {
            // No second render: the water returns the cave's glow along its mirror ray and the
            // lamps' halos, drawn out down the water as lights are on a pool at night.
            const Rs = reflect(V, normalize(vec3(slope.x.mul(-1.5), 1.0, slope.y.mul(-3.0)))).toVar();
            const Rup = normalize(vec3(Rs.x, abs(Rs.y).add(0.004), Rs.z)).toVar();
            mirror.assign(blFogColor(u, Rup).mul(1.25)
                .add(blScatter(u, Rup, float(140.0), p).mul(1.4))
                .add(blLampImage(u, p, Rup).mul(0.55)));
        }

        // ── The bed: mycelium under the water, seen where you look down ──
        const down = max(V.y.negate(), 0.16);
        const bedP = st.add(V.xz.div(down).mul(clamp(depth, 0.0, 1.3)).mul(0.7));
        const v1 = u.noise(bedP.mul(0.047)).r;
        const v2 = u.noise(bedP.mul(0.163).add(vec2(0.3, 0.6))).g;
        const veins = blBell(v1.sub(0.5).mul(17.0)).add(blBell(v2.sub(0.5).mul(26.0)).mul(0.55));
        const throb = sin(u.time.mul(0.7).add(v1.mul(26.0))).mul(0.3).add(0.7);
        const seeThrough = float(1.0).sub(fres).mul(exp(dist.mul(-0.03))).mul(exp(depth.mul(-0.5)));
        const wake = u.power.mul(0.6).add(stir.mul(0.9)).add(u.surge.mul(0.4)).add(0.1);
        const shelf = float(1.0).sub(smoothstep(0.0, 0.7, depth));
        const bed = u.vein.mul(veins).mul(throb).mul(wake).mul(u.breath)
            .add(vec3(0.012, 0.03, 0.03).mul(shelf))
            .add(light.mul(veins.mul(1.5).add(0.15)))
            .mul(seeThrough);

        const col = bed.add(mirror.mul(fres)).toVar();

        // ── Plankton: sparks that light where the water is disturbed ──
        const lap = blBell(depth.sub(0.05).div(0.16)).mul(inside);
        const shimmer = sin(u.time.mul(1.2).add(w2.r.mul(15.0))).mul(0.3).add(0.7);
        const awake = stir.add(lap.mul(shimmer).mul(u.power.mul(0.9).add(0.55))).add(u.power.mul(0.07)).toVar();
        if (sparkle) {
            // Each spark is one creature: a point somewhere in its own cell of the water, winking
            // on its own clock. Three sizes of cell, so there are sparks at every distance; a
            // layer goes out where its cells are finer than a pixel.
            const layer = (scale, salt) => {
                const gq = st.mul(scale).add(vec2(u.time.mul(0.004 * scale), u.time.mul(-0.0026 * scale)));
                const r = blHash22(floor(gq).add(vec2(salt, salt * 1.7)));
                const d = length(fract(gq).sub(0.5).sub(r.sub(0.5).mul(0.6)));
                const size = r.y.mul(0.1).add(0.07);
                const point = float(1.0).sub(smoothstep(size.mul(0.3), size, d));
                const wink = sin(u.time.mul(r.x.mul(3.0).add(1.5)).add(r.y.mul(40.0))).mul(0.5).add(0.5);
                const fine = clamp(float(1.0).sub(fwidth(gq.x).add(fwidth(gq.y)).mul(1.2)), 0.0, 1.0);
                return point.mul(wink.mul(wink)).mul(step(0.4, r.x)).mul(fine);
            };
            // They gather in clouds.
            const cloud = u.noise(st.mul(0.11).add(vec2(u.time.mul(0.004), 0.0))).a.mul(1.1).add(0.3);
            const sparks = layer(0.8, 3.0).mul(1.3).add(layer(2.6, 11.0)).add(layer(6.5, 23.0).mul(0.8))
                .mul(cloud);
            col.addAssign(mix(u.plankton, vec3(1.0), 0.3).mul(sparks).mul(awake).mul(3.0)
                .mul(u.breath));
        }
        // The glow of the water itself where it is awake, and the line of light at the shore.
        col.addAssign(u.plankton.mul(awake.min(1.6)).mul(0.1).mul(u.breath));
        col.addAssign(u.plankton.mul(lap).mul(shimmer).mul(u.power.mul(0.8).add(0.38)).mul(u.breath));

        // ── Gameplay light riding the water itself ──
        col.addAssign(light.mul(1.1));
        col.addAssign(clear.rgb.mul(0.34));
        col.addAssign(mix(u.plankton, vec3(0.8, 1.0, 0.95), 0.5).mul(shock).mul(0.75));
        return blAtmosphere(u, col, p);
    })();

    const geometry = new THREE.PlaneGeometry(420, 420, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -70);
    const part = blPart('BioluminescenceWater', geometry, material, -26);
    part.reflection = reflection;
    part.reflectorTarget = reflection ? reflection.target : null;
    return part;
}

/**
 * Pads of light floating near the shores: a dark leaf with a lit rim and veins, lying on the
 * water. They rock on a lock's ring and flare as a clear passes.
 */
export function createPads(u, plan, count) {
    const n = Math.min(count, plan.pads.length);
    const aPad = new Float32Array(Math.max(1, n) * 4);
    const aLook = new Float32Array(Math.max(1, n) * 2);
    for (let i = 0; i < n; i++) {
        const pad = plan.pads[i];
        aPad.set([pad.x, pad.z, pad.r, pad.seed], i * 4);
        aLook.set([pad.family, pad.seed * 6.283], i * 2);
    }
    const geometry = blQuadGeometry(n, { aPad: [aPad, 4], aLook: [aLook, 2] });
    const pad = attribute('aPad', 'vec4');
    const look = attribute('aLook', 'vec2');
    const material = blFxMaterial('BioluminescencePads');
    const centre = vec3(pad.x, 0.012, pad.y);
    const ca = look.y.cos();
    const sa = look.y.sin();
    const q = positionGeometry.xy.mul(2.0);
    const world = centre.add(vec3(q.x.mul(ca).sub(q.y.mul(sa)), 0.0, q.x.mul(sa).add(q.y.mul(ca))).mul(pad.z));
    material.positionNode = world;
    const ring = blLockLight(u, centre);
    const clear = blClearLight(u, centre);
    const breathe = sin(u.time.mul(0.8).add(pad.w.mul(40.0))).mul(0.25).add(0.75);
    const vLight = varying(
        u.family(look.x).mul(breathe).mul(u.power.mul(1.2).add(0.8)).mul(u.breath)
            .add(ring.mul(2.0))
            .add(clear.rgb.mul(1.6)),
        'blPad',
    );
    material.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const d = length(st);
        // A notch, as a lily pad has.
        const ang = atan(st.y, st.x);
        const notch = smoothstep(0.0, 0.16, abs(ang).sub(0.1)).add(step(d, 0.18));
        const leaf = float(1.0).sub(smoothstep(0.86, 0.96, d)).mul(clamp(notch, 0.0, 1.0));
        const rim = blBell(d.sub(0.86).div(0.1));
        const veins = blBell(fract(ang.mul(7 / 6.283).add(0.5)).sub(0.5).mul(7.0)).mul(smoothstep(0.1, 0.5, d));
        const glow = rim.mul(1.3).add(veins.mul(0.5)).add(exp(d.mul(d).mul(-5.0)).mul(0.22));
        const body = vec3(0.004, 0.016, 0.012);
        const atm = blAtmosphere(u, body.add(vLight.mul(glow)), positionWorld);
        return vec4(atm.mul(leaf), leaf);
    })();
    const part = blPart('BioluminescencePads', geometry, material, 4);
    part.count = n;
    return part;
}
