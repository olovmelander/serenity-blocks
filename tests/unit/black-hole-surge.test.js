/**
 * Black Hole — reactions that BUILD instead of popping and resetting (the theme event surge).
 *
 * The director driven on its own clock, as in black-hole-director.test.js: every pool hands a
 * new event a free slot or the one with the least light left (a fresh landing never erases an arc
 * still burning, a cascade's fronts stack), a weak event after a strong one never cuts the light,
 * a long chain winds the hole further than its first clear (faster, hotter gold, the ring and the
 * jets ablaze, the galaxy dimmed round it), the perfect clear is a crown rather than a second
 * clear, a back-to-back has an answer of its own, and the hole breathes back when the hands rest.
 */
import { describe, expect, it } from 'vitest';
import { BlackHoleDirector, DIRECTOR_LIMITS } from '../../src/themes/black-hole/black-hole-director.js';
import { BlackHolePost } from '../../src/themes/black-hole/black-hole-post.js';

const STEP = 1 / 60;
const TAU = Math.PI * 2;
const active = (pool) => pool.filter((entry) => entry.active);

const piece = (overrides = {}) => ({
    x: 3, y: 20, shape: [[0, 1, 0], [1, 1, 1]], color: '#62ffe0', ...overrides,
});

function create(seed = 7) {
    const director = new BlackHoleDirector({ seed });
    director.setBoard(0, {
        left: 0.4, right: 0.6, top: 0.1, bottom: 0.9,
    });
    return director;
}

/** Frames, with the owner's part played: every fresh stream is launched (so it lands). */
function run(director, seconds) {
    const frames = Math.round(seconds / STEP);
    for (let frame = 0; frame < frames; frame += 1) {
        director.update(STEP);
        for (const infall of director.infalls) {
            if (infall.fresh) {
                infall.fresh = false;
                infall.landAzimuth = (director.counts.locks * 1.7) % TAU;
            }
        }
    }
}

/** A hard-dropped lock that clears `lines`. */
function clear(director, lines = 1, payload = {}) {
    director.onHardDrop({ distance: 14 });
    director.onPieceLock({ piece: piece({ x: director.counts.locks % 7 }) });
    director.onLineClear({
        lineCount: lines, clearedRows: [23], cascadeCount: 1, ...payload,
    });
    run(director, STEP);
}

/** The tray's Fever, in short: twelve clearing locks 0.64 s apart, ending in a quad. */
function chain(director, links = 12) {
    const readings = [];
    for (let n = 1; n <= links; n += 1) {
        clear(director, n === links ? 4 : 1 + (n % 3));
        readings.push({
            diskRate: director.diskRate,
            diskHeat: director.diskHeat,
            ringGain: director.ringGain,
            level: director.level,
            jets: director.jets,
        });
        run(director, 0.64 - STEP);
    }
    return readings;
}

describe('Black Hole surge: pools that never erase what is still burning', () => {
    it('hands a new arc the faintest slot, so the brightest arcs survive a crowded disk', () => {
        const director = create();
        for (let n = 0; n < DIRECTOR_LIMITS.hotspots; n += 1) {
            director.ignite(n * 0.5, 4 + (n % 5) * 0.8, [1, 0.5, 0.2], 0.4 + n * 0.08, 6);
        }
        run(director, 1);
        const before = director.hotspots.map((spot) => spot.strength);
        const faintest = before.indexOf(Math.min(...before));
        const brightest = before.indexOf(Math.max(...before));
        director.ignite(3, 5, [0.2, 0.6, 1], 1, 6);
        expect(director.hotspots[faintest].age).toBe(0);
        expect(director.hotspots[brightest].age).toBeGreaterThan(0.9);
        expect(director.hotspots[brightest].strength).toBe(before[brightest]);
    });

    it('lets the faintest arc go first when the disk is crowded, instead of cutting a bright one', () => {
        const director = create();
        // Twenty quick locks: more landings than there are slots.
        let cut = 0;
        for (let n = 0; n < 20; n += 1) {
            const lit = director.hotspots.map((spot) => (spot.active ? spot.strength : 0));
            director.onPieceLock({ piece: piece({ x: n % 7 }) });
            run(director, 0.3);
            // A slot that was lit and now holds a younger arc was taken: it was never bright.
            for (let slot = 0; slot < lit.length; slot += 1) {
                const spot = director.hotspots[slot];
                if (spot.active && spot.age < 0.3 && lit[slot] > 0) cut = Math.max(cut, lit[slot]);
            }
        }
        expect(director.counts.landings).toBeGreaterThan(DIRECTOR_LIMITS.hotspots);
        expect(cut).toBeLessThan(0.25);
    });

    it('stacks a cascade\'s fronts, each deeper wave faster, wider and stronger than the last', () => {
        const director = create();
        clear(director, 2);
        for (let wave = 2; wave <= 4; wave += 1) {
            run(director, 0.36 - STEP);
            director.onCascade({ comboCount: wave });
            director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: wave });
            run(director, STEP);
        }
        const fronts = active(director.waves);
        // Four fronts in flight at once: the old two slots snapped the first back at the third.
        expect(fronts).toHaveLength(4);
        // None snapped back: the first is furthest out.
        const byAge = [...fronts].sort((a, b) => b.radius - a.radius);
        expect(byAge[0].peak).toBeLessThan(byAge.at(-1).peak);
        expect(byAge[0].speed).toBeLessThan(byAge.at(-1).speed);
        expect(byAge.at(-1).spread).toBeGreaterThan(byAge[1].spread);
        // The cascade's depth rings out from the hole itself.
        expect(director.ripples.some((ripple) => ripple.active && ripple.fromHole)).toBe(true);
    });
});

