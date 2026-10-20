/**
 * Cosmic Noir — the world, on the CPU: a real CosmicNoirWorld in a THREE.Scene, no renderer (the
 * smoke's target is simply not painted).
 *
 * These pin behaviour and contracts — what a lock, a clear, a chain, four lines and a new level
 * DO, and that every clock is integrated (a rate change never jumps a phase) — never a tuning
 * number: constants are imported, and the assertions are relations.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    COSMIC_NOIR_PARTS, CosmicNoirWorld, REST_RIG, SPIN_REST, fovForAspect,
} from '../../src/themes/cosmic-noir/cosmic-noir-world.js';
import {
    CAGE, ECHO_LIFE, ECHO_SLOTS, PUFF_LIFE, PUFF_SLOTS, STOCK_STEP, TAU, stockPlace,
} from '../../src/themes/cosmic-noir/cosmic-noir-core.js';
import { fallbackLayout } from '../../src/themes/cosmic-noir/cosmic-noir-composition.js';

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, at = 10, reduce = false,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new CosmicNoirWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

/** The capture's recipe: jump the clock, then draw that moment with the simulation frozen. */
function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/** One frame as the theme runs it: the camera (which stamps the clock), the gameplay, the world. */
function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

/** The shortest signed difference between two phases. */
const turn = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
};

describe('cosmic noir world: built and torn down', () => {
    it('builds its one backdrop into one root, and leaves the scene empty when disposed', () => {
        const { scene, world } = makeWorld();
        expect(scene.children).toContain(world.root);
        expect(world.parts.sky.mesh.parent).toBe(world.root);
        expect(COSMIC_NOIR_PARTS).toEqual(['sky', 'smoke']);
        world.dispose();
        expect(scene.children).not.toContain(world.root);
        world.dispose(); // twice is harmless
    });

    it('lands on the same moment however it got there: a seek is a pure function of the clock', () => {
        const a = makeWorld('Minimal', { at: 137 });
        const b = makeWorld('Minimal', { at: 5 });
        settle(b.world, b.camera, 137);
        const sa = a.world.getState();
        const sb = b.world.getState();
        ['spinPhase', 'cageFill', 'stockPlace', 'stock'].forEach((k) => expect(sb[k], k).toBe(sa[k]));
        expect(b.world.drift).toEqual(a.world.drift);
        expect(b.world.cageTurn).toBe(a.world.cageTurn);
    });

    it('turns the lighthouse at its rest period with no chain', () => {
        const { world, camera } = makeWorld();
        const before = world.spinPhase;
        run(world, camera, 1);
        expect(turn(before, world.spinPhase)).toBeCloseTo(SPIN_REST, 2);
        expect(world.getState().spinPeriod).toBeCloseTo(TAU / SPIN_REST, 3);
    });
});

describe('cosmic noir world: every clock is integrated', () => {
    for (const age of [10, 600]) {
        it(`never jumps the beams' phase when a chain spins the lighthouse up and lets it go (session ${age} s old)`, () => {
            const { world, camera } = makeWorld('Minimal', { at: age });
            const dt = 1 / 120;
            let prev = world.spinPhase;
            let fastest = 0;
            for (let i = 0; i < 1200; i++) {
                // A frantic chain: the combo climbs every few frames, then breaks.
                const combo = i < 900 ? 1 + Math.floor(i / 40) : 0;
                frame(world, camera, dt, () => world.onCombo(combo));
                const step = turn(prev, world.spinPhase);
                expect(step, `frame ${i}`).toBeGreaterThan(0);
                fastest = Math.max(fastest, step / dt);
                prev = world.spinPhase;
            }
            // It did spin up (well past rest) and never faster than the rate it was driven at.
            expect(fastest).toBeGreaterThan(SPIN_REST * 1.5);
            expect(fastest).toBeLessThan(SPIN_REST * 6);
        });
    }

    it('opens the blinds with a chain and closes them when it breaks, without a snap', () => {
        const { world, camera } = makeWorld();
        expect(world.cageFill).toBeCloseTo(CAGE.fillClosed, 6);
        let prev = world.cageFill;
        for (let i = 0; i < 300; i++) {
            frame(world, camera, 1 / 60, () => world.onCombo(9));
            expect(Math.abs(world.cageFill - prev)).toBeLessThan(0.02);
            prev = world.cageFill;
        }
        expect(world.cageFill).toBeLessThan(CAGE.fillClosed);
        expect(world.cageFill).toBeGreaterThanOrEqual(CAGE.fillOpen - 1e-6);
        for (let i = 0; i < 600; i++) frame(world, camera, 1 / 60, () => world.onCombo(0));
        expect(world.cageFill).toBeCloseTo(CAGE.fillClosed, 2);
    });
});

