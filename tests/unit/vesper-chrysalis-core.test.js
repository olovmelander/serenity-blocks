/**
 * Vesper Chrysalis — the three-free maths (vesper-chrysalis-core.js).
 *
 * The scene is being tuned while these tests stand, so they pin what the picture relies on, not
 * the numbers it is tuned with: every bound is taken from the module's own exports, and where a
 * test speaks of the screen it projects through the rest camera (EYE, fovForAspect) into the solo
 * layout the composition module gives for that frame.
 */
import { describe, expect, it } from 'vitest';
import {
    BLOOM_FULL, BLOOM_HOLD, BLOOM_KEEP, BLOOM_MAX, BLOOM_RISE, CHRYSALIS, DEG, EYE, EYE_COMBO, HEART, HOUR_SECONDS,
    PALETTE_KEYS, PLANET, RING_REACH, SUN, SWELL_ORIGIN, SWELL_SPEED, TAU, VESPER, VESPERFIRE, VESPER_PALETTES, WINGS,
    WING_STEPS, approach, bell, bloomLevel, chrysalisProfile, clamp01, fovForAspect, hourAt, lerp, linRGB, mulberry32,
    paletteAt, pieceColor, planBlooms, planSpires, powerForCombo, ringRadius, scallopReach, skyDirection, smooth,
    spireTip, swellPassTime, wingBase, wingForCombo, wingOutline, wingPoint, wingScallop, wingShape,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';
import { cardUnion, fallbackLayout } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-composition.js';

/** Frames the picture is composed for: desktops, an ultrawide, a tablet, upright phones. */
const WIDE = [[1600, 900], [1920, 1080], [1280, 720], [2560, 1440]];
const PHONES = [[390, 844], [430, 932]];

/**
 * Where a world point shows in the rest frame (screen fractions, y down) — the rest camera stands
 * at EYE, looks down −Z raised by EYE.pitch, with fovForAspect's lens. (The world test checks the
 * real camera against this.)
 */
function project(p, aspect) {
    const dx = p[0] - EYE.x;
    const dy = p[1] - EYE.y;
    const dz = p[2] - EYE.z;
    const c = Math.cos(EYE.pitch);
    const s = Math.sin(EYE.pitch);
    const depth = dy * s - dz * c;
    const rise = dy * c + dz * s;
    const t = Math.tan((fovForAspect(aspect) * DEG) / 2);
    return { x: 0.5 + (dx / (depth * t * aspect)) * 0.5, y: 0.5 - (rise / (depth * t)) * 0.5, depth };
}

const inFrame = (s, margin = 0) => s.depth > 0 && s.x > margin && s.x < 1 - margin && s.y > margin && s.y < 1 - margin;

/** Every (an, v) of a grid over one wing. */
function eachWingPoint(steps, visit) {
    for (const kind of [0, 1]) {
        for (let i = 0; i <= steps; i++) {
            for (let j = 0; j <= steps; j++) visit(kind, i / steps, j / steps);
        }
    }
}

describe('vesper chrysalis core: small maths', () => {
    it('eases, clamps and blends', () => {
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, 1e9)).toBe(1);
        // Frame-rate independent: two half steps close the same share of the gap as one whole step.
        const half = approach(2.4, 0.05);
        expect(1 - (1 - half) * (1 - half)).toBeCloseTo(approach(2.4, 0.1), 12);
        expect([clamp01(-2), clamp01(0.3), clamp01(7)]).toEqual([0, 0.3, 1]);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect([0, 1, 2, 3, 9].map((v) => smooth(1, 3, v))).toEqual([0, 0, 0.5, 1, 1]);
        expect([bell(0), bell(1), bell(-1), bell(4)]).toEqual([1, 0, 0, 0]);
        expect(bell(0.5)).toBeCloseTo(0.25, 12);
        expect(bell(-0.5)).toBe(bell(0.5));
    });

    it('draws the same numbers from the same seed, each in [0, 1)', () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        const other = mulberry32(8);
        const zero = mulberry32(0);
        let same = 0;
        for (let i = 0; i < 500; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            if (v === other()) same += 1;
            expect(Number.isFinite(zero())).toBe(true);
        }
        expect(same).toBeLessThan(5);
    });

    it('points a sky direction ahead at zero and keeps it a unit vector', () => {
        const ahead = skyDirection(0, 0);
        expect(ahead[0]).toBeCloseTo(0, 12);
        expect(ahead[1]).toBeCloseTo(0, 12);
        expect(ahead[2]).toBeCloseTo(-1, 12);
        for (const { azimuth, elevation } of [SUN, PLANET, VESPER]) {
            const d = skyDirection(azimuth, elevation);
            expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12);
            expect(Math.sign(d[0])).toBe(Math.sign(azimuth));
            expect(Math.sign(d[1])).toBe(Math.sign(elevation));
            expect(d[2]).toBeLessThan(0); // in front of the viewer
        }
        const out = [9, 9, 9];
        expect(skyDirection(0.3, 0.1, out)).toBe(out);
        // The sun has set (to the right); the ringed world and the evening star are up.
        expect(SUN.elevation).toBeLessThan(0);
        expect(PLANET.elevation).toBeGreaterThan(0);
        expect(VESPER.elevation).toBeGreaterThan(0);
        expect(PLANET.ringOut).toBeGreaterThan(PLANET.ringIn);
        expect(PLANET.ringIn).toBeGreaterThan(1);
    });
});

