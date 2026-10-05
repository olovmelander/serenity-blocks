/**
 * Lunara — the valley's plan (CPU only, three-free, seeded and deterministic).
 *
 * One call lays out everything that has a place: the near terrain's heights (mirror flats in the
 * middle, banks rising either side, a far shore), the two ranges' skylines, every crystal spire
 * and every lantern flower. The world builds geometry from it and aims gameplay at it; tests read
 * it without a renderer.
 *
 * Crystals are listed by importance: the two hero clusters that bracket the board, the clusters
 * that step back along both shores, then the scatter. A tier draws the first N of them.
 */

import {
    TAU, TERRAIN, clamp01, mulberry32, smooth,
} from './lunara-core.js';

/** Same field the GPU reads: see bakeNoise() in lunara-tsl.js (passed in to keep this three-free). */
function noiseAt(field, size, x, y, channel) {
    const fx = (((x % 1) + 1) % 1) * size - 0.5;
    const fy = (((y % 1) + 1) % 1) * size - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (ix, iy) => field[((((iy % size) + size) % size) * size + (((ix % size) + size) % size)) * 4 + channel];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
}

/**
 * Crystal clusters, most important first: (x, z) of the mound, how many spires, the tallest
 * one's height, the mound's spread, and `hero` for the two that frame the board.
 */
export const CRYSTAL_CLUSTERS = Object.freeze([
    {
        x: -10.6, z: -17.5, count: 9, height: 10.8, spread: 2.6, hero: true, hue: 0.5,
    },
    {
        x: 10.6, z: -16.5, count: 8, height: 9.6, spread: 2.4, hero: true, hue: 0,
    },
    {
        x: -5.9, z: -7.6, count: 5, height: 2.3, spread: 1.2, hero: true,
    },
    {
        x: 7.4, z: -8.8, count: 5, height: 2.7, spread: 1.3, hero: true,
    },
    {
        x: -27, z: -44, count: 8, height: 8.5, spread: 4.5,
    },
    {
        x: 26, z: -50, count: 8, height: 9.5, spread: 4.5,
    },
    {
        x: -17, z: -33, count: 4, height: 3.6, spread: 2.2,
    },
    {
        x: 19, z: -34, count: 4, height: 4.2, spread: 2.4,
    },
    {
        x: -50, z: -88, count: 9, height: 12, spread: 7,
    },
    {
        x: 54, z: -96, count: 10, height: 13, spread: 7,
    },
    {
        x: -24, z: -128, count: 7, height: 8, spread: 6,
    },
    {
        x: 30, z: -142, count: 7, height: 9, spread: 6,
    },
    {
        x: -84, z: -165, count: 10, height: 16, spread: 10,
    },
    {
        x: 88, z: -180, count: 11, height: 18, spread: 11,
    },
    {
        x: -38, z: -224, count: 9, height: 13, spread: 9,
    },
    {
        x: 46, z: -244, count: 9, height: 15, spread: 9,
    },
    {
        x: 4, z: -285, count: 9, height: 17, spread: 12,
    },
    {
        x: -120, z: -250, count: 10, height: 22, spread: 13,
    },
    {
        x: 126, z: -262, count: 10, height: 24, spread: 13,
    },
]);

/** The most crystals any tier draws. */
export const MAX_CRYSTALS = 420;
/** The most lantern flowers any tier draws. */
export const MAX_FLORA = 420;

const lakeCentre = (z) => 9 * Math.sin(z * 0.011 + 0.6);
const lakeHalf = (z) => 25 + Math.max(0, -z) * 0.2 + Math.max(0, z) * 0.6;

/**
 * Terrain height (metres, water at 0) from the valley's shape alone — before the mounds the
 * crystal clusters stand on. Negative under the mirror flats.
 */
function baseHeight(noise, size, x, z) {
    const n1 = noiseAt(noise, size, x * 0.0031 + 0.13, z * 0.0031 + 0.41, 0);
    const n2 = noiseAt(noise, size, x * 0.011 + 0.7, z * 0.011 + 0.2, 1);
    const n3 = noiseAt(noise, size, x * 0.041, z * 0.041, 2);
    const shore = Math.abs(x - lakeCentre(z)) - lakeHalf(z) - (n1 - 0.5) * 34;
    // The lake ends at a far shore.
    const farShore = (-z - 318) + (n1 - 0.5) * 30;
    const d = Math.max(shore, farShore);
    if (d < 0) {
        // The bed: a shelf near the shore, deepening toward the middle.
        return -0.12 - 0.95 * smooth(0, 16, -d) + (n3 - 0.5) * 0.12;
    }
    const ridged = 1 - Math.abs(n2 * 2 - 1);
    const rise = 0.085 * d + 0.0016 * d * d;
    const relief = (ridged * ridged * 7 + (n3 - 0.5) * 1.6) * smooth(0, 14, d);
    return rise + relief + 0.04;
}