describe('cosmic noir world: the print drifts with the clock and turns with the level', () => {
    it('drifts by the clock alone at level 1 (real frames, no level-up)', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        const start = world.getState().stockPlace;
        run(world, camera, 60, 600);
        const after = world.getState();
        expect(after.level).toBe(1);
        expect(after.stockPlace - start).toBeCloseTo(60 / STOCK_STEP, 3);
        // Applied to what the post reads, too.
        const tone = world.getPostState().stock;
        settle(world, camera, 0);
        const toneAt0 = JSON.stringify(world.getPostState().stock);
        settle(world, camera, 60);
        expect(JSON.stringify(world.getPostState().stock)).not.toBe(toneAt0);
        expect(tone).toBe(world.getPostState().stock); // one reused object
    });

    it('steps one stock along on a level-up, eased, then rests on the steps plus the clock', () => {
        const { world, camera } = makeWorld('Minimal', { at: 30 });
        world.levelUp(2);
        expect(world.levelSteps).toBe(1);
        frame(world, camera, 1 / 60);
        // Eased: not there at once.
        expect(world.getState().stockPlace).toBeLessThan(stockPlace(1, world.time) - 0.01);
        run(world, camera, 8);
        expect(world.getState().stockPlace).toBeCloseTo(stockPlace(1, world.time), 3);
    });

    it('counts a level jump as at most three steps, and a new game never turns the print back', () => {
        const { world } = makeWorld();
        world.levelUp(9);
        expect(world.levelSteps).toBe(3);
        world.resetSession();
        expect(world.level).toBe(1);
        expect(world.levelSteps).toBe(3);
        world.levelUp(2); // the new game's first level-up: one step on
        expect(world.levelSteps).toBe(4);
        world.levelUp(1); // a still newer game (a lower level): never backwards
        expect(world.levelSteps).toBe(4);
    });

    it('hands a rebuilt world where it stood: the level and the steps', () => {
        const a = makeWorld();
        a.world.levelUp(5);
        a.world.resetSession();
        a.world.levelUp(3);
        const carry = a.world.getCarry();
        const b = makeWorld();
        b.world.takeCarry(carry);
        settle(b.world, b.camera, 10);
        expect(b.world.getState().level).toBe(a.world.level);
        expect(b.world.getState().levelSteps).toBe(a.world.levelSteps);
        expect(b.world.getState().stockPlace).toBeCloseTo(stockPlace(a.world.levelSteps, 10), 9);
        b.world.takeCarry(null); // nothing to take: unchanged
        expect(b.world.levelSteps).toBe(a.world.levelSteps);
    });

    it('a silent level-up turns the print at once, with no reel change', () => {
        const { world, camera } = makeWorld();
        world.levelUp(3, { silent: true });
        frame(world, camera, 1 / 60);
        expect(world.getState().stockPlace).toBeCloseTo(stockPlace(2, world.time), 9);
        run(world, camera, 2);
        expect(world.counts.levels).toBe(0);
    });
});