describe('vesper chrysalis core: the lens', () => {
    it('holds the horizontal view between its clamps, and reads nonsense as a wide desktop', () => {
        const horizontal = (aspect) => (2 * Math.atan(Math.tan((fovForAspect(aspect) * DEG) / 2) * aspect)) / DEG;
        let previous = Infinity;
        let unclamped = 0;
        for (let i = 0; i <= 80; i++) {
            const aspect = 0.25 * (5 / 0.25) ** (i / 80); // 0.25 .. 5
            const fov = fovForAspect(aspect);
            expect(fov).toBeGreaterThanOrEqual(EYE.minFov);
            expect(fov).toBeLessThanOrEqual(EYE.maxFov);
            // The wider the frame, the lower the lens: the same width of lake in view.
            expect(fov).toBeLessThanOrEqual(previous);
            previous = fov;
            if (fov > EYE.minFov && fov < EYE.maxFov) {
                expect(horizontal(aspect)).toBeCloseTo(EYE.hFov, 6);
                unclamped += 1;
            }
        }
        expect(unclamped).toBeGreaterThan(0);
        expect(EYE.minFov).toBeLessThan(EYE.maxFov);
        expect(fovForAspect(50)).toBe(EYE.minFov);
        expect(fovForAspect(0.05)).toBe(EYE.maxFov);
        expect(fovForAspect(0)).toBe(EYE.maxFov);
        expect(fovForAspect(-3)).toBe(EYE.maxFov);
        for (const nonsense of [NaN, undefined, null, Infinity, 'wide']) {
            expect(fovForAspect(nonsense), String(nonsense)).toBe(fovForAspect(16 / 9));
        }
        // A 16:9 desktop is neither clamp: the composition is measured where the rig is free.
        expect(fovForAspect(16 / 9)).toBeGreaterThan(EYE.minFov);
        expect(fovForAspect(16 / 9)).toBeLessThan(EYE.maxFov);
    });

    it('stands above the water looking a little up, the chrysalis in the frame', () => {
        expect(EYE.y).toBeGreaterThan(0);
        expect(EYE.pitch).toBeGreaterThan(0);
        expect(EYE.near).toBeGreaterThan(0);
        expect(EYE.far).toBeGreaterThan(EYE.near);
        for (const [width, height] of [...WIDE, [3440, 1440], ...PHONES]) {
            const heart = project(HEART, width / height);
            expect(inFrame(heart, 0.05), `${width}x${height}`).toBe(true);
            // Dead ahead, and in the upper half of the frame: the lake lies below it.
            expect(heart.x).toBeCloseTo(0.5, 9);
            expect(heart.y).toBeLessThan(0.5);
            // The horizon (a far point of the lake) is below the middle of the frame.
            expect(project([0, 0, -5000], width / height).y).toBeGreaterThan(0.5);
        }
    });
});

describe('vesper chrysalis core: the chrysalis', () => {
    it('gives it a profile that is finite, closed at the foot, widest at the shoulder and thin at the stalk', () => {
        let widest = 0;
        let widestAt = 0;
        for (let i = 0; i <= 400; i++) {
            const t = i / 400;
            const r = chrysalisProfile(t);
            expect(Number.isFinite(r), `t=${t}`).toBe(true);
            expect(r, `t=${t}`).toBeGreaterThanOrEqual(0);
            if (r > widest) {
                widest = r;
                widestAt = t;
            }
        }
        // The foot is a point: a closed solid, no hole under it.
        expect(chrysalisProfile(0)).toBeLessThan(1e-9);
        // It swells from the foot...
        expect(chrysalisProfile(0.02)).toBeGreaterThan(0);
        expect(chrysalisProfile(0.1)).toBeGreaterThan(chrysalisProfile(0.02));
        // ...to its greatest width at the shoulder ridge, which is the radius it is described by...
        expect(Math.abs(widestAt - CHRYSALIS.shoulder)).toBeLessThan(0.08);
        expect(widest).toBeGreaterThan(CHRYSALIS.radius * 0.85);
        expect(widest).toBeLessThan(CHRYSALIS.radius * 1.2);
        // ...and draws in to the stalk it hangs by: thin, but not a point (the silk is made fast there).
        expect(chrysalisProfile(1)).toBeLessThan(widest * 0.2);
        expect(chrysalisProfile(1)).toBeGreaterThan(0);
        // Beyond its ends it is its ends.
        expect(chrysalisProfile(-0.5)).toBe(chrysalisProfile(0));
        expect(chrysalisProfile(1.7)).toBe(chrysalisProfile(1));
    });

    it('hangs clear of the water, its heart inside it', () => {
        expect(CHRYSALIS.foot).toBeGreaterThan(0);
        expect(HEART[0]).toBe(CHRYSALIS.x);
        expect(HEART[2]).toBe(CHRYSALIS.z);
        expect(HEART[1]).toBeGreaterThan(CHRYSALIS.foot);
        expect(HEART[1]).toBeLessThan(CHRYSALIS.foot + CHRYSALIS.length);
        expect(CHRYSALIS.shoulder).toBeGreaterThan(0);
        expect(CHRYSALIS.shoulder).toBeLessThan(1);
        expect(Number.isInteger(CHRYSALIS.diadem)).toBe(true);
        // The swells leave the water right under it.
        expect(SWELL_ORIGIN).toEqual([CHRYSALIS.x, CHRYSALIS.z]);
    });
});

