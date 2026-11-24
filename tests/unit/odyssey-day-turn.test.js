/**
 * THE DAY TURNS (world/odyssey-day-turn.js) and THE WEATHER'S CLOCK (world/odyssey-weather-clock.js):
 * the island's morning, the mountains' afternoon, the shade the day turns behind between them, and
 * the slow weather over both.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    float, uniform, vec2, vec3,
} from 'three/tsl';

import {
    ODYSSEY_DAY_TURN,
    ODYSSEY_HOUR_LOOK,
    createDayTurnPace,
    dayTurnAt,
    dayTurnFront,
    dayTurnField,
} from '../../src/rendering/odyssey/world/odyssey-day-turn.js';
import {
    ODYSSEY_WEATHER,
    ODYSSEY_WEATHER_RANGE,
    odysseyWeatherAt,
    odysseyWeatherDrive,
} from '../../src/rendering/odyssey/world/odyssey-weather-clock.js';
import {
    ODYSSEY_COLOUR_SCRIPT,
    getColourScriptHours,
    sampleColourScript,
} from '../../src/rendering/odyssey/odyssey-colour-script.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { createOdysseyWorld } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

/** Act II progress of journey progress `p` on the live layout (the world's `update` clock). */
function actTOf(p, cp) {
    return (p - cp[1]) / (cp[5] - cp[1]);
}
/** The colour script's own p at Act II progress `actT` (the world's map below its run-out). */
const scriptPOf = (actT) => 0.05 + (actT * 0.9);

