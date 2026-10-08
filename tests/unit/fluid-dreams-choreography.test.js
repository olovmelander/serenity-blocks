import { describe, expect, it } from 'vitest';
import {
    CLEAR_REACH, CLEAR_TRAVEL, DYE_HOLD, DYE_SLOTS, FLIGHT_TIME, FLUID_PALETTES, GROUP_CAPACITY, GROUP_COUNT,
    GROUP_HERO, GROUP_KIN, GROUP_LEFT, GROUP_RIGHT, GROUP_START, HERO, HUSH_HOLD, JET_TIME, MAX_BALLS, PALETTE_KEYS,
    PLUNGE, RING_REACH, RING_SLOTS, RING_TAU, WAVE_SLOTS, approach, clamp01, clearRadius, lerp, linRGB, mulberry32,
    pieceColor, powerForCombo, ringRadius, sceneAnchors, smooth,
} from '../../src/themes/fluid-dreams/fluid-dreams-core.js';
import { FluidChoreography, clearPassTime } from '../../src/themes/fluid-dreams/fluid-dreams-choreography.js';
import { fallbackLayout } from '../../src/themes/fluid-dreams/fluid-dreams-composition.js';
import { QUALITY } from '../../src/themes/fluid-dreams/fluid-dreams-quality.js';

const DT = 1 / 60;
/** The palette the world hands the choreography each frame: arrays keyed like FLUID_PALETTES. */
const PALETTE = Object.freeze(Object.fromEntries(PALETTE_KEYS.map((key) => [key, FLUID_PALETTES[0][key].slice()])));
const ROSE = Object.freeze([1, 0.2, 0.55]);
const TEAL = Object.freeze([0.1, 1, 0.8]);
const EVENT_GROUPS = Object.freeze([GROUP_LEFT, GROUP_RIGHT]);
const TABLE_ROWS = Object.freeze({
    balls: MAX_BALLS, groups: GROUP_COUNT, rings: RING_SLOTS, dye: DYE_SLOTS, waves: WAVE_SLOTS,
});

/** A choreography at rest at `start`, and every burst of spray it asks for (with the time it asked). */
function make(options = {}, start = 10) {
    const bursts = [];
    const choreo = new FluidChoreography({
        emit: (burst) => bursts.push({ ...burst, color: [...burst.color], at: choreo.time }),
        ...options,
    });
    choreo.seek(start);
    choreo.update(start, 0, PALETTE);
    return { choreo, bursts };
}

/** Advance by `seconds` in equal frames of about 1/60 s; `each` runs after every frame. */
function run(choreo, seconds, each) {
    const steps = Math.max(1, Math.round(seconds / DT));
    const t0 = choreo.time;
    for (let i = 1; i <= steps; i++) {
        choreo.update(t0 + (seconds * i) / steps, seconds / steps, PALETTE);
        each?.(choreo);
    }
}

/** Step until nothing event-driven is in flight; returns the seconds it took (at most `limit`). */
function settle(choreo, limit = 30) {
    const t0 = choreo.time;
    while (choreo.isBusy() && choreo.time - t0 < limit) run(choreo, DT);
    return choreo.time - t0;
}

/** The live balls of a group: { x, y, z, r } and the colour row that goes with each. */
function ballsOf(choreo, group) {
    const out = [];
    for (let i = 0; i < choreo.live[group]; i++) {
        const place = choreo.tables.balls[(GROUP_START[group] + i) * 2];
        const colour = choreo.tables.balls[(GROUP_START[group] + i) * 2 + 1];
        out.push({
            x: place.x, y: place.y, z: place.z, r: place.w, colour: [colour.x, colour.y, colour.z], glow: colour.w,
        });
    }
    return out;
}

/** The live rows of a sea table as [place, detail] pairs. */
function rowsOf(choreo, table) {
    const out = [];
    for (let i = 0; i < choreo.counts[table]; i++) {
        out.push([choreo.tables[table][i * 2], choreo.tables[table][i * 2 + 1]]);
    }
    return out;
}

/** The live row of a sea table that stands at (x, z), or undefined. */
const rowAt = (choreo, table, [x, z]) => rowsOf(choreo, table).find(([place]) => place.x === x && place.y === z);

const satellites = (choreo) => choreo.live[GROUP_HERO] - choreo.hero.body;
const threadOn = (choreo) => choreo.stem.off === 0;
const kinds = (bursts, kind) => bursts.filter((burst) => burst.kind === kind);
const finiteRow = (row) => Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.z)
    && Number.isFinite(row.w);

/**
 * What the liquid material relies on, every frame. Returns the first thing that is wrong, or null.
 * (One string per frame instead of thousands of expectations.)
 */
function problem(choreo) {
    const { tables, counts, live } = choreo;
    for (const [name, slots] of [['rings', RING_SLOTS], ['dye', DYE_SLOTS], ['waves', WAVE_SLOTS]]) {
        if (!(counts[name] >= 0 && counts[name] <= slots)) return `${counts[name]} ${name} for ${slots} slots`;
    }
    for (const [name, size] of Object.entries(TABLE_ROWS)) {
        if (tables[name].length !== size * 2) return `the ${name} table changed size`;
        const bad = tables[name].findIndex((row) => !finiteRow(row));
        if (bad >= 0) return `${name}[${bad}] is not finite: ${JSON.stringify(tables[name][bad])}`;
    }
    for (let g = 0; g < GROUP_COUNT; g++) {
        const bound = tables.groups[g * 2];
        const census = tables.groups[g * 2 + 1];
        if (live[g] > GROUP_CAPACITY[g]) return `group ${g} holds ${live[g]} balls of ${GROUP_CAPACITY[g]}`;
        if (census.x !== live[g]) return `group ${g} tells the material ${census.x} balls, it has ${live[g]}`;
        if (census.y !== (g === GROUP_HERO ? choreo.hero.body : 0)) return `group ${g} body count is ${census.y}`;
        if (census.y > census.x) return `group ${g} has a body of ${census.y} in ${census.x} balls`;
        if (!(bound.w > 0)) return `group ${g} has no bound radius`;
        const threaded = g === GROUP_HERO && threadOn(choreo);
        // An empty group must not be hit: its sphere lies wholly under the sea, where nothing is traced.
        if (live[g] === 0 && !threaded && !(bound.y + bound.w < 0)) return `empty group ${g} can be hit`;
        const balls = ballsOf(choreo, g);
        for (let i = 0; i < balls.length; i++) {
            const ball = balls[i];
            if (!(ball.r > 0)) return `group ${g} ball ${i} has radius ${ball.r}`;
            if (![...ball.colour, ball.glow].every(Number.isFinite)) return `group ${g} ball ${i} colour`;
            // Whatever shows above the sea is inside the sphere a ray must cross to reach it.
            const reach = Math.hypot(ball.x - bound.x, ball.y - bound.y, ball.z - bound.z) + ball.r;
            if (ball.y + ball.r > 0 && reach > bound.w + 1e-6) {
                return `group ${g} ball ${i} reaches ${reach} from a bound of radius ${bound.w}`;
            }
        }
        if (threaded) {
            // The thread, from its foot on the sea to where it enters the Drop.
            const { stem } = choreo;
            for (const y of [0, stem.cap * 0.5, stem.cap]) {
                const reach = Math.hypot(stem.x - bound.x, y - bound.y, stem.z - bound.z) + (y === 0 ? stem.foot : 0);
                if (reach > bound.w + 1e-6) return `the thread at y=${y} is outside the Great Drop's bound`;
            }
        }
    }
    const scalars = {
        charge: choreo.charge,
        surge: choreo.surge,
        swell: choreo.swell,
        flash: choreo.flash,
        kick: choreo.kick,
        hush: choreo.hush,
        filmShift: choreo.filmShift,
        skyFlash: choreo.skyFlash,
        prism: choreo.prism.strength,
        vortex: choreo.vortex.depth,
        ...Object.fromEntries(Object.entries(choreo.hero).map(([key, value]) => [`hero.${key}`, value])),
        ...Object.fromEntries(Object.entries(choreo.stem).map(([key, value]) => [`stem.${key}`, value])),
        ...Object.fromEntries(choreo.heroTint.map((value, i) => [`heroTint.${i}`, value])),
        ...Object.fromEntries(choreo.beads.flatMap((bead, i) => [[`bead${i}.y`, bead.y], [`bead${i}.amp`, bead.amp]])),
    };
    const broken = Object.keys(scalars).find((key) => !Number.isFinite(scalars[key]));
    return broken ? `${broken} is ${scalars[broken]}` : null;
}

/** Everything a frame is drawn from: the live rows of every table and the scalars beside them. */
function snapshot(choreo) {
    const flat = (row) => [row.x, row.y, row.z, row.w];
    const out = [choreo.time, ...choreo.live, choreo.counts.rings, choreo.counts.dye, choreo.counts.waves];
    for (let g = 0; g < GROUP_COUNT; g++) {
        out.push(...flat(choreo.tables.groups[g * 2]), ...flat(choreo.tables.groups[g * 2 + 1]));
        for (const ball of ballsOf(choreo, g)) out.push(ball.x, ball.y, ball.z, ball.r, ...ball.colour, ball.glow);
    }
    for (const table of ['rings', 'dye', 'waves']) {
        for (const [place, detail] of rowsOf(choreo, table)) out.push(...flat(place), ...flat(detail));
    }
    const {
        stem, hero, vortex, prism,
    } = choreo;
    out.push(
        stem.x,
        stem.z,
        stem.flare,
        stem.cap,
        stem.waist,
        stem.foot,
        stem.top,
        stem.off,
        stem.glow,
        hero.x,
        hero.y,
        hero.z,
        hero.r,
        hero.body,
        hero.blend,
        hero.bias,
        hero.glow,
        ...choreo.heroTint,
        ...choreo.beads.flatMap((bead) => [bead.y, bead.amp]),
        choreo.swell,
        choreo.charge,
        choreo.surge,
        choreo.filmShift,
        choreo.skyFlash,
        choreo.flash,
        choreo.kick,
        choreo.hush,
        choreo.combo,
        // The funnel and the ring of split light are drawn only while they have strength.
        vortex.depth,
        vortex.arms,
        ...(vortex.depth > 0 ? [vortex.x, vortex.z, vortex.radius, vortex.phase] : []),
        prism.strength,
        ...(prism.strength > 0 ? [prism.radius, prism.width] : []),
    );
    return out;
}

