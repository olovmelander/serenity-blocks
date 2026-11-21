/**
 * Koi Pond — the bed's pebble field, baked on the CPU (no three: a module Worker bakes it on a
 * first visit, see koi-pond-theme.js; the bed reads it through the shared bake cache).
 */
import { clamp01, mulberry32, smooth } from './koi-pond-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

/** The pebble field's seed (the bed bakes it with this one). */
export const KOI_PEBBLES_SEED = 4117;

/** The bake cache's key for a pebble field. */
export const pebblesKey = (size, seed) => `koi-pond:pebbles:${size}:${seed}`;

const STONES = [
    [0.38, 0.37, 0.32], [0.18, 0.23, 0.26], [0.48, 0.35, 0.23], [0.34, 0.19, 0.135],
    [0.58, 0.55, 0.46], [0.082, 0.095, 0.112], [0.24, 0.32, 0.255],
];

/**
 * Bake a tileable field of pebbles.
 * @returns {{ size:number, colour:Uint8Array, relief:Uint8Array }} colour = rgb + height,
 *   relief = normal.xy (0.5 = flat), the gaps' occlusion, unused
 */
export function bakePebbles(size = 1024, seed = KOI_PEBBLES_SEED) {
    return bakeOnce(pebblesKey(size, seed), () => computePebbles(size, seed));
}

function computePebbles(size, seed) {
    const cells = Math.round((size / 1024) * 54);
    const rand = mulberry32(seed);
    const count = cells * cells;
    const px = new Float32Array(count);
    const py = new Float32Array(count);
    const ax = new Float32Array(count);
    const ay = new Float32Array(count);
    const ellipseXX = new Float32Array(count);
    const ellipseXZ = new Float32Array(count);
    const ellipseZZ = new Float32Array(count);
    const tone = new Float32Array(count);
    const lift = new Float32Array(count);
    const stone = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
        px[i] = 0.14 + rand() * 0.72;
        py[i] = 0.14 + rand() * 0.72;
        const a = rand() * Math.PI;
        ax[i] = Math.cos(a);
        ay[i] = Math.sin(a);
        const stretch = 1 + rand() * 0.75;
        tone[i] = 0.78 + rand() * 0.42;
        lift[i] = 0.5 + rand() * 0.5;
        stone[i] = Math.floor(rand() ** 1.25 * STONES.length);
        // Compare squared distances to the rotated ellipses. Build the axes once per stone,
        // so the nine candidates per texel need only multiplies and adds.
        const scale = 1 / (0.7 + (lift[i] - 0.5) * 1.15) ** 2;
        const along = scale / (stretch * stretch);
        const across = scale * stretch;
        ellipseXX[i] = ax[i] * ax[i] * along + ay[i] * ay[i] * across;
        ellipseXZ[i] = 2 * ax[i] * ay[i] * (along - across);
        ellipseZZ[i] = ay[i] * ay[i] * along + ax[i] * ax[i] * across;
    }
    const height = new Float32Array(size * size);
    const gap = new Float32Array(size * size);
    const colour = new Uint8Array(size * size * 4);
    const scale = cells / size;
    for (let j = 0; j < size; j += 1) {
        const y = (j + 0.5) * scale;
        const cy = Math.floor(y);
        for (let i = 0; i < size; i += 1) {
            const x = (i + 0.5) * scale;
            const cx = Math.floor(x);
            let f1 = 9;
            let f2 = 9;
            let id = 0;
            let localX = 0;
            let localY = 0;
            for (let oy = -1; oy <= 1; oy += 1) {
                const wy = (cy + oy + cells) % cells;
                for (let ox = -1; ox <= 1; ox += 1) {
                    const wx = (cx + ox + cells) % cells;
                    const cell = wy * cells + wx;
                    const dx = cx + ox + px[cell] - x;
                    const dy = cy + oy + py[cell] - y;
                    // Each stone is longer one way than the other.
                    const d = dx * dx * ellipseXX[cell] + dx * dy * ellipseXZ[cell] + dy * dy * ellipseZZ[cell];
                    if (d < f1) {
                        f2 = f1;
                        f1 = d;
                        id = cell;
                        localX = dx;
                        localY = dy;
                    } else if (d < f2) f2 = d;
                }
            }
            f1 = Math.sqrt(f1);
            const edge = Math.sqrt(f2) - f1;
            // A river stone: round where it has room, flattened where it meets a neighbour, with
            // dark grit showing in the gaps the round stones leave.
            const reach = 0.36 + lift[id] * 0.22;
            const q = f1 / reach;
            const round = q < 1 ? Math.sqrt(1 - q * q) : 0;
            const dome = round * smooth(0, 0.16, edge) ** 0.5;
            const at = j * size + i;
            height[at] = dome * (0.55 + lift[id] * 0.45);
            const inside = smooth(1.02, 0.86, q) * smooth(0, 0.06, edge);
            gap[at] = inside;
            const base = STONES[stone[id]];
            const speck = ((i * 7919 + j * 104729) % 97) / 97;
            const grain = 0.93 + 0.14 * (((i * 7919 + j * 104729 + id * 31) % 97) / 97);
            const k = tone[id] * grain * (0.62 + 0.38 * dome);
            const grit = 0.085 + speck * 0.07;
            // Some river stones keep a seam of quartz or iron, folded through the stone and
            // worn flush. Use its own coordinates so the seam cannot run on into a neighbour.
            let mineral = 0;
            if ((stone[id] === 1 || stone[id] === 3 || stone[id] === 5) && tone[id] > 0.91) {
                const along = localX * ax[id] + localY * ay[id];
                const across = localY * ax[id] - localX * ay[id];
                const seam = Math.abs(across + along * along * 0.72 + along * 0.16 + tone[id] - 1);
                mineral = (1 - smooth(0.013, 0.067, seam)) * (0.18 + 0.27 * dome);
            }
            const mortar = grit * (1 - inside);
            const pigment = k * inside;
            colour[at * 4] = Math.round(clamp01(mortar * 0.95 + (base[0] + mineral) * pigment) * 255);
            colour[at * 4 + 1] = Math.round(clamp01(mortar + (base[1] + mineral * 0.87) * pigment) * 255);
            colour[at * 4 + 2] = Math.round(clamp01(mortar * 0.92 + (base[2] + mineral * 0.7) * pigment) * 255);
            colour[at * 4 + 3] = Math.round(clamp01(height[at]) * 255);
        }
    }
    const relief = new Uint8Array(size * size * 4);
    const bump = 3.4;
    for (let j = 0; j < size; j += 1) {
        const jm = ((j - 1 + size) % size) * size;
        const jp = ((j + 1) % size) * size;
        for (let i = 0; i < size; i += 1) {
            const im = (i - 1 + size) % size;
            const ip = (i + 1) % size;
            const at = j * size + i;
            const nx = (height[j * size + im] - height[j * size + ip]) * bump;
            const ny = (height[jm + i] - height[jp + i]) * bump;
            relief[at * 4] = Math.round(clamp01(nx * 0.5 + 0.5) * 255);
            relief[at * 4 + 1] = Math.round(clamp01(ny * 0.5 + 0.5) * 255);
            relief[at * 4 + 2] = Math.round(clamp01(gap[at]) * 255);
            relief[at * 4 + 3] = 255;
        }
    }
    return { size, colour, relief };
}
