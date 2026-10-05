/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Volcanic Fire's flying matter: incandescent clots the fountain throws in ballistic arcs, and the
 * fine sparks its crown sheds into the rising air.
 *
 * Real sprites (one instanced, additive cloud per call), placed in closed form in the vertex stage
 * as the stage's motes are, but launched from the fountain instead of the screen's edge: most clots
 * are shed by its crown and fall outward to the lake, the rest are hurled from the vent. Every
 * flight is a parabola scaled by the fountain's current height, so the whole spray leaps with the
 * in-breath and falls back with the release without a single sprite jumping. Each one cools as it
 * flies (white-yellow, orange, dull red) and is drawn as a short streak along its velocity: the
 * blur a fast, glowing thing leaves on the eye.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, exp, float, fract, mix, sin, smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import { fadeOut, heatColor } from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;
/** The streak's length: how long the eye "exposes" a moving clot, in seconds. */
const SMEAR = 0.07;

/**
 * @param {object} u breath uniforms
 * @param {object} scene the caldera's shared nodes: `vent` (hero x, y of the vent), `height` (the
 *   fountain's height), `clock` (breath-paced seconds), `share` (0..1, how much of the cloud flies)
 * @param {object} options
 * @param {'clots'|'sparks'} options.kind
 * @param {number} options.count sprites at full quality
 * @param {number} options.size world-space width of a sprite
 * @param {number} [options.gain] brightness
 * @param {number} [options.scale] the tier's mote scale
 * @param {() => number} [options.random] seeded random
 */
export function createSpatter(u, scene, {
    kind, count: fullCount, size, gain = 1, scale = 1, random = Math.random,
}) {
    const count = Math.max(1, Math.round(fullCount * scale));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();
    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const seed = attribute('aSeed', 'vec4');
    const pick = fract(seed.x.mul(7.31).add(seed.w.mul(3.7)));
    const [ventX, ventY] = scene.vent;
    let x;
    let y;
    let vx;
    let vy;
    let heat;
    let fade;
    if (kind === 'clots') {
        // One flight per period; the period is the clot's own, so the spray never pulses in step.
        const period = seed.x.mul(0.7).add(0.9);
        const age = fract(scene.clock.div(period).add(seed.y)).toVar();
        // Clots fly out of the column's skin, a few of them wide.
        const throw0 = seed.w.sub(0.5).mul(2);
        const side = throw0.sign().mul(throw0.abs().mul(0.65).add(0.35)).toVar();
        // Most clots are shed by the crown and fall outward to the lake (the fountain's palm);
        // the rest are hurled from the vent and overshoot it.
        const shed = smoothstep(0.2, 0.3, pick).toVar();
        const startY = mix(float(0), scene.height.mul(seed.z.mul(0.3).add(0.6)), shed);
        const lift = mix(scene.height.mul(seed.z.mul(0.2).add(0.8)), scene.height.mul(seed.z.mul(0.12)), shed);
        const reach = side.mul(mix(scene.height.mul(0.16).add(0.04), scene.height.mul(0.36).add(0.07), shed));
        // Thrown toward or away from the eye, a clot lands lower or higher on the lake.
        const land = pick.sub(0.5).mul(0.06);
        // y(age): leaves startY rising by `lift` at its apex, comes down to the lake at age 1.
        // A parabola through (0, startY) with apex height startY + lift and y(1) = land.
        const rootLift = lift.max(0).add(startY.sub(land).max(0)).sqrt().add(lift.max(0).sqrt())
            .toVar();
        const b = lift.max(0).sqrt().mul(2).mul(rootLift)
            .toVar();
        const a2 = rootLift.mul(rootLift).toVar();
        x = side.mul(0.02).mul(float(1).sub(shed)).add(reach.mul(age)).add(ventX);
        y = startY.add(b.mul(age)).sub(a2.mul(age).mul(age)).add(ventY);
        vx = reach.div(period);
        vy = b.sub(a2.mul(age).mul(2)).div(period);
        // Cooling: white-yellow as it leaves, dull red by the time it falls back.
        heat = float(0.95).sub(age.mul(0.75)).sub(seed.z.mul(0.08));
        fade = smoothstep(0.0, 0.06, age).mul(fadeOut(0.82, 0.98, age));
    } else {
        // Sparks leave the crown and ride the hot air up and downwind, cooling as they go.
        const period = seed.x.mul(1.4).add(1.8);
        const age = fract(scene.clock.mul(0.6).div(period).add(seed.y)).toVar();
        const startY = scene.height.mul(seed.z.mul(0.35).add(0.6)).add(ventY);
        const climb = seed.w.mul(0.25).add(0.18).mul(scene.height.mul(0.6).add(0.4));
        const drift = seed.w.sub(0.25).mul(0.4);
        const wobble = sin(age.mul(8).add(seed.z.mul(TAU))).mul(0.025).mul(age);
        x = seed.z.sub(0.5).mul(scene.height.mul(0.35)).add(drift.mul(age)).add(wobble)
            .add(ventX);
        y = startY.add(climb.mul(age));
        vx = drift.div(period);
        vy = climb.div(period);
        heat = float(0.85).sub(age.mul(0.6));
        fade = smoothstep(0.0, 0.1, age).mul(fadeOut(0.3, 1.0, age));
    }
    // Clock rate: velocity per second of scene time (the breath-paced clock runs ~1.1x on average).
    const speed = vec2(vx, vy).length().mul(1.1).toVar();
    // Sprite space: +y is the long axis; turn it to the velocity.
    // (atan is undefined at the origin in GLSL: a clot at its apex with no sideways speed.)
    material.rotationNode = vy.atan(vx.add(1e-6)).sub(Math.PI / 2);
    // The streak is capped: a straight sprite can only stand in for so much of a curved path.
    material.scaleNode = vec2(size, speed.mul(SMEAR).min(0.07).add(size));
    material.positionNode = vec3(x, y, seed.y.sub(0.5).mul(0.3));
    // How many fly follows the fountain: a smooth share, never a pop.
    const flying = smoothstep(pick.sub(0.12), pick.add(0.12), scene.share);
    const c = uv().sub(0.5).mul(2);
    const shape = exp(c.dot(c).mul(-3.6)).mul(fadeOut(0.75, 1.0, c.length()));
    // A few big bright clots, many faint ones.
    const weight = seed.x.mul(seed.x).mul(1.4).add(0.3);
    const strength = fade.mul(flying).mul(gain).mul(weight).mul(mix(1, 0.5, u.calm));
    material.colorNode = heatColor(heat).mul(shape).mul(strength);
    material.opacityNode = float(1);

    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 18;
    sprite.name = `volcanic-${kind}`;
    return sprite;
}
