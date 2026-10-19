/**
 * Grainfields — where the herd has gone through the barley.
 *
 * A horse in a metre of ripe barley parts it: the stalks round its body lean away from it, are
 * pushed on ahead of a running one, and are left laid over in its wake, standing back up over a
 * few seconds. Each frame the herd's horses are pressed into a small field of numbers over the near
 * field (a cell a little over a metre square): which way the stalks there lean (x, z) and how far
 * they are laid over; the field relaxes back toward upright. It goes up to the GPU as a texture the
 * barley's vertex stage reads at each clump's root (grainfields-grain.js).
 */
import * as THREE from 'three/webgpu';
import { texture, vec2 } from 'three/tsl';
import { smooth } from './grainfields-core.js';

/**
 * The field: its corner and size on the ground (metres), its cells, and how fast the stalks stand
 * back up (seconds: the lean relaxes faster than a laid stalk rises).
 */
export const TRAMPLE = Object.freeze({
    x0: -90, z0: -126, width: 180, depth: 135, cols: 160, rows: 120, relax: 1.4, rise: 5,
});

/** The stalks' lean and lay at a ground point (xz node): { push (vec2, -1..1), lay (0..1) }. */
export function trampleAt(t, xz) {
    const uv = vec2(xz.x.sub(TRAMPLE.x0).div(TRAMPLE.width), xz.y.sub(TRAMPLE.z0).div(TRAMPLE.depth));
    const s = texture(t.trample, uv).level(0);
    return { push: s.xy.mul(2.0).sub(1.0), lay: s.z };
}

/**
 * The field and its texture. `press(horses, dt)` relaxes it and presses the horses in (each
 * { x, z, heading, speed, scale }); returns whether the texture changed.
 */
export function createTrample() {
    const { cols, rows } = TRAMPLE;
    const lean = new Float32Array(cols * rows * 2);
    const lay = new Float32Array(cols * rows);
    const bytes = new Uint8Array(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) {
        bytes[i * 4] = 128;
        bytes[i * 4 + 1] = 128;
        bytes[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(bytes, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'grainfields-trample';
    tex.needsUpdate = true;
    const cellX = TRAMPLE.width / cols;
    const cellZ = TRAMPLE.depth / rows;
    let live = false;

    const pressHorse = (h) => {
        const scale = h.scale || 1;
        const moving = smooth(0.3, 6, h.speed || 0);
        // The body as a segment along the heading, the stalks parted out to a metre beside it.
        const half = 0.75 * scale;
        const body = (0.4 + 0.15 * moving) * scale;
        const reach = body + 0.9 + 0.5 * moving;
        const fx = Math.sin(h.heading);
        const fz = Math.cos(h.heading);
        const ax = h.x - fx * half;
        const az = h.z - fz * half;
        const i0 = Math.max(1, Math.floor((Math.min(ax, h.x + fx * half) - reach - TRAMPLE.x0) / cellX));
        const i1 = Math.min(cols - 2, Math.ceil((Math.max(ax, h.x + fx * half) + reach - TRAMPLE.x0) / cellX));
        const j0 = Math.max(1, Math.floor((Math.min(az, h.z + fz * half) - reach - TRAMPLE.z0) / cellZ));
        const j1 = Math.min(rows - 2, Math.ceil((Math.max(az, h.z + fz * half) + reach - TRAMPLE.z0) / cellZ));
        if (i0 > i1 || j0 > j1) return false;
        for (let j = j0; j <= j1; j++) {
            const z = TRAMPLE.z0 + (j + 0.5) * cellZ;
            for (let i = i0; i <= i1; i++) {
                const x = TRAMPLE.x0 + (i + 0.5) * cellX;
                // The nearest point of the body's segment.
                const t = Math.max(0, Math.min(2 * half, (x - ax) * fx + (z - az) * fz));
                const ox = x - (ax + fx * t);
                const oz = z - (az + fz * t);
                const d = Math.hypot(ox, oz);
                const k = 1 - smooth(body * 0.5, reach, d);
                if (k <= 0) continue;
                // Away from the body, and on ahead of a running horse.
                let px = (d > 1e-4 ? ox / d : 0) + fx * 0.6 * moving;
                let pz = (d > 1e-4 ? oz / d : 0) + fz * 0.6 * moving;
                const n = Math.hypot(px, pz) || 1;
                const strength = k * (0.35 + 0.65 * moving);
                px = (px / n) * strength;
                pz = (pz / n) * strength;
                const c = j * cols + i;
                if (strength * strength > lean[c * 2] ** 2 + lean[c * 2 + 1] ** 2) {
                    lean[c * 2] = px;
                    lean[c * 2 + 1] = pz;
                }
                lay[c] = Math.max(lay[c], k * (0.2 + 0.8 * moving));
            }
        }
        return true;
    };

    return {
        texture: tex,
        get live() { return live; },
        press(horses, dt) {
            const relax = Math.exp(-Math.max(0, dt) / TRAMPLE.relax);
            const rise = Math.exp(-Math.max(0, dt) / TRAMPLE.rise);
            let pressed = false;
            (horses || []).forEach((h) => { pressed = pressHorse(h) || pressed; });
            if (!live && !pressed) return false;
            let any = false;
            for (let c = 0; c < cols * rows; c++) {
                const lx = lean[c * 2] * relax;
                const lz = lean[c * 2 + 1] * relax;
                const l = lay[c] * rise;
                lean[c * 2] = lx;
                lean[c * 2 + 1] = lz;
                lay[c] = l;
                const o = c * 4;
                bytes[o] = Math.round(127.5 + lx * 127.5);
                bytes[o + 1] = Math.round(127.5 + lz * 127.5);
                bytes[o + 2] = Math.round(l * 255);
                if (l > 0.004 || Math.abs(lx) > 0.004 || Math.abs(lz) > 0.004) any = true;
            }
            live = any;
            tex.needsUpdate = true;
            return true;
        },
        /** Everything upright again (a seek). */
        clear() {
            lean.fill(0);
            lay.fill(0);
            for (let c = 0; c < cols * rows; c++) {
                bytes[c * 4] = 128;
                bytes[c * 4 + 1] = 128;
                bytes[c * 4 + 2] = 0;
            }
            live = false;
            tex.needsUpdate = true;
        },
        dispose() {
            tex.dispose();
        },
    };
}
