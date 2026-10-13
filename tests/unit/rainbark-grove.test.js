/**
 * Rainbark — the grove plan (planGrove), the rest lens's screen maths, the records' CPU axis and
 * silhouette, and the limbs, on the CPU. Relations, not tuning numbers: the seeded rules of §2.3
 * (spacing, keep-outs, the diagonal's density, ranks and their depths), determinism, a lower
 * tier's grove inside a higher one's, and the silhouette maths agreeing with a real camera.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CANOPY_Y,
    GROVE_AISLE,
    GROVE_CARD_MARGIN,
    GROVE_FRAMES,
    GROVE_HUD_MARGIN,
    GROVE_LANE,
    GROVE_OPEN_AIR,
    GROVE_RANKS,
    GROVE_SEPARATION,
    GROVE_SISTERS,
    GROVE_SPACING,
    HERO_REF_Y,
    HERO_TRUNKS,
    LIMB_GROUP,
    LIMB_SHAPE,
    LIMB_TIP_OVER,
    REST_HIDDEN,
    TRUNK_STRIDE,
    eyeRow,
    fallbackCard,
    fallbackHud,
    groveAisle,
    groveCounts,
    lensRow,
    limbCurve,
    limbRecord,
    mulberry32,
    planGrove,
    projectRest,
    recordAxis,
    restLens,
    trunkBowAzimuth,
    trunkRecord,
    trunkSpan,
    viewFov,
    viewPitch,
} from '../../src/themes/rainbark/rainbark-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/rainbark/rainbark-quality.js';
import { fovForAspect, pitchForAspect } from '../../src/themes/rainbark/rainbark-world.js';
import { trunkSurface } from '../../src/themes/rainbark/rainbark-trunks.js';
import { fallbackLayout } from '../../src/themes/rainbark/rainbark-composition.js';

const WORLD_SEED = 0x6364;
const DEG = Math.PI / 180;
const lens = restLens(16 / 9);
const card = fallbackCard(1920, 1080);
const rows = [card.y0, (card.y0 + card.y1) / 2, card.y1];

/** A trunk's widest screen-x span over the card's rows at the 16:9 fallback (level 4). */
function spanOverCard(trunk) {
    const record = trunkRecord(trunk, trunk.seed, new Float32Array(TRUNK_STRIDE), 0, HERO_REF_Y);
    const s = [0, 0];
    let lo = Infinity;
    let hi = -Infinity;
    rows.forEach((sy) => {
        trunkSpan(record, lens, sy, HERO_REF_Y, 0, s);
        lo = Math.min(lo, s[0]);
        hi = Math.max(hi, s[1]);
    });
    return [lo, hi];
}
const overlaps = (s, [a, b]) => s[1] > a && s[0] < b;

/** A camera posed as the rig's rest view of an aspect, at an eye height. */
function restCamera(aspect, eyeY) {
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, 0.3, 3000);
    camera.position.set(0, eyeY, 0);
    camera.rotation.set(pitchForAspect(aspect) * DEG, 0, 0);
    camera.updateMatrixWorld();
    return camera;
}

