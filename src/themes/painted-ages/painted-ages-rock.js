/** Tileable rock relief: value, analytic slopes and roughness in one filtered read. */
import * as THREE from 'three/webgpu';

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const fadeSlope = (t) => 30 * t * t * (t - 1) * (t - 1);
const hash = (x, y, period) => {
    const ix = ((x % period) + period) % period;
    const iy = ((y % period) + period) % period;
    let v = Math.imul(ix + 17, 374761393) ^ Math.imul(iy + 43, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
};

/** Periodic smooth lattice values with exact derivatives, before texture filtering. */
export function rockNoise(x, y, period) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const u = x - ix;
    const v = y - iy;
    const a = hash(ix, iy, period);
    const b = hash(ix + 1, iy, period);
    const c = hash(ix, iy + 1, period);
    const d = hash(ix + 1, iy + 1, period);
    const sx = fade(u);
    const sy = fade(v);
    const cross = a - b - c + d;
    return [
        a + (b - a) * sx + (c - a) * sy + cross * sx * sy,
        ((b - a) + cross * sy) * fadeSlope(u),
        ((c - a) + cross * sx) * fadeSlope(v),
    ];
}

export function bakeRockRelief(size = 256) {
    const data = new Uint16Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let height = 0;
            let dx = 0;
            let dy = 0;
            for (let octave = 0; octave < 4; octave++) {
                const cells = 8 * (2 ** octave);
                const amplitude = 0.55 ** octave;
                const sample = rockNoise(((x + 0.5) * cells) / size, ((y + 0.5) * cells) / size, cells);
                height += (sample[0] - 0.5) * amplitude;
                dx += (sample[1] * amplitude * cells) / 8;
                dy += (sample[2] * amplitude * cells) / 8;
            }
            const offset = (y * size + x) * 4;
            data[offset] = THREE.DataUtils.toHalfFloat(height);
            data[offset + 1] = THREE.DataUtils.toHalfFloat(dx);
            data[offset + 2] = THREE.DataUtils.toHalfFloat(dy);
            data[offset + 3] = THREE.DataUtils.toHalfFloat(Math.max(0.2, Math.min(0.95, 0.65 + height * 0.45)));
        }
    }
    return data;
}

export function createRockRelief() {
    const texture = new THREE.DataTexture(bakeRockRelief(), 256, 256, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.name = 'painted-ages-rock-height-slopes-roughness';
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
}
