/**
 * Galaxy — the plan (CPU only, three-free): where every sun, nursery and foreground star is.
 *
 * Deterministic for a seed. Every list is in an order a quality tier can cut anywhere: a prefix
 * of the suns is a fair sample of all four populations, and a prefix of the nurseries still
 * covers both arms from the bar to the rim.
 *
 * Suns, by population (`look.z`):
 *   0  arm      young and blue. They are born in the arms and die there, so they keep their place
 *               in the pattern: stored as an offset from the arm's ridge, which is why they follow
 *               when gameplay winds the arms. A third of them crowd round the nurseries.
 *   1  disc     old and warm, spread evenly round the disc. They ORBIT: inside corotation they
 *               overtake the pattern and brighten as they pass through an arm.
 *   2  bulge    the old spheroid round the nucleus.
 *   3  halo     a thin sphere of old suns and globular clusters far out of the plane.
 */

import {
    GALAXY, TAU, armAngle, mulberry32,
} from './galaxy-core.js';

export const MAX_STARS = 190000;
export const MAX_NURSERIES = 144;
export const MAX_GIANTS = 140;

/** How far behind an arm's ridge (radians) the nurseries sit: on its trailing, outer edge. */
export const NURSERY_OFFSET = -0.25;

function gaussian(rand) {
    // Box–Muller: one normal deviate.
    const a = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * rand());
}

/** Nursery sites: both arms, bar to rim, shuffled so a prefix is still spread along them. */
function planNurseries(rand) {
    const sites = [];
    const perArm = MAX_NURSERIES / 2;
    for (let i = 0; i < MAX_NURSERIES; i++) {
        const arm = i % 2;
        const k = (Math.floor(i / 2) + 0.15 + rand() * 0.7) / perArm;
        const radius = 13 + (GALAXY.radius * 0.93 - 13) * k ** 0.92;
        sites.push({
            radius,
            arm,
            /** Angle from the arm's ridge at this radius (the shaders add the ridge's own angle). */
            offset: NURSERY_OFFSET + gaussian(rand) * 0.085 + arm * Math.PI,
            y: gaussian(rand) * 0.35,
            size: 2.0 + rand() * 1.9 + (radius / GALAXY.radius) * 0.9,
            seed: rand(),
        });
    }
    // Fisher–Yates with the plan's own generator.
    for (let i = sites.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [sites[i], sites[j]] = [sites[j], sites[i]];
    }
    return sites;
}

/**
 * @param {number} [seed]
 * @param {{ stars?: number }} [limits]  build fewer suns than MAX_STARS (tests)
 */