/**
 * Count the balls the choreography asks to draw, per group, since the counter was last cleared.
 * A ball its group has no row for is silently not drawn, so `live` alone cannot show one missing.
 */
function countAsks(choreo) {
    const asked = new Int32Array(GROUP_COUNT);
    const put = choreo._put.bind(choreo);
    choreo._put = (group, x, y, z, r, ...rest) => {
        if (r > 0.02) asked[group] += 1;
        put(group, x, y, z, r, ...rest);
    };
    return asked;
}

/** Step for `seconds`: the most hero balls asked for in a frame, and the frames that lost one. */
function watchAsks(choreo, asked, seconds) {
    let most = 0;
    let dropped = 0;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
        asked.fill(0);
        run(choreo, DT);
        most = Math.max(most, asked[GROUP_HERO]);
        if (asked[GROUP_HERO] !== choreo.live[GROUP_HERO]) dropped += 1;
    }
    return { most, dropped };
}

/** A lock that leaves the card on `side` of the board's foot and lands in open sea beside it. */
function lockBeside(choreo, side, {
    out = 6, back = -2, color = ROSE, hardDrop = false,
} = {}) {
    const [fx, fz] = choreo.scene.foot;
    const lock = {
        from: [fx + side * 1.5, 3.2, fz + 2], to: [fx + side * out, fz + back], color, hardDrop,
    };
    choreo.lock(lock);
    return lock;
}

describe('fluid dreams core maths', () => {
    it('lays the ball table out as one fixed range per group', () => {
        expect(new Set([GROUP_HERO, GROUP_KIN, GROUP_LEFT, GROUP_RIGHT]).size).toBe(GROUP_COUNT);
        expect(GROUP_CAPACITY).toHaveLength(GROUP_COUNT);
        expect(GROUP_START).toHaveLength(GROUP_COUNT);
        let start = 0;
        for (let g = 0; g < GROUP_COUNT; g++) {
            expect(GROUP_START[g]).toBe(start);
            expect(GROUP_CAPACITY[g]).toBeGreaterThan(0);
            start += GROUP_CAPACITY[g];
        }
        expect(MAX_BALLS).toBe(start);
        // The Great Drop's group has room for its body and every satellite a chain can raise.
        expect(GROUP_CAPACITY[GROUP_HERO]).toBeGreaterThanOrEqual(1 + HERO.lobes + HERO.satellites);
        for (const slots of [RING_SLOTS, DYE_SLOTS, WAVE_SLOTS]) expect(slots).toBeGreaterThan(0);
    });

    it('grows a ring train fast, then settles it inside its reach', () => {
        expect(ringRadius(-1)).toBe(0);
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(RING_TAU)).toBeGreaterThan(ringRadius(RING_TAU * 0.5));
        expect(ringRadius(RING_TAU * 0.5)).toBeGreaterThan(0);
        expect(ringRadius(RING_TAU * 30)).toBeLessThanOrEqual(RING_REACH);
        expect(ringRadius(RING_TAU * 30)).toBeGreaterThan(RING_REACH * 0.99);
        // A train can be given its own reach.
        expect(ringRadius(RING_TAU, 5)).toBeCloseTo((ringRadius(RING_TAU) * 5) / RING_REACH, 9);
    });

    it('runs a clear\'s packet out through the sea and knows when it passes a point', () => {
        expect(clearRadius(-1)).toBe(0);
        expect(clearRadius(0)).toBe(0);
        expect(clearRadius(CLEAR_TRAVEL)).toBeCloseTo(CLEAR_REACH, 9);
        expect(clearRadius(CLEAR_TRAVEL * 3)).toBeCloseTo(CLEAR_REACH, 9);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const radius = clearRadius((CLEAR_TRAVEL * i) / 20);
            expect(radius).toBeGreaterThan(previous);
            previous = radius;
        }
        // The pass time is the packet's inverse: a stain lets go exactly as the front arrives.
        for (const share of [0.03, 0.25, 0.6, 1]) {
            expect(clearRadius(clearPassTime(CLEAR_REACH * share))).toBeCloseTo(CLEAR_REACH * share, 6);
        }
        expect(clearPassTime(0)).toBe(0);
        expect(clearPassTime(-4)).toBe(0);
        expect(clearPassTime(CLEAR_REACH * 10)).toBe(CLEAR_TRAVEL);
    });

    it('charges with the combo and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(1)).toBeGreaterThan(0);
        expect(powerForCombo(5)).toBeGreaterThan(powerForCombo(2));
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
    });

    it('eases the same whatever the frame rate, and steps smoothly between two edges', () => {
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, 100)).toBeCloseTo(1, 9);
        // Two half steps close as much of the gap as one whole one.
        const half = approach(3, 0.05);
        expect(1 - (1 - half) ** 2).toBeCloseTo(approach(3, 0.1), 12);
        expect(smooth(2, 4, 1)).toBe(0);
        expect(smooth(2, 4, 9)).toBe(1);
        expect(smooth(2, 4, 3)).toBeCloseTo(0.5, 12);
        expect(smooth(2, 4, 2.5)).toBeLessThan(0.25); // it leaves an edge slowly
        expect(clamp01(-3)).toBe(0);
        expect(clamp01(7)).toBe(1);
        expect(lerp(2, 6, 0.25)).toBe(3);
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
        expect(Math.min(...rose)).toBeGreaterThan(0);
        expect(rose[0]).toBeGreaterThan(rose[2]);
        expect(rose[2]).toBeGreaterThan(rose[1]);
        // A pastel is pushed toward its own hue: the weakest channel falls further than it would
        // by normalising alone.
        const plain = linRGB(0xffa8d0);
        expect(rose[1]).toBeLessThan(plain[1] / Math.max(...plain));
        // A pure primary still reaches every channel of the bloom.
        const blue = pieceColor(0x0000ff);
        expect(blue[2]).toBeCloseTo(1, 6);
        expect(blue[0]).toBeGreaterThan(0);
        expect(blue[0]).toBe(blue[1]);
        expect(pieceColor('a8ffe8')).toEqual(pieceColor('#A8FFE8'));
        // Nonsense falls back to the given colour.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 6);
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
    });

    it('defines every palette key for every level\'s palette, in scene-linear light', () => {
        expect(FLUID_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(FLUID_PALETTES.map((p) => p.name)).size).toBe(FLUID_PALETTES.length);
        for (const palette of FLUID_PALETTES) {
            expect(typeof palette.name).toBe('string');
            // Nothing a material would read is missing, and nothing is defined that none reads.
            expect(Object.keys(palette).filter((key) => key !== 'name').sort()).toEqual([...PALETTE_KEYS].sort());
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
        }
    });

    it('stands the picture round the board: the Drop left, its kin and the sun right, and up on a phone', () => {
        const wide = sceneAnchors(16 / 9);
        const tall = sceneAnchors(9 / 19.5);
        // Landscape leaves the centre to the board.
        expect(wide.hero.x).toBeLessThan(0.5);
        expect(wide.kin.x).toBeGreaterThan(0.5);
        expect(wide.sun.x).toBeGreaterThan(0.5);
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080]]) {
            const anchors = sceneAnchors(width / height);
            const layout = fallbackLayout(width, height);
            expect(anchors.hero.x, `${width}x${height}`).toBeLessThan(layout.cards[0].x0);
            expect(anchors.kin.x, `${width}x${height}`).toBeGreaterThan(layout.hud.x1);
            // The dream sun stands right of the stats bar, so its path of light lies on open sea.
            expect(anchors.sun.x, `${width}x${height}`).toBeGreaterThan(layout.hud.x1);
        }
        // Upright phones show sky only above the card, so the Drop moves up and in, and shrinks.
        expect(tall.hero.y).toBeLessThan(wide.hero.y);
        expect(Math.abs(tall.hero.x - 0.5)).toBeLessThan(Math.abs(wide.hero.x - 0.5));
        expect(tall.heroScale).toBeLessThan(wide.heroScale);
        expect(tall.hero).not.toEqual(wide.hero);
        for (const anchors of [wide, tall, sceneAnchors(1), sceneAnchors(0.2), sceneAnchors(5)]) {
            for (const point of [anchors.hero, anchors.kin, anchors.sun]) {
                expect(point.x).toBeGreaterThan(0);
                expect(point.x).toBeLessThan(1);
                expect(point.y).toBeGreaterThan(0);
                expect(point.y).toBeLessThan(1);
            }
            // The Drop and its kin hang in the sky, over the sun.
            expect(anchors.hero.y).toBeLessThan(anchors.sun.y);
            expect(anchors.kin.y).toBeLessThan(anchors.sun.y);
            expect(anchors.heroScale).toBeGreaterThan(0);
            expect(anchors.heroScale).toBeLessThanOrEqual(1);
        }
        // A square frame sits between the two.
        const square = sceneAnchors(1);
        expect(square.hero.y).toBeGreaterThanOrEqual(tall.hero.y);
        expect(square.hero.y).toBeLessThanOrEqual(wide.hero.y);
        // Nonsense falls back to the landscape composition.
        expect(sceneAnchors(NaN)).toEqual(wide);
        expect(sceneAnchors(0)).toEqual(wide);
        expect(sceneAnchors(-2)).toEqual(wide);
    });
});