describe('vesper chrysalis core: the wings', () => {
    it('gives both kinds of wing a margin that is positive and bounded', () => {
        for (const kind of [0, 1]) {
            let longest = 0;
            for (let i = 0; i <= 500; i++) {
                const margin = wingOutline(kind, i / 500);
                expect(Number.isFinite(margin)).toBe(true);
                expect(margin, `kind ${kind} an ${i / 500}`).toBeGreaterThan(0.1);
                expect(margin, `kind ${kind} an ${i / 500}`).toBeLessThan(1.1);
                longest = Math.max(longest, margin);
            }
            // Outside 0..1 the margin is the margin at the edge.
            expect(wingOutline(kind, -1)).toBe(wingOutline(kind, 0));
            expect(wingOutline(kind, 3)).toBe(wingOutline(kind, 1));
            // The span is the length of a forewing; a hindwing is the shorter.
            if (kind === 0) expect(longest).toBeGreaterThan(0.9);
            else expect(longest).toBeLessThan(wingOutline(0, 1));
        }
        // A forewing is longest toward its leading edge.
        expect(wingOutline(0, 0.95)).toBeGreaterThan(wingOutline(0, 0.05));
    });

    it('scallops the margin between the veins, and lets the scallops into the wing only near the margin', () => {
        // How far the scallops reach in from the margin: not at all at the root, fully at the margin.
        expect(scallopReach(0)).toBe(0);
        expect(scallopReach(1)).toBe(1);
        expect(scallopReach(-3)).toBe(0);
        expect(scallopReach(7)).toBe(1);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            expect(scallopReach(i / 20)).toBeGreaterThan(previous);
            previous = scallopReach(i / 20);
        }
        // Half way out the wing they are all but gone: what is drawn there keeps its shape.
        expect(scallopReach(0.5)).toBeLessThan(0.02);
        for (const kind of [0, 1]) {
            const fan = kind === 0 ? WINGS.fore : WINGS.hind;
            let out = 0;
            let drawnIn = 0;
            for (let i = 0; i <= 600; i++) {
                const an = i / 600;
                const base = wingBase(kind, an);
                const scallop = wingScallop(kind, an);
                expect(base).toBeGreaterThan(0.1);
                // A scallop is a small share of the margin, standing out between the veins and drawn in at them.
                expect(Math.abs(scallop)).toBeLessThan(0.05);
                out = Math.max(out, scallop);
                drawnIn = Math.min(drawnIn, scallop);
                // The margin is the smooth outline with its scallops...
                expect(wingOutline(kind, an)).toBeCloseTo(base * (1 + scallop), 12);
                // ...which the wing reaches only at its edge.
                const reach = (v) => {
                    const p = wingPoint(kind, 1, an, v, 1, 0);
                    return Math.hypot(p[0] - WINGS.root[0], p[1] - WINGS.root[1]) / (WINGS.span * v);
                };
                expect(reach(1)).toBeCloseTo(wingOutline(kind, an), 9);
                expect(reach(0.5)).toBeCloseTo(base * (1 + scallop * scallopReach(0.5)), 9);
                expect(Math.abs(reach(0.5) - base)).toBeLessThan(base * 0.001);
            }
            expect(out).toBeGreaterThan(0);
            expect(drawnIn).toBeLessThan(0);
            // One lobe between each pair of veins: the margin is drawn in most at every vein.
            const atVein = wingScallop(kind, 0);
            expect(atVein).toBeLessThanOrEqual(drawnIn);
            for (let k = 0; k <= fan.scallops; k++) {
                expect(wingScallop(kind, k / fan.scallops)).toBeCloseTo(atVein, 12);
            }
            expect(wingBase(kind, -2)).toBe(wingBase(kind, 0));
            expect(wingBase(kind, 5)).toBe(wingBase(kind, 1));
            expect(wingScallop(kind, -2)).toBe(wingScallop(kind, 0));
        }
    });

    it('roots every wing at the shoulder and mirrors the left wings in the right', () => {
        for (const kind of [0, 1]) {
            for (const w of [0, 0.3, 1]) {
                for (const an of [0, 0.4, 1]) {
                    expect(wingPoint(kind, 1, an, 0, w, 0.2)).toEqual([WINGS.root[0], WINGS.root[1], WINGS.root[2]]);
                    expect(wingPoint(kind, -1, an, 0, w, 0.2)).toEqual([-WINGS.root[0], WINGS.root[1], WINGS.root[2]]);
                }
            }
        }
        const unmirrored = [];
        const crossed = [];
        for (const beat of [0, 0.15, -0.3]) {
            for (const w of [0.2, 0.6, 1]) {
                eachWingPoint(12, (kind, an, v) => {
                    const right = wingPoint(kind, 1, an, v, w, beat);
                    const left = wingPoint(kind, -1, an, v, w, beat);
                    const at = `kind ${kind} an ${an} v ${v} w ${w} beat ${beat}`;
                    if (left[0] !== -right[0] || left[1] !== right[1] || left[2] !== right[2]) unmirrored.push(at);
                    // A right wing lies to the right of the body.
                    if (right[0] < WINGS.root[0] - 1e-9) crossed.push(at);
                });
            }
        }
        expect(unmirrored).toEqual([]);
        expect(crossed).toEqual([]);
        const out = [0, 0, 0];
        expect(wingPoint(0, 1, 0.5, 0.5, 1, 0, out)).toBe(out);
        // Left to themselves the wings are fully open and at rest.
        expect(wingPoint(1, -1, 0.3, 0.8)).toEqual(wingPoint(1, -1, 0.3, 0.8, 1, 0));
        // The shoulders are on the chrysalis, a little in front of its axis.
        expect(WINGS.root[1]).toBeGreaterThan(CHRYSALIS.foot);
        expect(WINGS.root[1]).toBeLessThan(CHRYSALIS.foot + CHRYSALIS.length);
        expect(WINGS.root[0]).toBeLessThan(CHRYSALIS.radius * 1.2);
    });

    it('never dips a wing in the lake, however far it has opened and whatever its stroke', () => {
        const found = { lowest: Infinity, finite: true };
        for (const w of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
            for (const beat of [0, 0.4, -0.4]) {
                eachWingPoint(40, (kind, an, v) => {
                    const p = wingPoint(kind, 1, an, v, w, beat);
                    if (!p.every(Number.isFinite)) found.finite = false;
                    found.lowest = Math.min(found.lowest, p[1]);
                });
            }
        }
        expect(found.finite).toBe(true);
        // A hindwing hangs toward the water and stops short of it.
        expect(found.lowest).toBeGreaterThan(0);
        expect(found.lowest).toBeLessThan(WINGS.root[1]);
    });

    it('opens the forewings upward and outward and hangs the hindwings below the shoulder', () => {
        const foreTip = wingPoint(0, 1, 1, 1);
        expect(foreTip[1]).toBeGreaterThan(WINGS.root[1]);
        expect(foreTip[0]).toBeGreaterThan(WINGS.root[0] + WINGS.span * 0.5);
        // Its length is the span.
        const length = Math.hypot(foreTip[0] - WINGS.root[0], foreTip[1] - WINGS.root[1]);
        expect(length).toBeCloseTo(WINGS.span * wingOutline(0, 1), 9);
        let highestHind = -Infinity;
        eachWingPoint(20, (kind, an, v) => {
            if (kind === 1 && v > 0) highestHind = Math.max(highestHind, wingPoint(1, 1, an, v)[1]);
        });
        expect(highestHind).toBeLessThan(WINGS.root[1]);
    });

    it('fans a wing out and lengthens it as it unfurls', () => {
        expect(wingShape(0)).toBe(0);
        expect(wingShape(1)).toBe(1);
        expect(wingShape(-4)).toBe(0);
        expect(wingShape(9)).toBe(1);
        const reach = (kind, an, v, w) => {
            const p = wingPoint(kind, 1, an, v, w, 0);
            return Math.hypot(p[0] - WINGS.root[0], p[1] - WINGS.root[1]);
        };
        let previousShape = -1;
        const shrank = [];
        for (let i = 0; i <= 20; i++) {
            const w = i / 20;
            expect(wingShape(w)).toBeGreaterThanOrEqual(previousShape);
            previousShape = wingShape(w);
            eachWingPoint(6, (kind, an, v) => {
                const shorter = i > 0 && reach(kind, an, v, w) < reach(kind, an, v, (i - 1) / 20) - 1e-9;
                if (shorter) shrank.push([kind, an, v, w]);
            });
        }
        expect(shrank).toEqual([]);
        // The shape is there early: half unfurled, the fan has more than half spread.
        expect(wingShape(0.5)).toBeGreaterThan(0.5);
    });

    it('turns a wing toward the viewer on a stroke, its tip lagging', () => {
        for (const kind of [0, 1]) {
            const still = wingPoint(kind, 1, 0.6, 1, 1, 0);
            expect(still[2]).toBe(WINGS.root[2]);
            const tip = wingPoint(kind, 1, 0.6, 1, 1, 0.3);
            const mid = wingPoint(kind, 1, 0.6, 0.5, 1, 0.3);
            expect(tip[2]).toBeGreaterThan(mid[2]);
            expect(mid[2]).toBeGreaterThan(WINGS.root[2]);
            // A stroke does not lift or lower it, and both wings come forward together.
            expect(tip[1]).toBe(still[1]);
            expect(wingPoint(kind, -1, 0.6, 1, 1, 0.3)[2]).toBe(tip[2]);
            // The other way it goes back.
            expect(wingPoint(kind, 1, 0.6, 1, 1, -0.3)[2]).toBeLessThan(WINGS.root[2]);
        }
    });

    it('keeps the open wings at rest inside a 16:9 frame', () => {
        // Asserted margin: every point of all four wings, fully open and still, is at least 2 % of
        // the frame inside its edges at 16:9 (the frame the picture is composed in).
        for (const [width, height] of WIDE) {
            const aspect = width / height;
            const box = {
                x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, nearest: Infinity,
            };
            for (const side of [-1, 1]) {
                eachWingPoint(48, (kind, an, v) => {
                    const s = project(wingPoint(kind, side, an, v, 1, 0), aspect);
                    box.nearest = Math.min(box.nearest, s.depth);
                    box.x0 = Math.min(box.x0, s.x);
                    box.x1 = Math.max(box.x1, s.x);
                    box.y0 = Math.min(box.y0, s.y);
                    box.y1 = Math.max(box.y1, s.y);
                });
            }
            const label = `${width}x${height}`;
            expect(box.nearest, label).toBeGreaterThan(0);
            expect(box.x0, label).toBeGreaterThan(0.02);
            expect(box.x1, label).toBeLessThan(0.98);
            expect(box.y0, label).toBeGreaterThan(0.02);
            expect(box.y1, label).toBeLessThan(0.98);
            // They are the width of the picture: the open wings span most of the frame.
            expect(box.x1 - box.x0, label).toBeGreaterThan(0.6);
            expect(box.x0 + box.x1, label).toBeCloseTo(1, 9);
        }
    });

    it('unfurls a step for every clear of a chain, from nothing to full', () => {
        expect(wingForCombo(0)).toBe(0);
        expect(WING_STEPS[0]).toBe(0);
        expect(WING_STEPS[WING_STEPS.length - 1]).toBe(1);
        let previous = 0;
        for (let n = 1; n < WING_STEPS.length; n++) {
            expect(wingForCombo(n), `combo ${n}`).toBeGreaterThan(previous);
            expect(wingForCombo(n), `combo ${n}`).toBeLessThanOrEqual(1);
            previous = wingForCombo(n);
        }
        // Full from its last step on.
        for (const n of [WING_STEPS.length - 1, WING_STEPS.length, WING_STEPS.length + 1, 40, 1e6]) {
            expect(wingForCombo(n), `combo ${n}`).toBe(1);
        }
        // Halves round, and a chain cannot be negative.
        expect(wingForCombo(2.4)).toBe(wingForCombo(2));
        expect(wingForCombo(2.6)).toBe(wingForCombo(3));
        expect(wingForCombo(-3)).toBe(0);
        // The eyes open inside the steps, the hindwings' first.
        expect(EYE_COMBO.hind).toBeGreaterThan(0);
        expect(EYE_COMBO.fore).toBeGreaterThan(EYE_COMBO.hind);
        expect(EYE_COMBO.fore).toBeLessThan(WING_STEPS.length);
    });

    it('shows light past both edges of the solo card on the very first clear of a chain', () => {
        // The wing is written outward from the root: with the chain at `combo`, everything nearer
        // the root than v = wingForCombo(combo) is lit. The card is all but opaque, so a step
        // counts only for what it shows beside the card.
        const first = wingForCombo(1);
        expect(first).toBeGreaterThan(0);
        for (const [width, height] of [...WIDE, [3440, 1440], ...PHONES]) {
            const aspect = width / height;
            const card = cardUnion(fallbackLayout(width, height));
            let right = -Infinity;
            let left = Infinity;
            eachWingPoint(60, (kind, an, v) => {
                right = Math.max(right, project(wingPoint(kind, 1, an, v * first, first, 0), aspect).x);
                left = Math.min(left, project(wingPoint(kind, -1, an, v * first, first, 0), aspect).x);
            });
            const label = `${width}x${height}: lit to ${right.toFixed(4)}, card to ${card.x1.toFixed(4)}`;
            expect(right, label).toBeGreaterThan(card.x1);
            expect(left, label).toBeLessThan(card.x0);
        }
    });

    it('charges the chrysalis with the chain, never quite to full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(NaN)).toBe(0);
        let previous = 0;
        for (let n = 1; n <= 40; n++) {
            expect(powerForCombo(n)).toBeGreaterThan(previous);
            expect(powerForCombo(n)).toBeLessThan(1);
            previous = powerForCombo(n);
        }
        expect(powerForCombo(40)).toBeGreaterThan(0.99);
    });
});

