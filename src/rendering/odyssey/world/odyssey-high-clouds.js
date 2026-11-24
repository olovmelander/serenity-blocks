import * as THREE from 'three/webgpu';
import {
    Fn, If, clamp, dot, exp, float, max, mix, pow, smoothstep, sqrt, texture, uniform, vec2, vec3,
} from 'three/tsl';
import { CLOUD_WIND } from './odyssey-cloud-composition.js';

/**
 * THE HIGH SKY (2026-11-24): cirrus, and a field of altocumulus under it, on the dome. Both are one tiling
 * picture baked in scripts/blender/odyssey/clouds/high.py (R cirrus, G altocumulus heights, B a veil, A where
 * there is cloud). Each lies on its own shell at its own height, met by the eye's ray, so the two slide over
 * one another and over the heaps below as the traveller moves, and both come down to the horizon.
 *
 * They live: each is two readings of its sheet at different sizes and paces, gathered by a third, slower one,
 * so flocks form and thin out as they cross.
 */

const URL_HIGH = new URL('../assets/clouds/high.png', import.meta.url).href;

export const HIGH_SKY = Object.freeze({
    /** How far down the shells bend to meet the horizon, u. */
    round: 26000,
    cirrus: Object.freeze({
        height: 4300, tile: 12500, speed: 9, fine: 2.3, fineSpeed: 13, alpha: 0.62, power: 0.95, gather: Object.freeze([0.44, 0.78]),
    }),
    cells: Object.freeze({
        height: 2700, tile: 6400, speed: 11, alpha: 0.62, gather: Object.freeze([0.60, 0.82]), lean: 46, edge: Object.freeze([0.06, 0.42]),
    }),
    veil: Object.freeze({ alpha: 0.16 }),
    white: Object.freeze([0.97, 0.98, 1.0]),
});

/**
 * @param {object} [opts]
 * @param {boolean} [opts.load]
 */
