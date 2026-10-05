/**
 * Lunara — the mirror flats.
 *
 * A sheet of still water a hand deep over a bed veined with light. On the showcase tiers the
 * whole valley stands in it: a planar reflector() renders the scene from the mirrored camera at
 * reduced resolution and the water reads it through its own slopes (a breath of wind, the rings
 * of a lock, the swell of a clear). Lower tiers mirror the sky function and the moons' discs
 * instead. Looking down, the mirror gives way to the bed: veins of the palette's light that wake
 * as rings pass over them and flood when a clear rolls out.
 *
 * The water knows its depth (the plan's heightmap): the shelves pale, and a thin line of light
 * lies where the water meets the land.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    reflect,
    reflector,
    screenUV,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    LOCK_SLOTS,
    RING_FADE,
    RING_REACH,
    RING_TAU,
    TERRAIN,
    luAtmosphere,
    luBell,
    luClearLight,
    luMoonDiscs,
    luPart,
    luSkyBase,
} from './lunara-tsl.js';

/**
 * @param {object} u  shared valley uniforms
 * @param {object} [opts]
 * @param {number} [opts.reflectionScale=0]  reflector resolution scale (0 = mirror the sky function)
 * @param {boolean} [opts.glitter=true]      sparkle on the water under the moon
 */