describe('Rainbark grove: the rest lens', () => {
    it('is the camera rig\'s own lens, from a tall phone to 21:9', () => {
        for (const aspect of [0.46, 1, 16 / 9, 2.37]) {
            expect(viewFov(aspect)).toBeCloseTo(fovForAspect(aspect), 9);
            expect(viewPitch(aspect)).toBeCloseTo(pitchForAspect(aspect), 9);
            const l = restLens(aspect);
            expect(l.tanV).toBeCloseTo(Math.tan((viewFov(aspect) * DEG) / 2), 9);
            expect(l.tanH).toBeCloseTo(l.tanV * aspect, 9);
            // The eye's own height shows below the middle of a frame pitched up, where nothing rises.
            expect(eyeRow(l)).toBeGreaterThan(0.5);
            expect(lensRow(l, eyeRow(l)).rise).toBeCloseTo(0, 9);
            // Rows above it look up, and verticals converge toward the top.
            expect(lensRow(l, 0.1).rise).toBeGreaterThan(0);
            expect(lensRow(l, 0.1).scale).toBeLessThan(lensRow(l, 0.9).scale);
        }
    });

    it('measures a trunk\'s span on a screen row as the camera projects it', () => {
        for (const [aspect, eyeY] of [[16 / 9, 56], [0.46, 20], [2.37, 152]]) {
            const camera = restCamera(aspect, eyeY);
            const l = restLens(aspect);
            for (const trunk of HERO_TRUNKS) {
                const record = trunkRecord(trunk, 7, new Float32Array(TRUNK_STRIDE), 0, eyeY);
                for (const sy of [0.2, 0.5, 0.8]) {
                    const [x0, x1] = trunkSpan(record, l, sy, eyeY, 0, [0, 0]);
                    if (!Number.isFinite(x0) || x1 < -0.5 || x0 > 1.5) continue;
                    // Where each line of the bark up the trunk crosses this row (found by bisection).
                    const xs = [];
                    const v = new THREE.Vector3();
                    let low = Infinity;
                    for (let i = 0; i < 360; i++) {
                        let lo = 0;
                        let hi = 1;
                        const rowOf = (h) => {
                            const p = trunkSurface(record, i / 360, h).position;
                            v.set(p[0], p[1], p[2]).project(camera);
                            return (1 - v.y) / 2;
                        };
                        if (!(rowOf(0) >= sy && rowOf(1) <= sy)) continue;
                        for (let k = 0; k < 40; k++) {
                            const mid = (lo + hi) / 2;
                            if (rowOf(mid) > sy) lo = mid;
                            else hi = mid;
                        }
                        rowOf((lo + hi) / 2);
                        low = Math.min(low, trunkSurface(record, i / 360, (lo + hi) / 2).position[1]);
                        if (v.z < 1) xs.push((v.x + 1) / 2);
                    }
                    if (xs.length < 8) continue;
                    // The span bounds the bare bole (the CPU surface has no flutes or fins) and is no
                    // wider than the flutes' and the buttress fins' swell (the fins flare low down).
                    expect(Math.min(...xs), `${trunk.name} @${aspect}`).toBeGreaterThan(x0 - 0.004);
                    expect(Math.max(...xs), `${trunk.name} @${aspect}`).toBeLessThan(x1 + 0.004);
                    const radius = recordAxis(record, low)[2];
                    const fins = record[6] * Math.exp(-Math.max(low, 0) / record[7]);
                    const swell = (radius * 1.03 + fins) / radius;
                    const seen = Math.max(...xs) - Math.min(...xs);
                    expect((x1 - x0) / seen, `${trunk.name} @${aspect} row ${sy}`).toBeLessThan(swell + 0.03);
                }
            }
        }
    });

    it('pivots a record at any storey: its axis passes through the table\'s (x, z) there, its shape unchanged', () => {
        const trunk = HERO_TRUNKS.find((t) => t.name === 'Sister One');
        const a = trunkRecord(trunk, 11, new Float32Array(TRUNK_STRIDE), 0, 20);
        const b = trunkRecord(trunk, 11, new Float32Array(TRUNK_STRIDE), 0, 152);
        for (const [record, y] of [[a, 20], [b, 152]]) {
            const [x, z] = recordAxis(record, y);
            expect(x).toBeCloseTo(trunk.x, 4);
            expect(z).toBeCloseTo(trunk.z, 4);
        }
        // The same radius, taper, height and lean: only the base moved.
        [2, 3, 4, 5, 8, 9, 10].forEach((i) => expect(b[i]).toBeCloseTo(a[i], 6));
        expect(recordAxis(a, HERO_REF_Y)[2]).toBeCloseTo(trunk.radius, 4);
        // The CPU axis is the vertex stage's spine (trunkSurface's twin).
        const at = trunkSurface(a, 0, 0.5);
        expect(recordAxis(a, at.position[1])[0]).toBeCloseTo(at.spine[0], 4);
        expect(recordAxis(a, at.position[1])[1]).toBeCloseTo(at.spine[1], 4);
    });
});

