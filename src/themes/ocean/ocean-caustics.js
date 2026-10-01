/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import { max, texture, vec2 } from 'three/tsl';

let causticTexture;
let floorTexture;

export function getReefFloorTexture() {
    if (floorTexture) return floorTexture;
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    // The low base geometry hides the centre of a broad Gaussian, leaving only
    // its faint edge visible. A compact contact core holds its darkness out to
    // the foot, then falls away quickly; the soft apron recedes down-light (+Z,
    // slightly +X). These two landmarks are present even at Low quality.
    const contacts = [[58, -85, 10.5, 8.2], [-62, -123, 14, 9.5]];
    const canopy = [[-42, 22], [45, 16], [-36, -28], [42, -44], [-68, 20],
        [70, 12], [-42, -96], [47, -120], [-71, -99], [73, -122], [-55, -158], [55, -176]];
    const gardens = [[-58, -104, 19, 7], [-28, 24, 9, 7], [32, 20, 10, 8],
        [-54, -24, 18, 13], [57, -30, 18, 13]];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const wx = (x / (size - 1) - 0.5) * 400;
            const wz = (y / (size - 1) - 0.5) * 400;
            let occlusion = 1;
            for (const [ax, az, rx, rz] of contacts) {
                const dx = wx - ax;
                const dz = wz - az;
                const contactDistance = (dx / rx) ** 2 + (dz / rz) ** 2;
                const core = Math.exp(-contactDistance * contactDistance * 1.1) * 0.9;
                const shadowX = dx - 1.8;
                const shadowZ = dz - 5.0;
                const across = shadowX * 0.978 - shadowZ * 0.208;
                const along = shadowX * 0.208 + shadowZ * 0.978;
                const apronDistance = (across / (rx * 1.15)) ** 2 + (along / (rz * 1.6)) ** 2;
                const apron = Math.exp(-apronDistance * 1.8) * 0.38;
                occlusion *= (1 - core) * (1 - apron);
            }
            for (const [ax, az, rx, rz] of gardens) {
                const d = ((wx - ax) / rx) ** 2 + ((wz - az) / rz) ** 2;
                occlusion *= 1 - Math.exp(-d * 1.7) * 0.2;
            }
            const offset = (y * size + x) * 4;
            data[offset] = Math.round(occlusion * 255);
            data[offset + 1] = Math.round((0.5 + Math.sin(wx * 0.065 + Math.sin(wz * 0.043))
                * Math.cos(wz * 0.052) * 0.3) * 255);
            // Reuse the spare channel for broad canopy shade: no extra texture
            // read or live shadow map is needed for the planted forest floor.
            let canopyShade = 0;
            for (const [cx, cz] of canopy) {
                const d = ((wx - cx - 2) / 16) ** 2 + ((wz - cz - 7) / 24) ** 2;
                canopyShade = Math.max(canopyShade, Math.exp(-d * 0.9));
            }
            const dapple = 0.84 + Math.sin(wx * 0.6 + Math.sin(wz * 0.36) * 2) * 0.16;
            data[offset + 2] = Math.round(canopyShade * dapple * 255);
            data[offset + 3] = 255;
        }
    }
    floorTexture = new THREE.DataTexture(data, size, size);
    floorTexture.name = 'Ocean sediment and reef contact';
    floorTexture.minFilter = THREE.LinearFilter;
    floorTexture.magFilter = THREE.LinearFilter;
    floorTexture.needsUpdate = true;
    return floorTexture;
}

// Bake a periodic cellular light field once. The fragment shader spends the same
// two filtered taps as the old blurred noise, but gets connected refractive folds.
export function getReefCausticTexture() {
    if (causticTexture) return causticTexture;
    const size = 256;
    const cells = 8;
    const data = new Uint8Array(size * size * 4);
    const hash = (x, y, salt) => {
        const h = Math.sin(x * 127.1 + y * 311.7 + salt) * 43758.5453;
        return h - Math.floor(h);
    };
    const sites = Array.from({ length: cells * cells }, (_, i) => [
        0.18 + hash(i % cells, Math.floor(i / cells), 4) * 0.64,
        0.18 + hash(i % cells, Math.floor(i / cells), 91) * 0.64,
    ]);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = (x / size) * Math.PI * 2;
            const v = (y / size) * Math.PI * 2;
            // Periodic domain warp curves the cell borders into water lenses;
            // the integer frequencies keep opposite texture edges seamless.
            const px = (x / size) * cells + Math.sin(v * 3 + Math.sin(u * 2)) * 0.28
                + Math.sin(u * 2 - v * 2) * 0.16;
            const py = (y / size) * cells + Math.cos(u * 3 + Math.cos(v * 2)) * 0.28
                + Math.cos(v * 2 + u) * 0.16;
            const ix = Math.floor(px);
            const iy = Math.floor(py);
            let nearest = Infinity;
            let second = Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const sx = ix + dx;
                    const sy = iy + dy;
                    const site = sites[((sy + cells * 2) % cells) * cells + ((sx + cells * 2) % cells)];
                    const d = Math.hypot(px - sx - site[0], py - sy - site[1]);
                    if (d < nearest) { second = nearest; nearest = d; } else if (d < second) second = d;
                }
            }
            const gap = second - nearest;
            const ridge = Math.exp(-gap * 24) * 0.82 + Math.exp(-gap * 7) * 0.18;
            const offset = (y * size + x) * 4;
            data[offset] = Math.round(ridge * 255);
            data[offset + 1] = Math.round(Math.min(1, nearest) * 255);
            data[offset + 2] = data[offset];
            data[offset + 3] = 255;
        }
    }
    causticTexture = new THREE.DataTexture(data, size, size);
    causticTexture.name = 'Ocean periodic refractive folds';
    causticTexture.wrapS = THREE.RepeatWrapping;
    causticTexture.wrapT = THREE.RepeatWrapping;
    causticTexture.minFilter = THREE.LinearMipmapLinearFilter;
    causticTexture.magFilter = THREE.LinearFilter;
    causticTexture.generateMipmaps = true;
    causticTexture.needsUpdate = true;
    return causticTexture;
}

export function reefCaustics(worldXZ, time, scale = 0.018, lowDetail = false) {
    const field = getReefCausticTexture();
    const p = worldXZ.mul(scale);
    const a = texture(field, p.add(vec2(time.mul(0.0032), time.mul(-0.0021)))).r;
    if (lowDetail) return a;
    const b = texture(field, vec2(p.y.negate(), p.x).mul(1.23)
        .add(vec2(time.mul(-0.0024), time.mul(0.003)))).r;
    return max(a, b.mul(0.72));
}

export function disposeReefCausticTexture() {
    causticTexture?.dispose();
    causticTexture = null;
    floorTexture?.dispose();
    floorTexture = null;
}
