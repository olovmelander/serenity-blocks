/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Motes: one instanced, additive sprite cloud per world — snow, embers, pollen, fireflies.
 * A world only picks a motion, a count and two colours. Positions are closed-form in the
 * vertex stage (no CPU work, no compute pass), so the same graph runs on both backends.
 * Depth (seed.w) spreads motes along z for real parallax and size attenuation.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cos, exp, float, fract, length, mix, pow, sin, smoothstep, uv, vec3,
} from 'three/tsl';
import { fadeOut } from './breath-tsl.js';

const TAU = Math.PI * 2;
export const MOTE_MOTION = Object.freeze({
    rise: 'rise', fall: 'fall', halo: 'halo', orbit: 'orbit', drift: 'drift',
});

/**
 * @param {object} u breath uniforms
 * @param {object} options
 * @param {string} options.motion one of MOTE_MOTION
 * @param {number} options.count sprites at full quality
 * @param {number} options.size world-space diameter of a near mote
 * @param {number} [options.speed] travel rate
 * @param {number} [options.spread] horizontal reach as a fraction of the screen
 * @param {number} [options.depth] z reach either side of the hero plane
 * @param {number[]} options.colorA linear RGB
 * @param {number[]} options.colorB linear RGB
 * @param {number} [options.gain] brightness
 */
export function createMotes(u, options, { scale = 1, random = Math.random } = {}) {
    const {
        motion, size, speed = 1, spread = 1, depth = 1.2, colorA, colorB, gain = 1,
    } = options;
    const count = Math.max(1, Math.round(options.count * scale));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();

    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const seed = attribute('aSeed', 'vec4');
    const near = seed.w;
    const pace = near.mul(0.9).add(0.45).mul(speed);
    // Breath-paced travel: motion quickens while the lungs fill, and never jumps.
    const travel = u.time.mul(pace).mul(0.35).add(u.breathInt.mul(pace).mul(0.65));
    const bottom = u.ext.y.negate().sub(u.focus).sub(0.15);
    const top = u.ext.y.sub(u.focus).add(0.15);
    let x;
    let y;
    let fade;
    if (motion === MOTE_MOTION.rise || motion === MOTE_MOTION.fall) {
        const rising = motion === MOTE_MOTION.rise;
        const along = fract(rising ? seed.y.add(travel.mul(0.11)) : seed.y.sub(travel.mul(0.08)));
        y = mix(bottom, top, along);
        x = seed.x.mul(2).sub(1).mul(u.ext.x).mul(spread)
            .add(sin(along.mul(rising ? 9 : 6).add(seed.z.mul(TAU)).add(u.time.mul(0.3))).mul(near.add(0.4)).mul(0.07));
        fade = smoothstep(0, 0.12, along).mul(fadeOut(rising ? 0.6 : 0.88, 1, along));
    } else if (motion === MOTE_MOTION.halo) {
        // Motes that swell outward with the inhale and gather on the exhale.
        const angle = seed.x.mul(TAU).add(u.time.mul(0.03).mul(near.sub(0.4)))
            .add(sin(u.time.mul(0.11).add(seed.z.mul(40))).mul(0.12));
        const radius = pow(seed.y, 0.7).mul(1.25 * spread).add(0.34).mul(u.breath.mul(0.52).add(0.62))
            .add(sin(u.time.mul(0.23).add(seed.z.mul(30))).mul(0.02));
        x = cos(angle).mul(radius);
        y = sin(angle).mul(radius);
        fade = smoothstep(0.2, 0.42, radius).mul(fadeOut(1.2, 2.1, radius));
    } else if (motion === MOTE_MOTION.orbit) {
        const radius = pow(seed.y, 0.8).mul(1.5 * spread).add(0.3);
        const angle = seed.x.mul(TAU).add(travel.mul(0.12).div(radius.add(0.35))).add(radius.mul(1.4));
        const swell = u.breath.mul(0.14).add(0.9);
        const ox = cos(angle).mul(radius);
        const oy = sin(angle).mul(radius).mul(0.42);
        x = ox.mul(0.94).sub(oy.mul(0.34)).mul(swell);
        y = ox.mul(0.34).add(oy.mul(0.94)).mul(swell);
        fade = smoothstep(0.24, 0.5, radius).mul(fadeOut(1.3, 2.0, radius));
    } else {
        const along = fract(seed.x.add(travel.mul(0.05)));
        x = mix(u.ext.x.negate().sub(0.15), u.ext.x.add(0.15), along);
        y = seed.y.mul(2).sub(1).mul(u.ext.y).mul(spread)
            .sub(u.focus.mul(0.5))
            .add(sin(along.mul(7).add(seed.z.mul(TAU)).add(u.time.mul(0.25))).mul(0.06));
        fade = smoothstep(0, 0.1, along).mul(fadeOut(0.9, 1, along));
    }
    material.positionNode = vec3(x, y, near.sub(0.5).mul(depth));
    material.scaleNode = near.mul(near).mul(1.1).add(0.35).mul(size);

    const r = length(uv().sub(0.5)).mul(2);
    const glow = exp(r.mul(r).mul(-4.5)).mul(float(1).sub(smoothstep(0.7, 1, r)));
    const twinkle = sin(u.time.mul(seed.z.mul(1.6).add(0.5)).add(seed.x.mul(50))).mul(0.38).add(0.62);
    const strength = fade.mul(twinkle).mul(near.mul(0.75).add(0.25))
        .mul(mix(1, 0.45, u.calm)).mul(u.breath.mul(0.3).add(0.7))
        .mul(gain);
    material.colorNode = mix(vec3(...colorA), vec3(...colorB), seed.z).mul(glow).mul(strength);
    material.opacityNode = float(1);

    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 20;
    return sprite;
}
