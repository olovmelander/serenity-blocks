/**
 * Grainfields — the herd's shadows on the barley.
 *
 * A horse standing in ripe barley throws its shadow over the ears around it: under a high sun a
 * dark pool at its flank, at the golden hour a long shadow laid out across the field away from the
 * light, gone when the deck closes over the sun. Each frame the horses' bodies (the barrel, the neck,
 * the head, the dock), as capsules on their posed skeletons, are cast along the sun onto the plane of
 * the ears and painted into a small window of the field that follows the band; the barley reads it
 * at each clump's root and takes it off the sun it receives (grainfields-grain.js), so the shadow
 * is only ever where the sun would have been.
 */
import * as THREE from 'three/webgpu';
import { float, texture, vec2 } from 'three/tsl';
import { boneToWorld } from './grainfields-horse-rig.js';

/**
 * The window: texels a side, metres a side, the height over the ground the shadows are laid on
 * (the ears' height), the steepest shadow (a low sun's are this many times longer than the height
 * that casts them, at most), and how dark a full shadow leaves the sun's share.
 */
export const HERD_SHADOW = Object.freeze({
    size: 256, span: 64, canopy: 0.78, longest: 9, depth: 0.82,
});

/**
 * What casts: capsules between two points each carried by a bone (its head, or a rest point it
 * carries), radius in metres: the barrel from the quarters to the chest, the neck, the head to the
 * muzzle, the dock.
 */
const CASTERS = Object.freeze([
    {
        from: 'pelvis', fromAt: [0, 1.0, -0.62], to: 'chest', toAt: [0, 1.0, 0.55], radius: 0.31,
    },
    { from: 'neck0', to: 'neck2', radius: 0.17 },
    { from: 'neck2', to: 'head', radius: 0.13 },
    {
        from: 'head', to: 'head', toAt: [0, 1.314, 1.364], radius: 0.1,
    },
    { from: 'tail0', to: 'tail3', radius: 0.07 },
]);

/**
 * The shade at a ground point (xz node): the share of the sun the herd leaves there (1 in the open).
 * `u.herdShadow` = (window origin x, z, span; span 0 when there is none).
 */
export function herdShadeAt(u, t, xz) {
    if (!t.herdShadow) return float(1.0);
    const span = u.herdShadow.z.max(1e-3);
    const uv = xz.sub(u.herdShadow.xy).div(span).add(0.5);
    const inside = uv.x.greaterThan(0.0).and(uv.x.lessThan(1.0)).and(uv.y.greaterThan(0.0)).and(uv.y.lessThan(1.0))
        .and(u.herdShadow.z.greaterThan(0.0));
    const dark = texture(t.herdShadow, vec2(uv.x, uv.y)).level(0).r;
    return float(1.0).sub(inside.select(dark, float(0.0)).mul(HERD_SHADOW.depth));
}

