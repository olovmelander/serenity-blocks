/**
 * Neon District — the wet street.
 *
 * One plane: asphalt, worn lane paint, kerbs and paved walks, puddles gathered in the gutters and
 * wherever the baked noise says the road dips. On the showcase tiers the whole city stands upside
 * down in it: a planar reflector() renders the district from the mirrored camera at reduced
 * resolution with a mip chain, and the street reads it sharp in the puddles and smeared down the
 * rough wet asphalt (a short vertical run of taps at a blurred mip — the long streaks under every
 * sign). Rain rings pock the puddles. Lower tiers mirror the glow map instead.
 *
 * Gameplay writes into the water: a piece locking sends rings out from where it landed (they
 * bend the reflections and carry the piece's colour), and a clear rolls a line of light up the
 * street from the vanishing point.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    positionWorld,
    pow,
    reflector,
    screenUV,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    LOCK_FADE,
    LOCK_REACH,
    LOCK_SLOTS,
    LOCK_TAU,
    STREET,
    ndAtmosphere,
    ndClearLight,
    ndGlow,
    ndBell,
    ndHash22,
    ndHaze,
} from './neon-district-tsl.js';

/** Lamp spacing along the street (twelve a side per period). */
export const LAMP_SPACING = STREET.period / 12;
export const LAMP_OFFSET = 2;

/**
 * Rain rings: one drop per cell per cycle. Returns (push.x, push.z, glint): the slope the ring
 * gives the water and the spark at the moment of impact.
 */
const rainRings = /* @__PURE__ */ Fn(([st, time, cellSize, rate]) => {
    const g = st.div(cellSize);
    const id = floor(g);
    const h = ndHash22(id);
    const centre = h.mul(0.6).add(0.2);
    const local = fract(g).sub(centre);
    const cycle = fract(time.mul(rate).add(h.x.mul(7.0)).add(h.y));
    const d = length(local);
    const radius = cycle.mul(0.46);
    const x = d.sub(radius).mul(26.0);
    const wave = sin(x).mul(exp(x.mul(x).mul(-0.32))).mul(float(1.0).sub(cycle));
    const dir = local.div(max(d, 1e-3));
    const glint = exp(d.mul(d).mul(-900.0)).mul(float(1.0).sub(smoothstep(0.0, 0.12, cycle)));
    return vec3(dir.mul(wave), glint);
}).setLayout({
    name: 'nd_rainRings',
    type: 'vec3',
    inputs: [
        { name: 'st', type: 'vec2' }, { name: 'time', type: 'float' },
        { name: 'cellSize', type: 'float' }, { name: 'rate', type: 'float' },
    ],
});

/** Anti-aliased stripe: 1 where |x − centre| < halfWidth. */
const stripe = (x, centre, halfWidth, aa) => float(1.0)
    .sub(smoothstep(halfWidth.sub(aa), halfWidth.add(aa), abs(x.sub(centre))));

/**
 * @param {object} u  shared district uniforms
 * @param {object} [opts]
 * @param {number} [opts.reflectionScale=0]  reflector resolution scale (0 = mirror the glow map)
 * @param {number} [opts.reflectionTaps=3]   taps down the smear (1, 3 or 5)
 * @param {boolean} [opts.rainRings=true]
 * @returns {{ mesh: THREE.Mesh, material: THREE.Material, geometry: THREE.BufferGeometry,
 *   reflection: object|null, reflectorTarget: THREE.Object3D|null }}
 */
