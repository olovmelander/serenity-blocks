import { describe, expect, it } from 'vitest';
import {
    CLEAR_SLOTS, GALAXY, GALAXY_PALETTES, LOCK_SLOTS, PALETTE_KEYS, RIPPLE_REACH, SEED_SLOTS, STARFIRE, STORE_HOLD,
    STORE_MAX, TAU, WAVE_REACH, WAVE_TRAVEL, approach, armAngle, armStrength, clamp01, discProfile, epochFor,
    galaxyAnchors, heldAt, lerp, linRGB, mulberry32, pieceColor, powerForCombo, rippleRadius, smooth, wavePassTime,
    waveRadius,
} from '../../src/themes/galaxy/galaxy-core.js';
import {
    MAX_GIANTS, MAX_NURSERIES, MAX_STARS, NURSERY_OFFSET, buildPlan, nurseryPosition,
} from '../../src/themes/galaxy/galaxy-plan.js';
import { NOISE_SIZE, bakeNoise, sampleNoise } from '../../src/themes/galaxy/galaxy-tsl.js';
import {
    BOARD_GRID, PLAYER_SLOTS, boardFor, boardPoint, cardUnion, fallbackLayout, layoutsDiffer,
} from '../../src/themes/galaxy/galaxy-composition.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/galaxy/galaxy-quality.js';
import { POST_LOOK } from '../../src/themes/galaxy/galaxy-post.js';

/** Enough suns to judge the populations by, few enough to build in a blink. */
const SAMPLE = 20000;
const plan = buildPlan(undefined, { stars: SAMPLE });
const noise = bakeNoise();