describe('fluid dreams choreography: at rest', () => {
    it('writes tables the liquid can trace: the Drop and its kin, nothing else, every ball inside its bound', () => {
        for (const options of [{}, { lobes: 2, satellites: 3, crown: false }]) {
            for (const time of [0, 10, 13.7, 21.3, 44]) {
                const { choreo } = make(options, time);
                const label = `t=${time} ${JSON.stringify(options)}`;
                expect(problem(choreo), label).toBeNull();
                // The Great Drop: all of it one body (a core and its lobes), no satellites, no crown.
                expect(choreo.live[GROUP_HERO], label).toBeGreaterThan(0);
                expect(choreo.hero.body, label).toBe(choreo.live[GROUP_HERO]);
                expect(choreo.hero.body, label).toBeGreaterThan(choreo.lobes);
                expect(choreo.live[GROUP_KIN], label).toBeGreaterThan(0);
                for (const group of EVENT_GROUPS) {
                    expect(choreo.live[group], label).toBe(0);
                    // Out of every ray's way.
                    const bound = choreo.tables.groups[group * 2];
                    expect(bound.y + bound.w, label).toBeLessThan(0);
                    expect(choreo.tables.groups[group * 2 + 1].x, label).toBe(0);
                }
                // At rest every ball is wholly inside its group's bounding sphere.
                for (const group of [GROUP_HERO, GROUP_KIN]) {
                    const bound = choreo.tables.groups[group * 2];
                    for (const ball of ballsOf(choreo, group)) {
                        expect(ball.r, label).toBeGreaterThan(0);
                        expect(Math.hypot(ball.x - bound.x, ball.y - bound.y, ball.z - bound.z) + ball.r, label)
                            .toBeLessThanOrEqual(bound.w);
                    }
                }
                expect(choreo.counts.dye, label).toBe(0);
                expect(choreo.counts.waves, label).toBe(0);
                expect(choreo.isBusy(), label).toBe(false);
            }
        }
    });

    it('hangs the Great Drop on its thread over its anchor, wherever the world stands it', () => {
        const { choreo } = make();
        const { hero, stem, scene } = choreo;
        expect(threadOn(choreo)).toBe(true);
        // The thread runs from the sea under the Drop up into it.
        expect(stem.x).toBe(hero.x);
        expect(stem.z).toBe(hero.z);
        expect(stem.cap).toBe(hero.y);
        expect(stem.flare).toBeGreaterThan(0);
        expect(stem.flare).toBeLessThan(stem.cap);
        expect(stem.waist).toBeGreaterThan(0);
        expect(stem.foot).toBeGreaterThan(stem.waist); // it flares where it leaves the sea
        // It idles within reach of its anchor and clear of the sea.
        expect(Math.hypot(hero.x - scene.hero[0], hero.y - scene.hero[1], hero.z - scene.hero[2]))
            .toBeLessThan(HERO.radius);
        expect(hero.y - hero.r).toBeGreaterThan(0);
        expect(hero.r).toBeCloseTo(HERO.radius * scene.heroScale, 1);
        // The world moves the anchors (another screen shape): the Drop follows, at that scale.
        scene.hero[0] = 4;
        scene.hero[1] = 14;
        scene.hero[2] = -31;
        scene.heroScale = 0.5;
        const before = hero.r;
        run(choreo, DT);
        expect(Math.hypot(hero.x - 4, hero.y - 14, hero.z + 31)).toBeLessThan(HERO.radius);
        expect(hero.r / before).toBeCloseTo(0.5, 2);
        expect(stem.x).toBe(hero.x);
        expect(problem(choreo)).toBeNull();
    });

    it('takes its budgets from its tier, inside what the Drop can show', () => {
        expect(new FluidChoreography().maxSatellites).toBe(HERO.satellites);
        expect(new FluidChoreography().lobes).toBe(HERO.lobes);
        expect(new FluidChoreography().crown).toBe(true);
        expect(new FluidChoreography({ satellites: 99 }).maxSatellites).toBe(HERO.satellites);
        expect(new FluidChoreography({ satellites: -2 }).maxSatellites).toBe(0);
        expect(new FluidChoreography({ lobes: 99 }).lobes).toBe(HERO.lobes);
        expect(new FluidChoreography({ lobes: 0 }).lobes).toBe(2);
        expect(new FluidChoreography({ crown: false }).crown).toBe(false);
        // Fewer lobes, a smaller body.
        if (HERO.lobes > 2) {
            expect(make({ lobes: 2 }).choreo.hero.body).toBeLessThan(make().choreo.hero.body);
        }
        // The spray sink is optional.
        const quiet = new FluidChoreography();
        expect(() => {
            lockBeside(quiet, -1, { hardDrop: true });
            quiet.clear({ origin: [0, -9], lines: 4 });
            run(quiet, HUSH_HOLD + PLUNGE.total + 1);
        }).not.toThrow();
    });

    it('lets its kin drip into the sea and feeds the Drop a bead up the thread, by itself', () => {
        const { choreo, bursts } = make();
        let beads = 0;
        run(choreo, 40, () => {
            for (const bead of choreo.beads) {
                if (bead.amp > 0) {
                    beads += 1;
                    // A bead is somewhere on the thread, between the sea and the Drop.
                    expect(bead.y).toBeGreaterThanOrEqual(0);
                    expect(bead.y).toBeLessThan(choreo.stem.cap + 0.05);
                }
            }
            const drip = bursts[bursts.length - 1];
            if (drip?.kind === 'drip' && drip.at === choreo.time) {
                // Where a drip meets the sea a ring train starts, in the drip's colour.
                const ring = rowAt(choreo, 'rings', [drip.x, drip.z]);
                expect(ring).toBeTruthy();
                expect([ring[1].x, ring[1].y, ring[1].z]).toEqual(drip.color);
            }
        });
        expect(kinds(bursts, 'drip').length).toBeGreaterThan(1);
        expect(beads).toBeGreaterThan(0);
        // Idling is never "busy": a capture need not wait for it.
        expect(choreo.isBusy()).toBe(false);
        expect(bursts.every((burst) => burst.kind === 'drip')).toBe(true);
    });
});

describe('fluid dreams choreography: locks', () => {
    it('flies a lock\'s droplet on the side of the board it lands on, in the piece\'s colour', () => {
        for (const [side, group, other] of [[-1, GROUP_LEFT, GROUP_RIGHT], [1, GROUP_RIGHT, GROUP_LEFT]]) {
            const { choreo } = make();
            expect(choreo.isBusy()).toBe(false);
            lockBeside(choreo, side, { color: TEAL });
            expect(choreo.isBusy()).toBe(true);
            run(choreo, DT);
            expect(choreo.live[group]).toBe(1);
            expect(choreo.live[other]).toBe(0);
            const [droplet] = ballsOf(choreo, group);
            expect(droplet.colour).toEqual([...TEAL]);
            expect(droplet.r).toBeGreaterThan(0);
            expect(droplet.glow).toBeGreaterThan(0);
            expect(problem(choreo)).toBeNull();
        }
    });

    it('carries the droplet from the card to the sea in FLIGHT_TIME, then rings, stains, splashes and jets', () => {
        const { choreo, bursts } = make();
        const twin = make().choreo; // the same sea with no lock
        const t0 = choreo.time;
        const { from, to } = lockBeside(choreo, -1);
        const path = [];
        run(choreo, FLIGHT_TIME - 2.5 * DT, () => {
            expect(choreo.live[GROUP_LEFT]).toBe(1);
            path.push(ballsOf(choreo, GROUP_LEFT)[0]);
            expect(problem(choreo)).toBeNull();
        });
        // It leaves from where the piece locked...
        expect(Math.hypot(path[0].x - from[0], path[0].y - from[1], path[0].z - from[2])).toBeLessThan(1);
        // ...closes on its landing every frame, and comes down.
        for (let i = 1; i < path.length; i++) {
            expect(Math.hypot(path[i].x - to[0], path[i].z - to[1]))
                .toBeLessThan(Math.hypot(path[i - 1].x - to[0], path[i - 1].z - to[1]));
        }
        expect(path[path.length - 1].y).toBeLessThan(path[0].y);
        // Nothing has landed yet; it sheds fine drops behind it on the way.
        expect(kinds(bursts, 'splash')).toHaveLength(0);
        expect(choreo.counts.dye).toBe(0);
        const trail = kinds(bursts, 'trail');
        expect(trail.length).toBeGreaterThan(2);
        expect(trail.every((burst) => burst.color.join() === ROSE.join())).toBe(true);

        run(choreo, 4 * DT);
        run(twin, choreo.time - twin.time);
        // It has landed, FLIGHT_TIME after the lock (to the frame).
        const [splash, ...more] = kinds(bursts, 'splash');
        expect(more).toHaveLength(0);
        expect(splash.at - t0).toBeGreaterThan(FLIGHT_TIME);
        expect(splash.at - t0).toBeLessThan(FLIGHT_TIME + DT);
        expect([splash.x, splash.z]).toEqual(to);
        expect(Math.abs(splash.y)).toBeLessThan(0.5); // at the surface
        expect(splash.color).toEqual([...ROSE]);
        expect(splash.power).toBeGreaterThan(0);
        // A ring train runs out from there and the colour stays in the water.
        expect(choreo.counts.rings).toBe(twin.counts.rings + 1);
        expect(choreo.counts.dye).toBe(1);
        const [ring, ringLook] = rowAt(choreo, 'rings', to);
        const [stain, stainLook] = rowAt(choreo, 'dye', to);
        expect([ringLook.x, ringLook.y, ringLook.z]).toEqual([...ROSE]);
        expect([stainLook.x, stainLook.y, stainLook.z]).toEqual([...ROSE]);
        expect(stain.z).toBeGreaterThan(0); // its radius
        // A jet stands up out of the crater, where the droplet went in.
        expect(choreo.live[GROUP_LEFT]).toBeGreaterThan(0);
        expect(ballsOf(choreo, GROUP_LEFT).every((ball) => ball.x === to[0] && ball.z === to[1])).toBe(true);
        expect(choreo.isBusy()).toBe(true);

        // The ring grows, the stain comes up, the jet throws a bead clear of the sea.
        let radius = ring.z;
        let apex = -Infinity;
        run(choreo, JET_TIME * 0.5, () => {
            const [train] = rowAt(choreo, 'rings', to);
            expect(train.z).toBeGreaterThan(radius);
            radius = train.z;
            for (const ball of ballsOf(choreo, GROUP_LEFT)) apex = Math.max(apex, ball.y + ball.r);
            expect(problem(choreo)).toBeNull();
        });
        expect(radius).toBeLessThanOrEqual(RING_REACH);
        expect(apex).toBeGreaterThan(0.2);
        expect(rowAt(choreo, 'dye', to)[0].w).toBeGreaterThan(0);
        expect(rowAt(choreo, 'rings', to)[0].w).toBeGreaterThan(0);
        // JET_TIME after the landing the jet is over: nothing is left in the air.
        run(choreo, JET_TIME * 0.5 + 2 * DT);
        expect(choreo.live[GROUP_LEFT]).toBe(0);
        expect(choreo.isBusy()).toBe(false);
        // The stain is still there, and the right side never saw any of it.
        expect(rowAt(choreo, 'dye', to)).toBeTruthy();
        expect(choreo.live[GROUP_RIGHT]).toBe(0);
    });

    it('throws three droplets on a hard drop, and hits harder', () => {
        const soft = make();
        const hard = make();
        const { to } = lockBeside(soft.choreo, -1);
        lockBeside(hard.choreo, -1, { hardDrop: true });
        expect(soft.choreo.kick).toBe(0);
        expect(hard.choreo.kick).toBeGreaterThan(0);
        let softMost = 0;
        let hardMost = 0;
        const flying = () => {
            softMost = Math.max(softMost, soft.choreo.live[GROUP_LEFT]);
            hardMost = Math.max(hardMost, hard.choreo.live[GROUP_LEFT]);
        };
        run(soft.choreo, FLIGHT_TIME - DT, flying);
        run(hard.choreo, FLIGHT_TIME - DT, flying);
        expect(softMost).toBe(1);
        expect(hardMost).toBe(3);
        run(soft.choreo, FLIGHT_TIME);
        run(hard.choreo, FLIGHT_TIME);
        // One landing for a lock; three for a hard drop, each in its own place.
        expect(kinds(soft.bursts, 'splash')).toHaveLength(1);
        const splashes = kinds(hard.bursts, 'splash');
        expect(splashes).toHaveLength(3);
        expect(new Set(splashes.map((burst) => `${burst.x},${burst.z}`)).size).toBe(3);
        for (const burst of splashes) expect(burst.color).toEqual([...ROSE]);
        // The main droplet lands where a soft lock's would, harder: a wider ring, a deeper stain.
        // (What the two side droplets leave besides their splash is the choreography's to tune.)
        const main = splashes.find((burst) => burst.x === to[0] && burst.z === to[1]);
        expect(main).toBeTruthy();
        expect(main.power).toBeGreaterThan(kinds(soft.bursts, 'splash')[0].power);
        for (const burst of splashes) if (burst !== main) expect(burst.power).toBeLessThan(main.power);
        expect(soft.choreo.counts.dye).toBe(1);
        expect(hard.choreo.counts.dye).toBeGreaterThanOrEqual(1);
        expect(hard.choreo.counts.dye).toBeLessThanOrEqual(3);
        expect(hard.choreo.counts.rings).toBeGreaterThanOrEqual(soft.choreo.counts.rings);
        expect(rowAt(hard.choreo, 'rings', to)[0].z).toBeGreaterThan(rowAt(soft.choreo, 'rings', to)[0].z);
        expect(rowAt(hard.choreo, 'dye', to)[0].w).toBeGreaterThan(rowAt(soft.choreo, 'dye', to)[0].w);
        expect(problem(hard.choreo)).toBeNull();
        // And it all comes to rest.
        expect(settle(hard.choreo)).toBeLessThan(JET_TIME * 3);
        expect(hard.choreo.live[GROUP_LEFT]).toBe(0);
    });

    it('never lands a droplet on the thread\'s foot', () => {
        for (const [dx, dz] of [[0, 0], [0.004, -0.003], [0.6, 0.2], [-1.1, 0.9]]) {
            for (const hardDrop of [false, true]) {
                const { choreo, bursts } = make();
                const { stem } = choreo;
                choreo.lock({
                    from: [stem.x + 6, 3, stem.z + 9], to: [stem.x + dx, stem.z + dz], color: ROSE, hardDrop,
                });
                run(choreo, FLIGHT_TIME * 2);
                const splashes = kinds(bursts, 'splash');
                expect(splashes).toHaveLength(hardDrop ? 3 : 1);
                for (const splash of splashes) {
                    // Beside the thread: outside the foot it stands on.
                    expect(Math.hypot(splash.x - stem.x, splash.z - stem.z), `${dx},${dz}`).toBeGreaterThan(stem.foot);
                    expect(Number.isFinite(splash.x) && Number.isFinite(splash.z)).toBe(true);
                }
                expect(problem(choreo)).toBeNull();
            }
        }
    });

    it('keeps a lock\'s colour in the sea, falling to 1/e over DYE_HOLD', () => {
        const { choreo } = make();
        const { to } = lockBeside(choreo, 1, { color: TEAL });
        run(choreo, FLIGHT_TIME + DYE_HOLD * 0.25);
        const early = rowAt(choreo, 'dye', to)[0].w;
        expect(early).toBeGreaterThan(0);
        run(choreo, DYE_HOLD);
        const late = rowAt(choreo, 'dye', to)[0].w;
        expect(late / early).toBeCloseTo(Math.exp(-1), 4);
        // It spreads as it fades.
        expect(rowAt(choreo, 'dye', to)[0].z).toBeGreaterThan(0);
        expect(choreo.counts.dye).toBe(1);
    });
});