/** The window and its texture; `cast(motions, sunDir, ground)` paints this frame's shadows. */
export function createHerdShadow({ size = HERD_SHADOW.size, span = HERD_SHADOW.span } = {}) {
    const data = new Uint8Array(size * size * 4);
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'grainfields-herd-shadow';
    tex.needsUpdate = true;
    const cell = span / size;
    const window = { x: 0, z: 0, span: 0 };
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    let painted = false;

    const point = (rig, pose, bone, rest, scale, out) => {
        const i = rig.index[bone];
        if (!rest) {
            out[0] = pose.at[i * 3];
            out[1] = pose.at[i * 3 + 1];
            out[2] = pose.at[i * 3 + 2];
            return out;
        }
        return boneToWorld(rig, pose, i, rest, scale, out);
    };

    /**
     * Paint one capsule's shadow (a, b: world points; r: radius) onto the plane at `plane` over the
     * ground: cast along the sun, a circle of the capsule stretched along the sun's bearing.
     */
    const paint = (sx, sz, sy, sh, plane, r) => {
        const lift = (p) => Math.max(0, p[1] - plane);
        if (lift(a) <= 0 && lift(b) <= 0) return;
        // Where each end's shadow falls on the plane.
        const ta = lift(a) / sy;
        const tb = lift(b) / sy;
        const ax = a[0] - sx * ta;
        const az = a[2] - sz * ta;
        const bx = b[0] - sx * tb;
        const bz = b[2] - sz * tb;
        // A circle stretched along the sun's bearing by 1 / sin(elevation): undo the stretch.
        const stretch = 1 / Math.max(sh, 1 / HERD_SHADOW.longest);
        const ux = sx / Math.max(1e-6, Math.hypot(sx, sz));
        const uz = sz / Math.max(1e-6, Math.hypot(sx, sz));
        const reach = r * stretch + r;
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - window.x + span / 2) / cell));
        const x1 = Math.min(size - 1, Math.ceil((Math.max(ax, bx) + reach - window.x + span / 2) / cell));
        const z0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - window.z + span / 2) / cell));
        const z1 = Math.min(size - 1, Math.ceil((Math.max(az, bz) + reach - window.z + span / 2) / cell));
        // In the unstretched frame (along the bearing shrunk back), the shadow is a capsule of radius r.
        const squash = (dx, dz, out) => {
            const along = dx * ux + dz * uz;
            const across = dz * ux - dx * uz;
            out[0] = along / stretch;
            out[1] = across;
            return out;
        };
        const sa = [0, 0];
        const sb = [0, 0];
        const sp = [0, 0];
        squash(ax, az, sa);
        squash(bx, bz, sb);
        const vx = sb[0] - sa[0];
        const vz = sb[1] - sa[1];
        const vv = Math.max(1e-9, vx * vx + vz * vz);
        for (let j = z0; j <= z1; j++) {
            const z = window.z - span / 2 + (j + 0.5) * cell;
            for (let i = x0; i <= x1; i++) {
                const x = window.x - span / 2 + (i + 0.5) * cell;
                squash(x, z, sp);
                const k = Math.max(0, Math.min(1, ((sp[0] - sa[0]) * vx + (sp[1] - sa[1]) * vz) / vv));
                const d = Math.hypot(sp[0] - sa[0] - vx * k, sp[1] - sa[1] - vz * k);
                // A soft edge (the sun is a disc, the hair is no hard edge either).
                const dark = 1 - Math.max(0, Math.min(1, (d - r * 0.7) / (r * 0.6)));
                if (dark <= 0) continue;
                const o = (j * size + i) * 4;
                const value = Math.round(dark * 255);
                if (value > data[o]) data[o] = value;
            }
        }
        painted = true;
    };

    return {
        texture: tex,
        /** The window's place (world x, z of its middle) and size: what `u.herdShadow` takes. */
        window,
        /**
         * Paint the herd's shadows for a sun direction (toward the sun, unit) over `ground(x, z)`.
         * `motions` are grainfields-horse-motion.js's (posed). Returns whether the texture changed.
         */
        cast(rig, motions, sunDir, ground) {
            const [sx, sy, sz] = sunDir;
            if (!motions?.length || sy <= 0.01) {
                if (painted) {
                    data.fill(0);
                    tex.needsUpdate = true;
                    painted = false;
                }
                window.span = 0;
                return false;
            }
            // The window follows the band, on whole texels (so the shadows do not crawl).
            let cx = 0;
            let cz = 0;
            motions.forEach((m) => {
                cx += m.place.x;
                cz += m.place.z;
            });
            window.x = Math.round(cx / motions.length / cell) * cell;
            window.z = Math.round(cz / motions.length / cell) * cell;
            window.span = span;
            data.fill(0);
            painted = false;
            const sh = sy / Math.hypot(sx, sy, sz);
            motions.forEach((m) => {
                const s = m.place.scale;
                const plane = ground(m.place.x, m.place.z) + HERD_SHADOW.canopy;
                // (A foal's own rig: its proportions are not its mother's.)
                const own = m.rig || rig;
                CASTERS.forEach((c) => {
                    point(own, m.pose, c.from, c.fromAt, s, a);
                    point(own, m.pose, c.to, c.toAt, s, b);
                    paint(sx, sz, sy, sh, plane, c.radius * s);
                });
            });
            tex.needsUpdate = true;
            return true;
        },
        clear() {
            data.fill(0);
            window.span = 0;
            painted = false;
            tex.needsUpdate = true;
        },
        dispose() {
            tex.dispose();
        },
    };
}
