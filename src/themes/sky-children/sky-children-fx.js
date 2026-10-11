/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: the two light layers the events are drawn in, and the spray.
 *
 *   glows   one additive layer of camera-facing lights, refilled every frame from the closed-form
 *           effect pools (sky-children-events.js): a lock's light-copy of the piece and its melting
 *           beads, the thread of light-water's droplets, crowns of glints, the clear's sheets, the
 *           children's trails and brush heads, the sleepers in the grotto at night. Shapes: 0 a glow
 *           with a hot core, 1 a soft disc, 2 a rounded square (a cell), 3 a four-point glint, 4 a
 *           streak along its motion. A light never shrinks below a few pixels.
 *   spray   soft billboards of spray at the falls' feet and lips, front-lit white, laid over what is
 *           behind them; every spray pixel adds the droplet optics of its own direction, so the bow
 *           really stands in the spray (faintly even at rest: the promise of the bow).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, length,
    max, min, mix, normalize, positionGeometry, smoothstep, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    horizonHaze, luma, optics, skyBase,
} from './sky-children-tsl.js';

/** Glow shapes. */
export const GLOW = Object.freeze({
    glow: 0, disc: 1, cell: 2, glint: 3, streak: 4, ring: 5,
});

/**
 * @param {object} p
 * @param {number} p.capacity
 * @param {object} p.U         (U.pixelAngle)
 * @param {number} [p.minPixels=2.5]
 */
