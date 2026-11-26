/**
 * Bake the permanently visible banks and crystals as angular mineral weights seen from the
 * camera mirrored in the pool. Negative space, crests and changing mineral colours stay live.
 * Also cast a grid of parallel light rays through a periodic water surface onto a pool bed.
 * Run `node scripts/crystal-cave/bake-water.mjs` after rebaking the authored GLB.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseCrystalCaveCavern } from '../../src/themes/crystal-cave/crystal-cave-assets.js';
import { GEM_STRIDE, createGemGeometry, packMineralCrystal } from '../../src/themes/crystal-cave/crystal-cave-gems.js';
import { POOL_VIEW } from '../../src/themes/crystal-cave/crystal-cave-reflection.js';
import { decodePng, encodePng } from '../high-coast/png.mjs';

const folder = new URL('../../src/themes/crystal-cave/assets/', import.meta.url);
const bytes = readFileSync(new URL('cavern.glb', folder));
const fileBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new GLTFLoader().parseAsync(fileBuffer, '');
const { crystals, geometry, meta } = parseCrystalCaveCavern(gltf);
const [eyeX, eyeY, eyeZ] = meta.camera.eye;
const eye = new Vector3(eyeX, 2 * meta.poolLevel - eyeY, eyeZ);
const W = 512;
const H = 192;
const width = W * 2;
const height = H * 2;
const depth = new Float32Array(width * height);
const light = new Float32Array(width * height * 6);

function project(point) {
    const iz = 1 / (eye.z - point.z);
    return {
        x: (((point.x - eye.x) * iz) / (2 * POOL_VIEW.halfWidth) + 0.5) * width,
        y: (1 - ((point.y - eye.y) * iz) / POOL_VIEW.height) * height,
        iz,
        above: (point.y - meta.poolLevel) * iz,
    };
}

// Perspective-correct triangle weights double as a depth buffer for occlusion by the banks.
function draw(a, b, c, shade) {
    if ([a, b, c].some((v) => v.iz <= 0) || Math.max(a.above, b.above, c.above) <= 0) return;
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 0.001) return;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
            const px = x + 0.5 - a.x;
            const py = y + 0.5 - a.y;
            const v = (px * (c.y - a.y) - py * (c.x - a.x)) / area;
            const w = ((b.x - a.x) * py - (b.y - a.y) * px) / area;
            const u = 1 - v - w;
            if (Math.min(u, v, w) < 0 || u * a.above + v * b.above + w * c.above < 0) continue;
            const z = u * a.iz + v * b.iz + w * c.iz;
            const i = x + y * width;
            if (z <= depth[i]) continue;
            depth[i] = z;
            shade(i * 6, (u * a.iz) / z, (v * b.iz) / z, (w * c.iz) / z);
        }
    }
}

const rock = geometry.attributes;
const p = new Vector3();
const surface = Array.from({ length: rock.position.count }, (_, i) => {
    const screen = project(p.fromBufferAttribute(rock.position, i));
    const channels = [rock.aLight0.getX(i), rock.aLight0.getY(i), rock.aLight0.getZ(i),
        rock.aLight0.getW(i), rock.aLight1.getX(i), rock.aLight1.getZ(i)];
    screen.light = channels.map((q, k) => q * q * meta.lightScale[k === 5 ? 6 : k] * (k === 5 ? 1.8 : 0.27));
    return screen;
});
const indices = geometry.index.array;
for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [surface[indices[i]], surface[indices[i + 1]], surface[indices[i + 2]]];
    draw(a, b, c, (offset, u, v, w) => {
        for (let k = 0; k < 6; k += 1) light[offset + k] = a.light[k] * u + b.light[k] * v + c.light[k] * w;
    });
}

const prism = createGemGeometry().attributes;
const key = new Vector3(-0.5, 0.75, 0.3).normalize();
const record = new Float32Array(GEM_STRIDE);
for (const stone of crystals) {
    if (stone.group || stone.height < 1.15) continue;
    packMineralCrystal(record, 0, stone);
    const origin = new Vector3().fromArray(record);
    const rotation = new Quaternion().fromArray(record, 4);
    const [radius, shoulderHeight, thickness] = [record[3], record[8], record[9]];
    const [crownRatio, apexX, apexZ] = [record[10], record[12], record[13]];
    const vertices = Array.from({ length: prism.position.count }, (_, i) => {
        const v = new Vector3().fromBufferAttribute(prism.position, i);
        const tip = v.y > 1.5;
        return v.set(
            (v.x + (tip ? apexX : 0)) * radius,
            (Math.min(v.y, 1) + (tip ? crownRatio : 0)) * shoulderHeight,
            (v.z + (tip ? apexZ : 0)) * thickness,
        ).applyQuaternion(rotation).add(origin);
    });
    for (let i = 0; i < vertices.length; i += 3) {
        const [a, b, c] = vertices.slice(i, i + 3);
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        const tip = prism.aFace.getZ(i) > 0.5;
        const plane = 0.11 + 0.25 * Math.max(0, normal.dot(key)) + 0.12 * Math.abs(normal.x);
        draw(project(a), project(b), project(c), (offset, u, v, w) => {
            const faceU = u * prism.uv.getX(i) + v * prism.uv.getX(i + 1) + w * prism.uv.getX(i + 2);
            const faceV = u * prism.uv.getY(i) + v * prism.uv.getY(i + 1) + w * prism.uv.getY(i + 2);
            const span = tip ? Math.max(0.001, 1 - faceV) : 1;
            const across = (faceU - 0.5) / span + 0.5;
            const edge = Math.min(across, 1 - across, tip ? faceV : 1 - faceV);
            const rim = 0.30 * Math.exp(-Math.max(0, edge) * 57);
            const core = Math.exp(-((across - 0.48) ** 2) * 16) * (tip ? 0.12 : 0.26);
            light.fill(0, offset, offset + 6);
            light[offset + stone.family] = (plane + core + rim) * Math.min(1.2, 0.55 + stone.glow * 0.36);
            light[offset + 5] = rim * 0.25 + (tip ? plane * 0.09 : 0);
        });
    }
}

const rgba = new Uint8Array(2 * W * H * 4);
for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
        for (let k = 0; k < 6; k += 1) {
            const start = (2 * y * width + 2 * x) * 6 + k;
            const value = light[start] + light[start + 6] + light[start + 6 * width] + light[start + 6 * width + 6];
            const dst = (2 * W * y + x + (k >= 3 ? W : 0)) * 4;
            rgba[dst + (k % 3)] = Math.round(Math.min(1, value / 4) * 255);
            rgba[dst + 3] = 255;
        }
    }
}
// A periodic wave field transmits a vertical beam of light. Snell's law gives each ray's
// slope in water; where neighbouring rays cross at the bed, their flux piles up on a fold.
function bakeCaustics() {
    const size = 256;
    const samples = size * 6;
    const energy = new Float32Array(size * size);
    const eta = 1 / 1.333;
    const bedDepth = 0.82;
    // Integer wave vectors close at the tile boundary. No two crests share a direction.
    const waves = [[2, 1, 0.015, 1.2], [-2, 3, 0.011, 3.1], [3, 2, 0.008, 4.5], [1, -4, 0.005, 0.8],
        [5, -2, 0.003, 2.3], [-4, 5, 0.002, 5.2], [2, 6, 0.0015, 0.3]].map(([u, v, amplitude, phase]) => ({
        kx: u * 2 * Math.PI, ky: v * 2 * Math.PI, amplitude, phase,
    }));
    for (let j = 0; j < samples; j += 1) {
        for (let i = 0; i < samples; i += 1) {
            const x = (i + 0.5) / samples;
            const y = (j + 0.5) / samples;
            let h = 0;
            let dx = 0;
            let dy = 0;
            for (const {
                kx, ky, amplitude, phase,
            } of waves) {
                const angle = kx * x + ky * y + phase;
                h += amplitude * Math.sin(angle);
                const gradient = amplitude * Math.cos(angle);
                dx += kx * gradient;
                dy += ky * gradient;
            }
            const nz = 1 / Math.sqrt(1 + dx * dx + dy * dy);
            const refract = (Math.sqrt(1 - eta * eta * (1 - nz * nz)) - eta * nz) * nz;
            const travel = ((bedDepth + h) * refract) / (eta + refract);
            const px = (x + dx * travel) * size;
            const py = (y + dy * travel) * size;
            const ix = Math.floor(px);
            const iy = Math.floor(py);
            const fx = px - ix;
            const fy = py - iy;
            const x0 = ix & (size - 1);
            const x1 = (ix + 1) & (size - 1);
            const y0 = (iy & (size - 1)) * size;
            const y1 = ((iy + 1) & (size - 1)) * size;
            energy[y0 + x0] += (1 - fx) * (1 - fy);
            energy[y0 + x1] += fx * (1 - fy);
            energy[y1 + x0] += (1 - fx) * fy;
            energy[y1 + x1] += fx * fy;
        }
    }
    const pixels = new Uint8Array(4 * size * size);
    const flatWater = (samples / size) ** 2;
    energy.forEach((value, i) => {
        const v = Math.min(255, Math.round((255 * value) / (4 * flatWater)));
        pixels.set([v, v, v, 255], i * 4);
    });
    return encodePng(pixels, size, size);
}

const manifestFile = new URL('asset-manifest.json', folder);
const manifest = JSON.parse(readFileSync(manifestFile));
const check = process.argv.includes('--check');
function writeAsset(file, kind, png) {
    if (check) {
        // The compressor can differ between Node releases. The mineral weights and irradiance must match.
        const shipped = decodePng(readFileSync(new URL(file, folder)));
        const generated = decodePng(png);
        if (shipped.width !== generated.width || shipped.height !== generated.height
            || !Buffer.from(generated.rgba).equals(shipped.rgba)) {
            throw new Error(`${file} differs from the current cave. Run node scripts/crystal-cave/bake-water.mjs`);
        }
        return;
    }
    writeFileSync(new URL(file, folder), png);
    manifest.assets = manifest.assets.filter((asset) => asset.file !== file);
    manifest.assets.push({
        file, kind, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
    });
}
writeAsset('pool-reflection.png', 'reflection', encodePng(rgba, W * 2, H));
writeAsset('pool-caustics.png', 'caustics', bakeCaustics());
if (!check) writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