describe('cosmic noir world: gameplay', () => {
    it('puffs smoke from the card\'s nearer edge on a lock, which dies in PUFF_LIFE', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => world.onLock({ u: 0.1, rows: [9, 10] }));
        expect(world.getState().puffs).toBe(1);
        const left = world.puffSlots.find((s) => s.smoke > 0);
        frame(world, camera, 1 / 60, () => world.onLock({ u: 0.9, rows: [9, 10], hardDrop: true }));
        const right = world.puffSlots.find((s) => s.smoke > 0 && s !== left);
        // The left half of the board puffs out of the card's left edge, the right half its right.
        expect(left.vel[0]).toBeLessThan(0);
        expect(right.vel[0]).toBeGreaterThan(0);
        expect(right.ember).toBeGreaterThan(left.ember); // a hard drop puffs harder
        run(world, camera, PUFF_LIFE + 0.1);
        expect(world.getState().puffs).toBe(0);
        // More locks than slots reuse the oldest.
        for (let i = 0; i < PUFF_SLOTS + 2; i++) frame(world, camera, 1 / 60, () => world.onLock({ u: 0.4 }));
        expect(world.getState().puffs).toBe(PUFF_SLOTS);
    });

    it('sends a light echo per line, one after another, and lets them die', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 3, rows: [17, 18, 19] }));
        expect(world.getState().echoes).toBe(1);
        run(world, camera, 0.5);
        expect(world.getState().echoes).toBe(3);
        expect(world.getState().negative).toBe(0);
        run(world, camera, ECHO_LIFE + 0.5);
        expect(world.getState().echoes).toBe(0);
    });

    it('fires the flashbulb on four lines (the print turns negative), a flash instead under reduced motion', () => {
        const live = makeWorld();
        frame(live.world, live.camera, 1 / 60, () => live.world.onClear({ lines: 4, rows: [16, 17, 18, 19] }));
        expect(live.world.getState().negative).toBeGreaterThan(0.9);
        run(live.world, live.camera, 0.5);
        expect(live.world.getState().echoes).toBe(Math.min(4, ECHO_SLOTS));
        run(live.world, live.camera, 1);
        expect(live.world.getState().negative).toBeLessThan(0.01);

        const calm = makeWorld('Minimal', { reduce: true });
        frame(calm.world, calm.camera, 1 / 60, () => calm.world.onClear({ lines: 4, rows: [16, 17, 18, 19] }));
        expect(calm.world.getState().negative).toBe(0);
        expect(calm.world.getPostState().flash).toBeGreaterThan(0.3);
    });

    it('spins the cage on a T-spin, and lets it settle back to its own slow turn', () => {
        const { world, camera } = makeWorld();
        const rest = () => {
            const a = world.cageTurn;
            frame(world, camera, 1 / 60);
            return turn(a, world.cageTurn) * 60;
        };
        const slow = rest();
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 2, rows: [18, 19], tspin: true }));
        expect(rest() - slow).toBeGreaterThan(Math.abs(slow) * 10);
        run(world, camera, 10);
        expect(rest()).toBeCloseTo(slow, 3);
    });

    it('flashes two cue marks on a reel change', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => world.levelUp(2));
        let marks = 0;
        let lit = false;
        for (let i = 0; i < 180; i++) {
            frame(world, camera, 1 / 60);
            const on = world.getPostState().cue > 0;
            if (on && !lit) marks += 1;
            lit = on;
        }
        expect(marks).toBe(2);
        expect(world.counts.levels).toBe(1);
    });
});

describe('cosmic noir world: the camera', () => {
    it('holds the camera at rest under reduced motion, and drifts it otherwise', () => {
        const held = makeWorld('Minimal', { reduce: true });
        const rest = held.camera.quaternion.clone();
        for (const t of [3, 41, 260, 900]) {
            held.world.updateCamera(held.camera, {
                time: t, delta: 0, pointerX: 0.8, pointerY: -0.6,
            });
            expect(held.camera.position.length()).toBeLessThan(1e-9);
            expect(held.camera.quaternion.angleTo(rest)).toBeLessThan(1e-9);
        }
        const live = makeWorld();
        const positions = [3, 41, 260].map((t) => {
            live.world.updateCamera(live.camera, {
                time: t, delta: 0, pointerX: 0, pointerY: 0,
            });
            return live.camera.position.clone();
        });
        expect(positions[0].distanceTo(positions[1])).toBeGreaterThan(0.01);
        // A slow dolly: it stays near the rig's place.
        positions.forEach((p) => expect(p.length()).toBeLessThan(1));
    });

    it('puts the lantern where the composition hangs it, beside the card', () => {
        const { world } = makeWorld();
        const { pulsarUv } = world.getState();
        const card = fallbackLayout(1600, 900).cards[0];
        expect(pulsarUv.x).toBeLessThan(card.x0);
        expect(pulsarUv.y).toBeGreaterThan(0.1);
        expect(pulsarUv.y).toBeLessThan(0.6);
    });
});
