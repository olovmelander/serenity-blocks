import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SUMMER_FEATURE_TREES, SUMMER_GROVE_CEILING, SUMMER_VIEWS, createSummerVisibilityTest, layoutSummerGrove,
    summerEye, summerViewFor,
} from '../../src/themes/summer/summer-composition.js';
import { SUMMER_FLOWERS } from '../../src/themes/summer/summer-flowers.js';
import { summerMeadowCover, summerPatchNoise } from '../../src/themes/summer/summer-meadow.js';
import { SUMMER_TIERS, summerTier } from '../../src/themes/summer/summer-quality.js';
import { SUMMER_PIECE_FLOWERS, SUMMER_REACTION_LIMITS } from '../../src/themes/summer/summer-reactions.js';
import {
    SUMMER_BOUNDS, SUMMER_CREST, SUMMER_MAP_BIAS, SUMMER_MAP_RANGE, SUMMER_MEADOW_BOUNDS, SUMMER_PLACES,
    SUMMER_TERRACES, summerGroundHeight, summerMaypoleDistance, summerPathDistance, summerShoreDistance,
    summerShores,
} from '../../src/themes/summer/summer-terrain.js';
import { SUMMER_TETROMINOS } from '../../src/themes/summer/summer-tetrominos.js';

/** Dearest first: what a tier draws may only shrink along this list. */
const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const LETTERS = Object.keys(SUMMER_PIECE_FLOWERS);
const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
/** The length of the jetty's deck, which runs along its own -Z from where it is placed. */
const JETTY_LENGTH = 7;
/**
 * The hue each shape usually has elsewhere, in degrees, as the repository's palette gate
 * screens for it (scripts/palette-guideline-check.mjs).
 */
const FAMILIAR_HUES = {
    I: [[160, 210]],
    O: [[32, 75]],
    T: [[245, 315]],
    S: [[90, 170]],
    Z: [[320, 360], [0, 20]],
    J: [[200, 250]],
    L: [[20, 50]],
};

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const { maypole, jetty, boat } = SUMMER_PLACES;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inland = (place) => summerShoreDistance(place.x, place.z);
const ground = (place) => summerGroundHeight(place.x, place.z);
const at = (point) => `${point.x.toFixed(1)}, ${point.z.toFixed(1)}`;
/** The name of the piece of land a place belongs to (or lies nearest to, out on the water). */
const landAt = (place) => Object.entries(summerShores(place.x, place.z)).reduce((a, b) => (b[1] > a[1] ? b : a))[0];

/** A point `metres` along the jetty from where it leaves the bank. */
function alongJetty(metres) {
    return { x: jetty.x - Math.sin(jetty.yaw) * metres, z: jetty.z - Math.cos(jetty.yaw) * metres };
}

/** The camera as SummerWorld.prepareCamera() frames it for an aspect ratio. */
function frameCamera(aspect) {
    const view = summerViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.25, 3600);
    camera.position.set(...summerEye(view));
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

/** Hue in degrees of a #rrggbb colour, or null for a grey. */
function hueOf(hex) {
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
    if (max === min) return null;
    const spread = max - min;
    let hue = (r - g) / spread + 4;
    if (max === r) hue = ((g - b) / spread) % 6;
    else if (max === g) hue = (b - r) / spread + 2;
    return (hue * 60 + 360) % 360;
}

/** Every sample of a grid over a box, as {x, z}. */
function grid(box, stepX, stepZ = stepX) {
    const points = [];
    for (let x = box.minX; x <= box.maxX; x += stepX) {
        for (let z = box.minZ; z <= box.maxZ; z += stepZ) points.push({ x, z });
    }
    return points;
}

describe('Summer quality tiers', () => {
    it('describes the same six tiers as the reaction director, with one set of columns', () => {
        expect(Object.keys(SUMMER_TIERS).sort()).toEqual([...TIERS].sort());
        expect(Object.keys(SUMMER_REACTION_LIMITS).sort()).toEqual([...TIERS].sort());
        expect(Object.isFrozen(SUMMER_TIERS)).toBe(true);
        const columns = Object.keys(SUMMER_TIERS.High).sort();
        expect(columns.length).toBeGreaterThan(10);
        for (const name of TIERS) {
            const tier = SUMMER_TIERS[name];
            expect(Object.isFrozen(tier), name).toBe(true);
            expect(Object.keys(tier).sort(), name).toEqual(columns);
            expect(summerTier(name)).toBe(tier);
            for (const [column, value] of Object.entries(tier)) {
                // The same kind of value in every tier: a count, a switch, or a pair of sizes.
                expect(typeof value, `${name}.${column}`).toBe(typeof SUMMER_TIERS.High[column]);
                const label = `${name}.${column}`;
                if (typeof value === 'number') expect(Number.isFinite(value) && value >= 0, label).toBe(true);
            }
            expect(tier.shadowMap).toHaveLength(2);
            expect(tier.shadowMap.every((size) => Number.isInteger(size) && size > 0), name).toBe(true);
        }
        for (const junk of ['high', 'ULTRA', '', undefined, null, 7, {}]) {
            expect(summerTier(junk)).toBe(SUMMER_TIERS.High);
        }
    });

    it('never asks a cheaper tier for more than a dearer one', () => {
        for (let index = 1; index < TIERS.length; index++) {
            const [dearer, cheaper] = [SUMMER_TIERS[TIERS[index - 1]], SUMMER_TIERS[TIERS[index]]];
            for (const [column, value] of Object.entries(cheaper)) {
                const label = `${TIERS[index]}.${column}`;
                if (typeof value === 'number') expect(value, label).toBeLessThanOrEqual(dearer[column]);
                // A switch that is off stays off further down.
                else if (typeof value === 'boolean') expect(value && !dearer[column], label).toBe(false);
                else value.forEach((size, axis) => expect(size, label).toBeLessThanOrEqual(dearer[column][axis]));
            }
            expect(SUMMER_REACTION_LIMITS[TIERS[index]]).toBeLessThanOrEqual(SUMMER_REACTION_LIMITS[TIERS[index - 1]]);
        }
        // The tiers are really different: the dearest draws several times what the cheapest does.
        const [most, least] = [SUMMER_TIERS.Extreme, SUMMER_TIERS.Minimal];
        for (const column of ['petals', 'grassNear', 'grassFar', 'flowersNear', 'flowersFar', 'groveTrees',
            'farTrees']) {
            expect(most[column], column).toBeGreaterThan(least[column] * 2);
        }
    });

    it('keeps every pool usable and every switch consistent at every tier', () => {
        for (const name of TIERS) {
            const tier = SUMMER_TIERS[name];
            // Whole numbers of things, and never none of what the game throws, rings or stirs.
            for (const column of ['groveTrees', 'farTrees', 'grassNear', 'grassFar', 'flowersNear', 'flowersFar',
                'reeds', 'rocks', 'lilies', 'petals', 'motes', 'butterflies', 'birds', 'mist', 'ripples', 'waves',
                'godrays', 'ribbons']) {
                expect(Number.isInteger(tier[column]), `${name}.${column}`).toBe(true);
            }
            for (const column of ['groveTrees', 'grassNear', 'grassFar', 'flowersNear', 'flowersFar', 'ripples',
                'waves']) {
                expect(tier[column], `${name}.${column}`).toBeGreaterThan(0);
            }
            expect(tier.petals, name).toBeGreaterThan(100);
            // A tier takes a prefix of the grove: it cannot ask for more than there is.
            expect(tier.groveTrees, name).toBeLessThanOrEqual(SUMMER_GROVE_CEILING);
            // Shares and resolution scales.
            for (const column of ['foliage', 'reflection']) {
                expect(tier[column], `${name}.${column}`).toBeGreaterThan(0);
                expect(tier[column], `${name}.${column}`).toBeLessThanOrEqual(1);
            }
            for (const column of ['godraysScale', 'bloomScale']) {
                expect(tier[column], `${name}.${column}`).toBeLessThanOrEqual(1);
            }
            // Shafts are marched at some resolution or not at all, and need the pipeline, as bloom does.
            expect(tier.godrays > 0, name).toBe(tier.godraysScale > 0);
            if (!tier.post) {
                expect(tier.godrays, name).toBe(0);
                expect(tier.bloomScale, name).toBe(0);
            }
        }
        expect(SUMMER_TIERS.High.post).toBe(true);
        expect(SUMMER_TIERS.High.limbs).toBe(true);
    });
});