describe('fluid dreams choreography: clears', () => {
    it('sends a packet from under the board, more crests for more lines, after the hush for four', () => {
        const age = PLUNGE.fall * 0.5; // before a four-line clear's Drop meets the sea
        const crests = [];
        for (let lines = 1; lines <= 4; lines++) {
            const { choreo } = make();
            const origin = [choreo.scene.foot[0] + 0.5, choreo.scene.foot[1] - 1];
            const t0 = choreo.time;
            choreo.clear({ origin, lines });
            expect(choreo.flash).toBeGreaterThan(0);
            expect(choreo.kick).toBeGreaterThan(0);
            if (lines === 4) {
                // The sea holds its breath first.
                run(choreo, HUSH_HOLD * 0.5);
                expect(choreo.counts.waves).toBe(0);
                run(choreo, HUSH_HOLD * 0.5 + age);
            } else {
                run(choreo, age);
            }
            expect(choreo.counts.waves, `${lines} lines`).toBe(1);
            const [packet, shape] = rowAt(choreo, 'waves', origin);
            const born = t0 + (lines === 4 ? HUSH_HOLD : 0);
            expect(packet.z, `${lines} lines`).toBeCloseTo(clearRadius(choreo.time - born), 6);
            expect(packet.w).toBeGreaterThan(0); // its height
            expect(shape.x).toBeGreaterThan(0); // its width
            crests.push(shape.y);
            expect(problem(choreo)).toBeNull();
        }
        for (let i = 1; i < crests.length; i++) expect(crests[i]).toBeGreaterThan(crests[i - 1]);
    });

    it('runs the packet out through the sea, then lets it go', () => {
        const { choreo } = make();
        const origin = [...choreo.scene.foot];
        const t0 = choreo.time;
        choreo.clear({ origin, lines: 2 });
        let radius = 0;
        run(choreo, CLEAR_TRAVEL, () => {
            const [packet] = rowAt(choreo, 'waves', origin);
            expect(packet.z).toBeGreaterThan(radius);
            expect(packet.z).toBeCloseTo(clearRadius(choreo.time - t0), 6);
            radius = packet.z;
        });
        expect(radius).toBeCloseTo(CLEAR_REACH, 3);
        run(choreo, CLEAR_TRAVEL);
        expect(choreo.counts.waves).toBe(0);
        // A clear alone leaves nothing "in flight": only the Drop's own acts and droplets do.
        expect(choreo.isBusy()).toBe(false);
    });

    it('keeps at most WAVE_SLOTS packets, the newest among them', () => {
        const { choreo } = make();
        const origins = [];
        for (let i = 0; i < WAVE_SLOTS * 2 + 1; i++) {
            origins.push([i - 3, -9 - i * 0.5]);
            choreo.clear({ origin: origins[i], lines: 1 + (i % 3) });
            run(choreo, DT);
            expect(choreo.counts.waves).toBe(Math.min(i + 1, WAVE_SLOTS));
        }
        expect(rowAt(choreo, 'waves', origins[origins.length - 1])).toBeTruthy();
        expect(rowAt(choreo, 'waves', origins[0])).toBeUndefined();
        expect(problem(choreo)).toBeNull();
    });

    it('makes every stain the packet crosses flare and let go, and feeds its light to the Drop', () => {
        const lit = make();
        const dark = make();
        let to = null;
        for (const { choreo } of [lit, dark]) {
            ({ to } = lockBeside(choreo, -1, { out: 8, back: -6, color: TEAL }));
            run(choreo, FLIGHT_TIME + 2);
        }
        const strength = ({ choreo }) => rowAt(choreo, 'dye', to)?.[0].w ?? 0;
        expect(strength(lit)).toBeGreaterThan(0);
        expect(strength(lit)).toBe(strength(dark));

        const origin = [...lit.choreo.scene.foot];
        const pass = clearPassTime(Math.hypot(to[0] - origin[0], to[1] - origin[1]));
        expect(pass).toBeGreaterThan(4 * DT);
        lit.choreo.clear({ origin, lines: 2 });
        // Until the front arrives the stain is as it was.
        run(lit.choreo, pass * 0.5);
        run(dark.choreo, pass * 0.5);
        expect(strength(lit)).toBe(strength(dark));
        // As it passes, the stain flares; a bead of light climbs the thread and the Drop swallows it.
        let flare = 0;
        let beads = 0;
        let swell = 0;
        const amps = ({ choreo }) => choreo.beads.reduce((sum, bead) => sum + bead.amp, 0);
        for (let i = 0; i < Math.round((pass * 0.5 + 4) / DT); i++) {
            run(lit.choreo, DT);
            run(dark.choreo, DT);
            if (strength(dark) > 0) flare = Math.max(flare, strength(lit) / strength(dark));
            beads += amps(lit) - amps(dark);
            swell = Math.max(swell, lit.choreo.hero.r - dark.choreo.hero.r);
        }
        expect(flare).toBeGreaterThan(1.05);
        expect(beads).toBeGreaterThan(0);
        expect(swell).toBeGreaterThan(0);
        // The Drop has taken the colour.
        const away = ({ choreo }) => Math.hypot(...choreo.heroTint.map((channel, k) => channel - TEAL[k]));
        expect(away(lit)).toBeLessThan(away(dark));
        // Within a hold the stain has gone; one no packet crossed is still there.
        run(lit.choreo, DYE_HOLD);
        run(dark.choreo, DYE_HOLD);
        expect(lit.choreo.counts.dye).toBe(0);
        expect(dark.choreo.counts.dye).toBe(1);
        expect(strength(dark)).toBeGreaterThan(0);
    });

    it('holds its breath on four lines, then drops the Great Drop into the sea and lifts it back', () => {
        const { choreo, bursts } = make();
        const twin = make().choreo; // the same sea with no clear
        const both = (seconds) => {
            run(choreo, seconds, () => expect(problem(choreo)).toBeNull());
            run(twin, seconds);
        };
        const t0 = choreo.time;
        const anchor = [...choreo.scene.hero];
        choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
        expect(choreo.isBusy()).toBe(true);

        // ── The hush: the sea stills, the Drop still hangs on its thread ──
        both(HUSH_HOLD * 0.75);
        expect(choreo.hush).toBeGreaterThan(0);
        expect(choreo.swell).toBeLessThan(twin.swell);
        expect(threadOn(choreo)).toBe(true);
        expect(choreo.surge).toBe(0);
        expect(kinds(bursts, 'crown')).toHaveLength(0);

        // ── The fall: it lets go of its thread ──
        both(HUSH_HOLD * 0.25 + PLUNGE.fall * 0.5);
        expect(threadOn(choreo)).toBe(false);
        expect(choreo.hero.y).toBeLessThan(twin.hero.y);
        expect(choreo.hero.y).toBeGreaterThan(-choreo.hero.r);
        expect(kinds(bursts, 'crown')).toHaveLength(0);
        expect(choreo.surge).toBe(0);

        // ── The impact: a crown stands up round the crater ──
        both(PLUNGE.fall * 0.5 + 2 * DT);
        const [crown, ...more] = kinds(bursts, 'crown');
        expect(more).toHaveLength(0);
        expect(crown.at - t0).toBeGreaterThanOrEqual(HUSH_HOLD + PLUNGE.fall - 1e-9);
        expect(crown.at - t0).toBeLessThan(HUSH_HOLD + PLUNGE.fall + 2 * DT);
        // Under where it hung: its anchor, give or take the idle sway it fell with (well inside its
        // own footprint; the exact place is pinned in the regressions below).
        expect(Math.hypot(crown.x - anchor[0], crown.z - anchor[2])).toBeLessThan(HERO.radius * 0.5);
        expect(crown.power).toBeGreaterThan(0);
        const { surge } = choreo;
        expect(surge).toBeGreaterThan(0);
        expect(choreo.flash).toBeGreaterThan(0);
        expect(choreo.kick).toBeGreaterThan(0);
        expect(choreo.skyFlash).toBeGreaterThan(0);
        expect(choreo.hero.y).toBeLessThan(0); // it is in the sea
        expect(threadOn(choreo)).toBe(false);
        // The crown is liquid: more of the Drop's group than its body.
        expect(choreo.live[GROUP_HERO]).toBeGreaterThan(choreo.hero.body);
        // A second packet leaves the crater, and rings run out from it.
        expect(choreo.counts.waves).toBe(2);
        expect(rowAt(choreo, 'waves', [crown.x, crown.z])).toBeTruthy();
        expect(rowAt(choreo, 'rings', [crown.x, crown.z])).toBeTruthy();
        // A ring of split light opens across the sky.
        both(0.25);
        expect(choreo.prism.strength).toBeGreaterThan(0);
        expect(choreo.prism.radius).toBeGreaterThan(0);

        // ── And it is lifted back: PLUNGE.total after it let go, it hangs where it hung ──
        both(t0 + HUSH_HOLD + PLUNGE.total + 2 * DT - choreo.time);
        expect(choreo.isBusy()).toBe(false);
        expect(threadOn(choreo)).toBe(true);
        expect(choreo.time).toBeCloseTo(twin.time, 9);
        expect(choreo.hero.x).toBeCloseTo(twin.hero.x, 9);
        expect(choreo.hero.y).toBeCloseTo(twin.hero.y, 9);
        expect(choreo.hero.z).toBeCloseTo(twin.hero.z, 9);
        expect(choreo.hero.body).toBe(twin.hero.body);
        expect(choreo.live[GROUP_HERO]).toBe(choreo.hero.body); // the crown has sunk
        // The overdrive cools.
        expect(choreo.surge).toBeLessThan(surge);
        expect(choreo.surge).toBeGreaterThan(0);
        expect(choreo.hush).toBeLessThan(0.01);
    });

    it('does not start the plunge again for a second four-line clear while the Drop is down', () => {
        const { choreo, bursts } = make();
        const t0 = choreo.time;
        const origin = [...choreo.scene.foot];
        choreo.clear({ origin, lines: 4 });
        run(choreo, HUSH_HOLD + PLUNGE.fall * 1.5); // in the sea
        expect(kinds(bursts, 'crown')).toHaveLength(1);
        const second = [origin[0] + 1.5, origin[1] - 0.5];
        choreo.clear({ origin: second, lines: 4 });
        // No second hush, no second fall: only its packet, after the breath it would have held.
        let { hush } = choreo;
        run(choreo, HUSH_HOLD + PLUNGE.fall, () => {
            expect(choreo.hush).toBeLessThanOrEqual(hush);
            ({ hush } = choreo);
            expect(problem(choreo)).toBeNull();
        });
        expect(rowAt(choreo, 'waves', second)).toBeTruthy();
        expect(choreo.counts.waves).toBeLessThanOrEqual(WAVE_SLOTS);
        // The Drop comes back when the first plunge ends, not a plunge later.
        run(choreo, t0 + HUSH_HOLD + PLUNGE.total + 2 * DT - choreo.time);
        expect(choreo.isBusy()).toBe(false);
        expect(threadOn(choreo)).toBe(true);
        expect(kinds(bursts, 'crown')).toHaveLength(1);
        // Once it hangs again, four lines drop it again.
        run(choreo, 1);
        choreo.clear({ origin, lines: 4 });
        run(choreo, HUSH_HOLD + PLUNGE.fall + 2 * DT);
        expect(kinds(bursts, 'crown')).toHaveLength(2);
        expect(settle(choreo)).toBeLessThan(PLUNGE.total);
    });

    it('throws the crown as spray only on a tier that does not draw it as liquid', () => {
        const { choreo, bursts } = make({ crown: false });
        choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
        run(choreo, HUSH_HOLD + PLUNGE.fall + PLUNGE.crown, () => {
            expect(choreo.live[GROUP_HERO]).toBe(choreo.hero.body);
        });
        expect(kinds(bursts, 'crown')).toHaveLength(1);
        expect(choreo.surge).toBeGreaterThan(0);
    });

    it('has room for the whole crown beside the Drop, whatever chain it falls with, on every tier', () => {
        for (const [name, tier] of Object.entries(QUALITY)) {
            for (const chain of [0, 1, HERO.satellites]) {
                const label = `${name}, a chain of ${chain}`;
                const { choreo } = make({ satellites: tier.satellites, lobes: tier.lobes, crown: tier.crown });
                const asked = countAsks(choreo);
                choreo.setCombo(chain);
                run(choreo, 4);
                // It falls with every satellite the chain has raised.
                expect(satellites(choreo), label).toBe(Math.min(chain, tier.satellites));
                choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
                const { most, dropped } = watchAsks(choreo, asked, HUSH_HOLD + PLUNGE.total + 1);
                expect(dropped, label).toBe(0);
                expect(most, label).toBeLessThanOrEqual(GROUP_CAPACITY[GROUP_HERO]);
                // (The crown is in the count: this is not a body alone.)
                if (tier.crown) expect(most, label).toBeGreaterThan(1 + tier.lobes + tier.satellites);
                // And the chain's satellites come back once the Drop hangs again.
                run(choreo, 4);
                expect(satellites(choreo), label).toBe(Math.min(chain, tier.satellites));
            }
        }
    });

    it('has room for it whenever a second four-line clear arrives', () => {
        const span = HUSH_HOLD + PLUNGE.total;
        for (let i = 0; i < 12; i++) {
            const { choreo } = make();
            const asked = countAsks(choreo);
            choreo.setCombo(HERO.satellites);
            run(choreo, 4);
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
            const first = watchAsks(choreo, asked, (span * (i + 0.5)) / 12);
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
            const second = watchAsks(choreo, asked, span * 2);
            expect(first.dropped + second.dropped, `second clear ${i}/12 through the plunge`).toBe(0);
            expect(choreo.isBusy()).toBe(false);
        }
    });

    it('winds the sea under the Drop into a funnel on a T-spin, and lets it close', () => {
        const { choreo } = make();
        expect(choreo.vortex.depth).toBe(0);
        choreo.clear({ origin: [...choreo.scene.foot], lines: 2, tspin: true });
        expect(choreo.isBusy()).toBe(true);
        run(choreo, 0.5);
        expect(choreo.vortex.depth).toBeGreaterThan(0);
        expect(choreo.vortex.arms).toBeGreaterThan(0);
        expect(choreo.vortex.radius).toBeGreaterThan(0);
        expect([choreo.vortex.x, choreo.vortex.z]).toEqual([choreo.scene.hero[0], choreo.scene.hero[2]]);
        expect(threadOn(choreo)).toBe(true); // the Drop stays up: this is not a plunge
        expect(settle(choreo)).toBeLessThan(30);
        expect(choreo.vortex.depth).toBe(0);
        expect(choreo.vortex.arms).toBe(0);
    });

    it('turns the sea to glass on a perfect clear and opens a ring overhead', () => {
        const { choreo } = make();
        const twin = make().choreo;
        choreo.clear({ origin: [...choreo.scene.foot], lines: 1, perfect: true });
        expect(choreo.isBusy()).toBe(true);
        run(choreo, 1.5);
        run(twin, 1.5);
        expect(choreo.swell).toBeLessThan(twin.swell * 0.5);
        expect(choreo.prism.strength).toBeGreaterThan(0);
        expect(choreo.prism.radius).toBeGreaterThan(0);
        expect(threadOn(choreo)).toBe(true);
        const stilled = settle(choreo);
        expect(stilled).toBeLessThan(30);
        // The sea finds its motion again.
        run(choreo, 4);
        run(twin, choreo.time - twin.time);
        expect(choreo.swell).toBeCloseTo(twin.swell, 2);
    });

    it('marks a new level with a soft packet from the foot of the board and a breath of light', () => {
        const { choreo } = make();
        choreo.levelUp();
        expect(choreo.flash).toBeGreaterThan(0);
        expect(choreo.skyFlash).toBeGreaterThan(0);
        run(choreo, 0.3);
        expect(choreo.counts.waves).toBe(1);
        expect(rowAt(choreo, 'waves', choreo.scene.foot)).toBeTruthy();
        expect(threadOn(choreo)).toBe(true);
        expect(problem(choreo)).toBeNull();
    });
});

