import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FAR_FILE, LONE, MOON_WOLF, TRAVEL_GAITS, VISITS, farFileAt, follow, itineraryLength, moonWolfAt, roversAt,
    visitKind, visitPlan,
} from '../../src/themes/wolfhour/wolfhour-wolf-travel.js';
import {
    RIPPLE, SWEEP, WOLFHOUR_WEATHER, WolfhourNightDirector, wolfhourWeatherAt,
} from '../../src/themes/wolfhour/wolfhour-night-director.js';
import { WOLFHOUR_HOURS } from '../../src/themes/wolfhour/wolfhour-hours.js';
import {
    ROVER_COATS, WOLF_COATS, WOLF_LOOKS, roverLook,
} from '../../src/themes/wolfhour/wolfhour-wolf-coats.js';
import {
    CAPSULE_COUNT, CAPSULE_STRIDE, GAITS, WOLF_BOUNDS, WOLF_SHAPE, poseWolf,
} from '../../src/themes/wolfhour/wolfhour-wolf-rig.js';
import { TABLE_WIDTH, WOLF_TEXELS } from '../../src/themes/wolfhour/wolfhour-wolf-material.js';
import {
    HOWL, MAX_WOLVES, PACK, createWolfhourPack,
} from '../../src/themes/wolfhour/wolfhour-wolves.js';
import { AURORA_CURTAINS, createWolfhourAurora } from '../../src/themes/wolfhour/wolfhour-aurora.js';
import { VOICE, createWolfhourVoices } from '../../src/themes/wolfhour/wolfhour-voices.js';
import { SNOW_DEVIL, createWolfhourSnow } from '../../src/themes/wolfhour/wolfhour-snow.js';
import { createWolfhourLandscape } from '../../src/themes/wolfhour/wolfhour-landscape.js';
import { createWolfhourSky } from '../../src/themes/wolfhour/wolfhour-sky.js';
import { WOLFHOUR_TETROMINOS } from '../../src/themes/wolfhour/wolfhour-tetrominos.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

/**
 * Wolfhour's night: the wolves that travel, the coats they wear, the gaits they go in, what the
 * night does by the hour and in answer to play, and the lights, arcs and snow that show it.
 */
vi.setConfig({ testTimeout: 60_000 });

const owners = [];
const own = (owner) => {
    owners.push(owner);
    return owner;
};
afterEach(() => {
    for (const owner of owners.splice(0).reverse()) owner?.dispose?.();
});

const RIDGE = Object.freeze({ left: -723, right: 191 });
const firstOf = (kind) => Array.from({ length: 200 }, (_, i) => i).find((i) => visitKind(i) === kind);
const startOf = (index) => VISITS.first + index * VISITS.period;

