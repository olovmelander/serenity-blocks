/**
 * Ice Temple — the frozen lake the temple stands on.
 *
 * Black ice, a metre and a half of it, clear enough to see down into. Cracks run through it as
 * they do through lake ice: big plates, and finer cracks inside the plates. A crack is a wall
 * standing in the ice, so it is drawn as one: the surface line is a Voronoi cell wall (F2 − F1),
 * and below it the view ray, refracted into the ice, is tested for the depth at which it crosses
 * that same wall (the sites of the cell at the surface and of the cell at the ray's deep end give
 * the wall in closed form). The result is a continuous white curtain hanging under every crack,
 * with true parallax, for two Voronoi lookups instead of a stack of layers. Frozen bubbles hang
 * in columns under the plates; wind-combed snow lies on top and takes the moon, striped by the
 * shadows of the colonnade.
 *
 * On the showcase tiers the temple and the aurora stand upside down in it (a planar reflector()
 * at reduced resolution); lower tiers mirror the analytic sky instead.
 *
 * Gameplay writes into the ice: a locking piece strikes it — a star fracture, a bloom of frost,
 * and a ring of light that runs out through the cracks — a clear rolls light up the nave through
 * them, and a combo keeps the cracks around the board lit.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    positionWorld,
    pow,
    reflector,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    LOCK_FADE,
    LOCK_REACH,
    LOCK_SCAR,
    LOCK_SLOTS,
    LOCK_TAU,
    NAVE,
    STAR_RAYS,
    TAU,
    itAtmosphere,
    itBell,
    itClearLight,
    itHash11,
    itHash21,
    itHash22,
    itHeartLight,
    itLobes,
    itMax3,
    itMoonDir,
    itMoonShadow,
    itPart,
    itResonance,
    itSky,
    itVoronoi,
} from './ice-temple-tsl.js';

/** Metres of clear ice the eye can see down into. */
export const ICE_DEPTH = 1.5;
/** Size of the big plates and of the cracks inside them (metres). */
export const PLATE_SIZE = 5.2;
export const FINE_SIZE = 1.35;

/**
 * One crack network at the scale `size`: (surface line, curtain below it, plate hash).
 * `q0` is the surface point, `q1` the point the refracted view ray reaches at `depth`.
 */
const crackWalls = /* @__PURE__ */ Fn(([q0, q1, pixel]) => {
    const a = itVoronoi(q0);
    const b = itVoronoi(q1);
    // The surface line, kept at least a pixel wide so it never crawls.
    const e = a.w.sub(a.z).mul(0.5);
    const w = max(pixel.mul(0.75), 0.004);
    const line = float(1.0).sub(smoothstep(w, w.mul(2.2).add(0.004), e));
    // Where the ray crosses the wall between the two cells, as a fraction of its run.
    const sa = a.xy;
    const sb = b.xy;
    const different = step(1e-3, length(sb.sub(sa)));
    const da = q0.sub(sa);
    const db = q0.sub(sb);
    const f0 = dot(da, da).sub(dot(db, db));
    const denom = dot(q1.sub(q0), sb.sub(sa)).mul(2.0);
    const t = clamp(f0.negate().div(max(denom, 1e-4)), 0.0, 1.0);
    const curtain = different.mul(exp(t.mul(-2.4))).mul(float(1.0).sub(smoothstep(0.7, 1.0, t)));
    return vec3(line, curtain, itHash21(floor(sa.mul(7.0))));
}).setLayout({
    name: 'it_crackWalls',
    type: 'vec3',
    inputs: [{ name: 'q0', type: 'vec2' }, { name: 'q1', type: 'vec2' }, { name: 'pixel', type: 'float' }],
});

/** Frozen bubbles: one disc per cell, per layer. Returns its brightness. */
const bubbleLayer = /* @__PURE__ */ Fn(([q, layer]) => {
    const id = floor(q);
    const h = itHash22(id.add(layer.mul(19.7)));
    const centre = h.mul(0.6).add(0.2);
    const r = itHash21(id.add(layer.mul(3.1)).add(71.0)).mul(0.2).add(0.06);
    const d = length(fract(q).sub(centre));
    // Only some cells hold a bubble; neighbouring layers share cells, so bubbles stack.
    const has = step(0.62, itHash21(id.add(13.0)));
    const disc = float(1.0).sub(smoothstep(r.mul(0.72), r, d));
    const rimLight = smoothstep(r.mul(0.45), r.mul(0.9), d).mul(0.6).add(0.4);
    return disc.mul(rimLight).mul(has);
}).setLayout({
    name: 'it_bubbleLayer',
    type: 'float',
    inputs: [{ name: 'q', type: 'vec2' }, { name: 'layer', type: 'float' }],
});