describe('fluid dreams choreography: the chain', () => {
    it('charges toward the combo\'s power and buds a satellite for each step, never more than its tier', () => {
        const { choreo } = make({ satellites: 3 });
        const twin = make({ satellites: 3 }).choreo;
        expect(choreo.charge).toBe(0);
        expect(satellites(choreo)).toBe(0);
        choreo.setCombo(2);
        let previous = 0;
        run(choreo, 8, () => {
            expect(choreo.charge).toBeGreaterThanOrEqual(previous);
            expect(choreo.charge).toBeLessThanOrEqual(powerForCombo(2) + 1e-12);
            previous = choreo.charge;
            expect(satellites(choreo)).toBeLessThanOrEqual(2);
            expect(problem(choreo)).toBeNull();
        });
        run(twin, 8);
        expect(choreo.charge).toBeCloseTo(powerForCombo(2), 2);
        expect(satellites(choreo)).toBe(2);
        // The Drop swells with the charge, and the sea with it.
        expect(choreo.hero.r).toBeGreaterThan(twin.hero.r);
        expect(choreo.swell).toBeGreaterThan(twin.swell);
        // A longer chain than the tier can show.
        choreo.setCombo(40);
        run(choreo, 8, () => expect(satellites(choreo)).toBeLessThanOrEqual(3));
        expect(satellites(choreo)).toBe(3);
        expect(choreo.charge).toBeGreaterThan(powerForCombo(2));
        expect(choreo.charge).toBeLessThanOrEqual(1);
        expect(choreo.isBusy()).toBe(false); // a held chain is a state, not an event in flight
        // The chain breaks: the satellites go, the charge drains.
        choreo.setCombo(0);
        previous = choreo.charge;
        run(choreo, 20, () => {
            expect(choreo.charge).toBeLessThanOrEqual(previous);
            previous = choreo.charge;
        });
        expect(satellites(choreo)).toBe(0);
        expect(choreo.charge).toBeLessThan(0.05);
        expect(choreo.charge).toBeGreaterThanOrEqual(0);
    });

    it('raises every satellite the Drop has for a full chain, and none on a tier with none', () => {
        const full = make().choreo;
        const none = make({ satellites: 0 }).choreo;
        for (const choreo of [full, none]) {
            choreo.setCombo(HERO.satellites + 5);
            run(choreo, 8, () => expect(problem(choreo)).toBeNull());
        }
        expect(satellites(full)).toBe(HERO.satellites);
        expect(satellites(none)).toBe(0);
        expect(none.charge).toBeCloseTo(full.charge, 12); // the sea still charges
        // Each satellite is a drop of its own, off the body.
        const body = ballsOf(full, GROUP_HERO).slice(0, full.hero.body);
        for (const moon of ballsOf(full, GROUP_HERO).slice(full.hero.body)) {
            expect(moon.r).toBeLessThan(body[0].r);
            expect(Math.hypot(moon.x - full.hero.x, moon.y - full.hero.y, moon.z - full.hero.z)).toBeGreaterThan(0);
        }
    });

    it('takes a combo as a whole number of steps, and nonsense as none', () => {
        const { choreo } = make();
        choreo.setCombo(NaN);
        expect(choreo.combo).toBe(0);
        choreo.setCombo(-4);
        expect(choreo.combo).toBe(0);
        choreo.setCombo('3');
        expect(choreo.combo).toBe(3);
        choreo.setCombo(2.6);
        expect(choreo.combo).toBe(3);
        choreo.setCombo(undefined);
        expect(choreo.combo).toBe(0);
    });
});

