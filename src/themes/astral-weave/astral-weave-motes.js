/**
 * Astral Weave — near motes: a few dozen grains of dust drifting just in front of the lens, far
 * out of focus. They give the frame its depth: the camera's drift carries them several times
 * further than the sky, and the other way (they hang between the lens and the loom), and a
 * clear's shock ring lights each one as it passes on its way out through the nebula.
 *
 * Each is a bokeh disc: flat, a little brighter at its rim, its edge split into a faint red
 * outside and blue inside. They are authored in FRAME units (x: −1..1 across the frame at any
 * aspect) beside the card column, kept dim, and placed and moved in the vertex stage, so the
 * whole layer is one instanced draw with nothing written per frame.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cos,
    exp,
    float,
    length,
    max,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    TAU, awFxMaterial, awQuadGeometry, mulberry32,
} from './astral-weave-tsl.js';

/** Near motes per tier (none on Minimal). */
export const MOTE_TIERS = Object.freeze({
    Minimal: 0,
    Low: 12,
    Medium: 20,
    High: 28,
    Ultra: 34,
    Extreme: 40,
});

/** The card column the motes stay out of (frame units, landscape). */
const CLEAR_COLUMN = 0.34;

/**
 * Authored placements: (x, y, depth, seed) in frame units, beside the card column, the nearest
 * (depth → 1: larger, softer, dimmer per pixel) rarer than the far ones.
 */
export function placeMotes(count, seed = 31337) {
    const rand = mulberry32(seed);
    const out = new Float32Array(Math.max(1, count) * 4);
    for (let i = 0; i < count; i++) {
        let x = 0;
        for (let guard = 0; guard < 16; guard++) {
            x = rand() * 2.1 - 1.05;
            if (Math.abs(x) > CLEAR_COLUMN) break;
        }
        out[i * 4] = x;
        out[i * 4 + 1] = rand() * 2.1 - 1.05;
        out[i * 4 + 2] = rand() ** 1.6;
        out[i * 4 + 3] = rand();
    }
    return out;
}

export function createMotes(shared, count) {
    const n = Math.max(1, count | 0);
    const place = placeMotes(n);
    const geometry = awQuadGeometry(n, 4711, {
        aMote: new THREE.InstancedBufferAttribute(place, 4),
    });
    const material = awFxMaterial('astral-weave-motes');
    const {
        uTime, uAspect, uViewport, uParallax, uLoom, uShock, uHeat, uEnergy, uFade,
    } = shared;
    const mote = attribute('aMote', 'vec4');
    const depth = mote.z;
    const s = mote.w;

    // A slow wander, larger for the nearer motes; against the camera's parallax (they are in
    // front of the loom, the sky is behind it), and several times as far.
    const wander = vec2(
        sin(uTime.mul(mix(float(0.05), float(0.11), s)).add(s.mul(TAU))),
        cos(uTime.mul(mix(float(0.04), float(0.09), s.oneMinus())).add(s.mul(17.0))),
    ).mul(depth.mul(0.035).add(0.02));
    const parallax = uParallax.mul(vec2(float(2.0).div(uAspect), 2.0)).mul(depth.mul(12.0).add(5.0));
    const centre = mote.xy.add(wander).add(parallax);
    const sizePx = mix(float(26.0), float(118.0), depth).mul(uViewport.y.div(1080.0));
    material.vertexNode = vec4(centre.add(positionGeometry.xy.mul(sizePx).mul(2.0).div(uViewport)), 0.5, 1.0);

    // The clear's shock ring, measured from the hoop's heart in hoop radii, lights it as it passes.
    const view = vec2(centre.x.mul(uAspect).mul(0.5), centre.y.mul(0.5));
    const lr = length(view.sub(uLoom.xy)).div(max(uLoom.z, 1e-3));
    const front = lr.sub(uShock.x);
    const struck = exp(front.mul(front).mul(-14.0)).mul(uShock.y);

    material.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const r = length(st);
        const vDepth = vertexStage(depth);
        const vSeed = vertexStage(s);
        const vStruck = vertexStage(struck);
        // A flat disc with a faintly brighter rim (a hard rim reads as a bubble); the edge's
        // colours split a little (red out, blue in).
        const disc = (r0) => float(1.0).sub(smoothstep(r0.sub(0.2), r0, r));
        const rimAt = (r0) => {
            const d = r.sub(r0).mul(10.0);
            return exp(d.mul(d).negate());
        };
        const body = vec3(disc(float(1.0)), disc(float(0.97)), disc(float(0.93))).mul(0.8)
            .add(vec3(rimAt(float(0.86)), rimAt(float(0.83)), rimAt(float(0.79))).mul(0.22));
        const tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.72, 0.42), uHeat);
        const breathe = sin(uTime.mul(0.23).add(vSeed.mul(TAU))).mul(0.25).add(0.75);
        // The nearer, the larger and the dimmer per pixel (the same light spread wider).
        const level = mix(float(0.028), float(0.011), vDepth).mul(breathe).mul(uEnergy.mul(0.6).add(1.0))
            .add(vStruck.mul(0.09));
        const hot = mix(tint, vec3(1.0, 0.97, 0.92), vStruck.mul(0.3).min(0.3));
        return vec4(hot.mul(body).mul(level).mul(uFade), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-motes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    return {
        mesh,
        count: n,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