export function createGlows({ capacity, U, minPixels = 2.5 }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const data = new Float32Array(capacity * 12);
    const buffer = new THREE.InstancedInterleavedBuffer(data, 12);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aGlowA', new THREE.InterleavedBufferAttribute(buffer, 4, 0)); // xyz, radius
    geometry.setAttribute('aGlowB', new THREE.InterleavedBufferAttribute(buffer, 4, 4)); // rgb, shape
    geometry.setAttribute('aGlowC', new THREE.InterleavedBufferAttribute(buffer, 4, 8)); // motion xyz (world), stretch
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = 'sky-children-glows';
    const A = attribute('aGlowA', 'vec4');
    const B = attribute('aGlowB', 'vec4');
    const C = attribute('aGlowC', 'vec4');
    const vUv = varying(vec2(0.0), 'vGlowUv');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(A.xyz, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.01);
        const radius = max(A.w, depth.mul(U.pixelAngle).mul(minPixels));
        // A streak lies along its motion as seen on screen.
        const mv = cameraViewMatrix.mul(vec4(C.xyz, 0.0)).xy;
        const ml = length(mv);
        const along = mv.div(max(ml, 1e-5));
        const stretch = max(C.w, 1.0);
        const across = vec2(along.y.negate(), along.x);
        const g = positionGeometry.xy;
        const isStreak = smoothstep(3.5, 4.5, B.w).mul(smoothstep(1e-4, 1e-3, ml));
        const streaked = along.mul(g.x.mul(stretch)).add(across.mul(g.y));
        const offset = mix(g, streaked, isStreak).mul(radius);
        vUv.assign(g);
        return cameraProjectionMatrix.mul(vec4(view.xyz.add(vec3(offset, 0.0)), 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const d = vUv;
        const r2 = dot(d, d);
        const shape = B.w;
        const halo = exp(r2.mul(-4.5));
        const core = exp(r2.mul(-60.0)).mul(2.2);
        const glow = halo.add(core);
        const disc = float(1.0).sub(smoothstep(0.35, 1.0, r2)).mul(0.9);
        // A rounded square: the cell of a piece.
        const q = max(abs(d).sub(0.5), vec2(0.0));
        const box = float(1.0).sub(smoothstep(0.2, 0.5, length(q))).mul(1.1).add(halo.mul(0.4));
        // A four-point glint.
        const star = exp(abs(d.x).mul(-14.0)).mul(exp(abs(d.y).mul(-2.6)))
            .add(exp(abs(d.y).mul(-14.0)).mul(exp(abs(d.x).mul(-2.6))))
            .add(core.mul(0.5));
        const streak = exp(r2.mul(-3.0)).add(exp(d.y.mul(d.y).mul(-40.0)).mul(exp(d.x.mul(d.x).mul(-2.0))).mul(0.8));
        // A shock ring: a thin bright annulus with a soft glow inside it.
        const rr = r2.sqrt();
        const ring = exp(rr.sub(0.78).div(0.06).pow2().negate()).add(exp(rr.sub(0.7).div(0.2).pow2().negate()).mul(0.25));
        const pick = (k) => float(1.0).sub(smoothstep(0.0, 0.5, abs(shape.sub(k))));
        const v = glow.mul(pick(0)).add(disc.mul(pick(1))).add(box.mul(pick(2))).add(star.mul(pick(3)))
            .add(streak.mul(pick(4)))
            .add(ring.mul(pick(5)));
        return vec4(B.xyz.mul(v), 0.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'sky-children-glows';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    let count = 0;
    return {
        mesh,
        capacity,
        get count() {
            return count;
        },
        begin() {
            count = 0;
        },
        /** One light: world position, radius (m), colour (scene-linear HDR), shape, motion for streaks. */
        push(x, y, z, radius, r, g, b, shape = 0, mx = 0, my = 0, mz = 0, stretch = 1) {
            if (count >= capacity) return false;
            const o = count * 12;
            data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = radius;
            data[o + 4] = r; data[o + 5] = g; data[o + 6] = b; data[o + 7] = shape;
            data[o + 8] = mx; data[o + 9] = my; data[o + 10] = mz; data[o + 11] = stretch;
            count += 1;
            return true;
        },
        end() {
            mesh.count = count;
            buffer.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose();
        },
    };
}

/**
 * Spray billboards: soft puffs, premultiplied over, carrying the bow.
 *
 * @param {object} p
 * @param {number} p.capacity
 * @param {object} p.U
 * @param {object} p.tex   { puff, lut, noise }
 */
export function createSpray({ capacity, U, tex }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const data = new Float32Array(capacity * 8);
    const buffer = new THREE.InstancedInterleavedBuffer(data, 8);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSprayA', new THREE.InterleavedBufferAttribute(buffer, 4, 0)); // xyz, radius
    geometry.setAttribute('aSprayB', new THREE.InterleavedBufferAttribute(buffer, 4, 4)); // density, spin, tint, bow
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    material.name = 'sky-children-spray';
    const A = attribute('aSprayA', 'vec4');
    const B = attribute('aSprayB', 'vec4');
    const vUv = varying(vec2(0.0), 'vSprayUv');
    const vDir = varying(vec3(0.0, 0.0, -1.0), 'vSprayDir');
    const vDepth = varying(float(0.0), 'vSprayDepth');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(A.xyz, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.01);
        vDepth.assign(depth);
        const radius = max(A.w, depth.mul(U.pixelAngle).mul(3.0));
        const c = B.y.cos();
        const s = B.y.sin();
        const g = positionGeometry.xy;
        const rot = vec2(g.x.mul(c).sub(g.y.mul(s)), g.x.mul(s).add(g.y.mul(c)));
        vUv.assign(g.mul(0.5).add(0.5));
        const at = view.xyz.add(vec3(rot.mul(radius), 0.0));
        // The world direction to this point of the puff (for the optics).
        const inv = cameraViewMatrix.transpose();
        vDir.assign(normalize(inv.mul(vec4(at, 0.0)).xyz));
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const { light } = U;
        const puff = texture(tex.puff, vUv);
        const density = clamp(puff.a.mul(B.x), 0.0, 1.0).toVar();
        const dir = normalize(vDir);
        // Front-lit spray: the key behind the eye (whitened), the sky through it, cool in its depths.
        const key = mix(vec3(luma(light.key)), light.key, 0.45);
        const lit = key.mul(U.keyGain).mul(0.42).add(skyBase(vec3(0.0, 1.0, 0.0), U).mul(0.7));
        const colour = mix(lit, light.mistLit, B.z.mul(0.5).add(0.15)).toVar();
        // The bow in the spray: the painted strokes, and at rest a faint promise of it.
        const opt = optics(dir, U, tex, {
            rain: float(1.0), deep: false, deepMist: float(0.0), rest: B.w,
        }).xyz;
        colour.addAssign(opt.mul(3.0));
        // The air between, as the stone has.
        colour.assign(mix(colour, horizonHaze(dir, U), min(float(1.0).sub(exp(vDepth.div(-3000.0))), 0.8)));
        const alpha = density.mul(0.085);
        return vec4(colour.mul(alpha), alpha);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'sky-children-spray';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 58;
    let count = 0;
    return {
        mesh,
        capacity,
        get count() {
            return count;
        },
        begin() {
            count = 0;
        },
        push(x, y, z, radius, density, spin = 0, tint = 0, bow = 0) {
            if (count >= capacity) return false;
            const o = count * 8;
            data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = radius;
            data[o + 4] = density; data[o + 5] = spin; data[o + 6] = tint; data[o + 7] = bow;
            count += 1;
            return true;
        },
        end() {
            mesh.count = count;
            buffer.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose();
        },
    };
}

export { min, length, cameraPosition };
