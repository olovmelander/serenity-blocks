/**
 * Stillwater — the lie of the land (stillwater-plan.js).
 *
 * The shore, the ground and where everything stands are planned on the CPU from fixed seeds, in
 * stage space. The tarn is being tuned while these tests stand: they walk the plan and pin what
 * the picture relies on (water where the light falls, land under every foot, open sight lines to
 * the two figures and the moon), with every bound read from the modules' own exports. Where a
 * test says what the plan "once" did, it pins a fault that was found here and has been put right.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    DEG, EYE, HEART, MOON, SPIRIT, TROLL, halfWidthTan, lerp, skyDirection,
} from '../../src/themes/stillwater/stillwater-core.js';
import {
    SHORE_MAP, STAGE, STONE_TOP, azimuthOf, bakeShoreMap, groundHeight, groundNormal, inKeepClear, leftShore,
    planBoulders, planCaps, planEyes, planFerns, planLilies, planReeds, planSaplings, planTrunks, rangeOf, rightShore,
    shoreDistance, trollTrack, valueNoise,
} from '../../src/themes/stillwater/stillwater-plan.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/stillwater/stillwater-quality.js';

// Every plan is made at every tier's count and walked item by item, on a machine that may be busy.
vi.setConfig({ testTimeout: 30000 });

/** Every count a tier builds a plan with, and a few between and beyond. */
const countsFor = (key, extra = []) => [...new Set([...QUALITY_NAMES.map((name) => QUALITY[name][key]), ...extra])]
    .sort((a, b) => a - b);

/** The point of the mid-line (x = 0) that lies furthest out on the water. */
const MID = (() => {
    let best = 0;
    let deepest = Infinity;
    for (let z = STAGE.z0; z <= STAGE.z1; z += 0.25) {
        const d = shoreDistance(0, z);
        if (d < deepest) {
            deepest = d;
            best = z;
        }
    }
    return [0, best];
})();

/** Where the straight line from a water point to a land point crosses the water's edge. */
function shoreBetween(water, land) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (shoreDistance(lerp(water[0], land[0], mid), lerp(water[1], land[1], mid)) < 0) lo = mid;
        else hi = mid;
    }
    const t = (lo + hi) / 2;
    const length = Math.hypot(land[0] - water[0], land[1] - water[1]);
    return {
        x: lerp(water[0], land[0], t),
        z: lerp(water[1], land[1], t),
        // A unit step from the water toward the land along the line.
        out: [(land[0] - water[0]) / length, (land[1] - water[1]) / length],
    };
}

/** Points of the water's edge all the way round the tarn (rays from its middle). */
function shorePoints(count = 40) {
    const out = [];
    for (let k = 0; k < count; k++) {
        const angle = (k / count) * Math.PI * 2;
        const far = [MID[0] + Math.sin(angle) * 120, MID[1] + Math.cos(angle) * 120];
        out.push(shoreBetween(MID, far));
    }
    return out;
}

/** The height of the ground 5 cm either side of a point of the water's edge. */
function acrossShore(p, step = 0.05) {
    return {
        wet: groundHeight(p.x - p.out[0] * step, p.z - p.out[1] * step),
        dry: groundHeight(p.x + p.out[0] * step, p.z + p.out[1] * step),
    };
}

/** The level places the plan cuts into the bank: the troll's track and the viewer's own footing. */
const onLevelPlace = (x, z) => trollTrack(x, z).weight > 0 || rangeOf(x, z) < 4.5;

/** Points along a figure's way from where it rests to where a chain draws it. */
function wayOf(who, steps = 10) {
    return Array.from({ length: steps + 1 }, (_, k) => [
        lerp(who.home[0], who.reach[0], k / steps),
        lerp(who.home[2], who.reach[2], k / steps),
        k / steps,
    ]);
}

/**
 * True when something `halfWidth` wide at (x, z) stands between the rest camera and a target
 * `targetHalf` wide: nearer than it, and overlapping it in azimuth.
 */
function hides(x, z, halfWidth, target, targetHalf) {
    const range = rangeOf(x, z);
    const targetRange = rangeOf(target[0], target[1]);
    if (range >= targetRange) return false;
    const apart = Math.abs(azimuthOf(x, z) - azimuthOf(target[0], target[1]));
    return apart < Math.atan2(halfWidth, range) + Math.atan2(targetHalf, targetRange);
}

/** How wide each figure is taken to be when a sight line is checked (metres either side). */
const HALF_WIDTH = new Map([[SPIRIT, SPIRIT.height * 0.2], [TROLL, TROLL.height * 0.35]]);

const gaps = (list, radiusOf) => {
    let least = Infinity;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const apart = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z);
            const gap = apart - radiusOf(list[i]) - radiusOf(list[j]);
            if (gap < least) least = gap;
        }
    }
    return least;
};

const allFinite = (object) => Object.values(object).flat().every((v) => typeof v !== 'number' || Number.isFinite(v));

