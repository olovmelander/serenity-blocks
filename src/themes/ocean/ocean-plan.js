/**
 * Ocean — the plan: where everything on the reef grows (CPU only, three-free).
 *
 * Seeded, so the reef is the same reef on every machine and at every tier (a lower tier keeps
 * the first share of each list: the hero colonies by the viewer come first). Everything is laid
 * out in stage space and only where the picture can see it; broad things are seated on the
 * lowest ground under their footprint, so nothing hangs in the water on a slope.
 */
import {
    DEG, EYE, MOUNDS, SURFACE, TAU, channelAxis, footprintFloor, linRGB, mulberry32, rockAt, seabedHeight,
    seabedNormal, shoulderRise,
} from './ocean-core.js';

/** Is a stage point in the picture? (The widest frame the theme meets, the pointer's lean, a margin.) */
export function inView(x, y, z, margin = 1) {
    const ahead = EYE.z - z;
    if (ahead < 1.2) return false;
    if (Math.abs(x) > Math.tan(51 * DEG) * ahead + margin) return false;
    return Math.atan2(y - EYE.y, ahead) > -24 * DEG;
}

const hexes = (list) => Object.freeze(list.map((h) => Object.freeze(linRGB(h))));

/** What each kind of colony may be coloured (scene-linear albedo). */
export const CORAL_COLOURS = Object.freeze({
    branching: hexes([0x8e9cf5, 0xe9c66b, 0x6fd3a6, 0xf08bb4, 0xead9b0, 0x9fd0f0, 0xf2a25c]),
    tables: hexes([0xb9a56a, 0x7fa0c8, 0xd98aa0, 0x8fbf6a, 0xc9b48a, 0x9a8ad0]),
    brains: hexes([0xc9a640, 0x6e9c4a, 0x9a5568, 0x4a9c96, 0xb07a3c]),
    sponges: hexes([0xe0702a, 0x7a48b8, 0xd8b83a, 0xc0383a, 0x3a86c0, 0x9a5a9a]),
    fans: hexes([0xc8284a, 0x8a3ac0, 0xe0602a, 0xd84a8a, 0xa02a6a]),
    anemones: hexes([0xc05a7a, 0x5aa87a, 0xd08a4a, 0x8a6ad0]),
});

/** Colonies of each kind on the full reef (a tier takes a share of these). */
export const REEF_QUOTA = Object.freeze({
    tables: 56, brains: 52, anemones: 7, sponges: 58, branching: 150, fans: 56,
});

/** How much room each kind keeps round itself at scale 1 (metres), and its range of scales. */
const KIND = Object.freeze({
    tables: { room: 1.0, scale: [0.7, 1.5], flat: 0.2 },
    brains: { room: 0.8, scale: [0.45, 1.25], flat: 0.38 },
    anemones: { room: 0.55, scale: [0.7, 1.1], flat: 0.4 },
    sponges: { room: 0.45, scale: [0.7, 1.5], flat: 0.7 },
    branching: { room: 0.5, scale: [0.6, 1.45], flat: 0.6 },
    fans: { room: 0.3, scale: [0.7, 1.7], flat: 1 },
});

/**
 * The colonies. Returns one list per kind: { x, y, z, yaw, scale, seed, tint: [r, g, b] }.
 * @param {number} [share=1]  share of the full quota
 */
export function planReef(share = 1, seed = 20261011) {
    const rand = mulberry32(seed);
    const out = {
        tables: [], brains: [], anemones: [], sponges: [], branching: [], fans: [],
    };
    const taken = [];
    const free = (x, z, r) => {
        for (let i = 0; i < taken.length; i++) {
            const t = taken[i];
            const dx = t.x - x;
            const dz = t.z - z;
            const reach = (t.r + r) * 0.82;
            if (dx * dx + dz * dz < reach * reach) return false;
        }
        return true;
    };
    const n = [0, 1, 0];
    const put = (kind, x, z, scale, yaw = rand() * TAU) => {
        const spec = KIND[kind];
        const radius = spec.room * scale;
        // Broad things sit on the lowest ground under them; everything is bedded in a little.
        const y = (radius > 0.4 ? footprintFloor(x, z, radius * 0.75) : seabedHeight(x, z)) - 0.05 * scale;
        const colours = CORAL_COLOURS[kind];
        const item = {
            x, y, z, yaw, scale, seed: rand(), tint: colours[Math.floor(rand() * colours.length) % colours.length],
        };
        out[kind].push(item);
        taken.push({ x, z, r: radius });
        return item;
    };

    // ── The hero gardens: on the two coral heads at the foot of the picture ──
    const heroes = [
        // (kind, offset from the head's middle x, z, scale, yaw or null)
        ['tables', -0.9, -0.5, 1.5, null], ['brains', 0.9, 0.6, 1.0, null], ['anemones', 0.25, 1.0, 1.05, null],
        ['branching', -0.2, -1.6, 1.4, null], ['sponges', 1.5, -0.7, 1.3, null], ['fans', -1.6, 0.4, 1.1, 0.3],
        ['branching', 1.4, 1.5, 1.0, null], ['fans', 0.7, -1.8, 0.95, -0.25], ['brains', -1.5, 1.7, 0.7, null],
    ];
    [MOUNDS[0], MOUNDS[1]].forEach((mound, side) => {
        const flip = side ? -1 : 1;
        heroes.forEach(([kind, dx, dz, scale, yaw]) => {
            put(kind, mound[0] + dx * flip, mound[1] + dz, scale, yaw === null ? rand() * TAU : yaw * flip);
        });
    });

    // ── The rest of the reef, the broad kinds first so the small ones fill in round them ──
    Object.keys(REEF_QUOTA).forEach((kind) => {
        const spec = KIND[kind];
        const want = Math.max(out[kind].length, Math.round(REEF_QUOTA[kind] * share));
        let guard = 0;
        while (out[kind].length < want && guard < want * 220) {
            guard += 1;
            // Denser by the viewer, thinning out toward the blue.
            const z = 8.5 - 54 * rand() ** 1.45;
            const half = Math.min(Math.tan(50 * DEG) * (EYE.z - z) + 1, 30);
            const x = (rand() * 2 - 1) * half;
            if (Math.abs(x - channelAxis(z)) < 2.7) continue;
            const rock = rockAt(x, z);
            if (rock < 0.42 + rand() * 0.2) continue;
            seabedNormal(x, z, n, 0.4);
            const steep = 1 - n[1];
            if (steep > spec.flat) continue;
            // Fans keep to the walls; tables want the light, up on the shoulders.
            if (kind === 'fans' && steep < 0.035 && rand() < 0.7) continue;
            if (kind === 'tables' && shoulderRise(x, z) < 0.2 && rand() < 0.6) continue;
            const scale = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * rand() ** 1.6;
            if (!free(x, z, spec.room * scale)) continue;
            const y = seabedHeight(x, z);
            if (!inView(x, y + scale, z)) continue;
            // Fans stand broadside to the viewer (they are lace, not a line).
            const yaw = kind === 'fans' ? (rand() - 0.5) * 1.2 : rand() * TAU;
            put(kind, x, z, scale, yaw);
        }
    });
    return out;
}

