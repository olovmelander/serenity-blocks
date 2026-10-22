/**
 * Moonlit Greenhouse — the house builds with play instead of popping and resetting: every flash,
 * jolt, flood and turn of the air ADDS to what is still lit or moving (a weak event after a
 * strong one never cuts the light, a second T-spin never snaps the swarm home, a hard drop never
 * cuts a falling curtain of dew off), a long chain reads hotter than its first clear, a quad
 * mid-fever only inhales, the late perfect clear crowns the Queen instead of hushing the house a
 * second time, and when the hands rest the house breathes back to calm.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { MoonlitGreenhouseWorld } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';
import { MoonlitGreenhouseDirector } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-director.js';
import { fallbackLayout } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-composition.js';
import { TIMING } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';

const W = 1600;
const H = 900;
const COLORS = ['#ffda9e', '#d7b3ff', '#82f5b8', '#ff9ecf', '#5b7ba7', '#ffd76a', '#a8ffd8'];
const QUAD = [19, 18, 17, 16];

function makeWorld() {
    const scene = new THREE.Scene();
    const world = new MoonlitGreenhouseWorld({ scene, quality: 'Low' }).build();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 400);
    world.bindCamera(camera);
    world.setLayout(fallbackLayout(W, H), W / H);
    world.setViewport(W, H, W / H);
    world.seek(10);
    let t = world.clock;
    const frames = [];
    const step = (seconds, dt = 1 / 30, each = null) => {
        const n = Math.max(1, Math.round(seconds / dt));
        for (let i = 0; i < n; i += 1) {
            t += dt;
            const sim = {
                time: t, delta: dt, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            each?.(world);
        }
    };
    step(0.5);
    return { world, step, frames };
}

/** The tray's Fever: twelve hard-dropped clears 0.64 s apart, a T-spin, a cascade, a quad and its crown. */
function fever(world, step, each = null) {
    const plan = [1, 1, 2, 1, 2, 2, 3, 'tspin', 2, 'cascade', 3, 'quad'];
    plan.forEach((move, n) => {
        if (n > 0) step(0.64, 1 / 30, each);
        const combo = n + 1;
        world.onLock({
            rows: [18], u: (n * 0.29) % 1, color: COLORS[n % 7], hardDrop: true,
        });
        if (move === 'quad') {
            world.onClear({ rows: QUAD, lines: 4, combo });
            world.onCombo(combo);
            step(0.36, 1 / 30, each);
            world.onClear({
                rows: [], lines: 0, combo, perfect: true, crown: true,
            });
            return;
        }
        if (move === 'cascade') {
            world.onClear({
                rows: [19, 18], lines: 2, combo, cascade: 1,
            });
            world.onCombo(combo);
            for (let w = 2; w <= 4; w += 1) {
                step(0.36, 1 / 30, each);
                world.onClear({
                    rows: [19], lines: w % 3 === 0 ? 2 : 1, combo, cascade: w,
                });
            }
            return;
        }
        const lines = move === 'tspin' ? 2 : move;
        world.onClear({
            rows: QUAD.slice(0, lines), lines, combo, tspin: move === 'tspin',
        });
        world.onCombo(combo);
    });
}