/**
 * @param {object} u  shared temple uniforms
 * @param {object} [opts]
 * @param {number} [opts.reflectionScale=0]  reflector resolution scale (0 = mirror the analytic sky)
 * @param {boolean} [opts.fineCracks=true]   the cracks inside the plates
 * @param {number} [opts.bubbles=3]          layers of frozen bubbles (0 = none)
 * @returns {{ mesh: THREE.Mesh, material: THREE.Material, geometry: THREE.BufferGeometry,
 *   reflection: object|null, reflectorTarget: THREE.Object3D|null }}
 */
export function createFloor(u, opts = {}) {
    const reflectionScale = opts.reflectionScale ?? 0;
    const fineCracks = opts.fineCracks !== false;
    const bubbles = Math.max(0, Math.min(3, opts.bubbles ?? 3));
    const reflection = reflectionScale > 0
        ? reflector({ resolutionScale: reflectionScale, bounces: false, generateMipmaps: true })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'IceTempleReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'IceTempleFloor';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const Vd = rel.div(max(dist, 1e-3)).toVar();
        const st = p.xz.toVar();
        // Screen-space footprint of a metre of ice (fwidth up front: uniform control flow).
        const pixel = max(fwidth(p.x), fwidth(p.z)).toVar();

        const nA = u.noise(st.mul(0.013)).toVar();
        const nB = u.noise(st.mul(0.071).add(vec2(0.31, 0.77))).toVar();
        const nC = u.noise(st.mul(0.53)).toVar();

        // ── The ray going down into the ice (Snell, n = 1.31) ──
        const cosI = clamp(Vd.y.negate(), 0.02, 1.0);
        const sinT2 = float(1.0).sub(cosI.mul(cosI)).mul(0.5827);
        const cosT = sqrt(float(1.0).sub(sinT2));
        // Metres the ray slides sideways for every metre it sinks.
        const slide = Vd.xz.mul(0.7634).div(cosT).toVar();

        // ── Cracks: plates, and the finer cracks inside them ──
        const warp = nA.rg.sub(0.5).mul(5.0).add(nB.rg.sub(0.5).mul(0.9));
        const base = st.add(warp).toVar();
        // The plates are stretched a little across the nave: long cracks run its length.
        const plateScale = vec2(1 / PLATE_SIZE, 0.72 / PLATE_SIZE);
        const q0 = base.mul(plateScale);
        const q1 = base.add(slide.mul(ICE_DEPTH)).mul(plateScale);
        const plates = crackWalls(q0, q1, pixel.div(PLATE_SIZE)).toVar();
        const cracks = plates.x.toVar();
        const curtain = plates.y.toVar();
        if (fineCracks) {
            // Not every plate is shattered: the fine cracks come and go, and far off they are
            // finer than a pixel. Where there are none, the second pair of lookups is skipped.
            const where = smoothstep(0.42, 0.62, nB.b).mul(float(1.0).sub(smoothstep(0.012, 0.05, pixel))).toVar();
            If(where.greaterThan(0.01), () => {
                const f0 = base.add(vec2(17.3, 5.1)).div(FINE_SIZE);
                const f1 = base.add(vec2(17.3, 5.1)).add(slide.mul(ICE_DEPTH * 0.3)).div(FINE_SIZE);
                const fine = crackWalls(f0, f1, pixel.div(FINE_SIZE));
                cracks.assign(max(cracks, fine.x.mul(where).mul(0.55)));
                curtain.assign(max(curtain, fine.y.mul(where).mul(0.35)));
            });
        }
        // A fracture wall is not smooth: it glitters along its run.
        curtain.mulAssign(nC.r.mul(0.7).add(0.55));

        // ── Frozen bubbles, in stacks: under some plates only, and only where they can be seen ──
        const bubble = float(0.0).toVar();
        if (bubbles > 0) {
            const some = smoothstep(0.5, 0.68, nB.a).mul(float(1.0).sub(smoothstep(0.02, 0.07, pixel))).toVar();
            If(some.greaterThan(0.01), () => {
                for (let i = 0; i < bubbles; i++) {
                    const d = 0.18 + i * 0.3;
                    const q = base.add(slide.mul(d)).div(0.42 - i * 0.05);
                    bubble.addAssign(bubbleLayer(q, float(i)).mul(1 - i * 0.26));
                }
                bubble.mulAssign(some);
            });
        }

        // ── The light on and in the ice ──
        const moonDir = itMoonDir();
        const shadow = itMoonShadow(p).toVar();
        const moon = u.moonColor.mul(u.ambient).mul(shadow).mul(moonDir.y).toVar();
        const heart = itHeartLight(u, p).toVar();
        const sky = u.skyHorizon.mul(u.ambient).mul(1.4).add(u.auroraA.mul(u.auroraGain).mul(0.03)).toVar();
        const ambient = moon.mul(0.9).add(heart.mul(0.5)).add(sky).toVar();

        // ── Gameplay, written into the ice ──
        const ring = vec3(0.0).toVar();
        const star = vec3(0.0).toVar();
        const bloom = float(0.0).toVar();
        const powder = vec3(0.0).toVar();
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const A = u.lockA[i];
            const C = u.lockC[i];
            const age = u.time.sub(A.z);
            // A slot that has healed costs nothing: the branch depends on uniforms only.
            If(age.greaterThan(0.0).and(age.lessThan(LOCK_SCAR * 3)).and(A.w.greaterThan(0.0)), () => {
                const live = A.w;
                const o = st.sub(A.xy);
                const d = length(o);
                // The ring of light running out through the ice.
                const radius = float(LOCK_REACH).mul(float(1.0).sub(exp(age.div(-LOCK_TAU))));
                const x = d.sub(radius);
                const env = exp(age.mul(-LOCK_FADE)).mul(live);
                ring.addAssign(C.mul(itBell(x.div(0.85)).add(itBell(x.add(1.6).div(2.6)).mul(0.22))).mul(env));
                // The blow itself, glowing under the surface.
                ring.addAssign(C.mul(exp(d.mul(d).mul(-0.3))).mul(exp(age.mul(-3.4))).mul(live).mul(1.4));
                // The star fracture: rays from the blow, each its own length, each a little crooked.
                const turn = atan(o.y, o.x).div(TAU).mul(STAR_RAYS).add(itHash11(A.z.mul(13.7)));
                const id = floor(turn);
                const crook = u.noise(vec2(d.mul(0.09).add(id.mul(0.37)), A.z.mul(0.11))).r.sub(0.5).mul(0.42);
                const perp = abs(fract(turn).sub(0.5).add(crook)).mul(d).mul(TAU / STAR_RAYS);
                const reach = itHash11(id.add(A.z.mul(5.3))).mul(4.6).add(1.6).mul(A.w)
                    .mul(float(1.0).sub(exp(age.mul(-16.0))));
                const ray = float(1.0).sub(smoothstep(pixel.add(0.008), pixel.mul(2.2).add(0.03), perp))
                    .mul(step(d, reach))
                    .mul(float(1.0).sub(smoothstep(reach.mul(0.55), reach, d)).mul(0.8).add(0.2));
                const scar = exp(age.mul(-6.0)).mul(3.2).add(exp(age.mul(-3.0 / LOCK_SCAR)).mul(0.42));
                star.addAssign(mix(C, vec3(1.0), 0.45).mul(ray).mul(scar).mul(live));
                // Frost blooms round the blow and sublimes.
                const patch = float(1.0).sub(smoothstep(0.4, A.w.mul(1.9).add(0.6), d.add(nC.g.sub(0.5).mul(1.1))));
                bloom.addAssign(patch.mul(exp(age.mul(-0.75))).mul(float(1.0).sub(exp(age.mul(-9.0)))).mul(live));
                // The blow lifts the loose snow off the ice: a ragged ring of powder, running out low.
                const puffR = A.w.mul(7.5).mul(float(1.0).sub(exp(age.mul(-4.2))));
                const puff = itBell(d.sub(puffR).div(A.w.mul(1.5).add(0.5)))
                    .mul(smoothstep(0.25, 0.75, nC.a.mul(0.6).add(nB.r.mul(0.6))))
                    .mul(exp(age.mul(-3.4)))
                    .mul(live);
                powder.addAssign(mix(vec3(0.8, 0.9, 1.0), C, 0.35).mul(puff).mul(0.45));
            });
        }
        // Several blows at once must not white the lake out.
        powder.assign(powder.div(itMax3(powder).mul(0.9).add(1.0)));
        const clear = itClearLight(u, p.z).toVar();
        // The cracks round the board stay lit while the chain holds.
        const fromBoard = length(st.sub(u.focus));
        const held = itResonance(u, p)
            .mul(float(1.0).sub(smoothstep(u.resRadius.mul(0.55), u.resRadius.add(0.01), fromBoard)));
        const pulse = ring.mul(1.9).add(clear.rgb.mul(1.5)).add(held.mul(0.8))
            .add(u.heartColor.mul(clear.w).mul(0.06))
            .toVar();

        // ── What lies under the surface ──
        const plateTone = plates.z.mul(0.5).add(0.75);
        const deep = vec3(0.012, 0.085, 0.14).mul(plateTone).mul(nA.b.mul(0.8).add(0.6));
        const walls = curtain.mul(0.85).add(bubble.mul(0.3));
        const under = deep.mul(ambient.mul(2.2).add(pulse.mul(0.5)))
            .add(vec3(0.62, 0.86, 1.0).mul(walls).mul(ambient.mul(1.5).add(pulse.mul(2.6))))
            .toVar();

        // ── What lies on it: the crack's lip, wind-combed snow, frost ──
        const combed = u.noise(vec2(st.x.mul(0.034).add(st.y.mul(0.011)), st.y.mul(0.21))).r;
        const drift = smoothstep(0.6, 0.84, combed.mul(0.75).add(nB.g.mul(0.35)).add(nA.a.mul(0.12)))
            .mul(smoothstep(-0.2, 0.25, nA.g.sub(0.35)));
        const snow = clamp(drift.add(bloom.mul(0.9)), 0.0, 1.0).toVar();
        const cell = floor(st.mul(55.0));
        const spark = step(0.985, itHash21(cell))
            .mul(pow(sin(dot(Vd.xz, vec2(37.0, 23.0)).add(itHash21(cell.add(5.0))).mul(TAU)).mul(0.5).add(0.5), 8.0))
            .mul(float(1.0).sub(smoothstep(0.01, 0.04, pixel)));
        const snowLight = moon.mul(1.05).add(heart.mul(0.35)).add(sky.mul(1.4)).add(pulse.mul(0.8));
        const snowCol = snowLight.mul(vec3(0.84, 0.92, 1.0)).mul(nC.b.mul(0.3).add(0.8))
            .mul(spark.mul(6.0).add(1.0));
        const lip = cracks.mul(float(1.0).sub(snow));

        // ── The mirror ──
        const fres = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(cosI), 5.0)));
        const ripple = nC.rg.sub(0.5).mul(0.003).add(nB.rg.sub(0.5).mul(0.006));
        const mirror = vec3(0.0).toVar();
        if (reflection) {
            const reach = float(1.0).div(dist.mul(0.05).add(1.0));
            const ruv = screenUV.flipX().add(vec2(ripple.x, ripple.y.mul(1.5)).mul(reach));
            mirror.assign(reflection.sample(ruv).level(snow.mul(4.0)).rgb);
        } else {
            const Rl = vec3(Vd.x.add(ripple.x), Vd.y.negate(), Vd.z.add(ripple.y));
            mirror.assign(itSky(u, Rl).add(itLobes(u, p, Rl)));
        }

        const col = under.mul(float(1.0).sub(fres))
            .add(mirror.mul(fres))
            .toVar();
        col.assign(mix(col, snowCol, snow.mul(0.92)));
        // The crack's lip is white where the light finds it, and burns with every pulse.
        col.addAssign(vec3(0.7, 0.9, 1.0).mul(lip).mul(ambient.mul(1.1).add(pulse.mul(3.2))));
        col.addAssign(star.mul(float(1.0).sub(snow.mul(0.5))));
        col.addAssign(powder.mul(ambient.mul(1.4).add(0.35)));
        return itAtmosphere(u, col, p);
    })();

    const geometry = new THREE.CircleGeometry(NAVE.lakeRadius, 48);
    geometry.rotateX(-Math.PI / 2);
    const part = itPart('IceTempleFloor', geometry, material, 2, true);
    part.reflection = reflection;
    part.reflectorTarget = reflection ? reflection.target : null;
    return part;
}