export function buildPlan(seed = 0x9a1a2026, limits = {}) {
    const rand = mulberry32(seed);
    const nurseries = planNurseries(rand);

    const count = Math.max(0, Math.min(MAX_STARS, Math.round(limits.stars ?? MAX_STARS)));
    /** (radius, angle or offset from the ridge, height, seed) */
    const orbit = new Float32Array(count * 4);
    /** (temperature 0 warm..1 blue, magnitude 0..1, population, phase) */
    const look = new Float32Array(count * 4);
    const tally = [0, 0, 0, 0];
    const youngLength = GALAXY.scaleLength * 2.3;
    for (let i = 0; i < count; i++) {
        const pick = rand();
        let pop;
        let radius;
        let angle;
        let y;
        let temp;
        // Most suns are faint dust (magnitude under 0.6); one in thirty carries the picture.
        let mag = rand() < 0.02 ? 0.6 + 0.4 * rand() ** 2 : 0.6 * rand() ** 1.8;
        if (pick < 0.44) {
            pop = 0;
            if (rand() < 0.2) {
                // A member of an association round a nursery.
                const site = nurseries[Math.floor(rand() * nurseries.length)];
                const spread = 2.4 + site.size * 0.8;
                radius = Math.max(GALAXY.armStart, site.radius + gaussian(rand) * spread);
                angle = site.offset + (gaussian(rand) * spread) / Math.max(8, radius);
                mag = Math.min(1, mag * 1.15 + 0.03);
            } else {
                // r·e^(−r/L) between the bar and the rim, by rejection.
                for (let tries = 0; tries < 40; tries++) {
                    radius = GALAXY.armStart * 0.8 + rand() * (GALAXY.radius * 1.04 - GALAXY.armStart * 0.8);
                    const p = (radius / youngLength) * Math.exp(1 - radius / youngLength);
                    if (rand() < p) break;
                }
                // The ridge's own width, leaning to the trailing side where the young light is.
                angle = -0.07 + gaussian(rand) * 0.27 + (rand() < 0.5 ? 0 : Math.PI);
            }
            y = gaussian(rand) * 0.85;
            temp = 0.62 + rand() * 0.38;
        } else if (pick < 0.82) {
            pop = 1;
            do {
                radius = -GALAXY.scaleLength * Math.log(Math.max(1e-9, rand() * rand()));
            } while (radius > GALAXY.radius * 1.1 || radius < 2.5);
            angle = rand() * TAU;
            y = gaussian(rand) * (1.5 + 1.4 * Math.exp(-radius / 30));
            temp = 0.16 + rand() * 0.5;
        } else if (pick < 0.955) {
            pop = 2;
            // A Plummer sphere, flattened along the axis.
            let rho;
            do {
                rho = (GALAXY.bulge * 0.92) / Math.sqrt(Math.max(1e-6, rand()) ** (-2 / 3) - 1 + 1e-6);
            } while (rho > 34);
            const cz = rand() * 2 - 1;
            const sz = Math.sqrt(1 - cz * cz);
            radius = Math.max(0.2, rho * sz);
            y = rho * cz * GALAXY.bulgeFlat;
            angle = rand() * TAU;
            temp = 0.04 + rand() * 0.34;
            mag = Math.min(1, mag * 0.9 + 0.04);
        } else {
            pop = 3;
            const rho = 16 + 110 * rand() ** 2.6;
            const cz = rand() * 2 - 1;
            const sz = Math.sqrt(1 - cz * cz);
            radius = Math.max(1, rho * sz);
            y = rho * cz * 0.8;
            angle = rand() * TAU;
            temp = 0.08 + rand() * 0.3;
            // One in thirty is a globular cluster.
            mag = rand() < 0.035 ? 0.75 + rand() * 0.25 : mag * 0.6;
        }
        tally[pop] += 1;
        orbit.set([radius, angle, y, rand()], i * 4);
        look.set([temp, mag, pop, rand()], i * 4);
    }

    // Foreground stars of the deep sky: directions on the unit sphere ahead of the camera. Their
    // own generator: the sky must not change with how many suns a tier draws.
    const skyRand = mulberry32((seed ^ 0x51ed270b) >>> 0);
    const giants = [];
    for (let i = 0; i < MAX_GIANTS; i++) {
        const x = (skyRand() * 2 - 1) * 1.15;
        const yy = (skyRand() * 2 - 1) * 0.72;
        const len = Math.hypot(x, yy, 1);
        giants.push({
            dir: [x / len, yy / len, -1 / len],
            size: 0.3 + skyRand() ** 3.2 * 0.9,
            temp: skyRand(),
            phase: skyRand(),
        });
    }
    // The brightest first, so every tier keeps the ones that carry the sky.
    giants.sort((a, b) => b.size - a.size);

    return {
        seed,
        stars: {
            count, orbit, look, tally,
        },
        nurseries,
        giants,
    };
}

/** A nursery's place in the galaxy's frame for a winding. */
export function nurseryPosition(site, winding = GALAXY.winding, out = [0, 0, 0]) {
    const angle = armAngle(site.radius, winding) + site.offset;
    out[0] = Math.cos(angle) * site.radius;
    out[1] = site.y;
    out[2] = Math.sin(angle) * site.radius;
    return out;
}
