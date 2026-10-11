/**
 * Moonlit Greenhouse — the plan: the house and its garden as lists of numbers, seeded and
 * deterministic (CPU only, three-free). The iron, the floor, the plants, the lanterns and the
 * lily pads are all built from it, so they agree on where everything stands, and the tests can
 * check the garden without a renderer.
 *
 * The beds run down both sides of the nave between the paths and the side walls; the canal runs
 * down the middle. Plants are placed more densely near the eye (what is far is mostly behind the
 * card), always clear of the paths and of each other's trunks.
 */
import {
    FLOOR, GLAZING, HOUSE, clamp, lerp, mulberry32, ribPositions, vaultHeightAt,
} from './moonlit-greenhouse-core.js';

/** The beds' usable band across the nave (|x|, metres) and along it (z). */
export const BEDS = Object.freeze({
    inner: FLOOR.bed.inner + 0.25,
    outer: HOUSE.halfSpan - 0.45,
    near: 1.2,
    far: -52,
});

/**
 * The urns on the paths either side of the canal, just past the first lanterns, whose pools of
 * candlelight they stand in: they frame the lower corners of a wide picture (an upright phone's
 * lens is too narrow to reach the paths this near).
 */
export const URNS = Object.freeze([
    Object.freeze({
        x: -3.2, z: -0.9, radius: 0.42, height: 0.95,
    }),
    Object.freeze({
        x: 3.2, z: -0.9, radius: 0.42, height: 0.95,
    }),
]);

/** A place along the beds, denser near the eye: u in 0..1 → z. */
function bedZ(u) {
    return lerp(BEDS.near, BEDS.far, u ** 1.35);
}

/**
 * Stratified places down both beds: `n` items, alternating sides, each jittered within its own
 * stretch, at |x| in [x0, x1].
 */
function stratified(rand, n, x0, x1, { near = BEDS.near, far = BEDS.far, power = 1.35 } = {}) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const u = (Math.floor(i / 2) + 0.15 + rand() * 0.7) / Math.max(1, Math.ceil(n / 2));
        const z = lerp(near, far, clamp(u, 0, 1) ** power);
        out.push({ side, x: side * lerp(x0, x1, rand()), z });
    }
    return out;
}

/** Keep `p` at least `gap` metres from every point in `taken` (nudging it along z), then take it. */
function settle(p, taken, gap) {
    for (let tries = 0; tries < 6; tries += 1) {
        const clash = taken.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < gap);
        if (!clash) break;
        p.z += (p.z >= clash.z ? 1 : -1) * gap * 0.6;
    }
    taken.push(p);
    return p;
}

/**
 * The whole garden for a tier (counts from moonlit-greenhouse-quality.js).
 * Every item carries its own `seed` (0..1) for the shaders' and the builders' variation.
 */