/** Indices of the suns of one population (`look.z`). */
function population(stars, pop) {
    const out = [];
    for (let i = 0; i < stars.count; i++) if (stars.look[i * 4 + 2] === pop) out.push(i);
    return out;
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Where two lists of numbers first part (−1 = they are the same, element for element). */
function firstDifference(a, b) {
    if (a.length !== b.length) return Math.min(a.length, b.length);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
    return -1;
}

/** How far an angle stands from the nearest arm's ridge (the two arms are half a turn apart). */
function offRidge(offset) {
    const half = Math.PI;
    return Math.abs(((((offset + half / 2) % half) + half) % half) - half / 2);
}

describe('galaxy core maths', () => {
    it('eases, clamps and blends', () => {
        expect(clamp01(-2)).toBe(0);
        expect(clamp01(0.3)).toBe(0.3);
        expect(clamp01(7)).toBe(1);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(1, 3, 0)).toBe(0);
        expect(smooth(1, 3, 2)).toBeCloseTo(0.5, 12);
        expect(smooth(1, 3, 9)).toBe(1);
        // The same gap closes by the same fraction however the time is cut up.
        expect(approach(3, 0)).toBe(0);
        const whole = approach(3, 0.2);
        const halves = 1 - (1 - approach(3, 0.1)) ** 2;
        expect(halves).toBeCloseTo(whole, 12);
        expect(approach(3, 100)).toBeCloseTo(1, 9);
    });

    it('winds an arm round the nucleus: its ridge turns with the logarithm of the radius', () => {
        expect(armAngle(GALAXY.armStart)).toBe(0);
        // Every e-fold of radius turns the ridge by the winding.
        expect(armAngle(GALAXY.armStart * Math.E)).toBeCloseTo(GALAXY.winding, 9);
        expect(armAngle(GALAXY.armStart * Math.E * Math.E)).toBeCloseTo(GALAXY.winding * 2, 9);
        expect(armAngle(60)).toBeGreaterThan(armAngle(30));
        // Wound tighter, an outer point turns further than an inner one.
        const inner = armAngle(20, GALAXY.winding + 0.5) - armAngle(20);
        const outer = armAngle(80, GALAXY.winding + 0.5) - armAngle(80);
        expect(inner).toBeGreaterThan(0);
        expect(outer).toBeGreaterThan(inner);
        // Inside the bar the ridge holds still: nothing spins up toward the centre.
        expect(armAngle(0)).toBe(armAngle(GALAXY.armStart * 0.5));
        expect(armAngle(-3)).toBe(armAngle(GALAXY.armStart * 0.25));
        expect(Number.isFinite(armAngle(0))).toBe(true);
    });

    it('knows how deep in an arm a point is: 1 on a ridge, 0 between two', () => {
        for (const radius of [12, 40, 90]) {
            const ridge = armAngle(radius);
            expect(armStrength(radius, ridge)).toBeCloseTo(1, 12);
            // The other arm stands half a turn round.
            expect(armStrength(radius, ridge + TAU / GALAXY.arms)).toBeCloseTo(1, 12);
            expect(armStrength(radius, ridge + TAU / GALAXY.arms / 2)).toBeCloseTo(0, 12);
            // A sharper ridge is a narrower one.
            const beside = ridge + 0.3;
            expect(armStrength(radius, beside, 6)).toBeLessThan(armStrength(radius, beside, 2));
            expect(armStrength(radius, beside)).toBeGreaterThan(0);
            expect(armStrength(radius, beside)).toBeLessThan(1);
        }
        // The pattern follows the winding it is given.
        expect(armStrength(50, armAngle(50, 4), 3, 4)).toBeCloseTo(1, 12);
    });

    it('fades the disc outward and ends it softly at the rim', () => {
        let previous = discProfile(0);
        expect(previous).toBeCloseTo(1, 12);
        for (let radius = 5; radius <= GALAXY.radius * 1.2; radius += 5) {
            const light = discProfile(radius);
            expect(light).toBeLessThanOrEqual(previous);
            expect(light).toBeGreaterThanOrEqual(0);
            previous = light;
        }
        // One scale length in, the light has fallen to 1/e.
        expect(discProfile(GALAXY.scaleLength)).toBeCloseTo(Math.exp(-1), 9);
        expect(discProfile(GALAXY.radius * 0.5)).toBeGreaterThan(0);
        expect(discProfile(GALAXY.radius * 1.2)).toBe(0);
    });

    it('grows a lock ripple fast, then settles it inside its reach', () => {
        expect(rippleRadius(-1)).toBe(0);
        expect(rippleRadius(0)).toBe(0);
        expect(rippleRadius(0.4)).toBeGreaterThan(rippleRadius(0.2));
        expect(rippleRadius(0.2)).toBeGreaterThan(0);
        expect(rippleRadius(60)).toBeLessThanOrEqual(RIPPLE_REACH);
        expect(rippleRadius(60)).toBeGreaterThan(RIPPLE_REACH * 0.99);
    });

    it('runs a clear wave out from the nucleus through the whole disc, and knows when it passes a radius', () => {
        expect(waveRadius(-1)).toBe(0);
        expect(waveRadius(0)).toBe(0);
        expect(waveRadius(WAVE_TRAVEL)).toBeCloseTo(WAVE_REACH, 9);
        expect(waveRadius(WAVE_TRAVEL * 3)).toBeCloseTo(WAVE_REACH, 9);
        // It reaches past the rim: no sun and no nursery is left out.
        expect(WAVE_REACH).toBeGreaterThanOrEqual(GALAXY.radius);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const radius = waveRadius((WAVE_TRAVEL * i) / 20);
            expect(radius).toBeGreaterThan(previous);
            previous = radius;
        }
        // The pass time is the wave's inverse: a nursery lets go exactly as the front arrives.
        for (const radius of [5, 40, GALAXY.radius, WAVE_REACH]) {
            expect(waveRadius(wavePassTime(radius))).toBeCloseTo(radius, 6);
        }
        expect(wavePassTime(0)).toBe(0);
        expect(wavePassTime(-4)).toBe(0);
        expect(wavePassTime(WAVE_REACH * 10)).toBe(WAVE_TRAVEL);
        expect(wavePassTime(60)).toBeGreaterThan(wavePassTime(20));
    });

    it('charges with the combo and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(1)).toBeGreaterThan(0);
        expect(powerForCombo(5)).toBeGreaterThan(powerForCombo(2));
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
    });

    it('carries the light a nursery holds as one number, the moment it was lit', () => {
        // The epoch that holds an amount gives that amount back, at once...
        for (const amount of [0.05, 0.6, 1, STORE_MAX]) {
            expect(heldAt(epochFor(amount, 12), 12)).toBeCloseTo(amount, 9);
        }
        // ...1/e of it a hold later, and less and less after: nothing is written per frame.
        const epoch = epochFor(1, 100);
        expect(heldAt(epoch, 100 + STORE_HOLD)).toBeCloseTo(Math.exp(-1), 9);
        expect(heldAt(epoch, 100 + STORE_HOLD * 2)).toBeCloseTo(Math.exp(-2), 9);
        expect(heldAt(epoch, 130)).toBeLessThan(heldAt(epoch, 110));
        // A nursery never holds more than its fill, whatever it is given or however early it is asked.
        expect(heldAt(epochFor(STORE_MAX * 40, 12), 12)).toBeCloseTo(STORE_MAX, 9);
        expect(heldAt(epoch, -1e6)).toBe(STORE_MAX);
        // Nothing is the epoch of a nursery that was never lit: dark at any time a run can reach.
        for (const none of [0, -3, 1e-9]) {
            const dark = epochFor(none, 50);
            expect(heldAt(dark, 0)).toBe(0);
            expect(heldAt(dark, 50)).toBe(0);
            expect(heldAt(dark, 86400)).toBe(0);
        }
        expect(Number.isFinite(heldAt(epoch, 1e9))).toBe(true);
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        const a = mulberry32(7);
        const b = mulberry32(7);
        const other = mulberry32(8);
        let differs = false;
        for (let i = 0; i < 50; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            if (other() !== v) differs = true;
        }
        expect(differs).toBe(true);
    });

    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        const rose = pieceColor('#ffa8d0');
        expect(Math.max(...rose)).toBeCloseTo(1, 6);
        expect(Math.min(...rose)).toBeGreaterThanOrEqual(0.05);
        expect(rose[0]).toBeGreaterThan(rose[2]);
        expect(rose[2]).toBeGreaterThan(rose[1]);
        // A pastel is pushed toward its own hue: the weakest channel falls further than it would
        // by normalising alone.
        const plain = linRGB(0xffa8d0);
        expect(rose[1]).toBeLessThan(plain[1] / Math.max(...plain));
        expect(pieceColor(0x0000ff)[2]).toBeCloseTo(1, 6);
        expect(pieceColor('a8ffe8')).toEqual(pieceColor('#A8FFE8'));
        // Nonsense falls back to the given colour.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 6);
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
    });

    it('defines every palette key for every level\'s palette, in scene-linear light', () => {
        expect(GALAXY_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(GALAXY_PALETTES.map((p) => p.name)).size).toBe(GALAXY_PALETTES.length);
        for (const palette of GALAXY_PALETTES) {
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
            // The sky's own colour is nearly black: the galaxy is the light in the picture.
            expect(Math.max(...palette.void), palette.name).toBeLessThan(0.05);
        }
        expect(STARFIRE).toHaveLength(3);
        expect(STARFIRE.every((channel) => channel > 0 && channel <= 1)).toBe(true);
    });

    it('hangs the nucleus left of the card in a wide frame and lifts the galaxy over it on an upright phone', () => {
        const wide = galaxyAnchors(16 / 9);
        const tall = galaxyAnchors(9 / 19.5);
        // Landscape leaves the centre to the board: the nucleus burns left of the card, the
        // companion spiral stands far off on the other side.
        expect(wide.x).toBeLessThan(0.5);
        expect(wide.companion.x).toBeGreaterThan(0.5);
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080], [1280, 1024], [1024, 768]]) {
            const anchors = galaxyAnchors(width / height);
            const card = fallbackLayout(width, height).cards[0];
            expect(anchors.x, `${width}x${height}`).toBeLessThan(card.x0);
            expect(anchors.companion.x, `${width}x${height}`).toBeGreaterThan(card.x1);
        }
        // An upright phone has sky above the card: the galaxy climbs there, centred and smaller.
        expect(tall.x).toBeCloseTo(0.5, 9);
        expect(tall.y).toBeLessThan(wide.y);
        expect(tall.radius).toBeLessThan(wide.radius);
        expect(tall.companion.y).toBeLessThan(wide.companion.y);
        for (const anchors of [wide, tall, galaxyAnchors(1), galaxyAnchors(21 / 9)]) {
            for (const body of [anchors, anchors.companion]) {
                expect(body.x).toBeGreaterThan(0);
                expect(body.x).toBeLessThan(1);
                expect(body.y).toBeGreaterThan(0);
                expect(body.y).toBeLessThan(1);
                expect(body.radius).toBeGreaterThan(0);
            }
            // The companion is the far, small one.
            expect(anchors.companion.radius).toBeLessThan(anchors.radius);
            // It leans back from the line of sight, never face-on and never edge-on.
            expect(anchors.inclination).toBeGreaterThan(Math.PI / 6);
            expect(anchors.inclination).toBeLessThan(Math.PI / 2);
            expect(Number.isFinite(anchors.lean)).toBe(true);
        }
        // A square frame sits between the two.
        const square = galaxyAnchors(1);
        expect(square.y).toBeGreaterThan(tall.y);
        expect(square.y).toBeLessThan(wide.y);
        // Nonsense falls back to the landscape composition.
        expect(galaxyAnchors(NaN)).toEqual(wide);
        expect(galaxyAnchors(0)).toEqual(wide);
        expect(galaxyAnchors(undefined)).toEqual(wide);
    });
});