describe('Wolfhour travellers', () => {
    it('gives every other visit to the scout, opens with the hunt and never draws a kind twice running', () => {
        expect(visitKind(0)).toBe('scout');
        expect(visitKind(1)).toBe('hunt');
        const seen = new Set();
        for (let i = 0; i < 80; i++) {
            const kind = visitKind(i);
            seen.add(kind);
            if (i % 2 === 0) expect(kind).toBe('scout');
            else if (i >= 3) expect(kind).not.toBe(visitKind(i - 2));
        }
        expect([...seen].sort()).toEqual(['chase', 'hunt', 'lone', 'pair', 'prowl', 'scout']);
    });

    it('fits every visit inside its slot, from one edge of the frame or the other', () => {
        for (let i = 1; i < 60; i += 2) {
            const plan = visitPlan(i, RIDGE);
            expect(plan.wolves.length).toBeGreaterThan(0);
            for (const wolf of plan.wolves) {
                expect(wolf.delay + itineraryLength(wolf.legs, wolf.x0)).toBeLessThan(VISITS.period);
                // It starts at or beyond the edge it comes in from.
                if (plan.dir > 0) expect(wolf.x0).toBeLessThanOrEqual(RIDGE.left);
                else expect(wolf.x0).toBeGreaterThanOrEqual(RIDGE.right);
            }
        }
    });

    it('moves a traveller without a jump, from a standstill and back to one', () => {
        for (const kind of ['hunt', 'prowl', 'pair', 'chase', 'lone']) {
            const plan = visitPlan(firstOf(kind), RIDGE);
            for (const wolf of plan.wolves) {
                const length = itineraryLength(wolf.legs, wolf.x0);
                let previous = null;
                for (let u = 0; u < length; u += 1 / 60) {
                    const now = follow(wolf.legs, u, wolf.x0, wolf.facing);
                    expect(now).not.toBeNull();
                    expect(Number.isFinite(now.x)).toBe(true);
                    if (previous) expect(Math.abs(now.x - previous.x)).toBeLessThan((TRAVEL_GAITS.run.speed * 1.1) / 60);
                    // It starts each leg with its paws at rest and comes to rest at its end.
                    if (now.moving) expect(now.pace).toBeLessThanOrEqual(1);
                    previous = now;
                }
                expect(follow(wolf.legs, length + 0.01, wolf.x0, wolf.facing)).toBeNull();
                expect(follow(wolf.legs, -1, wolf.x0, wolf.facing)).toBeNull();
            }
        }
    });

    it('sends the hunt across the whole frame in file, the leader first', () => {
        const index = firstOf('hunt');
        const plan = visitPlan(index, RIDGE);
        expect(plan.wolves.length).toBeGreaterThanOrEqual(4);
        expect(plan.wolves.length).toBeLessThanOrEqual(5);
        const mid = roversAt(startOf(index) + 6, RIDGE);
        expect(mid.kind).toBe('hunt');
        const xs = mid.wolves.filter(Boolean).map((w) => w.x * plan.dir);
        // In file: each behind the one before, a wolf's length and more apart.
        for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i]).toBeGreaterThan(25);
        for (const wolf of mid.wolves.filter(Boolean)) {
            expect(wolf.moving).toBe(true);
            expect(wolf.gaitKind).toBe('lope');
        }
        // And every one of them leaves by the far edge.
        for (const wolf of plan.wolves) {
            const last = wolf.legs.at(-1).go;
            if (plan.dir > 0) expect(last).toBeGreaterThan(RIDGE.right);
            else expect(last).toBeLessThan(RIDGE.left);
        }
        expect(roversAt(startOf(index) + VISITS.period - 1, RIDGE)).toBeNull();
    });

    it('prowls in low, freezes with a paw raised, and breaks into a run', () => {
        const index = firstOf('prowl');
        const [first] = visitPlan(index, RIDGE).wolves;
        const gaits = [];
        let frozen = 0;
        for (let u = 0; u < itineraryLength(first.legs, first.x0); u += 0.1) {
            const now = follow(first.legs, u, first.x0, first.facing);
            if (now.moving && gaits.at(-1) !== now.gaitKind) gaits.push(now.gaitKind);
            if (!now.moving && (now.act?.pawUp ?? 0) > 0.9) frozen += 1;
            if (now.gaitKind === 'prowl' && now.moving && now.pace > 0.99) expect(now.act.crouch).toBeGreaterThan(3);
        }
        expect(gaits).toEqual(['prowl', 'run']);
        expect(frozen).toBeGreaterThan(10);
    });

    it('lets the lone wolf sit down and howl on its own, twice, then go', () => {
        const [lone] = visitPlan(firstOf('lone'), RIDGE).wolves;
        const walk = itineraryLength(lone.legs.slice(0, 1), lone.x0);
        const at = (u) => follow(lone.legs, walk + u, lone.x0, lone.facing);
        expect(at(0.1).act.sit).toBeLessThan(0.1);
        for (const [from, to] of LONE.howls) {
            const mid = at((from + to) / 2);
            expect(mid.act.sit).toBe(1);
            expect(mid.act.howl).toBe(1);
            // (It does not also join the pack's: its howl is its own.)
            expect(mid.howls).toBe(false);
        }
        expect(at(LONE.howls[0][1] + 0.9).act.howl).toBeLessThan(0.3);
        expect(at(LONE.stay - 0.05).act.sit).toBeLessThan(0.1);
    });

    it('walks the far file over the skyline: up into view, over the crest and gone', () => {
        expect(farFileAt(FAR_FILE.first - 1)).toBeNull();
        const start = FAR_FILE.first;
        let shown = 0;
        let gone = false;
        for (let u = 0; u < FAR_FILE.period; u += 0.5) {
            const file = farFileAt(start + u);
            if (!file) {
                if (shown > 0) gone = true;
                continue;
            }
            expect(gone).toBe(false);
            shown += 1;
            const live = file.wolves.filter(Boolean);
            expect(live.length).toBeGreaterThan(0);
            for (const wolf of live) {
                expect(wolf.fade).toBeGreaterThanOrEqual(0);
                expect(wolf.fade).toBeLessThanOrEqual(1);
                expect(wolf.sink).toBeGreaterThanOrEqual(0);
                expect(wolf.facing).toBe(-1);
            }
        }
        expect(shown).toBeGreaterThan(40);
        expect(gone).toBe(true);
        // Coming into view and going over the crest it is faded and sunk; between, whole.
        const lead = (u) => farFileAt(start + u).wolves[0];
        expect(lead(0.2).fade).toBeLessThan(0.2);
        expect(lead(10).fade).toBe(1);
        expect(lead(10).sink).toBe(0);
    });

    it('brings the white wolf up onto the summit by itself, and at once when called', () => {
        expect(moonWolfAt(MOON_WOLF.first - 1)).toBeNull();
        const t0 = MOON_WOLF.first;
        expect(moonWolfAt(t0 + 0.2).up).toBeLessThan(0.2);
        const standing = moonWolfAt(t0 + MOON_WOLF.rise + 3);
        expect(standing.up).toBe(1);
        const howling = moonWolfAt(t0 + MOON_WOLF.rise + (MOON_WOLF.howl[0] + MOON_WOLF.howl[1]) / 2);
        expect(howling.howl).toBe(1);
        expect(howling.sit).toBe(1);
        expect(moonWolfAt(t0 + MOON_WOLF.rise * 2 + MOON_WOLF.stay + 1)).toBeNull();
        // Called between its own visits it comes up, without a howl of its own (it joins the pack's).
        const away = t0 + MOON_WOLF.period - 20;
        expect(moonWolfAt(away)).toBeNull();
        const called = moonWolfAt(away + MOON_WOLF.rise + 1, away);
        expect(called.up).toBe(1);
        expect(called.howl).toBe(0);
        // Continuous as it rises.
        let previous = 0;
        for (let u = 0; u <= MOON_WOLF.rise; u += 0.05) {
            const { up } = moonWolfAt(away + u, away);
            expect(up).toBeGreaterThanOrEqual(previous - 1e-9);
            expect(up - previous).toBeLessThan(0.08);
            previous = up;
        }
    });
});