describe('fluid dreams choreography: budgets and time', () => {
    /** A few seconds of play: locks, clears of every size, a chain, a new level. */
    const script = (choreo) => {
        lockBeside(choreo, -1, { hardDrop: true, color: TEAL });
        run(choreo, 0.3);
        choreo.clear({ origin: [...choreo.scene.foot], lines: 2 });
        choreo.setCombo(3);
        run(choreo, 1.2);
        lockBeside(choreo, 1, { out: 9, back: -5 });
        choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
        choreo.setCombo(4);
        run(choreo, 2.5);
        choreo.levelUp();
        lockBeside(choreo, 1, { out: 4, back: -8, color: TEAL });
        choreo.clear({ origin: [...choreo.scene.foot], lines: 3, tspin: true });
        run(choreo, 1.5);
        choreo.setCombo(0);
        run(choreo, 0.5);
    };

    it('never grows a pool or writes a NaN, however fast the board plays', () => {
        const { choreo, bursts } = make();
        const tables = { ...choreo.tables };
        const rowObjects = Object.fromEntries(Object.keys(tables).map((name) => [name, tables[name].slice()]));
        const random = mulberry32(7);
        const most = {
            rings: 0, dye: 0, waves: 0, left: 0, right: 0,
        };
        const check = () => {
            const wrong = problem(choreo);
            if (wrong) throw new Error(`t=${choreo.time.toFixed(3)}: ${wrong}`);
            most.rings = Math.max(most.rings, choreo.counts.rings);
            most.dye = Math.max(most.dye, choreo.counts.dye);
            most.waves = Math.max(most.waves, choreo.counts.waves);
            most.left = Math.max(most.left, choreo.live[GROUP_LEFT]);
            most.right = Math.max(most.right, choreo.live[GROUP_RIGHT]);
        };
        const lock = (hardDrop) => {
            const [fx, fz] = choreo.scene.foot;
            const side = random() < 0.5 ? -1 : 1;
            choreo.lock({
                from: [fx + side * (1 + random()), 0.5 + random() * 7, fz + 3],
                to: [fx + side * (2 + random() * 14), fz - random() * 12],
                color: [random(), random(), random()],
                hardDrop,
            });
        };
        // 200 locks and 100 clears in a little over three seconds: far more than can ever land.
        for (let i = 0; i < 200; i++) {
            lock(i % 3 === 0);
            if (i % 2 === 0) {
                choreo.clear({
                    origin: [choreo.scene.foot[0] + random() - 0.5, choreo.scene.foot[1]],
                    lines: 1 + (i % 4),
                    tspin: i % 7 === 0,
                    perfect: i % 31 === 0,
                });
            }
            choreo.setCombo(i % 13);
            if (i % 40 === 0) choreo.levelUp();
            run(choreo, DT, check);
        }
        // Then as fast as a board can really be played, for long enough to fill the sea.
        for (let i = 0; i < 40; i++) {
            lock(i % 5 === 0);
            run(choreo, FLIGHT_TIME / 5, check);
        }
        run(choreo, 8, check);
        // The flood did fill the pools: the limits were reached, never passed.
        expect(most.rings).toBe(RING_SLOTS);
        expect(most.waves).toBe(WAVE_SLOTS);
        expect(most.dye).toBeGreaterThan(DYE_SLOTS / 2); // (colour landing in colour joins it)
        expect(most.dye).toBeLessThanOrEqual(DYE_SLOTS);
        expect(most.left).toBeGreaterThan(1);
        expect(most.left).toBeLessThanOrEqual(GROUP_CAPACITY[GROUP_LEFT]);
        expect(most.right).toBeGreaterThan(1);
        expect(most.right).toBeLessThanOrEqual(GROUP_CAPACITY[GROUP_RIGHT]);
        // The tables are the very objects the material's uniforms were built on.
        for (const name of Object.keys(tables)) {
            expect(choreo.tables[name], name).toBe(tables[name]);
            expect(choreo.tables[name].every((row, i) => row === rowObjects[name][i]), name).toBe(true);
        }
        // Every burst it asked for can be drawn.
        for (const burst of bursts) {
            const numbers = [burst.x, burst.y, burst.z, burst.power, ...burst.color];
            expect(numbers.every(Number.isFinite), burst.kind).toBe(true);
        }
        // And it all drains: the sea is left with stains only.
        expect(settle(choreo, 60)).toBeLessThan(60);
        run(choreo, CLEAR_TRAVEL * 2 + 10);
        expect(choreo.counts.waves).toBe(0);
        expect(choreo.live[GROUP_LEFT] + choreo.live[GROUP_RIGHT]).toBe(0);
        expect(problem(choreo)).toBeNull();
    });

    it('is a function of its event history and its clock', () => {
        const a = make();
        const b = make();
        script(a.choreo);
        script(b.choreo);
        expect(snapshot(a.choreo).length).toBeGreaterThan(150);
        expect(snapshot(a.choreo)).toEqual(snapshot(b.choreo));
        expect(a.bursts).toEqual(b.bursts);
        expect(a.bursts.length).toBeGreaterThan(10);

        // Something else entirely in between...
        a.choreo.setReducedMotion(true);
        a.choreo.setCombo(9);
        lockBeside(a.choreo, -1, { hardDrop: true });
        a.choreo.clear({ origin: [2, -12], lines: 3, perfect: true });
        run(a.choreo, 3);
        a.choreo.setReducedMotion(false);
        // ...then a capture's recipe: seek, the same events, the same steps.
        a.bursts.length = 0;
        a.choreo.seek(10);
        a.choreo.update(10, 0, PALETTE);
        script(a.choreo);
        expect(snapshot(a.choreo)).toEqual(snapshot(b.choreo));
        expect(a.bursts).toEqual(b.bursts);
    });

    it('reaches the same sea at 30 and at 240 frames a second', () => {
        const play = (fps) => {
            const { choreo } = make();
            const step = (seconds) => {
                const steps = Math.round(seconds * fps);
                const t0 = choreo.time;
                for (let i = 1; i <= steps; i++) choreo.update(t0 + (seconds * i) / steps, seconds / steps, PALETTE);
            };
            lockBeside(choreo, -1);
            choreo.setCombo(4);
            step(2);
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
            step(HUSH_HOLD + PLUNGE.total + 1);
            // A lock after the clear: its colour is still in the water at the end.
            const { to } = lockBeside(choreo, 1);
            step(FLIGHT_TIME + JET_TIME * 2);
            return { choreo, stain: rowAt(choreo, 'dye', to)?.[0].w ?? 0 };
        };
        const slow = play(30);
        const fast = play(240);
        expect(slow.choreo.time).toBeCloseTo(fast.choreo.time, 9);
        expect(Array.from(slow.choreo.live)).toEqual(Array.from(fast.choreo.live));
        expect(slow.stain).toBeGreaterThan(0);
        for (const key of ['charge', 'surge', 'hush']) {
            expect(slow.choreo[key], key).toBeCloseTo(fast.choreo[key], 2);
        }
        expect(slow.choreo.swell).toBeCloseTo(fast.choreo.swell, 1);
        for (const key of ['x', 'y', 'z']) expect(slow.choreo.hero[key], key).toBeCloseTo(fast.choreo.hero[key], 6);
        expect(slow.choreo.hero.r).toBeCloseTo(fast.choreo.hero.r, 2);
        expect(slow.stain).toBeCloseTo(fast.stain, 2);
    });

    it('drops everything in flight when it seeks or resets, and stands as a fresh sea would', () => {
        for (const how of ['seek', 'reset']) {
            const { choreo } = make({ satellites: 4 });
            lockBeside(choreo, -1, { hardDrop: true });
            lockBeside(choreo, 1);
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4, tspin: true });
            choreo.setCombo(6);
            choreo.levelUp();
            run(choreo, 1.2);
            expect(choreo.isBusy()).toBe(true);
            expect(choreo.counts.dye).toBeGreaterThan(0);
            expect(threadOn(choreo)).toBe(false);

            if (how === 'seek') {
                choreo.seek(40);
                expect(choreo.time).toBe(40);
            } else {
                choreo.reset();
            }
            expect(choreo.isBusy()).toBe(false);
            expect(choreo).toMatchObject({
                combo: 0, charge: 0, surge: 0, hush: 0, flash: 0, kick: 0, skyFlash: 0, filmShift: 0, swell: 1,
            });
            choreo.update(40, 0, PALETTE);
            expect(problem(choreo)).toBeNull();
            for (const group of EVENT_GROUPS) expect(choreo.live[group]).toBe(0);
            expect(choreo.counts.dye).toBe(0);
            expect(choreo.counts.waves).toBe(0);
            expect(satellites(choreo)).toBe(0);
            expect(threadOn(choreo)).toBe(true);
            expect(choreo.vortex.depth).toBe(0);
            // Exactly the tables a sea that was never played shows at that time.
            expect(snapshot(choreo), how).toEqual(snapshot(make({ satellites: 4 }, 40).choreo));
        }
        // A seek before the start of time is the start of time.
        const { choreo } = make();
        choreo.seek(-5);
        expect(choreo.time).toBe(0);
    });

    it('stills its idle motion under reduced motion, and keeps every reaction', () => {
        const lively = make();
        const calm = make();
        calm.choreo.setReducedMotion(true);
        const span = () => ({
            x: [Infinity, -Infinity], y: [Infinity, -Infinity], kin: [Infinity, -Infinity],
        });
        const ranges = [span(), span()];
        [lively, calm].forEach(({ choreo }, i) => {
            const widen = (range, value) => {
                range[0] = Math.min(range[0], value);
                range[1] = Math.max(range[1], value);
            };
            run(choreo, 60, () => {
                widen(ranges[i].x, choreo.hero.x);
                widen(ranges[i].y, choreo.hero.y);
                widen(ranges[i].kin, ballsOf(choreo, GROUP_KIN)[0].y);
            });
        });
        const width = (range) => range[1] - range[0];
        for (const key of ['x', 'y', 'kin']) {
            expect(width(ranges[0][key]), key).toBeGreaterThan(0);
            expect(width(ranges[1][key]), key).toBeLessThan(width(ranges[0][key]) * 0.75);
        }
        expect(calm.choreo.swell).toBeLessThan(lively.choreo.swell);
        // Feedback stays: the droplet, the landing, the packet, the charge, the plunge.
        const { to } = lockBeside(calm.choreo, -1);
        calm.choreo.clear({ origin: [...calm.choreo.scene.foot], lines: 4 });
        calm.choreo.setCombo(5);
        run(calm.choreo, HUSH_HOLD + PLUNGE.fall + FLIGHT_TIME);
        expect(kinds(calm.bursts, 'splash')).toHaveLength(1);
        expect(kinds(calm.bursts, 'crown')).toHaveLength(1);
        expect(rowAt(calm.choreo, 'dye', to)).toBeTruthy();
        expect(calm.choreo.counts.waves).toBeGreaterThan(0);
        expect(calm.choreo.charge).toBeGreaterThan(0);
        expect(problem(calm.choreo)).toBeNull();
        // Only `true` asks for it.
        calm.choreo.setReducedMotion('yes');
        expect(calm.choreo.reducedMotion).toBe(false);
    });

    it('is busy exactly while a droplet, a jet or one of the Drop\'s acts is in flight', () => {
        const { choreo } = make();
        expect(choreo.isBusy()).toBe(false);
        // States and the sea's own tables are not "in flight".
        choreo.setCombo(5);
        choreo.levelUp();
        choreo.clear({ origin: [...choreo.scene.foot], lines: 3 });
        run(choreo, 0.5);
        expect(choreo.isBusy()).toBe(false);
        // A droplet, then its jet.
        lockBeside(choreo, 1);
        expect(choreo.isBusy()).toBe(true);
        run(choreo, FLIGHT_TIME + JET_TIME * 0.5);
        expect(choreo.isBusy()).toBe(true);
        run(choreo, JET_TIME * 0.5 + 2 * DT);
        expect(choreo.isBusy()).toBe(false);
        // The plunge, from the breath it holds to the moment the Drop hangs again.
        choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
        expect(choreo.isBusy()).toBe(true);
        run(choreo, HUSH_HOLD + PLUNGE.total - 4 * DT);
        expect(choreo.isBusy()).toBe(true);
        run(choreo, 6 * DT);
        expect(choreo.isBusy()).toBe(false);
    });
});