describe('galaxy noise field', () => {
    it('bakes four tileable channels stretched to the unit range, the same every time', () => {
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const lo = [Infinity, Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < noise.length; i++) {
            lo[i % 4] = Math.min(lo[i % 4], noise[i]);
            hi[i % 4] = Math.max(hi[i % 4], noise[i]);
        }
        for (let c = 0; c < 4; c++) {
            expect(lo[c]).toBeCloseTo(0, 5);
            expect(hi[c]).toBeCloseTo(1, 5);
        }
        const again = bakeNoise();
        for (let i = 0; i < noise.length; i += 997) expect(again[i]).toBe(noise[i]);
    });

    it('reads the field bilinearly and wraps at its edges', () => {
        for (const [x, y] of [[0.3, 0.7], [0.999, 0.001], [0, 0]]) {
            const v = sampleNoise(noise, NOISE_SIZE, x, y, 1);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(sampleNoise(noise, NOISE_SIZE, x + 1, y - 1, 1)).toBeCloseTo(v, 9);
        }
        // At a texel centre it returns the texel.
        const texel = (ix, iy, c) => noise[(iy * NOISE_SIZE + ix) * 4 + c];
        const centre = sampleNoise(noise, NOISE_SIZE, 10.5 / NOISE_SIZE, 20.5 / NOISE_SIZE, 2);
        expect(centre).toBeCloseTo(texel(10, 20, 2), 6);
    });
});