describe('Rainbark grove: the plan', () => {
    it('lays the same grove for the same seed, another for another, and each tier\'s inside a higher one\'s', () => {
        const a = planGrove(WORLD_SEED, QUALITY.High);
        expect(JSON.stringify(planGrove(WORLD_SEED, QUALITY.High))).toBe(JSON.stringify(a));
        expect(JSON.stringify(planGrove(WORLD_SEED + 1, QUALITY.High).trunks)).not.toBe(JSON.stringify(a.trunks));
        // The heroes' seeds are the world's first draws (the bark the Elder shows is the A1 pick).
        const rand = mulberry32(WORLD_SEED);
        a.heroes.forEach(({ trunk, seed }, i) => {
            expect(trunk).toBe(HERO_TRUNKS[i]);
            expect(seed).toBe(1 + Math.floor(rand() * 999));
        });
        let lower = null;
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const plan = planGrove(WORLD_SEED, tier);
            const counts = groveCounts(tier);
            // R1c and R1d first, then the ranks' counts, the tier's limbs.
            expect(plan.trunks.slice(0, 2).map((t) => t.name)).toEqual(['R1c', 'R1d']);
            expect(plan.trunks.length).toBe(2 + counts.reduce((s, n) => s + n, 0));
            GROVE_RANKS.forEach((rule, r) => {
                expect(plan.trunks.filter((t) => t.rank === rule.rank)).toHaveLength(counts[r]);
            });
            // At most the tier's limbs (a far trunk's limb that cannot read as a branch is not
            // grown), and the heroes' always.
            expect(plan.limbs.length).toBeLessThanOrEqual(tier.limbs);
            expect(plan.limbs.length).toBeGreaterThanOrEqual(Math.min(tier.limbs, 6));
            // Every far trunk a tier stands, a higher tier stands too, in the same place.
            if (lower) {
                const here = new Map(plan.trunks.map((t) => [t.name, t]));
                lower.trunks.forEach((t) => {
                    expect(here.get(t.name), `${quality} ⊃ ${t.name}`).toBeTruthy();
                    expect(here.get(t.name).x).toBe(t.x);
                });
            }
            lower = plan;
        }
        // R4 from Medium up; the deepest rank only where the tier has trunks to spare.
        expect(groveCounts(QUALITY.Low)[2]).toBe(0);
        expect(groveCounts(QUALITY.Medium)[2]).toBeGreaterThan(0);
        expect(groveCounts(QUALITY.High)[3]).toBe(0);
        expect(groveCounts(QUALITY.Extreme)[3]).toBeGreaterThan(0);
    });

    it('stands every trunk in its rank\'s depth and girth, clear of the others by GROVE_SPACING·(Ra + Rb)', () => {
        for (const seed of [WORLD_SEED, 1, 2, 3]) {
            const plan = planGrove(seed, QUALITY.Extreme);
            const all = [...HERO_TRUNKS.filter((t) => t.code > 0), ...plan.trunks];
            plan.trunks.forEach((t) => {
                const rule = GROVE_RANKS.find((r) => r.rank === t.rank);
                if (!rule) return;
                expect(-t.z).toBeGreaterThanOrEqual(rule.depth[0]);
                expect(-t.z).toBeLessThanOrEqual(rule.depth[1]);
                expect(t.radius).toBeGreaterThanOrEqual(rule.radius[0]);
                expect(t.radius).toBeLessThanOrEqual(rule.radius[1]);
                expect(t.top).toBeGreaterThan(CANOPY_Y);
                expect(t.fins).toBeGreaterThanOrEqual(3);
                expect(t.fins).toBeLessThanOrEqual(5);
                expect(t.finHeight).toBeGreaterThanOrEqual(8);
                expect(t.finHeight).toBeLessThanOrEqual(14);
                expect(Number.isInteger(t.seed) && t.seed > 0 && t.seed < 1000).toBe(true);
                // The far group (its patches barely cycle: the far grove never twinkles).
                expect(t.group).toBe(rule.group);
                expect(t.group).toBe(3);
            });
            for (let i = 0; i < all.length; i++) {
                for (let j = i + 1; j < all.length; j++) {
                    const d = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
                    expect(d, `${all[i].name}–${all[j].name}`).toBeGreaterThanOrEqual(
                        GROVE_SPACING * (all[i].radius + all[j].radius) - 1e-9,
                    );
                }
            }
        }
    });

    it('keeps R2 out of the card band and the aisle, R3 out of the aisle with two behind the card at most', () => {
        for (const seed of [WORLD_SEED, 5, 6, 7]) {
            const plan = planGrove(seed, QUALITY.Extreme);
            const band = [card.x0 - GROVE_CARD_MARGIN, card.x1 + GROVE_CARD_MARGIN];
            let behind = 0;
            plan.trunks.forEach((t) => {
                const s = spanOverCard(t);
                if (t.rank === 2) expect(overlaps(s, band), t.name).toBe(false);
                if (t.rank === 2 || t.rank === 3) {
                    expect(overlaps(s, GROVE_AISLE), t.name).toBe(false);
                    expect(overlaps(s, GROVE_SISTERS), t.name).toBe(false);
                }
                // No rank stands in the open air beside the HUD or between the Sisters.
                GROVE_OPEN_AIR.forEach((air) => expect(overlaps(s, air), t.name).toBe(false));
                if (t.rank === 3 && overlaps(s, band)) behind += 1;
            });
            expect(behind).toBeLessThanOrEqual(2);
            // Both near ranks keep out of the aisle; only R2 out of the card band.
            expect(GROVE_RANKS[0].aisle && GROVE_RANKS[1].aisle).toBe(true);
            expect(GROVE_RANKS[0].keepOut).toBe(true);
        }
    });

    it('stands no R1 or R2 trunk under the HUD or in the aisle, at the 16:9 and the 21:9 fallback', () => {
        for (const aspect of GROVE_FRAMES) {
            const W = aspect * 1080;
            const frameCard = fallbackCard(W, 1080);
            const hud = fallbackHud(W, 1080);
            const frameLens = restLens(aspect);
            const frameRows = [frameCard.y0, (frameCard.y0 + frameCard.y1) / 2, frameCard.y1];
            // The fallback HUD is the stylesheet's (§2.2's table) and the composition's own.
            expect(fallbackLayout(W, 1080).hud).toEqual(hud);
            const want = aspect === 16 / 9 ? [0.635, 0.708] : [0.602, 0.656];
            expect(hud.x0).toBeCloseTo(want[0], 3);
            expect(hud.x1).toBeCloseTo(want[1], 2);
            // The aisle: from the card band to the HUD's far side (the whole literal band at 16:9).
            const aisle = groveAisle(frameCard, hud, aspect);
            expect(aisle[0]).toBeLessThanOrEqual(Math.min(frameCard.x1 + GROVE_CARD_MARGIN, hud.x0 - GROVE_HUD_MARGIN));
            expect(aisle[1]).toBeGreaterThanOrEqual(hud.x1 + GROVE_HUD_MARGIN);
            if (aspect === 16 / 9) expect(aisle[0] <= 0.61 && aisle[1] >= 0.72).toBe(true);
            for (const seed of [WORLD_SEED, 5, 6, 7, 8]) {
                const plan = planGrove(seed, QUALITY.Extreme);
                plan.trunks.filter((t) => t.rank <= 2).forEach((t) => {
                    const record = trunkRecord(t, t.seed, new Float32Array(TRUNK_STRIDE), 0, HERO_REF_Y);
                    const s = [Infinity, -Infinity];
                    frameRows.forEach((sy) => {
                        const [a, b] = trunkSpan(record, frameLens, sy, HERO_REF_Y, 0, [0, 0]);
                        s[0] = Math.min(s[0], a);
                        s[1] = Math.max(s[1], b);
                    });
                    const where = `${aspect.toFixed(2)} ${seed} ${t.name} ${s[0].toFixed(3)}–${s[1].toFixed(3)}`;
                    expect(overlaps(s, aisle), where).toBe(false);
                    expect(overlaps(s, [hud.x0 - GROVE_HUD_MARGIN, hud.x1 + GROVE_HUD_MARGIN]), where).toBe(false);
                    if (aspect === 16 / 9) expect(overlaps(s, GROVE_AISLE), where).toBe(false);
                });
            }
        }
    });

    it('stands what a 16:9 frame shows apart: each rank its own silhouette, and R2 in the left lane', () => {
        for (const quality of ['Minimal', 'High', 'Extreme']) {
            const plan = planGrove(WORLD_SEED, QUALITY[quality]);
            const record = new Float32Array(TRUNK_STRIDE);
            const seen = [];
            [...plan.heroes.filter(({ trunk }) => !REST_HIDDEN.includes(trunk.name) && trunk.group !== 0)
                .map(({ trunk, seed }) => ({ ...trunk, seed })), ...plan.trunks.filter((t) => t.visible)]
                .forEach((t) => {
                    trunkRecord(t, t.seed, record, 0, HERO_REF_Y);
                    const [x0, x1] = trunkSpan(record, lens, eyeRow(lens), HERO_REF_Y, 0, [0, 0]);
                    if (x1 > 0 && x0 < 1) seen.push([x0, x1, t.name]);
                });
            seen.sort((a, b) => a[0] - b[0]);
            for (let i = 1; i < seen.length; i++) {
                expect(seen[i][0] - seen[i - 1][1], `${quality}: ${seen[i - 1][2]} | ${seen[i][2]}`)
                    .toBeGreaterThanOrEqual(GROVE_SEPARATION - 1e-9);
            }
            // The 70 m rank's first trunk tries the left air lane (it fits there for this seed),
            // so even the smallest tier shows the rank where the grove's mass recedes.
            const lane = plan.trunks.filter((t) => t.rank === 2 && t.visible);
            expect(lane.length, quality).toBeGreaterThan(0);
            const [x0, x1] = spanOverCard(lane[0]);
            expect(x0 >= GROVE_LANE[0] - 0.01 && x1 <= GROVE_LANE[1] + 0.01, quality).toBe(true);
        }
    });

    it('stands the left half of the frame twice as dense as the right: the grove recedes on a diagonal', () => {
        const side = (plan) => {
            let left = 0;
            let right = 0;
            const record = new Float32Array(TRUNK_STRIDE);
            plan.trunks.filter((t) => t.rank >= 2).forEach((t) => {
                trunkRecord(t, t.seed, record, 0, HERO_REF_Y);
                const [x0, x1] = trunkSpan(record, lens, eyeRow(lens), HERO_REF_Y, 0, [0, 0]);
                const c = (x0 + x1) / 2;
                if (c >= 0 && c < 0.5) left += 1;
                else if (c >= 0.5 && c <= 1) right += 1;
            });
            return [left, right];
        };
        for (const quality of ['Medium', 'High', 'Extreme']) {
            const [l, r] = side(planGrove(WORLD_SEED, QUALITY[quality]));
            expect(l, quality).toBeGreaterThanOrEqual(2 * r);
            let left = 0;
            let right = 0;
            for (let seed = 1; seed <= 24; seed++) {
                const [a, b] = side(planGrove(seed, QUALITY[quality]));
                left += a;
                right += b;
            }
            expect(left, quality).toBeGreaterThanOrEqual(2 * right);
        }
    }, 30000);

    it('grows each limb up and out of its parent into the canopy, never at the eye, a hero\'s outward', () => {
        const plan = planGrove(WORLD_SEED, QUALITY.Extreme);
        const parents = new Map([...HERO_TRUNKS, ...plan.trunks].map((t) => [t.name, t]));
        plan.limbs.forEach((limb) => {
            const parent = parents.get(limb.parent);
            expect(parent, limb.parent).toBeTruthy();
            const seed = plan.heroes.find((h) => h.trunk.name === parent.name)?.seed ?? parent.seed;
            const p = trunkRecord(parent, seed, new Float32Array(TRUNK_STRIDE), 0, HERO_REF_Y);
            const r = limbRecord(limb, p);
            // Its base on the parent's spine, thinner than the parent there.
            const axis = recordAxis(p, limb.y);
            expect(r[0]).toBeCloseTo(axis[0], 4);
            expect(r[1]).toBeCloseTo(axis[1], 4);
            expect(r[2]).toBeLessThan(axis[2]);
            // Up and out at 35–55°: it leans by the cotangent, and reaches the canopy.
            const run = Math.hypot(r[8], r[9]);
            expect(run).toBeGreaterThanOrEqual(1 / Math.tan(55 * DEG) - 1e-6);
            expect(run).toBeLessThanOrEqual(1 / Math.tan(35 * DEG) + 1e-6);
            expect(r[4]).toBeCloseTo(limb.y, 4);
            expect(r[5]).toBeGreaterThan(r[4]);
            // Its tip ends on the canopy plane (the tube is clamped there): a limb never ends in
            // open air.
            expect(r[5]).toBeGreaterThanOrEqual(CANOPY_Y - 1e-6);
            expect(r[5]).toBeLessThanOrEqual(CANOPY_Y + LIMB_TIP_OVER + 1e-4);
            expect(limb.length).toBeLessThanOrEqual(40 + 1e-9);
            // The far draw, the parent's group as a limb, no fins: a collar flaring into the bole
            // past where it leaves the bark, its tip at least half its base.
            expect(r[12]).toBe(0);
            expect(r[13]).toBe((parent.group % LIMB_GROUP) + LIMB_GROUP);
            expect(r[2]).toBeLessThanOrEqual(axis[2] * LIMB_SHAPE.base + 1e-6);
            expect(r[6]).toBeCloseTo(r[2] * LIMB_SHAPE.collar, 5);
            expect(r[7]).toBeGreaterThan(axis[2] * Math.tan(35 * DEG));
            expect(1 - r[3]).toBeGreaterThanOrEqual(LIMB_SHAPE.tip - 1e-6);
            expect(LIMB_SHAPE.tip).toBeGreaterThanOrEqual(0.5);
            // A bow toward the vertical: its sag off the chord at most LIMB_SHAPE.bow of its length,
            // its tip never more than LIMB_SHAPE.turn degrees steeper than its foot (no hook upright).
            const span = r[5] - r[4];
            expect(r[10]).toBeCloseTo(limbCurve(limb.length, limb.elevation, limb.lift), 6);
            expect(r[10]).toBeLessThanOrEqual(0);
            expect((Math.abs(r[10]) * span) / 4 / limb.length).toBeLessThanOrEqual(LIMB_SHAPE.bow + 1e-9);
            const tipSlope = run + 2 * r[10];
            expect(tipSlope).toBeGreaterThanOrEqual(1 / Math.tan((limb.elevation + LIMB_SHAPE.turn) * DEG) - 1e-9);
            // So it climbs all the way (its horizontal reach never turns back).
            expect(tipSlope).toBeGreaterThan(0);
            // Its direction is its seed's bow, never toward the eye; a hero's grows outward (but
            // R1a's, between the Elder and the card, may lean either way but back to the Elder).
            const az = trunkBowAzimuth(limb.seed);
            expect(Math.atan2(r[9], r[8])).toBeCloseTo(Math.atan2(Math.sin(az), Math.cos(az)), 4);
            expect(Math.cos(az - Math.atan2(-parent.z, -parent.x))).toBeLessThan(0.3 + 1e-9);
            if (parent.code > 0 && parent.group !== 2 && Math.abs(parent.x) / -parent.z > 0.15) {
                expect(Math.cos(az - (parent.x < 0 ? Math.PI : 0))).toBeGreaterThan(0);
            }
        });
        // No limb grows from a hero the rest frame does not show.
        plan.limbs.forEach((limb) => expect(REST_HIDDEN).not.toContain(limb.parent));
    });

    it('grows hero limbs that read as branches: off the card, off their neighbours, apart from each other', () => {
        const plan = planGrove(WORLD_SEED, QUALITY.Extreme);
        const eye = 128;
        const heroes = new Map(plan.heroes.map(({ trunk, seed }) => [trunk.name, { trunk, seed }]));
        const elder = heroes.get('Elder');
        const elderRecord = trunkRecord(elder.trunk, elder.seed, new Float32Array(TRUNK_STRIDE), 0, eye);
        const paths = [];
        plan.limbs.filter((limb) => heroes.has(limb.parent)).forEach((limb) => {
            const { trunk, seed } = heroes.get(limb.parent);
            const r = limbRecord(limb, trunkRecord(trunk, seed, new Float32Array(TRUNK_STRIDE), 0, eye));
            const pts = [];
            for (let j = 0; j <= 8; j++) {
                const y = r[4] + ((r[5] - r[4]) * j) / 8;
                const [x, z] = recordAxis(r, y);
                const [px, py] = projectRest(lens, x, y, z, eye);
                // What of it the frame shows, or holds just above (it climbs into view over the
                // levels): a limb high over the eye is not a path on screen.
                if (px > -0.2 && px < 1.2 && py > -1.5 && py < 1) pts.push([px, py]);
                // Never across the card (16:9 fallback).
                if (px > 0 && px < 1 && py > 0) {
                    expect(px > card.x0 - 0.02 && px < card.x1 + 0.02 && py > card.y0 - 0.02, limb.parent).toBe(false);
                }
                // R1a's never reach into the Elder.
                if (trunk.name === 'R1a' && py > 0 && py < 1) {
                    expect(px).toBeGreaterThan(trunkSpan(elderRecord, lens, py, eye, 0, [0, 0])[1]);
                }
            }
            if (pts.length > 1) paths.push({ name: limb.parent, pts });
        });
        // No two hero limbs cross in an X on screen.
        const cross = (a, b, c, d) => {
            const side = (p, q, s) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
            return side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0;
        };
        for (let i = 0; i < paths.length; i++) {
            for (let j = i + 1; j < paths.length; j++) {
                const a = paths[i].pts;
                const b = paths[j].pts;
                expect(cross(a[0], a[a.length - 1], b[0], b[b.length - 1]), `${paths[i].name} × ${paths[j].name}`)
                    .toBe(false);
            }
        }
    });
});