describe('vesper chrysalis core: the lantern lilies', () => {
    const tiers = QUALITY_NAMES.map((name) => [name, QUALITY[name].blooms]);

    it('floats as many lilies as it is asked for, the same ones every time, a tier keeping the first', () => {
        const all = planBlooms();
        expect(all).toHaveLength(BLOOM_MAX);
        expect(planBlooms(BLOOM_MAX)).toEqual(all);
        for (const [name, count] of tiers) {
            expect(count, name).toBeLessThanOrEqual(BLOOM_MAX);
            const plan = planBlooms(count);
            expect(plan, name).toHaveLength(count);
            // Listed by importance: a tier floats the first N of the same lake.
            expect(plan, name).toEqual(all.slice(0, count));
        }
        expect(planBlooms(0)).toEqual([]);
        // Another seed floats them elsewhere.
        const other = planBlooms(BLOOM_MAX, 99);
        expect(other).toHaveLength(BLOOM_MAX);
        expect(other).not.toEqual(all);
        for (const b of all) {
            expect([b.x, b.z, b.size, b.seed].every(Number.isFinite)).toBe(true);
            expect(b.size).toBeGreaterThan(0);
            expect(b.seed).toBeGreaterThanOrEqual(0);
            expect(b.seed).toBeLessThan(1);
        }
    });

    it('alternates sides, so every tier lights both sides of the board alike', () => {
        const all = planBlooms();
        all.forEach((b, i) => {
            expect(b.side, `lily ${i}`).toBe(i % 2 === 0 ? -1 : 1);
            expect(Math.sign(b.x), `lily ${i}`).toBe(b.side);
            expect(b.z, `lily ${i}`).toBeLessThan(0); // in front of the viewer
        });
        for (const [name, count] of tiers) {
            const plan = all.slice(0, count);
            const left = plan.filter((b) => b.side < 0).length;
            expect(Math.abs(left - (count - left)), name).toBeLessThanOrEqual(1);
            // A hard drop sends moths to two lilies on its side and one on the other.
            expect(left, name).toBeGreaterThanOrEqual(2);
            expect(count - left, name).toBeGreaterThanOrEqual(2);
        }
    });

    it('keeps the lilies apart: no two touch, and none lies under the chrysalis', () => {
        const all = planBlooms();
        let nearest = Infinity;
        for (let i = 0; i < all.length; i++) {
            for (let k = i + 1; k < all.length; k++) {
                const apart = Math.hypot(all[i].x - all[k].x, all[i].z - all[k].z);
                // A lily's petals reach about its size from its centre.
                expect(apart, `lilies ${i} and ${k}`).toBeGreaterThan(all[i].size + all[k].size);
                nearest = Math.min(nearest, apart);
            }
            const fromChrysalis = Math.hypot(all[i].x - CHRYSALIS.x, all[i].z - CHRYSALIS.z);
            expect(fromChrysalis, `lily ${i}`).toBeGreaterThan(CHRYSALIS.radius * 2);
        }
        expect(nearest).toBeGreaterThan(2 * Math.max(...all.map((b) => b.size)));
    });

    it('floats every lily inside a 16:9 frame, clear of the solo card and no higher on screen than y = 0.6', () => {
        const all = planBlooms();
        for (const [width, height] of WIDE) {
            const card = cardUnion(fallbackLayout(width, height));
            const inside = (rect, s) => s.x > rect.x0 && s.x < rect.x1 && s.y > rect.y0 && s.y < rect.y1;
            all.forEach((b, i) => {
                const label = `${width}x${height} lily ${i}`;
                // Its pad on the water, and its heart (the lantern stands about half its size above it).
                for (const height0 of [0, b.size * 0.5]) {
                    const s = project([b.x, height0, b.z], width / height);
                    expect(inFrame(s, 0.01), label).toBe(true);
                    expect(inside(card, s), label).toBe(false);
                    // The lilies lie in the lower part of the picture: under the solo stats bar
                    // (which in the game ends about half way down), not behind it.
                    expect(s.y, label).toBeGreaterThan(0.6);
                    // On its own side of the card, and on the lake: below the horizon.
                    if (b.side < 0) expect(s.x, label).toBeLessThan(card.x0);
                    else expect(s.x, label).toBeGreaterThan(card.x1);
                    expect(s.y, label).toBeGreaterThan(project([0, 0, -5000], width / height).y);
                }
            });
        }
    });

    it('recedes: the first lilies are the nearest, and the far ones are still on this side of the far shore', () => {
        const all = planBlooms();
        const depth = (b) => -b.z;
        const pairs = all.length / 2;
        // Row by row: the mean depth of the first third is less than that of the last third.
        const mean = (list) => list.reduce((sum, b) => sum + depth(b), 0) / list.length;
        expect(mean(all.slice(0, Math.floor(pairs / 3) * 2))).toBeLessThan(mean(all.slice(-Math.floor(pairs / 3) * 2)));
        for (const b of all) {
            // Beyond the reeds at the viewer's feet, and never beyond where a swell still reaches in its lifetime.
            expect(depth(b)).toBeGreaterThan(10);
            expect(swellPassTime(b.x, b.z)).toBeLessThan(4);
        }
    });

    it('keeps a lily in view on either side of the card on an upright phone, at every tier', () => {
        // core.js says of planBlooms: "every third one close enough to the card that a tall phone
        // screen still shows it". A lock's moth flies to a lily on the piece's side: with none of
        // that side's lilies in the frame the whole answer to a lock happens off screen.
        for (const [width, height] of PHONES) {
            const card = cardUnion(fallbackLayout(width, height));
            for (const [name, count] of tiers) {
                const shown = { '-1': 0, 1: 0 };
                planBlooms(count).forEach((b) => {
                    const s = project([b.x, b.size * 0.5, b.z], width / height);
                    const beside = b.side < 0 ? s.x < card.x0 : s.x > card.x1;
                    if (inFrame(s) && beside) shown[b.side] += 1;
                });
                expect(shown['-1'], `${width}x${height} ${name}: left`).toBeGreaterThan(0);
                expect(shown[1], `${width}x${height} ${name}: right`).toBeGreaterThan(0);
            }
        }
    });

    it('opens a lily smoothly from the light it held, and lets the light fade', () => {
        // Continuous at the moment of a change: nothing jumps when a moth lands.
        expect(bloomLevel(0.4, 1.3, 0)).toBe(0.4);
        expect(bloomLevel(0.4, 1.3, -5)).toBe(0.4);
        expect(bloomLevel(0.4, 1.3, 1e-9)).toBeCloseTo(0.4, 6);
        expect(bloomLevel(0, 0.9, 1e-9)).toBeCloseTo(0, 9);
        // It rises to what the moth brought in BLOOM_RISE seconds, monotonically...
        let previous = 0;
        for (let i = 1; i <= 50; i++) {
            const level = bloomLevel(0, 0.9, (BLOOM_RISE * i) / 50);
            expect(level).toBeGreaterThan(previous);
            expect(level).toBeLessThanOrEqual(0.9);
            previous = level;
        }
        expect(bloomLevel(0, 0.9, BLOOM_RISE)).toBeCloseTo(0.9 * Math.exp(-BLOOM_RISE / BLOOM_HOLD), 12);
        // ...then falls to 1/e of it every BLOOM_HOLD seconds, for ever.
        const lit = bloomLevel(0, 0.9, BLOOM_RISE);
        expect(bloomLevel(0, 0.9, BLOOM_RISE + BLOOM_HOLD) / lit).toBeCloseTo(Math.exp(-1), 12);
        expect(bloomLevel(0, 0.9, BLOOM_RISE + 3 * BLOOM_HOLD) / lit).toBeCloseTo(Math.exp(-3), 12);
        previous = lit;
        for (let i = 1; i <= 60; i++) {
            const level = bloomLevel(0, 0.9, BLOOM_RISE + i);
            expect(level).toBeLessThan(previous);
            expect(level).toBeGreaterThan(0);
            previous = level;
        }
        expect(bloomLevel(0, 0.9, 1e4)).toBeLessThan(1e-12);
        // Letting go (a clear's swell) falls just as smoothly, to the share it keeps.
        previous = 1;
        for (let i = 1; i <= 50; i++) {
            const level = bloomLevel(1, BLOOM_KEEP, (BLOOM_RISE * i) / 50);
            expect(level).toBeLessThan(previous);
            previous = level;
        }
        expect(previous).toBeCloseTo(BLOOM_KEEP * Math.exp(-BLOOM_RISE / BLOOM_HOLD), 12);
        // A lily never shows more than the greater of what it had and what it is given.
        for (const [from, to] of [[0, BLOOM_FULL], [BLOOM_FULL, 0], [1, 1], [0.2, 0.9]]) {
            for (let age = 0; age < 3; age += 0.01) {
                expect(bloomLevel(from, to, age)).toBeLessThanOrEqual(Math.max(from, to) + 1e-12);
                expect(bloomLevel(from, to, age)).toBeGreaterThanOrEqual(0);
            }
        }
        expect(BLOOM_KEEP).toBeGreaterThan(0);
        expect(BLOOM_KEEP).toBeLessThan(1);
        expect(BLOOM_FULL).toBeGreaterThan(1);
        // It opens in less time than its moth is in the air, and holds its light far longer.
        expect(BLOOM_HOLD).toBeGreaterThan(BLOOM_RISE * 10);
    });
});