export function createStreet(u, opts = {}) {
    const reflectionScale = opts.reflectionScale ?? 0;
    const taps = opts.reflectionTaps ?? 3;
    const withRings = opts.rainRings !== false;
    const reflection = reflectionScale > 0
        ? reflector({ resolutionScale: reflectionScale, bounces: false, generateMipmaps: true })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'NeonDistrictReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDistrictStreet';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist);
        const zl = p.z.sub(u.scroll);
        const st = vec2(p.x, zl).toVar();
        const ax = abs(p.x);
        // Screen-space footprint of a metre of street (fwidth up front: uniform control flow).
        const fx = fwidth(p.x);
        const fz = fwidth(zl);
        const near = float(1.0).sub(smoothstep(0.02, 0.2, max(fx, fz)));

        // Every pattern laid along the street repeats in a whole number of periods (the noise
        // tiles 7, 54 and 419 times in one), so the world can rebase the scroll unseen.
        const nA = u.noise(st.mul(7 / STREET.period)).toVar();
        const nB = u.noise(st.mul(54 / STREET.period)).toVar();
        const nC = u.noise(st.mul(419 / STREET.period)).toVar();

        // ── Zones ──
        const road = float(1.0).sub(smoothstep(STREET.halfRoad - 0.05, STREET.halfRoad + 0.05, ax)).toVar();
        const kerb = stripe(ax, float(STREET.halfRoad + 0.16), float(0.16), fx.add(0.01));

        // ── Puddles: the gutters, and wherever the road dips ──
        const gutter = exp(abs(ax.sub(STREET.halfRoad - 0.7)).mul(-1.5)).mul(0.2);
        const dips = nA.r.add(gutter).add(nB.g.mul(0.07));
        const puddleRoad = smoothstep(0.5, 0.6, dips);
        const puddleWalk = smoothstep(0.6, 0.68, nA.g.add(nB.r.mul(0.08)));
        const puddle = mix(puddleWalk.mul(0.85), puddleRoad, road).mul(u.rain.mul(0.5).add(0.5)).toVar();
        const rough = mix(mix(float(0.36), float(0.66), nB.r), float(0.02), puddle).toVar();

        // ── Albedo ──
        const asphalt = vec3(0.021, 0.023, 0.03).mul(nB.r.mul(0.9).add(0.55)).mul(nC.b.mul(0.5).add(0.75));
        // Paved walk: 0.8 m flags.
        const flag = vec2(fract(p.x.div(0.8)), fract(zl.div(0.8)));
        const joint = float(1.0).sub(smoothstep(0.0, 0.05, min(min(flag.x, float(1.0).sub(flag.x)), min(flag.y, float(1.0).sub(flag.y)))));
        const walk = vec3(0.04, 0.041, 0.05).mul(nB.g.mul(0.6).add(0.7)).mul(float(1.0).sub(joint.mul(0.5).mul(near)));
        // Paint: a double centre line, lane dashes, edge lines, a zebra crossing every 80 m.
        const wear = smoothstep(0.3, 0.72, nB.b.add(nC.r.mul(0.4)));
        const aaX = fx.add(0.004);
        const centre = stripe(ax, float(0.19), float(0.07), aaX);
        const dash = stripe(ax, float(3.2), float(0.075), aaX).mul(step(fract(zl.div(8.0)), 0.36));
        const edge = stripe(ax, float(STREET.halfRoad - 0.55), float(0.06), aaX);
        const crossZ = fract(zl.add(26.0).div(80.0)).mul(80.0);
        const inCross = step(crossZ, 4.0).mul(step(0.4, crossZ));
        const zebra = inCross.mul(step(fract(p.x.div(1.1).add(0.25)), 0.5)).mul(step(ax, STREET.halfRoad - 0.9));
        const stopLine = stripe(crossZ, float(5.4), float(0.2), fz.add(0.004));
        const white = max(max(dash, edge), max(zebra, stopLine)).mul(wear).mul(road);
        const amber = centre.mul(wear).mul(road).mul(float(1.0).sub(inCross));
        const albedo = mix(walk, asphalt, road).toVar();
        albedo.assign(mix(albedo, vec3(0.13, 0.135, 0.15), white.mul(0.8)));
        albedo.assign(mix(albedo, vec3(0.17, 0.095, 0.012), amber.mul(0.8)));
        albedo.assign(mix(albedo, vec3(0.07, 0.07, 0.08), kerb.mul(0.8)));

        // ── Light ──
        const glow = ndGlow(u, p).toVar();
        const lampZ = (offset) => fract(zl.sub(LAMP_OFFSET + offset).div(LAMP_SPACING).add(0.5)).sub(0.5).mul(LAMP_SPACING);
        const lzL = lampZ(0);
        const lzR = lampZ(LAMP_SPACING * 0.5);
        const dxL = p.x.add(STREET.halfRoad - 1.2);
        const dxR = p.x.sub(STREET.halfRoad - 1.2);
        const pool = exp(lzL.mul(lzL).add(dxL.mul(dxL)).mul(-0.034))
            .add(exp(lzR.mul(lzR).add(dxR.mul(dxR)).mul(-0.034)));
        const lampCol = vec3(0.62, 0.84, 1.0).mul(u.neon.mul(0.55).add(0.45));
        // Lock rings on the water: a crisp front with a soft wake inside it, and the slope the
        // ring gives the surface (it bends the mirror as it passes).
        const ring = vec3(0.0).toVar();
        const ringSlope = vec2(0.0).toVar();
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const A = u.lockA[i];
            const age = u.time.sub(A.z);
            const radius = float(LOCK_REACH).mul(float(1.0).sub(exp(age.div(-LOCK_TAU))));
            const o = vec2(p.x.sub(A.x), p.z.sub(A.y.add(u.scroll)));
            const d = length(o);
            const x = d.sub(radius);
            const env = exp(age.mul(-LOCK_FADE)).mul(step(0.0, age)).mul(A.w);
            const front = ndBell(x.div(0.9)).add(ndBell(x.add(1.7).div(2.6)).mul(0.2));
            ring.addAssign(u.lockC[i].mul(front.mul(env)));
            const wave = sin(x.mul(1.9)).mul(exp(x.mul(x).mul(-0.11))).mul(env);
            ringSlope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.5));
        }
        const clear = ndClearLight(u, p.z).toVar();
        const light = u.hazeLow.mul(1.3).add(vec3(0.03, 0.035, 0.05))
            .add(glow.mul(1.5))
            .add(lampCol.mul(pool).mul(1.35))
            .add(ring.mul(2.4))
            .add(clear.rgb.mul(1.3));
        // ── Kerb light strips: a dim dashed run at rest, chasing faster as the district charges;
        // a lock sends a comet along them, a clear lights them as its fronts pass ──
        const kerbX = float(STREET.halfRoad + 0.16);
        const led = stripe(ax, kerbX, float(0.04), fx.add(0.004)).mul(step(fract(zl.div(1.6)), 0.72));
        const chase = smoothstep(0.7, 1.0, fract(zl.mul(14 / STREET.period).add(u.time.mul(u.power.mul(1.5).add(0.22)))));
        const ledLight = mix(u.accentA, u.accentB, step(0.0, p.x)).mul(chase.mul(1.1).add(0.3).add(u.power.mul(0.7))).toVar();
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const A = u.lockA[i];
            const age = u.time.sub(A.z);
            const run = age.mul(62.0);
            const dz = abs(p.z.sub(A.y.add(u.scroll)));
            const comet = exp(run.sub(dz).mul(-0.15)).mul(step(dz, run)).mul(exp(age.mul(-1.3))).mul(step(0.0, age))
                .mul(A.w);
            ledLight.addAssign(u.lockC[i].mul(comet).mul(3.0));
        }
        ledLight.addAssign(clear.rgb.mul(2.4));
        ledLight.mulAssign(clear.w.mul(0.6).add(1.0).mul(u.neon));
        const spill = exp(abs(ax.sub(kerbX)).mul(-2.4)).mul(0.1);
        const diffuse = albedo.mul(light.add(ledLight.mul(spill))).mul(mix(float(1.0), float(0.55), puddle));

        // ── The water's slope: grain, rain rings, lock rings ──
        const slope = nC.rg.sub(0.5).mul(rough.mul(0.9).add(0.04)).toVar();
        const glint = float(0.0).toVar();
        if (withRings) {
            const wetArea = puddle.mul(0.85).add(0.15).mul(near).mul(u.rain);
            const r1 = rainRings(st, u.time, float(0.62), float(0.9));
            const r2 = rainRings(st.add(vec2(3.7, 1.9)), u.time, float(1.05), float(0.63));
            slope.addAssign(r1.xy.add(r2.xy).mul(0.42).mul(wetArea));
            glint.assign(r1.z.add(r2.z).mul(wetArea));
        }
        slope.addAssign(ringSlope);

        // ── The mirror ──
        const cosT = clamp(V.y.negate(), 0.0, 1.0);
        const fres = float(0.03).add(float(0.97).mul(pow(float(1.0).sub(cosT), 5.0)));
        const mirror = vec3(0.0).toVar();
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.09).add(1.0));
            const ruv = screenUV.flipX().add(vec2(slope.x, slope.y.mul(1.6)).mul(reach).mul(0.2)).toVar();
            const lod = rough.mul(5.6);
            // Wet asphalt drags every light into a long vertical streak.
            const run = rough.mul(0.07).add(0.004);
            const jitter = nC.a.sub(0.5).mul(run).mul(0.6);
            const tap = (o) => reflection.sample(ruv.add(vec2(0.0, run.mul(o).add(jitter)))).level(lod).rgb;
            if (taps >= 5) {
                mirror.assign(tap(0).mul(0.3).add(tap(1).add(tap(-1)).mul(0.22)).add(tap(2.3).add(tap(-2.3)).mul(0.13)));
            } else if (taps >= 3) {
                mirror.assign(tap(0).mul(0.44).add(tap(1.4).add(tap(-1.4)).mul(0.28)));
            } else {
                mirror.assign(tap(0));
            }
        } else {
            // No second render: the wet road returns the glow map, dragged into streaks, and the
            // haze the mirrored view ray ends in.
            const drag = u.noise(vec2(p.x.mul(0.55).add(slope.x.mul(4.0)), zl.mul(11 / STREET.period))).r;
            const streaks = smoothstep(0.42, 0.9, drag);
            const mirrored = vec3(rel.x, rel.y.negate(), rel.z);
            // Mostly the dark of the walls, with the signs dragged down into it here and there.
            mirror.assign(glow.mul(streaks.mul(streaks).mul(1.5).add(0.05))
                .add(ndHaze(u, mirrored).mul(0.35))
                .add(lampCol.mul(pool).mul(0.22)));
        }
        const gloss = mix(float(0.62), float(1.0), puddle);
        const col = diffuse.mul(float(1.0).sub(fres.mul(0.6)))
            .add(mirror.mul(fres).mul(gloss))
            .toVar();
        // Rain glints, and the pulses riding the water itself.
        col.addAssign(glow.add(lampCol.mul(pool)).add(0.05).mul(glint).mul(1.4));
        col.addAssign(ring.mul(puddle.mul(0.7).add(0.3)).mul(1.7));
        col.addAssign(clear.rgb.mul(puddle.mul(0.5).add(0.5)).mul(0.5));
        col.addAssign(ledLight.mul(led).mul(1.5));
        return ndAtmosphere(u, col, p);
    })();

    const geometry = new THREE.PlaneGeometry(320, 340, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -140);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDistrictStreet';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = -10;
    return {
        mesh, material, geometry, reflection, reflectorTarget: reflection ? reflection.target : null,
    };
}
