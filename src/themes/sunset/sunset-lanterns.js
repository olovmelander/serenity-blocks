/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — what the lanterns are drawn with.
 *
 *   createLanterns   the paper lanterns: one instanced mesh, a tapered shell of paper on a small
 *                    dark float, lit from inside by its flame in the piece's colour. The CPU
 *                    writes each one's place, lean and glow every frame (sunset-lantern-pool.js).
 *   createGlows      one additive layer of soft lights that face the lens: each lantern's halo,
 *                    the lights in flight from the card, the drops of a splash. Each keeps a few
 *                    pixels across however far away it is, so a lantern over the horizon is still
 *                    a spark.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, exp, float, fract, max, mix, positionGeometry,
    sin, smoothstep, uv, vec3, vec4,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANTERN_HEIGHT } from './sunset-lantern-pool.js';

/** The lantern: a tapered paper shell (open below, its flame inside) on a thin dark float. */
export function buildLanternGeometry() {
    const h = LANTERN_HEIGHT;
    const profile = [];
    const steps = 9;
    for (let i = 0; i <= steps; i += 1) {
        const v = i / steps;
        // Narrow at the mouth, widest high up, rounded in at the crown.
        const crown = Math.max(0, v - 0.86) / 0.14;
        const r = 0.15 + 0.11 * Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.5) - 0.05 * crown;
        profile.push(new THREE.Vector2(Math.max(0.02, r), 0.06 + v * h));
    }
    profile.push(new THREE.Vector2(0.001, 0.06 + h + 0.012));
    const shell = new THREE.LatheGeometry(profile, 14);
    const raft = new THREE.CylinderGeometry(0.2, 0.22, 0.05, 14, 1);
    raft.translate(0, 0.025, 0);
    const tag = (g, part) => {
        const n = g.attributes.position.count;
        g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
        return g.index ? g.toNonIndexed() : g;
    };
    const merged = mergeGeometries([tag(shell, 0), tag(raft, 1)], false);
    merged.computeBoundingSphere();
    return merged;
}

export function createLanterns({ capacity, U }) {
    const geometry = buildLanternGeometry();
    const lamp = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    lamp.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aLamp', lamp);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'sunset-lanterns';
    const aLamp = attribute('aLamp', 'vec4');
    const part = attribute('aPart', 'float');
    material.colorNode = Fn(() => {
        const st = uv();
        const colour = aLamp.xyz;
        const glow = aLamp.w;
        // Paper: brightest low down near the flame, a hot band where the flame stands, the
        // bamboo ribs dark against it, a fine fibre in the paper.
        const v = st.y;
        const heart = exp(v.sub(0.22).div(0.42).pow2().negate()).mul(1.55).add(0.32);
        const ribs = float(1.0).sub(smoothstep(0.86, 0.99, cos(st.x.mul(Math.PI * 2 * 7))).mul(0.42));
        const hoop = float(1.0).sub(smoothstep(0.05, 0.0, v).mul(0.5)).sub(smoothstep(0.94, 1.0, v).mul(0.45));
        const fibre = fract(sin(st.x.mul(431.0).add(v.mul(97.0))).mul(4375.85)).mul(0.08).add(0.96);
        const candle = mix(colour, vec3(1.0, 0.72, 0.38), 0.22);
        const paper = candle.mul(heart.mul(ribs).mul(hoop).mul(fibre)).mul(glow).mul(2.4);
        // The sky's light on its outside, faint against the flame.
        const lit = paper.add(U.light.ambient.mul(colour).mul(0.06));
        // The float: dark lacquered wood, the flame's light on its rim.
        const wood = vec3(0.025, 0.016, 0.012).add(candle.mul(glow).mul(0.12));
        return vec4(mix(lit, wood, clamp(part, 0.0, 1.0)), 1.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'sunset-lanterns';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const spin = new THREE.Quaternion();
    return {
        mesh,
        /** Start writing a frame's lanterns. */
        begin() {
            mesh.count = 0;
        },
        /** One lantern: its foot, the slope it leans on, its scale, colour, glow and seed. */
        push(x, y, z, tiltX, tiltZ, scale, rgb, glow, seed) {
            const i = mesh.count;
            if (i >= capacity) return;
            n.set(-tiltX, 1, -tiltZ).normalize();
            q.setFromUnitVectors(UP, n);
            spin.setFromAxisAngle(UP, seed * Math.PI * 2);
            q.multiply(spin);
            p.set(x, y, z);
            s.setScalar(scale);
            m.compose(p, q, s);
            mesh.setMatrixAt(i, m);
            lamp.setXYZW(i, rgb[0], rgb[1], rgb[2], glow);
            mesh.count = i + 1;
        },
        end() {
            mesh.instanceMatrix.needsUpdate = true;
            lamp.needsUpdate = true;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * The soft lights: `capacity` quads that face the lens, written every frame.
 * Each: centre (world), radius (metres; never less than `minPixels` pixels), colour × intensity,
 * and a shape (0 a round glow with a hot core, 1 a soft disc only).
 */
export function createGlows({ capacity, U, minPixels = 3 }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    b.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aGlowA', a);
    geometry.setAttribute('aGlowB', b);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = 'sunset-glows';
    const A = attribute('aGlowA', 'vec4');
    const B = attribute('aGlowB', 'vec4');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(A.xyz, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.01);
        const radius = max(A.w, depth.mul(U.pixelAngle).mul(minPixels));
        const at = view.xyz.add(vec3(positionGeometry.xy.mul(radius), 0.0));
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    const shapeOf = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        const r2 = d.dot(d);
        const halo = exp(r2.mul(-4.5));
        const core = exp(r2.mul(-60.0)).mul(2.2);
        const rim = float(1.0).sub(smoothstep(0.55, 1.0, r2));
        const glow = mix(halo.add(core), halo.mul(rim), B.w.greaterThan(0.5).select(1.0, 0.0));
        return B.xyz.mul(glow);
    });
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = vec4(shapeOf(), 0.0);

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'sunset-glows';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    return {
        mesh,
        get count() {
            return mesh.count;
        },
        begin() {
            mesh.count = 0;
        },
        push(x, y, z, radius, r, g, bl, shape = 0) {
            const i = mesh.count;
            if (i >= capacity) return;
            a.setXYZW(i, x, y, z, radius);
            b.setXYZW(i, r, g, bl, shape);
            mesh.count = i + 1;
        },
        end() {
            a.needsUpdate = true;
            b.needsUpdate = true;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