describe('stillwater plan: the stage and its noise', () => {
    it('holds everyone who stands in the picture', () => {
        expect(Object.isFrozen(STAGE)).toBe(true);
        expect(STAGE.x0).toBeLessThan(STAGE.x1);
        expect(STAGE.z0).toBeLessThan(STAGE.z1);
        const inside = (x, z) => x > STAGE.x0 && x < STAGE.x1 && z > STAGE.z0 && z < STAGE.z1;
        expect(inside(EYE.x, EYE.z)).toBe(true);
        for (const who of [SPIRIT, TROLL]) {
            expect(inside(who.home[0], who.home[2])).toBe(true);
            expect(inside(who.reach[0], who.reach[2])).toBe(true);
        }
        expect(inside(HEART[0], HEART[2])).toBe(true);
        // The whole tarn lies within it: the stage's rim is land all the way round.
        for (let k = 0; k <= 60; k++) {
            const x = lerp(STAGE.x0, STAGE.x1, k / 60);
            const z = lerp(STAGE.z0, STAGE.z1, k / 60);
            for (const [px, pz] of [[x, STAGE.z0], [x, STAGE.z1], [STAGE.x0, z], [STAGE.x1, z]]) {
                expect(shoreDistance(px, pz), `(${px.toFixed(1)}, ${pz.toFixed(1)})`).toBeGreaterThan(0);
            }
        }
    });

    it('gives the same value noise every time: in 0..1, smooth, and its lattice values at whole numbers', () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < 4000; i++) {
            const x = Math.sin(i * 12.9898) * 87.3;
            const z = Math.cos(i * 78.233) * 61.7;
            const v = valueNoise(x, z);
            expect(v).toBe(valueNoise(x, z));
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            // A centimetre away it has hardly changed (the steepest a smoothstep cell can be is 1.5 a unit, each way).
            expect(Math.abs(valueNoise(x + 0.01, z + 0.01) - v)).toBeLessThan(0.04);
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
        }
        expect(lo).toBeLessThan(0.1);
        expect(hi).toBeGreaterThan(0.9);
        // Continuous across the lattice lines, negative coordinates included.
        for (const [x, z] of [[3, 2.4], [-5, 0.3], [0, -7.7], [2.2, -4]]) {
            expect(valueNoise(x - 1e-9, z)).toBeCloseTo(valueNoise(x + 1e-9, z), 6);
            expect(valueNoise(z, x - 1e-9)).toBeCloseTo(valueNoise(z, x + 1e-9), 6);
        }
    });
});

describe('stillwater plan: sight lines', () => {
    it('measures azimuth and range from the rest camera', () => {
        expect(azimuthOf(EYE.x, EYE.z - 10)).toBe(0);
        expect(rangeOf(EYE.x, EYE.z)).toBe(0);
        expect(rangeOf(EYE.x + 3, EYE.z - 4)).toBeCloseTo(5, 12);
        expect(azimuthOf(EYE.x + 5, EYE.z - 5)).toBeCloseTo(45 * DEG, 12); // + to the right
        expect(azimuthOf(EYE.x - 5, EYE.z - 5)).toBeCloseTo(-45 * DEG, 12);
        expect(azimuthOf(EYE.x + 1, EYE.z)).toBeCloseTo(90 * DEG, 12);
        for (const [az, range] of [[0.3, 12], [-0.6, 40], [1.2, 7], [-0.05, 80]]) {
            const x = EYE.x + Math.sin(az) * range;
            const z = EYE.z - Math.cos(az) * range;
            expect(azimuthOf(x, z)).toBeCloseTo(az, 12);
            expect(rangeOf(x, z)).toBeCloseTo(range, 12);
            // The same bearing the sky is drawn by: a point at that azimuth lies along skyDirection(az, 0).
            const d = skyDirection(az, 0);
            expect((x - EYE.x) / range).toBeCloseTo(d[0], 12);
            expect((z - EYE.z) / range).toBeCloseTo(d[2], 12);
        }
    });

    it('keeps the two figures, the troll\'s walk and the moon inside its windows, the card\'s place outside', () => {
        expect(inKeepClear(SPIRIT.home[0], SPIRIT.home[2])).toBe(true);
        expect(inKeepClear(TROLL.home[0], TROLL.home[2])).toBe(true);
        expect(inKeepClear(TROLL.reach[0], TROLL.reach[2])).toBe(true);
        for (const [x, z] of wayOf(TROLL)) expect(inKeepClear(x, z)).toBe(true);
        // Nothing tall may stand on the moon's bearing, near or far.
        for (let range = 8; range <= 150; range += 4) {
            const x = EYE.x + Math.sin(MOON.azimuth) * range;
            const z = EYE.z - Math.cos(MOON.azimuth) * range;
            expect(inKeepClear(x, z), `the moon's bearing at ${range} m`).toBe(true);
        }
        // Straight ahead is the card's; far out to either side is the wood's.
        for (let range = 5; range <= 100; range += 5) {
            expect(inKeepClear(EYE.x, EYE.z - range)).toBe(false);
            for (const side of [-1, 1]) {
                const az = side * 62 * DEG;
                expect(inKeepClear(EYE.x + Math.sin(az) * range, EYE.z - Math.cos(az) * range)).toBe(false);
            }
        }
        // A margin widens a window: something with a width may be in it when its middle is not.
        let widened = 0;
        for (let az = -60; az <= 60; az += 0.25) {
            const x = EYE.x + Math.sin(az * DEG) * 20;
            const z = EYE.z - Math.cos(az * DEG) * 20;
            if (inKeepClear(x, z)) expect(inKeepClear(x, z, 1.5)).toBe(true);
            else if (inKeepClear(x, z, 1.5)) widened += 1;
        }
        expect(widened).toBeGreaterThan(0);
    });
});

