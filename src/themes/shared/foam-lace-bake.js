/**
 * THE FOAM LACE BAKE (moved from the Waves theme, 2026-11-21, so the Odyssey sea's whitecaps can
 * share it). A tiling RGBA8 tile of cell structure, three-free:
 *   R  how far a texel lies from the wall between the two nearest of 9 x 9 large cells
 *      (f2 - f1, scaled: 0 on a wall);
 *   G  the same for 21 x 21 small cells;
 *   B  one number per large cell (so whole cells can be dropped or filled);
 *   A  37 x 37 round bubbles.
 * The tile wraps on every channel. Same seed, same bytes.
 */

/** A small deterministic random source (the Waves theme's). */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

/**
 * @param {number} [size] texels across (square)
 * @param {number} [seed]
 * @returns {Uint8Array} size * size * 4
 */
export function bakeFoamLace(size = 256, seed = 20261116) {
    const rand = mulberry32(seed);
    /** Jittered points, one per cell of an n × n tile, each with a number of its own. */
    const scatter = (n) => {
        const points = new Float32Array(n * n * 3);
        for (let i = 0; i < n * n; i += 1) {
            points[i * 3] = 0.12 + rand() * 0.76;
            points[i * 3 + 1] = 0.12 + rand() * 0.76;
            points[i * 3 + 2] = rand();
        }
        return points;
    };
    const large = { n: 9, points: scatter(9) };
    const small = { n: 21, points: scatter(21) };
    const dots = { n: 37, points: scatter(37) };
    const found = { f1: 0, f2: 0, id: 0 };
    /** The two nearest points of a scatter to (x, y) in 0..1 (the tile wraps), in cells. */
    const nearest = ({ n, points }, x, y) => {
        const gx = x * n;
        const gy = y * n;
        const cx = Math.floor(gx);
        const cy = Math.floor(gy);
        let f1 = 9;
        let f2 = 9;
        let id = 0;
        for (let j = -1; j <= 1; j += 1) {
            for (let i = -1; i <= 1; i += 1) {
                const ix = (((cx + i) % n) + n) % n;
                const iy = (((cy + j) % n) + n) % n;
                const at = (iy * n + ix) * 3;
                const dx = cx + i + points[at] - gx;
                const dy = cy + j + points[at + 1] - gy;
                const d = Math.hypot(dx, dy);
                if (d < f1) {
                    f2 = f1;
                    f1 = d;
                    id = points[at + 2];
                } else if (d < f2) {
                    f2 = d;
                }
            }
        }
        found.f1 = f1;
        found.f2 = f2;
        found.id = id;
        return found;
    };
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
            const x = (i + 0.5) / size;
            const y = (j + 0.5) / size;
            const at = (j * size + i) * 4;
            const a = nearest(large, x, y);
            data[at] = Math.round(clamp01((a.f2 - a.f1) * 1.25) * 255);
            data[at + 2] = Math.round(a.id * 255);
            const b = nearest(small, x, y);
            data[at + 1] = Math.round(clamp01((b.f2 - b.f1) * 1.25) * 255);
            const c = nearest(dots, x, y);
            data[at + 3] = Math.round(clamp01(1 - c.f1 * (2.2 + c.id * 2.6)) * 255);
        }
    }
    return data;
}
