/**
 * Thermal Bloom — the T-spin's steam devils (iris-springs.md §1.5, §3.11): one to three slender
 * whirls of steam that spin up off the Iris's rim and wander toward the card's side for 5–7 s,
 * never orbiting the card; under reduced motion they turn in place. Each is an open lathe (the
 * tier's devil grid) on its row pair of the event table — (x, z, start, life) and (height,
 * radius, seed, unused) — written each frame by the world from its closed-form path.
 *
 * The shape: a narrow foot that flares into a funnel, swaying sinuously up its height; the
 * density spirals round it (noise in θ + twist·h − spin·t), thick in a core seen through the
 * middle and ragged at its rim, fading in at its birth and out at its end. Lit like the steam:
 * Steam Pearl on the sun's side, blue-grey in shade; underlit turquoise at its core and apricot
 * at its hem from the bands it crosses. Premultiplied over the scene; never emissive.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    dot,
    float,
    int,
    length,
    max,
    mix,
    normalize,
    pow,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EVENT_ROWS,
    EVENT_SLOTS,
    tbAerial,
    tbFxMaterial,
    tbPart,
} from './thermal-bloom-tsl.js';

const TAU = Math.PI * 2;
/** Turns of the spiral up a devil's height, and its spin (radians a second). */
const TWIST = 3.2;
const SPIN = 7.0;
/** How far a devil leans downwind (metres per metre of its height). */
const LEAN = 0.22;

/**
 * The devils: `EVENT_SLOTS.devils` lathes of the tier's grid in one geometry.
 * @param {object} u    the shared uniforms
 * @param {object} tier the quality tier
 * @param {object} tex  the world's baked textures
 */
