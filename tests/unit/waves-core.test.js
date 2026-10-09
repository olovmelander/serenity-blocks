/**
 * Waves — the shape of the wave, the rays cast at it, its noise, its tiers and its rig.
 *
 * The numbers in waves-core.js are tuned by eye and keep moving, so nothing here names one: the
 * tests read WAVE and assert what must stay true whatever it holds (the lip falls one way, the
 * trough meets the face, a ray's hit is a point of the wave it was cast at).
 *
 * The sweeps collect what is wrong and assert once: an expect a ray is too slow for a busy machine.
 */
import { describe, expect, it } from 'vitest';
import {
    DEG, FLOW, FLOW_SPEED, TAU, WAVE, approach, axisOffset, bakeWaterNoise, castRay, clamp, clamp01, crestDistance,
    floorRow, floorX, landingDistance, lerp, lipAngle, mulberry32, pieceLight, rowAtU, sectionScale, shoulderWeight,
    smooth, surfaceAt, surfaceU, wavePoint,
} from '../../src/themes/waves/waves-core.js';
import { REST_RIG, fovForAspect, viewFor } from '../../src/themes/waves/waves-composition.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/waves/waves-quality.js';
import { WAVES_TETROMINOS } from '../../src/themes/waves/waves-tetrominos.js';

const EYE = REST_RIG.eye;
const OPENINGS = [0, 0.25, 0.5, 0.75, 1];

/** Distances ahead of the eye (negative: behind it): dense through the tube, sparse out to the far end. */
const DISTANCES = [];
for (let d = -WAVE.backReach; d < 40; d += 0.37) DISTANCES.push(d);
for (let d = 40; d < WAVE.aheadReach; d *= 1.3) DISTANCES.push(d);
DISTANCES.push(WAVE.aheadReach);

/** Where the wave is the tube itself: not yet relaxing into the swell, not yet tapering. */
const inTube = (d, open = 0) => shoulderWeight(d, open) === 0 && sectionScale(d, open) === 1;

/** A hit near the viewer, where the wave is the tube castRay takes it for. */
const isNear = (hit, open) => hit.d < 12 && hit.d > -WAVE.backReach && inTube(hit.d, open);

/** A point of the tube's own section: `phi` radians round the ellipse from the foot of the face. */
const sectionPoint = (phi, d) => ({
    x: axisOffset(d) + WAVE.a * Math.sin(phi),
    y: WAVE.b * (1 - Math.cos(phi)),
    z: -d,
});

/** The angle round the section a point of it stands at (0 at the foot, up the face, over the roof). */
const angleRound = (p, d) => {
    const phi = Math.atan2((p.x - axisOffset(d)) / WAVE.a, (WAVE.b - p.y) / WAVE.b);
    return phi < 0 ? phi + TAU : phi;
};

/** A unit direction: `yaw` degrees to the right of the line the eye looks down, `pitch` degrees up. */
const aim = (yaw, pitch) => {
    const c = Math.cos(pitch * DEG);
    return [Math.sin(yaw * DEG) * c, Math.sin(pitch * DEG), -Math.cos(yaw * DEG) * c];
};

/** The unit direction from the rest eye to a point. */
const toward = (p) => {
    const v = [p.x - EYE.x, p.y - EYE.y, p.z - EYE.z];
    const length = Math.hypot(...v);
    return v.map((c) => c / length);
};

const cast = (dir, open = 0) => castRay(EYE.x, EYE.y, EYE.z, dir[0], dir[1], dir[2], open, {});

/** Every direction of a coarse sphere, at every opening. */
function sweep(yawStep = 5, pitchStep = 4) {
    const hits = [];
    for (const open of OPENINGS) {
        for (let yaw = -180; yaw < 180; yaw += yawStep) {
            for (let pitch = -88; pitch <= 88; pitch += pitchStep) {
                const dir = aim(yaw, pitch);
                hits.push({
                    dir, open, hit: cast(dir, open), where: `yaw ${yaw}, pitch ${pitch}, open ${open}`,
                });
            }
        }
    }
    return hits;
}

const HIT_FIELDS = ['t', 'x', 'y', 'z', 'd', 'u', 'r'];
const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const nonIncreasing = (values, slack = 1e-12) => values.every((v, i) => i === 0 || v <= values[i - 1] + slack);
const nonDecreasing = (values, slack = 1e-12) => values.every((v, i) => i === 0 || v >= values[i - 1] - slack);

