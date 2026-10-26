// @ts-check
/**
 * Crystal Cave — the veins the stones grow from.
 *
 * The hall's five mineral families keep their places (a crystal, the light baked round it and a
 * tetromino share a family's index), but the colour each family wears comes from the vein the
 * cave is showing, and the veins turn like a geode's minerals: the rainbow vein the cave opens
 * in, an amethyst heart of violets and rose, an ice hall of blues and pale lavender, an emerald
 * vein with blue topaz and heliodor gold, and a fire opal of rubies, tangerines and citrine.
 *
 * They turn on a clock of their own, slower than the hours above the cave (crystal-cave-hours.js),
 * so the stones and the light come round in ever new pairings (the two meet again only after
 * twenty-odd minutes); every level is one vein on, as it is one hour on. Each family's colour
 * melts the short way round the colour wheel (shared/mood-clock.js), and the order of the veins
 * keeps every family's walk short: violets go to blues, blues to greens, greens through gold to
 * fire.
 *
 * Plain numbers and no three.js: the world writes them into the families' colours each frame,
 * which every crystal, the light they throw on the rock and the air, and every spark reads.
 */
import { meltColour, moodDrift, wheelAt } from '../shared/mood-clock.js';
import { srgb } from './crystal-cave-hours.js';

/** Seconds from one vein to the next: slower than the hours (100 s), so their pairings drift. */
export const CRYSTAL_CAVE_VEIN_SECONDS = 130;
/** The share of its period a vein rests, pure, before its stones begin to turn. */
export const CRYSTAL_CAVE_VEIN_HOLD = 0.4;

/**
 * The veins, in the order the clock turns them: a name and the five families' colours, written
 * in sRGB (family order: the aqua, amethyst, sapphire, rose and amber of crystal-cave-light.js).
 * The first is the cave as it always was.
 */
export const CRYSTAL_CAVE_VEIN_HEX = Object.freeze([
    { name: 'rainbow vein', gems: [0x3fe3e4, 0xc463fb, 0x4a7dff, 0xff6fb5, 0xffb650] },
    { name: 'amethyst heart', gems: [0x808aff, 0xa646fa, 0x704dff, 0xff61df, 0xff8ca9] },
    { name: 'ice hall', gems: [0x7fe6ff, 0xb69eff, 0x478bff, 0xa3d9ff, 0x94e4ff] },
    { name: 'emerald vein', gems: [0x42eb96, 0x66ccff, 0x45e6e0, 0x60f07d, 0xffe561] },
    { name: 'fire opal', gems: [0xffc847, 0xff527d, 0xff7247, 0xffa04d, 0xffdf9e] },
].map((vein) => Object.freeze({ name: vein.name, gems: Object.freeze(vein.gems) })));

/** The veins in the cave's linear working space. */
export const CRYSTAL_CAVE_VEINS = Object.freeze(CRYSTAL_CAVE_VEIN_HEX.map((vein) => Object.freeze({
    name: vein.name,
    gems: Object.freeze(vein.gems.map((hex) => Object.freeze(srgb(hex)))),
})));

/** Somewhere to put a vein's five colours: a place a caller keeps and fills again. */
export function createCrystalCaveVein() {
    return CRYSTAL_CAVE_VEINS[0].gems.map(() => [0, 0, 0]);
}

/**
 * How far the clock alone has turned the veins at `time` (seconds): a whole number while one
 * rests, easing to the next as its stones turn. A function of the time and nothing else.
 * @param {number} time
 */
export function crystalCaveVeinDrift(time) {
    return moodDrift(time, CRYSTAL_CAVE_VEIN_SECONDS, CRYSTAL_CAVE_VEIN_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The families' colours `phase` veins round the cave (any real number: the veins come round),
 * written into `out` (five linear colours); on a whole phase that vein exactly.
 * @param {number} phase
 * @param {number[][]} [out]
 */
export function crystalCaveVeinAt(phase, out = createCrystalCaveVein()) {
    wheelAt(phase, CRYSTAL_CAVE_VEINS.length, AT);
    const from = CRYSTAL_CAVE_VEINS[AT.a].gems;
    const to = CRYSTAL_CAVE_VEINS[AT.b].gems;
    for (let family = 0; family < from.length; family++) meltColour(from[family], to[family], AT.melt, out[family]);
    return out;
}

/**
 * The vein a phase is nearest.
 * @param {number} phase
 */
export function crystalCaveVeinName(phase) {
    const n = CRYSTAL_CAVE_VEINS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return CRYSTAL_CAVE_VEINS[((Math.round(p) % n) + n) % n].name;
}