describe('stillwater plan: the shore', () => {
    it('lies open down the middle, from the near shore to the far wood', () => {
        const near = shoreBetween(MID, [EYE.x, EYE.z]);
        // The viewer stands just behind the near shore.
        expect(near.z).toBeLessThan(EYE.z);
        expect(EYE.z - near.z).toBeLessThan(4);
        for (let z = near.z - 0.25; z >= -55; z -= 0.25) {
            expect(shoreDistance(0, z), `x 0, z ${z.toFixed(2)}`).toBeLessThan(0);
        }
        // Wide enough to hold the board's reflections: metres of water either side of the middle line.
        expect(shoreDistance(MID[0], MID[1])).toBeLessThan(-8);
        // It has a far shore: the wood closes the view.
        expect(shoreDistance(0, STAGE.z0)).toBeGreaterThan(0);
        // The heart lies under open water.
        expect(shoreDistance(HEART[0], HEART[2])).toBeLessThan(-3);
        for (let z = -60; z <= 0; z += 2) {
            expect(leftShore(z)).toBeGreaterThan(0);
            expect(rightShore(z)).toBeGreaterThan(0);
        }
    });

    it('has land where anyone stands, and water where a chain draws the spirit', () => {
        expect(shoreDistance(EYE.x, EYE.z)).toBeGreaterThan(0);
        // The spirit's stone is at the water's edge; the troll sits on the bank.
        expect(Math.abs(shoreDistance(SPIRIT.home[0], SPIRIT.home[2]))).toBeLessThan(1);
        expect(shoreDistance(TROLL.home[0], TROLL.home[2])).toBeGreaterThan(0);
        // She walks out over open water; he comes down to the edge and no further.
        expect(shoreDistance(SPIRIT.reach[0], SPIRIT.reach[2])).toBeLessThan(-1);
        expect(Math.abs(shoreDistance(TROLL.reach[0], TROLL.reach[2]))).toBeLessThan(1);
        // Each way runs one way only: she goes steadily out, he steadily down to the water.
        for (const who of [SPIRIT, TROLL]) {
            let last = Infinity;
            for (const [x, z] of wayOf(who, 40)) {
                const d = shoreDistance(x, z);
                expect(d).toBeLessThan(last);
                last = d;
            }
        }
        // The water between them at the end of the longest chain is open.
        for (let k = 0; k <= 20; k++) {
            const x = lerp(SPIRIT.reach[0], TROLL.reach[0] - 1, k / 20);
            const z = lerp(SPIRIT.reach[2], TROLL.reach[2], k / 20);
            expect(shoreDistance(x, z)).toBeLessThan(0);
        }
    });

    it('measures about how far the edge is: signed, smooth, and never steeper than a slanted shore makes it', () => {
        let steepest = 0;
        for (let i = 0; i < 6000; i++) {
            const x = lerp(STAGE.x0, STAGE.x1, Math.sin(i * 12.9898) * 0.5 + 0.5);
            const z = lerp(STAGE.z0, STAGE.z1, Math.sin(i * 78.233) * 0.5 + 0.5);
            const angle = i * 2.399963;
            const here = shoreDistance(x, z);
            const there = shoreDistance(x + Math.cos(angle) * 0.05, z + Math.sin(angle) * 0.05);
            expect(Number.isFinite(here)).toBe(true);
            steepest = Math.max(steepest, Math.abs(there - here) / 0.05);
        }
        expect(steepest).toBeGreaterThan(0.9); // it is a distance, in metres
        expect(steepest).toBeLessThan(2);
        // All forty points found on the edge are on it.
        for (const p of shorePoints()) expect(Math.abs(shoreDistance(p.x, p.z))).toBeLessThan(1e-9);
    });
});

describe('stillwater plan: the ground', () => {
    it('is the tarn\'s bed under the water and the bank above it', () => {
        for (let x = STAGE.x0; x <= STAGE.x1; x += 0.61) {
            for (let z = STAGE.z0; z <= STAGE.z1; z += 0.67) {
                const d = shoreDistance(x, z);
                const h = groundHeight(x, z);
                const label = `(${x.toFixed(2)}, ${z.toFixed(2)}), ${d.toFixed(2)} m from the edge`;
                expect(Number.isFinite(h), label).toBe(true);
                if (d < 0) expect(h, label).toBeLessThanOrEqual(0);
                if (d > 0) expect(h, label).toBeGreaterThanOrEqual(0);
            }
        }
        // The bed shelves away from the edge; the wood's floor climbs away from it.
        expect(groundHeight(MID[0], MID[1])).toBeLessThan(-1);
        expect(groundHeight(STAGE.x0 + 1, MID[1])).toBeGreaterThan(1);
    });

    it('meets the water without a step, away from the level places', () => {
        const points = shorePoints(40).filter((p) => !onLevelPlace(p.x, p.z));
        expect(points.length).toBeGreaterThan(30);
        for (const p of points) {
            const { wet, dry } = acrossShore(p);
            const heights = `${wet.toFixed(3)} under water, ${dry.toFixed(3)} on land`;
            const label = `the edge at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}): ${heights}`;
            expect(Math.abs(dry - wet), label).toBeLessThan(0.1);
            expect(wet, label).toBeLessThanOrEqual(0);
            expect(dry, label).toBeGreaterThanOrEqual(0);
        }
    });

    // The two terraces (the troll's track, the viewer's footing) are laid over the bank only. Where
    // one reaches the water's edge it must fade out, or the ground steps from the bed straight up
    // to the terrace (it once did: 0.23 m in 10 cm under the viewer, 0.28 m beside the troll's track).
    it('meets the water without a step at the level places too', () => {
        const points = [
            ...shorePoints(40),
            shoreBetween(MID, [EYE.x, EYE.z]),
            shoreBetween([TROLL.reach[0], TROLL.reach[2]], [TROLL.home[0], TROLL.home[2]]),
        ];
        const steps = points.map((p) => {
            const { wet, dry } = acrossShore(p);
            return { at: [p.x, p.z], step: Math.abs(dry - wet) };
        }).filter((s) => s.step >= 0.1);
        expect(steps).toEqual([]);
    });

    it('is level under the viewer', () => {
        const here = groundHeight(EYE.x, EYE.z);
        expect(here).toBeGreaterThan(0);
        // The eye is a sitting or standing height above it.
        expect(EYE.y - here).toBeGreaterThan(1);
        expect(EYE.y - here).toBeLessThan(2);
        for (let k = 0; k < 24; k++) {
            const angle = (k / 24) * Math.PI * 2;
            for (const r of [0.3, 0.7, 1.1]) {
                const x = EYE.x + Math.cos(angle) * r;
                const z = EYE.z + Math.sin(angle) * r;
                expect(Math.abs(groundHeight(x, z) - here), `${r} m from the eye`).toBeLessThan(0.02);
            }
        }
        const normal = groundNormal(EYE.x, EYE.z);
        expect(normal[1]).toBeGreaterThan(0.999);
    });

    it('carries the troll along his track wherever the track runs on the bank', () => {
        let onLand = 0;
        for (const [x, z, t] of wayOf(TROLL, 10)) {
            const track = trollTrack(x, z);
            // On his own line the track is all there is.
            expect(track.weight).toBe(1);
            if (shoreDistance(x, z) <= 0) continue;
            onLand += 1;
            const off = Math.abs(groundHeight(x, z) - track.height);
            expect(off, `${(t * 100).toFixed(0)} % of the way`).toBeLessThan(0.05);
        }
        expect(onLand).toBeGreaterThanOrEqual(5);
        // The track runs from his seat's height to the height he stands at by the water, never rising on the way.
        expect(trollTrack(TROLL.home[0], TROLL.home[2]).height).toBeCloseTo(TROLL.home[1], 9);
        expect(trollTrack(TROLL.reach[0], TROLL.reach[2]).height).toBeCloseTo(TROLL.reach[1], 9);
        let last = Infinity;
        for (const [x, z] of wayOf(TROLL, 40)) {
            const { height } = trollTrack(x, z);
            expect(height).toBeLessThanOrEqual(last + 1e-12);
            last = height;
        }
        expect(groundHeight(TROLL.home[0], TROLL.home[2])).toBeCloseTo(TROLL.home[1], 9);
        // It is a track, not a terrace: a few metres to the side the bank is its own again.
        expect(trollTrack(TROLL.home[0] + 6, TROLL.home[2] - 6).weight).toBe(0);
        expect(trollTrack(EYE.x, EYE.z).weight).toBe(0);
    });

    // The whole of his way, its end included: where the chain draws him must be ground, not the
    // tarn's bed with a troll hovering over it (TROLL.reach once lay 0.39 m out on the water, and
    // he stood 0.27 m above the ground mesh there).
    it('carries the troll all the way to where a chain draws him', () => {
        const off = wayOf(TROLL, 10).map(([x, z, t]) => ({
            t, gap: trollTrack(x, z).height - groundHeight(x, z),
        })).filter((p) => Math.abs(p.gap) >= 0.05);
        expect(off).toEqual([]);
    });

    it('slopes by the unit normal of its own heights', () => {
        for (const [x, z] of [[EYE.x, EYE.z], [-20, -30], [14, -8], [MID[0], MID[1]], [-9, -4], [30, 5]]) {
            const out = [0, 0, 0];
            expect(groundNormal(x, z, out)).toBe(out);
            expect(Math.hypot(...out)).toBeCloseTo(1, 12);
            expect(out[1]).toBeGreaterThan(0);
            // It leans away from the rising ground.
            const step = 0.35;
            const rise = groundHeight(x + step, z) - groundHeight(x - step, z);
            if (Math.abs(rise) > 1e-6) expect(Math.sign(out[0])).toBe(-Math.sign(rise));
        }
    });
});

