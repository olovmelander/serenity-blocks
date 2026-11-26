import * as THREE from 'three/webgpu';
import { clamp01, mulberry32 } from './waves-core.js';

// A horizontal strip of trade-wind cumulus, stored as relief and optical depth. The sky reads
// it at two distances, erodes it in the wind and lights each side in the current hour's colours.
const WIDTH = 512;
const HEIGHT = 96;
let strip;

function bakeClouds() {
    const depth = new Float32Array(WIDTH * HEIGHT);
    const random = mulberry32(0x51c0ad);
    function billow(cx, cy, rx, ry, front) {
        for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(HEIGHT - 1, cy + ry); y++) {
            const h = (y - cy) / ry;
            for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
                const side = (x - cx) / rx;
                const section = 1 - h * h - side * side;
                if (section <= 0) continue;
                const i = y * WIDTH + ((x + WIDTH) % WIDTH);
                // The protruding face of each billow emerges from the one behind it.
                const surface = Math.sqrt(section) * front;
                const join = Math.max(0, 1 - Math.abs(depth[i] - surface) / 2.4);
                depth[i] = Math.max(depth[i], surface) + join * join * 0.6;
            }
        }
    }
    const banks = [
        [45, 61, 28, 13], [131, 25, 12, 8], [232, 73, 20, 13],
        [323, 20, 12, 14], [411, 56, 35, 10], [489, 26, 16, 13],
    ];
    for (const [centre, width, height, base] of banks) {
        for (let j = 0; j < 16; j++) {
            const x = (j / 15 - 0.5) * 2;
            const lift = Math.max(0, 1 - (x + 0.19) ** 2 * 1.6);
            const rx = width * (0.12 + random() * 0.16);
            const ry = height * (0.12 + lift * (0.18 + random() * 0.32));
            const cx = centre + x * width * 0.8;
            billow(cx, base + ry * 0.64, rx, ry, 4 + ry * (0.7 + random() * 0.55));
            billow(cx + rx * 0.18, base + lift * height * 0.55, rx * 0.7, ry * 0.8, 4 + ry * 0.68);
        }
    }
    const out = new Uint8Array(WIDTH * HEIGHT * 4);
    for (let y = 1; y < HEIGHT - 1; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const i = y * WIDTH + x;
            if (depth[i] <= 0) continue;
            const row = i - x;
            const sx = (depth[row + ((x + 1) % WIDTH)] - depth[row + ((x + WIDTH - 1) % WIDTH)]) * 0.5;
            const sy = (depth[i + WIDTH] - depth[i - WIDTH]) * 0.5;
            const inv = 1 / Math.hypot(sx, sy, 1);
            out[4 * i] = Math.round(255 * (0.5 - sx * inv * 0.5));
            out[4 * i + 1] = Math.round(255 * (0.5 - sy * inv * 0.5));
            out[4 * i + 2] = Math.round(255 * clamp01(depth[i] / 24));
            out[4 * i + 3] = Math.round(255 * (1 - Math.exp(-depth[i] * 0.45)));
        }
    }
    return out;
}

export function createCloudStrip() {
    strip ??= bakeClouds();
    const map = new THREE.DataTexture(strip, WIDTH, HEIGHT, THREE.RGBAFormat);
    map.name = 'waves-cloud-relief';
    map.colorSpace = THREE.NoColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
}