describe('Wolfhour coats and builds', () => {
    it('gives every wolf of the night a coat that exists, darkest on the saddle, palest below', () => {
        const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        for (const coat of Object.values(WOLF_COATS)) {
            expect(luma(coat.dark)).toBeLessThan(luma(coat.mid));
            expect(luma(coat.mid)).toBeLessThan(luma(coat.pale));
            // Albedos: none gives back more light than falls on it.
            for (const tone of [coat.dark, coat.mid, coat.pale]) for (const c of tone) expect(c).toBeLessThanOrEqual(1);
        }
        for (const look of Object.values(WOLF_LOOKS)) expect(WOLF_COATS[look.coat]).toBeDefined();
        // The pack at home wears five different coats; the wolf of the summit is the white one.
        const home = PACK.map((spec) => WOLF_LOOKS[spec.role].coat);
        expect(new Set(home).size).toBe(PACK.length);
        expect(WOLF_LOOKS.moon.coat).toBe('white');
    });

    it('deals a visit\'s wolves different coats and builds, the same ones at every seek', () => {
        const file = [0, 1, 2, 3, 4].map((place) => roverLook(7, place));
        expect(new Set(file.map((look) => look.coat)).size).toBeGreaterThanOrEqual(4);
        expect(roverLook(7, 2)).toEqual(file[2]);
        for (const look of file) {
            expect(ROVER_COATS).toContain(look.coat);
            expect(look.scale).toBeGreaterThan(0.85);
            expect(look.scale).toBeLessThan(1.15);
            for (const key of Object.keys(WOLF_SHAPE)) {
                expect(look.shape[key]).toBeGreaterThan(0.8);
                expect(look.shape[key]).toBeLessThan(1.3);
            }
        }
    });
});