describe('waves core maths', () => {
    it('clamps, mixes and eases between two edges given in either order', () => {
        expect(clamp(5, 0, 2)).toBe(2);
        expect(clamp(-5, 0, 2)).toBe(0);
        expect(clamp(1.5, 0, 2)).toBe(1.5);
        expect(clamp01(1.4)).toBe(1);
        expect(clamp01(-0.1)).toBe(0);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        expect(smooth(2, 4, 2.5)).toBeCloseTo(0.15625, 12);
        // Falling edges: the same curve, mirrored.
        expect(smooth(1, 0, 0.25)).toBeCloseTo(smooth(0, 1, 0.75), 12);
        expect(smooth(1, 0, 3)).toBe(0);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const value = smooth(0, 1, i / 20);
            expect(value).toBeGreaterThan(previous);
            previous = value;
        }
        expect(DEG * 180).toBeCloseTo(Math.PI, 12);
        expect(TAU).toBeCloseTo(2 * Math.PI, 12);
    });

    it('eases at the same rate whatever the frame time', () => {
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, -1)).toBe(0);
        expect(approach(3, 1e9)).toBe(1);
        // Two half steps leave what one whole step leaves.
        const half = approach(2.2, 1 / 120);
        expect(1 - (1 - half) ** 2).toBeCloseTo(approach(2.2, 1 / 60), 12);
        expect(approach(8, 0.1)).toBeGreaterThan(approach(2, 0.1));
    });

    it('seeds a repeatable generator', () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        const c = mulberry32(8);
        let differs = false;
        for (let i = 0; i < 50; i++) {
            const value = a();
            expect(value).toBe(b());
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
            if (value !== c()) differs = true;
        }
        expect(differs).toBe(true);
    });

    it('turns a piece\'s colour into light of full strength', () => {
        expect(pieceLight('#ff0000')).toEqual([1, 0, 0]);
        // Every piece strikes the water equally hard: the brightest channel is always 1.
        for (const [shape, hex] of Object.entries(WAVES_TETROMINOS.colors)) {
            const light = pieceLight(hex);
            expect(Math.max(...light), shape).toBeCloseTo(1, 12);
            expect(Math.min(...light), shape).toBeGreaterThanOrEqual(0);
        }
        // Scene-linear: a mid grey in a weaker channel falls well below its sRGB share.
        const light = pieceLight('#ff8040');
        expect(light[0]).toBe(1);
        expect(light[1]).toBeCloseTo(((0x80 / 255 + 0.055) / 1.055) ** 2.4, 9);
        expect(light[1]).toBeLessThan(0x80 / 255);
        expect(light[2]).toBeLessThan(light[1]);
        // The hue is the colour's own, however dark it is, and its case does not matter.
        const dim = pieceLight('#402010');
        expect(dim[0]).toBe(1);
        expect(dim[1]).toBeGreaterThan(dim[2]);
        expect(pieceLight('#FF8040')).toEqual(light);
        // Black has no brightest channel: it gives no light, and no NaN.
        // A colour with no light in it cannot be raised to full strength: it gets the fallback.
        expect(pieceLight('#000000')).toEqual([1, 0.93, 0.8]);
        // It writes into what it is given.
        const out = [9, 9, 9];
        expect(pieceLight('#ff8040', out)).toBe(out);
        expect(out).toEqual(light);
    });

    it('gives the same foam white for anything that is not a six-digit hex colour', () => {
        const white = pieceLight(null);
        expect(Math.max(...white)).toBe(1);
        expect(Math.min(...white)).toBeGreaterThan(0);
        const junk = [undefined, '', 'red', '#fff', '#12345', '#1234567', '#gggggg', 'ff8040', 0xff8040, {}, [], NaN];
        for (const value of junk) expect(pieceLight(value), String(value)).toEqual(white);
        // The fallback overwrites what the caller's array held, and a caller with none gets its own.
        const out = [9, 9, 9];
        expect(pieceLight('nope', out)).toBe(out);
        expect(out).toEqual(white);
        expect(pieceLight(null)).not.toBe(pieceLight(null));
    });

    it('carries the water up the face and back toward the eye', () => {
        expect(FLOW.u).toBeGreaterThan(0);
        expect(FLOW.z).toBeGreaterThan(0);
        expect(FLOW_SPEED).toBeCloseTo(Math.hypot(FLOW.u, FLOW.z), 12);
        expect(Object.isFrozen(FLOW)).toBe(true);
        expect(Object.isFrozen(WAVE)).toBe(true);
    });
});

describe('waves shape: the lip along the line', () => {
    it('describes a tube the rest eye is inside of', () => {
        expect(WAVE.a).toBeGreaterThan(0);
        expect(WAVE.b).toBeGreaterThan(0);
        expect(WAVE.rho).toBeGreaterThan(0);
        // The lip feathers at the crest and comes over the top and down where it has landed.
        expect(WAVE.lipCrest).toBeGreaterThan(0);
        expect(WAVE.lipCrest).toBeLessThan(WAVE.lipClosed);
        expect(WAVE.lipClosed).toBeGreaterThan(Math.PI);
        expect(WAVE.lipClosed).toBeLessThan(TAU);
        expect(WAVE.throwLength).toBeGreaterThan(0);
        // The eye: above the trough, inside the ellipse of its own section, at the mesh's z = 0.
        expect(EYE.z).toBe(0);
        expect(EYE.y).toBeGreaterThan(0);
        expect(((EYE.x - axisOffset(0)) / WAVE.a) ** 2 + ((EYE.y - WAVE.b) / WAVE.b) ** 2).toBeLessThan(1);
        expect(WAVE.backReach).toBeGreaterThan(0);
        expect(WAVE.aheadReach).toBeGreaterThan(crestDistance(0));
    });

    it('moves the landing toward the eye as the barrel opens, and the crest with it', () => {
        expect(landingDistance()).toBe(WAVE.landAhead);
        expect(landingDistance(0)).toBe(WAVE.landAhead);
        let previous = landingDistance(0);
        for (let i = 1; i <= 20; i++) {
            const landing = landingDistance(i / 20);
            expect(landing).toBeLessThan(previous);
            previous = landing;
        }
        expect(landingDistance(1)).toBeCloseTo(WAVE.landAhead - WAVE.openReach, 12);
        // The opening is a share: out of range is held to it.
        expect(landingDistance(-3)).toBe(landingDistance(0));
        expect(landingDistance(7)).toBe(landingDistance(1));
        for (const open of OPENINGS) {
            expect(crestDistance(open) - landingDistance(open)).toBeCloseTo(WAVE.throwLength, 12);
        }
        expect(crestDistance()).toBe(crestDistance(0));
    });

    it('sweeps the lip from the crest\'s feathering to its touchdown, never back, never beyond either', () => {
        for (const open of OPENINGS) {
            const angles = DISTANCES.map((d) => lipAngle(d, open));
            expect(Math.min(...angles)).toBeGreaterThanOrEqual(WAVE.lipCrest);
            expect(Math.max(...angles)).toBeLessThanOrEqual(WAVE.lipClosed);
            // Further ahead the lip has fallen less far.
            expect(nonIncreasing(angles), `open ${open}`).toBe(true);
            // Closed from the touchdown back, only feathering from the crest on.
            const landing = landingDistance(open);
            const crest = crestDistance(open);
            expect(lipAngle(landing, open)).toBeCloseTo(WAVE.lipClosed, 12);
            expect(lipAngle(landing - 3, open)).toBeCloseTo(WAVE.lipClosed, 12);
            expect(lipAngle(-WAVE.backReach, open)).toBeCloseTo(WAVE.lipClosed, 12);
            expect(lipAngle(crest, open)).toBeCloseTo(WAVE.lipCrest, 12);
            expect(lipAngle(WAVE.aheadReach, open)).toBeCloseTo(WAVE.lipCrest, 12);
            // Between the two it falls all the way, strictly.
            const falling = [];
            for (let i = 0; i <= 40; i++) falling.push(lipAngle(landing + (WAVE.throwLength * i) / 40, open));
            for (let i = 1; i < falling.length; i++) expect(falling[i]).toBeLessThan(falling[i - 1]);
        }
        expect(lipAngle(8)).toBe(lipAngle(8, 0));
    });

    it('opens the eye of the barrel at every distance when the barrel opens', () => {
        for (const d of DISTANCES) {
            const angles = OPENINGS.map((open) => lipAngle(d, open));
            expect(nonIncreasing(angles), `d ${d}`).toBe(true);
        }
        // Along the throw the lip has plainly fallen less far.
        const mid = (landingDistance(1) + crestDistance(0)) / 2;
        expect(lipAngle(mid, 1)).toBeLessThan(lipAngle(mid, 0));
        expect(lipAngle(mid, 0.5)).toBeLessThan(lipAngle(mid, 0));
    });

    it('relaxes the tube into a swell ahead of the throw, and tapers the swell with distance', () => {
        for (const open of OPENINGS) {
            const weights = DISTANCES.map((d) => shoulderWeight(d, open));
            const scales = DISTANCES.map((d) => sectionScale(d, open));
            expect(nonDecreasing(weights), `weight, open ${open}`).toBe(true);
            expect(nonIncreasing(scales), `scale, open ${open}`).toBe(true);
            expect(Math.min(...weights)).toBe(0);
            expect(Math.max(...weights)).toBe(1);
            expect(Math.max(...scales)).toBe(1);
            expect(Math.min(...scales)).toBeGreaterThanOrEqual(WAVE.taperFloor - 1e-12);
            // Round the eye, and all along the falling lip up to its touchdown, it is the tube itself.
            expect(inTube(-WAVE.backReach, open)).toBe(true);
            expect(inTube(0, open)).toBe(true);
            expect(inTube(landingDistance(open), open)).toBe(true);
            // Far ahead it is all swell, lower than the tube.
            expect(shoulderWeight(WAVE.aheadReach, open)).toBe(1);
            expect(sectionScale(WAVE.aheadReach, open)).toBeLessThan(1);
        }
        expect(shoulderWeight(3)).toBe(shoulderWeight(3, 0));
        expect(sectionScale(300)).toBe(sectionScale(300, 0));
    });

    it('bowls the line to the left ahead, by a bounded amount, and leaves it straight round the eye', () => {
        const offsets = DISTANCES.map((d) => axisOffset(d));
        expect(nonIncreasing(offsets)).toBe(true);
        expect(Math.max(...offsets)).toBeLessThanOrEqual(0);
        expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-WAVE.bowlMax);
        expect(axisOffset(-WAVE.backReach)).toBeCloseTo(0, 12);
        expect(axisOffset(0)).toBeCloseTo(0, 12);
    });
});