describe('fluid dreams choreography: regressions', () => {
    it('fades a perfect clear\'s ring whatever the clear\'s size, and never leaves it in the sky', () => {
        for (const lines of [1, 2, 3]) {
            const { choreo } = make();
            let peak = 0;
            let step = 0;
            let previous = 0;
            const watch = () => {
                peak = Math.max(peak, choreo.prism.strength);
                step = Math.max(step, Math.abs(choreo.prism.strength - previous));
                previous = choreo.prism.strength;
            };
            choreo.clear({ origin: [...choreo.scene.foot], lines, perfect: true });
            run(choreo, 1, watch);
            expect(choreo.prism.strength, `${lines} lines`).toBeGreaterThan(0);
            expect(choreo.prism.radius, `${lines} lines`).toBeGreaterThan(0);
            for (let i = 0; choreo.isBusy() && i < 60 * 30; i++) run(choreo, DT, watch);
            expect(choreo.isBusy()).toBe(false);
            // It eased in and out: no frame took more than a quarter of it.
            expect(step, `${lines} lines`).toBeLessThan(peak * 0.25);
            // Gone, and it stays gone.
            let after = 0;
            run(choreo, 20, () => {
                after = Math.max(after, choreo.prism.strength);
            });
            expect(after, `${lines} lines`).toBe(0);
        }
        // A four-line clear's own ring, and a perfect four-line clear's, end the same way.
        for (const perfect of [false, true]) {
            const { choreo } = make();
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4, perfect });
            let peak = 0;
            run(choreo, HUSH_HOLD + PLUNGE.total, () => {
                peak = Math.max(peak, choreo.prism.strength);
            });
            expect(peak).toBeGreaterThan(0);
            run(choreo, 8);
            let after = 0;
            run(choreo, 10, () => {
                after = Math.max(after, choreo.prism.strength);
            });
            expect(after).toBe(0);
        }
    });

    it('never jumps the Great Drop: it falls from where it hangs and comes back to where it would hang', () => {
        const FINE = 1 / 480;
        for (const start of [12, 15, 21, 28]) {
            const { choreo, bursts } = make({}, start);
            const twin = make({}, start).choreo; // the same Drop, never dropped
            const both = (seconds, each) => {
                const steps = Math.max(1, Math.round(seconds / FINE));
                const t0 = choreo.time;
                for (let i = 1; i <= steps; i++) {
                    const time = t0 + (seconds * i) / steps;
                    choreo.update(time, seconds / steps, PALETTE);
                    twin.update(time, seconds / steps, PALETTE);
                    each?.();
                }
            };
            both(0.5);
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
            let lift = choreo.hero.y - twin.hero.y;
            let sideways = 0;
            let jump = 0;
            let crown = null;
            both(HUSH_HOLD + PLUNGE.total + 0.5, () => {
                // The plunge is a vertical act: across the sea the Drop keeps its idle sway.
                sideways = Math.max(
                    sideways,
                    Math.abs(choreo.hero.x - twin.hero.x),
                    Math.abs(choreo.hero.z - twin.hero.z),
                );
                // While it is within a metre of where it hangs (leaving, and coming back), it moves
                // there: it is never set there. (1/480 s: even falling, a step is centimetres.)
                const now = choreo.hero.y - twin.hero.y;
                if (Math.abs(now) < 1 && Math.abs(lift) < 1) jump = Math.max(jump, Math.abs(now - lift));
                lift = now;
                if (!crown && bursts.length) {
                    crown = bursts.find((burst) => burst.kind === 'crown') || null;
                    if (crown) {
                        // It meets the sea under where it hung that instant: the crown, the packet
                        // and the rings all start there.
                        expect(crown.x).toBeCloseTo(twin.hero.x, 9);
                        expect(crown.z).toBeCloseTo(twin.hero.z, 9);
                        expect(rowAt(choreo, 'waves', [crown.x, crown.z])).toBeTruthy();
                        expect(rowAt(choreo, 'rings', [crown.x, crown.z])).toBeTruthy();
                    }
                }
            });
            expect(crown, `t=${start}`).toBeTruthy();
            expect(sideways, `t=${start}`).toBeLessThan(1e-9);
            expect(jump, `t=${start}`).toBeLessThan(0.1);
            // And it hangs exactly where a Drop that never fell hangs.
            expect(lift, `t=${start}`).toBeCloseTo(0, 9);
            expect(choreo.isBusy()).toBe(false);
            expect(threadOn(choreo)).toBe(true);
        }
    });

    it('rains what the crown threw back onto the crater, while the Drop is down', () => {
        const { choreo, bursts } = make();
        const t0 = choreo.time;
        choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
        run(choreo, HUSH_HOLD + PLUNGE.total + 2);
        const [crown] = kinds(bursts, 'crown');
        const rain = kinds(bursts, 'rain');
        expect(rain.length).toBeGreaterThan(1);
        for (const burst of rain) {
            expect(burst.at).toBeGreaterThan(crown.at);
            expect(burst.at).toBeLessThan(t0 + HUSH_HOLD + PLUNGE.total);
            expect(burst.y).toBeGreaterThan(0); // from above the sea
            expect(Math.abs(burst.x - crown.x)).toBeLessThan(HERO.radius);
            expect(burst.power).toBeGreaterThan(0);
        }
        // A frame held still asks for it once, not again.
        const again = make();
        again.choreo.clear({ origin: [...again.choreo.scene.foot], lines: 4 });
        run(again.choreo, HUSH_HOLD + PLUNGE.fall + PLUNGE.crown * 0.5);
        const asked = again.bursts.length;
        for (let i = 0; i < 10; i++) again.choreo.update(again.choreo.time, 0, PALETTE);
        expect(again.bursts).toHaveLength(asked);
    });

    it('deepens a stain when colour lands in colour, without shrinking it', () => {
        const { choreo } = make();
        const { to } = lockBeside(choreo, -1, { color: ROSE });
        run(choreo, FLIGHT_TIME + DYE_HOLD * 0.9);
        expect(choreo.counts.dye).toBe(1);
        const [old] = rowAt(choreo, 'dye', to);
        const before = { radius: old.z, strength: old.w };
        expect(before.strength).toBeGreaterThan(0);
        // A second droplet, of another colour, into the same water.
        lockBeside(choreo, -1, { color: TEAL });
        let { radius } = before;
        let shrank = 0;
        run(choreo, FLIGHT_TIME + 0.75, () => {
            const [stain] = rowsOf(choreo, 'dye')[0];
            shrank = Math.max(shrank, radius - stain.z);
            radius = stain.z;
        });
        // The spread it had, it keeps (it only ever grows).
        expect(shrank).toBeLessThan(1e-9);
        expect(radius).toBeGreaterThan(before.radius);
        // One deeper stain, not two, holding both colours.
        expect(choreo.counts.dye).toBe(1);
        const [stain, look] = rowAt(choreo, 'dye', to);
        expect(stain.w).toBeGreaterThan(before.strength);
        const colour = [look.x, look.y, look.z];
        colour.forEach((channel, k) => {
            expect(channel).toBeGreaterThanOrEqual(Math.min(ROSE[k], TEAL[k]) - 1e-9);
            expect(channel).toBeLessThanOrEqual(Math.max(ROSE[k], TEAL[k]) + 1e-9);
        });
        expect(colour).not.toEqual([...ROSE]);
        expect(problem(choreo)).toBeNull();
    });

    it('takes the ring of split light out of the sky when it resets or seeks', () => {
        for (const how of ['reset', 'seek back']) {
            const { choreo } = make();
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
            run(choreo, HUSH_HOLD + PLUNGE.fall + 0.5);
            expect(choreo.prism.strength, how).toBeGreaterThan(0);
            const { time } = choreo;
            if (how === 'reset') {
                // A new run on the same clock.
                choreo.reset();
                choreo.update(time + DT, DT, PALETTE);
            } else {
                // A capture seeking to before the impact it has already played.
                choreo.seek(time - 4);
                choreo.update(time - 4, 0, PALETTE);
            }
            expect(choreo.prism.strength, how).toBe(0);
            // Not now, and not when the clock passes the old impact: nothing is left to replay.
            let seen = 0;
            run(choreo, 10, () => {
                seen = Math.max(seen, choreo.prism.strength);
            });
            expect(seen, how).toBe(0);
            expect(choreo.isBusy()).toBe(false);
        }
    });

    it('does not replay a drip that fell before a seek or a reset, and lands the ones after it', () => {
        // When the kin's drips reach the sea, in a sea left alone.
        const alone = make({}, 6);
        run(alone.choreo, 40);
        const landings = kinds(alone.bursts, 'drip').map((burst) => burst.at);
        expect(landings.length).toBeGreaterThan(4);
        const [, from, next, to, end] = landings;
        let tried = 0;
        for (let i = 0; i < 40; i++) {
            const time = from + ((to - from) * (i + 0.5)) / 40;
            // (Not within a breath of a landing: which side of it a frame falls is not the point.)
            if (landings.every((at) => Math.abs(at - time) > 0.1)) {
                tried += 1;
                const { choreo, bursts } = make({}, time);
                // Nothing lands on the frame it arrives at...
                expect(bursts, `seek(${time.toFixed(2)})`).toHaveLength(0);
                expect(choreo.counts.rings, `seek(${time.toFixed(2)})`).toBe(0);
                // ...and every drip after it lands once, when it would have.
                run(choreo, end + 0.5 - time);
                const mine = kinds(bursts, 'drip').map((burst) => burst.at);
                const due = landings.filter((at) => at > time && at < end + 0.5);
                expect(mine, `seek(${time.toFixed(2)})`).toHaveLength(due.length);
                mine.forEach((at, k) => expect(Math.abs(at - due[k])).toBeLessThan(2 * DT));
            }
        }
        expect(tried).toBeGreaterThan(30);
        // A reset on the same clock (a new run), just after a drip has landed.
        const { choreo, bursts } = make({}, from + 0.5);
        run(choreo, 0.5);
        choreo.reset();
        choreo.update(from + 1 + DT, DT, PALETTE);
        expect(bursts).toHaveLength(0);
        expect(choreo.counts.rings).toBe(0);
        run(choreo, next + 0.5 - choreo.time);
        expect(kinds(bursts, 'drip')).toHaveLength(1);
    });
});