/** The angle between two turns of the air, the short way round. */
const turnDelta = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('moonlit greenhouse: the house builds with play', () => {
    it('never cuts the light: a single after a quad adds to it, a second quad floods on from where it is', () => {
        const run = (single) => {
            const { world, step } = makeWorld();
            world.onClear({ rows: QUAD, lines: 4 });
            step(TIMING.hush + 0.6);
            if (single) world.onClear({ rows: [19], lines: 1 });
            step(1 / 30);
            return { flash: world.getPostState().flash, flood: world.U.flood.value };
        };
        const quiet = run(false);
        const added = run(true);
        expect(added.flash).toBeGreaterThan(quiet.flash);
        expect(added.flood).toBeGreaterThanOrEqual(quiet.flood);

        // A second quad mid-flood: the flood never dips to start again.
        const { world, step } = makeWorld();
        world.onClear({ rows: QUAD, lines: 4 });
        step(TIMING.hush + 0.4);
        const before = world.U.flood.value;
        expect(before).toBeGreaterThan(0.8);
        world.onClear({ rows: QUAD, lines: 4 });
        let least = Infinity;
        step(0.4, 1 / 30, (w) => {
            least = Math.min(least, w.U.flood.value);
        });
        expect(least).toBeGreaterThan(before - 0.02);
    });

    it('turns the air on with a second T-spin instead of snapping the swarm home', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        step(1.6);
        let last = world.U.turn.value.clone();
        expect(last.y).toBeGreaterThan(0.5);
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        let angleJump = 0;
        let heldDrop = 0;
        step(TIMING.turn * 2, 1 / 30, (w) => {
            const now = w.U.turn.value;
            angleJump = Math.max(angleJump, turnDelta(now.x, last.x));
            heldDrop = Math.max(heldDrop, last.y - now.y);
            last = now.clone();
        });
        expect(angleJump).toBeLessThan(0.12);
        expect(heldDrop).toBeLessThan(0.05);
        expect(world.U.turn.value.y).toBe(0);
        // A T-spin that cleared nothing still turns the air a little.
        world.onClear({
            rows: [], lines: 0, tspin: true, combo: 1,
        });
        step(TIMING.turn * 0.5);
        expect(world.U.turn.value.y).toBeGreaterThan(0.2);
        expect(world.U.turn.value.y).toBeLessThan(0.6);
        expect(world.getState().clears).toBe(2);
    });

    it('never cuts a falling curtain of dew off: rapid hard drops keep a brighter rain coming', () => {
        const { world, step } = makeWorld();
        const births = [];
        const seen = { gain: 0, drop: 0 };
        const watch = (w) => {
            const dew = w.U.dew.value;
            if (births[births.length - 1] !== dew.x) {
                births.push(dew.x);
                seen.gain = dew.y;
                return;
            }
            seen.drop = Math.max(seen.drop, seen.gain - dew.y);
            seen.gain = dew.y;
        };
        for (let i = 0; i < 20; i += 1) {
            world.onLock({
                rows: [18], u: (i * 0.37) % 1, color: COLORS[i % 7], hardDrop: true,
            });
            step(0.3, 1 / 30, watch);
        }
        // A new curtain only once the last has come down, and they keep coming.
        expect(births.length).toBeGreaterThan(2);
        for (let i = 1; i < births.length; i += 1) expect(births[i] - births[i - 1]).toBeGreaterThan(2.2);
        // A falling curtain only ever brightens.
        expect(seen.drop).toBe(0);
        expect(seen.gain).toBeGreaterThan(1);
    });

    it('reads a long chain hotter than its first clear, inhales on the quad and crowns it, then breathes back', () => {
        const { world, step } = makeWorld();
        const rest = {
            lanterns: world.U.lanternGain.value,
            shafts: world.getPostState().shafts,
            exposure: world.getPostState().exposure,
        };
        let first = null;
        const quadAt = 11 * 0.64;
        let elapsed = 0;
        let late = null;
        fever(world, step, (w) => {
            elapsed += 1 / 30;
            if (!first && elapsed > 0.3) {
                first = {
                    lanterns: w.U.lanternGain.value,
                    moss: w.U.mossGlow.value,
                    shafts: w.getPostState().shafts,
                    swarm: w.U.swarmGain.value,
                };
            }
            if (!late && elapsed > quadAt - 0.05) {
                late = {
                    lanterns: w.U.lanternGain.value,
                    moss: w.U.mossGlow.value,
                    shafts: w.getPostState().shafts,
                    swarm: w.U.swarmGain.value,
                    open: w.getState().open,
                    ...w.getState().surge,
                };
            }
        });
        // The house has woken: the lanterns burn up, the swarm burns brighter, the moss glows, the
        // beams stand out, the beds have filled with blooms, the fever is lit.
        expect(late.lanterns).toBeGreaterThan(first.lanterns * 1.25);
        expect(late.swarm).toBeGreaterThan(first.swarm * 1.3);
        expect(late.moss).toBeGreaterThan(first.moss);
        expect(late.shafts).toBeGreaterThan(first.shafts + 0.1);
        expect(late.open).toBeGreaterThanOrEqual(6);
        expect(late.fever).toBeGreaterThan(0.5);
        expect(late.stage).toBe(3);
        // The quad mid-fever only inhales (from rest it goes dark: see the world's tests), and its
        // late perfect clear crowns her: one Queen, her second whorl, no second hush.
        expect(world.state.hushDepth).toBeLessThan(0.45);
        const { hushAt } = world.state;
        let deepest = 0;
        step(TIMING.hush + TIMING.queenOpen + 0.2, 1 / 30, (w) => {
            deepest = Math.max(deepest, w.U.hush.value);
        });
        expect(world.state.hushAt).toBe(hushAt);
        expect(deepest).toBeLessThan(0.45);
        expect(world.getState().queens).toBe(1);
        expect(world.U.queen.value.w).toBeGreaterThan(0.9);
        // The hands rest (the next piece ends the chain): the house breathes back to the quiet night.
        world.onCombo(0);
        step(16);
        const calm = world.getState().surge;
        expect(calm.level).toBeLessThan(0.05);
        expect(calm.fever).toBe(0);
        expect(world.U.lanternGain.value).toBeCloseTo(rest.lanterns, 1);
        expect(world.getPostState().shafts).toBeCloseTo(rest.shafts, 2);
        expect(world.getPostState().exposure).toBeCloseTo(rest.exposure, 2);
    });

    it('answers a back-to-back with the moon, higher for the second, and builds a cascade wave by wave', () => {
        const { world, step } = makeWorld();
        const shafts0 = world.getPostState().shafts;
        world.onClear({
            rows: QUAD, lines: 4, b2b: true, combo: 1,
        });
        step(0.3);
        const once = world.getPostState().shafts;
        expect(once).toBeGreaterThan(shafts0 + 0.3);
        world.onClear({
            rows: QUAD, lines: 4, b2b: true, combo: 1,
        });
        step(0.3);
        expect(world.getPostState().shafts).toBeGreaterThan(once);

        // Each wave of a cascade sends brighter, faster fronts than the last.
        const fronts = (depth) => {
            const fresh = makeWorld().world;
            fresh.onClear({
                rows: [19], lines: 1, combo: 1, cascade: depth,
            });
            const v = fresh.waves[fresh.waves.length - 1];
            return { strength: v.strength, speed: v.speed };
        };
        const one = fronts(1);
        const four = fronts(4);
        expect(four.strength).toBeGreaterThan(one.strength * 1.5);
        expect(four.speed).toBeGreaterThan(one.speed);
    });
});

