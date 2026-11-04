/**
 * First Light: the flock's path. Behind the menu it must fly round the interface, fitted to the
 * layout the player really has, so these tests stand on the rects the game measures. Rects are
 * screen fractions, y down, as IntroAnimation.syncMenuLayout hands them on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FLOCK_POINTS,
    MODE_HUES,
    MURMURATION,
    TAU,
    buildMurmurationSeeds,
    circuitPoint,
    flockTaper,
    halfHeightAt,
    murmurationAt,
    murmurationLine,
    stageCircuit,
    writeFlockLine,
} from '../../src/ui/intro-world/intro-world-core.js';
import { IntroWorld } from '../../src/ui/intro-world/intro-world.js';

const frac = ([x0, y0, x1, y1], w, h) => ({
    x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h,
});

/** The real menu at 1707 x 1067 (the navigation with the 14 px the intro pads it by). */
const desktop = (() => {
    const [w, h] = [1707, 1067];
    return {
        aspect: w / h,
        stage: frac([705, 197, 1485, 875], w, h),
        nav: frac([71, 294, 479, 854], w, h),
        dock: frac([85, 979, 1622, 1037], w, h),
    };
})();

/** A window wider than the menu's frame: the free space round the card is huge. */
const ultrawide = (() => {
    const [w, h] = [2560, 1080];
    return {
        aspect: w / h,
        stage: frac([1136, 203, 1916, 881], w, h),
        nav: frac([394, 301, 802, 861], w, h),
        dock: frac([408, 992, 2152, 1050], w, h),
    };
})();

/** The stacked layout has no card: the intro hands the whole column on as the panel. */
const stacked = (() => {
    const [w, h] = [820, 1180];
    return { aspect: w / h, stage: frac([116, 40, 704, 840], w, h) };
})();

const insideRect = (p, r, pad = 0) => p.x > r.x0 - pad && p.x < r.x1 + pad && p.y > r.y0 - pad && p.y < r.y1 + pad;

describe('the flock\'s motes', () => {
    const seeds = buildMurmurationSeeds(40000);
    const share = (test) => {
        let n = 0;
        for (let i = 0; i < 40000; i++) if (test(seeds[i * 4], seeds[i * 4 + 2])) n++;
        return n / 40000;
    };

    it('thin out toward its tips instead of crowding into a blob there', () => {
        const tip = share((s) => s < 0.04 || s > 0.96);
        const body = share((s) => s > 0.46 && s < 0.54);
        expect(tip / 2).toBeLessThan(body * 0.5);
        expect(flockTaper(0)).toBe(0);
        expect(flockTaper(0.5)).toBeCloseTo(1, 9);
    });

    it('have a soft edge: a few stragglers past the body, none far from it', () => {
        expect(share((_s, rho) => rho > 1)).toBeGreaterThan(0);
        expect(share((_s, rho) => rho > 1)).toBeLessThan(0.1);
        expect(share((_s, rho) => rho > 1.5)).toBe(0);
    });
});

describe('the circuit round the stage card', () => {
    it('flies down the middle of the gutters, whatever the layout', () => {
        const c = stageCircuit(desktop, desktop.aspect);
        const { aspect } = desktop;
        // Left of the card, midway between it and the navigation.
        expect(c.cx - c.hx).toBeCloseTo(((desktop.nav.x1 + desktop.stage.x0) / 2) * aspect, 6);
        // Under the card, midway between it and the dock.
        expect(c.cy + c.hy).toBeCloseTo((desktop.stage.y1 + desktop.dock.y0) / 2, 6);
        // Over the card and to its right, midway to the frame.
        expect(c.cy - c.hy).toBeCloseTo(desktop.stage.y0 / 2, 6);
        expect(c.cx + c.hx).toBeCloseTo(((desktop.stage.x1 + 1) / 2) * aspect, 6);
    });

    it('never crosses the card, the navigation or the dock, all the way round', () => {
        for (const layout of [desktop, ultrawide]) {
            const c = stageCircuit(layout, layout.aspect);
            for (let phi = 0; phi < TAU; phi += 0.01) {
                const p = circuitPoint(c, phi);
                expect(insideRect(p, layout.stage), `card at ${phi.toFixed(2)}`).toBe(false);
                expect(insideRect(p, layout.nav), `navigation at ${phi.toFixed(2)}`).toBe(false);
                expect(insideRect(p, layout.dock), `dock at ${phi.toFixed(2)}`).toBe(false);
            }
        }
    });

    it('stays close to the card on a very wide screen', () => {
        const c = stageCircuit(ultrawide, ultrawide.aspect);
        const right = ultrawide.stage.x1 * ultrawide.aspect;
        expect(c.cx + c.hx - right).toBeLessThan(0.2);
        expect(c.clear.right).toBeLessThan(0.2);
    });

    it('circles the column of the stacked layout, and has nothing to circle with no panel', () => {
        const c = stageCircuit(stacked, stacked.aspect);
        expect(c.hx).toBeGreaterThan((stacked.stage.x1 - stacked.stage.x0) * 0.5 * stacked.aspect);
        expect(stageCircuit({ stage: null }, 16 / 9)).toBeNull();
        expect(stageCircuit({
            stage: {
                x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5,
            },
        }, 16 / 9)).toBeNull();
    });

    it('is one unbroken loop, flown the way the free flock flies', () => {
        const c = stageCircuit(desktop, desktop.aspect);
        const at = (phi) => circuitPoint(c, phi);
        // The same angle lands on the same side as the free loop.
        expect(at(0).x).toBeGreaterThan(desktop.stage.x1);
        expect(at(TAU / 4).y).toBeLessThan(desktop.stage.y0);
        expect(at(TAU / 2).x).toBeLessThan(desktop.stage.x0);
        expect(at((3 * TAU) / 4).y).toBeGreaterThan(desktop.stage.y1);
        // No jump anywhere (a corner is not a seam), and it closes on itself.
        let last = at(0);
        for (let phi = 0.002; phi <= TAU + 0.002; phi += 0.002) {
            const p = at(phi);
            const step = Math.hypot((p.x - last.x) * desktop.aspect, p.y - last.y);
            expect(step, `phi ${phi.toFixed(3)}`).toBeLessThan(0.008);
            last = p;
        }
    });
});