describe('vesper chrysalis core: rings and swells', () => {
    it('spreads a ring fast, then ever slower, to its reach and no further', () => {
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(-3)).toBe(0);
        let previous = 0;
        let stride = Infinity;
        for (let age = 0.25; age <= 12; age += 0.25) {
            const radius = ringRadius(age);
            expect(radius).toBeGreaterThan(previous);
            expect(radius).toBeLessThan(RING_REACH);
            expect(radius - previous).toBeLessThan(stride);
            stride = radius - previous;
            previous = radius;
        }
        expect(ringRadius(1e3)).toBeCloseTo(RING_REACH, 9);
        // A reach is a share of RING_REACH.
        expect(ringRadius(1.3, 2.4)).toBeCloseTo(ringRadius(1.3) * 2.4, 12);
        expect(ringRadius(1.3, 0)).toBe(0);
    });

    it('times a swell\'s first front by the distance from under the chrysalis', () => {
        expect(swellPassTime(SWELL_ORIGIN[0], SWELL_ORIGIN[1])).toBe(0);
        expect(swellPassTime(SWELL_ORIGIN[0] + SWELL_SPEED, SWELL_ORIGIN[1])).toBeCloseTo(1, 12);
        expect(swellPassTime(SWELL_ORIGIN[0], SWELL_ORIGIN[1] + 2 * SWELL_SPEED)).toBeCloseTo(2, 12);
        expect(swellPassTime(SWELL_ORIGIN[0] - 30, SWELL_ORIGIN[1] + 40)).toBeCloseTo(50 / SWELL_SPEED, 12);
        // The same on either side of the lake.
        expect(swellPassTime(-17, -31)).toBe(swellPassTime(17, -31));
        // It reaches the viewer's feet in a couple of seconds at most.
        expect(swellPassTime(EYE.x, EYE.z)).toBeLessThan(3);
    });
});

