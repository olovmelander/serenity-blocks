/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — shooting stars.
 *
 * In a dark sky one falls now and then by itself, and a crown at night brings a whole shower.
 * Each is a streak on the sky: a bright head and the trail it leaves, a few pixels wide, running
 * along a great circle for half a second and gone. They are directions, not places: the streak
 * rides with the lens like the stars behind it, and the sea and the islands hide what is below
 * the horizon.
 *
 * One instanced draw of narrow ribbons that face the lens. The CPU keeps each one's path in
 * closed form (where it started, where it ends, when, how long) and writes head, tail and
 * brightness every frame.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, cross, exp, max, mix, normalize, uv, vec3, vec4,
} from 'three/tsl';
import { uploadUsed } from '../shared/instance-upload.js';
import { clamp01 } from './sunset-core.js';

/** How far out the streaks are drawn (inside the sky dome, inside the lens's far plane). */
export const METEOR_FAR = 20000;
/** The share of a meteor's path its trail covers behind the head. */
export const METEOR_TRAIL = 0.34;

/** A meteor's head and brightness `s` (0..1) of the way along its path. */
export function meteorAt(m, s, out = {
    x: 0, y: 0, z: 0, glow: 0,
}) {
    const t = clamp01(s);
    const x = m.x0 + (m.x1 - m.x0) * t;
    const y = m.y0 + (m.y1 - m.y0) * t;
    const z = m.z0 + (m.z1 - m.z0) * t;
    const l = Math.hypot(x, y, z) || 1;
    out.x = x / l;
    out.y = y / l;
    out.z = z / l;
    // It flares up fast and burns out.
    out.glow = Math.sin(Math.PI * Math.min(1, t * 1.15) ** 0.6) ** 0.8;
    return out;
}

export function createMeteors({ capacity = 16, U }) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const head = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const tail = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    [head, tail, tint].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aHead', head);
    geometry.setAttribute('aTail', tail);
    geometry.setAttribute('aTint', tint);

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
        side: THREE.DoubleSide,
    });
    material.name = 'sunset-meteors';
    const aHead = attribute('aHead', 'vec4');
    const aTail = attribute('aTail', 'vec4');
    const aTint = attribute('aTint', 'vec4');
    material.vertexNode = Fn(() => {
        // Directions (w = 0): the streak rides with the lens.
        const h = cameraViewMatrix.mul(vec4(aHead.xyz, 0.0)).xyz.toVar();
        const t = cameraViewMatrix.mul(vec4(aTail.xyz, 0.0)).xyz.toVar();
        const st = uv();
        const mid = mix(t, h, st.x).toVar();
        const across = normalize(cross(mid, h.sub(t)).add(vec3(1e-6, 0.0, 0.0)));
        // A few pixels wide however long the lens.
        const width = max(aTail.w, U.pixelAngle.mul(4.5));
        const at = mid.add(across.mul(st.y.sub(0.5)).mul(width)).mul(METEOR_FAR);
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const st = uv();
        const c = st.y.sub(0.5).mul(2.0);
        const core = exp(c.mul(c).mul(-7.0));
        // The trail thins and fades behind the head; the head is a hot point near the front.
        const a = st.x;
        const trail = a.mul(a).mul(a);
        const lead = a.sub(0.93).div(0.035);
        const spark = exp(lead.mul(lead).negate()).mul(4.5);
        return vec4(aTint.xyz.mul(core.mul(trail.add(spark)).mul(aTint.w)), 0.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'sunset-meteors';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 55;

    /** Paths: where each starts and ends (unit directions), when, how long, how bright, its colour. */
    const paths = Array.from({ length: capacity }, () => ({
        at: -100, life: 1, x0: 0, y0: 1, z0: 0, x1: 0, y1: 1, z1: 0, glow: 0, r: 1, g: 1, b: 1,
    }));
    let cursor = 0;
    let sent = 0;
    const at = {
        x: 0, y: 0, z: 0, glow: 0,
    };
    const behind = {
        x: 0, y: 0, z: 0, glow: 0,
    };

    return {
        mesh,
        capacity,
        /**
         * One falls: from the direction `from` to `to` (unit vectors, y up), starting at `clock`
         * (it may be in the future) and taking `life` seconds. `glow` is its brightness.
         */
        send(clock, from, to, life, glow, rgb = [0.86, 0.93, 1.0]) {
            const m = paths[cursor];
            cursor = (cursor + 1) % capacity;
            sent += 1;
            m.at = clock;
            m.life = Math.max(0.1, life);
            m.x0 = from.x;
            m.y0 = from.y;
            m.z0 = from.z;
            m.x1 = to.x;
            m.y1 = to.y;
            m.z1 = to.z;
            m.glow = glow;
            [m.r, m.g, m.b] = rgb;
        },
        /** How many are on the sky at `clock`. */
        falling(clock) {
            let n = 0;
            for (let i = 0; i < capacity; i += 1) {
                const s = (clock - paths[i].at) / paths[i].life;
                if (s >= 0 && s <= 1) n += 1;
            }
            return n;
        },
        get sent() {
            return sent;
        },
        reset() {
            paths.forEach((m) => {
                m.at = -100;
            });
            mesh.count = 0;
        },
        update(clock) {
            let n = 0;
            for (let i = 0; i < capacity; i += 1) {
                const m = paths[i];
                const s = (clock - m.at) / m.life;
                if (!(s >= 0 && s <= 1)) continue;
                meteorAt(m, s, at);
                meteorAt(m, Math.max(0, s - METEOR_TRAIL), behind);
                head.setXYZW(n, at.x, at.y, at.z, 0);
                // (A trail of no length would leave the ribbon no direction: the shader guards it,
                // and the first frame's trail is only a hair long.)
                tail.setXYZW(n, behind.x, behind.y, behind.z, 0);
                tint.setXYZW(n, m.r, m.g, m.b, m.glow * at.glow);
                n += 1;
            }
            mesh.count = n;
            if (n > 0) uploadUsed([head, tail, tint], n * 4);
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