describe('the flock\'s line', () => {
    const toWorld = (x, y, z) => [x, y, z];
    const m = murmurationAt({
        time: 12, breath: 0.4, aspect: desktop.aspect, menu: 1,
    });

    it('is the free loop when it has no card to fly round', () => {
        const line = writeFlockLine(m, new Float32Array(FLOCK_POINTS * 4));
        const s = 5 / (FLOCK_POINTS - 3);
        const [x, y, z] = murmurationLine(m, s);
        expect(line[6 * 4]).toBeCloseTo(x, 4);
        expect(line[6 * 4 + 1]).toBeCloseTo(y, 4);
        expect(line[6 * 4 + 2]).toBeCloseTo(z, 4);
        expect(line[6 * 4 + 3]).toBe(1);
    });

    it('rises out of the light as the world opens, head first', () => {
        const low = writeFlockLine(m, new Float32Array(FLOCK_POINTS * 4), { risen: 0.4 });
        const high = writeFlockLine(m, new Float32Array(FLOCK_POINTS * 4), { risen: 1 });
        const dropAt = (i) => high[i * 4 + 1] - low[i * 4 + 1];
        expect(dropAt(1)).toBeGreaterThan(0);
        expect(dropAt(FLOCK_POINTS - 2)).toBeGreaterThan(dropAt(1));
    });

    it('pours onto the circuit head first', () => {
        const circuit = stageCircuit(desktop, desktop.aspect);
        const onIt = (share) => writeFlockLine(m, new Float32Array(FLOCK_POINTS * 4), {
            circuit, onCircuit: share, toWorld,
        });
        const free = onIt(0);
        const half = onIt(0.5);
        const full = onIt(1);
        const travelled = (i) => Math.abs(half[i * 4] - free[i * 4]) / Math.max(1e-6, Math.abs(full[i * 4] - free[i * 4]));
        expect(travelled(1)).toBeGreaterThan(travelled(FLOCK_POINTS - 2));
    });

    it('fits its width to the gutter it is flying through', () => {
        const circuit = stageCircuit(desktop, desktop.aspect);
        const hh = halfHeightAt(MURMURATION.z);
        const line = writeFlockLine(m, new Float32Array(FLOCK_POINTS * 4), {
            circuit, onCircuit: 1, toWorld, worldPerFrame: hh * 2,
        });
        for (let i = 1; i < FLOCK_POINTS - 1; i++) {
            const halfWidth = (line[i * 4 + 3] * m.width) / (hh * 2);
            expect(halfWidth).toBeLessThan(Math.max(circuit.clear.left, circuit.clear.right, circuit.clear.top));
        }
        // The foot of the card is the narrowest gutter, and the flock narrows to pass it.
        const sides = [circuit.clear.left, circuit.clear.right, circuit.clear.top];
        expect(circuit.clear.bottom).toBeLessThan(Math.min(...sides));
    });

    it('closes into an unbroken frame: on the breath that gathers it, its head meets its tail', () => {
        const circuit = stageCircuit(desktop, desktop.aspect);
        const closed = murmurationAt({
            time: 25, breath: 0.5, aspect: desktop.aspect, menu: 1, close: 1,
        });
        const line = writeFlockLine(closed, new Float32Array(FLOCK_POINTS * 4), {
            circuit, onCircuit: 1, toWorld,
        });
        // s = 0 and s = 1 are the second row and the last but one.
        const head = 1 * 4;
        const tail = (FLOCK_POINTS - 2) * 4;
        expect(line[head]).toBeCloseTo(line[tail], 4);
        expect(line[head + 1]).toBeCloseTo(line[tail + 1], 4);
        // Apart, it covers only part of the way round.
        const open = writeFlockLine(m, new Float32Array(FLOCK_POINTS * 4), { circuit, onCircuit: 1, toWorld });
        expect(Math.hypot(open[head] - open[tail], open[head + 1] - open[tail + 1])).toBeGreaterThan(0.1);
    });
});