/** Skyline of a range: sharp crystalline peaks over a ridged base. Returns heights per column. */
function bakeSkyline(rand, columns, {
    base, amp, peaks, peakHeight, notchAt = null, notchWidth = 0.3, notchDepth = 0.6,
}) {
    const out = new Float32Array(columns + 1);
    // Three octaves of 1D value noise, ridged.
    const octave = (freq) => {
        const knots = new Float32Array(freq + 2);
        for (let i = 0; i < knots.length; i++) knots[i] = rand();
        return (t) => {
            const f = t * freq;
            const i = Math.min(freq, Math.floor(f));
            const k = f - i;
            const s = k * k * (3 - 2 * k);
            return knots[i] + (knots[i + 1] - knots[i]) * s;
        };
    };
    const o1 = octave(9);
    const o2 = octave(27);
    const o3 = octave(80);
    const list = [];
    for (let i = 0; i < peaks; i++) {
        list.push({
            at: (i + 0.15 + rand() * 0.7) / peaks,
            width: 0.018 + rand() * 0.05,
            height: peakHeight * (0.45 + rand() * 0.55),
            lean: (rand() - 0.5) * 0.6,
        });
    }
    for (let c = 0; c <= columns; c++) {
        const t = c / columns;
        const ridge = (1 - Math.abs(o1(t) * 2 - 1)) * 0.6 + (1 - Math.abs(o2(t) * 2 - 1)) * 0.28 + o3(t) * 0.12;
        let h = base + amp * ridge;
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const dx = (t - p.at) / p.width;
            const side = dx < 0 ? 1 + p.lean : 1 - p.lean;
            const k = Math.max(0, 1 - Math.abs(dx) / side);
            h = Math.max(h, base + p.height * k ** 1.35 + amp * ridge * 0.35);
        }
        if (notchAt !== null) {
            const k = Math.exp(-(((t - notchAt) / notchWidth) ** 2));
            h *= 1 - notchDepth * k;
        }
        out[c] = h;
    }
    return out;
}

/**
 * @param {Float32Array} noise  the baked noise field (size × size × 4)
 * @param {number} noiseSize
 * @param {number} [seed]
 */
