/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Heart Glow — a lotus on dark water.
 * Inhale: the petals open, ring by ring. Exhale: they fold back around the glowing heart.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, exp, float, length, mix, normalView, pow, smoothstep, uniform, uv, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise,
} from '../stage/breath-tsl.js';
import { petalGeometry } from '../stage/breath-geometry.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const HEART = vec3(1.0, 0.78, 0.42);
const ROSE = vec3(1.0, 0.4, 0.58);
/** Outer to inner: petal count, size, hinge distance, closed and open angle from the stem. */
const RINGS = [
    {
        count: 9, length: 0.6, width: 0.44, hinge: 0.07, closed: 0.5, open: 1.42, base: [0.5, 0.05, 0.22], tip: [1.0, 0.62, 0.74],
    },
    {
        count: 8, length: 0.5, width: 0.38, hinge: 0.055, closed: 0.3, open: 1.1, base: [0.62, 0.08, 0.26], tip: [1.0, 0.74, 0.8],
    },
    {
        count: 6, length: 0.38, width: 0.3, hinge: 0.04, closed: 0.14, open: 0.72, base: [0.78, 0.2, 0.3], tip: [1.0, 0.88, 0.82],
    },
];

function petalMaterial(ring, uBreath) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.colorNode = Fn(() => {
        const along = uv().y;
        const across = uv().x.sub(0.5).abs().mul(2);
        // Deep at the hinge, pale at the tip, with a darker midrib and a translucent margin.
        const body = mix(vec3(...ring.base), vec3(...ring.tip), pow(along, 0.85)).toVar();
        body.mulAssign(float(1).sub(exp(across.mul(-9)).mul(0.22)));
        body.addAssign(vec3(1.0, 0.8, 0.86).mul(smoothstep(0.55, 1.0, across)).mul(0.3).mul(along));
        // Form: petals facing the viewer catch the light; the heart lights their inner faces.
        const facing = normalView.z.abs();
        body.mulAssign(facing.mul(0.6).add(0.45));
        body.addAssign(HEART.mul(exp(along.mul(-4.5))).mul(uBreath.mul(0.7).add(0.3)).mul(0.9));
        return body.mul(uBreath.mul(0.35).add(0.75));
    })();
    return material;
}

export function createLotusWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const r = length(p).toVar();
        const warm = u.breath.mul(0.8).add(0.35).toVar();
        const col = mix(vec3(0.07, 0.014, 0.05), vec3(0.008, 0.004, 0.02), smoothstep(0.0, 1.7, r)).toVar();
        // Soft discs of out-of-focus light drifting behind the flower.
        const bokeh = (centre, size, tint) => {
            const d = length(p.sub(centre)).div(size);
            return tint.mul(fadeOut(0.45, 1.0, d)).mul(d.mul(d).mul(0.3).add(0.6));
        };
        const sway = gnoise(vec2(u.time.mul(0.03), 2.0)).sub(0.5).mul(0.08);
        col.addAssign(bokeh(vec2(sway.add(-0.95), 0.52), 0.3, vec3(0.2, 0.04, 0.12)));
        col.addAssign(bokeh(vec2(sway.negate().add(1.1), 0.2), 0.38, vec3(0.14, 0.03, 0.14)));
        col.addAssign(bokeh(vec2(0.55, 0.78).add(sway), 0.2, vec3(0.22, 0.07, 0.1)));
        col.addAssign(bokeh(vec2(-0.5, -0.6).sub(sway), 0.24, vec3(0.12, 0.03, 0.1)));
        col.addAssign(fbm(p.mul(1.4).add(vec2(u.time.mul(0.01), 3.0)), octaves).mul(0.03));
        col.addAssign(ROSE.mul(exp(r.mul(-2.0))).mul(0.2).mul(warm));
        col.addAssign(HEART.mul(exp(r.mul(-4.2))).mul(0.3).mul(warm));

        // Water: rings spread from under the flower, flattened by the low viewpoint.
        const water = p.sub(vec2(0, -0.36)).mul(vec2(1, 3.1));
        const reach = length(water).toVar();
        const rings = exp(reach.mul(4.2).sub(u.breathInt.mul(0.35)).sub(u.time.mul(0.1)).fract()
            .sub(0.5)
            .abs()
            .mul(-11))
            .mul(exp(reach.mul(-1.5))).mul(fadeOut(-0.5, -0.2, p.y));
        col.addAssign(ROSE.mul(rings).mul(0.1).mul(warm));
        return col;
    })();

    // The flower leans toward the viewer so the breath opens into view, not away from it.
    const flower = new THREE.Group();
    flower.rotation.set(1.02, 0, 0);
    flower.position.set(0, -0.14, 0);
    flower.scale.setScalar(1.35);
    const petals = [];
    const uBreath = u.breath;
    RINGS.forEach((ring, ringIndex) => {
        const geometry = petalGeometry({
            length: ring.length, width: ring.width, cup: 0.55, curl: 0.16 + ringIndex * 0.07,
        });
        const material = petalMaterial(ring, uBreath);
        for (let i = 0; i < ring.count; i++) {
            const stem = new THREE.Group();
            stem.rotation.y = ((i + (ringIndex % 2) * 0.5) / ring.count) * Math.PI * 2;
            const petal = new THREE.Mesh(geometry, material);
            petal.position.set(0, ringIndex * 0.012, ring.hinge);
            petal.frustumCulled = false;
            stem.add(petal);
            flower.add(stem);
            petals.push({ petal, ring, phase: i * 1.7 + ringIndex * 0.9 });
        }
    });
    const heartMaterial = new THREE.MeshBasicNodeMaterial();
    const heartGlow = uniform(1);
    heartMaterial.colorNode = HEART.mul(heartGlow);
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), heartMaterial);
    heart.scale.set(1, 0.7, 1);
    heart.position.y = 0.035;
    flower.add(heart);

    return {
        backdrop,
        objects: [flower],
        motes: {
            motion: MOTE_MOTION.halo,
            count: 90,
            size: 0.024,
            speed: 1,
            spread: 0.8,
            depth: 1.8,
            colorA: [1.0, 0.8, 0.5],
            colorB: [1.0, 0.55, 0.72],
            gain: 0.5,
        },
        bloom: { strength: 0.5, radius: 0.75, threshold: 0.62 },
        exposure: 1.0,
        update({ time, breath }) {
            // Outer rings lead the opening and the heart follows, so the bloom unfolds in order.
            petals.forEach(({ petal, ring, phase }, index) => {
                const lead = Math.min(1, Math.max(0, breath * 1.25 - (index / petals.length) * 0.25));
                const eased = lead * lead * (3 - 2 * lead);
                petal.rotation.x = ring.closed + (ring.open - ring.closed) * eased + Math.sin(time * 0.35 + phase) * 0.018;
            });
            heartGlow.value = 1.6 + breath * 2.6;
            flower.rotation.y = time * 0.02;
        },
    };
}
