/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter — fox PAW TRAILS (RDR2-style dynamic snow, right-sized for 3 known foxes).
 *
 * We already know the foxes' foot positions every frame, so we skip the whole AAA
 * capture-camera/depth-compare rig. Instead a small persistent CPU DataTexture "trail map"
 * is STAMPED with a paw mark at each footfall, DECAYS each frame (snow slowly refilling),
 * and is sampled ONCE in the snow ground's existing unlit colorNode to darken + pack the
 * trail (+ a bright compression rim, + sparkle suppression). No extra render pass, no GPU
 * compute, no vertex re-displacement.
 *
 * The map covers a FIXED world rect snug to the foxes' wander box (the camera is ~fixed, so
 * no scrolling window is needed). R channel = print depth (the "pit"). World→UV is exposed
 * as uniforms so the ground shader reuses its own positionWorld.xz.
 *
 * See docs/WINTER_FOX_PAW_TRAILS_PLAN.md.
 */
import * as THREE from 'three';
import { uniform } from 'three/tsl';

export function createPawTrail({
    origin = [-1200, -1880], // world XZ of texel (0,0)
    size = [2400, 2320], // world XZ extent the map covers
    res = 512, // texels per side
    tau = 7.0, // refill time constant (seconds) — bigger = slower fade
    depth = 0.9, // peak print depth per stamp (0..1)
    lake = null, // { cx, cz, halfX, halfZ } → suppress prints over the ice
} = {}) {
    const data = new Uint8Array(res * res * 4);
    const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const uOrigin = uniform(new THREE.Vector2(origin[0], origin[1]));
    const uInvSize = uniform(new THREE.Vector2(1 / size[0], 1 / size[1]));

    const upAvg = (size[0] / res + size[1] / res) * 0.5; // world units per texel (avg)
    let dirty = true;
    let peak = 0;

    /** Stamp a paw print at world (wx,wz), oriented along the unit heading (ux,uz). */
    function stamp(wx, wz, ux, uz, modelScale = 80) {
        // No prints on the frozen lake (they read wrong on reflective ice).
        if (lake) {
            const bxx = Math.max(0, Math.abs(wx - (lake.cx ?? 0)) - lake.halfX);
            const bzz = Math.max(0, Math.abs(wz - lake.cz) - lake.halfZ);
            if (bxx === 0 && bzz === 0) return;
        }
        const u = (wx - origin[0]) / size[0];
        const v = (wz - origin[1]) / size[1];
        if (u < 0 || u > 1 || v < 0 || v > 1) return;
        const cxi = Math.round(u * res);
        const cyi = Math.round(v * res);
        // SMALL single-foot print (one of the fox's four feet), not a big body-wide blob.
        const pad = (modelScale * 0.1) / upAvg; // pad radius in texels
        const toe = pad * 0.5;
        const toeFwd = pad * 1.2;
        const reach = Math.max(2, Math.ceil(pad * 2.8));
        for (let dy = -reach; dy <= reach; dy += 1) {
            for (let dx = -reach; dx <= reach; dx += 1) {
                const tx = cxi + dx;
                const ty = cyi + dy;
                if (tx < 0 || tx >= res || ty < 0 || ty >= res) continue;
                const along = dx * ux + dy * uz; // along heading
                const side = dx * uz - dy * ux; // perpendicular (right)
                // Oval pad (elongated along heading) + 4 toe dots ahead of it.
                let val = Math.max(0, 1 - Math.sqrt((along / 1.15) ** 2 + side * side) / pad);
                for (let k = 0; k < 4; k += 1) {
                    const ts = (k - 1.5) * (pad * 0.6);
                    const td = Math.sqrt((along - toeFwd) ** 2 + (side - ts) ** 2) / toe;
                    val = Math.max(val, Math.max(0, 1 - td) * 0.92);
                }
                if (val <= 0.002) continue;
                const idx = (ty * res + tx) * 4;
                const add = Math.min(255, val * depth * 255);
                if (add > data[idx]) data[idx] = add;
            }
        }
        dirty = true;
    }

    /** Decay the whole map toward empty (framerate-independent). Call once per frame. */
    function update(dt) {
        if (!dirty && peak < 1) return; // idle — nothing to fade or upload
        const k = Math.exp(-Math.min(0.1, dt) / tau);
        let p = 0;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            if (r > 0) {
                const nr = r * k;
                data[i] = nr; // Uint8 truncates → reaches 0
                if (nr > p) p = nr;
            }
        }
        peak = p;
        dirty = false;
        texture.needsUpdate = true;
    }

    function dispose() {
        texture.dispose();
    }

    return {
        texture, uOrigin, uInvSize, stamp, update, dispose,
    };
}