export function createDevils(u, tier, tex) {
    const [segs, rings] = tier.devilMesh;
    const slots = EVENT_SLOTS.devils;
    const positions = [];
    const meta = [];
    const index = [];
    for (let s = 0; s < slots; s++) {
        const first = positions.length / 3;
        for (let j = 0; j <= rings; j++) {
            for (let i = 0; i <= segs; i++) {
                positions.push(i / segs, j / rings, 0);
                meta.push(s);
            }
        }
        for (let j = 0; j < rings; j++) {
            for (let i = 0; i < segs; i++) {
                const a = first + j * (segs + 1) + i;
                const b = a + segs + 1;
                index.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aDevil', new THREE.Float32BufferAttribute(meta, 1));
    geometry.setIndex(index);

    const aDevil = attribute('aDevil', 'float');
    const rowA = (slot) => u.events.element(int(slot.add(0.5)).mul(2).add(EVENT_ROWS.devils));
    const rowB = (slot) => u.events.element(int(slot.add(0.5)).mul(2).add(EVENT_ROWS.devils + 1));
    const A = rowA(aDevil);
    const B = rowB(aDevil);
    const age = u.time.sub(A.z);
    const live = step(0.0, age).mul(step(age, A.w)).mul(step(0.5, B.x)).mul(step(aDevil.add(0.5), float(u.devilCount)));
    const h01 = positionGeometry.y;
    const theta = positionGeometry.x.mul(TAU);
    // The axis leans downwind as the whirl climbs and sways sinuously in time; the foot stays put.
    const sway = vec2(
        sin(h01.mul(4.1).add(u.time.mul(1.3)).add(B.z.mul(6.0))),
        cos(h01.mul(3.3).sub(u.time.mul(1.1)).add(B.z.mul(4.0))),
    ).mul(h01.mul(B.y).mul(0.7));
    const lean = u.windDir.mul(h01.mul(B.x).mul(LEAN));
    // A narrow foot flaring into a funnel, its wall bulging where the helix winds; it swells in at
    // birth and out at its end.
    const grow = smoothstep(0.0, 0.8, age).mul(float(1.0).sub(smoothstep(A.w.sub(1.2), A.w, age)));
    const bulge = sin(h01.mul(9.0).sub(u.time.mul(3.0)).add(theta.mul(2.0))).mul(0.12).add(1.0);
    const r = B.y.mul(float(0.45).add(h01.pow(1.2).mul(0.7))).mul(grow.mul(0.6).add(0.4)).mul(bulge);
    const vH01 = varying(h01, 'vDevilH');
    const vTheta = varying(positionGeometry.x, 'vDevilTheta');
    const vSlot = varying(aDevil, 'vDevilSlot');
    // The wall's outward normal (the swayed, leaning axis is the lathe's own, so this is exact).
    const vNormal = varying(vec2(cos(theta), sin(theta)), 'vDevilNormal');

    // Front faces only, like the columns: the core's thickness term stands for the depth.
    const material = tbFxMaterial('ThermalBloomDevils', { side: THREE.FrontSide });
    material.positionNode = Fn(() => {
        const c = A.xy.add(sway).add(lean);
        const y = h01.mul(B.x).mul(grow.mul(0.5).add(0.5));
        const p = vec3(c.x.add(cos(theta).mul(r)), y, c.y.add(sin(theta).mul(r)));
        return mix(vec3(0.0, -1e5, 0.0), p, live);
    })();
    const devilFn = Fn(() => {
        const Ad = rowA(vSlot);
        const Bd = rowB(vSlot);
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const ageF = u.time.sub(Ad.z);
        const fade = smoothstep(0.0, 0.8, ageF).mul(float(1.0).sub(smoothstep(Ad.w.sub(1.5), Ad.w, ageF)));
        // The helix: two strands of denser steam wound up the whirl and spinning, warped and torn by
        // the noise so they wander in width and pitch (a whirl, never a barber's pole).
        const spiral = vTheta.add(vH01.mul(TWIST)).sub(u.time.mul(SPIN / TAU)).add(Bd.z).toVar();
        const n = texture(tex.noise, vec2(spiral.mul(2.0), vH01.mul(1.5).sub(u.time.mul(0.4))).div(4.0)).x;
        const fine = texture(tex.noise, vec2(spiral.mul(5.0), vH01.mul(4.0)).div(16.0)).z;
        const warp = texture(tex.noise, vec2(vTheta.mul(1.0).add(Bd.z), vH01.mul(0.9).sub(u.time.mul(0.3)))).y;
        const strands = sin(spiral.add(warp.sub(0.5).mul(0.9)).mul(TAU * 2.0)).mul(0.5).add(0.5);
        const nrm = normalize(vNormal.add(vec2(1e-4, 0.0))).toVar();
        const facing = abs(dot(nrm, normalize(V.xz.add(vec2(0.0, 1e-4))))).toVar();
        // A dense core seen through the middle, a soft rim torn by the noise; the helix bands the
        // body (denser and thinner turns wound up it), never cuts it into blades.
        const core = smoothstep(0.05, 0.6, facing).toVar();
        const rim = pow(smoothstep(0.0, 0.9, facing.add(n.sub(0.5).mul(0.35))), 0.8);
        const helix = smoothstep(0.2, 0.9, strands.mul(0.5).add(n.mul(0.32)).add(fine.mul(0.18)));
        const body = rim.mul(helix.mul(0.6).add(0.4)).mul(core.mul(0.3).add(0.7));
        // (its crown frays out into the air, never a cut)
        const top = smoothstep(0.6, 1.0, vH01.add(n.sub(0.5).mul(0.45)).add(fine.sub(0.5).mul(0.2)));
        const ends = smoothstep(0.0, 0.1, vH01).mul(float(1.0).sub(top));
        const alpha = clamp(body.mul(ends).mul(fade).mul(0.95), 0.0, 0.9).toVar();
        alpha.lessThan(0.003).discard();
        // Light: pearl toward the sun, blue-grey in shade, split on the whirl's form.
        const lit = smoothstep(-0.3, 0.6, dot(normalize(vec3(nrm.x, 0.25, nrm.y)), u.sunDir));
        const pearl = u.sunColor.mul(0.76).add(mix(u.haze, u.zenith, 0.5).mul(0.1));
        const shade = vec3(0.34, 0.43, 0.56).mul(mix(float(0.85), float(1.0), u.sunColor.y));
        // (the turns catch the light; the gaps between them are the whirl's shaded inside)
        const col = mix(shade, pearl, lit.mul(helix.mul(0.35).add(0.65))).mul(helix.mul(0.12).add(0.9)).toVar();
        // Coloured from beneath by the bands it crosses: a turquoise core over the deep water, an
        // apricot hem off the mats at its foot.
        const coreTint = core.mul(smoothstep(0.04, 0.22, vH01)).mul(float(1.0).sub(smoothstep(0.35, 0.85, vH01)));
        const hem = float(1.0).sub(smoothstep(0.12, 0.5, vH01.add(n.sub(0.5).mul(0.15))));
        col.assign(mix(col, vec3(0.26, 0.64, 0.64).mul(u.sunColor.y.mul(0.3).add(0.7)), coreTint.mul(0.55)));
        col.assign(mix(col, vec3(0.88, 0.55, 0.3).mul(u.sunColor.y.mul(0.3).add(0.7)), hem.mul(0.75)));
        const out = tbAerial(u, col, dist, V.negate());
        return vec4(out.mul(alpha), alpha);
    });
    material.colorNode = devilFn();
    const part = tbPart('ThermalBloomDevils', geometry, material, 61);
    part.slots = slots;
    return part;
}