describe('the day turns between the island and the mountains', () => {
    const rig = createOdysseyCameraRig();
    const [from, to] = ODYSSEY_DAY_TURN.window;

    it('runs between the last island orb and the first mountain orbs, so every parked view is one hour', () => {
        // Orb 18 is chapter 3's last, orbs 19 and 20 chapter 4's first (they park together, inside
        // the chapter): the turn must not have begun at the one, and must be over at the others.
        const last = actTOf(rig.parkOf(18), rig.cp);
        const first = actTOf(Math.min(rig.parkOf(19), rig.parkOf(20)), rig.cp);
        expect(rig.chapterOf(18)).toBe(3);
        expect(rig.chapterOf(19)).toBe(4);
        expect(from).toBeGreaterThanOrEqual(last);
        expect(to).toBeLessThanOrEqual(first);
        expect(dayTurnAt(last).on).toBe(false);
        expect(dayTurnAt(first).on).toBe(false);
        // ...and it takes most of the stretch between them (a moment, not a blink).
        expect(to - from).toBeGreaterThan((first - last) * 0.85);
    });

    it('stands on the colour script keyframes it turns between', () => {
        const morning = ODYSSEY_COLOUR_SCRIPT.find((k) => k.name === 'island-morning');
        const afternoon = ODYSSEY_COLOUR_SCRIPT.find((k) => k.name === 'mountain-afternoon');
        // Not a declared seam: the horizon keeps the anchor's hue across the turn.
        expect(morning.seamAfter).toBeUndefined();
        expect(afternoon.seamAfter).toBeUndefined();
        expect(morning.p).toBeLessThanOrEqual(scriptPOf(from));
        expect(afternoon.p).toBeGreaterThanOrEqual(scriptPOf(to));
        // The script has all but arrived at each end of the window (its ease is flat there).
        expect(sampleColourScript(scriptPOf(from)).hour).toBeLessThan(0.01);
        expect(sampleColourScript(scriptPOf(to)).hour).toBeGreaterThan(afternoon.hour - 0.01);
    });

    it('is continuous in progress, and its shade only ever travels forward', () => {
        let prev = dayTurnAt(from - 0.01);
        expect(prev.t).toBe(0);
        for (let a = from - 0.01; a <= to + 0.01; a += 0.00005) {
            const now = dayTurnAt(a);
            expect(now.t).toBeGreaterThanOrEqual(prev.t);
            expect(now.t - prev.t).toBeLessThan(0.002);
            prev = now;
        }
        expect(prev.t).toBe(1);
        expect(dayTurnAt(NaN).on).toBe(false);
        // The shade's place is a continuous, rising function of the turn's share. Over the land
        // (the middle of its travel) at the turn's own pace it moves less than half an edge's
        // width in a sixtieth of a second, so the edge is seen to cross, never to jump; over the
        // open sea either side, where nothing reads it, it is quick.
        let front = dayTurnFront(0);
        const perFrame = (1 / 60) / ODYSSEY_DAY_TURN.seconds;
        const [landFrom, landTo] = [ODYSSEY_DAY_TURN.travel[1][0], ODYSSEY_DAY_TURN.travel.at(-2)[0]];
        for (let t = perFrame; t <= 1 + 1e-9; t += perFrame) {
            const now = dayTurnFront(t);
            expect(now).toBeGreaterThanOrEqual(front);
            if (t - perFrame >= landFrom && t <= landTo) {
                expect(now - front).toBeLessThan(ODYSSEY_DAY_TURN.soft / 2);
            }
            front = now;
        }
        expect(dayTurnFront(-1)).toBe(dayTurnFront(0));
        expect(dayTurnFront(2)).toBe(dayTurnFront(1));
    });

    it('is off every piece of land at both ends: no shade and no half-turned light where it begins or ends', () => {
        const {
            heading, origin, width, soft, travel,
        } = ODYSSEY_DAY_TURN;
        // The furthest the outline can carry an edge.
        const ragged = ODYSSEY_DAY_TURN.ragged[0] + ODYSSEY_DAY_TURN.scallop[0];
        expect(Math.hypot(heading[0], heading[1])).toBeCloseTo(1, 6);
        let lo = Infinity;
        let hi = -Infinity;
        for (let x = -6000; x <= 6000; x += 75) {
            for (let z = -6000; z <= 6000; z += 75) {
                if (odysseyWorldHeight(x, z) > ODYSSEY_SEA_LEVEL) {
                    const along = ((x - origin[0]) * heading[0]) + ((z - origin[1]) * heading[1]);
                    lo = Math.min(lo, along);
                    hi = Math.max(hi, along);
                }
            }
        }
        // At the start the shade's leading edge is behind every piece of land...
        expect(travel[0][1]).toBeLessThan(lo - ragged);
        expect(dayTurnFront(0)).toBe(travel[0][1]);
        // ...and at the end its trailing edge (and the last of the old light) is past all of it.
        expect(travel.at(-1)[1] - width - soft).toBeGreaterThan(hi + ragged);
        expect(dayTurnFront(1)).toBe(travel.at(-1)[1]);
    });

    it('spends most of the window crossing the land the eye looks over', () => {
        const { heading, origin, travel } = ODYSSEY_DAY_TURN;
        // The eye at the seam, and the hero's summit ahead of it, along the heading.
        const eye = rig.poseAt(rig.cp[3]).position.clone();
        const eyeAlong = ((eye.x - origin[0]) * heading[0]) + ((eye.z - origin[1]) * heading[1]);
        const middle = travel.slice(1, -1);
        expect(middle[0][1]).toBeLessThan(eyeAlong - 300);
        expect(middle.at(-1)[1]).toBeGreaterThan(eyeAlong + 2000);
        expect(middle.at(-1)[0] - middle[0][0]).toBeGreaterThanOrEqual(0.75);
        // The origin is a point of the rail inside the window.
        const rail = getOdysseyPathPointAt(rig.cp[3]);
        expect(Math.hypot(rail.x - origin[0], rail.z - origin[1])).toBeLessThan(60);
    });

    it("is a cloud's shadow, not a fade: deep but never dark, its edge a line, its shade cool", () => {
        const {
            depth, silver, soft, width, ragged, scallop, relight, seconds,
        } = ODYSSEY_DAY_TURN;
        // Deeper than the drifting shadows (0.46 of the direct light), and it leaves some sun.
        expect(depth).toBeGreaterThan(0.46);
        expect(depth).toBeLessThan(0.75);
        // The shade's share of the sky's hue stays a share (the ground's own is 0.25, the hour's on top).
        expect(silver).toBeGreaterThan(0);
        expect(0.25 + silver).toBeLessThan(1);
        // An edge narrower than the meadow an orb's close-up shows (a few hundred units), on a
        // shade wide enough to hold the whole massif at once.
        expect(soft).toBeLessThan(160);
        expect(width).toBeGreaterThan(soft * 5);
        // The outline never carries an edge further than the shade is deep.
        expect(ragged[0] + scallop[0]).toBeLessThan(width / 2);
        // The new light arrives inside the shade, never ahead of its trailing edge.
        expect(relight[0]).toBeGreaterThanOrEqual(0);
        expect(relight[1]).toBeGreaterThan(relight[0]);
        expect(relight[1]).toBeLessThanOrEqual(1);
        // A moment, not a blink and not a wait.
        expect(seconds).toBeGreaterThanOrEqual(2);
        expect(seconds).toBeLessThanOrEqual(5);
    });

    it('builds for both backends, and reads nothing unassigned when the turn is off', () => {
        const turn = uniform(new THREE.Vector4(0, ODYSSEY_DAY_TURN.width, 0, 0));
        const material = new THREE.MeshBasicNodeMaterial();
        const field = dayTurnField(vec2(120, -340), turn, {
            billow: (uvN) => uvN.x.fract().mul(float(0.5)).add(0.25),
            scallop: (uvN) => uvN.y.fract(),
        }).toVar();
        material.colorNode = vec3(field.x, field.y, 0);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        BACKENDS.forEach(([label, Builder]) => {
            const out = build(Builder, mesh);
            expect(out.thrown, `${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard, label).toEqual([]);
            expect(out.fragment, label).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
        });
        expect(unassignedReads(build(THREE.WGSLNodeBuilder, mesh).fragment)).toEqual([]);
    });
});

describe("the turn keeps a cloud's pace", () => {
    const [from, to] = ODYSSEY_DAY_TURN.window;
    const lightAt = (actT) => sampleColourScript(scriptPOf(actT));
    const pace = () => createDayTurnPace(lightAt(from), lightAt(to));
    /** The share of the turn the script itself has taken at `actT` (its hour is the measure). */
    const shareAt = (actT) => {
        if (actT <= from) return 0;
        if (actT >= to) return 1;
        return (lightAt(actT).hour - lightAt(from).hour) / (lightAt(to).hour - lightAt(from).hour);
    };
    const SLOTS = ['skyHorizon', 'skyZenith', 'sun', 'groundShadow'];
    const copy = (light) => ({
        ...Object.fromEntries(SLOTS.map((slot) => [slot, light[slot].slice()])),
        hour: light.hour,
        fogDensity: light.fogDensity,
    });

    it('at rest wears the script exactly, everywhere on the rail', () => {
        // Parked (the clock runs, the rail stands still), the light is the script's own sample to
        // the last digit, and nothing travels across the land.
        [0.05, 0.2, from, (from + to) / 2, to, 0.33, 0.39, 0.6, 0.95].forEach((actT) => {
            const p = pace();
            let turn = null;
            let light = null;
            for (let frame = 0; frame < 400; frame += 1) {
                light = lightAt(actT);
                turn = p.step(light, actT, 10 + (frame / 60));
            }
            const want = lightAt(actT);
            SLOTS.forEach((slot) => light[slot].forEach((c, i) => expect(c).toBeCloseTo(want[slot][i], 9)));
            expect(light.hour).toBeCloseTo(want.hour, 9);
            expect(light.fogDensity).toBeCloseTo(want.fogDensity, 12);
            // The turn stands at the script's own share of its two keyframes there.
            expect(turn.t).toBeCloseTo(shareAt(actT), 9);
            expect(turn.on).toBe(actT > from && actT < to);
        });
    });

    it('takes its seconds over a glide that crosses the window in a third of one', () => {
        const p = pace();
        // Parked on the island's last orb...
        const start = from - 0.001;
        p.step(lightAt(start), start, 0);
        p.step(lightAt(start), start, 1 / 60);
        // ...then the eye glides to the mountains' first orb in 0.3 s and parks.
        const arrive = to + 0.001;
        let time = 1 / 60;
        const seen = [];
        let done = null;
        let prev = 0;
        for (let frame = 1; frame <= 600; frame += 1) {
            time += 1 / 60;
            const actT = Math.min(arrive, start + ((arrive - start) * (frame / 18)));
            const light = lightAt(actT);
            const turn = p.step(light, actT, time);
            // Never a step faster than the pace, never backward.
            expect(turn.t - prev).toBeGreaterThanOrEqual(0);
            expect(turn.t - prev).toBeLessThanOrEqual(((1 / 60) / ODYSSEY_DAY_TURN.seconds) + 1e-9);
            prev = turn.t;
            seen.push({ hour: light.hour, sun: light.sun.slice(), on: turn.on });
            if (done === null && turn.t >= 1) done = time;
        }
        // The eye has long arrived (0.3 s) while the shade is still crossing...
        expect(done).toBeGreaterThan(ODYSSEY_DAY_TURN.seconds * 0.9);
        expect(done).toBeLessThan(ODYSSEY_DAY_TURN.seconds * 1.1);
        // ...and the light the world wears never steps: it walks from the morning's to the
        // afternoon's over those seconds, and ends on the script's own.
        for (let i = 1; i < seen.length; i += 1) {
            expect(Math.abs(seen[i].hour - seen[i - 1].hour)).toBeLessThan(0.01);
            seen[i].sun.forEach((c, k) => expect(Math.abs(c - seen[i - 1].sun[k])).toBeLessThan(0.01));
        }
        expect(seen[0].hour).toBeLessThan(0.02);
        const want = lightAt(arrive);
        expect(seen.at(-1).hour).toBeCloseTo(want.hour, 9);
        seen.at(-1).sun.forEach((c, k) => expect(c).toBeCloseTo(want.sun[k], 9));
        expect(seen.at(-1).on).toBe(false);
    });

    it('holds the morning ahead of the shade and the afternoon behind it, wherever the eye has got to', () => {
        // The eye has gone on to a later mountain orb while the shade still crosses: the land
        // behind the shade wears that orb's own light, the land ahead of it the same light less
        // the turn's whole change, and the light now lies between them by the turn's share.
        const p = pace();
        const start = from - 0.001;
        p.step(lightAt(start), start, 0);
        p.step(lightAt(start), start, 1 / 60);
        const far = 0.36;
        const sample = lightAt(far);
        const before = copy(sample);
        const turn = p.step(sample, far, (1 / 60) + 0.4);
        expect(turn.on).toBe(true);
        expect(turn.t).toBeCloseTo(0.4 / ODYSSEY_DAY_TURN.seconds, 6);
        const a = lightAt(from);
        const b = lightAt(to);
        before.sun.forEach((c, i) => {
            const change = b.sun[i] - a.sun[i];
            expect(turn.behind.sun[i]).toBeCloseTo(c, 9);
            expect(turn.ahead.sun[i]).toBeCloseTo(Math.max(c - change, 0), 9);
            expect(sample.sun[i]).toBeCloseTo(Math.max(c - ((1 - turn.t) * change), 0), 9);
        });
        expect(turn.behind.hour).toBeCloseTo(before.hour, 9);
        expect(turn.ahead.hour).toBeCloseTo(before.hour - (b.hour - a.hour), 9);
        // Nothing in the light goes below zero or out of gamut on the way.
        SLOTS.forEach((slot) => sample[slot].forEach((c) => {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1.0001);
        }));
    });

    it('lands at once when the clock stops or jumps (a capture scrub, a warm-up, a paused tab)', () => {
        const p = pace();
        p.step(lightAt(0.1), 0.1, 5);
        // The warm-up scrubs the rail with the clock held: the turn follows the rail exactly.
        [from + 0.01, to + 0.02, from - 0.02, (from + to) / 2].forEach((actT) => {
            const turn = p.step(lightAt(actT), actT, 5);
            expect(turn.t).toBeCloseTo(shareAt(actT), 12);
        });
        // A clock that jumps lands it too.
        p.step(lightAt(from - 0.01), from - 0.01, 6);
        expect(p.step(lightAt(to + 0.01), to + 0.01, 6 + ODYSSEY_DAY_TURN.maxStep + 0.1).t).toBe(1);
    });

    it('goes back the way it came: the afternoon leaves as the shade returns', () => {
        const p = pace();
        const there = to + 0.001;
        p.step(lightAt(there), there, 0);
        p.step(lightAt(there), there, 1 / 60);
        const back = from - 0.001;
        let time = 1 / 60;
        let prev = 1;
        let light = null;
        for (let frame = 0; frame < 300; frame += 1) {
            time += 1 / 60;
            light = lightAt(back);
            const turn = p.step(light, back, time);
            expect(turn.t).toBeLessThanOrEqual(prev);
            prev = turn.t;
        }
        expect(prev).toBe(0);
        expect(light.hour).toBeCloseTo(lightAt(back).hour, 9);
    });
});

describe('the hour', () => {
    it('is zero through the sea and the island, rises across the turn, and never falls on the mountains', () => {
        const hours = getColourScriptHours();
        ODYSSEY_COLOUR_SCRIPT.forEach((k, i) => {
            if (k.medium === 'water' || k.name === 'breach' || k.name === 'island-morning') {
                expect(hours[i], k.name).toBe(0);
            }
        });
        let prev = 0;
        for (let p = 0.27; p <= 0.405; p += 0.005) {
            const { hour } = sampleColourScript(p);
            expect(hour).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = hour;
        }
        expect(prev).toBeGreaterThan(0.5);
        expect(prev).toBeLessThan(0.8);
    });

    it('is inherited by a keyframe that names none, so the day never jumps back to noon', () => {
        const hours = getColourScriptHours();
        ODYSSEY_COLOUR_SCRIPT.forEach((k, i) => {
            if (!Number.isFinite(k.hour)) expect(hours[i], k.name).toBe(i === 0 ? 0 : hours[i - 1]);
            else expect(hours[i], k.name).toBe(k.hour);
        });
    });

    it('keeps each look term a share: nothing the hour scales can overshoot at sunset', () => {
        const L = ODYSSEY_HOUR_LOOK;
        // The land's shade never takes more than the sky's whole hue (noon share 0.25, snow 0.62).
        expect(0.25 + L.shadeChroma).toBeLessThanOrEqual(1);
        expect(0.62 + L.snowShadeChroma).toBeLessThanOrEqual(1);
        // A cloud's lit white never takes more than the sun's whole colour, lit snow never more
        // than the whole alpenglow tint, and the shade keeps most of the sky's fill.
        expect(L.cloudSun).toBeLessThanOrEqual(1);
        expect(L.alpenglow).toBeLessThanOrEqual(1);
        expect(L.shadeDeep).toBeLessThan(0.5);
        // The evening belt is a mix toward its colour: never the whole of it.
        expect(L.antiRose).toBeLessThanOrEqual(1);
        expect(L.mist).toBeGreaterThan(0);
        expect(L.mistVeil).toBeGreaterThan(0);
        [L.alpenglowTint, L.antiRoseTint].forEach((tint) => tint.forEach((c) => {
            expect(c).toBeGreaterThan(0);
            expect(c).toBeLessThanOrEqual(1);
        }));
    });
});

describe("the weather's clock", () => {
    it('keeps every signal inside -1..1 and its weights whole', () => {
        Object.values(ODYSSEY_WEATHER).forEach((terms) => {
            expect(terms.reduce((sum, [, weight]) => sum + weight, 0)).toBeCloseTo(1, 6);
        });
        for (let t = 0; t < 4000; t += 7.3) {
            Object.values(odysseyWeatherAt(t)).forEach((v) => {
                expect(v).toBeGreaterThanOrEqual(-1);
                expect(v).toBeLessThanOrEqual(1);
            });
        }
    });

    it('is slow and continuous: nothing moves faster than a cloud does', () => {
        // A sixtieth of a second apart, no signal moves by more than a thousandth of its range.
        for (let t = 0; t < 900; t += 3.1) {
            const a = odysseyWeatherAt(t);
            const b = odysseyWeatherAt(t + (1 / 60));
            Object.keys(a).forEach((key) => expect(Math.abs(b[key] - a[key])).toBeLessThan(0.002));
        }
    });

    it('is not the same weather on every visit: a few minutes apart the view has changed', () => {
        // Over ten minutes each signal covers most of its range, and no two visits a minute
        // apart read the same on all four.
        const seen = {
            cover: [1, -1], gust: [1, -1], mist: [1, -1], light: [1, -1],
        };
        for (let t = 0; t < 600; t += 2) {
            const w = odysseyWeatherAt(t);
            Object.keys(seen).forEach((key) => {
                seen[key][0] = Math.min(seen[key][0], w[key]);
                seen[key][1] = Math.max(seen[key][1], w[key]);
            });
        }
        Object.values(seen).forEach(([lo, hi]) => expect(hi - lo).toBeGreaterThan(1.2));
        for (let t = 0; t < 1200; t += 60) {
            const a = odysseyWeatherAt(t);
            const b = odysseyWeatherAt(t + 60);
            const moved = Object.keys(a).reduce((sum, key) => sum + Math.abs(b[key] - a[key]), 0);
            expect(moved).toBeGreaterThan(0.25);
        }
    });

    it('never repeats inside an hour (its periods share no short common multiple)', () => {
        const periods = Object.values(ODYSSEY_WEATHER).flat().map(([period]) => period);
        expect(new Set(periods).size).toBe(periods.length);
        periods.forEach((a, i) => periods.slice(i + 1).forEach((b) => {
            // No pair comes back into step within an hour.
            const ratio = Math.max(a, b) / Math.min(a, b);
            expect(Math.abs(ratio - Math.round(ratio))).toBeGreaterThan(0.02);
        }));
    });

    it('drives the world gently, and not at all where there is no weather', () => {
        const R = ODYSSEY_WEATHER_RANGE;
        for (let t = 0; t < 900; t += 11) {
            const d = odysseyWeatherDrive(t, 1);
            expect(Math.abs(d.cover)).toBeLessThanOrEqual(R.cover + 1e-9);
            expect(d.gust).toBeGreaterThanOrEqual(R.gust[0] - 1e-9);
            expect(d.gust).toBeLessThanOrEqual(R.gust[1] + 1e-9);
            expect(d.mist).toBeGreaterThanOrEqual(R.mist[0] - 1e-9);
            expect(d.mist).toBeLessThanOrEqual(R.mist[1] + 1e-9);
            // (The pools in the hollows swing wider than the layer: they thin and gather again.)
            expect(d.pool).toBeGreaterThanOrEqual(R.pool[0] - 1e-9);
            expect(d.pool).toBeLessThanOrEqual(R.pool[1] + 1e-9);
            expect(Math.abs(d.sun - 1)).toBeLessThanOrEqual(R.light + 1e-9);
            expect(d.soft).toBeGreaterThanOrEqual(0);
            expect(d.soft).toBeLessThanOrEqual(R.lightSoft + 1e-9);
            // Under water (amount 0) the drive is neutral.
            expect(odysseyWeatherDrive(t, 0)).toEqual({
                cover: 0, gust: 1, mist: 1, pool: 1, sun: 1, soft: 0,
            });
        }
        expect(odysseyWeatherDrive(NaN, NaN)).toEqual({
            cover: 0, gust: 1, mist: 1, pool: 1, sun: 1, soft: 0,
        });
    });
});

describe('the world wears the hour and the turn', () => {
    // The high tier (the cloud shadows the turning shade rides are its), forest and boulders in:
    // every material the hour and the turn reach. No device: the node builders write both backends.
    const world = createOdysseyWorld({
        quality: 'high', clouds: false, weatherPhase: 0,
    });
    const rig = createOdysseyCameraRig();
    const [from, to] = ODYSSEY_DAY_TURN.window;
    const railAt = (actT) => getOdysseyPathPointAt(rig.cp[1] + (actT * (rig.cp[5] - rig.cp[1])));
    const step = (actT, time) => {
        const rail = railAt(actT);
        world.update(time, rail, actT, rail.y + 20, null);
        return world.state;
    };

    it('publishes the hour and the turn, and paces the turn through the real update', () => {
        // Parked on the island: morning, no turn.
        let state = step(from - 0.002, 100);
        state = step(from - 0.002, 100 + (1 / 60));
        expect(state.hour).toBe(0);
        expect(state.dayTurn).toBe(0);
        // The eye is on the mountains a frame later: the turn has only begun, and the light with it.
        const there = to + 0.002;
        state = step(there, 100 + (2 / 60));
        expect(state.dayTurn).toBeGreaterThan(0);
        expect(state.dayTurn).toBeLessThan(0.02);
        expect(state.hour).toBeLessThan(0.02);
        // ...and takes its seconds.
        let time = 100 + (2 / 60);
        let prev = state.dayTurn;
        for (let frame = 0; frame < 60 * (ODYSSEY_DAY_TURN.seconds + 1); frame += 1) {
            time += 1 / 60;
            state = step(there, time);
            expect(state.dayTurn).toBeGreaterThanOrEqual(prev);
            prev = state.dayTurn;
        }
        expect(state.dayTurn).toBe(1);
        expect(state.hour).toBeCloseTo(sampleColourScript(scriptPOf(there)).hour, 9);
        // The world's scene fog (the rail and the orbs stand in it) is finite and positive throughout.
        expect(Number.isFinite(world.fog.density)).toBe(true);
        expect(world.fog.density).toBeGreaterThan(0);
        ['r', 'g', 'b'].forEach((c) => expect(Number.isFinite(world.fog.color[c])).toBe(true));
    });

    /** The first mesh whose name starts with `name` (the boulders are named by shape and tier). */
    const meshNamed = (name) => {
        let found = null;
        world.group.traverse((o) => { if (!found && o.isMesh && o.name.startsWith(name)) found = o; });
        return found;
    };
    it("lets the turn's wake go once, as the shade's edge passes the rail on a glide", () => {
        const wake = meshNamed('odyssey-world-turn-wake');
        expect(wake).toBeTruthy();
        // Parked on the island for a while: nothing in the air.
        let time = 500;
        step(from - 0.002, time);
        time += 1 / 60;
        step(from - 0.002, time);
        expect(wake.visible).toBe(false);
        // (The test above jumped across the turn and let one go, long ago on this clock.)
        const before = wake.userData.letGo;
        // The glide to the mountains' first orb, 1.5 s of it, then at rest there.
        const there = to + 0.002;
        const lets = [];
        for (let frame = 0; frame < 60 * 8; frame += 1) {
            time += 1 / 60;
            const k = Math.min(frame / 90, 1);
            step((from - 0.002) + ((there - (from - 0.002)) * k * k * (3 - (2 * k))), time);
            if (wake.userData.letGo !== before && !lets.includes(wake.userData.letGo)) {
                lets.push(wake.userData.letGo);
            }
        }
        // One gust, let go while the shade crossed (within the turn's seconds), still in the air.
        expect(lets.length).toBe(1);
        expect(lets[0]).toBeGreaterThan(500);
        expect(lets[0]).toBeLessThan(500 + ODYSSEY_DAY_TURN.seconds + 1.6);
        expect(wake.visible).toBe(true);
        // ...and it is over, and the draw gone, well inside a minute.
        for (let frame = 0; frame < 60 * 40; frame += 1) {
            time += 1 / 60;
            step(there, time);
        }
        expect(wake.visible).toBe(false);
        expect(lets.length).toBe(1);
        // Far up the mountain the turn lets nothing go (a long flight between chapters).
        step(0.6, time + 1);
        step(0.6, time + 1 + (1 / 60));
        expect(wake.visible).toBe(false);
    });

    it('opens a session on its own weather, and repeats where a capture pins the clock', () => {
        // The board hands the world the wall clock; the world's own default is 0 (the playgrounds
        // and these tests), so a pinned `?t=` shot is the same shot every time.
        const root = path.resolve(
            path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
            '../..',
        );
        const board = readFileSync(path.join(root, 'src/rendering/odyssey/OdysseyBoardController.js'), 'utf8');
        const renderer = readFileSync(
            path.join(root, 'src/rendering/odyssey/world/odyssey-world-renderer.js'),
            'utf8',
        );
        expect(board).toMatch(/weatherPhase: \(Date\.now\(\) \/ 1000\) % 7200,/);
        expect(renderer).toMatch(/weatherPhase = 0,/);
        expect(renderer).not.toMatch(/Date\.now\(/);
    });

    const names = [
        'odyssey-world-ground', 'odyssey-world-water', 'odyssey-world-sky',
        'odyssey-world-forest-hero', 'odyssey-world-forest-far', 'odyssey-world-boulders-',
        // Round two: the mist in the hollow and the turn's wake.
        'odyssey-world-hollow-mist', 'odyssey-world-turn-wake',
    ];
    names.forEach((name) => {
        BACKENDS.forEach(([label, Builder]) => {
            it(`${name} builds clean (${label})`, () => {
                const mesh = meshNamed(name);
                expect(mesh, name).toBeTruthy();
                const out = build(Builder, mesh);
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                ['vertex', 'fragment'].forEach((stage) => {
                    expect(typeof out[stage]).toBe('string');
                    expect(out[stage]).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                });
                if (label === 'WGSL') {
                    // The turn is a uniform branch inside each of these colours: the shape the
                    // unassigned-read trap needs.
                    expect(unassignedReads(out.vertex), 'vertex').toEqual([]);
                    expect(unassignedReads(out.fragment), 'fragment').toEqual([]);
                    // WebGPU binds sixteen samplers and sixteen textures a stage, and the ground is the
                    // shader that comes near it.
                    expect((out.fragment.match(/: sampler(_comparison)?\s*;/g) ?? []).length, 'samplers').toBeLessThanOrEqual(16);
                    expect((out.fragment.match(/: texture_\w+/g) ?? []).length, 'textures').toBeLessThanOrEqual(16);
                    if (name === 'odyssey-world-ground') expect((out.fragment.match(/: texture_\w+/g) ?? []).length).toBeGreaterThan(8);
                }
            }, 120_000);
        });
    });
});
