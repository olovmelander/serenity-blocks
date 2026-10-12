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
 *   spray   soft lit billboards of spray at the falls' lips, along their edges and in the plume where
 *           they go to mist, laid over what is behind them far to near; every spray pixel adds the
 *           droplet optics of its own direction, so the bow really stands in the spray (faintly even
 *           at rest: the promise of the bow).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, length,
    max, min, mix, normalize, positionGeometry, smoothstep, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    bowStrokes, horizonHaze, luma, optics, skyBase,
} from './sky-children-tsl.js';

/** Glow shapes. */
export const GLOW = Object.freeze({
    glow: 0, disc: 1, cell: 2, glint: 3, streak: 4, ring: 5, soft: 6,
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
    const vAir = varying(float(0.0), 'vGlowAir');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(A.xyz, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.01);
        // Far lights lie in the air as the stone does (a thread out over the gulf is softer).
        vAir.assign(float(1.0).sub(exp(depth.div(-2600.0))));
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
        // A soft bead with no hot core: overlapping, they draw one smooth ribbon.
        const soft = exp(r2.mul(-3.2));
        const pick = (k) => float(1.0).sub(smoothstep(0.0, 0.5, abs(shape.sub(k))));
        const v = glow.mul(pick(0)).add(disc.mul(pick(1))).add(box.mul(pick(2))).add(star.mul(pick(3)))
            .add(streak.mul(pick(4)))
            .add(ring.mul(pick(5)))
            .add(soft.mul(pick(6)));
        return vec4(B.xyz.mul(v).mul(float(1.0).sub(vAir.mul(0.55))), 0.0);
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

/** What a puff of spray is part of: each draws its own way (its alpha cap, its form). */
export const SPRAY_ROLE = Object.freeze({
    lip: 0, veil: 1, plume: 2, foot: 3,
});

/**
 * Spray billboards: soft lit puffs, premultiplied over, carrying the bow.
 *
 * Each puff is lit as a cumulus is (nimbus-veil's model): a normal for the whole plume (out from
 * the fall's line, turning up toward its crown, a little toward us) bent by the puff's own sphere,
 * wrapped round the key from behind the eye; the shade is luminous (the mist's own light and the
 * sky's, never below most of the mist's lit colour: spray is optically thin and front-lit, a pale
 * glow at night, never smoke), each billow's underside a little darker. How opaque a puff may get
 * depends on its role: the plume dense, the edge veil a breath, the lip and a thread's foot between.
 *
 * @param {object} p
 * @param {number} p.capacity
 * @param {object} p.U
 * @param {object} p.tex   { puff, lut, noise }
 */
export function createSpray({ capacity, U, tex }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const data = new Float32Array(capacity * 12);
    const buffer = new THREE.InstancedInterleavedBuffer(data, 12);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSprayA', new THREE.InterleavedBufferAttribute(buffer, 4, 0)); // xyz, radius
    geometry.setAttribute('aSprayB', new THREE.InterleavedBufferAttribute(buffer, 4, 4)); // density, spin, tint, bow
    geometry.setAttribute('aSprayC', new THREE.InterleavedBufferAttribute(buffer, 4, 8)); // outward x, z, height, role
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
    const C = attribute('aSprayC', 'vec4');
    const vUv = varying(vec2(0.0), 'vSprayUv');
    // The corner as seen on screen (the puff's texture turns with it; its light does not).
    const vLocal = varying(vec2(0.0), 'vSprayLocal');
    const vDir = varying(vec3(0.0, 0.0, -1.0), 'vSprayDir');
    const vDepth = varying(float(0.0), 'vSprayDepth');
    // The bow's strokes at each corner of a puff (the stroke loops run per vertex, not per pixel).
    const vStrokes = varying(vec4(0.0), 'vSprayStrokes');
    const vThread = varying(vec3(0.0), 'vSprayThread');
    const vThread2 = varying(vec3(0.0), 'vSprayThread2');
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
        vLocal.assign(rot);
        const at = view.xyz.add(vec3(rot.mul(radius), 0.0));
        // The world direction to this point of the puff (for the optics).
        const inv = cameraViewMatrix.transpose();
        const dir = normalize(inv.mul(vec4(at, 0.0)).xyz).toVar();
        vDir.assign(dir);
        const thread = vec3(0.0).toVar();
        const thread2 = vec3(0.0).toVar();
        vStrokes.assign(bowStrokes(dir, U, thread, thread2));
        vThread.assign(thread);
        vThread2.assign(thread2);
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const { light } = U;
        const puff = texture(tex.puff, vUv);
        const role = C.w;
        // Billowing, not a disc: the puff eroded by noise that turns with the puff. A plume's (and a
        // foot's) billows are bodies with a frayed but definite edge, as a cumulus's are, so the
        // plume reads as heaped billows and never as a slab of fog; the lip's and the veil's stay soft.
        const n = texture(tex.noise, vUv.mul(0.55).add(vec2(B.y.mul(0.13), B.z.mul(0.71)))).g;
        const soft = puff.a.mul(smoothstep(0.25, 0.7, n.add(puff.a.mul(0.25))));
        const body = float(1.0).sub(smoothstep(0.42, 0.95, length(vLocal).add(n.sub(0.5).mul(0.8))));
        const billows = smoothstep(1.4, 1.6, role);
        const density = clamp(mix(soft, body, billows).mul(B.x), 0.0, 1.6).toVar();
        const dir = normalize(vDir);
        // The camera's axes in the world (rows of the view matrix).
        const inv = cameraViewMatrix.transpose();
        const camR = inv.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
        const camU = inv.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        const camB = inv.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz;
        const lx = vLocal.x;
        const ly = vLocal.y;
        const nz = max(float(1.0).sub(lx.mul(lx)).sub(ly.mul(ly)), 0.0).sqrt();
        // The plume's form: out from the fall's line, up toward its crown, a little toward us.
        const height = C.z;
        const towerN = normalize(vec3(C.x, 0.0, C.y).mul(2.0).add(vec3(0.0, height.mul(1.5).sub(0.4), 0.0)).add(camB.mul(0.3)));
        const puffN = camR.mul(lx).add(camU.mul(ly)).add(camB.mul(nz));
        const N = normalize(towerN.add(puffN.mul(0.65)));
        const diff = clamp(dot(N, U.key).mul(0.5).add(0.5), 0.0, 1.0);
        // Lit in the key (whitened; it never outshines the white water it comes from); its shade
        // is the sky's cool light in the spray with the mist's glow (luminous, never grey).
        const key = mix(vec3(luma(light.key)), light.key, 0.45).mul(U.keyGain.mul(0.46));
        const sky = skyBase(vec3(0.0, 1.0, 0.0), U);
        const shade = max(mix(sky, light.mistLit, 0.35).mul(0.72), light.mistLit.mul(0.55));
        const lit = mix(shade, max(key, shade), diff.pow(1.3)).toVar();
        // Toward its foot the plume's own mass shades it, and each billow's underside sits in the
        // shade of the one below it (the cauliflower relief).
        lit.mulAssign(mix(float(0.78), float(1.0), smoothstep(0.0, 0.55, height).mul(billows).add(float(1.0).sub(billows))));
        lit.mulAssign(float(1.0).sub(float(1.0).sub(smoothstep(-0.85, 0.15, ly)).mul(mix(float(0.22), float(0.3), billows))));
        const colour = mix(lit, light.mistLit.mul(0.85), B.z.mul(0.2)).toVar();
        // The bow in the spray: the painted strokes, and at rest a faint promise of it.
        const opt = optics(dir, U, tex, {
            rain: float(1.0),
            deep: false,
            deepMist: float(0.0),
            rest: B.w,
            strokes: { masks: vStrokes, thread: vThread, thread2: vThread2 },
        }).xyz;
        colour.addAssign(opt.mul(3.0));
        // The air between, as the stone has.
        colour.assign(mix(colour, horizonHaze(dir, U), min(float(1.0).sub(exp(vDepth.div(-3000.0))), 0.8)));
        // How opaque a puff may get: the lip 0.3, the edge veil 0.14, the plume 0.7, a thread's foot 0.35.
        const cap = mix(
            mix(float(0.3), float(0.14), smoothstep(0.4, 0.6, role)),
            mix(float(0.7), float(0.35), smoothstep(2.4, 2.6, role)),
            billows,
        );
        const alpha = min(density.mul(cap).mul(0.85), cap);
        return vec4(colour.mul(alpha), alpha);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'sky-children-spray';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 58;
    let count = 0;
    // The far-to-near order (premultiplied over needs it): keys and a scratch copy, allocated once.
    const keys = new Float32Array(capacity);
    const order = new Uint32Array(capacity);
    const sorted = new Float32Array(capacity * 12);
    const byDepth = (a, b) => keys[b] - keys[a];
    return {
        mesh,
        capacity,
        get count() {
            return count;
        },
        begin() {
            count = 0;
        },
        /**
         * One puff: where (m), how big (m), how dense, its spin and tint, the bow it carries at rest,
         * which way is out from the fall's line (x, z), how far up its plume (0..1), its role.
         */
        push(x, y, z, radius, density, spin = 0, tint = 0, bow = 0, ox = 0, oz = 0, height = 0.5, role = SPRAY_ROLE.plume) {
            if (count >= capacity) return false;
            const o = count * 12;
            data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = radius;
            data[o + 4] = density; data[o + 5] = spin; data[o + 6] = tint; data[o + 7] = bow;
            data[o + 8] = ox; data[o + 9] = oz; data[o + 10] = height; data[o + 11] = role;
            count += 1;
            return true;
        },
        /** Order the puffs far to near from an eye (each is laid over what is behind it). */
        sort(ex, ey, ez) {
            for (let k = 0; k < count; k++) {
                const o = k * 12;
                keys[k] = (data[o] - ex) ** 2 + (data[o + 1] - ey) ** 2 + (data[o + 2] - ez) ** 2;
                order[k] = k;
            }
            order.subarray(0, count).sort(byDepth);
            for (let k = 0; k < count; k++) sorted.set(data.subarray(order[k] * 12, order[k] * 12 + 12), k * 12);
            data.set(sorted.subarray(0, count * 12));
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
