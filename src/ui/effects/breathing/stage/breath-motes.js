/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Motes: one instanced, additive sprite cloud per call — snow, embers, pollen, fireflies.
 * A world only picks a motion, a count and two colours. Positions are closed-form in the
 * vertex stage (no CPU work, no compute pass), so the same graph runs on both backends.
 *
 * Depth: seed.w spreads motes along z around the hero plane for parallax and size attenuation,
 * and a `bokeh` fraction of them sits close to the lens, out of focus — large, soft, dim discs
 * that drift across the frame faster than everything behind them, as in a shallow-focus film shot.
 *
 * Shape: a mote is a round glow by default, or a silhouette (a leaf, a petal, a maple leaf, a
 * snowflake) that spins and may tumble (its width swings as it turns over in the air). Shapes may
 * be drawn alpha-blended (`blend: 'alpha'`): solid things lit by the scene, not light themselves.
 */
import * as THREE from 'three/webgpu';
import {
    abs, atan, attribute, cos, exp, float, fract, length, max, mix, pow, sin, smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import { fadeOut } from './breath-tsl.js';

const TAU = Math.PI * 2;
const LENS = 6;
export const MOTE_MOTION = Object.freeze({
    rise: 'rise', fall: 'fall', halo: 'halo', orbit: 'orbit', drift: 'drift', wander: 'wander', ember: 'ember', swirl: 'swirl',
});
export const MOTE_SHAPE = Object.freeze({
    glow: 'glow', leaf: 'leaf', petal: 'petal', maple: 'maple', flake: 'flake',
});

/**
 * A silhouette's mask in sprite space (c spans -1..1, base of the shape at the bottom) and how far
 * along it a point is (0 base, 1 tip), for shading. `soft` is the edge width.
 */
function silhouette(shape, c, soft) {
    const t = c.y.add(1).mul(0.5).toVar();
    if (shape === MOTE_SHAPE.maple) {
        // Five pointed lobes with a serrated rim, and a short stem.
        const angle = atan(c.y, c.x).sub(Math.PI / 2);
        const lobes = pow(abs(cos(angle.mul(2.5))), float(2.4));
        const teeth = pow(abs(cos(angle.mul(12.5))), float(3)).mul(0.06);
        // The top lobe is the longest, the two at the stem the shortest.
        const reach = cos(angle).mul(0.16).add(0.84);
        const rim = lobes.mul(0.56).add(0.3).add(teeth).mul(reach)
            .mul(0.92);
        const r = length(c.add(vec2(0, 0.08)));
        const blade = smoothstep(soft.negate(), soft, rim.sub(r));
        const stem = smoothstep(soft.negate(), soft, float(0.035).sub(abs(c.x)))
            .mul(smoothstep(-0.98, -0.9, c.y)).mul(fadeOut(-0.45, -0.35, c.y));
        return { mask: max(blade, stem), along: r.div(0.85).saturate() };
    }
    if (shape === MOTE_SHAPE.flake) {
        // Six arms with side branches: a dendrite at sprite scale.
        const angle = atan(c.y, c.x);
        const r = length(c).toVar();
        const sector = fract(angle.div(Math.PI / 3).add(0.5)).sub(0.5).mul(Math.PI / 3);
        const across = abs(sin(sector)).mul(r);
        const arm = smoothstep(soft.negate(), soft, float(0.07).sub(across)).mul(fadeOut(0.8, 0.9, r));
        const branchAt = abs(fract(r.mul(3.2)).sub(0.5));
        const branch = smoothstep(soft.negate(), soft, float(0.05).sub(abs(across.sub(branchAt.mul(0.35)))))
            .mul(smoothstep(0.2, 0.3, r)).mul(fadeOut(0.7, 0.8, r));
        return { mask: max(max(arm, branch), smoothstep(soft.negate(), soft, float(0.16).sub(r))), along: r };
    }
    // A leaf is pointed at both ends; a petal is broad and rounded toward its tip.
    const width = shape === MOTE_SHAPE.petal
        ? pow(sin(pow(t.saturate(), float(0.62)).mul(Math.PI)).max(0), float(0.75)).mul(0.62)
        : pow(sin(t.saturate().mul(Math.PI)).max(0), float(0.9)).mul(0.46);
    const blade = smoothstep(soft.negate(), soft, width.sub(abs(c.x)))
        .mul(smoothstep(-0.02, 0.04, t)).mul(fadeOut(0.96, 1.0, t));
    return { mask: blade, along: t };
}

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
        band = [-1, 1], shape = MOTE_SHAPE.glow, blend = 'add', spin = 0.6, tumble = 0, flutter = 0,
    } = options;
    const shaped = shape !== MOTE_SHAPE.glow;
    const alpha = blend === 'alpha';
    const count = Math.max(1, Math.round(options.count * scale));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();

    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: alpha ? THREE.NormalBlending : THREE.AdditiveBlending,
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
            .add(ember ? sin(along.mul(23).add(seed.x.mul(40))).mul(0.025) : float(0))
            // Leaves and petals see-saw as they fall: a quicker swing on top of the slow sway.
            .add(flutter > 0 ? sin(u.time.mul(seed.w.mul(0.9).add(1.1)).add(seed.x.mul(30))).mul(near.add(0.4)).mul(0.1 * flutter) : float(0));
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
    const spriteScale = mix(sharpScale, float(4.2).add(seed.z.mul(2.4)), lens).mul(size).mul(shrink);
    // A tumbling shape turns over in the air: its width swings through edge-on and back.
    const flip = cos(u.time.mul(seed.w.mul(0.9).add(0.6)).mul(speed).add(seed.y.mul(40))).toVar();
    material.scaleNode = shaped && tumble > 0
        ? vec2(spriteScale.mul(mix(float(1), abs(flip).mul(0.85).add(0.15), tumble)), spriteScale) : spriteScale;
    if (shaped) {
        // Half spin one way, half the other, each at its own pace.
        const sense = seed.y.sub(0.5).sign();
        material.rotationNode = seed.x.mul(TAU).add(u.time.mul(spin).mul(seed.z.mul(1.2).add(0.4)).mul(sense));
    }

    const r = length(uv().sub(0.5)).mul(2);
    let mask;
    let shade = float(1);
    if (shaped) {
        // Out of focus near the lens, a silhouette blurs into a soft blob of its colour.
        const soft = mix(float(0.05), float(0.4), lens);
        const outline = silhouette(shape, uv().sub(0.5).mul(2), soft);
        ({ mask } = outline);
        // The tip catches more light than the base, a face more than an edge.
        shade = outline.along.mul(0.35).add(0.75).mul(tumble > 0 ? abs(flip).mul(0.35).add(0.65) : float(1));
    } else {
        const glow = exp(r.mul(r).mul(-4.5)).mul(fadeOut(0.7, 1, r));
        // Out of focus, a point of light becomes a disc with a faintly brighter rim.
        const disc = fadeOut(0.8, 0.98, r).mul(smoothstep(0.45, 0.95, r).mul(0.45).add(0.55));
        mask = mix(glow, disc, lens);
    }
    const twinkle = sin(u.time.mul(seed.z.mul(1.6).add(0.5)).add(seed.x.mul(50))).mul(0.38).add(0.62);
    let pulse = twinkle;
    if (blink > 0) {
        // A firefly glows for a few seconds and rests for a few: slow ramps, never a flash.
        const cycle = fract(u.time.mul(seed.z.mul(0.09).add(0.07)).add(seed.x));
        const glowing = smoothstep(0.0, 0.25, cycle).mul(fadeOut(0.45, 0.75, cycle));
        pulse = mix(twinkle, glowing, blink);
    }
    const tone = mix(vec3(...colorA), vec3(...colorB), tint);
    if (alpha) {
        // Solid things: the mask is their coverage and light only shades them.
        const cover = fade.mul(near.mul(0.5).add(0.5)).mul(mix(1, 0.6, u.calm)).mul(mix(float(1), float(0.45), lens))
            .mul(gain);
        material.colorNode = tone.mul(shade).mul(u.breathSoft.mul(0.12).add(0.94));
        material.opacityNode = mask.mul(cover).saturate();
    } else {
        const strength = fade.mul(pulse).mul(near.mul(0.75).add(0.25))
            .mul(mix(1, 0.45, u.calm)).mul(u.breath.mul(0.3).add(0.7))
            .mul(mix(float(1), float(0.16), lens))
            .mul(gain);
        material.colorNode = tone.mul(mask).mul(shade).mul(strength);
        material.opacityNode = float(1);
    }

    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 20;
    return sprite;
}