describe('waves shape: the trough', () => {
    it('lays the trough rows out from the foot of the face to the far sea, wider apart with distance', () => {
        expect(floorX(0)).toBeCloseTo(0, 12);
        expect(floorX(-1)).toBeCloseTo(-WAVE.floorFar, 9);
        // Out of range is held: a row past the far end, or one that is not trough at all.
        expect(floorX(-2)).toBeCloseTo(-WAVE.floorFar, 9);
        expect(floorX(0.4)).toBeCloseTo(0, 12);
        let previous = floorX(-1);
        let previousGap = Infinity;
        for (let i = 1; i <= 50; i++) {
            const x = floorX(-1 + i / 50);
            expect(x).toBeGreaterThan(previous);
            // Each row nearer the wave stands closer to its neighbour than the last.
            expect(x - previous).toBeLessThan(previousGap);
            previousGap = x - previous;
            previous = x;
        }
    });

    it('finds the row of a point of the trough: floorRow inverts floorX', () => {
        for (let i = 0; i <= 200; i++) {
            const r = -i / 200;
            expect(floorRow(floorX(r))).toBeCloseTo(r, 9);
        }
        for (let i = 0; i <= 200; i++) {
            const x = -WAVE.floorFar * (i / 200) ** 3; // dense near the foot, out to the far end
            const r = floorRow(x);
            expect(floorX(r)).toBeCloseTo(x, 7);
            expect(r).toBeLessThanOrEqual(0);
            expect(r).toBeGreaterThanOrEqual(-1);
        }
        // Past either end it answers with the end.
        expect(floorRow(5)).toBeCloseTo(0, 12);
        expect(floorRow(-WAVE.floorFar * 3)).toBeCloseTo(-1, 12);
    });
});