export function createWater(u, opts = {}) {
    const reflectionScale = opts.reflectionScale ?? 0;
    const glitter = opts.glitter !== false;
    const reflection = reflectionScale > 0
        ? reflector({ resolutionScale: reflectionScale, bounces: false, generateMipmaps: true })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'LunaraReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'LunaraWater';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();
        const st = p.xz.toVar();

        // ── Depth: the bed under this point ──
        const inside = step(abs(p.x), TERRAIN.halfWidth - 2).mul(step(TERRAIN.zMin + 2, p.z)).mul(step(p.z, TERRAIN.zMax - 2));
        const depth = mix(float(1.1), max(u.height(st).negate(), 0.0), inside).toVar();
        const shelf = float(1.0).sub(smoothstep(0.0, 0.85, depth)).toVar();

        // ── The water's slope: a breath of wind ──
        const w1 = u.noise(st.mul(0.027).add(vec2(u.time.mul(0.0042), u.time.mul(0.0025)))).toVar();
        const w2 = u.noise(st.mul(0.115).sub(vec2(u.time.mul(0.0105), u.time.mul(-0.0062)))).toVar();
        const wind = u.power.mul(0.5).add(1.0);
        const slope = w1.rg.sub(0.5).mul(0.7).add(w2.ba.sub(0.5).mul(0.2)).mul(wind)
            .mul(0.05)
            .toVar();

        // ── Lock rings: a crisp front with a soft wake, and the slope they give the surface ──
        const ring = vec3(0.0).toVar();
        const wake = float(0.0).toVar();
        If(u.ringsLive.greaterThan(0.5), () => {
            for (let i = 0; i < LOCK_SLOTS; i++) {
                const A = u.lockA[i];
                const age = u.time.sub(A.z);
                const radius = u.lockC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
                const o = st.sub(A.xy);
                const d = length(o);
                const x = d.sub(radius);
                const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
                const front = luBell(x.div(0.7)).add(luBell(x.add(2.4).div(3.6)).mul(0.16));
                ring.addAssign(u.lockC[i].rgb.mul(front.mul(env)));
                wake.addAssign(luBell(x.add(1.5).div(5.0)).mul(env));
                const wave = sin(x.mul(1.7)).mul(exp(x.mul(x).mul(-0.09))).mul(env);
                slope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.42));
            }
        });
        // ── The clear's swell ──
        const clear = vec4(0.0).toVar();
        If(u.clearLive.greaterThan(0.5), () => {
            clear.assign(luClearLight(u, p));
            const fromHeart = st.sub(u.heart);
            const heartDist = length(fromHeart);
            const far = clamp(heartDist.div(CLEAR_REACH), 0.0, 1.0);
            const pass = float(CLEAR_TRAVEL).mul(pow(far, 1 / CLEAR_SHAPE));
            for (let i = 0; i < CLEAR_SLOTS; i++) {
                const A = u.clearA[i];
                const since = u.time.sub(A.x).sub(pass);
                const swell = sin(since.mul(22.0)).mul(exp(since.mul(since).mul(-34.0))).mul(A.z);
                slope.addAssign(fromHeart.div(max(heartDist, 1e-3)).mul(swell).mul(0.3));
            }
        });

        // ── The mirror ──
        const cosT = clamp(V.y.negate(), 0.0, 1.0);
        const fres = mix(float(0.02).add(float(0.98).mul(pow(float(1.0).sub(cosT), 5.0))), float(1.0), 0.3).toVar();
        const mirror = vec3(0.0).toVar();
        const Nw = normalize(vec3(slope.x.mul(-2.4), 1.0, slope.y.mul(-2.4))).toVar();
        const Rw = reflect(V, Nw).toVar();
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.035).add(1.0));
            const ruv = screenUV.flipX().add(vec2(slope.x, slope.y.mul(1.7)).mul(reach).mul(0.5));
            // A breath of blur near the eye, where the ripples are larger than a pixel.
            mirror.assign(reflection.sample(ruv).level(reach.mul(1.6)).rgb);
        } else {
            // No second render: the water returns the sky and the moons along its own mirror ray,
            // and the dark of the far shore where that ray runs low.
            // (A gentler slope than the sparkle uses: the discs should stretch, not smear.)
            const Rs = reflect(V, normalize(vec3(slope.x.mul(-0.5), 1.0, slope.y.mul(-1.1))));
            const Rup = vec3(Rs.x, abs(Rs.y), Rs.z);
            const shore = float(1.0).sub(smoothstep(0.012, 0.075, Rup.y));
            mirror.assign(luSkyBase(u, Rup).add(luMoonDiscs(u, Rup).mul(w1.b.mul(0.3).add(0.22))).mul(mix(float(1.0), float(0.22), shore)));
        }

        // ── The bed: veins of light under the water ──
        const down = max(V.y.negate(), 0.14);
        const bedP = st.add(V.xz.div(down).mul(clamp(depth, 0.0, 1.0)).mul(0.7));
        const v1 = u.noise(bedP.mul(0.043)).r;
        const v2 = u.noise(bedP.mul(0.151).add(vec2(0.3, 0.6))).g;
        const veins = luBell(v1.sub(0.5).mul(15.0)).add(luBell(v2.sub(0.5).mul(22.0)).mul(0.5));
        const throb = sin(u.time.mul(0.8).add(v1.mul(22.0))).mul(0.25).add(0.75);
        const wakeUp = u.power.mul(0.45).add(clear.w.mul(0.45)).add(wake.mul(1.4)).add(u.surge.mul(0.25))
            .add(0.1);
        const seeThrough = float(1.0).sub(fres).mul(exp(dist.mul(-0.011)));
        const sand = vec3(0.022, 0.015, 0.045).add(u.moonCol.mul(0.012)).mul(shelf);
        const bed = u.bed.mul(veins).mul(throb).mul(wakeUp).mul(u.breath)
            .add(sand)
            .mul(seeThrough);
        // A ring is the piece's colour running through the veins.
        const ringBed = ring.mul(veins.mul(1.6).add(0.2)).mul(seeThrough);

        const col = bed.add(ringBed).add(mirror.mul(fres)).toVar();

        // ── Moon glitter: the surface's finest facets, where its mirror ray finds the moon ──
        if (glitter) {
            const g = u.noise(st.mul(0.71).add(vec2(u.time.mul(0.021), u.time.mul(0.013)))).a;
            const lobe = pow(max(dot(Rw, u.moonDir), 0.0), 150.0);
            const spark = smoothstep(0.66, 0.9, g).mul(lobe);
            col.addAssign(u.moonCol.mul(u.moonCol).mul(spark).mul(0.9).mul(u.breath));
        }

        // ── Where water meets land: a thin line of the bed's light ──
        const shoreLine = luBell(depth.sub(0.04).div(0.11)).mul(inside)
            .mul(sin(u.time.mul(1.1).add(w2.r.mul(14.0))).mul(0.3).add(0.7));
        col.addAssign(u.bed.mul(shoreLine).mul(u.power.mul(0.8).add(0.32)).mul(u.breath));

        // ── Gameplay light riding the water itself ──
        col.addAssign(ring.mul(1.5));
        col.addAssign(clear.rgb.mul(0.42));
        return luAtmosphere(u, col, p);
    })();

    const geometry = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -2600);
    const part = luPart('LunaraWater', geometry, material, -26);
    part.reflection = reflection;
    part.reflectorTarget = reflection ? reflection.target : null;
    return part;
}