describe('vesper chrysalis core: the crystal stands', () => {
    it('raises two stands at the edges of the view, each about its one tall crystal', () => {
        for (const perSide of [...new Set(QUALITY_NAMES.map((name) => QUALITY[name].spires))]) {
            const spires = planSpires(perSide);
            expect(spires).toHaveLength(perSide * 2);
            expect(planSpires(perSide)).toEqual(spires);
            for (const side of [-1, 1]) {
                const stand = spires.filter((c) => c.side === side);
                expect(stand).toHaveLength(perSide);
                expect(stand.filter((c) => c.main)).toHaveLength(1);
                const tallest = stand.reduce((a, b) => (b.height > a.height ? b : a));
                expect(tallest.main).toBe(true);
                for (const c of stand) {
                    expect([c.x, c.z, c.height, c.radius, c.seed, ...c.lean].every(Number.isFinite)).toBe(true);
                    expect(Math.sign(c.x)).toBe(side);
                    expect(c.height).toBeGreaterThan(0);
                    expect(c.radius).toBeGreaterThan(0);
                    // Taller than it is wide, and never leaning so far that it lies down.
                    expect(c.height).toBeGreaterThan(c.radius * 2);
                    expect(Math.hypot(c.lean[0], c.lean[1])).toBeLessThan(0.6);
                    // Its top, where the silk can be made fast, is on its own axis — the way it
                    // leans — its whole height from its foot on the water.
                    const tip = spireTip(c);
                    const along = [tip[0] - c.x, tip[1], tip[2] - c.z];
                    expect(Math.hypot(...along)).toBeCloseTo(c.height, 9);
                    expect(along[1]).toBeGreaterThan(0);
                    expect(along[0] / along[1]).toBeCloseTo(c.lean[0], 12);
                    expect(along[2] / along[1]).toBeCloseTo(c.lean[1], 12);
                    // A leaning crystal's top is lower than its length.
                    expect(tip[1]).toBeLessThanOrEqual(c.height);
                    // In the 16:9 frame, beside the card, from foot to top.
                    for (const [width, height] of WIDE) {
                        const card = cardUnion(fallbackLayout(width, height));
                        const top = project(tip, width / height);
                        expect(top.depth).toBeGreaterThan(0);
                        if (c.main) {
                            expect(inFrame(top), `main crystal ${side} at ${width}x${height}`).toBe(true);
                            if (side < 0) expect(top.x).toBeLessThan(card.x0);
                            else expect(top.x).toBeGreaterThan(card.x1);
                        }
                    }
                }
            }
            // A tier with fewer crystals keeps the same first ones on each side.
            const out = [0, 0, 0];
            expect(spireTip(spires[0], out)).toBe(out);
        }
        // Another seed grows other stands.
        expect(planSpires(6, 5)).not.toEqual(planSpires(6));
    });
});

