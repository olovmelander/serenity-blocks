/**
 * Supernova — the nebula: what the star has thrown off, and what a clear sends through it.
 *
 * Everything here is a thin shell round the star, and a thin shell needs no march. A view ray
 * meets a sphere at two points in closed form; at each the gas is read from a pattern fixed in
 * DIRECTION (so a shell keeps its filaments as it grows), and the light is weighted by how long
 * the ray stays inside the shell's skin — short where it goes straight through, long where it
 * grazes the edge. That grazing is what draws a bubble's bright rim.
 *
 * One table of rows, walked by one loop, holds every shell on screen:
 *   - the standing shells, which drift outward for minutes and are replaced from the inside;
 *   - the shock fronts a clear sends out and the echoes of a lock: even skins with a thickness,
 *     solved in closed form with no read of the noise at all, so each is a ring of light with a
 *     crisp outer edge and a glow that fades inward;
 *   - the fireball of a detonation (three thick, ragged shells one inside the other).
 * The world writes the rows each frame and packs the live ones at the front, so a quiet nebula
 * pays for the standing shells only.
 *
 * A row is five vec4:
 *   A  radius, how strongly its edge outshines its face (a front: its thickness as a fraction
 *      of the radius), pattern frequency, thread sharpness
 *   B  colour one, gain
 *   C  colour two, coverage (the level of the coarse field above which there is gas)
 *   D  how much its outline wobbles, which two of four wobble fields it mixes, kind
 *      (0 = a shell of filaments, 1 = a front)
 *   E  pattern seed (a point of the noise's space), how much it hides of what is behind it
 *
 * No row's outline is a circle: the radius a ray meets is nudged by a slow field read once per
 * pixel in the direction of the ray's closest approach to the star.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    cameraPosition,
    clamp,
    dot,
    float,
    int,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    sqrt,
    step,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SHELL_STRIDE, snFxMaterial, snPart, snRidge,
} from './supernova-tsl.js';

/** How much finer than the coarse read the third, finest read of a shell's gas is. */
const FINE = 6.3;

/**
 * @param {object} u shared uniforms
 * @param {{ detail?: number }} [options]  detail 2 = a second, finer read per crossing;
 *   3 = a third, finest one on shells large enough on screen to show it
 */
