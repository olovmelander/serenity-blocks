/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Motes: one instanced, additive sprite cloud per call — snow, embers, pollen, fireflies.
 * A world only picks a motion, a count and two colours. Positions are closed-form in the
 * vertex stage (no CPU work, no compute pass), so the same graph runs on both backends.
 *
 * Depth: seed.w spreads motes along z around the hero plane for parallax and size attenuation,
 * and a `bokeh` fraction of them sits close to the lens, out of focus — large, soft, dim discs
 * that drift across the frame faster than everything behind them, as in a shallow-focus film shot.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cos, exp, float, fract, length, mix, pow, sin, smoothstep, uv, vec3,
} from 'three/tsl';
import { fadeOut } from './breath-tsl.js';

const TAU = Math.PI * 2;
const LENS = 6;
export const MOTE_MOTION = Object.freeze({
    rise: 'rise', fall: 'fall', halo: 'halo', orbit: 'orbit', drift: 'drift', wander: 'wander', ember: 'ember', swirl: 'swirl',
});

/**
 * @param {object} u breath uniforms
 * @param {object} options
 * @param {string} options.motion one of MOTE_MOTION
 * @param {number} options.count sprites at full quality
 * @param {number} options.size world-space diameter of a near mote
 * @param {number} [options.speed] travel rate
 * @param {number} [options.spread] horizontal reach as a fraction of the screen
 * @param {number[]} [options.band] vertical range [low, high] in hero units (wander, drift)
 * @param {number} [options.depth] z reach either side of the hero plane
 * @param {number} [options.bokeh] fraction of motes out of focus near the lens (0..0.4)
 * @param {number} [options.blink] fireflies: how much each one fades in and out (0..1)
 * @param {number[]} options.colorA linear RGB
 * @param {number[]} options.colorB linear RGB
 * @param {number} [options.gain] brightness
 */