describe('the light the modes lend it', () => {
    it('has a hue for every mode the page lights', () => {
        const css = readFileSync(resolve('public/styles/keystone-menu.css'), 'utf8');
        const modes = [...css.matchAll(/data-light='([a-z-]+)'/g)].map((match) => match[1]);
        expect(modes.length).toBeGreaterThanOrEqual(8);
        for (const mode of modes) expect(MODE_HUES[mode], mode).toMatch(/^#[0-9a-f]{6}$/);
    });
});

describe('the world behind the menu', () => {
    const menu = (mode = 'single') => {
        const row = {
            x0: 85 / 1707, y0: 354 / 1067, x1: 465 / 1707, y1: 400 / 1067,
        };
        return {
            ...desktop, brand: null, row, mode, calm: [],
        };
    };
    const flying = (layout) => {
        const world = new IntroWorld({ quality: 'Low' }).build(new THREE.Scene());
        world.bindCamera(new THREE.PerspectiveCamera(38, 1707 / 1067));
        world.setViewport(1707, 1067);
        world.finishOpening();
        world.setMode('menu', { immediate: true });
        if (layout) world.setMenuLayout(layout);
        return world;
    };
    const run = (world, seconds) => {
        for (let i = 0; i < seconds * 30; i++) world.update(1 / 30);
    };

    it('moves onto the card\'s circuit, and off it while the menu is covered', () => {
        const world = flying(menu());
        run(world, 4);
        expect(world.getState().onStage).toBeGreaterThan(0.95);
        expect(world.getState().thread).toBeGreaterThan(0.95);
        world.setMenuLayout(null);
        run(world, 5);
        expect(world.getState().onStage).toBeLessThan(0.02);
        expect(world.getState().thread).toBeLessThan(0.02);
        world.dispose();
    });

    it('drops the panels a layout no longer has, as the window crosses into the stacked one', () => {
        const world = flying(menu());
        run(world, 1);
        expect(world.flown.nav).not.toBeNull();
        world.setMenuLayout({
            stage: stacked.stage, nav: null, brand: null, dock: null, row: null, mode: 'single', calm: [],
        });
        run(world, 0.1);
        expect(world.flown.nav).toBeNull();
        expect(world.flown.dock).toBeNull();
        expect(world.panels(1)).toHaveLength(1);
        world.dispose();
    });

    it('has no thread where no gutter parts the row from the card', () => {
        const world = flying();
        world.setViewport(820, 1180);
        const row = {
            x0: 0.14, y0: 0.13, x1: 0.86, y1: 0.18,
        };
        expect(world.threadFits({ row, stage: stacked.stage })).toBe(false);
        world.setViewport(1707, 1067);
        expect(world.threadFits(menu())).toBe(true);
        world.dispose();
    });

    it('takes the mode\'s light head first, and it runs down to the tail', () => {
        const world = flying(menu('odyssey'));
        run(world, 4);
        world.setMenuLayout(menu('local-multiplayer'));
        run(world, 0.25);
        const moved = (i) => Math.abs(world.hues[i * 4 + 1] - world.modeHue[1]);
        expect(moved(1)).toBeLessThan(moved(FLOCK_POINTS - 2));
        run(world, 6);
        expect(moved(FLOCK_POINTS - 2)).toBeLessThan(0.01);
        world.dispose();
    });

    it('closes round the card on the gathering\'s breath, and never under reduced motion', () => {
        const world = flying(menu());
        world.seek(25, { opening: 60, menu: 1 });
        expect(world.closingNow().join).toBeCloseTo(1, 6);
        expect(world.closed).toBeCloseTo(1, 6);
        world.setReducedMotion(true, true);
        world.seek(25, { opening: 60, menu: 1 });
        expect(world.closingNow()).toBeNull();
        world.dispose();
    });

    it('lands a seek where playing would: the same moment, the same line', () => {
        const world = flying(menu());
        world.seek(41.5, { opening: 60, menu: 1 });
        const first = world.line.slice();
        world.seek(7, { opening: 60, menu: 1 });
        world.seek(41.5, { opening: 60, menu: 1 });
        expect(world.line).toEqual(first);
        world.dispose();
    });

    it('keeps the ring locked on the wordmark while the camera drifts', () => {
        const world = flying();
        world.setMode('title', { immediate: true });
        const rect = {
            x: 594, y: 434, width: 520, height: 198,
        };
        world.setTitleRect(rect);
        const v = new THREE.Vector3();
        for (const t of [3, 17, 41]) {
            world.seek(t, { opening: 60, menu: 0 });
            const m = murmurationAt({ time: t, aspect: world.viewport.aspect });
            world.fitRing(m);
            v.set(m.ring[0], m.ring[1], MURMURATION.z).project(world.camera);
            expect(((v.x + 1) / 2) * 1707).toBeCloseTo(rect.x + rect.width / 2, 0);
            expect(((1 - v.y) / 2) * 1067).toBeCloseTo(rect.y + rect.height * 0.56, 0);
        }
        world.dispose();
    });
});
