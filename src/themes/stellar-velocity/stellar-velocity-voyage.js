/**
 * Stellar Velocity — the voyage: what the canyon is like where we are now. Three-free.
 *
 * The run passes through REGIONS of the nebula, one every REGION_STEP seconds of the clock, each
 * with a character of its own: an open reach, a narrow gorge where the walls rush past, lanes of
 * dark dust standing against the lit gas, a nursery of young stars burning inside the walls,
 * a field of glowing filaments, a clearing where the walls stand back and the sky opens. The
 * order is shuffled every round (never the same region twice in a row), and a jump drops us out
 * in the next one: the tunnel hides the change.
 *
 * Everything here is a pure function of the clock and how many jumps there have been, so a seek
 * finds the canyon where it would have been.
 *
 * A region's numbers (all eased from one region into the next):
 *   scale    how far the walls stand from the course (1 = the open reach; < 1 a gorge)
 *   thin     how much less cloud there is (+) or more (−)
 *   dust     how much of the gas is dark dust (the lanes that stand against the light)
 *   threads  how strongly the glowing streamers run along the walls
 *   nursery  how brightly the young stars in the walls burn
 *   rim      how brightly the sun-facing edges of the gas burn (its ionisation fronts)
 *   haze     how much of the far canyon is taken by the sun's haze
 *   pace     how fast we glide through it, as a share of cruise
 */
import { mulberry32, smooth } from './stellar-velocity-core.js';

export const REGIONS = Object.freeze([
    Object.freeze({
        name: 'reach', scale: 1.0, thin: 0.0, dust: 1.0, threads: 1.0, nursery: 0.3, rim: 1.0, haze: 1.0, pace: 1.0,
    }),
    Object.freeze({
        name: 'gorge', scale: 0.8, thin: -0.05, dust: 0.8, threads: 1.7, nursery: 0.15, rim: 1.15, haze: 0.85, pace: 1.45,
    }),
    Object.freeze({
        name: 'dust', scale: 1.05, thin: -0.03, dust: 1.75, threads: 0.7, nursery: 0.4, rim: 1.45, haze: 0.9, pace: 0.9,
    }),
    Object.freeze({
        name: 'nursery', scale: 1.08, thin: 0.02, dust: 1.0, threads: 0.9, nursery: 1.0, rim: 1.2, haze: 1.0, pace: 0.85,
    }),
    Object.freeze({
        name: 'filaments', scale: 1.0, thin: 0.07, dust: 0.65, threads: 2.3, nursery: 0.25, rim: 0.95, haze: 0.9, pace: 1.15,
    }),
    Object.freeze({
        name: 'clearing', scale: 1.28, thin: 0.11, dust: 1.1, threads: 0.85, nursery: 0.55, rim: 1.3, haze: 1.1, pace: 0.8,
    }),
]);

export const REGION_KEYS = Object.freeze(['scale', 'thin', 'dust', 'threads', 'nursery', 'rim', 'haze', 'pace']);

/** Seconds of the clock a region lasts (incommensurate with the palette's step, so the two drift apart). */
export const REGION_STEP = 72;
/** The share of a step at its end over which the canyon passes into the next region. */
export const REGION_BLEND = 0.3;
/** The region the clock starts in (the open reach: today's look). */
export const REGION_HOME = 0;

/** A round's shuffle, before the seam rule (the first round is the list's own order). */
function shuffled(round) {
    const order = REGIONS.map((_, i) => i);
    if (round <= 0) return order;
    const rand = mulberry32(0x5e1 + round * 7919);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/**
 * The order of the regions in round `round`. A round never opens on the region the last one
 * ended in: its first two swap. (Only the first two ever move, so a round's last region is its
 * shuffle's last.)
 */
export function roundOrder(round) {
    const order = shuffled(round);
    if (round > 0 && order[0] === shuffled(round - 1)[order.length - 1]) [order[0], order[1]] = [order[1], order[0]];
    return order;
}

/** The region index at whole step `k` of the voyage. */
export function regionAt(k) {
    const n = REGIONS.length;
    const step = Math.max(0, Math.floor(k));
    return roundOrder(Math.floor(step / n))[step % n];
}

/** The voyage's place for a clock and how many steps jumps have skipped. */
export const voyagePlace = (time, skip = 0) => Math.max(0, time) / REGION_STEP + Math.max(0, skip);

/**
 * The region at a place: every number mixed between the region of this step and the next, the
 * passage over the last REGION_BLEND of the step. Fills and returns `out` (with `name`, `next`,
 * `mix`).
 */
export function voyageAt(place, out = {}) {
    const k = Math.floor(place);
    const from = REGIONS[regionAt(k)];
    const to = REGIONS[regionAt(k + 1)];
    const mix = smooth(1 - REGION_BLEND, 1, place - k);
    for (let i = 0; i < REGION_KEYS.length; i++) {
        const key = REGION_KEYS[i];
        out[key] = from[key] + (to[key] - from[key]) * mix;
    }
    out.name = mix < 0.5 ? from.name : to.name;
    out.next = to.name;
    out.mix = mix;
    return out;
}

/**
 * How much a jump skips: from `place` to the start of the next whole step (a little past it, so
 * the passage is done). We arrive in the next region, already there.
 */
export function skipToNext(place) {
    return Math.floor(place) + 1.001 - place;
}

// ── The young stars in the walls ────────────────────────────────────────────────

/** Sites a stretch of the course holds, the length of that stretch, and the stars lit at once. */
export const BEACON_SITES = 9;
export const BEACON_SPAN = 64;
export const BEACON_SLOTS = 6;
/** The ones whose light the march carries (the nearest lit ones). */
export const BEACON_LIGHTS = 3;
/** Depths (ahead) where a young star fades in from the haze and where it is behind us. */
export const BEACON_FAR = 44;
export const BEACON_NEAR = -1.5;

/**
 * The sites of the young stars along one stretch of the course: where round it (angle), how far
 * from it (radius), how far along (z in 0..BEACON_SPAN), how bright, and which of three lights
 * it burns in (0 white-blue, 1 the palette's third colour, 2 rose). A jump draws a new stretch.
 */
export function beaconSites(seed) {
    const rand = mulberry32(0xbeac0 + seed * 977);
    const sites = [];
    for (let i = 0; i < BEACON_SITES; i++) {
        sites.push({
            angle: rand() * Math.PI * 2,
            radius: 1.25 + rand() * 1.9,
            z: (i + rand() * 0.8) * (BEACON_SPAN / BEACON_SITES),
            power: 0.55 + rand() * 0.45,
            kind: Math.floor(rand() * 3),
            phase: rand() * Math.PI * 2,
        });
    }
    return sites;
}

/** How far ahead a site stands when we have come `distance` (it comes toward us and wraps). */
export function beaconDepth(site, distance) {
    const span = BEACON_SPAN;
    const along = (((site.z - distance) % span) + span) % span;
    return along - 4;
}

/** How much of a site's light shows at a depth (fades in from the haze, out once passed). */
export function beaconFade(depth) {
    return smooth(BEACON_FAR, BEACON_FAR - 10, depth) * smooth(BEACON_NEAR, 0.6, depth);
}