describe('waves shape: a point of the still wave', () => {
    it('joins the trough to the face without a step, at every distance and opening', () => {
        const tiny = 1e-7;
        const wrong = [];
        for (const open of OPENINGS) {
            for (const d of DISTANCES) {
                // The foot of the face: on the trough's level, on the line the wave's axis draws.
                const foot = wavePoint(0, d, open);
                const below = wavePoint(-tiny, d, open);
                const above = wavePoint(tiny, d, open);
                const ok = near(foot.x, axisOffset(d), 1e-12) && foot.y === 0 && near(foot.z, -d, 1e-12)
                    && distance(below, foot) < 1e-5 && distance(above, foot) < 1e-5;
                if (!ok) wrong.push(`d ${d}, open ${open}: ${JSON.stringify([below, foot, above])}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it('keeps the trough flat, left of the foot, at the distance it was asked for', () => {
        const wrong = [];
        for (const d of DISTANCES) {
            for (let i = 0; i <= 20; i++) {
                const r = -i / 20;
                const p = wavePoint(r, d, 0.5);
                const ok = p.y === 0 && near(p.z, -d, 1e-12) && near(p.x, axisOffset(d) + floorX(r), 1e-9)
                    && p.x <= axisOffset(d);
                if (!ok) wrong.push(`r ${r}, d ${d}: ${JSON.stringify(p)}`);
            }
        }
        expect(wrong).toEqual([]);
        // The far row is as far out as the sea reaches.
        expect(wavePoint(-1, 0).x).toBeCloseTo(-WAVE.floorFar, 6);
    });

    it('puts every row of the tube on its ellipse, as far round as the lip has fallen', () => {
        let checked = 0;
        const wrong = [];
        for (const open of OPENINGS) {
            for (const d of DISTANCES) {
                if (!inTube(d, open)) continue;
                const lip = lipAngle(d, open);
                for (let i = 1; i <= 40; i++) {
                    const r = i / 40;
                    const p = wavePoint(r, d, open);
                    const onEllipse = ((p.x - axisOffset(d)) / WAVE.a) ** 2 + ((p.y - WAVE.b) / WAVE.b) ** 2;
                    const ok = near(onEllipse, 1, 1e-9) && near(angleRound(p, d), r * lip, 1e-9)
                        && near(p.z, -d, 1e-12) && p.y > 0;
                    if (!ok) wrong.push(`r ${r}, d ${d}, open ${open}: ${JSON.stringify(p)}`);
                    checked += 1;
                }
            }
        }
        expect(wrong).toEqual([]);
        expect(checked).toBeGreaterThan(2000);
    });

    it('throws the roof twice the tube\'s half-height above the trough, and nothing higher', () => {
        let roofs = 0;
        const wrong = [];
        for (const open of OPENINGS) {
            for (const d of DISTANCES) {
                if (!inTube(d, open)) continue;
                const lip = lipAngle(d, open);
                let top = 0;
                for (let i = 0; i <= 400; i++) top = Math.max(top, wavePoint(i / 400, d, open).y);
                if (top > 2 * WAVE.b + 1e-9) wrong.push(`d ${d}, open ${open}: the section reaches ${top}`);
                if (lip < Math.PI) continue; // the lip has not come over the top here yet
                // Straight above the foot of the face.
                const roof = wavePoint(Math.PI / lip, d, open);
                if (!near(roof.y, 2 * WAVE.b, 1e-9) || !near(roof.x, axisOffset(d), 1e-9)) {
                    wrong.push(`d ${d}, open ${open}: the roof is at ${JSON.stringify(roof)}`);
                }
                roofs += 1;
            }
        }
        expect(wrong).toEqual([]);
        expect(roofs).toBeGreaterThan(100);
    });

    it('raises the face on the right and brings the lip down on the left where it has landed', () => {
        for (const open of OPENINGS) {
            for (const d of [-WAVE.backReach, 0, landingDistance(open) * 0.5, landingDistance(open)]) {
                const xc = axisOffset(d);
                // The first rows of the wave climb to the right of the foot...
                expect(wavePoint(0.05, d, open).x).toBeGreaterThan(xc);
                expect(wavePoint(0.2, d, open).x).toBeGreaterThan(wavePoint(0.05, d, open).x);
                expect(wavePoint(0.2, d, open).y).toBeGreaterThan(wavePoint(0.05, d, open).y);
                // ...and the edge of the closed lip hangs low on the left, over the trough.
                const edge = wavePoint(1, d, open);
                expect(edge.x).toBeLessThan(xc);
                expect(edge.y).toBeLessThan(WAVE.b);
                expect(edge.y).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('holds a row past the lip to the lip\'s edge, and writes into what it is given', () => {
        for (const d of [-2, 3, 9, 15, 60]) {
            expect(wavePoint(1.5, d, 0.3)).toEqual(wavePoint(1, d, 0.3));
            expect(wavePoint(40, d, 0.3)).toEqual(wavePoint(1, d, 0.3));
        }
        const out = { x: 9, y: 9, z: 9 };
        expect(wavePoint(0.4, 6, 0, out)).toBe(out);
        expect(out).toEqual(wavePoint(0.4, 6, 0));
        expect(wavePoint(0.4, 6)).toEqual(wavePoint(0.4, 6, 0));
    });

    it('is an unbroken hump where the wave has not broken: no overhang, lower with distance', () => {
        const far = DISTANCES.filter((d) => shoulderWeight(d, 0) === 1);
        expect(far.length).toBeGreaterThan(5);
        const crests = [];
        for (const d of far) {
            const xs = [];
            const ys = [];
            for (let i = 0; i <= 50; i++) {
                const p = wavePoint(i / 50, d, 0);
                xs.push(p.x);
                ys.push(p.y);
            }
            // From the foot back to the crest: always further back, never lower.
            expect(xs.every((x, i) => i === 0 || x > xs[i - 1]), `d ${d}`).toBe(true);
            expect(nonDecreasing(ys), `d ${d}`).toBe(true);
            // The swell is as high as the taper leaves it there.
            expect(ys[ys.length - 1]).toBeCloseTo(WAVE.swellHeight * sectionScale(d, 0), 9);
            crests.push(ys[ys.length - 1]);
        }
        expect(nonIncreasing(crests)).toBe(true);
        expect(crests[crests.length - 1]).toBeLessThan(crests[0]);
        expect(crests[crests.length - 1]).toBeGreaterThanOrEqual(WAVE.swellHeight * WAVE.taperFloor - 1e-9);
    });

    it('has no step along the line: through the touchdown, the crest and into the shoulder', () => {
        const step = 1e-3;
        const wrong = [];
        for (const open of [0, 1]) {
            for (let d = -WAVE.backReach; d < crestDistance(open) + WAVE.shoulderBlend + 20; d += 0.173) {
                for (const r of [-0.5, 0.1, 0.35, 0.6, 0.85, 1]) {
                    const jump = distance(wavePoint(r, d, open), wavePoint(r, d + step, open));
                    if (!(jump < 0.02)) wrong.push(`r ${r}, d ${d}, open ${open}: ${jump} m in a millimetre`);
                }
            }
        }
        expect(wrong).toEqual([]);
    });

    it('never answers with a number that is not finite', () => {
        const wrong = [];
        for (const open of [-0.5, 0, 0.5, 1, 1.5]) {
            for (const d of [...DISTANCES, -50, WAVE.aheadReach * 2]) {
                for (let i = -12; i <= 12; i++) {
                    const p = wavePoint(i / 10, d, open);
                    if (!Number.isFinite(p.x + p.y + p.z)) wrong.push(`r ${i / 10}, d ${d}, open ${open}`);
                }
            }
        }
        expect(wrong).toEqual([]);
    });
});

describe('waves shape: surface coordinates', () => {
    it('measures a row in metres of surface from the foot of the face', () => {
        for (const open of OPENINGS) {
            for (const d of [-3, 0, 4, 9, 15, 40]) {
                expect(surfaceU(0, d, open)).toBeCloseTo(0, 12);
                const us = [];
                for (let i = -20; i <= 20; i++) us.push(surfaceU(i / 20, d, open));
                expect(us.every((u, i) => i === 0 || u > us[i - 1]), `d ${d}, open ${open}`).toBe(true);
                // The trough: its own x. The arc: its own length.
                expect(us[5]).toBe(floorX(-15 / 20));
                expect(us[30]).toBeCloseTo(0.5 * lipAngle(d, open) * WAVE.rho, 12);
                expect(us[40]).toBeCloseTo(lipAngle(d, open) * WAVE.rho, 12);
                // The lip's edge is as far as the surface goes.
                expect(surfaceU(3, d, open)).toBe(us[40]);
            }
        }
        expect(surfaceU(0.5, 6)).toBe(surfaceU(0.5, 6, 0));
    });

    it('finds the row at a surface coordinate: rowAtU inverts surfaceU', () => {
        const wrong = [];
        for (const open of OPENINGS) {
            for (const d of [-3, 0, 4, 9, 15, 40, 300]) {
                for (let i = -40; i <= 40; i++) {
                    const r = i / 40;
                    const back = rowAtU(surfaceU(r, d, open), d, open);
                    if (!near(back, r, 1e-9)) wrong.push(`r ${r}, d ${d}, open ${open}: ${back}`);
                }
                // Past the lip's edge the row exceeds 1: the caller can tell it has left the water.
                expect(rowAtU(surfaceU(1, d, open) + 0.5, d, open)).toBeGreaterThan(1);
            }
        }
        expect(wrong).toEqual([]);
        expect(rowAtU(4, 6)).toBe(rowAtU(4, 6, 0));
    });

    it('reads the surface coordinate back from a point of the trough or one well up the tube\'s wall', () => {
        let checked = 0;
        const wrong = [];
        for (const d of DISTANCES) {
            if (!inTube(d, 0)) continue;
            for (let i = -20; i <= 40; i++) {
                const r = i / 40;
                const p = wavePoint(r, d, 0);
                if (r > 0 && p.y < 0.5) continue; // the foot of the face: see the next test
                const u = surfaceAt(p.x, p.y, p.z);
                if (!near(u, surfaceU(r, d, 0), 1e-6)) wrong.push(`r ${r}, d ${d}: ${u} for ${surfaceU(r, d, 0)}`);
                checked += 1;
            }
        }
        expect(wrong).toEqual([]);
        expect(checked).toBeGreaterThan(1000);
    });

    // SUSPECTED BUG (waves-core.js, surfaceAt): a point low on the face (0 < y < 0.12) is taken for a
    // point of the trough and answered with min(0, x - xc) = 0, although it stands up to
    // acos(1 - 0.12 / b) * rho (about 0.92 m) up the face. The surface coordinate therefore jumps by
    // that much where the face meets the trough, and disagrees with castRay's `u` for the same point.
    it('reads the surface coordinate back from the foot of the face as well', () => {
        const wrong = [];
        for (const d of [0, 2, 4]) {
            for (let i = 1; i <= 40; i++) {
                const r = i / 400; // the lowest tenth of the wave: the foot of the face
                const p = wavePoint(r, d, 0);
                const u = surfaceAt(p.x, p.y, p.z);
                if (!near(u, surfaceU(r, d, 0), 1e-3)) wrong.push(`r ${r}, d ${d}: ${u} for ${surfaceU(r, d, 0)}`);
            }
        }
        expect(wrong).toEqual([]);
    });
});

describe('waves shape: where a ray meets the wave', () => {
    const hits = sweep();

    it('answers every direction from the rest eye with a finite hit of a known kind', () => {
        const kinds = new Set();
        const wrong = [];
        for (const { dir, hit, where } of hits) {
            kinds.add(hit.kind);
            const finite = HIT_FIELDS.every((key) => Number.isFinite(hit[key]));
            // The hit is along the ray, in front of the eye.
            const ok = finite && hit.t > 0 && near(hit.d, -hit.z, 1e-9) && near(hit.z, EYE.z + dir[2] * hit.t, 1e-6);
            if (!ok) wrong.push(`${where}: ${JSON.stringify(hit)}`);
        }
        expect(wrong).toEqual([]);
        expect([...kinds].sort()).toEqual(['floor', 'lip', 'wall']);
        // The axes themselves, where components of the direction are exactly zero.
        for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const hit = cast(dir);
            expect(HIT_FIELDS.filter((key) => !Number.isFinite(hit[key])), `${dir}`).toEqual([]);
            expect(['floor', 'lip', 'wall']).toContain(hit.kind);
        }
    });

    it('lands near hits on the still wave: the point is wavePoint of the row and distance it reports', () => {
        const count = { floor: 0, wall: 0, lip: 0 };
        const wrong = [];
        for (const { open, hit, where } of hits) {
            if (!isNear(hit, open)) continue;
            const off = distance(wavePoint(hit.r, hit.d, open), hit);
            if (!(off < 5e-3)) wrong.push(`${hit.kind} for ${where}: ${off} m off the wave`);
            count[hit.kind] += 1;
        }
        expect(wrong).toEqual([]);
        expect(count.wall).toBeGreaterThan(1000);
        expect(count.floor).toBeGreaterThan(50);
        expect(count.lip).toBeGreaterThan(5);
    });

    it('reports a hit\'s row and surface coordinate in the terms of its kind', () => {
        const wrong = [];
        for (const {
            dir, open, hit, where,
        } of hits) {
            let ok;
            if (hit.kind === 'floor') {
                // Only a ray that goes down reaches the trough; the hit is where it crosses y = 0.
                ok = dir[1] < 0 && hit.y === 0 && near(hit.t, -EYE.y / dir[1], 1e-9)
                    && near(hit.x, EYE.x + dir[0] * hit.t, 1e-9)
                    && hit.u <= 0 && near(hit.u, Math.min(0, hit.x - axisOffset(hit.d)), 1e-9)
                    && near(hit.r, floorRow(hit.u), 1e-12) && hit.r >= -1 && hit.r <= 0;
            } else if (hit.kind === 'wall') {
                ok = hit.r >= 0 && hit.r <= 1 && near(hit.u, hit.r * lipAngle(hit.d, open) * WAVE.rho, 1e-9)
                    && near(hit.x, EYE.x + dir[0] * hit.t, 1e-9) && near(hit.y, EYE.y + dir[1] * hit.t, 1e-9);
            } else {
                // Into the sky: the nearest water is the lip's edge at that distance.
                const edge = wavePoint(1, hit.d, open);
                ok = dir[1] >= -1e-6 && hit.r === 1 && near(hit.u, lipAngle(hit.d, open) * WAVE.rho, 1e-12)
                    && near(hit.x, edge.x, 1e-12) && near(hit.y, edge.y, 1e-12);
            }
            if (!ok) wrong.push(`${where}: ${JSON.stringify(hit)}`);
        }
        expect(wrong).toEqual([]);
    });

    it('meets the face with every ray turned toward it', () => {
        const wrong = [];
        for (const open of OPENINGS) {
            for (let yaw = 40; yaw <= 140; yaw += 10) {
                for (let pitch = -15; pitch <= 25; pitch += 5) {
                    const hit = cast(aim(yaw, pitch), open);
                    // The face: the first half-turn of the section, right of the foot.
                    const ok = hit.kind === 'wall' && hit.x > EYE.x && hit.u > 0 && hit.u < Math.PI * WAVE.rho
                        && hit.r > 0 && hit.r < 1;
                    if (!ok) wrong.push(`yaw ${yaw}, pitch ${pitch}, open ${open}: ${JSON.stringify(hit)}`);
                }
            }
        }
        expect(wrong).toEqual([]);
        // Straight at it.
        const square = cast([1, 0, 0]);
        expect(square.kind).toBe('wall');
        expect(square.y).toBeCloseTo(EYE.y, 12);
        expect(square.z).toBeCloseTo(0, 12);
        expect(distance(square, wavePoint(square.r, 0, 0))).toBeLessThan(1e-9);
    });

    it('meets the trough with a ray aimed at it, under the eye of the barrel', () => {
        // The floor of the tube: between the foot of the face and where the closed lip comes down.
        const lipFoot = WAVE.a * Math.sin(WAVE.lipClosed);
        expect(lipFoot).toBeLessThan(0);
        let checked = 0;
        const wrong = [];
        for (const open of OPENINGS) {
            for (const share of [0.2, 0.4, 0.6]) {
                for (let d = -2; d <= landingDistance(open) - 0.5; d += 0.5) {
                    const target = { x: axisOffset(d) + share * lipFoot, y: 0, z: -d };
                    const hit = cast(toward(target), open);
                    const ok = hit.kind === 'floor' && distance(hit, target) < 1e-9
                        && near(hit.u, share * lipFoot, 1e-9) && hit.r < 0;
                    if (!ok) wrong.push(`share ${share}, d ${d}, open ${open}: ${JSON.stringify(hit)}`);
                    checked += 1;
                }
            }
        }
        expect(wrong).toEqual([]);
        expect(checked).toBeGreaterThan(50);
    });

    it('follows a ray out through the eye of the barrel: down to the sea, or up to the lip\'s edge', () => {
        const count = { floor: 0, lip: 0 };
        for (const open of OPENINGS) {
            // Where the lip only feathers the opening is widest: aim through it, low and high.
            const d = crestDistance(open);
            const lip = lipAngle(d, open);
            for (let i = 1; i < 10; i++) {
                const through = sectionPoint(lip + ((TAU - lip) * i) / 10, d);
                if (Math.abs(through.y - EYE.y) < 0.2) continue; // level with the eye: either answer
                const hit = cast(toward(through), open);
                const where = `opening share ${i / 10}, open ${open}`;
                if (through.y < EYE.y) {
                    // Down: the sea in front of the wave, further out than the opening it left by.
                    expect(hit.kind, where).toBe('floor');
                    expect(hit.d, where).toBeGreaterThan(d);
                    expect(hit.u, where).toBeLessThan(0);
                    expect(hit.x, where).toBeLessThan(through.x);
                    count.floor += 1;
                } else {
                    // Up into the sky: stopped at the lip's edge.
                    expect(hit.kind, where).toBe('lip');
                    expect(hit.r, where).toBe(1);
                    expect(hit.d, where).toBeCloseTo(d, 1);
                    count.lip += 1;
                }
            }
        }
        expect(count.floor).toBeGreaterThan(5);
        expect(count.lip).toBeGreaterThan(5);
    });

    it('lets a ray through the curtain once the barrel has opened past it', () => {
        // A section the lip has closed at rest and still hangs open over when the barrel is open.
        const d = (landingDistance(0) + landingDistance(1)) / 2;
        const closed = lipAngle(d, 0);
        const opened = lipAngle(d, 1);
        expect(opened).toBeLessThan(closed);
        const through = sectionPoint((closed + opened) / 2, d);
        expect(through.y).toBeLessThan(EYE.y); // a ray down through the foot of the curtain
        const dir = toward(through);
        const atRest = cast(dir, 0);
        expect(atRest.kind).toBe('wall');
        expect(distance(atRest, through)).toBeLessThan(5e-3);
        expect(atRest.r).toBeGreaterThan(0.5);
        expect(atRest.r).toBeLessThan(1);
        const open = cast(dir, 1);
        expect(open.kind).toBe('floor');
        expect(open.d).toBeGreaterThan(d);
        // With no opening given, the barrel is at rest.
        expect(castRay(EYE.x, EYE.y, EYE.z, dir[0], dir[1], dir[2])).toEqual(atRest);
    });

    it('writes into the object it is given and leaves no stale field from the last cast', () => {
        const out = {};
        const up = castRay(EYE.x, EYE.y, EYE.z, ...aim(60, 10), 0, out);
        expect(up).toBe(out);
        const keys = Object.keys(out).sort();
        expect(keys).toEqual(['d', 'kind', 'r', 't', 'u', 'x', 'y', 'z']);
        const target = { x: 0.5 * WAVE.a * Math.sin(WAVE.lipClosed), y: 0, z: -1 };
        const down = castRay(EYE.x, EYE.y, EYE.z, ...toward(target), 0, out);
        expect(down).toBe(out);
        expect(down.kind).toBe('floor');
        expect(Object.keys(out).sort()).toEqual(keys);
        expect(out).toEqual(cast(toward(target)));
    });

    it('agrees with surfaceAt on the surface coordinate of a near hit on the trough or well up the wall', () => {
        const count = {
            floor: 0, wall: 0, lip: 0, foot: 0,
        };
        const wrong = [];
        for (const { open, hit, where } of hits) {
            if (!isNear(hit, open)) continue;
            if (hit.kind === 'wall' && hit.y < 0.5) {
                count.foot += 1; // the foot of the face: see the next test
                continue;
            }
            const u = surfaceAt(hit.x, hit.y, hit.z);
            if (!near(u, hit.u, 5e-3)) wrong.push(`${hit.kind} for ${where}: surfaceAt ${u}, castRay ${hit.u}`);
            count[hit.kind] += 1;
        }
        expect(wrong).toEqual([]);
        expect(count.wall).toBeGreaterThan(1000);
        expect(count.floor).toBeGreaterThan(50);
        expect(count.lip).toBeGreaterThan(5);
        expect(count.foot).toBeGreaterThan(20);
    });

    // SUSPECTED BUG (waves-core.js, surfaceAt): the same step as above, seen from castRay. A ray from the
    // rest eye that meets the face below y = 0.12 gets u = phi * rho (up to about 0.92 m) from castRay
    // and u = 0 from surfaceAt for the very same point.
    it('agrees with surfaceAt on the surface coordinate of a near hit at the foot of the face', () => {
        const wrong = [];
        for (const { open, hit, where } of hits) {
            // (The test above counts these hits: there are some.)
            if (!isNear(hit, open) || hit.kind !== 'wall' || hit.y >= 0.5) continue;
            const u = surfaceAt(hit.x, hit.y, hit.z);
            if (!near(u, hit.u, 5e-3)) wrong.push(`${where}: surfaceAt ${u}, castRay ${hit.u}`);
        }
        expect(wrong).toEqual([]);
    });
});

describe('waves water noise', () => {
    const size = 64;
    const data = bakeWaterNoise(size);
    const channel = (bytes, c) => {
        const out = [];
        for (let i = c; i < bytes.length; i += 4) out.push(bytes[i]);
        return out;
    };
    const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
    const spread = (values) => {
        const sorted = [...values].sort((p, q) => p - q);
        return sorted[sorted.length - 1] - sorted[0];
    };

    it('bakes a square of four bytes a texel, the same for the same seed', () => {
        expect(data).toBeInstanceOf(Uint8Array);
        expect(data).toHaveLength(size * size * 4);
        expect(Array.from(bakeWaterNoise(size))).toEqual(Array.from(data));
        expect(Array.from(bakeWaterNoise(size, 7))).not.toEqual(Array.from(data));
        expect(bakeWaterNoise(32)).toHaveLength(32 * 32 * 4);
        // Every size a tier asks for is a power of two, and the smallest of them bakes to its size.
        const sizes = [...new Set(Object.values(QUALITY).map((tier) => tier.noise))];
        for (const s of sizes) expect(Number.isInteger(Math.log2(s)), `noise ${s}`).toBe(true);
        expect(bakeWaterNoise(Math.min(...sizes))).toHaveLength(Math.min(...sizes) ** 2 * 4);
    });

    it('centres the slope channels on the middle of the byte and uses their whole range', () => {
        // A tileable field's slope sums to nothing: one fetch is a ripple normal with no lean.
        const r = channel(data, 0);
        const g = channel(data, 1);
        expect(mean(r)).toBeGreaterThan(126);
        expect(mean(r)).toBeLessThan(129);
        expect(mean(g)).toBeGreaterThan(126);
        expect(mean(g)).toBeLessThan(129);
        // The steepest slope lands on an end of the range.
        const steepest = [...r, ...g].reduce((hi, v) => Math.max(hi, Math.abs(v - 127.5)), 0);
        expect(steepest).toBe(127.5);
        expect(spread(r)).toBeGreaterThan(120);
        expect(spread(g)).toBeGreaterThan(120);
    });

    it('fills the two height channels with two different fields that use the byte', () => {
        const b = channel(data, 2);
        const a = channel(data, 3);
        expect(spread(b)).toBeGreaterThan(120);
        expect(spread(a)).toBeGreaterThan(120);
        // Independent enough to break up what would repeat: they mostly do not move together.
        const mb = mean(b);
        const ma = mean(a);
        let cov = 0;
        let vb = 0;
        let va = 0;
        for (let i = 0; i < b.length; i++) {
            cov += (b[i] - mb) * (a[i] - ma);
            vb += (b[i] - mb) ** 2;
            va += (a[i] - ma) ** 2;
        }
        expect(Math.abs(cov / Math.sqrt(vb * va))).toBeLessThan(0.6);
    });

    it('tiles: the height crosses the seam no faster than it crosses any other column or row', () => {
        const at = (i, j) => data[(((j + size) % size) * size + ((i + size) % size)) * 4 + 2];
        const half = size / 2;
        let seam = 0;
        let inside = 0;
        for (let k = 0; k < size; k++) {
            seam += Math.abs(at(0, k) - at(-1, k)) + Math.abs(at(k, 0) - at(k, -1));
            inside += Math.abs(at(half, k) - at(half - 1, k)) + Math.abs(at(k, half) - at(k, half - 1));
        }
        expect(inside).toBeGreaterThan(0);
        expect(seam).toBeLessThan(inside * 3);
    });
});

describe('waves tiers', () => {
    it('names the six canonical tiers, cheapest first, and falls back to High', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        expect(Object.keys(QUALITY)).toEqual(QUALITY_NAMES);
        for (const name of QUALITY_NAMES) {
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(Object.isFrozen(QUALITY[name]), name).toBe(true);
        }
        expect(Object.isFrozen(QUALITY)).toBe(true);
        for (const junk of [undefined, null, '', 'high', 'Nonsense', 3]) expect(tierFor(junk)).toBe(QUALITY.High);
    });

    it('gives every tier the same fields, the whole picture and every event', () => {
        const keys = Object.keys(QUALITY.High).sort();
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(Object.keys(tier).sort(), name).toEqual(keys);
            // Enough mesh to fold a tube, and something of everything an event needs.
            for (const key of ['arcRows', 'floorRows', 'noise', 'rings', 'ribbons', 'droplets', 'spray', 'mist']) {
                expect(Number.isInteger(tier[key]), `${name}.${key}`).toBe(true);
                expect(tier[key], `${name}.${key}`).toBeGreaterThan(0);
            }
            expect(tier.dolphins, name).toBeGreaterThanOrEqual(1);
            expect(tier.clouds, name).toBeGreaterThanOrEqual(1);
            expect(tier.nearStep, name).toBeGreaterThan(0);
            expect([0, 1], name).toContain(tier.trace);
            expect(typeof tier.caustics, name).toBe('boolean');
        }
    });

    it('never asks a dearer tier for less', () => {
        const rising = [
            'arcRows', 'floorRows', 'noise', 'trace', 'clouds', 'rings', 'ribbons', 'droplets', 'spray', 'mist',
            'dolphins',
        ];
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const cheaper = QUALITY[QUALITY_NAMES[i - 1]];
            const dearer = QUALITY[QUALITY_NAMES[i]];
            for (const key of rising) {
                expect(dearer[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(cheaper[key]);
            }
            // Never a coarser mesh near the eye, and never caustics taken away again.
            expect(dearer.nearStep, QUALITY_NAMES[i]).toBeLessThanOrEqual(cheaper.nearStep);
            expect(Number(dearer.caustics), QUALITY_NAMES[i]).toBeGreaterThanOrEqual(Number(cheaper.caustics));
        }
        expect(QUALITY.Extreme.spray).toBeGreaterThan(QUALITY.Minimal.spray);
        expect(QUALITY.Extreme.arcRows).toBeGreaterThan(QUALITY.Minimal.arcRows);
        expect(QUALITY.Extreme.nearStep).toBeLessThan(QUALITY.Minimal.nearStep);
    });
});

describe('waves rig', () => {
    it('holds the horizontal field of view and clamps the vertical one it follows from', () => {
        const fovs = [];
        for (let aspect = 0.3; aspect <= 4; aspect += 0.1) fovs.push(fovForAspect(aspect));
        expect(Math.min(...fovs)).toBe(REST_RIG.minFov);
        expect(Math.max(...fovs)).toBe(REST_RIG.maxFov);
        // A wider frame never needs a taller lens.
        expect(nonIncreasing(fovs)).toBe(true);
        // Between the clamps the horizontal field of view is the rig's.
        const free = [];
        for (let aspect = 0.3; aspect <= 4; aspect += 0.01) {
            const vertical = fovForAspect(aspect);
            if (vertical > REST_RIG.minFov && vertical < REST_RIG.maxFov) free.push([aspect, vertical]);
        }
        expect(free.length).toBeGreaterThan(5);
        for (const [aspect, vertical] of free) {
            const horizontal = (2 * Math.atan(Math.tan((vertical * DEG) / 2) * aspect)) / DEG;
            expect(horizontal).toBeCloseTo(REST_RIG.hFov, 9);
        }
        // Nonsense is a sixteen-by-nine frame; a sliver is not a division by nothing.
        for (const junk of [NaN, undefined, Infinity, 'wide']) expect(fovForAspect(junk)).toBe(fovForAspect(16 / 9));
        expect(Number.isFinite(fovForAspect(0))).toBe(true);
        expect(REST_RIG.minFov).toBeLessThan(REST_RIG.maxFov);
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(WAVE.aheadReach);
    });

    it('turns the lens toward the face to clear the card on a wide screen, and recomposes a tall one', () => {
        const wide = viewFor(16 / 9, true);
        const menu = viewFor(16 / 9, false);
        // With a board in the middle the eye of the barrel is pushed clear of it to the left; without
        // one it comes back toward the middle.
        expect(wide.yaw).toBeGreaterThan(menu.yaw);
        // A phone's upright frame is another picture: the card fills its width.
        const tall = viewFor(430 / 932, true);
        expect(Math.abs(tall.yaw - wide.yaw) + Math.abs(tall.pitch - wide.pitch)).toBeGreaterThan(1);
        // It moves from one to the other without a step, and never looks behind, straight up or down.
        for (const board of [true, false]) {
            let previous = viewFor(0.3, board);
            for (let aspect = 0.32; aspect <= 3; aspect += 0.02) {
                const view = viewFor(aspect, board);
                const where = `aspect ${aspect}, board ${board}`;
                expect(Math.abs(view.yaw - previous.yaw), where).toBeLessThan(3);
                expect(Math.abs(view.pitch - previous.pitch), where).toBeLessThan(3);
                expect(Math.abs(view.yaw), where).toBeLessThan(60);
                expect(Math.abs(view.pitch), where).toBeLessThan(60);
                previous = view;
            }
        }
        // It writes into what it is given; nonsense is a sixteen-by-nine frame.
        const out = { yaw: 99, pitch: 99 };
        expect(viewFor(16 / 9, true, out)).toBe(out);
        expect(out).toEqual(wide);
        expect(viewFor(NaN, true)).toEqual(wide);
        expect(viewFor(undefined, false)).toEqual(menu);
    });
});
