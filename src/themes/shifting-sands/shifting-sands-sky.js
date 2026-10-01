/**
 * Shifting Sands — the sky dome: one opaque BackSide sphere shaded per pixel by view direction.
 *
 *  - the shared atmosphere gradient (hot apricot band toward the suns → dusty rose away from
 *    them → violet upper sky → deep blue zenith) and the suns' Mie glow;
 *  - faint crepuscular rays fanning from the primary sun;
 *  - high cirrus streaks on an altitude plane, lit gold-pink from below near the suns and dusky
 *    mauve away from them, drifting with the wind;
 *  - the twin suns: an ember-gold primary with limb darkening and a white-gold companion;
 *  - the two moons of Arrakis: shaded spheres lit by the primary sun (thick crescents, the dark
 *    limb faintly lit by dust-glow), veiled by the haze;
 *  - stars that surface as the dusk deepens (one hash per pixel cell, no extra draw).
 *
 * Drawn after the opaque world (renderOrder) with depthWrite off, so early-z rejects every pixel
 * the dunes, rocks and worm already cover: the sky only pays for the sky it shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    cameraPosition,
    clamp,
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
    positionWorld,
    pow,
    smoothstep,
    sqrt,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { ssHash21, ssPhaseHG, ssTexNoise } from './shifting-sands-tsl.js';

export const SKY_RADIUS = 20000;

/** A shaded moon disc at direction M with angular radius r (radians). Returns vec4(rgb, mask). */
function moonDisc(dir, M, r, uSunA, noiseTex, seed) {
    const c = dot(dir, M);
    const perp = dir.sub(M.mul(c));
    const t = perp.div(r);
    const t2 = dot(t, t);
    const edge = fwidth(t2).add(1e-4);
    const mask = float(1.0).sub(smoothstep(float(1.0).sub(edge.mul(1.5)), float(1.0).add(edge), t2))
        .mul(smoothstep(0.0, 0.2, c));
    const n = normalize(t.sub(M.mul(sqrt(max(float(1.0).sub(t2), 0.0)))));
    const lit = clamp(dot(n, uSunA).mul(1.6), 0.0, 1.0);
    // Maria: two noise channels on the disc.
    const m = ssTexNoise(noiseTex, t.xy.add(t.z).mul(2.6).add(seed));
    const maria = smoothstep(0.35, 0.65, m.x.mul(0.7).add(m.y.mul(0.3)));
    const albedo = mix(vec3(0.62, 0.55, 0.48), vec3(0.86, 0.8, 0.7), maria);
    const limb = mix(0.75, 1.0, sqrt(max(float(1.0).sub(t2), 0.0)));
    const col = albedo.mul(lit.mul(limb).mul(1.9).add(0.02));
    return vec4(col, mask);
}

/**
 * @param {object} shared world uniforms + atmosphere + noise texture
 * @param {object} opts
 * @param {boolean} [opts.clouds=true]
 * @param {boolean} [opts.stars=true]
 * @param {THREE.Vector3} opts.moonA / opts.moonB directions; opts.moonRadA/moonRadB (radians)
 * @param {number} opts.sunRadA / opts.sunRadB  angular radii (radians)
 */