export function createNebula(u, { detail = 2 } = {}) {
    const geometry = new THREE.SphereGeometry(380, 24, 16);
    const material = snFxMaterial('SupernovaNebula');
    material.side = THREE.BackSide;

    material.fragmentNode = Fn(() => {
        const ro = cameraPosition.sub(u.centre).toVar();
        const rd = normalize(positionWorld.sub(cameraPosition)).toVar();
        const b = dot(ro, rd).toVar();
        const c0 = dot(ro, ro).toVar();
        // The ray's closest approach to the star: how far, and in which direction.
        const d2 = max(c0.sub(b.mul(b)), 1e-6).toVar();
        const dc = ro.sub(rd.mul(b)).div(sqrt(d2)).toVar();
        const wob = u.noise(dc.mul(0.33).add(vec3(0.27, 0.55, 0.91))).toVar();
        // One pixel at the star's distance, in star radii.
        const pixel = u.pixelAngle.mul(sqrt(c0)).toVar();

        const light = vec3(0.0).toVar();
        const veil = float(0.0).toVar();

        Loop({
            start: int(0), end: int(u.shellCount), type: 'int', condition: '<', name: 'row',
        }, ({ row }) => {
            const base = row.mul(SHELL_STRIDE);
            const A = u.shells.element(base).toVar();
            const B = u.shells.element(base.add(1)).toVar();
            const C = u.shells.element(base.add(2)).toVar();
            const D = u.shells.element(base.add(3)).toVar();
            const E = u.shells.element(base.add(4)).toVar();
            const nudge = mix(mix(wob.r, wob.g, D.y), mix(wob.b, wob.a, D.y), D.z).sub(0.5);
            const radius = A.x.mul(float(1.0).add(nudge.mul(D.x))).toVar();
            const h = b.mul(b).sub(c0).add(radius.mul(radius)).toVar();
            If(D.w.greaterThan(0.5), () => {
                // A front: an even skin of some thickness, solved. The light along the ray is
                // how far it runs inside the skin: most where it grazes the skin's inner face,
                // falling to nothing at the outer one. Cubed, so the front is a ring and the
                // film across its face is next to nothing.
                const inside = radius.mul(float(1.0).sub(A.y)).toVar();
                const inner2 = inside.mul(inside);
                const outer2 = radius.mul(radius);
                const run = sqrt(max(outer2.sub(d2), 0.0)).sub(sqrt(max(inner2.sub(d2), 0.0)))
                    .div(sqrt(max(outer2.sub(inner2), 1e-6))).toVar();
                // Brighter and dimmer round its rim, never an even hoop.
                const ragged = mix(wob.b, wob.a, D.y).mul(1.5).add(0.25);
                const ring = run.mul(run).mul(run).mul(ragged);
                light.addAssign(mix(B.rgb, C.rgb, run.mul(run)).mul(ring.mul(B.w)));
            }).ElseIf(h.greaterThan(0.0), () => {
                const sq = sqrt(h).toVar();
                // How long the ray stays in the skin, against going straight through it.
                const cosine = sq.div(radius);
                const graze = A.y.div(sqrt(cosine.mul(cosine).add(A.y.mul(A.y)))).toVar();
                // Each shell's gas is combed along an axis of its own: the pattern is read from a
                // sphere squeezed along it, so its threads run on as long strands.
                const comb = normalize(E.xyz.sub(0.5)).toVar();
                const room = float(1.0).sub(smoothstep(0.5, 1.15, pixel.div(radius).mul(A.z).mul(FINE * 64))).toVar();
                const crossing = (t, dim) => {
                    const onShell = ro.add(rd.mul(t)).div(radius).toVar();
                    const dir = onShell.sub(comb.mul(dot(onShell, comb).mul(0.45))).toVar();
                    const n1 = u.noise(dir.mul(A.z).add(E.xyz)).toVar();
                    // Where the gas is: a wide ramp, so a cloud swells and thins instead of being cut out.
                    const gas = smoothstep(C.w, C.w.add(0.34), n1.r).toVar();
                    let thread;
                    let weave;
                    let halo;
                    if (detail >= 2) {
                        const n2 = u.noise(dir.mul(A.z.mul(2.7)).add(n1.xyz.sub(0.5).mul(0.3)).add(E.zxy)).toVar();
                        const ridge = snRidge(n2.r).toVar();
                        thread = ridge.pow(A.w);
                        halo = ridge.mul(ridge).mul(ridge);
                        // A second family crosses the first, and comes and goes along its length.
                        weave = snRidge(n2.g).pow(A.w.mul(1.5)).mul(smoothstep(0.42, 0.62, n2.b)).mul(0.7)
                            .toVar();
                        if (detail >= 3) {
                            // The finest threads, only on a shell large enough on screen that a
                            // texel of this read is no smaller than a pixel (there are no mips).
                            If(room.greaterThan(0.01), () => {
                                const n3 = u.noise(
                                    dir.mul(A.z.mul(FINE)).add(n2.xyz.sub(0.5).mul(0.14)).add(E.yzx),
                                ).toVar();
                                const fine = snRidge(n3.r).pow(A.w.mul(1.1)).mul(smoothstep(0.4, 0.62, n2.a));
                                weave.addAssign(fine.mul(room).mul(0.45));
                            });
                        }
                    } else {
                        const ridge = snRidge(n1.g).toVar();
                        // One read: the threads are as thin as the coarse field can draw them.
                        thread = ridge.pow(A.w.mul(0.8));
                        halo = ridge.mul(ridge).mul(ridge);
                        weave = snRidge(n1.a).pow(A.w).mul(0.5);
                    }
                    // Threads in their own glow on a faint body of gas; each thread brightens and
                    // fades along its way.
                    const run = smoothstep(0.3, 0.7, n1.g);
                    const filaments = gas.mul(
                        float(0.03).add(halo.mul(0.09)).add(thread.mul(run.mul(0.85).add(0.15))).add(weave.mul(0.8)),
                    );
                    const density = filaments.mul(step(0.0, t)).mul(dim).toVar();
                    const hue = mix(B.rgb, C.rgb, smoothstep(0.38, 0.62, n1.b));
                    // The brightest threads burn toward white.
                    const hot = thread.mul(thread).mul(run).mul(gas).mul(0.3);
                    return vec4(hue.add(vec3(hot)).mul(density), density);
                };
                // The far side is seen through the shell's own gas: a little dimmer.
                const near = crossing(b.negate().sub(sq), 1.0).toVar();
                const far = crossing(b.negate().add(sq), 0.62).toVar();
                const both = near.add(far).mul(graze).toVar();
                light.addAssign(both.rgb.mul(B.w));
                veil.addAssign(both.a.mul(E.w));
            });
        });

        // The star's own light, scattered by the thin gas that fills the nebula.
        const reach = d2.div(u.starR.mul(u.starR).add(1e-4));
        const haze = u.corona.mul(u.haze).mul(float(0.055).div(float(1.0).add(reach.mul(0.02))))
            .add(u.corona.mul(u.haze).mul(float(0.5).div(float(1.0).add(reach.mul(reach).mul(0.004)))).mul(0.12));
        light.addAssign(haze);

        const alpha = clamp(veil, 0.0, 0.7);
        return vec4(min(light.mul(u.breath), vec3(60.0)), alpha);
    })();

    return snPart('SupernovaNebula', geometry, material, 10);
}