describe('Wolfhour pieces', () => {
    // CIELAB ΔE76 under Machado 2009 full-severity simulation, applied in linear RGB (as
    // tests/unit/spring-core.test.js).
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const gam = (c) => {
        const x = Math.min(1, Math.max(0, c));
        return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    };
    const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lab = (rgbS) => {
        const [r, g, b] = rgbS.map(lin);
        const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
        const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
        return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
    };
    const SIGHT = {
        full: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
        deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
        tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
    };
    const seen = (rgbS, m) => {
        const l = rgbS.map(lin);
        return m.map((row) => gam(row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
    };

    it('keeps the seven pieces apart to every kind of sight, and light enough on the dark board', () => {
        const shapes = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
        const { colors } = WOLFHOUR_TETROMINOS;
        for (const [sight, matrix] of Object.entries(SIGHT)) {
            const labs = shapes.map((key) => lab(seen(rgbOf(colors[key]), matrix)));
            let worst = Infinity;
            for (let i = 0; i < labs.length; i++) {
                for (let j = i + 1; j < labs.length; j++) {
                    worst = Math.min(worst, Math.hypot(...labs[i].map((v, k) => v - labs[j][k])));
                }
            }
            expect(worst, sight).toBeGreaterThan(16);
        }
        // Every piece stands well clear of the dark field and of the rubble under it.
        const rubble = lab(rgbOf(colors.GARBAGE))[0];
        for (const key of shapes) expect(lab(rgbOf(colors[key]))[0], key).toBeGreaterThan(Math.max(38, rubble + 20));
    });
});

describe('Wolfhour gaits', () => {
    const bones = (rig, first) => {
        const c = rig.capsules;
        const bone = (i) => Math.hypot(c[i * CAPSULE_STRIDE + 2] - c[i * CAPSULE_STRIDE], c[i * CAPSULE_STRIDE + 3] - c[i * CAPSULE_STRIDE + 1]);
        return [bone(first), bone(first + 1)];
    };
    const grounds = {
        flat: () => 0, uphill: (x) => x * 0.35, downhill: (x) => x * -0.35, rough: (x) => Math.sin(x * 0.45 + 1) * 1.6 + x * 0.12,
    };
    const going = {
        walk: {}, trot: {}, prowl: { crouch: 4.2, head: -22 }, lope: { crouch: 1.6, head: -8 }, run: { crouch: 2.4, head: -12 },
    };

    it.each(Object.keys(going))('keeps the %s inside the quad with every leg its own length, on any ground', (gaitKind) => {
        const { stride } = TRAVEL_GAITS[gaitKind];
        expect(GAITS[gaitKind]).toBeDefined();
        const [x0, y0, x1, y1] = WOLF_BOUNDS;
        for (const ground of Object.values(grounds)) {
            for (let gait = 0; gait < 1; gait += 0.05) {
                const rig = poseWolf({
                    build: 'standing', gaitKind, stride, gait, ground, ...going[gaitKind],
                });
                expect(Array.from(rig.capsules).every(Number.isFinite)).toBe(true);
                for (let i = 0; i < CAPSULE_COUNT; i++) {
                    const [ax, ay, bx, by, ra, rb] = rig.capsules.slice(i * CAPSULE_STRIDE, i * CAPSULE_STRIDE + 6);
                    expect(Math.min(ax - ra, bx - rb)).toBeGreaterThan(x0);
                    expect(Math.max(ax + ra, bx + rb)).toBeLessThan(x1);
                    expect(Math.min(ay - ra, by - rb)).toBeGreaterThan(y0);
                    expect(Math.max(ay + ra, by + rb)).toBeLessThan(y1);
                }
                // The body sinks onto its legs rather than a leg being drawn out to reach its paw.
                for (const first of [11, 14, 17, 20]) {
                    const [upper, lower] = bones(rig, first);
                    expect(upper).toBeCloseTo(first < 17 ? 7.5 : 7.6, 3);
                    expect(lower).toBeCloseTo(first < 17 ? 7.3 : 6.9, 3);
                }
            }
        }
    });

    it('bounds through a gallop: gathered and in the air once a stride, stretched out between', () => {
        const heights = [];
        const pitches = [];
        for (let gait = 0; gait < 1; gait += 0.02) {
            const rig = poseWolf({
                build: 'standing', gaitKind: 'run', stride: TRAVEL_GAITS.run.stride, gait, crouch: 2.4,
            });
            // The torso is the first capsule: hip (a) to shoulder (b).
            heights.push((rig.capsules[1] + rig.capsules[3]) / 2);
            pitches.push(rig.capsules[3] - rig.capsules[1]);
        }
        expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(2);
        // The forehand rises as the hind legs drive and falls as the fore paws land.
        expect(Math.max(...pitches)).toBeGreaterThan(1.5);
        expect(Math.min(...pitches)).toBeLessThan(-1.5);
    });

    it('builds a wolf to its own shape without changing where its joints are', () => {
        const plain = poseWolf({ build: 'standing' });
        const heavy = poseWolf({ build: 'standing', shape: { bulk: 1.2, ruff: 1.2, tail: 1.2, ear: 1.2 } });
        const radius = (rig, i) => rig.capsules[i * CAPSULE_STRIDE + 5];
        // The torso (0), the neck (5) and the brush (24) are fuller...
        for (const i of [0, 5, 24]) expect(radius(heavy, i)).toBeGreaterThan(radius(plain, i));
        // ...the legs the same, and every joint where it was.
        for (const first of [11, 14, 17, 20]) {
            expect(bones(heavy, first)).toEqual(bones(plain, first));
            expect(radius(heavy, first)).toBe(radius(plain, first));
        }
        expect(Array.from(heavy.capsules.slice(0, 4))).toEqual(Array.from(plain.capsules.slice(0, 4)));
    });

    it('gives every capsule a depth, a coat tone and a fur length for the shader', () => {
        const rig = poseWolf({ build: 'standing' });
        for (let i = 0; i < CAPSULE_COUNT; i++) {
            const [tone, az, bz, fur] = [7, 8, 9, 10].map((k) => rig.capsules[i * CAPSULE_STRIDE + k]);
            expect(tone).toBeGreaterThanOrEqual(0);
            expect(tone).toBeLessThanOrEqual(1);
            expect(Math.abs(az)).toBeLessThan(8);
            expect(Math.abs(bz)).toBeLessThan(8);
            expect(fur).toBeGreaterThan(0);
        }
        // The near legs stand before the far ones; a wolf turned to face you brings its head forward.
        const z = (r, i) => r.capsules[i * CAPSULE_STRIDE + 9];
        expect(z(rig, 12)).toBeGreaterThan(z(rig, 15));
        const facing = poseWolf({ build: 'standing', yaw: Math.PI / 2 });
        expect(z(facing, 7)).toBeGreaterThan(z(facing, 24) + 20);
    });
});

describe('Wolfhour night director', () => {
    // (sample() fills one kept object: a reading to compare with a later one is copied out.)
    const at = (director, time, phase = 0, motion = 1) => JSON.parse(JSON.stringify(director.sample(time, phase, motion)));

    it('keeps a clear, still night on the silver hour until something happens', () => {
        const director = new WolfhourNightDirector();
        const night = director.sample(20, 0);
        expect(night.aurora).toBe(0);
        expect(night.fall).toBe(0);
        expect(night.sweeps[0][1]).toBe(0);
        expect(night.sweeps[1][1]).toBe(0);
        expect(night.ripple[3]).toBe(0);
        expect(night.spin).toBe(0);
        expect(night.streak).toBe(0);
    });

    it('gives every hour its own weather, breathing, within bounds', () => {
        expect(WOLFHOUR_WEATHER).toHaveLength(WOLFHOUR_HOURS.length);
        const named = (name) => WOLFHOUR_HOURS.findIndex((hour) => hour.name === name);
        // Northern lights at deep midnight, snow in the wolf's hour, gold dust under the hunter's moon.
        expect(WOLFHOUR_WEATHER[named('deep midnight')].aurora).toBeGreaterThan(0.2);
        expect(WOLFHOUR_WEATHER[named("the wolf's hour")].fall).toBeGreaterThan(0.5);
        expect(WOLFHOUR_WEATHER[named("hunter's moon")].dust).toBeGreaterThan(0.3);
        const seen = { aurora: new Set(), fall: new Set() };
        for (let phase = 0; phase < 5; phase += 0.125) {
            for (let time = 0; time < 400; time += 37) {
                const w = wolfhourWeatherAt(phase, time);
                for (const key of ['aurora', 'reach', 'dust', 'fall', 'wind']) {
                    expect(w[key]).toBeGreaterThanOrEqual(0);
                    expect(w[key]).toBeLessThanOrEqual(1.2);
                }
                seen.aurora.add(w.aurora.toFixed(2));
                seen.fall.add(w.fall.toFixed(2));
            }
        }
        // Not one setting per hour: it comes and goes.
        expect(seen.aurora.size).toBeGreaterThan(12);
        expect(seen.fall.size).toBeGreaterThan(12);
        // The hours come round: the fifth hour on is the first again.
        expect(wolfhourWeatherAt(5, 10)).toEqual(wolfhourWeatherAt(0, 10));
    });

    it('answers a bigger clear with more of the night: one band, two, the lights, the howl\'s curtains, the crown', () => {
        const answer = (hit) => {
            const director = new WolfhourNightDirector();
            hit(director);
            return at(director, 12, 0);
        };
        const single = answer((d) => d.clear(10, { lines: 1 }));
        const double = answer((d) => d.clear(10, { lines: 2 }));
        const triple = answer((d) => d.clear(10, { lines: 3 }));
        const quad = answer((d) => d.clear(10, { lines: 4 }));
        const perfect = answer((d) => { d.clear(10, { lines: 4 }); d.perfect(10.36); });
        const bands = (night) => night.sweeps.filter((sweep) => sweep[1] > 0).length;
        expect(bands(single)).toBe(1);
        expect(bands(double)).toBe(2);
        expect(single.aurora).toBe(0);
        expect(double.aurora).toBe(0);
        expect(triple.aurora).toBeGreaterThan(0.15);
        expect(quad.aurora).toBeGreaterThan(triple.aurora * 1.6);
        expect(quad.reach).toBeGreaterThan(triple.reach * 2);
        expect(perfect.aurora).toBeGreaterThan(quad.aurora);
        expect(perfect.reach).toBeGreaterThan(0.85);
        expect(perfect.dust).toBeGreaterThan(quad.dust * 2);
        expect(quad.dust).toBeGreaterThan(triple.dust);
    });

    it('sweeps a band of moonlight across the ranges and lets it go', () => {
        const director = new WolfhourNightDirector();
        director.clear(10, { lines: 1 });
        const xs = [];
        for (let u = 0.1; u < SWEEP.life; u += 0.2) {
            const [x, strength, width] = director.sample(10 + u, 0).sweeps.find((sweep) => sweep[1] > 0);
            xs.push(x);
            expect(strength).toBeGreaterThan(0);
            expect(width).toBe(SWEEP.width);
        }
        // Left to right, edge to edge.
        for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
        expect(xs[0]).toBeLessThan(-SWEEP.span * 0.8);
        expect(xs.at(-1)).toBeGreaterThan(SWEEP.span * 0.8);
        expect(director.sample(10 + SWEEP.life + 0.1, 0).sweeps.every((sweep) => sweep[1] === 0)).toBe(true);
        // A back-to-back's comes the other way.
        director.backToBack(20);
        const back = [0.5, 1.5].map((u) => director.sample(20.15 + u, 0).sweeps.find((sweep) => sweep[1] > 0)[0]);
        expect(back[1]).toBeLessThan(back[0]);
    });

    it('runs a ring of sparkle out from a lock, a hard drop\'s the stronger', () => {
        const director = new WolfhourNightDirector();
        director.lock(5, { x: 240, y: -60 });
        const early = at(director, 5.2);
        const late = at(director, 5.2 + RIPPLE.life * 0.6);
        expect(early.ripple.slice(0, 2)).toEqual([240, -60]);
        expect(late.ripple[2]).toBeGreaterThan(early.ripple[2] + 100);
        expect(late.ripple[3]).toBeLessThan(early.ripple[3]);
        expect(at(director, 5.1 + RIPPLE.life).ripple[3]).toBe(0);
        director.lock(9, { x: 0, y: 0, hardDrop: true });
        const hard = at(director, 9.2).ripple[3];
        expect(hard).toBeGreaterThan(early.ripple[3]);
        // A plain lock right after does not cut a hard drop's ring short.
        director.lock(9.1, { x: 500, y: 500 });
        expect(at(director, 9.25).ripple.slice(0, 2)).toEqual([0, 0]);
    });

    it('accumulates: fast play lifts the lights, it never restarts them', () => {
        const once = new WolfhourNightDirector();
        once.clear(10, { lines: 4 });
        const twice = new WolfhourNightDirector();
        twice.clear(10, { lines: 4 });
        let previous = 0;
        for (let t = 10.05; t < 11.5; t += 0.05) {
            if (Math.abs(t - 10.8) < 0.026) twice.clear(t, { lines: 4 });
            const { aurora } = twice.sample(t, 0);
            // The second howl's light joins the first's: no dip, no jump.
            expect(aurora).toBeGreaterThanOrEqual(previous - 1e-6);
            expect(aurora - previous).toBeLessThan(0.2);
            previous = aurora;
        }
        expect(twice.sample(13, 0).aurora).toBeGreaterThan(once.sample(13, 0).aurora);
        // A chain feeds them too.
        const chain = new WolfhourNightDirector();
        chain.clear(10, { lines: 1, combo: 5 });
        expect(chain.sample(11.5, 0).aurora).toBeGreaterThan(0.1);
        // And all of it falls away again.
        expect(twice.sample(80, 0).aurora).toBeLessThan(0.01);
    });

    it('wheels the stars for a level and settles the sky back, but not under Reduce motion', () => {
        const director = new WolfhourNightDirector();
        director.sample(29.95, 0);
        director.levelUp(30);
        let peak = 0;
        let streak = 0;
        let rush = director.sample(30, 0).rush;
        for (let t = 30 + 1 / 30; t < 34; t += 1 / 30) {
            const night = director.sample(t, 0);
            peak = Math.max(peak, night.spin);
            streak = Math.max(streak, night.streak);
            // The cloud is swept on and never back.
            expect(night.rush).toBeGreaterThanOrEqual(rush);
            rush = night.rush;
            expect(night.spin).toBeLessThan(0.31);
            expect(night.streak).toBeLessThanOrEqual(0.2);
        }
        expect(peak).toBeGreaterThan(0.08);
        expect(streak).toBeGreaterThan(0.01);
        // Minutes on the sky has all but come back, slowly (no streak).
        const later = director.sample(190, 0);
        expect(later.spin).toBeLessThan(0.01);
        const calm = new WolfhourNightDirector();
        calm.levelUp(30);
        const still = calm.sample(31, 0, 0);
        expect(still.spin).toBe(0);
        expect(still.streak).toBe(0);
        // Under Reduce motion a band of moonlight does not travel: the ranges brighten and fade.
        calm.clear(40, { lines: 1 });
        const band = calm.sample(41, 0, 0).sweeps.find((sweep) => sweep[1] > 0);
        expect(band[0]).toBe(0);
        expect(band[2]).toBeGreaterThan(SWEEP.width * 3);
    });

    it('lets snow fall when a run ends and stops it when the next begins', () => {
        const director = new WolfhourNightDirector();
        expect(director.sample(10, 0).fall).toBe(0);
        director.over(10);
        expect(director.sample(11, 0).fall).toBeLessThan(0.2);
        expect(director.sample(20, 0).fall).toBeGreaterThan(0.5);
        director.begin(30);
        expect(director.sample(40, 0).fall).toBe(0);
        // A fever holds the lights up; reset() is a quiet night again.
        director.setHeat({ level: 1, fever: 1 });
        expect(director.sample(41, 0).aurora).toBeGreaterThan(0.6);
        director.clear(42, { lines: 4 });
        director.reset();
        const quiet = director.sample(43, 0);
        expect(quiet.aurora).toBe(0);
        expect(quiet.fall).toBe(0);
    });
});

describe('Wolfhour pack and its travellers', () => {
    const flat = () => 0;
    const settled = (quality = 'High') => {
        const pack = own(createWolfhourPack({ quality }));
        pack.settle(flat);
        pack.answerer.settle(flat);
        pack.scout.settle(flat, RIDGE);
        pack.far.settle(flat);
        pack.summit.settle(flat);
        return pack;
    };
    const shown = (wolves) => wolves.filter((entry) => entry.mesh.visible);

    it('draws every wolf of the night with one material from one table', () => {
        const pack = settled();
        expect(pack.everyWolf.length).toBeLessThanOrEqual(MAX_WOLVES);
        const materials = new Set(pack.everyWolf.map((entry) => entry.mesh.material));
        expect(materials.size).toBe(1);
        // Each has a row of its own.
        const rows = pack.everyWolf.map((entry) => entry.mesh.userData.wolfRow);
        expect(new Set(rows).size).toBe(rows.length);
        expect(Math.max(...rows)).toBeLessThan(MAX_WOLVES);
        const [material] = materials;
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(TABLE_WIDTH).toBe((CAPSULE_COUNT * CAPSULE_STRIDE) / 4 + 6);
        expect(WOLF_TEXELS.pale).toBe(TABLE_WIDTH - 1);
    });

    it('keeps five at home on the spur, the mate lying on the near face in front', () => {
        const pack = settled();
        pack.update(20);
        const home = shown(pack.wolves);
        expect(home.map((entry) => entry.spec.name)).toEqual(['lead', 'sitter', 'young', 'mate', 'yearling']);
        const mate = home.find((entry) => entry.spec.name === 'mate');
        const lead = home.find((entry) => entry.spec.name === 'lead');
        expect(mate.mesh.position.y).toBeLessThan(lead.mesh.position.y - 5);
        expect(mate.mesh.position.z).toBeGreaterThan(lead.mesh.position.z);
        expect(mate.act.down).toBe(1);
        // The lowest tier keeps the three it had.
        const lean = settled('Minimal');
        lean.update(20);
        expect(shown(lean.wolves)).toHaveLength(3);
        expect(lean.scout.wolves).toHaveLength(1);
        expect(lean.far.wolves).toHaveLength(0);
    });

    it('howls together: the yearling turns round to the moon for it, and every voice is heard', () => {
        const pack = settled();
        pack.howl(20);
        pack.update(20 + HOWL.rise + 1.9);
        const yearling = pack.wolves.find((entry) => entry.spec.name === 'yearling');
        expect(yearling.howling).toBe(1);
        // It faces the pack at rest (+1); howling it has turned half a circle, to the moon.
        expect(yearling.spec.facing).toBe(1);
        expect(yearling.muzzle[0]).toBeLessThan(0);
        const voices = pack.voices();
        expect(voices.length).toBeGreaterThanOrEqual(6);
        for (const [x, y, z, level] of voices) {
            expect([x, y, z].every(Number.isFinite)).toBe(true);
            expect(level).toBeGreaterThan(0.05);
        }
        pack.update(60);
        expect(pack.voices()).toHaveLength(0);
    });

    it('poses the ridge\'s visits: the scout alone, then the hunt in file, dressed in their own coats', () => {
        const pack = settled();
        pack.update(30);
        expect(shown(pack.scout.wolves)).toHaveLength(1);
        const hunt = firstOf('hunt');
        pack.update(startOf(hunt) + 6);
        const runners = shown(pack.scout.wolves);
        expect(runners.length).toBeGreaterThanOrEqual(4);
        for (const runner of runners) {
            expect(runner.moving).toBe(true);
            expect(runner.gaitKind).toBe('lope');
            expect(runner.speed).toBeGreaterThan(60);
        }
        expect(new Set(runners.map((runner) => runner.look.coat)).size).toBeGreaterThanOrEqual(3);
        expect(pack.visitAt(startOf(hunt) + 6).kind).toBe('hunt');
        // The lone wolf's own howl is heard though the pack is silent (the white wolf, which may be
        // howling on its summit just then, left out).
        pack.summit.settle(null);
        const lone = firstOf('lone');
        const [plan] = visitPlan(lone, RIDGE).wolves;
        const walk = itineraryLength(plan.legs.slice(0, 1), plan.x0);
        pack.update(startOf(lone) + walk + (LONE.howls[0][0] + LONE.howls[0][1]) / 2);
        expect(pack.howlLevel(startOf(lone) + walk + 4)).toBe(0);
        expect(pack.scout.wolf.howling).toBeGreaterThan(0.9);
        expect(pack.voices()).toHaveLength(1);
        // Under Reduce motion nobody travels.
        pack.update(startOf(hunt) + 6, 0);
        expect(shown(pack.scout.wolves)).toHaveLength(0);
        // A screen too narrow for the visits keeps the scout's.
        pack.scout.settle(flat, null);
        pack.update(startOf(hunt) + 6);
        expect(shown(pack.scout.wolves)).toHaveLength(0);
        pack.update(30);
        expect(shown(pack.scout.wolves)).toHaveLength(1);
    });

    it('sends a hunt across when play calls for one, unless the ridge is taken', () => {
        const pack = settled();
        // The scout is on the ridge at 30 s: refused.
        expect(pack.dash(30)).toBe(false);
        // Between visits it runs.
        const free = startOf(2) - 22;
        pack.update(free);
        expect(shown(pack.scout.wolves)).toHaveLength(0);
        expect(pack.dash(free)).toBe(true);
        expect(pack.dash(free + 1)).toBe(false);
        pack.update(free + 6);
        const runners = shown(pack.scout.wolves);
        expect(runners.length).toBeGreaterThanOrEqual(4);
        expect(runners.every((runner) => runner.gaitKind === 'lope')).toBe(true);
        expect(pack.visitAt(free + 6).kind).toBe('hunt');
    });

    it('shows the far file on the skyline and the white wolf on the summit in their time, and when called', () => {
        const pack = settled();
        pack.update(FAR_FILE.first + 12);
        const file = shown(pack.far.wolves);
        expect(file.length).toBeGreaterThanOrEqual(3);
        for (const entry of file) {
            expect(entry.gaitKind).toBe('trot');
            expect(entry.fade).toBeGreaterThan(0);
        }
        pack.update(FAR_FILE.first - 5);
        expect(shown(pack.far.wolves)).toHaveLength(0);
        // The white wolf: away, then called up by a perfect clear, howling with the pack.
        const away = MOON_WOLF.first + MOON_WOLF.period - 20;
        pack.update(away);
        expect(pack.summit.wolf.mesh.visible).toBe(false);
        pack.summon(away);
        pack.howl(away);
        pack.update(away + MOON_WOLF.rise + 2);
        expect(pack.summit.wolf.mesh.visible).toBe(true);
        expect(pack.summit.wolf.look.coat).toBe('white');
        expect(pack.summit.wolf.howling).toBeGreaterThan(0.8);
        // Called again while it stands, it stays up (it does not come up a second time).
        pack.summon(away + MOON_WOLF.rise + 3);
        pack.update(away + MOON_WOLF.rise + 3.1);
        expect(pack.summit.wolf.fade).toBe(1);
        // A screen with no room for them shows neither.
        pack.far.settle(null);
        pack.summit.settle(null);
        pack.update(FAR_FILE.first + 12);
        expect(shown(pack.far.wolves)).toHaveLength(0);
        expect(pack.summit.wolf.mesh.visible).toBe(false);
    });

    it('never jumps a traveller from one frame to the next, at a run or over the crest', () => {
        const pack = own(createWolfhourPack());
        const ridge = (x) => Math.sin(x * 0.05) * 6 + x * 0.06;
        pack.settle(ridge);
        pack.answerer.settle(ridge);
        pack.scout.settle(ridge, RIDGE);
        pack.far.settle(ridge);
        pack.summit.settle(ridge);
        const ends = (wolf) => {
            if (!wolf.mesh.visible) return null;
            const { x: sx, y: sy } = wolf.mesh.scale;
            const { x: px, y: py } = wolf.mesh.position;
            const c = wolf.capsules;
            return Array.from({ length: CAPSULE_COUNT }, (_, i) => {
                const o = i * CAPSULE_STRIDE;
                return [c[o] * sx + px, c[o + 1] * sy + py, c[o + 2] * sx + px, c[o + 3] * sy + py];
            });
        };
        let before = null;
        let largest = 0;
        for (let frame = 0; frame < 300 * 30; frame++) {
            const t = frame / 30;
            if (frame === 100 * 30) pack.howl(t);
            if (frame === 200 * 30) pack.summon(t);
            pack.update(t);
            const now = pack.everyWolf.map(ends);
            if (before) {
                now.forEach((wolf, w) => {
                    if (!wolf || !before[w]) return;
                    wolf.forEach((end, i) => {
                        const was = before[w][i];
                        largest = Math.max(
                            largest,
                            Math.hypot(end[0] - was[0], end[1] - was[1]),
                            Math.hypot(end[2] - was[2], end[3] - was[3]),
                        );
                    });
                });
            }
            before = now;
        }
        // A galloping leg is the fastest thing in the night: under 9 units a frame at 30 a second.
        expect(largest).toBeLessThan(9);
    });
});

describe('Wolfhour lights, arcs and snow', () => {
    it('hangs the northern lights by tier and draws nothing while the sky is dark', () => {
        expect(createWolfhourAurora({ quality: 'Minimal' })).toBeNull();
        const low = own(createWolfhourAurora({ quality: 'Low' }));
        const high = own(createWolfhourAurora({ quality: 'High' }));
        expect(low.curtains).toBe(2);
        expect(high.curtains).toBe(AURORA_CURTAINS.length);
        expect(high.mesh.visible).toBe(false);
        high.update(10, 0, 0);
        expect(high.mesh.visible).toBe(false);
        high.update(10, 0.8, 0.5);
        expect(high.mesh.visible).toBe(true);
        expect(high.level).toBe(0.8);
        high.update(10, 9, 9);
        expect(high.level).toBe(1.6);
        // Added light: it cannot hide the stars or the board.
        expect(high.mesh.material.blending).toBe(THREE.AdditiveBlending);
        expect(high.mesh.material.depthWrite).toBe(false);
        const camera = { position: { x: 40, y: -10 } };
        high.applyParallax(camera);
        expect(high.mesh.position.x).toBeGreaterThan(30);
        expect(high.mesh.position.x).toBeLessThan(40);
    });

    it('sends an arc from every howling muzzle, on a beat, and lets them thin away', () => {
        const voices = own(createWolfhourVoices({ quality: 'High' }));
        expect(voices.mesh.visible).toBe(false);
        voices.setMoon(-300, 340);
        const howling = [[600, -180, -950, 1], [-700, -200, -950, 1]];
        for (let t = 0; t < 3; t += 1 / 30) voices.update(t, howling);
        expect(voices.mesh.visible).toBe(true);
        // About one arc every VOICE.every from each, all still in the air.
        const alive = voices.alive(3);
        expect(alive).toBeGreaterThanOrEqual(6);
        expect(alive).toBeLessThanOrEqual(12);
        expect(alive).toBeLessThanOrEqual(voices.capacity);
        // A voice too faint to carry sends none; the arcs in the air run out.
        for (let t = 3; t < 3 + VOICE.life + 0.5; t += 1 / 30) voices.update(t, [[600, -180, -950, 0.2]]);
        expect(voices.alive(3 + VOICE.life + 0.5)).toBe(0);
        expect(voices.mesh.visible).toBe(false);
        // Under Reduce motion they come half as often.
        const calm = own(createWolfhourVoices({ quality: 'High' }));
        for (let t = 0; t < 3; t += 1 / 30) calm.update(t, howling, 0);
        expect(calm.alive(3)).toBeLessThan(alive);
        expect(calm.alive(3)).toBeGreaterThan(0);
        expect(createWolfhourVoices({ quality: 'Minimal' }).capacity).toBeLessThan(voices.capacity);
    });

    it('lets snow fall, the air glitter and the snow devil stand only when asked', () => {
        expect(createWolfhourSnow({ quality: 'Minimal' })).toBeNull();
        const snow = own(createWolfhourSnow({ quality: 'High' }));
        snow.update(5, { fall: 0, dust: 0, wind: 0 });
        expect([snow.flakes.visible, snow.crystals.visible, snow.devil.visible]).toEqual([false, false, false]);
        snow.update(5, { fall: 0.6, dust: 0 });
        expect([snow.flakes.visible, snow.crystals.visible]).toEqual([true, false]);
        snow.update(5, { fall: 0, dust: 0.5 });
        expect([snow.flakes.visible, snow.crystals.visible]).toEqual([false, true]);
        // A twist raises the devil; it stands its life and is gone. A second twist feeds the first.
        snow.whirl(10, 300, -340, 1);
        snow.update(10.5, {});
        expect(snow.devil.visible).toBe(true);
        expect(snow.devilLeft(10.5)).toBeCloseTo(SNOW_DEVIL.life - 0.5, 6);
        snow.whirl(11, -300, -340, 1);
        expect(snow.devilLeft(11)).toBeCloseTo(SNOW_DEVIL.life - 1, 6);
        snow.update(10 + SNOW_DEVIL.life + 0.1, {});
        expect(snow.devil.visible).toBe(false);
        expect(createWolfhourSnow({ quality: 'Low' }).flakes.count).toBeLessThan(snow.flakes.count);
    });

    it('takes the bands of moonlight, the ripple and the wheel of the stars as plain numbers', () => {
        const landscape = own(createWolfhourLandscape({ quality: 'Low', seed: 73013 }));
        expect(() => {
            landscape.setSweep(0, -400, 0.8, 210);
            landscape.setSweep(1, NaN, NaN, NaN);
            landscape.setRipple(240, -60, 300, 0.6);
            landscape.setRipple(NaN, NaN, NaN, NaN);
        }).not.toThrow();
        const scene = new THREE.Scene();
        const sky = own(createWolfhourSky({ scene, quality: 'Low' }));
        expect(() => {
            sky.setWheel(0.12, 0.05, 520);
            sky.setWheel(NaN, 9, NaN);
        }).not.toThrow();
    });
});

describe('Wolfhour night shaders', () => {
    const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
    /** Every mesh of the night's new parts, at a tier. */
    const parts = (quality) => {
        const pack = own(createWolfhourPack({ quality }));
        const aurora = own(createWolfhourAurora({ quality }));
        const voices = own(createWolfhourVoices({ quality }));
        const snow = own(createWolfhourSnow({ quality }));
        const meshes = new Map();
        const collect = (root) => root?.traverse((object) => {
            if (object.isMesh && !meshes.has(object.material)) meshes.set(object.material, object);
        });
        for (const root of [pack.group, pack.scout.group, aurora?.mesh, voices.mesh, snow?.group]) collect(root);
        return [...meshes.values()];
    };

    it.each(['High', 'Low'])('builds the wolves, the lights, the arcs and the snow on both backends at %s', (quality) => {
        const meshes = parts(quality);
        // The wolves' one material, their breath, the northern lights, the arcs, and the snow's three.
        expect(meshes.length).toBe(7);
        for (const mesh of meshes) {
            for (const [name, Builder] of BACKENDS) {
                const built = build(Builder, mesh);
                const label = `${mesh.name} (${name})`;
                expect(built.thrown, label).toBeUndefined();
                expect(built.heard, label).toEqual([]);
                for (const stage of [built.vertex, built.fragment]) {
                    expect(stage.length, label).toBeGreaterThan(100);
                    expect(stage.length, label).toBeLessThan(40 * 1024);
                    expect(/\bNaN\b|\bInfinity\b|\[object /.test(stage), label).toBe(false);
                }
                if (name === 'WGSL') expect(unassignedReads(built.fragment), label).toEqual([]);
            }
        }
    });

    it('reads the wolves\' table with integer fetches in a loop, the same on both backends', () => {
        const pack = own(createWolfhourPack({ quality: 'High' }));
        const [wolf] = pack.wolves;
        const wgsl = build(THREE.WGSLNodeBuilder, wolf.mesh).fragment;
        const glsl = build(THREE.GLSLNodeBuilder, wolf.mesh).fragment;
        expect(wgsl).toMatch(/textureLoad\(/);
        expect(glsl).toMatch(/texelFetch\(/);
        // One loop over the capsules, not a copy of the body per capsule.
        expect(wgsl.match(/\bloop\b|\bwhile\b|\bfor\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
        expect(wgsl.length).toBeLessThan(24 * 1024);
    });
});