describe('Summer tetromino palette', () => {
    const { colors } = SUMMER_TETROMINOS;

    it('paints each piece the colour of its own flower', () => {
        for (const letter of LETTERS) {
            const flower = SUMMER_FLOWERS.find((entry) => entry.piece === letter);
            expect(flower, letter).toBeDefined();
            // The piece on the board, the petals it throws and the flowers that answer are one colour.
            expect(flower.slot, letter).toBe(SUMMER_PIECE_FLOWERS[letter]);
            expect(colors[letter], letter).toMatch(/^#[0-9a-f]{6}$/i);
            expect(parseInt(colors[letter].slice(1), 16), `${letter} is ${flower.id}`).toBe(flower.petal);
        }
        expect(new Set(LETTERS.map((letter) => colors[letter].toLowerCase())).size).toBe(LETTERS.length);
        // Garbage is told apart from every piece.
        for (const key of ['GARBAGE', 'CLEAN_GARBAGE']) {
            expect(colors[key], key).toMatch(/^#[0-9a-f]{6}$/i);
            expect(LETTERS.map((letter) => colors[letter].toLowerCase())).not.toContain(colors[key].toLowerCase());
        }
        expect(colors.GARBAGE.toLowerCase()).not.toBe(colors.CLEAN_GARBAGE.toLowerCase());
    });

    it('keeps most pieces away from the hue their shape usually has elsewhere', () => {
        const familiar = LETTERS.filter((letter) => {
            const hue = hueOf(colors[letter]);
            return hue !== null && FAMILIAR_HUES[letter].some(([low, high]) => hue >= low && hue <= high);
        });
        expect(Object.keys(FAMILIAR_HUES).sort()).toEqual([...LETTERS].sort());
        expect(familiar.length, `in their familiar band: ${familiar.join(', ')}`).toBeLessThanOrEqual(3);
    });

    it('gives the board renderers a complete configuration', () => {
        expect(Number.isInteger(SUMMER_TETROMINOS.version)).toBe(true);
        expect(typeof SUMMER_TETROMINOS.renderMode).toBe('string');
        const { effects, rendererOverrides } = SUMMER_TETROMINOS;
        for (const [key, value] of Object.entries(effects)) {
            if (typeof value === 'number') expect(Number.isFinite(value) && value >= 0, key).toBe(true);
        }
        // An override only replaces what the shared effects already define.
        for (const [renderer, overrides] of Object.entries(rendererOverrides)) {
            for (const [key, value] of Object.entries(overrides)) {
                expect(effects, `${renderer}.${key}`).toHaveProperty(key);
                expect(typeof value, `${renderer}.${key}`).toBe(typeof effects[key]);
            }
        }
    });
});

describe('Summer land', () => {
    describe('shores and heights', () => {
        it('lays out the lake the header describes: meadow, headland, promontory, island, skerry and far shore', () => {
            const samples = grid(SUMMER_BOUNDS, 4.1, 3.3);
            const owned = {};
            let water = 0;
            for (const point of samples) {
                const shores = summerShores(point.x, point.z);
                const values = Object.values(shores);
                if (!values.every(Number.isFinite)) throw new Error(`a shore is not finite at ${at(point)}`);
                // The nearest shore is the piece of land furthest inland of the point.
                if (summerShoreDistance(point.x, point.z) !== Math.max(...values)) {
                    throw new Error(`the shore distance is not that of the nearest shore at ${at(point)}`);
                }
                const [piece, most] = Object.entries(shores).reduce((a, b) => (b[1] > a[1] ? b : a));
                if (most > 0) owned[piece] = (owned[piece] || 0) + 1;
                else water += 1;
            }
            // Every piece of land the shores name is really there, and so is the lake between them.
            expect(Object.keys(owned).sort()).toEqual(Object.keys(summerShores(0, 0)).sort());
            expect(water).toBeGreaterThan(samples.length / 6);
            expect(water).toBeLessThan(samples.length * 0.6);
            // The camera's meadow is the near bank; the cottage has a promontory of its own.
            const [eyeX, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
            expect(landAt({ x: eyeX, z: eyeZ })).toBe(landAt(maypole));
            expect(landAt(SUMMER_PLACES.cottage)).not.toBe(landAt(maypole));
            // Straight out from the camera: meadow, then a long reach of open water, then the far shore.
            const wet = [];
            for (let z = eyeZ; z >= SUMMER_BOUNDS.minZ; z -= 1) wet.push(summerGroundHeight(eyeX, z) < 0);
            const first = wet.indexOf(true);
            const last = wet.lastIndexOf(true);
            expect(first).toBeGreaterThan(10);
            expect(last - first).toBeGreaterThan(100);
            expect(wet.slice(first, last + 1).filter(Boolean).length).toBeGreaterThan((last - first) * 0.9);
            expect(wet.at(-1)).toBe(false);
        });

        it('keeps one finite ground: lake bed below zero offshore, land above it, no cliff at the waterline', () => {
            let deepest = 0;
            let highest = 0;
            for (const point of grid(SUMMER_BOUNDS, 3.7, 3.1)) {
                const height = summerGroundHeight(point.x, point.z);
                const shore = summerShoreDistance(point.x, point.z);
                if (!Number.isFinite(height) || !Number.isFinite(shore)) throw new Error(`not finite at ${at(point)}`);
                // Water is exactly where the shores say it is.
                if ((height < 0) !== (shore < 0)) throw new Error(`shore and height disagree at ${at(point)}`);
                // The land meets the lake at its own level.
                if (Math.abs(shore) < 0.3 && Math.abs(height) > 0.4) throw new Error(`a cliff at ${at(point)}`);
                deepest = Math.min(deepest, height);
                highest = Math.max(highest, height);
            }
            // A real lake with hills behind it, and all of the bed inside what the lake's map can store.
            expect(deepest).toBeLessThan(-1);
            expect(deepest).toBeGreaterThan(-SUMMER_MAP_BIAS);
            expect(highest).toBeGreaterThan(10);
            expect(SUMMER_MAP_RANGE).toBeGreaterThan(SUMMER_MAP_BIAS);
            // The bed shelves away from the bank: every stride out from the waterline is deeper,
            // until some other shore is the nearer one.
            const [eyeX] = summerEye(SUMMER_VIEWS.landscape);
            let waterline = maypole.z;
            while (summerGroundHeight(eyeX, waterline) >= 0) waterline -= 0.1;
            let previous = 0;
            for (let out = 0.5; out <= 8; out += 0.5) {
                const height = summerGroundHeight(eyeX, waterline - out);
                expect(height, `${out} m out`).toBeLessThan(previous);
                previous = height;
            }
            expect(previous).toBeLessThan(-1);
            // And the land climbs away from it on the other side.
            expect(summerGroundHeight(eyeX, waterline + 8)).toBeGreaterThan(summerGroundHeight(eyeX, waterline + 1));
        });

        it('falls from the crest of flowers under the camera down to the near shore', () => {
            const [eyeX, eyeY, eyeZ] = summerEye(SUMMER_VIEWS.landscape);
            // The crest lies between the camera and the water, and the eye looks over it.
            expect(SUMMER_CREST.z).toBeLessThan(eyeZ);
            expect(SUMMER_CREST.height).toBeGreaterThan(0);
            expect(SUMMER_CREST.width).toBeGreaterThan(0);
            const crest = summerGroundHeight(eyeX, SUMMER_CREST.z);
            expect(crest).toBeGreaterThan(summerGroundHeight(eyeX, eyeZ));
            expect(eyeY).toBeGreaterThan(crest + 0.5);
            // Beyond it the meadow runs down to the lake: every stretch lower than the one before.
            // Measured beside the maypole's dance mound, the one rise people built on this slope.
            const mound = SUMMER_TERRACES.find((terrace) => Math.hypot(
                terrace.x - SUMMER_PLACES.maypole.x,
                terrace.z - SUMMER_PLACES.maypole.z,
            ) < 0.01);
            const lineX = mound.x + Math.sign(eyeX - mound.x || 1) * (mound.radius + mound.blend + 0.5);
            let shoreZ = SUMMER_CREST.z;
            while (summerGroundHeight(lineX, shoreZ) > 0) shoreZ -= 0.25;
            expect(SUMMER_CREST.z - shoreZ).toBeGreaterThan(10);
            const stretch = (from, to) => {
                let total = 0;
                for (let step = 0; step <= 8; step++) {
                    total += summerGroundHeight(lineX, from + ((to - from) * step) / 8);
                }
                return total / 9;
            };
            const span = (SUMMER_CREST.z - 2 * SUMMER_CREST.width - shoreZ) / 4;
            let previous = summerGroundHeight(lineX, SUMMER_CREST.z);
            for (let part = 0; part < 4; part++) {
                const from = SUMMER_CREST.z - 2 * SUMMER_CREST.width - span * part;
                const mean = stretch(from, from - span);
                expect(mean).toBeGreaterThan(0);
                expect(mean).toBeLessThan(previous);
                previous = mean;
            }
            // Nothing between the crest and the shore stands in the way of the view of the water.
            for (let z = SUMMER_CREST.z - 2 * SUMMER_CREST.width; z > shoreZ; z -= 0.5) {
                const sight = eyeY + ((0 - eyeY) * (eyeZ - z)) / (eyeZ - shoreZ);
                expect(summerGroundHeight(eyeX, z), `z ${z}`).toBeLessThan(sight);
            }
        });

        it('keeps the meadow\'s own map inside the land, around everything it describes', () => {
            const within = (place, box, margin = 0) => place.x > box.minX + margin && place.x < box.maxX - margin
                && place.z > box.minZ + margin && place.z < box.maxZ - margin;
            expect(within({ x: SUMMER_MEADOW_BOUNDS.minX, z: SUMMER_MEADOW_BOUNDS.minZ }, SUMMER_BOUNDS)).toBe(true);
            expect(within({ x: SUMMER_MEADOW_BOUNDS.maxX, z: SUMMER_MEADOW_BOUNDS.maxZ }, SUMMER_BOUNDS)).toBe(true);
            // The mown ring, the crest, the path down to the jetty and both cameras.
            expect(within(maypole, SUMMER_MEADOW_BOUNDS, maypole.ring + 1)).toBe(true);
            expect(within(jetty, SUMMER_MEADOW_BOUNDS, 1)).toBe(true);
            for (const view of Object.values(SUMMER_VIEWS)) {
                const [x, , z] = summerEye(view);
                expect(within({ x, z }, SUMMER_MEADOW_BOUNDS, 1)).toBe(true);
                expect(within({ x, z: SUMMER_CREST.z }, SUMMER_MEADOW_BOUNDS, SUMMER_CREST.width * 2)).toBe(true);
            }
            for (const key of ['minX', 'minZ']) {
                expect(SUMMER_BOUNDS[key]).toBeLessThan(SUMMER_BOUNDS[key.replace('min', 'max')]);
                expect(SUMMER_MEADOW_BOUNDS[key]).toBeLessThan(SUMMER_MEADOW_BOUNDS[key.replace('min', 'max')]);
            }
            expect(Object.isFrozen(SUMMER_BOUNDS) && Object.isFrozen(SUMMER_MEADOW_BOUNDS)).toBe(true);
        });
    });

    describe('the things people made', () => {
        it('stands the maypole, the cottage, the shed and the flagpole on dry land', () => {
            expect(Object.isFrozen(SUMMER_PLACES)).toBe(true);
            for (const name of ['maypole', 'cottage', 'shed', 'flagpole']) {
                const place = SUMMER_PLACES[name];
                expect(Object.isFrozen(place), name).toBe(true);
                expect(inland(place), name).toBeGreaterThan(0.5);
                expect(ground(place), name).toBeGreaterThan(0.1);
            }
            // The cottage and the maypole stand well back from the water.
            expect(inland(SUMMER_PLACES.cottage)).toBeGreaterThan(3);
            expect(inland(maypole)).toBeGreaterThan(3);
            for (const place of Object.values(SUMMER_PLACES)) {
                expect(Object.values(place).every(Number.isFinite)).toBe(true);
            }
            // No two of them on the same spot.
            const places = Object.values(SUMMER_PLACES);
            places.forEach((place, index) => {
                for (const other of places.slice(index + 1)) expect(distance(place, other)).toBeGreaterThan(2);
            });
        });

        it('mows a ring around the maypole that lies wholly in the meadow, in front of the camera', () => {
            expect(maypole.ring).toBeGreaterThan(1);
            for (let step = 0; step < 48; step++) {
                const angle = (step / 48) * Math.PI * 2;
                const rim = {
                    x: maypole.x + Math.cos(angle) * maypole.ring, z: maypole.z + Math.sin(angle) * maypole.ring,
                };
                expect(inland(rim)).toBeGreaterThan(1);
                expect(ground(rim)).toBeGreaterThan(0.2);
                expect(summerMaypoleDistance(rim.x, rim.z)).toBeCloseTo(maypole.ring, 9);
                // A dance floor, not a hillside.
                expect(Math.abs(ground(rim) - ground(maypole))).toBeLessThan(1);
            }
            expect(summerMaypoleDistance(maypole.x, maypole.z)).toBe(0);
            // Between the crest and the water, so the lake is its backdrop.
            const [, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
            expect(maypole.z + maypole.ring).toBeLessThan(SUMMER_CREST.z);
            expect(maypole.z).toBeLessThan(eyeZ);
            // The path to the jetty passes it by.
            expect(summerPathDistance(maypole.x, maypole.z)).toBeGreaterThan(maypole.ring);
        });

        it('builds the cottage and the shed on level terraces that leave the waterline where it was', () => {
            expect(Object.isFrozen(SUMMER_TERRACES)).toBe(true);
            for (const name of ['cottage', 'shed']) {
                const building = SUMMER_PLACES[name];
                const terrace = SUMMER_TERRACES.find((entry) => distance(entry, building) < entry.radius * 0.5);
                expect(terrace, name).toBeDefined();
                // Above the lake, and the building stands at exactly that height.
                expect(terrace.height).toBeGreaterThan(0.2);
                expect(ground(building), name).toBeCloseTo(terrace.height, 9);
                // Level under the whole building, not only under its middle: across half the
                // terrace, wherever the bank down to the water has not begun.
                let level = 0;
                for (let step = 0; step < 48; step++) {
                    const angle = (step / 48) * Math.PI * 2;
                    for (const share of [0.15, 0.3, 0.5]) {
                        const spot = {
                            x: terrace.x + Math.cos(angle) * terrace.radius * share,
                            z: terrace.z + Math.sin(angle) * terrace.radius * share,
                        };
                        expect(inland(spot), `${name} at ${share}`).toBeGreaterThan(0);
                        if (inland(spot) >= terrace.bank) {
                            expect(ground(spot), `${name} at ${share}`).toBeCloseTo(terrace.height, 9);
                            level += 1;
                        } else {
                            // The bank: between the lake and the terrace, never above it.
                            expect(ground(spot)).toBeGreaterThanOrEqual(0);
                            expect(ground(spot)).toBeLessThanOrEqual(terrace.height + 1e-9);
                        }
                    }
                }
                expect(level, name).toBeGreaterThan(100);
            }
            for (const terrace of SUMMER_TERRACES) {
                expect(Object.isFrozen(terrace)).toBe(true);
                for (const key of ['radius', 'blend', 'height', 'bank']) expect(terrace[key], key).toBeGreaterThan(0);
                // Around it the ground still meets the lake at lake level, and water is where it was.
                const reach = terrace.radius + terrace.blend + 3;
                const box = {
                    minX: terrace.x - reach, maxX: terrace.x + reach, minZ: terrace.z - reach, maxZ: terrace.z + reach,
                };
                let steepest = 0;
                for (const point of grid(box, 0.31, 0.29)) {
                    const height = ground(point);
                    const shore = inland(point);
                    if ((height < 0) !== (shore < 0)) throw new Error(`the terrace moved the shore at ${at(point)}`);
                    if (Math.abs(shore) < 0.3) steepest = Math.max(steepest, Math.abs(height));
                    // Beyond its blend the land is what it would be without it.
                    expect(Number.isFinite(height)).toBe(true);
                }
                expect(steepest).toBeLessThan(0.5);
            }
        });

        it('runs the jetty from the bank out over the lake and moors the boat beside it', () => {
            // It leaves from the water's edge ...
            expect(Math.abs(inland(jetty))).toBeLessThan(1.5);
            expect(summerPathDistance(jetty.x, jetty.z)).toBeLessThan(1.5);
            // ... and from its second metre to its end it is over water, deeper all the way.
            let depth = 0;
            for (let metres = 2; metres <= JETTY_LENGTH; metres++) {
                const plank = alongJetty(metres);
                expect(inland(plank), `${metres} m out`).toBeLessThan(0);
                expect(ground(plank), `${metres} m out`).toBeLessThan(depth);
                depth = ground(plank);
            }
            expect(inland(alongJetty(JETTY_LENGTH))).toBeLessThan(-3);
            // It points away from the camera's bank, out into the lake.
            expect(alongJetty(JETTY_LENGTH).z).toBeLessThan(jetty.z - JETTY_LENGTH / 2);
            // The boat floats, clear of the bank, alongside the deck and not under it.
            expect(inland(boat)).toBeLessThan(-2);
            expect(ground(boat)).toBeLessThan(-0.5);
            const [dx, dz] = [boat.x - jetty.x, boat.z - jetty.z];
            const along = dx * -Math.sin(jetty.yaw) + dz * -Math.cos(jetty.yaw);
            const beside = Math.abs(dx * Math.cos(jetty.yaw) - dz * Math.sin(jetty.yaw));
            expect(along).toBeGreaterThan(1);
            expect(along).toBeLessThan(JETTY_LENGTH + 3);
            expect(beside).toBeGreaterThan(1);
            expect(beside).toBeLessThan(6);
        });

        it('treads a path from the crest down to the jetty, on land all the way', () => {
            const [eyeX, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
            const trodden = grid(SUMMER_MEADOW_BOUNDS, 0.4)
                .filter((point) => summerPathDistance(point.x, point.z) < 0.2);
            expect(trodden.length).toBeGreaterThan(40);
            for (const point of trodden) expect(inland(point)).toBeGreaterThan(-1);
            // It starts up by the camera's crest and ends where the jetty leaves the bank.
            const zs = trodden.map((point) => point.z);
            expect(Math.max(...zs)).toBeGreaterThan(SUMMER_CREST.z - 1);
            expect(Math.max(...zs)).toBeLessThan(eyeZ + 2);
            expect(Math.min(...zs)).toBeLessThan(jetty.z + 2);
            const start = trodden.reduce((a, b) => (b.z > a.z ? b : a));
            expect(Math.abs(start.x - eyeX)).toBeLessThan(8);
            // One path, a stride or two wide: it has a middle and it has grass to either side.
            expect(summerPathDistance(start.x + 6, start.z)).toBeGreaterThan(3);
            expect(summerPathDistance(start.x - 6, start.z)).toBeGreaterThan(3);
            for (const point of grid(SUMMER_MEADOW_BOUNDS, 3.3)) {
                expect(Number.isFinite(summerPathDistance(point.x, point.z))).toBe(true);
            }
        });
    });
});

describe('Summer composition', () => {
    it('frames wide screens in landscape and tall screens in portrait', () => {
        expect(Object.isFrozen(SUMMER_VIEWS)).toBe(true);
        for (const aspect of [LANDSCAPE, 21 / 9, 4 / 3, 1, 0.9]) {
            expect(summerViewFor(aspect), String(aspect)).toBe(SUMMER_VIEWS.landscape);
        }
        for (const aspect of [PORTRAIT, 9 / 16, 0.5, 0.8]) {
            expect(summerViewFor(aspect), String(aspect)).toBe(SUMMER_VIEWS.portrait);
        }
        for (const view of Object.values(SUMMER_VIEWS)) {
            expect(Object.isFrozen(view)).toBe(true);
            expect(view.fov).toBeGreaterThan(20);
            expect(view.fov).toBeLessThan(100);
            expect([...view.position, ...view.target].every(Number.isFinite)).toBe(true);
        }
        // A tall screen sees less to either side, so it is given a wider lens.
        expect(SUMMER_VIEWS.portrait.fov).toBeGreaterThan(SUMMER_VIEWS.landscape.fov);
    });

    it.each(Object.keys(SUMMER_VIEWS))('stands the %s camera in the meadow, above the ground, facing the lake', (
        name,
    ) => {
        const view = SUMMER_VIEWS[name];
        const [x, y, z] = summerEye(view);
        // On dry land well back from the water, at the height of someone standing in the grass.
        expect(summerShoreDistance(x, z)).toBeGreaterThan(5);
        const floor = summerGroundHeight(x, z);
        expect(floor).toBeGreaterThan(0);
        expect(y).toBe(floor + view.position[1]);
        expect(y - floor).toBeGreaterThan(1);
        expect(y - floor).toBeLessThan(6);
        expect([x, z]).toEqual([view.position[0], view.position[2]]);
        // Nothing but air for the first metres in front of the lens, down to the ground at its feet.
        for (const [dx, dz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, -2], [0, 2]]) {
            expect(summerGroundHeight(x + dx, z + dz)).toBeLessThan(y - 0.5);
        }
        // It looks out across the water, nearly level.
        const [tx, ty, tz] = view.target;
        const reach = Math.hypot(tx - x, tz - z);
        expect(reach).toBeGreaterThan(30);
        expect(tz).toBeLessThan(z);
        expect(Math.abs(Math.atan2(ty - y, reach))).toBeLessThan(THREE.MathUtils.degToRad(15));
        expect(summerGroundHeight(x + (tx - x) * 0.7, z + (tz - z) * 0.7)).toBeLessThan(0);
        // And it stands behind the crest of flowers, looking over it.
        expect(z).toBeGreaterThan(SUMMER_CREST.z);
        expect(y).toBeGreaterThan(summerGroundHeight(x, SUMMER_CREST.z) + 0.5);
    });

    it.each([
        ['a phone held upright', PORTRAIT], ['a 9:16 phone', 9 / 16], ['a tall tablet', 0.75], ['a square', 1],
        ['4:3', 4 / 3], ['16:9', LANDSCAPE], ['an ultrawide', 21 / 9],
    ])('keeps the maypole and the lake in frame on %s', (_label, aspect) => {
        const camera = frameCamera(aspect);
        const seen = (x, y, z) => new THREE.Vector3(x, y, z).project(camera);
        // The maypole is where the bouquet is tallied and thrown: its foot and its wreaths must show.
        const foot = summerGroundHeight(maypole.x, maypole.z);
        for (const height of [0, 2.5, 5]) {
            const point = seen(maypole.x, foot + height, maypole.z);
            expect(Math.abs(point.x), `maypole at ${height} m`).toBeLessThan(0.95);
            expect(Math.abs(point.y), `maypole at ${height} m`).toBeLessThan(0.95);
            expect(point.z).toBeLessThan(1);
        }
        // Open water straight ahead, below the horizon and above the foot of the screen.
        const direction = camera.getWorldDirection(new THREE.Vector3());
        const flat = Math.hypot(direction.x, direction.z);
        const out = 45;
        const lake = {
            x: camera.position.x + (direction.x / flat) * out, z: camera.position.z + (direction.z / flat) * out,
        };
        expect(summerGroundHeight(lake.x, lake.z)).toBeLessThan(0);
        const water = seen(lake.x, 0, lake.z);
        expect(Math.abs(water.x)).toBeLessThan(0.05);
        expect(water.y).toBeLessThan(0.2);
        expect(water.y).toBeGreaterThan(-0.9);
    });

    it('stands every hand-placed tree on dry land, clear of the buildings, the dance and the lens', () => {
        expect(Object.isFrozen(SUMMER_FEATURE_TREES)).toBe(true);
        expect(SUMMER_FEATURE_TREES.length).toBeGreaterThan(3);
        SUMMER_FEATURE_TREES.forEach((tree, index) => {
            const label = `${tree.asset} at ${tree.x}, ${tree.z}`;
            expect(tree.asset, label).toMatch(/^(birch|spruce)-[a-z-]+$/);
            expect(inland(tree), label).toBeGreaterThan(1);
            expect(ground(tree), label).toBeGreaterThan(0.1);
            expect(Number.isFinite(tree.yaw), label).toBe(true);
            expect(tree.scale, label).toBeGreaterThan(0.2);
            expect(tree.scale, label).toBeLessThan(3);
            expect(tree.tone, label).toBeGreaterThanOrEqual(0);
            expect(tree.tone, label).toBeLessThanOrEqual(1);
            // Not on a terrace someone built on, not on the mown ring, not on the path, not at the lens.
            for (const terrace of SUMMER_TERRACES) {
                expect(distance(tree, terrace), label).toBeGreaterThan(terrace.radius);
            }
            expect(summerMaypoleDistance(tree.x, tree.z), label).toBeGreaterThan(maypole.ring + 1);
            expect(summerPathDistance(tree.x, tree.z), label).toBeGreaterThan(1.5);
            expect(distance(tree, jetty), label).toBeGreaterThan(3);
            for (const view of Object.values(SUMMER_VIEWS)) {
                const [x, , z] = summerEye(view);
                expect(distance(tree, { x, z }), label).toBeGreaterThan(5);
            }
            for (const other of SUMMER_FEATURE_TREES.slice(index + 1)) {
                expect(distance(tree, other), label).toBeGreaterThan(3);
            }
        });
        // A birch and a spruce frame the picture, one to either side of the board.
        const heroes = SUMMER_FEATURE_TREES.filter((tree) => tree.asset.endsWith('-hero'));
        expect(heroes.map((tree) => tree.asset.split('-')[0]).sort()).toEqual(['birch', 'spruce']);
        expect(Math.sign(heroes[0].x)).not.toBe(Math.sign(heroes[1].x));
        for (const hero of heroes) expect(inland(hero)).toBeGreaterThan(5);
    });

    describe('the procedural grove', () => {
        const SEEDS = [1, 7, 271, 624, 9001, 123456];

        it('lays out the same wood for the same seed, in priority order so that a tier takes a prefix', () => {
            for (const seed of SEEDS) {
                const whole = layoutSummerGrove(seededRandom(seed));
                expect(whole).toHaveLength(SUMMER_GROVE_CEILING);
                expect(layoutSummerGrove(seededRandom(seed))).toEqual(whole);
                expect(layoutSummerGrove(seededRandom(seed), SUMMER_GROVE_CEILING)).toEqual(whole);
                // Asking for fewer gives the first of the same list, tree for tree.
                for (const count of [0, 1, 10, 24, SUMMER_GROVE_CEILING - 1]) {
                    const fewer = layoutSummerGrove(seededRandom(seed), count);
                    expect(fewer, `${count} of seed ${seed}`).toEqual(whole.slice(0, count));
                }
                // Asking for more than there is gives all there is.
                expect(layoutSummerGrove(seededRandom(seed), 1000)).toEqual(whole);
                // Every tier's share of it has woods both near the camera and across the water.
                for (const name of TIERS) {
                    const kept = whole.slice(0, SUMMER_TIERS[name].groveTrees);
                    expect(kept).toHaveLength(SUMMER_TIERS[name].groveTrees);
                    expect(kept.some((tree) => tree.far), `${name}, seed ${seed}`).toBe(true);
                    expect(kept.some((tree) => !tree.far), `${name}, seed ${seed}`).toBe(true);
                }
            }
            const [first, second] = [layoutSummerGrove(seededRandom(1)), layoutSummerGrove(seededRandom(2))];
            expect(second).not.toEqual(first);
            // The hand-placed trees are not part of it and are not disturbed by it.
            const placed = JSON.stringify(SUMMER_FEATURE_TREES);
            layoutSummerGrove(seededRandom(3));
            expect(JSON.stringify(SUMMER_FEATURE_TREES)).toBe(placed);
            const spots = new Set(SUMMER_FEATURE_TREES.map(at));
            expect(first.filter((tree) => spots.has(at(tree)))).toEqual([]);
        });

        it('never puts a tree in the lake, on a terrace, on the mown ring or on top of another', () => {
            const problems = [];
            for (let seed = 1; seed <= 60; seed++) {
                const grove = layoutSummerGrove(seededRandom(seed));
                grove.forEach((tree, index) => {
                    const label = `seed ${seed}: ${tree.asset} at ${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}`;
                    const check = (condition, what) => { if (!condition) problems.push(`${label} ${what}`); };
                    check(inland(tree) > 1, 'stands in or at the water');
                    check(ground(tree) > 0.1, 'has its foot in the lake');
                    // The cottage keeps its yard and the dancers their ring, with room to spare.
                    for (const terrace of SUMMER_TERRACES) {
                        check(distance(tree, terrace) > terrace.radius + 1, 'is in the yard');
                    }
                    check(summerMaypoleDistance(tree.x, tree.z) > maypole.ring + 2, 'is on the mown ring');
                    check(summerPathDistance(tree.x, tree.z) > 2, 'is on the path');
                    check(distance(tree, jetty) > 4 && distance(tree, boat) > 4, 'is on the jetty');
                    for (const view of Object.values(SUMMER_VIEWS)) {
                        const [x, , z] = summerEye(view);
                        check(distance(tree, { x, z }) > 8, 'stands in front of the lens');
                    }
                    for (const other of SUMMER_FEATURE_TREES) {
                        check(distance(tree, other) > 3, 'crowds a hand-placed tree');
                    }
                    for (const other of grove.slice(index + 1)) check(distance(tree, other) > 3, 'crowds another');
                    check(/^(birch|spruce)-grove-[a-z]$/.test(tree.asset), 'is not a grove tree');
                    check(tree.yaw >= 0 && tree.yaw < Math.PI * 2 + 1e-9, `is turned ${tree.yaw}`);
                    check(tree.scale > 0.5 && tree.scale < 2, `is scaled ${tree.scale}`);
                    check(tree.tone >= 0 && tree.tone <= 1, `has tone ${tree.tone}`);
                    check(typeof tree.far === 'boolean', 'does not say whether it is far');
                    const fields = Object.keys(tree).sort().join();
                    check(fields === 'asset,far,scale,tone,x,yaw,z', `has ${fields}`);
                });
                // Birch and spruce both grow in every wood.
                if (!grove.some((tree) => tree.asset.startsWith('birch'))) problems.push(`seed ${seed} has no birch`);
                if (!grove.some((tree) => tree.asset.startsWith('spruce'))) problems.push(`seed ${seed} has no spruce`);
            }
            expect(problems).toEqual([]);
        });

        it('marks as far the trees across the water and as near the ones on the camera\'s own bank', () => {
            const [eyeX, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
            const eye = { x: eyeX, z: eyeZ };
            const meadow = landAt(eye);
            for (const seed of SEEDS) {
                const grove = layoutSummerGrove(seededRandom(seed));
                const near = grove.filter((tree) => !tree.far);
                const far = grove.filter((tree) => tree.far);
                expect(near.length).toBeGreaterThan(5);
                expect(far.length).toBeGreaterThan(5);
                // Nothing on the camera's own bank is called far, and everything far is well away.
                for (const tree of far) {
                    expect(landAt(tree)).not.toBe(meadow);
                    expect(distance(tree, eye)).toBeGreaterThan(60);
                }
                const mean = (trees) => trees.reduce((total, tree) => total + distance(tree, eye), 0) / trees.length;
                expect(mean(far)).toBeGreaterThan(mean(near) * 2);
            }
        });

        it('ends, with whatever it could place, when the dice are broken', () => {
            for (const rng of [() => 0, () => 0.5, () => 0.999999, () => NaN, () => undefined, () => 7, () => -3]) {
                const grove = layoutSummerGrove(rng);
                expect(grove.length).toBeLessThanOrEqual(SUMMER_GROVE_CEILING);
                for (const tree of grove.filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))) {
                    expect(inland(tree)).toBeGreaterThan(0);
                }
            }
        });
    });

    it('recognises what could be on screen, directly or mirrored in the lake, and what never is', () => {
        const visible = createSummerVisibilityTest();
        // Everything placed by hand is there to be seen.
        for (const tree of SUMMER_FEATURE_TREES) {
            expect(visible(tree.x, ground(tree) + 6, tree.z, 6), `${tree.asset} at ${tree.x}, ${tree.z}`).toBe(true);
        }
        for (const [name, place] of Object.entries(SUMMER_PLACES)) {
            expect(visible(place.x, Math.max(0, ground(place)) + 1, place.z, 2), name).toBe(true);
        }
        for (const view of Object.values(SUMMER_VIEWS)) {
            const [x, y, z] = summerEye(view);
            const [tx, ty, tz] = view.target;
            // What the camera looks at, and the ground at its own feet.
            expect(visible(tx, ty, tz, 1)).toBe(true);
            expect(visible(x + (tx - x) * 0.1, y - 1, z + (tz - z) * 0.1, 1)).toBe(true);
            // Behind the camera there is nothing to draw, however large.
            expect(visible(x - (tx - x), y, z - (tz - z), 10)).toBe(false);
            expect(visible(x, y, z + 200, 30)).toBe(false);
        }
        // Far off to the side of both framings.
        expect(visible(-900, 5, 0, 10)).toBe(false);
        expect(visible(900, 5, 0, 10)).toBe(false);
        // Something high over the far shore is out of frame, but the lake still mirrors it.
        const [, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
        const mirrored = [0, 80, eyeZ - 110];
        expect(visible(...mirrored, 1)).toBe(true);
        expect(visible(mirrored[0], 2000, mirrored[2], 1)).toBe(false);
        // A larger thing is seen from further outside the frame.
        const edge = [0, 5, eyeZ - 60];
        let lost = 0;
        while (visible(edge[0] + lost, edge[1], edge[2], 1) && lost < 2000) lost += 2;
        expect(lost).toBeGreaterThan(10);
        expect(lost).toBeLessThan(2000);
        expect(visible(edge[0] + lost, edge[1], edge[2], 40)).toBe(true);
        // Each call makes its own test: two of them agree.
        expect(createSummerVisibilityTest()(...mirrored, 1)).toBe(true);
    });
});

describe('Summer meadow helpers', () => {
    describe('patch noise', () => {
        it('gives every spot a value between nought and one, the same every time', () => {
            const random = seededRandom(3);
            let [low, high] = [Infinity, -Infinity];
            for (let sample = 0; sample < 4000; sample++) {
                const [x, z, seed] = [(random() - 0.5) * 400, (random() - 0.5) * 400, Math.floor(random() * 200)];
                const value = summerPatchNoise(x, z, seed);
                if (!(value >= 0 && value <= 1)) throw new Error(`noise(${x}, ${z}, ${seed}) = ${value}`);
                expect(summerPatchNoise(x, z, seed)).toBe(value);
                low = Math.min(low, value);
                high = Math.max(high, value);
            }
            // It uses its range: drifts of flowers need both thick and thin.
            expect(low).toBeLessThan(0.1);
            expect(high).toBeGreaterThan(0.9);
        });

        it('is smooth: no seams between cells and no jumps within them', () => {
            const random = seededRandom(5);
            for (let sample = 0; sample < 1500; sample++) {
                const [x, z] = [(random() - 0.5) * 60, (random() - 0.5) * 60];
                const here = summerPatchNoise(x, z, 9);
                // A millimetre away the value has barely changed, in any direction.
                expect(Math.abs(summerPatchNoise(x + 0.001, z, 9) - here)).toBeLessThan(0.01);
                expect(Math.abs(summerPatchNoise(x, z + 0.001, 9) - here)).toBeLessThan(0.01);
            }
            // Across the lines of its lattice, on both sides of zero.
            for (const line of [-3, -1, 0, 1, 2, 17]) {
                for (const along of [-2.3, 0.4, 5.75]) {
                    const [before, after] = [line - 1e-9, line + 1e-9];
                    expect(summerPatchNoise(before, along, 4)).toBeCloseTo(summerPatchNoise(after, along, 4), 6);
                    expect(summerPatchNoise(along, before, 4)).toBeCloseTo(summerPatchNoise(along, after, 4), 6);
                }
            }
            // It varies over a stride or two, not from blade to blade and not only from field to field.
            const walk = Array.from({ length: 200 }, (_, step) => summerPatchNoise(step * 0.25, 3.3, 9));
            expect(Math.max(...walk) - Math.min(...walk)).toBeGreaterThan(0.5);
            const steps = walk.slice(1).map((value, index) => Math.abs(value - walk[index]));
            expect(Math.max(...steps)).toBeLessThan(0.5);
        });

        it('grows each kind of flower in drifts of its own', () => {
            const field = (seed) => Array.from({ length: 400 }, (_, index) => {
                const [column, row] = [index % 20, Math.floor(index / 20)];
                return summerPatchNoise(column * 0.7, row * 0.7, seed);
            });
            const [first, second] = [field(5), field(18)];
            expect(second).not.toEqual(first);
            // Unrelated, not shifted copies: where one is thick the other is as often thin.
            const together = first.filter((value, index) => (value > 0.5) === (second[index] > 0.5)).length;
            expect(together).toBeGreaterThan(400 * 0.25);
            expect(together).toBeLessThan(400 * 0.75);
        });
    });

    describe('meadow cover', () => {
        it('grows nothing on the water or at its edge, and everything in the deep grass', () => {
            let bare = 0;
            let full = 0;
            const samples = grid(SUMMER_MEADOW_BOUNDS, 1.3, 1.1);
            for (const point of samples) {
                const cover = summerMeadowCover(point.x, point.z);
                if (!(cover >= 0 && cover <= 1)) throw new Error(`cover ${cover} at ${point.x}, ${point.z}`);
                // No grass in the lake, whatever else is there.
                if (ground(point) < 0 && cover !== 0) throw new Error(`grass in the lake at ${at(point)}`);
                if (cover === 0) bare += 1;
                if (cover === 1) full += 1;
            }
            // Most of the map is one or the other: lake, or meadow in full growth.
            expect(bare).toBeGreaterThan(samples.length * 0.1);
            expect(full).toBeGreaterThan(samples.length * 0.3);
            // Under the camera, around the maypole and on the crest it is all meadow.
            const [eyeX, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
            expect(summerMeadowCover(eyeX - 3, eyeZ)).toBe(1);
            expect(summerMeadowCover(maypole.x, maypole.z)).toBe(1);
            expect(summerMeadowCover(eyeX - 3, SUMMER_CREST.z)).toBe(1);
            expect(summerMeadowCover(boat.x, boat.z)).toBe(0);
            // The meadow is the camera's bank: the far shores are left to the woods.
            expect(summerMeadowCover(SUMMER_PLACES.cottage.x, SUMMER_PLACES.cottage.z)).toBe(0);
        });

        it('thickens from the waterline inland and never thins again', () => {
            for (const x of [-30, -14, -2, 20, 35]) {
                let previous = 0;
                let started = null;
                for (let z = -14; z <= 10; z += 0.25) {
                    if (summerPathDistance(x, z) > 2) {
                        const cover = summerMeadowCover(x, z);
                        expect(cover, `x ${x}, z ${z}`).toBeGreaterThanOrEqual(previous);
                        if (cover > 0 && started === null) started = z;
                        previous = cover;
                    }
                }
                expect(previous).toBe(1);
                // The first growth is on dry land, a step back from the water.
                expect(summerShoreDistance(x, started)).toBeGreaterThan(0.3);
                expect(summerShoreDistance(x, started)).toBeLessThan(4);
            }
        });

        it('wears the path nearly bare and leaves the grass beside it', () => {
            const trodden = grid(SUMMER_MEADOW_BOUNDS, 0.4).filter((point) => summerPathDistance(point.x, point.z) < 0.1
                && summerShores(point.x, point.z).near > 4);
            expect(trodden.length).toBeGreaterThan(10);
            for (const point of trodden) {
                const cover = summerMeadowCover(point.x, point.z);
                expect(cover).toBeLessThan(0.3);
                // Three strides to the side the meadow is whole.
                const beside = [point.x - 3, point.x + 3].map((x) => summerMeadowCover(x, point.z));
                expect(Math.max(...beside)).toBe(1);
            }
        });
    });
});
