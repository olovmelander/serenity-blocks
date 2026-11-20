/**
 * Painted Ages — the pennants: strings of small coloured flags from lamp post to lamp post up
 * the stair, the one thing on the overlook that moves in the wind beside the eye.
 *
 * One merged mesh, a quad a flag. A string FOLLOWS THE WALK (the line of its lamp-side posts,
 * bend for bend and flight for flight): from the head of one lamp it sags to rail height and
 * climbs to the next lamp's head, and a flag hangs every half metre or so, in the pigments'
 * colours taken in turn. (Strung straight from lamp to lamp it cut the walk's bends and lay
 * across the open slope like spilt confetti.) A flag is pinned along its top edge and its free
 * edge flutters: a lean downwind that grows with the weather's wind, and a ripple that runs down
 * the string, flag after flag (closed form from `u.time`). Lit like the walkway they hang over,
 * the sun showing through the cloth when it stands behind them. Near the eye they read as flags;
 * further up the stair as a dotted line of colour climbing to the pavilion.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    vec3,
    vec4,
} from 'three/tsl';
import { hexToLinear } from './painted-ages-core.js';
import { aerial, cloudShadow } from './painted-ages-light.js';
import { shadowAt } from './painted-ages-shadow.js';

/**
 * A flag's cloth (metres), the gap between flags along the string, the height of a lamp's head
 * over the deck where the string is tied, and how low it sags between two lamps (to rail height).
 */
export const PENNANT = Object.freeze({
    width: 0.36, drop: 0.46, pitch: 0.58, head: 1.92, low: 1.02,
});
/** The cloths' colours, in turn along a string (sRGB). */
const CLOTH = Object.freeze(['#D8432C', '#F0C02D', '#EFE6D0', '#3F9E86', '#4C74E9'].map((c) => hexToLinear(c)));
/** The wind's heading (the deck's own drift), as a unit vector on the ground. */
const WIND = Object.freeze([9.5 / Math.hypot(9.5, 3.2), -3.2 / Math.hypot(9.5, 3.2)]);

/**
 * Where the flags hang. `rail` is the walk's lamp-side line, post by post: `{ x, y, z, lamp }`
 * (y the deck's height). Between each lamp and the next, flags every `pitch` metres along the
 * line itself: `{ x, y, z, ax, az }` (the string's point and its heading on the ground).
 */
export function pennantFlags(rail, pitch = PENNANT.pitch) {
    const flags = [];
    const lamps = [];
    rail.forEach((p, i) => {
        if (p.lamp) lamps.push(i);
    });
    for (let s = 0; s < lamps.length - 1; s++) {
        const from = lamps[s];
        const to = lamps[s + 1];
        // The span's length along the walk.
        const lengths = [0];
        for (let i = from; i < to; i++) {
            lengths.push(lengths[lengths.length - 1] + Math.hypot(rail[i + 1].x - rail[i].x, rail[i + 1].z - rail[i].z));
        }
        const total = lengths[lengths.length - 1];
        if (total < 3) continue;
        const count = Math.max(1, Math.floor(total / pitch));
        let seg = 0;
        for (let k = 0; k < count; k++) {
            const d = ((k + 0.5) / count) * total;
            while (seg < lengths.length - 2 && lengths[seg + 1] < d) seg++;
            const a = rail[from + seg];
            const b = rail[from + seg + 1];
            const span = Math.max(1e-6, lengths[seg + 1] - lengths[seg]);
            const f = (d - lengths[seg]) / span;
            const t = d / total;
            const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            flags.push({
                x: a.x + (b.x - a.x) * f,
                // Tied at the lamps' heads, sagging to rail height between them.
                y: a.y + (b.y - a.y) * f + PENNANT.head - (PENNANT.head - PENNANT.low) * 4 * t * (1 - t),
                z: a.z + (b.z - a.z) * f,
                ax: (b.x - a.x) / len,
                az: (b.z - a.z) / len,
            });
        }
    }
    return flags;
}

export function createPennants(u, t, rail, tier) {
    const flags = pennantFlags(rail, PENNANT.pitch * (tier.props > 0 ? 1 : 2));
    const total = Math.max(1, flags.length);
    const positions = new Float32Array(total * 4 * 3);
    const normals = new Float32Array(total * 4 * 3);
    const cloth = new Float32Array(total * 4 * 2);
    const tint = new Float32Array(total * 4 * 3);
    const index = [];
    flags.forEach((p, n) => {
        const rgb = CLOTH[n % CLOTH.length];
        const half = PENNANT.width / 2;
        const corners = [[-half, 0, 0], [half, 0, 0], [half, -PENNANT.drop, 1], [-half, -PENNANT.drop, 1]];
        const base = n * 4;
        corners.forEach(([s, dy, free], c) => {
            const o = (base + c) * 3;
            positions[o] = p.x + p.ax * s;
            positions[o + 1] = p.y + dy;
            positions[o + 2] = p.z + p.az * s;
            normals[o] = -p.az;
            normals[o + 1] = 0;
            normals[o + 2] = p.ax;
            cloth[(base + c) * 2] = free;
            // The phase runs down the string, so a ripple travels from flag to flag.
            cloth[(base + c) * 2 + 1] = n * 0.55;
            tint.set(rgb, o);
        });
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('aFlag', new THREE.BufferAttribute(cloth, 2));
    geometry.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesPennants';
    material.side = THREE.DoubleSide;
    material.fog = false;
    const flag = attribute('aFlag', 'vec2');
    material.positionNode = Fn(() => {
        // The free edge leans downwind (more in a strong wind) and ripples; the pinned edge holds.
        const free = flag.x;
        const blow = u.windSpeed.mul(0.09).add(0.05);
        const ripple = sin(u.time.mul(u.windSpeed.mul(1.4).add(4.2)).sub(flag.y.mul(2.3))
            .add(positionGeometry.x.mul(3.0)));
        const lean = vec3(WIND[0], 0.0, WIND[1]).mul(blow.add(ripple.mul(0.07)));
        const lift = blow.mul(0.6).add(ripple.mul(0.03));
        return positionLocal.add(lean.add(vec3(0.0, lift, 0.0)).mul(free));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const nrm = normalize(normalWorld);
        const L = u.sunDir;
        const facing = abs(dot(nrm, L));
        // Cloth: either face takes the sun, and the sun shows through it from behind.
        const shadow = shadowAt(t.shadow, P.xz).mul(cloudShadow(u, t.noise, P));
        const direct = u.sun.mul(facing.mul(0.55).add(0.35)).mul(shadow).mul(u.sunUp);
        const view = normalize(P.sub(u.eye));
        const through = clamp(dot(view, L), 0.0, 1.0);
        const glow = u.sun.mul(through.mul(through)).mul(0.35).mul(shadow).mul(u.sunUp);
        const light = direct.add(glow).add(u.fill.mul(1.1)).add(u.bounce.mul(0.5)).add(u.moon);
        return vec4(aerial(u, P, attribute('aTint', 'vec3').mul(light)), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesPennants';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return {
        mesh,
        flags,
        count: flags.length,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