describe('stillwater plan: every plan', () => {
    const PLANS = {
        planTrunks, planBoulders, planLilies, planReeds, planFerns, planCaps, planEyes, planSaplings,
    };

    it.each(Object.keys(PLANS))('%s is the same every time, and finite', (name) => {
        const make = PLANS[name];
        for (const count of [0, 1, 9, 40, 131]) {
            const first = make(count);
            expect(make(count), `${name}(${count})`).toEqual(first);
            for (const item of first) expect(allFinite(item), `${name}(${count})`).toBe(true);
        }
        // With no count it plans for the fullest picture it was written for; another seed gives another wood.
        expect(make()).toEqual(make());
        expect(make().length).toBeGreaterThan(0);
        expect(make(40, 12345)).not.toEqual(make(40));
    });

    it.each(Object.keys(PLANS))('%s places no more than it is asked for', (name) => {
        const make = PLANS[name];
        // What is placed by hand is always there, whatever the count.
        const byHand = make(0).length;
        for (const count of [0, 1, 2, 7, 8, 9, 20, 50, 131, 400, 2000]) {
            const got = make(count).length;
            expect(got, `${name}(${count})`).toBeLessThanOrEqual(Math.max(count, byHand));
        }
        // A count that is asked for and can be had is had: the tiers get what they pay for.
        const key = {
            planTrunks: 'trunks',
            planBoulders: 'boulders',
            planLilies: 'lilies',
            planFerns: 'ferns',
            planCaps: 'caps',
            planEyes: 'eyes',
            planSaplings: 'saplings',
        }[name];
        if (key) {
            for (const quality of QUALITY_NAMES) {
                expect(make(QUALITY[quality][key]).length, `${quality}.${key}`).toBe(QUALITY[quality][key]);
            }
        }
    });

    it('builds a lower tier\'s wood out of the first trees and stones of a higher one', () => {
        // A change of quality in the middle of a run does not move the trees about.
        const trunks = countsFor('trunks');
        const full = planTrunks(trunks[trunks.length - 1]);
        for (const count of trunks) expect(planTrunks(count)).toEqual(full.slice(0, count));
        const boulders = countsFor('boulders');
        const all = planBoulders(boulders[boulders.length - 1]);
        for (const count of boulders) expect(planBoulders(count)).toEqual(all.slice(0, count));
    });
});

