/**
 * Vesper Chrysalis — the sky.
 *
 * One dome that draws the whole distance along the view ray: the dusk, the stars, the ringed
 * world, the evening star, the aurora, the clouds and the ranges (vcBackdrop,
 * vesper-chrysalis-tsl.js). It is drawn LAST among the opaque parts, depth-tested, so its shader
 * runs only where the sky shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, exp, float, int, max, mix,
    normalize, positionGeometry, positionWorld, sin, smoothstep, step, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    EYE, skyDirection, vcBackdrop, vcPart,
} from './vesper-chrysalis-tsl.js';

/** Shooting stars in the sky at once. */
export const METEOR_SLOTS = 10;
/** How far off they are drawn (inside the sky's dome, far past everything that stands in the scene). */
const METEOR_FAR = 4300;

/**
 * @param {object} u  shared uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.lite=false]  the cut-down sky of the lowest tier
 */
export function createSky(u, opts = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition));
        return vec4(vcBackdrop(u, dir, { lite: opts.lite === true }), 1.0);
    })();
    const geometry = new THREE.SphereGeometry(5200, 48, 24);
    return vcPart('VesperChrysalisSky', geometry, material, 40);
}

/**
 * Shooting stars: each a short streak that crosses a piece of the sky, brightens, and is gone.
 * Placed in the world (far off, about the resting eye), so the lake's own camera mirrors them.
 * @param {object} u
 */
export function createMeteors(u) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(METEOR_SLOTS);
    for (let i = 0; i < METEOR_SLOTS; i++) data[i] = i;
    geometry.setAttribute('aMeteor', new THREE.InstancedBufferAttribute(data, 1));
    const mesh = new THREE.InstancedMesh(geometry, null, METEOR_SLOTS);
    mesh.frustumCulled = false;
    /** (where it starts: a direction, birth), (how far it goes: a vector to add, life), (rgb, strength). */
    const start = Array.from({ length: METEOR_SLOTS }, () => new THREE.Vector4(0, 1, 0, -100));
    const run = Array.from({ length: METEOR_SLOTS }, () => new THREE.Vector4(0, 0, 0, 1));
    const tint = Array.from({ length: METEOR_SLOTS }, () => new THREE.Vector4(1, 1, 1, 0));
    const uStart = uniformArray(start, 'vec4');
    const uRun = uniformArray(run, 'vec4');
    const uTint = uniformArray(tint, 'vec4');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisMeteors';
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    const slot = int(attribute('aMeteor', 'float').add(0.5));
    const vAt = varying(vec2(positionGeometry.x.add(0.5), positionGeometry.y.mul(2.0)), 'vMeteorAt');
    const vGain = varying(float(0.0), 'vMeteorGain');
    const vTint = varying(uTint.element(slot).rgb, 'vMeteorTint');
    material.vertexNode = Fn(() => {
        const A = uStart.element(slot);
        const B = uRun.element(slot);
        const life = max(B.w, 0.05);
        const age = u.time.sub(A.w);
        const x = clamp(age.div(life), 0.0, 1.0).toVar();
        // It runs fast and slows as it burns out; its tail is a third of its way behind it.
        const headAt = float(1.0).sub(float(1.0).sub(x).mul(float(1.0).sub(x)));
        const tailAt = max(headAt.sub(sin(x.mul(Math.PI)).mul(0.34).add(0.02)), 0.0);
        const along = positionGeometry.x.add(0.5);
        const eye = vec3(EYE.x, EYE.y, EYE.z);
        const at = (s) => eye.add(normalize(A.xyz.add(B.xyz.mul(s))).mul(METEOR_FAR));
        const viewProj = cameraProjectionMatrix.mul(cameraViewMatrix);
        const c0 = viewProj.mul(vec4(at(mix(tailAt, headAt, along)), 1.0)).toVar();
        const c1 = viewProj.mul(vec4(at(headAt.add(0.02)), 1.0));
        const cT = viewProj.mul(vec4(at(headAt), 1.0));
        const dir = normalize(c1.xy.div(max(c1.w, 1e-4)).sub(cT.xy.div(max(cT.w, 1e-4))).mul(u.viewport).add(vec2(1e-5, 0.0)));
        const side = vec2(dir.y.negate(), dir.x);
        const live = step(0.0, age).mul(step(age, life)).mul(step(0.001, uTint.element(slot).w));
        const px = along.mul(2.6).add(0.5).mul(u.viewport.y.div(1080.0));
        const off = side.mul(positionGeometry.y.mul(2.0)).mul(px).div(u.viewport).mul(c0.w)
            .mul(live);
        vGain.assign(live.mul(sin(x.mul(Math.PI)).pow(0.6)).mul(uTint.element(slot).w));
        return vec4(c0.xy.add(off), c0.z, c0.w);
    })();
    material.outputNode = Fn(() => {
        const along = vAt.x;
        const across = vAt.y;
        const core = exp(across.mul(across).mul(-7.0));
        const head = exp(float(1.0).sub(along).mul(-26.0)).mul(3.0);
        const trail = smoothstep(0.0, 1.0, along).pow(1.6);
        const light = core.mul(trail.add(head)).add(exp(abs(across).mul(-2.0)).mul(trail).mul(0.12));
        return vec4(mix(vTint, vec3(1.0, 0.98, 0.94), head.mul(0.3)).mul(light).mul(vGain).mul(2.6)
            .mul(u.breath), 0.0);
    })();
    mesh.material = material;
    const part = vcPart('VesperChrysalisMeteors', geometry, material, 61, { mesh });
    part.count = METEOR_SLOTS;
    part.cursor = 0;
    const dir = [0, 0, 0];
    const end = [0, 0, 0];
    /**
     * A shooting star: from (azimuth, elevation) it crosses `sweep` radians of sky on `heading`
     * (radians: 0 = to the right along the horizon, −π/2 = straight down).
     */
    part.fire = ({
        azimuth, elevation, heading = -0.9, sweep = 0.22, time, life = 0.9, rgb = [1, 0.95, 0.85], strength = 1,
    }) => {
        const i = part.cursor % METEOR_SLOTS;
        part.cursor += 1;
        skyDirection(azimuth, elevation, dir);
        skyDirection(azimuth + Math.cos(heading) * sweep, elevation + Math.sin(heading) * sweep, end);
        start[i].set(dir[0], dir[1], dir[2], time);
        run[i].set(end[0] - dir[0], end[1] - dir[1], end[2] - dir[2], life);
        tint[i].set(rgb[0], rgb[1], rgb[2], strength);
        return i;
    };
    part.reset = () => {
        part.cursor = 0;
        for (let i = 0; i < METEOR_SLOTS; i++) {
            start[i].w = -100;
            tint[i].w = 0;
        }
    };
    return part;
}