export function planGarden(tier, seed = 1861) {
    const rand = mulberry32(seed);
    const ribs = ribPositions();
    const trunks = [];

    // The cast-iron columns: one each side under every rib, against the side walls.
    const columns = [];
    ribs.forEach((z) => {
        columns.push({ x: -(HOUSE.halfSpan - 0.22), z });
        columns.push({ x: HOUSE.halfSpan - 0.22, z });
    });

    // Lanterns hang over the paths from every second rib, both sides, nearest first.
    const lanterns = [];
    ribs.filter((z) => z < 0.5 && z > -44).forEach((z, i) => {
        if (i % 2 !== 0) return;
        [-1, 1].forEach((side) => {
            const x = side * 3.15;
            lanterns.push({
                x, y: 3.55 + rand() * 0.3, z: z - 0.05, top: vaultHeightAt(x) - 0.2, seed: rand(),
            });
        });
    });

    // Palms: tall, against the walls, leaning a little in toward the nave; their crowns open
    // under the glass.
    const palms = stratified(rand, tier.palms, 5.2, 6.2, { near: -1.5, far: -50, power: 1.25 }).map((p) => {
        settle(p, trunks, 2.6);
        const roof = vaultHeightAt(p.x);
        const height = clamp(lerp(7.0, 9.6, rand()), 6, roof - 1.6);
        return {
            ...p,
            height,
            lean: 0.04 + rand() * 0.07, // radians, toward the nave's middle
            twist: rand() * Math.PI * 2,
            crown: lerp(2.4, 3.3, rand()),
            fronds: 11 + Math.floor(rand() * 5),
            seed: rand(),
        };
    });

    // Tree ferns: lacy umbrellas between the palms, nearer the paths.
    const treeFerns = stratified(rand, tier.treeFerns, 4.5, 5.6, { near: 0.2, far: -46 }).map((p) => {
        settle(p, trunks, 2.0);
        return {
            ...p,
            height: lerp(2.3, 3.8, rand()),
            crown: lerp(1.7, 2.4, rand()),
            fronds: 10 + Math.floor(rand() * 4),
            twist: rand() * Math.PI * 2,
            seed: rand(),
        };
    });

    // Bananas and bird-of-paradise: broad paddle leaves near the bed fronts.
    const bananas = stratified(rand, tier.bananas, 4.2, 5.0, { near: 0.6, far: -42 }).map((p) => {
        settle(p, trunks, 1.4);
        return {
            ...p,
            height: lerp(2.2, 3.4, rand()),
            leaves: 6 + Math.floor(rand() * 4),
            yaw: rand() * Math.PI * 2,
            seed: rand(),
        };
    });

    // Monstera and philodendron: low, big split leaves right at the bed fronts.
    const monsteras = stratified(rand, tier.monsteras, 3.95, 4.55, { near: 1.0, far: -38 }).map((p) => ({
        ...p,
        scale: lerp(0.8, 1.35, rand()),
        leaves: 5 + Math.floor(rand() * 4),
        yaw: rand() * Math.PI * 2,
        seed: rand(),
    }));

    // Ground ferns: the low cover of the beds.
    const groundFerns = stratified(rand, tier.groundFerns, 3.9, 6.4, { near: 1.2, far: -40, power: 1.5 }).map((p) => ({
        ...p,
        scale: lerp(0.55, 1.05, rand()),
        fronds: 7 + Math.floor(rand() * 5),
        yaw: rand() * Math.PI * 2,
        seed: rand(),
    }));

    // Hanging baskets of fern over the paths, between the lanterns.
    const baskets = [];
    ribs.filter((z) => z < -2 && z > -40).forEach((z, i) => {
        if (i % 2 !== 1 || baskets.length >= tier.baskets) return;
        [-1, 1].forEach((side) => {
            if (baskets.length >= tier.baskets) return;
            const x = side * 3.0;
            baskets.push({
                x, y: 4.35 + rand() * 0.5, z, top: vaultHeightAt(x) - 0.2, scale: lerp(0.8, 1.1, rand()), seed: rand(),
            });
        });
    });

    // Vines hanging from the vault over the beds.
    const vines = [];
    for (let i = 0; i < tier.vines; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const x = side * lerp(4.4, 6.0, rand());
        const z = bedZ(((i + 0.5) / Math.max(1, tier.vines)) * 0.75);
        const top = vaultHeightAt(x) - 0.15;
        vines.push({
            x, z, top, length: lerp(2.2, 4.6, rand()), strands: 3 + Math.floor(rand() * 3), seed: rand(),
        });
    }

    // Reeds and cattails in clumps along both edges of the canal, densest near the eye.
    const reeds = [];
    const clumps = Math.max(4, Math.round(tier.reeds / 14));
    for (let c = 0; c < clumps; c += 1) {
        const side = c % 2 === 0 ? -1 : 1;
        const u = (Math.floor(c / 2) + rand()) / Math.ceil(clumps / 2);
        const cz = lerp(FLOOR.canal.head - 0.4, -42, u ** 1.6);
        const cx = side * (FLOOR.canal.half - 0.28 - rand() * 0.22);
        const blades = Math.round(tier.reeds / clumps);
        for (let b = 0; b < blades; b += 1) {
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(rand()) * 0.42;
            reeds.push({
                x: clamp(cx + Math.cos(a) * r * 0.6, -FLOOR.canal.half + 0.08, FLOOR.canal.half - 0.08),
                z: cz + Math.sin(a) * r * 1.4,
                height: lerp(0.8, 1.9, rand() ** 0.8),
                lean: (rand() - 0.5) * 0.35 + side * 0.08,
                yaw: rand() * Math.PI * 2,
                cattail: rand() < 0.16,
                seed: rand(),
            });
        }
    }

    // Lily pads: a few great Victoria pads near the eye with their turned-up rims, and clusters
    // of small water-lily pads down the canal. No pad overlaps another.
    const pads = [];
    const tryPad = (x, z, radius, kind) => {
        if (Math.abs(x) + radius > FLOOR.canal.half - 0.12) return false;
        if (pads.some((q) => Math.hypot(q.x - x, q.z - z) < q.radius + radius + 0.05)) return false;
        pads.push({
            x, z, radius, kind, yaw: rand() * Math.PI * 2, seed: rand(),
        });
        return true;
    };
    const victoria = Math.min(4, Math.max(2, Math.round(tier.pads / 16)));
    for (let i = 0, tries = 0; i < victoria && tries < 60; tries += 1) {
        const z = lerp(-1.6, -11, (i + rand()) / victoria);
        if (tryPad((rand() - 0.5) * 2.4, z, lerp(0.62, 0.92, rand()), 'victoria')) i += 1;
    }
    for (let tries = 0; pads.length < tier.pads && tries < tier.pads * 30; tries += 1) {
        const z = lerp(0.9, -40, rand() ** 1.5);
        const x = (rand() - 0.5) * 2 * (FLOOR.canal.half - 0.3);
        tryPad(x, z, lerp(0.14, 0.34, rand()), 'lily');
    }

    return {
        seed,
        ribs,
        columns,
        lanterns,
        palms,
        treeFerns,
        bananas,
        monsteras,
        groundFerns,
        baskets,
        vines,
        reeds,
        pads,
        urns: URNS,
        glazing: GLAZING,
    };
}

/**
 * Where a palm's crown stands: the top of its trunk, which leans toward the nave's middle by
 * `lean` radians. The palms' geometry and the canopy's shadow (mgCanopy) both use this.
 */
export function palmCrownCentre(palm, out = { x: 0, y: 0, z: 0 }) {
    out.x = palm.x - Math.sign(palm.x || 1) * palm.height * Math.sin(palm.lean);
    out.y = palm.height * Math.cos(palm.lean);
    out.z = palm.z;
    return out;
}

/**
 * The heading of frond `k` of a palm's crown, in radians: the frond points along
 * (cos a, sin a) in (x, z) from the crown's centre. Evenly spread from the palm's `twist`, each a
 * little off by its own hash; the palms' geometry and the canopy's shadow (mgCanopy) agree on it.
 */
export function palmFrondAngle(palm, k) {
    const jitter = Math.sin((palm.seed * 97.13 + k * 12.9898) * 43.7) * 0.12;
    return palm.twist + (k / palm.fronds) * Math.PI * 2 + jitter;
}
