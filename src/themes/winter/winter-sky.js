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
    cameraPosition,
    clamp,
    cross,
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
    vec2,
    vec3,
} from 'three/tsl';
import {
    DEG, MOON, wAurora, wHash23, wPart, wSky, wSolidMaterial, wSq,
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
        const right = normalize(cross(vec3(0.0, 1.0, 0.0), u.moonDir));
        const upward = cross(u.moonDir, right);
        const cs = dot(dir, u.moonDir);
        const scale = 1 / Math.tan(MOON.radius);
        const m = vec2(dot(dir, right), dot(dir, upward)).div(max(cs, 0.2)).mul(scale);
        const r = length(m);
        const disc = smoothstep(1.0, 0.965, r).mul(smoothstep(0.0, 0.2, cs));
        const limb = sqrt(max(float(1.0).sub(r.mul(r)), 0.0));
        // Its seas: broad dark plains, and the rays of a young crater or two.
        const seas = u.noise(m.mul(0.16).add(vec2(0.31, 0.62)));
        const fineSeas = u.noise(m.mul(0.5).add(vec2(0.7, 0.2))).a;
        const albedo = float(0.3).add(smoothstep(0.34, 0.62, seas.r).mul(0.7)).add(fineSeas.sub(0.5).mul(0.2));
        const face = u.moonCol.mul(albedo).mul(limb.mul(0.35).add(0.65)).mul(2.3);
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
