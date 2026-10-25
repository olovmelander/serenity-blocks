/**
 * Grainfields — where the herd has gone through the barley.
 *
 * A horse in a metre of ripe barley parts it: the stalks round its body lean away from it, are
 * pushed on ahead of a running one, and are left laid over in its wake, standing back up over a
 * few seconds. Each frame the herd's horses are pressed into a small field of numbers over the near
 * field (a cell a little over a metre square): which way the stalks there lean (x, z) and how far
 * they are laid over. A stalk is a spring: pushed, it leans over after the push a moment late; let
 * go, it swings back past upright and sways itself still, so a horse leaves the barley rocking
 * behind it. The lay relaxes slowly. It goes up to the GPU as a texture the barley's vertex stage
 * reads at each clump's root (grainfields-grain.js).
 */
import * as THREE from 'three/webgpu';
import {
    If, Loop, float, int, length, max, smoothstep, texture, vec2,
} from 'three/tsl';
import { smooth } from './grainfields-core.js';

/**
 * The field: its corner and size on the ground (metres), its cells, and how fast the stalks stand
 * back up (seconds: the lean relaxes faster than a laid stalk rises).
 */
export const TRAMPLE = Object.freeze({
    x0: -90, z0: -126, width: 180, depth: 135, cols: 160, rows: 120, relax: 1.4, rise: 5,
});
/** A stalk's spring: how fast it swings (rad/s) and how little it is damped. */
export const STALK = Object.freeze({ omega: 5.6, zeta: 0.24 });

/** The stalks' lean and lay at a ground point (xz node): { push (vec2, -1..1), lay (0..1) }. */
export function trampleAt(t, xz) {
    const uv = vec2(xz.x.sub(TRAMPLE.x0).div(TRAMPLE.width), xz.y.sub(TRAMPLE.z0).div(TRAMPLE.depth));
    const s = texture(t.trample, uv).level(0);
    return { push: s.xy.mul(2.0).sub(1.0), lay: s.z };
}

/**
 * The ears a grazing horse is working at (xz node): how far toward the muzzles the stalks there are
 * pulled (vec2). A horse browsing the barley gathers a mouthful of ears with its lips, tugs them
 * over and lets them spring back as it chews (the herd writes the muzzles: `u.muzzles`).
 */
export function grazingPullAt(u, xz) {
    const pull = vec2(0.0).toVar();
    If(length(xz.sub(u.muzzleBounds.xy)).lessThan(u.muzzleBounds.z), () => {
        Loop({
            start: int(0), end: u.muzzleCount, type: 'int', condition: '<', name: 'mz',
        }, ({ mz }) => {
            const m = u.muzzles.element(mz);
            const rel = m.xz.sub(xz);
            const r = max(length(rel), 0.05);
            pull.addAssign(rel.div(r).mul(m.w.mul(float(1.0).sub(smoothstep(0.12, 0.6, r)))));
        });
    });
    return pull;
}

/**
 * The field and its texture. `press(horses, dt)` relaxes it and presses the horses in (each
 * { x, z, heading, speed, scale }); returns whether the texture changed.
 */
export function createTrample() {
    const { cols, rows } = TRAMPLE;
    const lean = new Float32Array(cols * rows * 2);
    const swing = new Float32Array(cols * rows * 2);
    const push = new Float32Array(cols * rows * 2);
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
                if (strength * strength > push[c * 2] ** 2 + push[c * 2 + 1] ** 2) {
                    push[c * 2] = px;
                    push[c * 2 + 1] = pz;
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
            const d = Math.max(0, Math.min(0.1, dt));
            const rise = Math.exp(-d / TRAMPLE.rise);
            push.fill(0);
            let pressed = false;
            (horses || []).forEach((h) => { pressed = pressHorse(h) || pressed; });
            if (!live && !pressed) return false;
            // Each stalk a damped spring toward where it is pushed (upright when nothing presses it).
            const { omega, zeta } = STALK;
            const steps = Math.max(1, Math.ceil(d / (1 / 60)));
            const h = d / steps;
            const k = omega * omega * h;
            const damp = 1 / (1 + 2 * zeta * omega * h);
            let any = false;
            for (let c = 0; c < cols * rows; c++) {
                let lx = lean[c * 2];
                let lz = lean[c * 2 + 1];
                let vx = swing[c * 2];
                let vz = swing[c * 2 + 1];
                const tx = push[c * 2];
                const tz = push[c * 2 + 1];
                if (tx === 0 && tz === 0 && lx === 0 && lz === 0 && vx === 0 && vz === 0 && lay[c] === 0) continue;
                for (let n = 0; n < steps; n++) {
                    vx = (vx + k * (tx - lx)) * damp;
                    vz = (vz + k * (tz - lz)) * damp;
                    lx += vx * h;
                    lz += vz * h;
                }
                // Settled: let it rest exactly upright.
                if (Math.abs(lx) + Math.abs(lz) + (Math.abs(vx) + Math.abs(vz)) * 0.2 < 0.002 && tx === 0 && tz === 0) {
                    lx = 0;
                    lz = 0;
                    vx = 0;
                    vz = 0;
                }
                lean[c * 2] = Math.max(-1, Math.min(1, lx));
                lean[c * 2 + 1] = Math.max(-1, Math.min(1, lz));
                swing[c * 2] = vx;
                swing[c * 2 + 1] = vz;
                const l = lay[c] * rise;
                lay[c] = l < 0.002 ? 0 : l;
                const o = c * 4;
                bytes[o] = Math.round(127.5 + lean[c * 2] * 127.5);
                bytes[o + 1] = Math.round(127.5 + lean[c * 2 + 1] * 127.5);
                bytes[o + 2] = Math.round(lay[c] * 255);
                if (lay[c] > 0 || lx !== 0 || lz !== 0) any = true;
            }
            live = any;
            tex.needsUpdate = true;
            return true;
        },
        /** Everything upright again (a seek). */
        clear() {
            lean.fill(0);
            swing.fill(0);
            push.fill(0);
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