describe('galaxy plan', () => {
    it('is deterministic for a seed and different for another', () => {
        const again = buildPlan(undefined, { stars: SAMPLE });
        expect(again.seed).toBe(plan.seed);
        expect(JSON.stringify(again.nurseries)).toBe(JSON.stringify(plan.nurseries));
        expect(JSON.stringify(again.giants)).toBe(JSON.stringify(plan.giants));
        expect(firstDifference(again.stars.orbit, plan.stars.orbit)).toBe(-1);
        expect(firstDifference(again.stars.look, plan.stars.look)).toBe(-1);
        expect(again.stars.tally).toEqual(plan.stars.tally);
        // Asking for the default seed by name is the same galaxy.
        expect(JSON.stringify(buildPlan(plan.seed, { stars: 0 }).nurseries)).toBe(JSON.stringify(plan.nurseries));

        const other = buildPlan(1234, { stars: SAMPLE });
        expect(other.seed).toBe(1234);
        expect(JSON.stringify(other.nurseries)).not.toBe(JSON.stringify(plan.nurseries));
        expect(JSON.stringify(other.giants)).not.toBe(JSON.stringify(plan.giants));
        expect(firstDifference(other.stars.orbit, plan.stars.orbit)).toBeGreaterThanOrEqual(0);
        expect(firstDifference(other.stars.orbit, plan.stars.orbit)).toBeLessThan(8);
    });

    it('lists every nursery a tier can light, half on each arm, from the bar to the rim', () => {
        expect(plan.nurseries).toHaveLength(MAX_NURSERIES);
        const perArm = [0, 0];
        plan.nurseries.forEach((site, index) => {
            const label = `nursery ${index}`;
            for (const key of ['radius', 'offset', 'y', 'size', 'seed']) {
                expect(Number.isFinite(site[key]), `${label}.${key}`).toBe(true);
            }
            expect([0, 1], label).toContain(site.arm);
            perArm[site.arm] += 1;
            // Out of the bar, inside the rim, close to the plane.
            expect(site.radius, label).toBeGreaterThan(GALAXY.armStart);
            expect(site.radius, label).toBeLessThan(GALAXY.radius);
            expect(Math.abs(site.y), label).toBeLessThan(GALAXY.halfHeight);
            expect(site.size, label).toBeGreaterThan(0);
            expect(site.seed, label).toBeGreaterThanOrEqual(0);
            expect(site.seed, label).toBeLessThan(1);
            // It belongs to its own arm: nearer its ridge than the gap to the other one...
            expect(offRidge(site.offset - site.arm * Math.PI), label).toBeLessThan(Math.PI / 4);
            expect(Math.abs(site.offset - site.arm * Math.PI), label).toBeLessThan(Math.PI / 2);
        });
        expect(perArm).toEqual([MAX_NURSERIES / 2, MAX_NURSERIES / 2]);
        // ...and on its trailing edge, where the gas piles up behind the ridge.
        expect(NURSERY_OFFSET).toBeLessThan(0);
        expect(mean(plan.nurseries.map((site) => site.offset - site.arm * Math.PI))).toBeCloseTo(NURSERY_OFFSET, 1);
        // No two share a place.
        expect(new Set(plan.nurseries.map((site) => site.radius)).size).toBe(MAX_NURSERIES);
    });

    it('puts a nursery in the galaxy\'s frame on its arm, and follows the arm when it winds', () => {
        const out = [0, 0, 0];
        for (const site of plan.nurseries.slice(0, 24)) {
            expect(nurseryPosition(site, GALAXY.winding, out)).toBe(out);
            // On the disc at its own radius and height...
            expect(Math.hypot(out[0], out[2])).toBeCloseTo(site.radius, 9);
            expect(out[1]).toBe(site.y);
            // ...at its offset from the ridge of its arm, so deep in that arm.
            const angle = Math.atan2(out[2], out[0]);
            const turn = angle - armAngle(site.radius) - site.offset;
            expect(Math.abs(Math.sin(turn))).toBeLessThan(1e-9);
            expect(Math.cos(turn)).toBeCloseTo(1, 9);
            expect(armStrength(site.radius, angle, 1)).toBeGreaterThan(0.5);
            // The default winding is the galaxy's own.
            expect(nurseryPosition(site)).toEqual([out[0], out[1], out[2]]);
            // Wound tighter, it keeps its radius and its place on the ridge, and turns with it.
            const wound = nurseryPosition(site, GALAXY.winding + 0.4);
            expect(Math.hypot(wound[0], wound[2])).toBeCloseTo(site.radius, 9);
            expect(armStrength(site.radius, Math.atan2(wound[2], wound[0]), 1, GALAXY.winding + 0.4))
                .toBeCloseTo(armStrength(site.radius, angle, 1), 9);
            expect(Math.hypot(wound[0] - out[0], wound[2] - out[2])).toBeGreaterThan(0);
        }
    });

    it('keeps any prefix of the nurseries usable: both arms, bar to rim, whatever a tier draws', () => {
        const span = GALAXY.radius - GALAXY.armStart;
        for (const name of QUALITY_NAMES) {
            const count = QUALITY[name].nurseries;
            const drawn = plan.nurseries.slice(0, count);
            for (const arm of [0, 1]) {
                const radii = drawn.filter((site) => site.arm === arm).map((site) => site.radius);
                // Neither arm is left bare...
                expect(radii.length, `${name} arm ${arm}`).toBeGreaterThan(count / 4);
                // ...and each is lit along its length, not only at one end.
                expect(Math.min(...radii), `${name} arm ${arm}`).toBeLessThan(GALAXY.armStart + span * 0.3);
                expect(Math.max(...radii), `${name} arm ${arm}`).toBeGreaterThan(GALAXY.armStart + span * 0.7);
                const along = radii.map((r) => (r - GALAXY.armStart) / span);
                expect(along.filter((k) => k > 0.3 && k < 0.7).length, `${name} arm ${arm}`).toBeGreaterThan(0);
            }
        }
    });

    it('builds the suns it is asked for, every one from finite numbers', () => {
        const { stars } = plan;
        expect(stars.count).toBe(SAMPLE);
        expect(stars.orbit).toHaveLength(SAMPLE * 4);
        expect(stars.look).toHaveLength(SAMPLE * 4);
        expect(stars.orbit.every((v) => Number.isFinite(v))).toBe(true);
        expect(stars.look.every((v) => Number.isFinite(v))).toBe(true);
        const tally = [0, 0, 0, 0];
        const unit = (v) => v >= 0 && v <= 1;
        const seed = (v) => v >= 0 && v < 1;
        const odd = [];
        for (let i = 0; i < stars.count; i++) {
            const radius = stars.orbit[i * 4];
            const temp = stars.look[i * 4];
            const mag = stars.look[i * 4 + 1];
            const pop = stars.look[i * 4 + 2];
            // A place off the axis, a colour and a brightness in the unit range, one of four
            // populations, and the two per-sun seeds its twinkle and its epicycle are hashed from.
            const sound = radius > 0 && unit(temp) && unit(mag) && tally[pop] !== undefined
                && seed(stars.orbit[i * 4 + 3]) && seed(stars.look[i * 4 + 3]);
            if (!sound) odd.push(i);
            else tally[pop] += 1;
        }
        expect(odd).toEqual([]);
        expect(stars.tally).toEqual(tally);
        expect(tally.reduce((sum, n) => sum + n, 0)).toBe(SAMPLE);
        // All four populations are there, and most suns are faint: a few carry the picture.
        for (const n of tally) expect(n).toBeGreaterThan(0);
        const magnitudes = Array.from({ length: SAMPLE }, (_, i) => stars.look[i * 4 + 1]);
        expect(median(magnitudes)).toBeLessThan(0.25);
        expect(Math.max(...magnitudes)).toBeGreaterThan(0.75);
    });

    it('gives each population its place: arms, old disc, bulge and halo', () => {
        const { stars } = plan;
        const radius = (i) => stars.orbit[i * 4];
        const height = (i) => Math.abs(stars.orbit[i * 4 + 2]);
        const [arm, disc, bulge, halo] = [0, 1, 2, 3].map((pop) => population(stars, pop));

        // Arm suns are stored as an offset from their arm's ridge, and nearly all stand on one.
        const onRidge = arm.filter((i) => offRidge(stars.orbit[i * 4 + 1]) < Math.PI / 4).length;
        expect(onRidge / arm.length).toBeGreaterThan(0.9);
        // They are born outside the bar and die before they leave the disc.
        expect(Math.min(...arm.map(radius))).toBeGreaterThan(GALAXY.armStart * 0.5);
        expect(Math.max(...arm.map(radius))).toBeLessThan(GALAXY.radius * 1.2);
        // The old disc has no pattern of its own: its suns stand evenly all the way round.
        const lopsided = mean(disc.map((i) => Math.cos(GALAXY.arms * stars.orbit[i * 4 + 1])));
        expect(Math.abs(lopsided)).toBeLessThan(0.05);
        expect(Math.max(...disc.map(radius))).toBeLessThan(GALAXY.radius * 1.2);
        // Young suns are blue, old ones warm.
        const temperature = (list) => mean(list.map((i) => stars.look[i * 4]));
        expect(temperature(arm)).toBeGreaterThan(temperature(disc));
        expect(temperature(disc)).toBeGreaterThan(temperature(bulge));
        // The bulge crowds the nucleus; the disc is thin; the halo stands far out of the plane.
        expect(median(bulge.map(radius))).toBeLessThan(median(disc.map(radius)) * 0.5);
        expect(mean(arm.map(height))).toBeLessThan(GALAXY.halfHeight);
        expect(mean(disc.map(height))).toBeLessThan(GALAXY.halfHeight);
        expect(mean(halo.map(height))).toBeGreaterThan(mean(disc.map(height)) * 4);
        expect(mean(halo.map(height))).toBeGreaterThan(GALAXY.halfHeight);
    });

    it('keeps any prefix of the suns usable: the same galaxy, a fair sample of every population', () => {
        // A tier that draws fewer suns builds a shorter plan: it is the head of the longer one...
        const head = buildPlan(undefined, { stars: 3000 });
        expect(head.stars.count).toBe(3000);
        expect(firstDifference(head.stars.orbit, plan.stars.orbit.subarray(0, 3000 * 4))).toBe(-1);
        expect(firstDifference(head.stars.look, plan.stars.look.subarray(0, 3000 * 4))).toBe(-1);
        // ...round the same nurseries.
        expect(JSON.stringify(head.nurseries)).toBe(JSON.stringify(plan.nurseries));
        // And a prefix is not one population first: each keeps its share of the whole.
        const smallest = Math.min(...QUALITY_NAMES.map((name) => QUALITY[name].stars));
        for (const count of [Math.min(smallest, SAMPLE), SAMPLE / 2]) {
            const tally = [0, 0, 0, 0];
            for (let i = 0; i < count; i++) tally[plan.stars.look[i * 4 + 2]] += 1;
            for (let pop = 0; pop < 4; pop++) {
                expect(tally[pop] / count, `population ${pop} of ${count}`)
                    .toBeCloseTo(plan.stars.tally[pop] / SAMPLE, 1);
                expect(tally[pop], `population ${pop} of ${count}`).toBeGreaterThan(0);
            }
        }
    });

    it('builds no more suns than it lists, and none when asked for none', () => {
        const none = buildPlan(undefined, { stars: 0 });
        expect(none.stars.count).toBe(0);
        expect(none.stars.orbit).toHaveLength(0);
        expect(none.stars.tally).toEqual([0, 0, 0, 0]);
        expect(none.nurseries).toHaveLength(MAX_NURSERIES);
        expect(none.giants).toHaveLength(MAX_GIANTS);
        expect(buildPlan(undefined, { stars: -50 }).stars.count).toBe(0);
        expect(buildPlan(undefined, { stars: 10.4 }).stars.count).toBe(10);
        // Left to itself, or asked for too many, it builds the whole galaxy.
        const whole = buildPlan();
        expect(whole.stars.count).toBe(MAX_STARS);
        expect(buildPlan(undefined, { stars: MAX_STARS * 3 }).stars.count).toBe(MAX_STARS);
        expect(whole.stars.orbit.every((v) => Number.isFinite(v))).toBe(true);
        expect(whole.stars.look.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('keeps the foreground stars the same however many suns a tier draws', () => {
        // The sky has its own draw: a tier that builds fewer suns sees the same stars in front.
        const sky = JSON.stringify(plan.giants);
        for (const stars of [0, 1, 3000, ...QUALITY_NAMES.map((name) => QUALITY[name].stars).slice(0, 3)]) {
            expect(JSON.stringify(buildPlan(undefined, { stars }).giants), `${stars} suns`).toBe(sky);
        }
        // Another seed is another sky, and another galaxy under it.
        const other = buildPlan(1234, { stars: 0 });
        expect(JSON.stringify(other.giants)).not.toBe(sky);
        expect(JSON.stringify(other.nurseries)).not.toBe(JSON.stringify(plan.nurseries));
    });

    it('scatters the foreground stars ahead of the camera, the brightest first', () => {
        expect(plan.giants).toHaveLength(MAX_GIANTS);
        plan.giants.forEach((giant, index) => {
            expect(Math.hypot(...giant.dir), `giant ${index}`).toBeCloseTo(1, 9);
            expect(giant.dir[2], `giant ${index}`).toBeLessThan(0); // ahead: the camera looks down −z
            expect(giant.size, `giant ${index}`).toBeGreaterThan(0);
            for (const key of ['temp', 'phase']) {
                expect(giant[key], `giant ${index}.${key}`).toBeGreaterThanOrEqual(0);
                expect(giant[key], `giant ${index}.${key}`).toBeLessThan(1);
            }
            // Every tier keeps the ones that carry the sky.
            if (index > 0) expect(giant.size).toBeLessThanOrEqual(plan.giants[index - 1].size);
        });
        // They stand on both sides of the frame, above and below its middle.
        expect(plan.giants.some((giant) => giant.dir[0] < -0.2)).toBe(true);
        expect(plan.giants.some((giant) => giant.dir[0] > 0.2)).toBe(true);
        expect(plan.giants.some((giant) => giant.dir[1] < -0.1)).toBe(true);
        expect(plan.giants.some((giant) => giant.dir[1] > 0.1)).toBe(true);
    });
});

describe('galaxy composition', () => {
    it('lays out the solo board from the stylesheet\'s formulas, for any frame', () => {
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080], [1024, 768], [430, 932]]) {
            const layout = fallbackLayout(width, height);
            const card = layout.cards[0];
            const board = layout.boards[0];
            expect(layout.cardCount).toBe(0); // nothing was read from the page
            expect(layout.cards).toHaveLength(1);
            expect(layout.boards).toHaveLength(PLAYER_SLOTS);
            expect(layout.boards.slice(1).every((b) => b === null)).toBe(true);
            expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 9);
            expect((board.x0 + board.x1) / 2).toBeCloseTo(0.5, 9);
            expect(board.x0).toBeGreaterThan(card.x0);
            expect(board.x1).toBeLessThan(card.x1);
            expect(board.y0).toBeGreaterThan(card.y0);
            expect(board.y1).toBeLessThan(card.y1);
            // Ten columns by twenty rows of square cells.
            const cell = ((board.x1 - board.x0) * width) / BOARD_GRID.columns;
            expect(((board.y1 - board.y0) * height) / BOARD_GRID.rows).toBeCloseTo(cell, 6);
            // The playfield sits nearer the card's foot than its head.
            expect(card.y1 - board.y1).toBeLessThan(board.y0 - card.y0);
        }
        // Nonsense is a one-pixel window, not a division by zero.
        const tiny = fallbackLayout(0, NaN);
        expect(Object.values(tiny.cards[0]).every((v) => Number.isFinite(v))).toBe(true);
    });

    it('maps columns and rows onto a board without allocating', () => {
        const board = {
            x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9,
        };
        const out = { x: 0, y: 0 };
        expect(boardPoint(board, 0.5, 9, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.5, 9);
        // Rows are measured to their centre line, one board-height / rows apart.
        const row = (board.y1 - board.y0) / BOARD_GRID.rows;
        expect(out.y).toBeCloseTo(board.y0 + row * 9.5, 9);
        const next = boardPoint(board, 0.5, 10);
        expect(next.y - out.y).toBeCloseTo(row, 9);
        // The floor row is the last one; anything past the grid is clamped onto it.
        const floor = boardPoint(board, 0.5, BOARD_GRID.rows - 1);
        expect(boardPoint(board, -3, 400)).toEqual({ x: board.x0, y: floor.y });
        expect(boardPoint(board, 0, -7).y).toBeCloseTo(board.y0 + row * 0.5, 9);
    });

    it('joins every card on screen into one rect', () => {
        const a = {
            x0: 0.05, y0: 0.2, x1: 0.3, y1: 0.8,
        };
        const b = {
            x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.7,
        };
        const c = {
            x0: 0.65, y0: 0.25, x1: 0.95, y1: 0.9,
        };
        const layout = {
            cardCount: 3, cards: [a, b, c], hud: null, boards: new Array(PLAYER_SLOTS).fill(null),
        };
        const union = cardUnion(layout);
        expect(union).toEqual({
            x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.9,
        });
        // A copy: the first card is not widened in place.
        expect(union).not.toBe(a);
        expect(a.x1).toBe(0.3);
        expect(cardUnion({ cards: [] })).toBeNull();
        expect(cardUnion(null)).toBeNull();
        // A board for a player who has none is the first board on screen.
        layout.boards[2] = b;
        expect(boardFor(layout, 2)).toBe(b);
        expect(boardFor(layout, 0)).toBe(b);
        layout.boards[2] = null;
        expect(boardFor(layout, 0)).toBeNull();
    });

    it('tells two layout reads apart only when a rect has really moved', () => {
        const base = fallbackLayout(1600, 900);
        const copy = () => JSON.parse(JSON.stringify(base));
        expect(layoutsDiffer(base, copy())).toBe(false);
        expect(layoutsDiffer(null, null)).toBe(false);
        expect(layoutsDiffer(base, null)).toBe(true);
        expect(layoutsDiffer(null, base)).toBe(true);

        // Sub-pixel jitter is the same layout; a real move is not.
        const jitter = copy();
        jitter.cards[0].x0 += 0.001;
        jitter.boards[0].y1 -= 0.001;
        expect(layoutsDiffer(base, jitter)).toBe(false);
        expect(layoutsDiffer(base, jitter, 0.0005)).toBe(true);
        const moved = copy();
        moved.cards[0].x0 += 0.02;
        expect(layoutsDiffer(base, moved)).toBe(true);

        const boardMoved = copy();
        boardMoved.boards[0].y0 += 0.05;
        expect(layoutsDiffer(base, boardMoved)).toBe(true);
        const secondBoard = copy();
        secondBoard.boards[3] = { ...base.boards[0] };
        expect(layoutsDiffer(base, secondBoard)).toBe(true);
        const noHud = copy();
        noHud.hud = null;
        expect(layoutsDiffer(base, noHud)).toBe(true);
        const counted = copy();
        counted.cardCount = 1;
        expect(layoutsDiffer(base, counted)).toBe(true);
        const twoCards = copy();
        twoCards.cards.push({ ...base.cards[0] });
        expect(layoutsDiffer(base, twoCards)).toBe(true);
    });
});