describe('moonlit greenhouse director: clears with no lines of their own', () => {
    const makeDirector = () => {
        const clears = [];
        const director = new MoonlitGreenhouseDirector({
            sink: { clear: (c) => clears.push({ ...c, rows: [...c.rows] }) },
        });
        return { director, clears };
    };

    it('crowns the clear still playing when the perfect clear settles in a frame of its own', () => {
        const { director, clears } = makeDirector();
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        director.flush();
        director.onPerfectClear({ depth: 4 });
        director.flush();
        expect(clears).toHaveLength(2);
        expect(clears[0]).toMatchObject({ lines: 4, perfect: false, crown: false });
        expect(clears[1]).toMatchObject({ lines: 0, perfect: true, crown: true });
    });

    it('answers a T-spin that cleared nothing and a back-to-back in a frame of its own', () => {
        const { director, clears } = makeDirector();
        director.onTSpin({ lineCount: 0 });
        director.flush();
        director.onB2B({ active: true });
        director.flush();
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(clears).toHaveLength(3);
        expect(clears[0]).toMatchObject({
            lines: 0, tspin: true, b2b: false, crown: false,
        });
        expect(clears[1]).toMatchObject({
            lines: 0, tspin: false, b2b: true, crown: false,
        });
        // The back-to-back never rides on the next clear.
        expect(clears[2]).toMatchObject({ lines: 1, b2b: false });
    });
});