export function createHighClouds({ load = true } = {}) {
    const tex = new THREE.Texture();
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    const uOn = uniform(0);
    let disposed = false;
    if (load && typeof createImageBitmap === 'function' && typeof fetch === 'function' && typeof document !== 'undefined') {
        fetch(URL_HIGH)
            .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`high sky ${res.status}`))))
            .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
            .then((bitmap) => {
                if (disposed) { bitmap.close?.(); return; }
                tex.image = bitmap;
                tex.needsUpdate = true;
                uOn.value = 1;
            })
            .catch((error) => console.warn('[OdysseyClouds] high sky not loaded:', error?.message || error));
    }

    /**
     * The sheets laid over the dome.
     * @param {object} c
     * @param {Node} c.base       the dome's own colour there
     * @param {Node} c.dir        the view direction
     * @param {Node} c.eye        the eye, in the world's own frame
     * @param {Node} c.time
     * @param {Node} c.sunDir
     * @param {Node} c.sunColour
     * @param {Node} c.shade      the colour of their shaded side
     * @param {(colour: Node, sun: Node) => Node} c.hour   the hour's colour of high cloud
     * @param {(cover: Node) => Node} c.coverOf
     * @param {Node} c.keep       0..1: how much of them there is (the departure takes them)
     */
    function over(c) {
        const H = HIGH_SKY;
        const wind = vec2(...CLOUD_WIND);
        const across = vec2(-CLOUD_WIND[1], CLOUD_WIND[0]);
        const shell = (dy, height) => {
            const h = max(float(height).sub(c.eye.y), float(1));
            return sqrt(dy.mul(dy).mul(H.round * H.round).add(h.mul(2 * H.round)).add(h.mul(h))).sub(dy.mul(H.round));
        };
        return Fn(() => {
            const out = vec3(c.base).toVar();
            const dy = max(c.dir.y, float(0)).toVar();
            // Read at the root: the hardware's own mips need every pixel to take the fetch.
            const tC = shell(dy, H.cirrus.height).toVar();
            const pC = c.eye.xz.add(c.dir.xz.mul(tC)).toVar();
            const atC = vec2(dot(pC, wind), dot(pC, across)).div(H.cirrus.tile).toVar();
            const slow = c.time.mul(H.cirrus.speed / H.cirrus.tile);
            const a = texture(tex, atC.sub(vec2(slow, 0))).toVar();
            const b = texture(tex, atC.mul(H.cirrus.fine).sub(vec2(c.time.mul((H.cirrus.fineSpeed * H.cirrus.fine) / H.cirrus.tile), 0.37))).toVar();
            const g = texture(tex, atC.mul(0.31).add(vec2(slow.mul(-0.11), 0.21))).toVar();
            const tM = shell(dy, H.cells.height).toVar();
            const pM = c.eye.xz.add(c.dir.xz.mul(tM)).toVar();
            const atM = vec2(dot(pM, wind), dot(pM, across)).div(H.cells.tile).sub(vec2(c.time.mul(H.cells.speed / H.cells.tile), 0)).toVar();
            const m = texture(tex, atM).toVar();
            const toward = vec2(dot(c.sunDir.xz, wind), dot(c.sunDir.xz, across)).mul(H.cells.lean / H.cells.tile);
            const m2 = texture(tex, atM.add(toward)).toVar();
            const mg = texture(tex, atM.mul(0.27).add(vec2(0.53, c.time.mul(0.0007)))).toVar();
            If(uOn.mul(c.keep).mul(dy).greaterThan(0.002), () => {
                const glow = smoothstep(float(0.2), float(0.98), dot(c.dir, c.sunDir)).toVar();
                const sunny = c.hour(mix(vec3(...H.white), c.sunColour.mul(vec3(1.06, 0.96, 0.84)), glow.mul(0.35)), c.sunColour).toVar();
                const low = smoothstep(float(0.010), float(0.15), dy).toVar();
                // The veil and the cirrus.
                const there = smoothstep(float(H.cirrus.gather[0]), float(H.cirrus.gather[1]), g.a).toVar();
                const comb = pow(max(a.r, float(1e-4)), float(H.cirrus.power)).mul(there.mul(0.95).add(0.05))
                    .add(pow(max(b.r, float(1e-4)), float(H.cirrus.power)).mul(there).mul(a.b).mul(0.40));
                const thin = smoothstep(float(0.35), float(0.95), g.b).mul(H.veil.alpha).mul(there);
                const far = exp(tC.div(-15000)).toVar();
                const cirrus = clamp(c.coverOf(clamp(comb.mul(H.cirrus.alpha).add(thin), 0, 1)), 0, 1)
                    .mul(low).mul(far.mul(0.75).add(0.25)).mul(c.keep)
                    .mul(uOn)
                    // (Toward the sun the eye looks along the wind: the tails stand up there as bars of light.)
                    .mul(float(1).sub(smoothstep(float(0.80), float(0.97), dot(c.dir, c.sunDir)).mul(0.6)));
                out.assign(mix(out, sunny.mul(glow.mul(0.12).add(1)), cirrus));
                // The altocumulus, each cell lit on the side it turns to the sun.
                const flock = smoothstep(float(H.cells.gather[0]), float(H.cells.gather[1]), mg.a).toVar();
                const cell = m.g.mul(flock).toVar();
                const body = smoothstep(float(H.cells.edge[0]), float(H.cells.edge[1]), cell).toVar();
                const lit = clamp(m.g.sub(m2.g).mul(1.7).add(0.62), 0, 1);
                const cellCol = mix(c.shade, sunny.mul(1.04), lit.mul(0.8).add(0.2));
                const cells = body.mul(H.cells.alpha).mul(low).mul(exp(tM.div(-9500)).mul(0.9).add(0.1)).mul(c.keep)
                    .mul(uOn)
                    .mul(smoothstep(float(0.0), float(500), float(H.cells.height).sub(c.eye.y)));
                out.assign(mix(out, mix(out, cellCol, float(0.9)), cells));
            });
            return out;
        })();
    }
    return {
        tex,
        uOn,
        over,
        dispose() {
            disposed = true;
            if (tex.image && typeof tex.image.close === 'function') tex.image.close();
            tex.dispose();
        },
    };
}
