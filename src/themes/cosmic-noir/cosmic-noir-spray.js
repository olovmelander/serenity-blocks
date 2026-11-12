/**
 * Cosmic Noir — the spray: what a breaking wave flings off the rock.
 *
 * The curtain of smoke (cosmic-noir-splash.js) is the body of the breaking; this is its edge: a
 * few hundred bright specks thrown up and out from the shore where the crest struck, each on its
 * own arc (up fast, slowing, falling back to the sea, carried a little downwind), the flanks a
 * moment after the face as the crest wraps the rock. A speck's whole flight is a function of its
 * seed and the wave's age and strength, worked out in the vertex stage: nothing is simulated, a
 * seek redraws it, and a wave between sets barely lifts them off the sea.
 *
 * One instanced quad, drawn over the backdrop and added to it. Every speck is lit as the plume
 * is: by what the lamp lets fall, the galaxy behind, a little starlight.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    sqrt,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    PULSAR, ROCK, ROCK_XZ, ROLLERS, SEA, SPLASH_SLOTS, UPSTREAM, cnPart, mulberry32,
} from './cosmic-noir-tsl.js';

/** How hard the specks fall back (scene units / s²), and how fast the wind carries them off. */
const FALL = 5.0;
const CARRY = 0.3;
/** A speck's size (scene units): the least and how much larger the largest is. */
const SIZE = 0.014;
const SIZE_SPREAD = 0.05;
/** What the lamp lets fall on them (a share of its own light), the galaxy's share, and their gain. */
const LAMP_FALL = 0.55;
const GALAXY_SHARE = 0.22;
const GAIN = 2.0;

/**
 * @param {object} u      shared uniforms
 * @param {number} count  specks (shared between the waves breaking at once)
 */
export function createSpray(u, count) {
    const seeds = new Float32Array(count * 4);
    const rand = mulberry32(0x5e4);
    for (let i = 0; i < count; i++) {
        seeds[i * 4] = rand();
        seeds[i * 4 + 1] = rand();
        seeds[i * 4 + 2] = rand();
        // The whole part says which wave it belongs to, the rest is one more draw.
        seeds[i * 4 + 3] = (i % SPLASH_SLOTS) + rand() * 0.999;
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    material.name = 'CosmicNoirSpray';
    material.fog = false;
    // Premultiplied and added: a speck returns its light with no alpha, so it only ever adds.
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.forceSinglePass = true;

    const seed = attribute('aSeed', 'vec4');
    const draw = fract(seed.w);
    const row = u.splashes.element(int(floor(seed.w)));
    const strength = row.y;
    // Where on the shore it leaves: up to ±75° round from where the crest struck head-on.
    const bearing = seed.x.sub(0.5).mul(2.6);
    const c = cos(bearing);
    const s = sin(bearing);
    const outward = vec2(c.mul(UPSTREAM[0]).sub(s.mul(UPSTREAM[1])), s.mul(UPSTREAM[0]).add(c.mul(UPSTREAM[1])));
    const face = pow(max(c.mul(0.5).add(0.5), 0.0), 1.5);
    // The crest wraps the rock (the flanks a moment later), and no two specks leave together.
    const age = row.x.sub(float(1.0).sub(c).mul((ROCK.shore / ROLLERS.speed) * 0.9)).sub(draw.mul(0.5));
    const power = sqrt(max(strength, 0.0)).mul(face.mul(0.45).add(0.55));
    // Many low, a few flung high.
    const lift = power.mul(seed.y.mul(seed.y).mul(5.6).add(2.0));
    const flight = lift.mul(2.0 / FALL);
    const a = clamp(age, 0.0, flight);
    const height = lift.mul(a).sub(a.mul(a).mul(FALL * 0.5));
    const reach = seed.z.mul(2.1).add(0.3).mul(a).add(ROCK.shore + 0.15);
    const aside = seed.z.sub(0.5).mul(0.9).mul(a);
    const flat = outward.mul(reach).add(vec2(outward.y.negate(), outward.x).mul(aside))
        .sub(vec2(UPSTREAM[0], UPSTREAM[1]).mul(a.mul(a).mul(CARRY)));
    const world = vec3(flat.x.add(ROCK_XZ[0]), height.add(SEA.level + 0.1), flat.y.add(ROCK_XZ[1]));
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    // In the air only: fading in as it leaves, dimming as it falls back.
    const alive = smoothstep(0.0, 0.07, age).mul(float(1.0).sub(smoothstep(flight.mul(0.55), flight, age)))
        .mul(clamp(strength.mul(4.0), 0.0, 1.0));
    const units = draw.mul(draw).mul(SIZE_SPREAD).add(SIZE).mul(a.mul(0.5).add(1.0));
    const rawPx = units.mul(u.viewport.y).div(u.tanHalf.y.mul(2.0)).div(max(clip.w, 0.5));
    // Never smaller than a pixel (it dims instead), never a blob.
    const px = clamp(rawPx, 1.25, 10.0);
    const half = u.viewport.mul(0.5);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);

    const fromLamp = length(world.sub(u.pulsar)).div(PULSAR.coreReach * 1.5);
    const lit = u.coreGain.mul(LAMP_FALL).div(fromLamp.mul(fromLamp).add(1.0))
        .add(u.galaxy.mul(GALAXY_SHARE))
        .add(u.ambient.mul(3.0));
    const vLight = varying(lit.mul(alive).mul(clamp(rawPx.div(1.25), 0.35, 1.0)).mul(strength.mul(0.5).add(0.5))
        .mul(u.breath)
        .mul(GAIN), 'cnSprayLight');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const soft = exp(length(q).mul(length(q)).mul(-3.4));
        return vec4(vec3(vLight.mul(soft)), 0.0);
    })();

    const part = cnPart('CosmicNoirSpray', geometry, material, -90);
    part.count = count;
    return part;
}