export function createSky(shared, opts) {
    const {
        uTime, uSunA, uSunB, uSunLightA, uSunLightB, uDusk, uSunFlare, atmosphere, noiseTex, uWindDir,
    } = shared;
    const clouds = opts.clouds !== false;
    const stars = opts.stars !== false;
    const { uMoonA } = opts;
    const { uMoonB } = opts;
    const { sunRadA } = opts;
    const { sunRadB } = opts;

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    material.name = 'shifting-sands-sky';
    material.fog = false;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const el = dir.y;
        const col = atmosphere.skyGradient(dir).toVar();

        // ── Crepuscular rays: an angular modulation of the primary sun's glow ──
        const right = normalize(cross(uSunA, vec3(0.0, 1.0, 0.0)));
        const upv = cross(right, uSunA);
        const tp = dir.sub(uSunA.mul(dot(dir, uSunA)));
        const ang = atan(dot(tp, upv), dot(tp, right));
        const rayN = ssTexNoise(noiseTex, vec2(ang.mul(9.0), uTime.mul(0.015)));
        const rays = rayN.x.mul(0.65).add(rayN.y.mul(0.35));
        const cA = dot(dir, uSunA);
        const rayFall = smoothstep(0.93, 0.997, cA).mul(smoothstep(-0.04, 0.05, el))
            .mul(float(1.0).sub(smoothstep(0.1, 0.3, el)));
        col.addAssign(uSunLightA.mul(smoothstep(0.35, 0.85, rays).mul(rayFall).mul(0.035)));

        // ── Stars (deepening dusk) ──
        if (stars) {
            const sp = vec2(atan(dir.x, dir.z.negate()), el).mul(vec2(160.0, 160.0));
            const cell = floor(sp);
            const h = ssHash21(cell);
            const off = vec2(ssHash21(cell.add(7.7)), ssHash21(cell.add(13.1))).mul(0.6).add(0.2);
            const fw = fwidth(sp.x).add(fwidth(sp.y)).mul(0.5);
            const dotS = float(1.0).sub(smoothstep(fw.mul(0.5), fw.mul(1.4), length(fract(sp).sub(off))));
            const bright = smoothstep(0.985, 1.0, h).mul(smoothstep(0.08, 0.5, el));
            const tw = float(0.75).add(float(0.25).mul(fract(h.mul(91.7).add(uTime.mul(0.6))).sub(0.5).abs().mul(2.0)));
            col.addAssign(vec3(0.9, 0.92, 1.0).mul(dotS.mul(bright).mul(tw).mul(uDusk.mul(0.9).add(0.12)).mul(1.4)));
        }

        // ── Moons (veiled by the lower atmosphere) ──
        const veil = smoothstep(0.02, 0.45, el).mul(0.55).add(0.25).mul(mix(0.75, 1.15, uDusk));
        const mA = moonDisc(dir, uMoonA, opts.moonRadA, uSunA, noiseTex, vec2(3.1, 7.4));
        const mB = moonDisc(dir, uMoonB, opts.moonRadB, uSunA, noiseTex, vec2(11.7, 2.9));
        col.assign(mix(col, col.mul(0.82).add(mA.xyz.mul(veil)), mA.w));
        col.assign(mix(col, col.mul(0.82).add(mB.xyz.mul(veil)), mB.w));

        // ── High cirrus on an altitude plane ──
        if (clouds) {
            const q = dir.xz.div(max(el, 0.035)).toVar();
            const drift = uWindDir.mul(uTime.mul(0.004));
            // Stretch the wisps along the wind.
            const along = dot(q, uWindDir);
            const across = dot(q, vec2(uWindDir.y.negate(), uWindDir.x));
            const sq = vec2(along.mul(0.55), across.mul(2.4)).add(drift.mul(vec2(1.0, 0.0)));
            const n1 = ssTexNoise(noiseTex, sq.mul(1.1).add(vec2(4.3, 1.7)));
            const n2 = ssTexNoise(noiseTex, sq.mul(3.7).add(vec2(n1.z.mul(1.6), 9.2)));
            const dens = smoothstep(0.5, 0.86, n1.x.mul(0.62).add(n2.y.mul(0.38))).toVar();
            dens.mulAssign(smoothstep(0.03, 0.16, el).mul(float(1.0).sub(smoothstep(0.55, 0.9, el))));
            const fwdA = ssPhaseHG(cA, float(0.72));
            const fwdB = ssPhaseHG(dot(dir, uSunB), float(0.75));
            const rim = uSunLightA.mul(fwdA.mul(0.11).add(0.05)).add(uSunLightB.mul(fwdB.mul(0.05)));
            const dusky = mix(vec3(0.26, 0.17, 0.22), vec3(0.42, 0.24, 0.2), atmosphere.towardSunA(dir));
            const cloudCol = dusky.mul(0.55).add(rim.mul(mix(0.55, 1.0, n2.x)));
            col.assign(mix(col, cloudCol, dens.mul(0.7)));
        }

        // ── The twin suns ──
        const angA = sqrt(max(float(2.0).mul(float(1.0).sub(cA)), 0.0));
        const pxA = fwidth(angA).add(1e-6);
        const discA = float(1.0).sub(smoothstep(float(sunRadA).sub(pxA), float(sunRadA).add(pxA), angA));
        const muA = sqrt(max(float(1.0).sub(angA.div(sunRadA).pow(2.0)), 0.0));
        const limbA = mix(vec3(0.62, 0.32, 0.16), vec3(1.0, 0.86, 0.6), pow(muA, 0.5));
        const flare = uSunFlare.add(1.0);
        col.assign(mix(col, limbA.mul(uSunLightA).mul(5.5).mul(flare), discA));
        const cB = dot(dir, uSunB);
        const angB = sqrt(max(float(2.0).mul(float(1.0).sub(cB)), 0.0));
        const pxB = fwidth(angB).add(1e-6);
        const discB = float(1.0).sub(smoothstep(float(sunRadB).sub(pxB), float(sunRadB).add(pxB), angB));
        const muB = sqrt(max(float(1.0).sub(angB.div(sunRadB).pow(2.0)), 0.0));
        const limbB = mix(vec3(1.0, 0.82, 0.62), vec3(1.0, 0.98, 0.92), muB);
        col.assign(mix(col, limbB.mul(uSunLightB).mul(20.0).mul(flare), discB));
        // Tight corona just outside each disc.
        const coronaA = exp(angA.div(sunRadA).sub(1.0).max(0.0).mul(-3.6)).mul(0.75).mul(float(1.0).sub(discA));
        col.addAssign(uSunLightA.mul(coronaA));
        const coronaB = exp(angB.div(sunRadB).sub(1.0).max(0.0).mul(-2.6)).mul(1.4).mul(float(1.0).sub(discB));
        col.addAssign(uSunLightB.mul(coronaB));

        return vec4(col, 1.0);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20; // after the opaque world: early-z skips covered pixels
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh,
        material,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