describe('fluid dreams choreography: continuity', () => {
    const FINE = 1 / 480;
    /** Step at 480 fps for `seconds`; `each` runs after every frame. */
    const fine = (choreo, seconds, each) => {
        const steps = Math.max(1, Math.round(seconds / FINE));
        const t0 = choreo.time;
        for (let i = 1; i <= steps; i++) {
            choreo.update(t0 + (seconds * i) / steps, seconds / steps, PALETTE);
            each(choreo);
        }
    };

    it('lets the first drip of a freshly started theme fall', () => {
        // A theme's clock starts at 0 on every scene build: cycle 0 is a cycle like any other.
        const { choreo, bursts } = make({}, 0);
        run(choreo, 5.5);
        expect(kinds(bursts, 'drip')).toHaveLength(1);
        expect(choreo.counts.rings).toBeGreaterThan(0);
    });

    it('hands the sky from a four-line ring to a perfect clear\'s ring without a step', () => {
        const watch = (arrange) => {
            const { choreo } = make();
            arrange(choreo);
            let last = choreo.prism.strength;
            let step = 0;
            let peak = 0;
            fine(choreo, HUSH_HOLD + PLUNGE.total + 8, () => {
                step = Math.max(step, Math.abs(choreo.prism.strength - last));
                last = choreo.prism.strength;
                peak = Math.max(peak, last);
            });
            return { step, peak, end: choreo.prism.strength };
        };
        // Four lines and a perfect clear at once (what the playground's event=perfect plays).
        const together = watch((choreo) => choreo.clear({ origin: [...choreo.scene.foot], lines: 4, perfect: true }));
        // A perfect clear a few seconds after a four-line impact.
        const after = watch((choreo) => {
            choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
            fine(choreo, HUSH_HOLD + PLUNGE.fall + 3, () => {});
            choreo.clear({ origin: [...choreo.scene.foot], lines: 2, perfect: true });
        });
        for (const seen of [together, after]) {
            expect(seen.peak).toBeGreaterThan(0.5);
            // The steepest thing a ring does is open: nothing switches on or off between frames.
            expect(seen.step).toBeLessThan(0.05);
            expect(seen.end).toBe(0);
        }
    });

    it('keeps the Great Drop\'s size continuous through the plunge and through a swallow', () => {
        const { choreo } = make();
        // Colour in the sea, so the clear's bead has something to carry up the thread.
        lockBeside(choreo, -1);
        run(choreo, FLIGHT_TIME + 1);
        const rest = choreo.hero.r;
        choreo.clear({ origin: [...choreo.scene.foot], lines: 4 });
        let last = choreo.hero.r;
        let step = 0;
        let least = last;
        let most = last;
        fine(choreo, HUSH_HOLD + PLUNGE.total + 3, () => {
            step = Math.max(step, Math.abs(choreo.hero.r - last) / last);
            last = choreo.hero.r;
            least = Math.min(least, last);
            most = Math.max(most, last);
        });
        // It draws itself in before it falls and swells when it swallows, a little each frame.
        expect(least).toBeLessThan(rest);
        expect(most).toBeGreaterThan(rest);
        expect(step).toBeLessThan(0.004);
        // The same swallow at rest: a three-line clear's bead arrives and the Drop grows smoothly.
        const calm = make().choreo;
        calm.clear({ origin: [...calm.scene.foot], lines: 3 });
        let before = calm.hero.r;
        let jump = 0;
        let grew = 0;
        fine(calm, 4, () => {
            jump = Math.max(jump, Math.abs(calm.hero.r - before) / before);
            grew = Math.max(grew, calm.hero.r);
            before = calm.hero.r;
        });
        expect(grew).toBeGreaterThan(make().choreo.hero.r);
        expect(jump).toBeLessThan(0.004);
    });

    it('changes a stain\'s colour, not its place, when colour lands beside it', () => {
        const { choreo } = make();
        const first = lockBeside(choreo, -1, { color: ROSE });
        run(choreo, FLIGHT_TIME + 6);
        expect(choreo.counts.dye).toBe(1);
        const [before] = rowsOf(choreo, 'dye')[0];
        const place = [before.x, before.y];
        // A second droplet a metre and a half along: near enough to join the first stain.
        lockBeside(choreo, -1, { out: 7.5, color: TEAL });
        run(choreo, FLIGHT_TIME + 0.5);
        expect(choreo.counts.dye).toBe(1);
        const [stain, look] = rowsOf(choreo, 'dye')[0];
        expect([stain.x, stain.y]).toEqual(place);
        expect(place).toEqual(first.to);
        expect([look.x, look.y, look.z]).not.toEqual([...ROSE]);
    });

    it('has room for every jet a fast player raises', () => {
        // Four locks a second, two in five of them hard drops, for ten seconds, on alternate sides.
        const { choreo } = make();
        const asked = countAsks(choreo);
        const random = mulberry32(77);
        let short = 0;
        let most = 0;
        for (let i = 0; i < 40; i++) {
            lockBeside(choreo, i % 2 ? 1 : -1, {
                out: 4 + random() * 6, back: -8 + random() * 10, hardDrop: random() < 0.4, color: i % 3 ? ROSE : TEAL,
            });
            for (let f = 0; f < 15; f++) {
                asked.fill(0);
                run(choreo, DT);
                for (const g of EVENT_GROUPS) {
                    most = Math.max(most, asked[g]);
                    if (asked[g] !== choreo.live[g]) short += 1;
                }
            }
            expect(problem(choreo)).toBeNull();
        }
        expect(most).toBeGreaterThan(4);
        expect(short).toBe(0);
    });
});