describe('Black Hole surge: the light only builds', () => {
    it('never cuts the light when a weak event follows a strong one', () => {
        const director = create();
        clear(director, 4);
        run(director, 0.2);
        director.onPerfectClear({ depth: 4 });
        run(director, 0.15);
        const ring = director.ringGain;
        const { jets } = director;
        const lit = active(director.hotspots).length;
        // A plain lock, then a single: neither may dim what the crown lit.
        director.onPieceLock({ piece: piece() });
        run(director, STEP);
        expect(director.ringGain).toBeGreaterThan(ring * 0.95);
        expect(director.jets).toBeGreaterThanOrEqual(jets);
        expect(active(director.hotspots).length).toBeGreaterThanOrEqual(lit);
        clear(director, 1);
        expect(director.ringGain).toBeGreaterThan(ring * 0.95);
    });

    it('winds a long chain further than its first clear, and its payoff burns gold, not white', () => {
        const director = create();
        const readings = chain(director);
        const [first] = readings;
        const late = readings.at(-2);
        expect(late.diskRate).toBeGreaterThan(first.diskRate + 1.5);
        expect(late.diskHeat).toBeGreaterThan(first.diskHeat);
        expect(late.ringGain).toBeGreaterThan(first.ringGain);
        expect(late.level).toBeGreaterThan(first.level + 0.5);
        // The level climbs over the whole chain rather than in the first two clears.
        expect(readings[1].level).toBeLessThan(0.45);
        expect(director.stage).toBe(3);
        expect(director.fever).toBeGreaterThan(0.5);
        expect(director.jets).toBeGreaterThan(0.9);
        expect(director.jetFlare).toBeGreaterThan(0.3);
        // Hotter gas burns gold: the tint takes blue and green out of the whites; the galaxy
        // dims round the hole and the iris closes, so the colours hold.
        expect(director.diskTint[2]).toBeLessThan(0.7);
        expect(director.diskTint[1]).toBeLessThan(director.diskTint[0]);
        expect(director.ringTint[2]).toBeLessThan(0.85);
        expect(director.skyGain).toBeLessThan(0.85);
        expect(director.iris).toBeGreaterThan(0.08);
        // The brightness of the gas itself stays well short of where the old caps took it.
        expect(director.diskGain).toBeLessThan(1.4);
        // Fed arcs outlive their burn as faint threads while play runs hot.
        expect(Math.max(...director.hotspots.map((spot) => spot.tail))).toBeGreaterThan(0.1);
    });

    it('breathes back to rest when the hands do', () => {
        const director = create();
        chain(director);
        run(director, 3);
        expect(director.level).toBeGreaterThan(0.2);
        run(director, 40);
        expect([director.level, director.fever, director.stage, director.iris]).toEqual([0, 0, 0, 0]);
        expect([director.skyGain, director.nebulaGain, director.diskRate, director.ringGain]).toEqual([1, 1, 1, 1]);
        expect([...director.diskTint, ...director.ringTint]).toEqual([1, 1, 1, 1, 1, 1]);
        expect([director.jets, director.jetFlare, director.dust]).toEqual([0, 0, 0]);
    });

    it('closes the post chain iris as play heats, with the bloom barely rising', () => {
        const post = new BlackHolePost({
            renderer: {}, scene: {}, camera: {}, preset: { enablePost: false },
        });
        post.update({ energy: 0, flash: 0 });
        const rest = post.uExposure.value;
        const director = create();
        chain(director);
        post.update({ energy: director.energy, flash: 0, iris: director.iris });
        expect(post.uExposure.value).toBeLessThan(rest - 0.08);
        expect(post.uExposure.value).toBeCloseTo(rest - director.iris, 6);
        post.dispose();
    });

    it('lets the jets fall away when calmed, rather than blinking out', () => {
        const director = create();
        clear(director, 4);
        run(director, 0.5);
        expect(director.jets).toBeGreaterThan(0.98);
        director.calm();
        run(director, 2 * STEP);
        expect(director.jets).toBeGreaterThan(0.9);
        run(director, 0.5);
        expect(director.jets).toBeGreaterThan(0.2);
        run(director, 5);
        expect(director.jets).toBe(0);
    });
});

