/**
 * Sunbraid — the land's plan (three-free): the valley floor's height everywhere, and where the
 * towers stand.
 *
 * The eye hovers high over a broad valley of pale sand and stone that runs away to a far rim. Out
 * of the valley floor rise the towers and buttes, pale bedded sandstone, the nearest taller than
 * the eye. Seen from above, every tower's three shadows (one per sun, a third of a turn apart) lie
 * across the pale floor as long coloured stripes, so the valley is a sundial the suns write on.
 *
 * Composition (16:9, the card over the middle sixth): a big group frames each side near the eye,
 * a butte and a mitten stand in the middle distance, and far towers stand along the valley on
 * either side of the card and behind it, so their shadows cross the floor in front of it.
 */
import { DEG, smooth } from './sunbraid-core.js';
import { noiseAt } from './sunbraid-noise.js';
import { spireProxies } from './sunbraid-spire-shape.js';

/** How high the eye hovers over the valley floor (metres). */
export const EYE_ALTITUDE = 70;

/** The valley floor's height (metres) at (x, z). */
export function floorHeight(x, z) {
    const d = Math.hypot(x, z);
    // Broad swells (kilometres across), a few metres of gentle relief, almost no fine bumps:
    // a slope lit by three suns is a colour, so every bump would be a dab of paint.
    const swell = (noiseAt(x / 14000, z / 14000, 0) - 0.5) * 60 * smooth(200, 2500, d);
    const roll = (noiseAt(x / 5200 + 0.37, z / 5200 + 0.11, 0) - 0.5) * 16;
    // The far rim: a long pale escarpment beyond the valley.
    const rimNoise = noiseAt(x / 18000 + 0.21, z / 18000 + 0.64, 0);
    const rimRaw = (190 + 280 * rimNoise) * smooth(5200, 10200, d);
    // Bedded escarpments: flat benches and steep risers.
    const stepH = 55;
    const level = Math.floor(rimRaw / stepH);
    const riser = smooth(0.62, 0.92, rimRaw / stepH - level);
    const rim = (level + riser) * stepH;
    return swell + roll + rim;
}

/** The ground's height (metres) at (x, z). */
export const groundHeight = floorHeight;

/** The eye's world position: hovering over the valley. */
export function eyePosition(out = [0, 0, 0]) {
    out[0] = 0;
    out[2] = 0;
    out[1] = floorHeight(0, 0) + EYE_ALTITUDE;
    return out;
}

/**
 * The towers: shape (sunbraid-spire-shape.js variant: 0 2 4 6 towers, 1 5 buttes, 3 7 mittens),
 * bearing from the view axis (degrees, right positive), distance (metres), height (metres) and a
 * turn about its axis (radians).
 */
export const SPIRE_LAYOUT = Object.freeze([
    // Left of the board, under the suns: a broad mesa and a tall tower whose fans run to the eye.
    [1, -33, 1100, 170, 0.4],
    [0, -24, 900, 300, 1.9],
    [4, -40, 1500, 260, 3.1],
    [3, -17, 1750, 230, 0.8],
    [5, -29, 3800, 220, 4.4],
    // Right of the board: a big butte lit across its faces, a tall tower, a mitten beyond.
    [5, 31, 1300, 190, 3.7],
    [2, 23.5, 1050, 300, 2.2],
    [6, 37, 2000, 260, 0.3],
    [7, 46, 2600, 240, 2.9],
    [1, 20, 4200, 210, 4.8],
    // Far along the valley, behind the card.
    [3, -6, 5200, 260, 0.9],
    [6, 6, 3600, 260, 3.4],
    // Out at the sides (a 21:9 screen).
    [2, 58, 1200, 280, 1.1],
    [4, -58, 1300, 270, 2.4],
].map(([variant, bearing, distance, h, twist]) => Object.freeze({
    variant, bearing, distance, h, twist,
})));

/** Which shape (sunbraid-spire-shape.js) the layout's tower number `index` takes. */
export const variantOf = (index) => SPIRE_LAYOUT[index]?.variant ?? 0;

/** Where tower `s` stands (world x, floor y, z). */
export function spireFoot(s, out = [0, 0, 0]) {
    const az = s.bearing * DEG;
    out[0] = Math.sin(az) * s.distance;
    out[2] = -Math.cos(az) * s.distance;
    out[1] = floorHeight(out[0], out[2]);
    return out;
}

/**
 * The towers as shadow casters: each tier a flat-topped vertical cylinder (axis x, z; from y0 to
 * y1; radius r) that follows its shape's tiers (sunbraid-spire-shape.js spireProxies), scaled to
 * its height and turned as it is drawn. The same layout draws the towers and shadows the land.
 */
export function spireCasters(layout = SPIRE_LAYOUT) {
    const casters = [];
    const foot = [0, 0, 0];
    layout.forEach((s, index) => {
        spireFoot(s, foot);
        const c = Math.cos(s.twist);
        const sn = Math.sin(s.twist);
        spireProxies(s.variant).forEach((proxy, k) => {
            // Three.js turns +x toward -z for a positive turn about +y.
            const lx = proxy.x * s.h;
            const lz = proxy.z * s.h;
            casters.push({
                stone: index,
                part: k,
                x: foot[0] + lx * c + lz * sn,
                z: foot[2] - lx * sn + lz * c,
                y0: foot[1] + proxy.t0 * s.h,
                y1: foot[1] + proxy.t1 * s.h,
                r: proxy.r * s.h,
            });
        });
    });
    return casters;
}

/** Most casters the shaders read (rows are allocated for this many). */
export const MAX_CASTERS = 96;