/** Where the kelp stands in groves: (stage x, z, spread in metres). */
export const GROVES = Object.freeze([
    [-9.6, -2.5, 2.2], [10.6, -5.5, 2.4], [-13.5, -11, 3.2], [15.5, -15, 3.4], [-18, -23, 4], [12.5, -27, 3.6],
    [-10.5, -31, 3.4], [21, -33, 4.5], [-25, -15, 4], [24, -9, 3.6],
]);

/**
 * Stands of kelp: { x, y, z, height, seed, lean }.
 * @param {number} stands
 */
export function planKelp(stands, seed = 4471) {
    const rand = mulberry32(seed);
    const out = [];
    let guard = 0;
    while (out.length < stands && guard < stands * 200) {
        guard += 1;
        // The groves fill in turn, so a small tier still has kelp on both shoulders.
        const grove = GROVES[out.length % GROVES.length];
        const a = rand() * TAU;
        const r = Math.sqrt(rand()) * grove[2];
        const x = grove[0] + Math.cos(a) * r;
        const z = grove[1] + Math.sin(a) * r;
        if (Math.abs(x - channelAxis(z)) < 6.2) continue;
        if (out.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < 1.1 * 1.1)) continue;
        const y = seabedHeight(x, z) - 0.1;
        const height = Math.min(SURFACE - y - 0.6, 6.5 + rand() * 5.5);
        if (height < 4) continue;
        out.push({
            x, y, z, height, seed: rand(), lean: 0.8 + rand() * 0.5,
        });
    }
    return out;
}

/**
 * Blades of seagrass on the sand along the channel's edges: { x, y, z, yaw, scale, seed }.
 * They grow in meadows: a patch here, bare sand there.
 * @param {number} count
 */
export function planGrass(count, seed = 9917) {
    const rand = mulberry32(seed);
    const out = [];
    let guard = 0;
    while (out.length < count && guard < count * 60) {
        guard += 1;
        const z = 8.5 - 30 * rand() ** 1.3;
        const side = rand() < 0.5 ? -1 : 1;
        const x = channelAxis(z) + side * (0.9 + rand() * 5.2);
        // A meadow is where two slow fields agree.
        const meadow = Math.sin(x * 0.55 + 1.3) * Math.cos(z * 0.38 - 0.4) + Math.sin(x * 0.21 - z * 0.17);
        if (meadow < 0.15 - rand() * 0.35) continue;
        if (rockAt(x, z) > 0.5) continue;
        const y = seabedHeight(x, z);
        if (!inView(x, y + 0.4, z, 0.5)) continue;
        out.push({
            x, y: y - 0.03, z, yaw: rand() * TAU, scale: 0.55 + rand() * 0.9, seed: rand(),
        });
    }
    return out;
}

/**
 * Where the reef fish keep: a point over a colony each, near the viewer first.
 * { x, y, z, seed, hue (which of the reef-fish liveries), cover: [x, y, z] (the colony it darts into) }
 * @param {object} reef    planReef()'s lists
 * @param {number} count
 */
export function planReefFish(reef, count, seed = 3301) {
    const rand = mulberry32(seed);
    const heads = [...reef.tables, ...reef.branching, ...reef.brains, ...reef.sponges]
        .filter((c) => c.z > -24)
        .sort((a, b) => b.z - a.z);
    const out = [];
    if (!heads.length) return out;
    for (let i = 0; i < count; i++) {
        // Shoals of a handful over the nearest heads, thinner further out.
        const head = heads[Math.floor(rand() ** 1.7 * heads.length)];
        const a = rand() * TAU;
        const r = 0.3 + rand() * 1.3 * head.scale;
        out.push({
            x: head.x + Math.cos(a) * r,
            y: head.y + 0.55 * head.scale + 0.25 + rand() * 1.5,
            z: head.z + Math.sin(a) * r,
            seed: rand(),
            hue: Math.floor(rand() * 4),
            cover: [head.x, head.y + 0.3 * head.scale, head.z],
        });
    }
    return out;
}

/** Stage points the reef spawns from when a current passes: the gardens' middles. */
export function gardensOf(reef) {
    const points = MOUNDS.slice(0, 8).map((m) => [m[0], m[1]]);
    // And wherever the big tables stand.
    reef.tables.slice(0, 6).forEach((t) => points.push([t.x, t.z]));
    return points;
}