export function createMotes(u, options, { scale = 1, random = Math.random } = {}) {
    const {
        motion, size, speed = 1, spread = 1, depth = 1.2, colorA, colorB, gain = 1, bokeh = 0.1, blink = 0,
        band = [-1, 1],
    } = options;
    const count = Math.max(1, Math.round(options.count * scale));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();

    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const seed = attribute('aSeed', 'vec4');
    // The last `bokeh` share of seeds sits near the lens; the rest spread around the hero plane.
    const lens = smoothstep(1 - Math.max(bokeh, 0.001), 1, seed.w).mul(bokeh > 0 ? 1 : 0).toVar();
    const near = seed.w.div(Math.max(1 - bokeh, 0.5)).saturate();
    const pace = near.mul(0.9).add(0.45).mul(speed);
    // Breath-paced travel: motion quickens while the lungs fill, and never jumps.
    const travel = u.time.mul(pace).mul(0.35).add(u.breathInt.mul(pace).mul(0.65));
    const bottom = u.ext.y.negate().sub(u.focus).sub(0.15);
    const top = u.ext.y.sub(u.focus).add(0.15);
    let x;
    let y;
    let fade;
    let tint = seed.z;
    if (motion === MOTE_MOTION.rise || motion === MOTE_MOTION.fall || motion === MOTE_MOTION.ember) {
        const rising = motion !== MOTE_MOTION.fall;
        const ember = motion === MOTE_MOTION.ember;
        const rate = ember ? 0.2 : 0.11;
        const along = fract(rising ? seed.y.add(travel.mul(rate)) : seed.y.sub(travel.mul(0.08))).toVar();
        y = mix(bottom, top, along);
        const sway = ember ? 0.12 : 0.07;
        x = seed.x.mul(2).sub(1).mul(u.ext.x).mul(spread)
            .add(sin(along.mul(rising ? 9 : 6).add(seed.z.mul(TAU)).add(u.time.mul(0.3))).mul(near.add(0.4)).mul(sway))
            .add(ember ? sin(along.mul(23).add(seed.x.mul(40))).mul(0.025) : float(0));
        let fadeFrom = 0.88;
        if (rising) fadeFrom = ember ? 0.4 : 0.6;
        fade = smoothstep(0, 0.12, along).mul(fadeOut(fadeFrom, 1, along));
        // Embers cool as they climb: hot colour low, dull colour high.
        if (ember) tint = along.mul(1.3).add(seed.z.mul(0.3)).saturate();
    } else if (motion === MOTE_MOTION.halo) {
        // Motes that swell outward with the inhale and gather on the exhale.
        const angle = seed.x.mul(TAU).add(u.time.mul(0.03).mul(near.sub(0.4)))
            .add(sin(u.time.mul(0.11).add(seed.z.mul(40))).mul(0.12));
        const radius = pow(seed.y, 0.7).mul(1.25 * spread).add(0.34).mul(u.breathSoft.mul(0.52).add(0.62))
            .add(sin(u.time.mul(0.23).add(seed.z.mul(30))).mul(0.02));
        x = cos(angle).mul(radius);
        y = sin(angle).mul(radius);
        fade = smoothstep(0.2, 0.42, radius).mul(fadeOut(1.2, 2.1, radius));
    } else if (motion === MOTE_MOTION.orbit || motion === MOTE_MOTION.swirl) {
        const swirl = motion === MOTE_MOTION.swirl;
        const radius = pow(seed.y, 0.8).mul(1.5 * spread).add(0.3)
            .mul(swirl ? u.breathSoft.mul(0.35).add(0.8) : float(1));
        const angle = seed.x.mul(TAU).add(travel.mul(0.12).div(radius.add(0.35))).add(radius.mul(swirl ? 2.6 : 1.4));
        const swell = u.breathSoft.mul(0.14).add(0.9);
        const ox = cos(angle).mul(radius);
        const oy = sin(angle).mul(radius).mul(swirl ? 0.55 : 0.42);
        x = ox.mul(0.94).sub(oy.mul(0.34)).mul(swell);
        y = ox.mul(0.34).add(oy.mul(0.94)).mul(swell);
        fade = smoothstep(0.24, 0.5, radius).mul(fadeOut(1.3, 2.0, radius));
    } else if (motion === MOTE_MOTION.wander) {
        // Fireflies: each keeps to its own patch of air and loops lazily through it.
        const homeX = seed.x.mul(2).sub(1).mul(u.ext.x).mul(spread);
        const homeY = mix(float(band[0]), float(band[1]), seed.y);
        const t = u.time.mul(speed).mul(0.6);
        x = homeX.add(sin(t.mul(seed.z.mul(0.5).add(0.3)).add(seed.x.mul(31))).mul(0.09))
            .add(sin(t.mul(seed.w.mul(0.7).add(0.5)).add(seed.y.mul(17))).mul(0.04));
        y = homeY.add(sin(t.mul(seed.w.mul(0.4).add(0.25)).add(seed.z.mul(23))).mul(0.06))
            .add(u.breathSoft.mul(0.05).mul(seed.z.add(0.5)));
        fade = float(1);
    } else {
        const along = fract(seed.x.add(travel.mul(0.05)));
        x = mix(u.ext.x.negate().sub(0.15), u.ext.x.add(0.15), along);
        y = mix(float(band[0]), float(band[1]), seed.y).mul(spread > 0 ? 1 : 0)
            .add(sin(along.mul(7).add(seed.z.mul(TAU)).add(u.time.mul(0.25))).mul(0.06));
        fade = smoothstep(0, 0.1, along).mul(fadeOut(0.9, 1, along));
    }
    // Foreground motes keep their screen position: pull them toward the lens along the view ray.
    const z = mix(near.sub(0.5).mul(depth), mix(float(2.6), float(4.3), fract(seed.y.mul(7.3))), lens).toVar();
    const shrink = float(LENS).sub(z).div(LENS);
    material.positionNode = vec3(x.mul(shrink), y.add(u.focus).mul(shrink).sub(u.focus), z);
    const sharpScale = near.mul(near).mul(1.1).add(0.35);
    material.scaleNode = mix(sharpScale, float(4.2).add(seed.z.mul(2.4)), lens).mul(size).mul(shrink);

    const r = length(uv().sub(0.5)).mul(2);
    const glow = exp(r.mul(r).mul(-4.5)).mul(fadeOut(0.7, 1, r));
    // Out of focus, a point of light becomes a disc with a faintly brighter rim.
    const disc = fadeOut(0.8, 0.98, r).mul(smoothstep(0.45, 0.95, r).mul(0.45).add(0.55));
    const shape = mix(glow, disc, lens);
    const twinkle = sin(u.time.mul(seed.z.mul(1.6).add(0.5)).add(seed.x.mul(50))).mul(0.38).add(0.62);
    let pulse = twinkle;
    if (blink > 0) {
        // A firefly glows for a few seconds and rests for a few: slow ramps, never a flash.
        const cycle = fract(u.time.mul(seed.z.mul(0.09).add(0.07)).add(seed.x));
        const glowing = smoothstep(0.0, 0.25, cycle).mul(fadeOut(0.45, 0.75, cycle));
        pulse = mix(twinkle, glowing, blink);
    }
    const strength = fade.mul(pulse).mul(near.mul(0.75).add(0.25))
        .mul(mix(1, 0.45, u.calm)).mul(u.breath.mul(0.3).add(0.7))
        .mul(mix(float(1), float(0.16), lens))
        .mul(gain);
    material.colorNode = mix(vec3(...colorA), vec3(...colorB), tint).mul(shape).mul(strength);
    material.opacityNode = float(1);

    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 20;
    return sprite;
}
