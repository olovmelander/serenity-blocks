/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Cosmic Nebula — a spiral galaxy adrift in glowing gas.
 * Inhale: the arms open and the core brightens. Exhale: the stars gather inward.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cos, exp, float, length, mix, pow, sin, smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, starfield, warpedFbm,
} from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;
const STARS = 9000;
const ARMS = 3;

function createGalaxy(u, count, random) {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();
    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const seed = attribute('aSeed', 'vec4');
    const radius = pow(seed.x, 1.7).mul(1.15).add(0.02);
    const arm = seed.y.mul(ARMS).floor().mul(TAU / ARMS);
    // Tight in the arms, loose in the bulge; the arms unwind a little as the breath fills.
    const scatter = seed.z.sub(0.5).mul(mix(float(2.4), float(0.5), radius.saturate()));
    const wind = float(3.0).sub(u.breath.mul(0.75));
    const angle = arm.add(radius.mul(wind)).add(scatter).add(u.time.mul(0.05).div(radius.add(0.25)));
    const swell = u.breath.mul(0.3).add(0.82);
    const thickness = seed.w.sub(0.5).mul(0.12).mul(exp(radius.mul(-1.8)).add(0.15));
    material.positionNode = vec3(cos(angle).mul(radius).mul(swell), thickness, sin(angle).mul(radius).mul(swell));
    const spark = seed.z.mul(7.31).fract();
    material.scaleNode = mix(float(0.011), float(0.034), pow(spark, 3)).mul(u.breath.mul(0.25).add(0.9));

    const r = length(uv().sub(0.5)).mul(2);
    const glow = exp(r.mul(r).mul(-5)).mul(fadeOut(0.7, 1, r));
    const hot = vec3(1.0, 0.84, 0.58);
    const young = mix(vec3(0.42, 0.6, 1.0), vec3(1.0, 0.46, 0.74), seed.y.mul(5.7).fract());
    const twinkle = sin(u.time.mul(spark.mul(1.4).add(0.3)).add(seed.x.mul(90))).mul(0.25).add(0.75);
    material.colorNode = mix(hot, young, smoothstep(0.06, 0.55, radius)).mul(glow).mul(twinkle)
        .mul(u.breath.mul(0.7).add(0.5))
        .mul(exp(radius.mul(-0.9)).mul(0.9).add(0.35));

    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    sprite.count = count;
    sprite.frustumCulled = false;
    return sprite;
}

export function createNebulaWorld({ u, quality, random }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const r = length(p).toVar();
        // The gas swells and thins with the breath, as if the whole sky inhaled.
        const q = p.div(u.breath.mul(0.16).add(0.9)).toVar();
        const drift = u.time.mul(0.012);
        const gas = warpedFbm(q.mul(1.15).add(vec2(1.7, 4.2)), drift, octaves).toVar();
        const veil = fbm(q.mul(2.6).add(vec2(9.1, drift.mul(2))), octaves).toVar();
        const lane = smoothstep(0.44, 0.64, fbm(q.mul(1.9).add(13.0), octaves));
        const lift = u.breath.mul(0.6).add(0.55);
        const col = vec3(0.004, 0.004, 0.015).toVar();
        col.addAssign(mix(vec3(0.13, 0.04, 0.34), vec3(0.6, 0.12, 0.4), veil).mul(smoothstep(0.4, 0.8, gas)).mul(0.5).mul(lift));
        col.addAssign(vec3(0.02, 0.24, 0.34).mul(smoothstep(0.52, 0.84, fbm(q.mul(1.35).add(21.0), octaves))).mul(0.34).mul(lift));
        col.addAssign(vec3(0.04, 0.2, 0.5).mul(smoothstep(0.52, 0.9, veil)).mul(0.26).mul(lift));
        col.mulAssign(float(1).sub(lane.mul(0.72)));
        col.addAssign(starfield(p, u, 1.1));
        col.addAssign(vec3(1.0, 0.85, 0.6).mul(exp(r.mul(-6))).mul(0.5).mul(u.breath.add(0.5)));
        col.addAssign(vec3(0.55, 0.38, 1.0).mul(exp(r.mul(-1.7))).mul(0.12).mul(lift));
        return col;
    })();

    const galaxy = createGalaxy(u, Math.max(1200, Math.round(STARS * quality.motes)), random);
    const disc = new THREE.Group();
    // Tilted toward the viewer and rolled a little: an oval, not a pinwheel seen flat-on.
    disc.rotation.set(1.02, 0, -0.34);
    disc.add(galaxy);

    return {
        backdrop,
        objects: [disc],
        bloom: { strength: 0.6, radius: 0.8, threshold: 0.5 },
        exposure: 1.0,
        update({ time, ext }) {
            // Keep the whole disc inside a portrait frame.
            disc.scale.setScalar(Math.min(1, (ext?.x ?? 1.6) / 1.32));
            galaxy.rotation.y = time * 0.006;
        },
    };
}