describe('stillwater plan: trunks', () => {
    const COUNTS = countsFor('trunks', [8, 20]);

    it('stands every tree on the bank, rooted below the ground, clear of its neighbours and the troll\'s track', () => {
        const onStage = (t) => t.x > STAGE.x0 && t.x < STAGE.x1 && t.z > STAGE.z0 && t.z < STAGE.z1;
        for (const count of COUNTS) {
            const trunks = planTrunks(count);
            for (const t of trunks) {
                const label = `trunks(${count}) at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`;
                expect(shoreDistance(t.x, t.z), label).toBeGreaterThan(0);
                expect(t.y, label).toBeLessThanOrEqual(groundHeight(t.x, t.z) + 0.01);
                expect(groundHeight(t.x, t.z) - t.y, label).toBeLessThan(1); // rooted, not buried
                expect(trollTrack(t.x, t.z).weight, label).toBe(0);
                expect(t.radius, label).toBeGreaterThan(0);
                // An old spruce: far taller than the frame, many times taller than it is thick.
                expect(t.height, label).toBeGreaterThan(t.radius * 20);
                expect(t.lean, label).toHaveLength(2);
                expect(Math.hypot(...t.lean), label).toBeLessThan(0.1); // it leans, it does not fall
                expect(t.roots, label).toBeGreaterThanOrEqual(0);
                expect(t.roots, label).toBeLessThanOrEqual(1);
                expect(onStage(t), label).toBe(true);
            }
            expect(gaps(trunks, (t) => t.radius), `trunks(${count})`).toBeGreaterThan(0);
        }
    });

    it('always plants the trees placed by hand, the two giants that frame the view among them', () => {
        const byHand = planTrunks(0);
        expect(byHand.length).toBeGreaterThanOrEqual(2);
        expect(byHand.every((t) => t.hero)).toBe(true);
        for (const count of COUNTS) {
            const trunks = planTrunks(count);
            expect(trunks.filter((t) => t.hero)).toEqual(byHand);
            expect(trunks.slice(0, byHand.length)).toEqual(byHand);
            expect(trunks.slice(byHand.length).some((t) => t.hero)).toBe(false);
        }
        // One giant to either side of the viewer, close by, in front of the eye.
        const giants = byHand.filter((t) => rangeOf(t.x, t.z) < 9);
        expect(giants).toHaveLength(2);
        expect(giants.map((t) => Math.sign(t.x)).sort()).toEqual([-1, 1]);
        for (const giant of giants) {
            expect(giant.z).toBeLessThan(EYE.z);
            // They frame the view: each stands outside the 16:9 frame's middle half, and inside the frame.
            const tan = Math.abs(Math.tan(azimuthOf(giant.x, giant.z)));
            expect(tan).toBeGreaterThan(halfWidthTan(16 / 9) * 0.5);
            // And not on the viewer: there is room to sit between them.
            expect(rangeOf(giant.x, giant.z)).toBeGreaterThan(3);
        }
        // Trees stand behind each figure, on its own bank.
        const spiritRange = rangeOf(SPIRIT.home[0], SPIRIT.home[2]);
        const trollRange = rangeOf(TROLL.home[0], TROLL.home[2]);
        expect(byHand.some((t) => t.x < SPIRIT.home[0] && rangeOf(t.x, t.z) > spiritRange - 3)).toBe(true);
        expect(byHand.some((t) => t.x > TROLL.home[0] && rangeOf(t.x, t.z) > trollRange)).toBe(true);
    });

    it('scatters no tree into a window of the view that is kept clear, nor close to the viewer', () => {
        for (const count of COUNTS) {
            const scattered = planTrunks(count).filter((t) => !t.hero);
            for (const t of scattered) {
                const label = `trunks(${count}) at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`;
                // Not its middle, and not its flank either.
                expect(inKeepClear(t.x, t.z), label).toBe(false);
                expect(inKeepClear(t.x, t.z, t.radius), label).toBe(false);
                // A trunk within a few metres of the eye would be a wall across the picture: only the two giants are near.
                expect(rangeOf(t.x, t.z), label).toBeGreaterThan(8);
            }
        }
    });

    // The windows are "nothing tall may stand in" them: that holds for the trees placed by hand as
    // for the scattered ones (two of them once stood in the troll's window).
    it('plants no tree by hand inside a window either', () => {
        const inside = planTrunks(0).filter((t) => inKeepClear(t.x, t.z)).map((t) => [t.x, t.z]);
        expect(inside).toEqual([]);
    });

    it('stands no tree between the viewer and either figure, wherever a chain has drawn them', () => {
        for (const count of COUNTS) {
            const trunks = planTrunks(count);
            const hidden = [];
            for (const who of [SPIRIT, TROLL]) {
                const name = who === SPIRIT ? 'the spirit' : 'the troll';
                for (const [x, z, t] of wayOf(who, 20)) {
                    trunks.forEach((trunk) => {
                        if (!hides(trunk.x, trunk.z, trunk.radius, [x, z], HALF_WIDTH.get(who))) return;
                        const tree = `the tree at (${trunk.x.toFixed(1)}, ${trunk.z.toFixed(1)})`;
                        hidden.push(`${name} at ${(t * 100).toFixed(0)} % of the way, behind ${tree}`);
                    });
                }
            }
            expect(hidden, `trunks(${count})`).toEqual([]);
        }
    });

    it('stands no tree across the moon', () => {
        for (const count of COUNTS) {
            for (const t of planTrunks(count)) {
                const apart = Math.abs(azimuthOf(t.x, t.z) - MOON.azimuth);
                const halfWidth = Math.atan2(t.radius, rangeOf(t.x, t.z));
                const label = `trunks(${count}) at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`;
                expect(apart, label).toBeGreaterThan(MOON.radius + halfWidth);
            }
        }
    });
});

