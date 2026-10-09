/**
 * Supernova — the deep sky behind everything.
 *
 * One dome that follows the camera: the void's own colour, far clouds lit faintly in the
 * palette's two sky colours, and lattices of stars. A detonation's flash crosses the far clouds
 * as an echo: a ring that leaves the star's place on the sky and lights the dust it passes, long
 * after the flash itself has gone (light takes its time across a cloud).
 *
 * The stars live in the cells of a 3D lattice the dome cuts through, so there is no pole and no
 * seam; a star is never smaller than a pixel (what the clamp adds in area it takes back in
 * brightness), so the field does not shimmer as the camera drifts.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    acos,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import {
    snBell, snHash33, snPart, snRidge,
} from './supernova-tsl.js';

/** Cells across the unit sphere's radius for each lattice, and how bright its stars are. */
const LATTICES = Object.freeze([
    { cells: 46, gain: 1.0, keep: 0.5 },
    { cells: 92, gain: 0.55, keep: 0.62 },
    { cells: 170, gain: 0.3, keep: 0.7 },
]);

/**
 * @param {object} u shared uniforms
 * @param {{ layers?: number, clouds?: boolean }} [options]
 */
export function createSky(u, { layers = 3, clouds = true } = {}) {
    const geometry = new THREE.SphereGeometry(400, 24, 16);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false });
    material.name = 'SupernovaSky';
    material.fog = false;

    material.fragmentNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const toStar = clamp(dot(dir, u.starDir), -1.0, 1.0).toVar();
        const angle = acos(toStar).toVar();
        const col = vec3(u.voidCol).toVar();
        // The void is a little lighter toward the star: its light is everywhere.
        col.mulAssign(float(1.0).add(exp(angle.mul(-2.2)).mul(1.6)));

        // ── Far clouds ──
        const dust = float(0.0).toVar();
        if (clouds) {
            const n1 = u.noise(dir.mul(0.42).add(vec3(0.13, 0.71, 0.37))).toVar();
            const n2 = u.noise(dir.mul(1.15).add(n1.xyz.sub(0.5).mul(0.3)).add(vec3(0.61, 0.07, 0.83))).toVar();
            const body = smoothstep(0.36, 0.78, n1.r).mul(smoothstep(0.2, 0.75, n2.g));
            const wisp = snRidge(n2.r).pow(3.0);
            dust.assign(body.mul(float(0.45).add(wisp.mul(0.9))));
            const hue = mix(u.skyA, u.skyB, smoothstep(0.34, 0.66, n1.b));
            col.addAssign(hue.mul(dust).mul(0.05));
        }

        // ── The echo: the flash crossing the far dust ──
        const echoAge = u.time.sub(u.echo.x);
        const echoRadius = max(echoAge, 0.0).mul(u.echo.z);
        const band = snBell(angle.sub(echoRadius).div(u.echo.w.add(echoRadius.mul(0.12))));
        const echo = band.mul(u.echo.y).mul(exp(max(echoAge, 0.0).mul(-0.55)))
            .mul(smoothstep(0.0, 0.08, echoAge));
        col.addAssign(u.echoCol.mul(echo).mul(float(0.02).add(dust.mul(0.5))));

        // ── Stars ──
        const stars = vec3(0.0).toVar();
        for (let i = 0; i < Math.min(layers, LATTICES.length); i++) {
            const L = LATTICES[i];
            const p = dir.mul(L.cells).add(vec3(i * 19.7, i * 7.3, i * 3.1));
            const cell = floor(p);
            const h = snHash33(cell.add(vec3(i * 31.0, 0.0, 0.0))).toVar();
            // The star sits somewhere in the middle of its cell.
            const off = fract(p).sub(h.mul(0.6).add(0.2));
            const pixel = u.pixelAngle.mul(L.cells);
            const size = max(float(0.035).add(h.z.mul(0.03)), pixel.mul(0.9));
            const shrink = float(0.035).add(h.z.mul(0.03)).div(size);
            const d = length(off).div(size);
            const disc = exp(d.mul(d).mul(-2.2)).mul(shrink.mul(shrink));
            // A steep split: most are dust, a few burn.
            const rank = fract(h.x.mul(7.31).add(h.y.mul(3.17)));
            const lit = smoothstep(L.keep, 1.0, rank);
            const bright = lit.mul(lit).mul(lit).mul(2.6).add(lit.mul(0.25));
            const twinkle = float(0.82).add(sin(u.time.mul(h.y.mul(2.0).add(0.6)).add(h.x.mul(40.0))).mul(0.18));
            // Cool, white or hot.
            const warm = mix(vec3(1.0, 0.62, 0.38), vec3(1.0, 0.95, 0.9), smoothstep(0.0, 0.5, h.y));
            const tint = mix(warm, vec3(0.62, 0.78, 1.0), smoothstep(0.55, 1.0, h.y));
            stars.addAssign(tint.mul(disc.mul(bright).mul(twinkle).mul(L.gain)));
        }
        // The stars answer a clear, and the nearest ones drown in the star's own glare.
        const drown = float(1.0).sub(exp(angle.mul(-9.0)).mul(0.85));
        col.addAssign(stars.mul(float(1.0).add(u.skyPulse.mul(1.4))).mul(drown).mul(float(1.0).sub(dust.mul(0.35))));

        return vec4(col.mul(mix(float(0.55), float(1.0), u.breath)), 1.0);
    })();

    return snPart('SupernovaSky', geometry, material, 0);
}
