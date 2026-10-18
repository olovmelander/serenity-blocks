// @ts-check

/**
 * The Waystones road: five stops drawn from a seed over the worlds the player has collected.
 *
 * Stop one is the world on screen ("the road begins where you stand") under a gentle
 * climate; every later stop offers two worlds, each with its own climate, and the player
 * chooses one between stops. The last stop is the Keeper's: the same climates, a bigger
 * ask. Everything here is pure and seeded, so a road can be shared by its seed and
 * walked again.
 */

import { CLIMATES, climateById, isGentle } from './climates.js';
import {
    BALLAST_FACTOR, CHARMS, KEEL_FACTOR, TIDE_FACTOR,
} from './charms.js';

/** @typedef {import('./climates.js').Climate} Climate */
/** @typedef {{ id: string, name: string }} World */
/** @typedef {{ world: World, climateId: string }} Offer */
/** @typedef {{ index: number, keeper: boolean, offers: Offer[] }} Stop */
/** @typedef {{ seed: string, stops: Stop[] }} Road */

export const STOP_COUNT = 5;
export const OFFERS_PER_STOP = 2;
/** The Keeper asks this much more; a cascade goal asks one more cascade. */
export const KEEPER_FACTOR = 1.5;
/** Points a banked stack pays for each row of blocks carried, once the next stop is cleared. */
export const BANK_TOLL_PER_ROW = 60;

/** FNV-1a over the seed's characters: any string becomes a 32-bit state. */
export function hashSeed(seed) {
    let hash = 0x811c9dc5;
    const text = String(seed);
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * mulberry32: a small, well-mixed generator for authoring, never for the piece bag
 * (that stays on the session RNG, src/core/session-rng.js).
 * @param {number} state
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(state) {
    let a = state >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A stream of the road seed for one purpose (the road, a stop's draft), so each is stable. */
export function seededRng(seed, purpose) {
    return mulberry32(hashSeed(`${seed}:${purpose}`));
}

/** @param {() => number} rng @param {number} count */
function pickIndex(rng, count) {
    return Math.min(count - 1, Math.floor(rng() * count));
}

/**
 * @template T
 * @param {() => number} rng
 * @param {readonly T[]} items
 * @param {number} count
 * @param {(item: T) => boolean} [allowed]
 */
function pickDistinct(rng, items, count, allowed = () => true) {
    const pool = items.filter(allowed);
    const picked = [];
    while (picked.length < count && pool.length > 0) {
        picked.push(pool.splice(pickIndex(rng, pool.length), 1)[0]);
    }
    return picked;
}

/** Today's road, the same for everyone who sets out on it. */
export function dailySeed(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** A fresh road nobody has walked. */
export function randomSeed(random = Math.random) {
    return Math.floor(random() * 0xffffffff).toString(36);
}

/**
 * @param {Object} options
 * @param {string} options.seed
 * @param {World} options.startWorld the theme on screen when the road begins
 * @param {World[]} options.worlds the worlds the player may be offered (the collection)
 * @param {number} [options.stopCount]
 * @returns {Road}
 */
export function generateRoad({
    seed, startWorld, worlds, stopCount = STOP_COUNT,
}) {
    const rng = seededRng(seed, 'road');
    const pool = worlds.length > 0 ? worlds : [startWorld];
    /** @type {Stop[]} */
    const stops = [];
    let previousClimates = new Set();
    let previousWorlds = new Set([startWorld.id]);
    for (let index = 0; index < stopCount; index += 1) {
        const keeper = index === stopCount - 1;
        /** @type {Offer[]} */
        let offers;
        if (index === 0) {
            const [climate] = pickDistinct(rng, CLIMATES, 1, isGentle);
            offers = [{ world: startWorld, climateId: climate.id }];
        } else {
            // Two different worlds, neither the one just left when the collection allows it,
            // under two different climates that were not offered at the stop before.
            const lastWorlds = previousWorlds;
            const lastClimates = previousClimates;
            let worldPicks = pickDistinct(rng, pool, OFFERS_PER_STOP, (w) => !lastWorlds.has(w.id));
            if (worldPicks.length < OFFERS_PER_STOP) worldPicks = pickDistinct(rng, pool, OFFERS_PER_STOP);
            while (worldPicks.length < OFFERS_PER_STOP) worldPicks.push(worldPicks[0] || startWorld);
            let climatePicks = pickDistinct(rng, CLIMATES, OFFERS_PER_STOP, (c) => !lastClimates.has(c.id));
            if (climatePicks.length < OFFERS_PER_STOP) climatePicks = pickDistinct(rng, CLIMATES, OFFERS_PER_STOP);
            offers = worldPicks.map((world, i) => ({ world, climateId: climatePicks[i].id }));
        }
        stops.push({ index, keeper, offers });
        previousClimates = new Set(offers.map((offer) => offer.climateId));
        previousWorlds = new Set(offers.map((offer) => offer.world.id));
    }
    return { seed: String(seed), stops };
}

/**
 * What a stop asks once the road's rules are applied: the carried stack raises it (a
 * banked stack is material, not a head start; Ballast halves its weight), the Keeper
 * raises it, Keel lowers it.
 * @param {Climate} climate
 * @param {{ carriedRows?: number, keeper?: boolean, keel?: boolean, ballast?: boolean }} [terms]
 * @returns {{ type: import('./climates.js').ClimateGoalType, target: number }}
 */
export function scaledGoal(climate, {
    carriedRows = 0, keeper = false, keel = false, ballast = false,
} = {}) {
    const { type, base } = climate.goal;
    const rows = ballast ? carriedRows * BALLAST_FACTOR : carriedRows;
    let target;
    if (type === 'lines') target = base + Math.ceil(rows / 2);
    else if (type === 'score') target = base * (1 + 0.04 * rows);
    else target = base + (rows >= 8 ? 1 : 0);
    if (keeper) target = type === 'cascades' ? target + 1 : target * KEEPER_FACTOR;
    if (keel) target = type === 'cascades' ? Math.max(1, target - 1) : target * KEEL_FACTOR;
    if (type === 'score') return { type, target: Math.max(100, Math.round(target / 100) * 100) };
    return { type, target: Math.max(1, Math.round(target)) };
}

/**
 * What a banked stack pays once the next stop is cleared.
 * @param {number} rows rows of blocks carried
 * @param {{ tide?: boolean }} [charms]
 */
export function tollFor(rows, { tide = false } = {}) {
    return Math.max(0, Math.floor(rows)) * BANK_TOLL_PER_ROW * (tide ? TIDE_FACTOR : 1);
}

/**
 * The charms offered after a stop: three the player does not hold, in the seed's order.
 * @param {string} seed
 * @param {number} stopIndex
 * @param {readonly string[]} owned
 * @param {number} [count]
 */
export function draftCharms(seed, stopIndex, owned, count = 3) {
    const rng = seededRng(seed, `draft:${stopIndex}`);
    return pickDistinct(rng, CHARMS, count, (charm) => !owned.includes(charm.id)).map((charm) => charm.id);
}

/** @param {Offer} offer */
export function offerClimate(offer) {
    const climate = climateById(offer.climateId);
    if (!climate) throw new Error(`[Waystones] Unknown climate '${offer.climateId}'`);
    return climate;
}