describe('stillwater plan: boulders', () => {
    const COUNTS = countsFor('boulders', [8]);

    it('lays the spirit\'s stone first, its top where she stands', () => {
        for (const count of [0, ...COUNTS]) {
            const [stone] = planBoulders(count);
            expect(stone.hero).toBe(true);
            expect(stone.x).toBe(SPIRIT.home[0]);
            expect(stone.z).toBe(SPIRIT.home[2]);
            // (The stone's mesh is lumpy, not a sphere: its top is STONE_TOP of its planned height above its
            // middle. The meshes test measures the top of the stone as it is really laid.)
            expect(STONE_TOP).toBeGreaterThan(0.5);
            expect(STONE_TOP).toBeLessThanOrEqual(1);
            expect(Math.abs(stone.y + stone.size[1] * STONE_TOP - SPIRIT.home[1])).toBeLessThan(0.02);
            // She stands above the water on it, and it stands in the water's edge.
            expect(SPIRIT.home[1]).toBeGreaterThan(0);
            expect(stone.y - stone.size[1] * STONE_TOP).toBeLessThan(0);
            // Low and flat-topped: wider than it is high, and wide enough to stand on.
            expect(stone.flat).toBeTruthy();
            expect(stone.size[0]).toBeGreaterThan(stone.size[1]);
            expect(stone.size[2]).toBeGreaterThan(stone.size[1]);
            expect(Math.min(stone.size[0], stone.size[2])).toBeGreaterThan(0.4);
        }
    });

    it('gives the troll a seat at his back, off his track', () => {
        const stones = planBoulders(0);
        const seats = stones.filter((b) => b.hero && Math.hypot(b.x - TROLL.home[0], b.z - TROLL.home[2]) < 3);
        expect(seats.length).toBeGreaterThanOrEqual(1);
        for (const seat of seats) {
            // Behind him as the viewer sees him, and further from the water than he sits.
            expect(rangeOf(seat.x, seat.z)).toBeGreaterThan(rangeOf(TROLL.home[0], TROLL.home[2]));
            expect(shoreDistance(seat.x, seat.z)).toBeGreaterThan(shoreDistance(TROLL.home[0], TROLL.home[2]));
            // His way down to the water is not through it.
            for (const [x, z, t] of wayOf(TROLL, 10)) {
                if (t === 0) continue;
                const apart = Math.hypot(seat.x - x, seat.z - z);
                expect(apart, `${(t * 100).toFixed(0)} % of his way`).toBeGreaterThan(seat.size[0] * 0.9);
            }
        }
    });

    it('lies every stone at the water\'s edge or just off it, none on another, none on the troll\'s way', () => {
        for (const count of COUNTS) {
            const stones = planBoulders(count);
            const byHand = stones.filter((b) => b.hero).length;
            expect(stones.slice(0, byHand).every((b) => b.hero)).toBe(true);
            stones.forEach((b, i) => {
                const label = `boulders(${count})[${i}] at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`;
                expect(b.size, label).toHaveLength(3);
                for (const s of b.size) expect(s, label).toBeGreaterThan(0);
                // Within a few metres of the edge: these are the shore's stones.
                expect(Math.abs(shoreDistance(b.x, b.z)), label).toBeLessThan(6);
                // Its middle is in the ground or under the water: it lies, it does not hover.
                expect(b.y - b.size[1], label).toBeLessThan(Math.max(groundHeight(b.x, b.z), 0));
                if (b.hero) return;
                expect(trollTrack(b.x, b.z).weight, label).toBe(0);
                // Not under the viewer's feet, and not on the spirit's own stone.
                expect(rangeOf(b.x, b.z), label).toBeGreaterThan(2);
                const fromHers = Math.hypot(b.x - stones[0].x, b.z - stones[0].z);
                expect(fromHers, label).toBeGreaterThan(stones[0].size[0] + b.size[0]);
                for (let j = 0; j < i; j++) {
                    const apart = Math.hypot(b.x - stones[j].x, b.z - stones[j].z);
                    expect(apart, `${label} and [${j}]`).toBeGreaterThan(b.size[0] + stones[j].size[0]);
                }
            });
        }
    });

    it('lays no stone where it would hide either figure', () => {
        const stones = planBoulders(COUNTS[COUNTS.length - 1]);
        const hidden = [];
        for (const who of [SPIRIT, TROLL]) {
            for (const [x, z, t] of wayOf(who, 20)) {
                stones.forEach((b, i) => {
                    // A stone hides what stands behind it only as high as it is: the figures' upper halves must show.
                    const top = b.y + b.size[1];
                    const feet = lerp(who.home[1], who.reach[1], t);
                    const sight = EYE.y + ((feet + who.height * 0.5 - EYE.y) * rangeOf(b.x, b.z)) / rangeOf(x, z);
                    if (top <= sight) return;
                    if (hides(b.x, b.z, b.size[0], [x, z], HALF_WIDTH.get(who))) hidden.push(`${i} at ${t}`);
                });
            }
        }
        expect(hidden).toEqual([]);
    });
});

describe('stillwater plan: what grows on the water', () => {
    it('floats every lily pad on open water, off both banks, none on another', () => {
        for (const count of countsFor('lilies', [3])) {
            const pads = planLilies(count);
            for (const pad of pads) {
                const label = `lilies(${count}) at (${pad.x.toFixed(1)}, ${pad.z.toFixed(1)})`;
                // The whole pad, not just its middle.
                expect(shoreDistance(pad.x, pad.z), label).toBeLessThan(-pad.size);
                expect(pad.side, label).toBe(pad.x < 0 ? -1 : 1);
                expect(Math.sign(pad.x), label).toBe(pad.side);
                expect(pad.size, label).toBeGreaterThan(0);
                expect(pad.size, label).toBeLessThan(1);
                expect([0, 1], label).toContain(pad.flower);
            }
            expect(gaps(pads, (pad) => pad.size), `lilies(${count})`).toBeGreaterThanOrEqual(0);
            if (count < 10) continue;
            // Rafts off both banks, and flowers among them on both sides (a chain opens them).
            for (const side of [-1, 1]) {
                const own = pads.filter((pad) => pad.side === side).length;
                expect(own, `lilies(${count}), side ${side}`).toBeGreaterThan(count / 5);
            }
            expect(pads.filter((pad) => pad.flower).length, `lilies(${count})`).toBeGreaterThanOrEqual(2);
            expect(pads.filter((pad) => !pad.flower).length, `lilies(${count})`).toBeGreaterThan(count / 3);
        }
    });

    it('leaves the middle of the tarn to the board: no pad lies behind the card', () => {
        const pads = planLilies(countsFor('lilies').at(-1));
        for (const pad of pads) expect(Math.abs(pad.x)).toBeGreaterThan(1);
    });

    it('stands the reeds in the shallows along the edge, none under the viewer\'s nose', () => {
        for (const count of countsFor('reeds', [60])) {
            const reeds = planReeds(count);
            const stone = planBoulders(0)[0];
            for (const reed of reeds) {
                const label = `reeds(${count}) at (${reed.x.toFixed(1)}, ${reed.z.toFixed(1)})`;
                expect(Math.abs(shoreDistance(reed.x, reed.z)), label).toBeLessThan(1.5);
                // (The plan's own limit: a blade a metre off is a bar across the picture.)
                expect(rangeOf(reed.x, reed.z), label).toBeGreaterThanOrEqual(7.5);
                expect(reed.height, label).toBeGreaterThan(0);
                expect(reed.height, label).toBeLessThan(SPIRIT.height); // they do not hide her
                // Rooted in the ground, or in the bed where it is not deep.
                expect(reed.y, label).toBeGreaterThanOrEqual(groundHeight(reed.x, reed.z) - 1e-9);
                expect(reed.y, label).toBeLessThanOrEqual(Math.max(groundHeight(reed.x, reed.z), 0) + 1e-9);
                // Its tip is out of the water.
                expect(reed.y + reed.height, label).toBeGreaterThan(0);
                expect(Math.abs(reed.lean), label).toBeLessThan(0.5);
                // None grows through the spirit's stone, none where the troll comes down.
                expect(Math.hypot(reed.x - stone.x, reed.z - stone.z), label).toBeGreaterThan(stone.size[0]);
                expect(trollTrack(reed.x, reed.z).weight, label).toBeLessThanOrEqual(0.5);
            }
            if (count >= 100) {
                // They grow in clumps along both banks.
                expect(reeds.some((reed) => reed.x < 0)).toBe(true);
                expect(reeds.some((reed) => reed.x > 0)).toBe(true);
                expect(reeds.length).toBeGreaterThan(count * 0.9);
            }
        }
    });
});