describe('galaxy tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(POST_LOOK[name]).toBeTruthy();
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[QUALITY_NAMES[i]];
            expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
            // Counts, and the switches a lower tier does without.
            for (const key of Object.keys(a)) {
                expect(Number(b[key]), `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(Number(a[key]));
            }
            const lookA = POST_LOOK[QUALITY_NAMES[i - 1]];
            const lookB = POST_LOOK[QUALITY_NAMES[i]];
            for (const key of ['bloom', 'bloomStrength', 'bloomResolution', 'rays', 'fringe', 'ripple']) {
                expect(Number(lookB[key]), `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(Number(lookA[key]));
            }
        }
    });

    it('never asks the plan for more than it lists, and keeps the picture and every event on every tier', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(tier.stars, name).toBeLessThanOrEqual(MAX_STARS);
            expect(tier.nurseries, name).toBeLessThanOrEqual(MAX_NURSERIES);
            expect(tier.giants, name).toBeLessThanOrEqual(MAX_GIANTS);
            // Suns to see, nurseries for a lock to light, debris for a nova to throw, shooting
            // stars for a four-line clear, at least one step through the gas.
            for (const key of ['stars', 'nurseries', 'sparks', 'meteors', 'giants', 'march', 'detail', 'skyLayers']) {
                expect(tier[key], `${name}.${key}`).toBeGreaterThan(0);
                expect(Number.isInteger(tier[key]), `${name}.${key}`).toBe(true);
            }
            // The core's rays are the bloom dragged out of the nucleus: no bloom, no rays.
            const look = POST_LOOK[name];
            if (!look.bloom) expect(look.rays, name).toBe(0);
            else expect(look.bloomStrength, name).toBeGreaterThan(0);
        }
        // Room for what one piece can ask for at once: a hard drop sends three seeds and rings.
        expect(SEED_SLOTS).toBeGreaterThanOrEqual(3);
        expect(LOCK_SLOTS).toBeGreaterThanOrEqual(3);
        expect(CLEAR_SLOTS).toBeGreaterThanOrEqual(1);
    });
});
