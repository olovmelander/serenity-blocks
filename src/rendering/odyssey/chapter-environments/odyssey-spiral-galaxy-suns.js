// @ts-check
/**
 * @fileoverview THE GALAXY'S SUNS (2026-10-31, the space masterpiece pass). Olov, on the ported
 * disc: "The galaxy feels to much as a photo right now! We can do better so it feels like in the
 * galaxy theme!" What makes the theme's galaxy alive is its suns: tens of thousands of points of
 * light, each never under a pixel, twinkling, the old ones streaming round and brightening as they
 * cross an arm (the density wave), the young ones riding the arms. This is the plan they are drawn
 * from, re-derived from `src/themes/galaxy/galaxy-plan.js` `buildPlan` (theme code is never
 * imported into Odyssey): four populations, in the galaxy's own frame (SPIRAL_GALAXY's units).
 * Three-free and seeded.
 *   orbit  (radius, angle or offset from the ridge, height, seed)
 *   look   (temperature 0 warm .. 1 blue, magnitude 0..1, population 0 arm / 1 disc / 2 bulge /
 *          3 halo, phase)
 */

export const SPIRAL_GALAXY_SUNS = Object.freeze({
    /** Suns by the board's quality tier. */
    count: Object.freeze({ high: 12000, low: 5000 }),
    /** Their light over the theme's: seen from ~1600 u, not ~240, most are sub-pixel and paid back
     * in light, so the field needs this to read as suns rather than a faint grain. */
    gain: 2.2,
    seed: 0x9a1a2026,
});

/** The galaxy's frame (SPIRAL_GALAXY, repeated here so the plan stays three-free). */
const RADIUS = 100;
const SCALE_LENGTH = 27;
const BULGE = 6.2;
const BULGE_FLAT = 0.74;
const ARM_START = 8.5;
const TAU = Math.PI * 2;

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

function gaussian(rand) {
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand());
}

/**
 * @param {number} count
 * @param {number} [seed]
 * @returns {{ count: number, orbit: Float32Array, look: Float32Array }}
 */
export function planSpiralGalaxySuns(count, seed = SPIRAL_GALAXY_SUNS.seed) {
    const rand = mulberry32(seed);
    const orbit = new Float32Array(count * 4);
    const look = new Float32Array(count * 4);
    const youngLength = SCALE_LENGTH * 2.3;
    for (let i = 0; i < count; i += 1) {
        const pick = rand();
        let pop;
        let radius = ARM_START;
        let angle;
        let y;
        let temp;
        // Most suns are faint dust (magnitude under 0.6); one in fifty carries the picture.
        let mag = rand() < 0.02 ? 0.6 + (0.4 * (rand() ** 2)) : 0.6 * (rand() ** 1.8);
        if (pick < 0.44) {
            pop = 0;
            // r e^(-r/L) between the bar and the rim, by rejection.
            for (let tries = 0; tries < 40; tries += 1) {
                radius = (ARM_START * 0.8) + (rand() * ((RADIUS * 1.04) - (ARM_START * 0.8)));
                const p = (radius / youngLength) * Math.exp(1 - (radius / youngLength));
                if (rand() < p) break;
            }
            // The ridge's own width, leaning to the trailing side where the young light is.
            angle = -0.07 + (gaussian(rand) * 0.27) + (rand() < 0.5 ? 0 : Math.PI);
            y = gaussian(rand) * 0.85;
            temp = 0.62 + (rand() * 0.38);
        } else if (pick < 0.82) {
            pop = 1;
            do {
                radius = -SCALE_LENGTH * Math.log(Math.max(1e-9, rand() * rand()));
            } while (radius > RADIUS * 1.1 || radius < 2.5);
            angle = rand() * TAU;
            y = gaussian(rand) * (1.5 + (1.4 * Math.exp(-radius / 30)));
            temp = 0.16 + (rand() * 0.5);
        } else if (pick < 0.955) {
            pop = 2;
            // A Plummer sphere, flattened along the axis.
            let rho;
            do {
                rho = (BULGE * 0.92) / Math.sqrt(((Math.max(1e-6, rand())) ** (-2 / 3)) - 1 + 1e-6);
            } while (rho > 34);
            const cz = (rand() * 2) - 1;
            const sz = Math.sqrt(1 - (cz * cz));
            radius = Math.max(0.2, rho * sz);
            y = rho * cz * BULGE_FLAT;
            angle = rand() * TAU;
            temp = 0.04 + (rand() * 0.34);
            mag = Math.min(1, (mag * 0.9) + 0.04);
        } else {
            pop = 3;
            const rho = 16 + (110 * (rand() ** 2.6));
            const cz = (rand() * 2) - 1;
            const sz = Math.sqrt(1 - (cz * cz));
            radius = Math.max(1, rho * sz);
            y = rho * cz * 0.8;
            angle = rand() * TAU;
            temp = 0.08 + (rand() * 0.3);
            // One in thirty is a globular cluster.
            mag = rand() < 0.035 ? 0.75 + (rand() * 0.25) : mag * 0.6;
        }
        orbit.set([radius, angle, y, rand()], i * 4);
        look.set([temp, mag, pop, rand()], i * 4);
    }
    return { count, orbit, look };
}