describe('stillwater plan: what grows on the banks', () => {
    it('roots every fern, sapling and glowing cap in the ground of the bank', () => {
        const made = [
            ...countsFor('ferns', [30]).map((count) => ['ferns', count, planFerns(count)]),
            ...countsFor('saplings', [30]).map((count) => ['saplings', count, planSaplings(count)]),
            ...countsFor('caps', [30]).map((count) => ['caps', count, planCaps(count)]),
        ];
        for (const [name, count, plan] of made) {
            for (const item of plan) {
                const label = `${name}(${count}) at (${item.x.toFixed(1)}, ${item.z.toFixed(1)})`;
                expect(shoreDistance(item.x, item.z), label).toBeGreaterThan(0);
                expect(item.y, label).toBeCloseTo(groundHeight(item.x, item.z), 9);
                expect(item.y, label).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('keeps the ferns and the saplings off the viewer and off the troll\'s way', () => {
        for (const fern of planFerns(countsFor('ferns').at(-1))) {
            expect(fern.size).toBeGreaterThan(0);
            expect(rangeOf(fern.x, fern.z)).toBeGreaterThan(1.5);
            expect(trollTrack(fern.x, fern.z).weight).toBeLessThanOrEqual(0.3);
        }
        for (const count of countsFor('saplings', [30])) {
            const saplings = planSaplings(count);
            const hidden = [];
            for (const s of saplings) {
                const label = `saplings(${count}) at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`;
                expect(s.height, label).toBeGreaterThan(0);
                expect(s.width, label).toBeGreaterThan(0);
                expect(trollTrack(s.x, s.z).weight, label).toBe(0);
                // A young spruce close to the eye would fill the frame: they keep their distance.
                expect(rangeOf(s.x, s.z), label).toBeGreaterThan(6);
                // None in a window of the view while it is near enough to matter.
                if (rangeOf(s.x, s.z) < 30) expect(inKeepClear(s.x, s.z), label).toBe(false);
                // (A sapling's skirt is about a fifth of its height to either side.)
                const half = s.height * 0.2 * s.width;
                for (const who of [SPIRIT, TROLL]) {
                    const name = who === SPIRIT ? 'the spirit' : 'the troll';
                    for (const [x, z, t] of wayOf(who, 20)) {
                        const behind = hides(s.x, s.z, half, [x, z], HALF_WIDTH.get(who));
                        if (behind) hidden.push(`${label} hides ${name} at ${t}`);
                    }
                }
                // None stands across the moon.
                const range = rangeOf(s.x, s.z);
                const tall = Math.atan2(s.y + s.height - EYE.y, range) > MOON.elevation - MOON.radius;
                const across = Math.abs(azimuthOf(s.x, s.z) - MOON.azimuth) < MOON.radius + Math.atan2(half, range);
                expect(tall && across, label).toBe(false);
            }
            expect(hidden, `saplings(${count})`).toEqual([]);
        }
    });

    it('orders the caps on each bank from the frame\'s edge in toward the board', () => {
        for (const count of countsFor('caps', [1, 2, 3, 7])) {
            const caps = planCaps(count);
            for (const side of [-1, 1]) {
                const mine = caps.filter((cap) => cap.side === side);
                const label = `caps(${count}), side ${side}`;
                for (const cap of mine) {
                    expect(Math.sign(cap.x), label).toBe(side);
                    expect(cap.order, label).toBeGreaterThanOrEqual(0);
                    expect(cap.order, label).toBeLessThanOrEqual(1);
                    expect(cap.size, label).toBeGreaterThan(0);
                }
                if (mine.length < 2) continue;
                const orders = mine.map((cap) => cap.order).sort((a, b) => a - b);
                // The chain lights them one after another, the first with its first step and the last with its last.
                expect(orders[0], label).toBe(0);
                expect(orders[orders.length - 1], label).toBe(1);
                expect(new Set(orders).size, label).toBe(orders.length);
                for (let i = 1; i < orders.length; i++) {
                    expect(orders[i] - orders[i - 1], label).toBeCloseTo(1 / (orders.length - 1), 9);
                }
                // Outside in: a cap later in the order stands nearer the middle of the frame.
                const inward = [...mine].sort((a, b) => a.order - b.order)
                    .map((cap) => Math.abs(azimuthOf(cap.x, cap.z)));
                for (let i = 1; i < inward.length; i++) {
                    expect(inward[i], label).toBeLessThanOrEqual(inward[i - 1] + 1e-12);
                }
            }
            if (count >= 20) {
                // Drifts on both banks.
                expect(caps.filter((cap) => cap.side < 0).length).toBeGreaterThan(count / 5);
                expect(caps.filter((cap) => cap.side > 0).length).toBeGreaterThan(count / 5);
            }
        }
    });
});

describe('stillwater plan: eyes in the far wood', () => {
    it('opens them in the order of their rank, none behind the card and none in the moon\'s gap', () => {
        for (const pairs of countsFor('eyes', [1, 2, 5])) {
            const eyes = planEyes(pairs);
            eyes.forEach((eye, i) => {
                const label = `eyes(${pairs})[${i}]`;
                const az = azimuthOf(eye.x, eye.z);
                expect(eye.rank, label).toBeGreaterThanOrEqual(0);
                expect(eye.rank, label).toBeLessThanOrEqual(1);
                if (eyes.length > 1) expect(eye.rank, label).toBeCloseTo(i / (eyes.length - 1), 12);
                // (The plan's own limit: the card covers the middle of the far shore.)
                expect(Math.abs(az), label).toBeGreaterThanOrEqual(9.5 * DEG - 1e-9);
                // Not in the gap the far wood leaves for the moon.
                expect(Math.abs(az - MOON.azimuth), label).toBeGreaterThanOrEqual(4 * DEG - 1e-9);
                // Between the far trunks: on land, a good way off, above the ground and below the tree tops.
                expect(shoreDistance(eye.x, eye.z), label).toBeGreaterThan(0);
                expect(rangeOf(eye.x, eye.z), label).toBeGreaterThan(20);
                const above = eye.y - groundHeight(eye.x, eye.z);
                expect(above, label).toBeGreaterThan(0.3);
                expect(above, label).toBeLessThan(5);
                expect(eye.size, label).toBeGreaterThan(0);
                // Two eyes, apart: the gap between them is wider than either.
                expect(eye.gap, label).toBeGreaterThan(eye.size);
            });
            // No two pairs on one bearing.
            const bearings = eyes.map((eye) => azimuthOf(eye.x, eye.z)).sort((a, b) => a - b);
            for (let i = 1; i < bearings.length; i++) expect(bearings[i] - bearings[i - 1]).toBeGreaterThan(0.5 * DEG);
            if (eyes.length >= 10) {
                // The wood watches from both sides.
                expect(eyes.some((eye) => eye.x < 0)).toBe(true);
                expect(eyes.some((eye) => eye.x > 0)).toBe(true);
            }
        }
    });

    // The 16:9 frame the game is composed for shows ±34° (EYE.hFov / 2) and the camera all but
    // never turns: a pair planned outside it is never seen there, yet takes its turn in the order
    // a chain opens them (3 of the 28 once were).
    it('plans every pair inside the 16:9 frame', () => {
        const edge = halfWidthTan(16 / 9);
        for (const pairs of countsFor('eyes')) {
            const outside = planEyes(pairs)
                .filter((eye) => Math.abs(Math.tan(azimuthOf(eye.x, eye.z))) > edge)
                .map((eye) => (azimuthOf(eye.x, eye.z) / DEG).toFixed(1));
            expect(outside, `eyes(${pairs})`).toEqual([]);
        }
    });
});

describe('stillwater plan: the shore map', () => {
    const { size, span } = SHORE_MAP;
    const map = bakeShoreMap();
    /** The byte the water reads at a stage point (the texel it falls in). */
    const texel = (x, z) => {
        const i = Math.max(0, Math.min(size - 1, Math.floor(((x - STAGE.x0) / (STAGE.x1 - STAGE.x0)) * size)));
        const j = Math.max(0, Math.min(size - 1, Math.floor(((z - STAGE.z0) / (STAGE.z1 - STAGE.z0)) * size)));
        return map[(j * size + i) * 4];
    };

    it('is size × size × 4 bytes, grey, and opaque', () => {
        expect(Object.isFrozen(SHORE_MAP)).toBe(true);
        expect(span).toBeGreaterThan(0);
        expect(map).toBeInstanceOf(Uint8Array);
        expect(map).toHaveLength(size * size * 4);
        let odd = 0;
        for (let o = 0; o < map.length; o += 4) {
            if (map[o] !== map[o + 1] || map[o] !== map[o + 2] || map[o + 3] !== 255) odd += 1;
        }
        expect(odd).toBe(0);
        // Any size can be baked, and the same map comes out every time.
        expect(bakeShoreMap(32)).toHaveLength(32 * 32 * 4);
        expect(Array.from(bakeShoreMap(32))).toEqual(Array.from(bakeShoreMap(32)));
    });

    it('is mid-grey on the water\'s edge, darker out on the water, lighter on the land', () => {
        // A texel is this many metres across: the edge can be half of one off.
        const cell = Math.max((STAGE.x1 - STAGE.x0) / size, (STAGE.z1 - STAGE.z0) / size);
        const slack = Math.ceil((cell / (span * 2)) * 255 * 2) + 1;
        for (const p of shorePoints(40)) {
            const label = `the edge at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;
            expect(Math.abs(texel(p.x, p.z) - 127.5), label).toBeLessThanOrEqual(slack);
            // A metre and a half either way it is clearly one or the other.
            expect(texel(p.x - p.out[0] * 1.5, p.z - p.out[1] * 1.5), label).toBeLessThan(texel(p.x, p.z));
            expect(texel(p.x + p.out[0] * 1.5, p.z + p.out[1] * 1.5), label).toBeGreaterThan(texel(p.x, p.z));
        }
        expect(texel(MID[0], MID[1])).toBe(0);
        expect(texel(STAGE.x0 + 1, STAGE.z0 + 1)).toBe(255);
        expect(texel(EYE.x, EYE.z)).toBeGreaterThan(128);
        expect(texel(SPIRIT.reach[0], SPIRIT.reach[2])).toBeLessThan(127);
        expect(texel(TROLL.home[0], TROLL.home[2])).toBeGreaterThan(128);
    });

    it('holds the signed distance in metres, as the water reads it back', () => {
        // The water turns a texel back into metres with (value − 0.5) · 2 · span.
        let checked = 0;
        for (let j = 0; j < size; j += 5) {
            const z = lerp(STAGE.z0, STAGE.z1, (j + 0.5) / size);
            for (let i = 0; i < size; i += 5) {
                const x = lerp(STAGE.x0, STAGE.x1, (i + 0.5) / size);
                const d = shoreDistance(x, z);
                const read = (map[(j * size + i) * 4] / 255 - 0.5) * 2 * span;
                const quantum = (2 * span) / 255;
                const label = `texel ${i}, ${j}`;
                if (Math.abs(d) < span - quantum) expect(Math.abs(read - d), label).toBeLessThanOrEqual(quantum);
                else expect(Math.sign(read), label).toBe(Math.sign(d));
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(1000);
    });
});