describe('vesper chrysalis core: colour', () => {
    it('turns an sRGB hex into scene-linear light', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff)).toEqual([1, 1, 1]);
        const [r, g, b] = linRGB(0xff8000);
        expect(r).toBe(1);
        expect(b).toBe(0);
        // Linear light is darker than its code value in the mid tones.
        expect(g).toBeGreaterThan(0.18);
        expect(g).toBeLessThan(0.25);
        let previous = -1;
        for (let v = 0; v <= 255; v++) {
            const linear = linRGB(v)[2];
            expect(linear).toBeGreaterThan(previous);
            previous = linear;
        }
    });

    it('reads a piece colour as a hex string or a number, peak-normalised, with a floor in every channel', () => {
        const forms = [pieceColor('#ff3060'), pieceColor('ff3060'), pieceColor('  #FF3060 '), pieceColor(0xff3060)];
        for (const rgb of forms) expect(rgb).toEqual(forms[0]);
        const colours = [
            0xff3060, 0x00f0f0, 0xf0f000, 0xa000f0, 0x00f000, 0xf00000, 0x0000f0, 0xf0a000, 0x808080, 0xffffff,
        ];
        for (const hex of colours) {
            const rgb = pieceColor(hex);
            const linear = linRGB(hex);
            expect(rgb).toHaveLength(3);
            expect(rgb.every(Number.isFinite), hex.toString(16)).toBe(true);
            // Its brightest channel is 1: every piece's light is as strong as any other's.
            expect(Math.max(...rgb), hex.toString(16)).toBeCloseTo(1, 12);
            // No channel is empty: a pure primary still reaches all three channels of the bloom.
            expect(Math.min(...rgb), hex.toString(16)).toBeGreaterThan(0.01);
            // The hue is kept: the channels stay in the order the colour has them.
            for (let a = 0; a < 3; a++) {
                for (let b = 0; b < 3; b++) {
                    if (linear[a] > linear[b]) expect(rgb[a], hex.toString(16)).toBeGreaterThan(rgb[b]);
                    if (linear[a] === linear[b]) expect(rgb[a], hex.toString(16)).toBeCloseTo(rgb[b], 12);
                }
            }
        }
        // A pale colour is pushed toward its own hue: its weakest channel sinks.
        const pale = linRGB(0xffc0c0);
        expect(pieceColor(0xffc0c0)[1]).toBeLessThan(pale[1] / pale[0]);
    });

    it('gives the fallback colour for anything it cannot read', () => {
        const fallback = pieceColor(undefined);
        expect(fallback.every((c) => Number.isFinite(c) && c > 0 && c <= 1)).toBe(true);
        expect(Math.max(...fallback)).toBeCloseTo(1, 12);
        const unreadable = [
            null, '', 'nope', '#fff', '#12345', '#1234567', 'rgb(1,2,3)', NaN, Infinity, -Infinity, {}, [], true,
            () => 0,
        ];
        for (const bad of unreadable) expect(pieceColor(bad), String(bad)).toEqual(fallback);
        // The caller may name its own fallback.
        expect(pieceColor(null, 0x00ff00)).toEqual(pieceColor(0x00ff00));
        expect(pieceColor('zzz', 0x00ff00)).toEqual(pieceColor('#00ff00'));
        // Never a NaN, even for black (which has no hue to normalise).
        expect(pieceColor(0x000000).every(Number.isFinite)).toBe(true);
        expect(pieceColor('#000000').every((c) => c >= 0 && c <= 1)).toBe(true);
    });

    it('gives every hour of the evening every colour the shaders read', () => {
        expect(VESPER_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(VESPER_PALETTES.map((p) => p.name)).size).toBe(VESPER_PALETTES.length);
        expect(new Set(PALETTE_KEYS).size).toBe(PALETTE_KEYS.length);
        for (const palette of VESPER_PALETTES) {
            expect(typeof palette.name).toBe('string');
            expect(palette.name.length).toBeGreaterThan(0);
            expect(Object.isFrozen(palette)).toBe(true);
            for (const key of PALETTE_KEYS) {
                const colour = palette[key];
                expect(Array.isArray(colour), `${palette.name}.${key}`).toBe(true);
                expect(colour, `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of colour) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                    expect(channel, `${palette.name}.${key}`).toBeLessThanOrEqual(1);
                }
            }
            // And nothing the keys do not name, but its name and how far into the night it is.
            expect(Object.keys(palette).sort(), palette.name).toEqual([...PALETTE_KEYS, 'name', 'night'].sort());
            expect(palette.night, palette.name).toBeGreaterThanOrEqual(0);
            expect(palette.night, palette.name).toBeLessThanOrEqual(1);
            // The lake and the mountains are the dark of the picture: the sky's glow is brighter.
            const peak = (key) => Math.max(...palette[key]);
            expect(peak('glow'), palette.name).toBeGreaterThan(peak('deep'));
            expect(peak('glow'), palette.name).toBeGreaterThan(peak('range'));
        }
        // The hours are different evenings, not one repeated.
        for (let i = 1; i < VESPER_PALETTES.length; i++) {
            expect(VESPER_PALETTES[i].horizon).not.toEqual(VESPER_PALETTES[0].horizon);
        }
        expect(VESPERFIRE).toHaveLength(3);
        expect(VESPERFIRE.every((c) => c > 0 && c <= 1)).toBe(true);
        expect(Math.max(...VESPERFIRE)).toBe(1);
        expect(TAU).toBeCloseTo(Math.PI * 2, 12);
    });
});

describe('vesper chrysalis core: the hour of the evening', () => {
    it('is the level\'s hour moved on by the clock, an hour every HOUR_SECONDS', () => {
        expect(HOUR_SECONDS).toBeGreaterThanOrEqual(60); // slowly: a minute an hour at the very least
        expect(hourAt(1, 0)).toBe(0);
        expect(hourAt(3, 0)).toBe(2);
        expect(hourAt(1, HOUR_SECONDS)).toBeCloseTo(1, 12);
        expect(hourAt(4, HOUR_SECONDS * 2.5)).toBeCloseTo(5.5, 12);
        // Held still it is the level's own hour whatever the clock says.
        expect(hourAt(4, HOUR_SECONDS * 2.5, false)).toBe(3);
        // It only ever moves on, and nonsense is the first level at the start of time.
        for (let t = 0, previous = -1; t < HOUR_SECONDS * 8; t += 7) {
            expect(hourAt(2, t)).toBeGreaterThan(previous);
            previous = hourAt(2, t);
        }
        for (const junk of [NaN, undefined, -4, 'x', Infinity]) {
            expect(hourAt(junk, junk), String(junk)).toBe(0);
        }
    });

    it('blends each hour into the next without a jump, and comes round again', () => {
        const flat = (palette) => [...PALETTE_KEYS.flatMap((key) => palette[key]), palette.night];
        // A whole hour is that palette exactly; the hours cycle in both directions.
        VESPER_PALETTES.forEach((palette, i) => {
            flat(paletteAt(i)).forEach((v, k) => expect(v, palette.name).toBeCloseTo(flat(palette)[k], 12));
            const own = flat(palette);
            flat(paletteAt(i + VESPER_PALETTES.length * 3)).forEach((v, k) => expect(v).toBeCloseTo(own[k], 9));
            flat(paletteAt(i - VESPER_PALETTES.length)).forEach((v, k) => expect(v).toBeCloseTo(own[k], 9));
        });
        // Between two hours every channel lies between theirs, half way at the half hour.
        const half = flat(paletteAt(2.5));
        const a = flat(VESPER_PALETTES[2]);
        const b = flat(VESPER_PALETTES[3]);
        half.forEach((v, k) => expect(v).toBeCloseTo((a[k] + b[k]) / 2, 12));
        // The last hour blends into the first.
        const round = flat(paletteAt(VESPER_PALETTES.length - 0.5));
        const last = flat(VESPER_PALETTES[VESPER_PALETTES.length - 1]);
        const first = flat(VESPER_PALETTES[0]);
        round.forEach((v, k) => expect(v).toBeCloseTo((last[k] + first[k]) / 2, 12));
        // No jump anywhere round the cycle: a hundredth of an hour moves no channel far, and it
        // moves slowest at a whole hour, so each hour is itself for a while.
        let largest = 0;
        for (let h = 0; h < VESPER_PALETTES.length; h += 0.01) {
            const here = flat(paletteAt(h));
            const next = flat(paletteAt(h + 0.01));
            largest = Math.max(largest, ...here.map((v, k) => Math.abs(next[k] - v)));
        }
        expect(largest).toBeLessThan(0.02);
        const nearWhole = flat(paletteAt(1.05)).map((v, k) => Math.abs(v - flat(VESPER_PALETTES[1])[k]));
        const nearHalf = flat(paletteAt(1.55)).map((v, k) => Math.abs(v - flat(paletteAt(1.5))[k]));
        expect(Math.max(...nearWhole)).toBeLessThan(Math.max(...nearHalf));
        // It writes into the object it is given (the world reuses one), and survives nonsense.
        const out = {};
        expect(paletteAt(0.3, out)).toBe(out);
        const kept = out.horizon;
        paletteAt(4.2, out);
        expect(out.horizon).toBe(kept);
        flat(paletteAt(NaN)).forEach((v, k) => expect(v).toBe(flat(VESPER_PALETTES[0])[k]));
    });
});