export function buildPlan(noise, noiseSize, seed = 20261005) {
    const rand = mulberry32(seed);
    const {
        size, halfWidth, zMin, zMax,
    } = TERRAIN;

    // ── Mounds the clusters stand on ──
    const mounds = CRYSTAL_CLUSTERS.map((c) => ({
        // The hero clusters rise straight out of the shallows, ringed by the shore's light.
        x: c.x, z: c.z, radius: c.spread * 1.5 + 0.8, lift: c.hero ? -0.03 : 0.9,
    }));
    const heightAt = (x, z) => {
        let h = baseHeight(noise, noiseSize, x, z);
        for (let i = 0; i < mounds.length; i++) {
            const m = mounds[i];
            const dx = x - m.x;
            const dz = z - m.z;
            const d2 = (dx * dx + dz * dz) / (m.radius * m.radius);
            if (d2 < 4) {
                // A mound lifts the bed above the water; it never sinks ground that is higher.
                h += (Math.max(h, m.lift) - h) * Math.exp(-d2 * 1.6);
            }
        }
        return h;
    };

    // ── The heightmap the terrain mesh and the water share ──
    const heights = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
        const z = zMin + ((j + 0.5) / size) * (zMax - zMin);
        for (let i = 0; i < size; i++) {
            const x = -halfWidth + ((i + 0.5) / size) * halfWidth * 2;
            heights[j * size + i] = heightAt(x, z);
        }
    }

    // ── Crystals ──
    const crystals = [];
    const hues = [0, 0, 0, 0, 0.5, 0.5, 1, 1, 0.25, 0.75, 0.15, 1.25];
    const addCrystal = (x, z, height, lean, leanDir, cluster, hero, main, hue = null) => {
        const ground = heightAt(x, z);
        const radius = height * (main ? 0.056 : 0.06 + rand() * 0.045) + 0.03;
        // Buried in proportion: a small spire must not sink under the water it stands in.
        const y = ground - Math.min(0.25, height * 0.2) - radius * 0.4;
        const tx = Math.sin(leanDir) * Math.sin(lean);
        const tz = Math.cos(leanDir) * Math.sin(lean);
        const ty = Math.cos(lean);
        crystals.push({
            x,
            y,
            z,
            height,
            radius,
            axis: [tx, ty, tz],
            yaw: rand() * TAU,
            hue: hue ?? hues[Math.floor(rand() * hues.length)],
            seed: Math.floor(rand() * 4096),
            cluster,
            hero,
            main,
            // The tip a wisp flies to and a pillar rises from.
            tip: [x + tx * height, y + ty * height, z + tz * height],
        });
    };
    CRYSTAL_CLUSTERS.forEach((c, index) => {
        for (let k = 0; k < c.count; k++) {
            if (k === 0) {
                addCrystal(c.x, c.z, c.height, 0.03 + rand() * 0.06, rand() * TAU, index, Boolean(c.hero), true, c.hue ?? null);
            } else {
                const a = (k / (c.count - 1)) * TAU + rand() * 0.9;
                const r = c.spread * (0.25 + 0.75 * Math.sqrt(rand()));
                const h = c.height * (0.16 + 0.5 * rand() ** 1.6) * (1 - 0.35 * (r / c.spread));
                addCrystal(
                    c.x + Math.sin(a) * r,
                    c.z + Math.cos(a) * r * 0.8,
                    Math.max(0.45, h),
                    0.1 + rand() * 0.34,
                    a + (rand() - 0.5) * 0.7,
                    index,
                    Boolean(c.hero),
                    false,
                );
            }
        }
    });
    const clustered = crystals.length;
    // The scatter: lone spires along both banks and out on the shelves.
    let guard = 0;
    while (crystals.length < MAX_CRYSTALS && guard < 20000) {
        guard += 1;
        const z = -18 - rand() ** 0.8 * 300;
        const x = (rand() * 2 - 1) * Math.min(halfWidth - 12, 30 + -z * 0.5);
        const h = heightAt(x, z);
        if (h < -0.55 || h > 16) continue;
        // Keep the lane down the middle of the flats open: it carries the moons' reflection.
        if (Math.abs(x - lakeCentre(z)) < 9 + -z * 0.035) continue;
        const tall = 0.7 + rand() ** 2.2 * (2.5 + -z * 0.035);
        addCrystal(x, z, tall, rand() * 0.3, rand() * TAU, -1, false, rand() < 0.3);
    }

    // ── Lantern flowers: on the damp ground just above the water, in drifts ──
    const flora = [];
    guard = 0;
    while (flora.length < MAX_FLORA && guard < 40000) {
        guard += 1;
        let z = -5 - rand() ** 1.25 * 190;
        let x = (rand() * 2 - 1) * Math.min(halfWidth - 20, 16 + -z * 0.62);
        // Two drifts in five gather at the foot of a cluster of spires.
        if (rand() < 0.4) {
            const c = CRYSTAL_CLUSTERS[Math.floor(rand() ** 1.6 * CRYSTAL_CLUSTERS.length)];
            const a = rand() * TAU;
            const r = c.spread * (0.8 + rand() * 1.4);
            x = c.x + Math.sin(a) * r;
            z = c.z + Math.cos(a) * r;
        }
        const h = heightAt(x, z);
        // They stand on the damp ground and out in the first of the shallows.
        if (h < -0.16 || h > 2.4) continue;
        const drift = 2 + Math.floor(rand() * 5);
        for (let k = 0; k < drift && flora.length < MAX_FLORA; k++) {
            const fx = x + (rand() - 0.5) * 2.4;
            const fz = z + (rand() - 0.5) * 2.4;
            const fh = heightAt(fx, fz);
            if (fh < -0.18 || fh > 3) continue;
            flora.push({
                x: fx,
                y: Math.max(fh, 0),
                z: fz,
                height: 0.55 + rand() * 1.3 + clamp01(-z / 160) * 0.8,
                hue: rand(),
                seed: rand() * 100,
            });
        }
    }

    // ── The two ranges that close the valley: a notch in each lets the great moon rise ──
    const ridges = [
        {
            radius: 470,
            depth: 150,
            columns: 200,
            arc: 1.9,
            floor: -4,
            skyline: bakeSkyline(rand, 200, {
                base: 10, amp: 24, peaks: 15, peakHeight: 84, notchAt: 0.37, notchWidth: 0.1, notchDepth: 0.6,
            }),
        },
        {
            radius: 980,
            depth: 320,
            columns: 220,
            arc: 1.75,
            floor: -6,
            skyline: bakeSkyline(rand, 220, {
                base: 46, amp: 66, peaks: 13, peakHeight: 300, notchAt: 0.36, notchWidth: 0.1, notchDepth: 0.72,
            }),
        },
    ];

    return {
        seed, heights, heightAt, crystals, clustered, flora, ridges, mounds,
    };
}

/** How many of the plan's crystals are worth aiming a wisp at (the clusters, not the scatter). */
export function strikeTargets(plan, drawn) {
    return Math.min(drawn, plan.clustered);
}
