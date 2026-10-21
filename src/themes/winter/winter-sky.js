/**
 * Winter — the sky.
 *
 * One dome, drawn last among the solids so it is shaded only where the sky shows: the polar
 * twilight's gradient and the last light along the horizon (wSky, which every other material
 * also uses as the colour of distance), stars, the moon with its seas, the ring of ice-light
 * that stands 22° from it, and the fires themselves (wAurora).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    acos,
    atan,
    cameraPosition,
    cameraViewMatrix,
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
    sqrt,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, LOOK, MOON, wAurora, wHash23, wPart, wSky, wSolidMaterial, wSq,
} from './winter-tsl.js';

/** The dome's radius (metres): inside the far plane, beyond the last fell. */
export const SKY_RADIUS = 30000;

/**
 * @param {object} u
 * @param {object} o
 * @param {number} o.curtains  sheets of aurora to draw
 */
export function createSky(u, { curtains = 3 } = {}) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const material = wSolidMaterial('WinterSky');
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.colorNode = Fn(() => {
        const raw = normalize(positionWorld.sub(cameraPosition));
        const dir = normalize(vec3(raw.x, max(raw.y, 0.0), raw.z)).toVar();
        const col = wSky(u, dir).toVar();

        // ── Stars: a jittered grid on the dome, each with its own beat ──
        const sp = dir.xz.div(dir.y.add(0.55)).mul(150.0);
        const cell = floor(sp);
        const h = wHash23(cell);
        const d = length(fract(sp).sub(0.5).sub(h.xy.sub(0.5).mul(0.7)));
        const size = h.z.mul(h.z).mul(0.09).add(0.035);
        const beat = sin(u.time.mul(h.x.mul(3.0).add(1.2)).add(h.y.mul(40.0))).mul(0.3).add(0.7);
        const bright = wSq(wSq(h.z)).mul(5.0).add(0.25);
        const tone = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.9, 0.78), h.x);
        const star = smoothstep(size, size.mul(0.25), d).mul(bright).mul(beat)
            .mul(smoothstep(0.03, 0.3, dir.y))
            .mul(u.stars);
        col.addAssign(tone.mul(star).mul(u.breath));

        // ── The moon ──
        // The disc is drawn in the lens's image plane, so it is round wherever the frame puts it:
        // laid on the dome, a wide lens stretched it into an egg toward the corner it stands in.
        // Its radius there is the egg's short axis (tan R over the cosine of its angle off the axis).
        const cs = dot(dir, u.moonDir);
        const vD = cameraViewMatrix.mul(vec4(dir, 0.0)).xyz;
        const vM = cameraViewMatrix.mul(vec4(u.moonDir, 0.0)).xyz;
        const offAxis = max(vM.z.negate(), 0.2);
        const plane = vD.xy.div(max(vD.z.negate(), 0.05)).sub(vM.xy.div(offAxis));
        const m = plane.mul(offAxis).div(Math.tan(MOON.radius)).toVar();
        const r = length(m);
        const disc = smoothstep(1.0, 0.965, r).mul(smoothstep(0.0, 0.2, cs));
        const limb = sqrt(max(float(1.0).sub(r.mul(r)), 0.0));
        // Its face, as the full moon's: dark seas with crisp shores, gathered in its upper half;
        // bright highlands pitted with small craters; and a young crater low down whose rays
        // run out over half the disc.
        const broadSeas = u.noise(m.mul(0.3).add(vec2(0.31, 0.62))).r;
        const smallSeas = u.noise(m.mul(0.62).add(vec2(0.13, 0.47))).a;
        const fine = u.noise(m.mul(0.5).add(vec2(0.7, 0.2))).a;
        const north = smoothstep(-0.6, 0.5, m.y.add(m.x.mul(0.2)));
        const seaField = broadSeas.mul(0.7).add(smallSeas.mul(0.3)).add(north.mul(0.14)).sub(0.07);
        const sea = smoothstep(LOOK.moonSeaFrom, LOOK.moonSeaFrom + 0.05, seaField.add(fine.sub(0.5).mul(0.08)));
        const pit = m.mul(4.2);
        const pitCell = floor(pit);
        const ph = wHash23(pitCell);
        // (A crater in one cell of four, anywhere in its cell, of any size: denser or centred,
        // they lie on a visible grid.)
        const pitD = length(fract(pit).sub(0.5).sub(ph.xy.sub(0.5).mul(0.72))).div(wSq(ph.z).mul(0.3).add(0.06));
        const has = step(0.75, fract(ph.z.mul(7.31)));
        const rim = exp(wSq(pitD.sub(1.0).div(0.25)).negate()).mul(has);
        const floorDark = smoothstep(1.0, 0.6, pitD).mul(has);
        const young = m.sub(vec2(-0.12, -0.58));
        const youngR = length(young);
        const spokes = u.noise(vec2(atan(young.y, young.x).mul(3.0), 0.43)).r;
        const rays = smoothstep(0.55, 0.85, spokes).mul(exp(youngR.mul(-2.4))).mul(smoothstep(0.06, 0.12, youngR))
            .add(exp(wSq(youngR.div(0.05)).negate()).mul(1.4));
        const highland = float(0.82).add(fine.sub(0.5).mul(0.22)).add(rim.mul(0.22)).sub(floorDark.mul(0.1));
        const albedo = mix(highland, float(LOOK.moonSea).add(fine.sub(0.5).mul(0.1)), sea).add(rays.mul(0.5));
        const face = u.moonCol.mul(albedo).mul(limb.mul(0.2).add(0.8)).mul(LOOK.moonGain);
        col.assign(mix(col, face, disc));

        // ── The ring of ice-light, 22° out: sharp and red inside, soft and blue outside ──
        const away = acos(clamp(cs, -1.0, 1.0)).sub(MOON.halo);
        const inner = exp(wSq(away.div(0.55 * DEG)).negate());
        const outer = exp(max(away, 0.0).div(-2.6 * DEG));
        const ring = mix(inner, outer, smoothstep(-0.2 * DEG, 0.4 * DEG, away));
        const ringTone = mix(vec3(1.0, 0.72, 0.55), vec3(0.8, 0.92, 1.15), smoothstep(-0.4 * DEG, 1.6 * DEG, away));
        // Its dogs stand on it at the moon's own height.
        const dogs = exp(wSq(dir.y.sub(u.moonDir.y).div(0.035)).negate()).mul(2.2).add(1.0);
        col.addAssign(u.moonCol.mul(ringTone).mul(ring.mul(dogs).mul(u.halo).mul(0.55)).mul(smoothstep(0.0, 0.08, dir.y)));

        // ── The fires ──
        col.addAssign(wAurora(u, dir, { count: curtains, fine: true }));
        return col;
    })();
    const part = wPart('WinterSky', geometry, material, 30);
    return part;
}