describe('Black Hole surge: moments of their own', () => {
    it('crowns a late perfect clear on the clear still playing, never as a second clear', () => {
        const director = create();
        clear(director, 4);
        run(director, 0.36);
        const { clears } = director.counts;
        const fronts = active(director.waves).length;
        const levelBefore = director.level;
        director.onPerfectClear({ depth: 4 });
        run(director, STEP);
        expect(director.counts.clears).toBe(clears);
        expect(active(director.waves).length).toBe(fronts);
        run(director, 0.2);
        expect(director.blazing).toBeGreaterThan(0.5);
        run(director, 0.8);
        expect(director.level).toBeGreaterThan(levelBefore);
        // The ring stays ablaze for seconds, not the 0.42 s half-life of a clear's flare.
        run(director, 1.5);
        expect(director.ringGain).toBeGreaterThan(1.5);
        expect(active(director.hotspots).filter((spot) => spot.color[0] === 1 && spot.color[2] < 0.5).length)
            .toBe(3);
    });

    it('answers a back-to-back with twin ice-blue knots, a blazing ring and a kick of the jets', () => {
        const director = create();
        clear(director, 4);
        run(director, 2);
        const blazeBefore = director.blazing;
        director.onPieceLock({ piece: piece() });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
        director.onBackToBack({ active: true });
        run(director, 0.1);
        const twins = active(director.hotspots).filter((spot) => spot.color[2] === 1 && spot.color[0] === 0.3);
        expect(twins).toHaveLength(2);
        const apart = Math.abs(((twins[0].azimuth - twins[1].azimuth + TAU) % TAU) - Math.PI);
        expect(apart).toBeLessThan(0.1);
        expect(director.blazing).toBeGreaterThan(blazeBefore);
        expect(director.b2bChain).toBe(1);
        // The second in a row answers brighter, further out.
        run(director, 1.4);
        director.onPieceLock({ piece: piece() });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
        director.onBackToBack({});
        run(director, 0.1);
        expect(director.b2bChain).toBe(2);
        const second = active(director.hotspots).filter((spot) => spot.color[0] === 0.3 && spot.age < 0.2);
        expect(second[0].peak).toBeGreaterThan(twins[0].peak);
        expect(second[0].radius).toBeGreaterThan(twins[0].radius - 0.2);
        // An easy clear ends the run; `active: false` is no back-to-back at all.
        clear(director, 1);
        expect(director.b2bChain).toBe(0);
        director.onBackToBack({ active: false });
        run(director, STEP);
        expect(director.b2bChain).toBe(0);
    });

    it('still marks a T-spin that clears nothing, and counts it a little', () => {
        const director = create();
        director.onPieceLock({ piece: piece() });
        director.onTSpin({ lineCount: 0 });
        run(director, STEP);
        expect(active(director.hotspots)).toHaveLength(1);
        run(director, 1);
        expect(director.level).toBeGreaterThan(0.1);
        expect(director.counts.clears).toBe(0);
    });

    it('lets its breath go when a long chain ends', () => {
        const director = create();
        for (let n = 0; n < 6; n += 1) {
            clear(director, 1);
            run(director, 0.5);
        }
        run(director, 2);
        expect(active(director.waves)).toHaveLength(0);
        // The tracker learns a lock cleared nothing when the next one locks.
        director.onPieceLock({ piece: piece() });
        run(director, 0.6);
        expect(active(director.waves)).toHaveLength(0);
        director.onPieceLock({ piece: piece() });
        run(director, STEP);
        const [exhale] = active(director.waves);
        expect(exhale.speed).toBeLessThan(3);
        expect(exhale.spread).toBeGreaterThan(0.5);
    });

    it('shakes harder the hotter play runs, never past the biggest hit in the game', () => {
        const cold = create();
        clear(cold, 2);
        const hot = create();
        chain(hot, 8);
        hot.onPieceLock({ piece: piece() });
        hot.onLineClear({ lineCount: 2, clearedRows: [23, 22] });
        hot.update(STEP);
        expect(hot.shakeAmount).toBeGreaterThan(cold.shakeAmount);
        expect(hot.shakeAmount).toBeLessThanOrEqual(0.0307);
    });
});
