import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    AstralWeaveWorld, IRIS, K_COMBO_MAX, K_IRIS, K_REST, QUAD, irisPhase, phaseForK,
} from '../../src/themes/astral-weave/astral-weave-world.js';
import {
    LOOM_TIERS, PLUCK_SLOTS, SHUTTLE_SECONDS, SWEEP_SLOTS, WEFT_ROWS,
} from '../../src/themes/astral-weave/astral-weave-loom.js';
import { DUST_STATIC_MAX, DUST_TIERS } from '../../src/themes/astral-weave/astral-weave-dust.js';
import { SKY_TIERS } from '../../src/themes/astral-weave/astral-weave-sky.js';
import { POST_LOOK } from '../../src/themes/astral-weave/astral-weave-post.js';
import { VIEW_HEIGHT, fallbackLayout } from '../../src/themes/astral-weave/astral-weave-composition.js';
import { createNoiseTexture } from '../../src/themes/astral-weave/astral-weave-tsl.js';

const TIERS = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
const { PI } = Math;

function makeWorld(quality = 'Minimal') {
    const scene = new THREE.Scene();
    const world = new AstralWeaveWorld({ scene, quality, capture: true }).build();
    world.setViewport(1920, 1080, 16 / 9);
    world.setLayout(fallbackLayout(1920, 1080), 16 / 9);
    world.seek(10);
    return { scene, world };
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) world.update({ time: t0 + (seconds * i) / steps, delta: seconds / steps });
}

function countDescendants(root) {
    let n = 0;
    root.traverse(() => { n += 1; });
    return n;
}

const weft = (world, row) => world.shared.uWeftA.array[row];
const burn = (world, row) => world.shared.uWeftB.array[row];

describe('astral weave tiers', () => {
    it('defines every quality tier for the loom, the dust, the sky and the post', () => {
        for (const t of TIERS) {
            expect(LOOM_TIERS[t]).toBeTruthy();
            expect(DUST_TIERS[t]).toBeTruthy();
            expect(SKY_TIERS[t]).toBeTruthy();
            expect(POST_LOOK[t]).toBeTruthy();
        }
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < TIERS.length; i++) {
            const a = TIERS[i - 1];
            const b = TIERS[i];
            for (const key of ['threads', 'segments', 'warp', 'pegs', 'gimbals', 'sparks']) {
                expect(LOOM_TIERS[b][key], `${b}.${key}`).toBeGreaterThanOrEqual(LOOM_TIERS[a][key]);
            }
            expect(DUST_TIERS[b].count).toBeGreaterThanOrEqual(DUST_TIERS[a].count);
            expect(SKY_TIERS[b].jewels).toBeGreaterThanOrEqual(SKY_TIERS[a].jewels);
        }
        expect(POST_LOOK.Minimal.bloom).toBe(false);
        expect(POST_LOOK.High.bloom).toBe(true);
    });

    it('never simulates dust without a WebGPU renderer and caps the drawn-at-home path', () => {
        for (const t of TIERS) {
            const { world } = makeWorld(t);
            if (DUST_TIERS[t].count === 0) expect(world.dust).toBeNull();
            else {
                expect(world.dust.simulated).toBe(false);
                expect(world.dust.count).toBe(Math.min(DUST_TIERS[t].count, DUST_STATIC_MAX));
                expect(world.dust.computeNodes).toEqual([]);
            }
            world.dispose();
        }
    });
});

describe('astral weave world: build and layout', () => {
    it('bakes a tileable, full-range noise texture', () => {
        const tex = createNoiseTexture(7411, 32);
        const { data } = tex.image;
        expect(data).toHaveLength(32 * 32 * 4);
        for (let c = 0; c < 4; c++) {
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = c; i < data.length; i += 4) {
                const v = THREE.DataUtils.fromHalfFloat(data[i]);
                lo = Math.min(lo, v);
                hi = Math.max(hi, v);
            }
            expect(lo).toBeCloseTo(0, 3);
            expect(hi).toBeCloseTo(1, 3);
        }
        expect(tex.wrapS).toBe(THREE.RepeatWrapping);
        tex.dispose();
    });

    it('uses node materials only and draws every pool from the first frame', () => {
        const { scene, world } = makeWorld('High');
        const materials = [];
        scene.traverse((object) => { if (object.material) materials.push(object.material); });
        expect(materials.length).toBeGreaterThan(8);
        expect(materials.every((m) => m.isNodeMaterial === true)).toBe(true);
        expect(materials.filter((m) => m.isShaderMaterial)).toEqual([]);
        scene.traverse((object) => { if (object.isMesh) expect(object.visible, object.name).toBe(true); });
        world.dispose();
    });

    it('seats the hoop on the card: position, scale and the board rows', () => {
        const { world } = makeWorld();
        expect(world.loomGroup.position.x).toBeCloseTo(world.loom.cx * VIEW_HEIGHT, 8);
        expect(world.loomGroup.scale.x).toBeCloseTo(world.loom.radius * VIEW_HEIGHT, 8);
        expect(world.hasBoard).toBe(true);
        expect(world.shared.uLoomPx.value).toBeCloseTo(world.loom.radius * 1080, 6);
        // Rows run downward and every one is a chord of the hoop.
        expect(world.rowY(0)).toBeGreaterThan(world.rowY(WEFT_ROWS - 1));
        for (let row = 0; row < WEFT_ROWS; row++) {
            expect(Math.abs(world.rowY(row))).toBeLessThan(1);
            expect(world.rowAt(world.rowY(row))).toBe(row);
        }
        const heart = world.getHeartScreen();
        expect(heart.x).toBeCloseTo(0.5, 6);
        expect(heart.y).toBeCloseTo(0.5, 6);
        world.dispose();
    });

    it('keeps a pixel-width floor so threads never thin below a pixel', () => {
        const { world } = makeWorld();
        world.setViewport(640, 360, 16 / 9);
        expect(world.shared.uPxScale.value).toBeGreaterThanOrEqual(0.85);
        world.setViewport(3840, 2160, 16 / 9);
        expect(world.shared.uPxScale.value).toBeCloseTo(2, 6);
        world.dispose();
    });

    it('draws only the requested parts for layer bisects', () => {
        const { world } = makeWorld();
        world.showOnlyParts(['rosette', 'hoop']);
        expect(world.rosette.mesh.visible).toBe(true);
        expect(world.hoop.mesh.visible).toBe(true);
        expect(world.sky.field.visible).toBe(false);
        expect(world.wefts.mesh.visible).toBe(false);
        world.dispose();
    });

    it('creates nothing at event time: events are uniform and buffer writes', () => {
        const { scene, world } = makeWorld('High');
        const before = countDescendants(scene);
        for (let i = 0; i < 6; i++) {
            world.lock({ rows: [19 - i, 18 - i], u: 0.3, hardDrop: i % 2 === 0 });
            world.clear({ rows: [19], lines: 1, combo: i + 1 });
            run(world, 0.4);
        }
        world.clear({ rows: [16, 17, 18, 19], lines: 4, combo: 7 });
        run(world, 6);
        world.levelUp(3);
        run(world, 1);
        expect(countDescendants(scene)).toBe(before);
        world.dispose();
    });
});

describe('astral weave world: the lock', () => {
    it('throws the shuttle across each row the piece occupies and plucks the weave', () => {
        const { world } = makeWorld();
        world.lock({ rows: [17, 18], u: 0.25 });
        expect(weft(world, 17).y).toBe(1);
        expect(weft(world, 18).y).toBe(1);
        expect(weft(world, 18).x).toBeGreaterThan(weft(world, 17).x); // staggered shuttles
        expect(weft(world, 16).y).toBe(0);
        const lockX = world.board.left + 0.25 * world.board.width;
        expect(burn(world, 17).z).toBeCloseTo(lockX, 10);
        const pluck = world.shared.uPluck.array[0];
        expect(pluck.x).toBeCloseTo(lockX, 10);
        expect(pluck.y).toBeCloseTo((world.rowY(17) + world.rowY(18)) / 2, 10);
        expect(pluck.z).toBe(world.time);
        expect(world.energy).toBeGreaterThan(0);
        world.dispose();
    });

    it('alternates the shuttle like a real loom and marks a hard drop', () => {
        const { world } = makeWorld();
        world.lock({ rows: [19] });
        world.lock({ rows: [18], hardDrop: true });
        world.lock({ rows: [17] });
        expect(weft(world, 19).z).toBe(-weft(world, 18).z);
        expect(weft(world, 17).z).toBe(weft(world, 19).z);
        expect(weft(world, 18).w).toBe(1);
        expect(weft(world, 19).w).toBe(0);
        world.dispose();
    });

    it('rings the hoop from the peg the shuttle lands on, once it lands', () => {
        const { world } = makeWorld();
        world.lock({ rows: [10] });
        const lockSlots = () => world.shared.uSweep.array.slice(2).filter((v) => v.y > 0).length;
        expect(lockSlots()).toBe(0);
        run(world, SHUTTLE_SECONDS * 0.5);
        expect(lockSlots()).toBe(0);
        run(world, SHUTTLE_SECONDS);
        expect(lockSlots()).toBe(1);
        const ring = world.shared.uSweep.array.slice(2).find((v) => v.y > 0);
        const y = world.rowY(10);
        const landing = weft(world, 10).z > 0 ? Math.asin(y) : PI - Math.asin(y);
        expect(ring.x).toBeCloseTo(landing, 10);
        world.dispose();
    });

    it('cycles its pluck slots instead of growing', () => {
        const { world } = makeWorld();
        for (let i = 0; i < PLUCK_SLOTS + 2; i++) {
            world.lock({ rows: [19], u: i / 10 });
            run(world, 0.1);
        }
        expect(world.shared.uPluck.array).toHaveLength(PLUCK_SLOTS);
        expect(world.shared.uPluck.array.every((v) => v.z > 0)).toBe(true);
        world.dispose();
    });
});

describe('astral weave world: the clear', () => {
    it('burns the cleared rows, sends two fronts round the hoop and a ring through the gas', () => {
        const { world } = makeWorld();
        world.lock({ rows: [18, 19] });
        run(world, 0.5);
        world.clear({ rows: [18, 19], lines: 2, combo: 1 });
        expect(burn(world, 18).x).toBe(world.time);
        expect(burn(world, 19).y).toBeGreaterThan(0);
        const [right, left] = world.shared.uSweep.array;
        expect(right.y).toBe(world.time);
        expect(left.x).toBeCloseTo(PI - right.x, 10);
        expect(right.z).toBeGreaterThan(0.5);
        run(world, 0.2);
        expect(world.shared.uShock.value.x).toBeGreaterThan(0.2);
        expect(world.shared.uShock.value.y).toBeGreaterThan(0);
        world.dispose();
    });

    it('lights a row that has no thread yet', () => {
        const { world } = makeWorld();
        world.clear({ rows: [12], lines: 1, combo: 1 });
        expect(weft(world, 12).y).toBe(1);
        expect(weft(world, 12).x).toBeLessThan(world.time - SHUTTLE_SECONDS); // already laid
        expect(burn(world, 12).x).toBe(world.time);
        world.dispose();
    });

    it('drops the burnt rows out of the tapestry: the rows above move down, as the stack did', () => {
        const { world } = makeWorld();
        world.lock({ rows: [19], u: 0.1 });
        world.lock({ rows: [18], u: 0.2 });
        world.lock({ rows: [17], u: 0.3 });
        world.lock({ rows: [16], u: 0.4 });
        const birth16 = weft(world, 16).x;
        const birth18 = weft(world, 18).x;
        world.clear({ rows: [19, 17], lines: 2, combo: 1 });
        expect(world.getState().wefts).toBe(4);
        run(world, 1.2);
        // Rows 18 and 16 survive and now sit on the floor.
        expect(world.getState().wefts).toBe(2);
        expect(weft(world, 19).x).toBe(birth18);
        expect(weft(world, 18).x).toBe(birth16);
        expect(weft(world, 17).y).toBe(0);
        expect(weft(world, 16).y).toBe(0);
        world.dispose();
    });

    it('applies a pending drop before the next lock writes its rows', () => {
        const { world } = makeWorld();
        world.lock({ rows: [19] });
        world.clear({ rows: [19], lines: 1, combo: 1 });
        world.lock({ rows: [19] }); // lands before the burn has settled
        expect(weft(world, 19).y).toBe(1);
        expect(burn(world, 19).x).toBe(-2000); // a fresh thread, not a burning one
        run(world, 1.5);
        expect(weft(world, 19).y).toBe(1);
        world.dispose();
    });
});

describe('astral weave world: the combo rosette', () => {
    it('rests on the nephroid with its cusps pointing in at the card', () => {
        const { world } = makeWorld();
        run(world, 1);
        expect(world.k).toBe(K_REST);
        expect(world.shared.uPhase.value).toBeCloseTo(PI, 10);
        expect(Math.abs(world.shared.uK.value - K_REST)).toBeLessThan(0.02); // it only breathes
        world.dispose();
    });

    it('weaves one more petal per chained clear, up to its cap, and unwinds when the chain breaks', () => {
        const { world } = makeWorld();
        world.setCombo(1);
        expect(world.kTarget).toBe(K_REST);
        world.setCombo(4);
        expect(world.kTarget).toBe(K_REST + 3);
        world.setCombo(99);
        expect(world.kTarget).toBe(K_REST + K_COMBO_MAX);
        run(world, 4);
        expect(world.k).toBeCloseTo(K_REST + K_COMBO_MAX, 3);
        expect(world.shared.uHeat.value).toBeCloseTo(1, 2);
        world.setCombo(0);
        run(world, 12);
        expect(world.k).toBeCloseTo(K_REST, 3);
        expect(world.shared.uHeat.value).toBeLessThan(0.01);
        world.dispose();
    });

    it('reaches the same k at 30, 60 and 144 frames a second', () => {
        const results = [30, 60, 144].map((fps) => {
            const { world } = makeWorld();
            world.setCombo(5);
            run(world, 0.5, Math.round(0.5 * fps));
            const { k } = world;
            world.dispose();
            return k;
        });
        expect(results[1]).toBeCloseTo(results[0], 9);
        expect(results[2]).toBeCloseTo(results[0], 9);
        expect(results[0]).toBeGreaterThan(K_REST + 1);
        expect(results[0]).toBeLessThan(K_REST + 4);
    });

    it('rests on a richer figure each level and returns to the nephroid for a new run', () => {
        const { world } = makeWorld();
        world.levelUp(2);
        expect(world.kTarget).toBe(K_REST + 1);
        world.levelUp(4);
        expect(world.kTarget).toBe(K_REST + 3);
        world.levelUp(5);
        expect(world.kTarget).toBe(K_REST);
        world.levelUp(3);
        world.resetSession();
        expect(world.kTarget).toBe(K_REST);
        world.dispose();
    });
});

describe('astral weave world: the quad', () => {
    it('keeps the phase continuous through petals, iris and fan', () => {
        const iris = irisPhase(IRIS.to);
        expect(phaseForK(K_REST + 4)).toBe(PI);
        expect(phaseForK(K_REST)).toBeCloseTo(PI, 12);
        expect(phaseForK(K_REST - 1e-9)).toBeCloseTo(PI, 6);
        expect(phaseForK(K_IRIS)).toBeCloseTo(iris, 12);
        expect(phaseForK(K_IRIS - 1e-9)).toBeCloseTo(iris, 6);
        expect(phaseForK(0)).toBeCloseTo(PI / 2, 12); // the fan gathers into the crown peg
        // The iris phase is the one whose chords are tangent to a circle of that radius.
        expect(Math.cos(irisPhase(0.45) / 2)).toBeCloseTo(0.45, 12);
        expect(irisPhase(0)).toBeCloseTo(PI, 12); // radius 0: every thread is a diameter
    });

    it('gathers the weave into the crown, opens the iris, then blooms back into petals', () => {
        const { world } = makeWorld();
        world.setCombo(3);
        run(world, 3);
        const from = world.k;
        world.clear({ rows: [16, 17, 18, 19], lines: 4, combo: 4 });
        expect(world.quadK()).toBeCloseTo(from, 6);

        run(world, QUAD.gather * 0.5);
        expect(world.k).toBeLessThan(from);
        expect(world.k).toBeGreaterThan(0);

        run(world, QUAD.gather * 0.5 + QUAD.dwell * 0.5);
        expect(world.k).toBe(0); // the dwell: every thread ends at the crown
        expect(world.shared.uPhase.value).toBeCloseTo(PI / 2, 10);
        expect(world.shared.uCrown.value).toBeGreaterThan(0.6);

        run(world, QUAD.dwell * 0.5 + QUAD.open + 0.3);
        expect(world.k).toBe(K_IRIS);
        expect(world.shared.uHeat.value).toBeCloseTo(1, 2); // the iris is gold
        const early = world.shared.uPhase.value;
        run(world, 1.4);
        expect(world.k).toBe(K_IRIS);
        // The iris opens: its circle of tangency grows, so its phase falls.
        expect(world.shared.uPhase.value).toBeLessThan(early);
        expect(world.shared.uPhase.value).toBeCloseTo(irisPhase(IRIS.to), 2);

        run(world, QUAD.hold + QUAD.relax);
        expect(world.quadK()).toBeNull();
        expect(world.k).toBeCloseTo(world.kTarget, 3);
        expect(world.kTarget).toBe(K_REST + 3);
        world.dispose();
    });

    it('never jumps: k and the phase move continuously through the whole timeline', () => {
        const { world } = makeWorld();
        world.clear({ rows: [16, 17, 18, 19], lines: 4, combo: 1 });
        let lastK = world.k;
        let lastPhase = world.shared.uPhase.value;
        const total = QUAD.hold + QUAD.relax + 0.5;
        const steps = Math.round(total * 240);
        const t0 = world.time;
        for (let i = 1; i <= steps; i++) {
            world.update({ time: t0 + (total * i) / steps, delta: total / steps });
            expect(Math.abs(world.k - lastK), `k at step ${i}`).toBeLessThan(0.12);
            expect(Math.abs(world.shared.uPhase.value - lastPhase), `phase at step ${i}`).toBeLessThan(0.08);
            lastK = world.k;
            lastPhase = world.shared.uPhase.value;
        }
        world.dispose();
    });

    it('holds a perfect clear longer and opens it from a tighter sunburst', () => {
        const { world } = makeWorld();
        world.clear({
            rows: [19], lines: 1, perfect: true, combo: 1,
        });
        expect(world.quadHold).toBeGreaterThan(QUAD.hold);
        expect(world.irisFrom).toBe(IRIS.perfectFrom);
        expect(world.crownGain).toBeGreaterThan(1);
        world.dispose();
    });

    it('does not re-weave under reduced motion: the crown and the fronts carry the quad', () => {
        const { world } = makeWorld();
        world.setReducedMotion(true);
        world.clear({ rows: [16, 17, 18, 19], lines: 4, combo: 1 });
        run(world, 0.3);
        expect(world.quadK()).toBeNull();
        expect(world.k).toBeCloseTo(K_REST, 6);
        expect(world.shared.uCrown.value).toBeGreaterThan(0.5);
        expect(world.kick).toBe(0);
        world.dispose();
    });
});

describe('astral weave world: robustness', () => {
    it('saturates under an event storm and stays finite', () => {
        const { world } = makeWorld('High');
        for (let i = 0; i < 400; i++) {
            world.lock({ rows: [i % 20, (i + 1) % 20, 99, -5], u: i, hardDrop: true });
            world.clear({
                rows: [i % 20], lines: 1e9, combo: 1e9, cascade: 1e9,
            });
            world.onLock({
                player: 3, rows: [5], u: 0.5, hardDrop: false,
            });
            world.onClear({ player: 4, rows: [5], lines: 2 });
        }
        run(world, 0.5);
        expect(world.energy).toBeLessThanOrEqual(2);
        expect(world.kick).toBeLessThanOrEqual(1);
        expect(world.flash).toBeLessThanOrEqual(1);
        expect(world.kTarget).toBe(K_REST + K_COMBO_MAX);
        expect(world.timers.length).toBeLessThan(4000);
        const s = world.shared;
        for (const u of [s.uK, s.uPhase, s.uHeat, s.uEnergy, s.uCore, s.uCrown, s.uSpin, s.uWarpTwist]) {
            expect(Number.isFinite(u.value)).toBe(true);
        }
        for (const v of [...s.uWeftA.array, ...s.uWeftB.array, ...s.uPluck.array, ...s.uSweep.array]) {
            expect([v.x, v.y, v.z, v.w].every(Number.isFinite)).toBe(true);
        }
        expect(s.uSweep.array).toHaveLength(SWEEP_SLOTS);
        run(world, 30);
        expect(world.timers).toHaveLength(0);
        world.dispose();
    });

    it("echoes another local board's events without weaving them into the primary board's rows", () => {
        const { world } = makeWorld();
        expect(world.isPrimary(0)).toBe(true);
        expect(world.isPrimary(1)).toBe(true);
        expect(world.isPrimary(3)).toBe(false);
        world.onLock({
            player: 3, rows: [10], u: 0.5, hardDrop: false,
        });
        world.onClear({ player: 3, rows: [10], lines: 2 });
        world.onCombo(7, 3);
        expect(world.getState().wefts).toBe(0);
        expect(world.combo).toBe(0);
        expect(world.shared.uPluck.array.some((v) => v.w > 0)).toBe(true);
        expect(world.shockGain).toBeGreaterThan(0);
        world.onCombo(3, 0);
        expect(world.combo).toBe(3);
        world.dispose();
    });

    it('anchors a meditation click on the row under the pointer', () => {
        const { world } = makeWorld();
        const at = world.screenToBoard(0.5, 0.5);
        world.onClear({
            player: 0, rows: [], lines: 1, combo: 2, screen: { x: 0.5, y: 0.5 },
        });
        expect(burn(world, at.row).x).toBe(world.time);
        expect(world.combo).toBe(2);
        world.dispose();
    });

    it('seeks back to a clean idle frame', () => {
        const { world } = makeWorld();
        world.lock({ rows: [19, 18] });
        world.clear({ rows: [16, 17, 18, 19], lines: 4, combo: 6 });
        run(world, 1);
        world.seek(42);
        expect(world.time).toBe(42);
        expect(world.getState()).toMatchObject({
            k: K_REST, kTarget: K_REST, combo: 0, heat: 0, energy: 0, quad: false, wefts: 0,
        });
        expect(world.shared.uSweep.array.every((v) => v.z === 0)).toBe(true);
        expect(world.timers).toHaveLength(0);
        world.dispose();
    });

    it("resolves its compute preparation to 'static' without a GPU", async () => {
        const { world } = makeWorld('High');
        await expect(world.prepareCompute()).resolves.toBe('static');
        world.dispose();
    });

    it('releases everything once, however often it is disposed', () => {
        const { scene, world } = makeWorld('High');
        const resources = [];
        scene.traverse((object) => {
            if (object.geometry) resources.push(object.geometry);
            if (object.material) resources.push(object.material);
        });
        resources.push(world.noiseTex);
        const spies = resources.map((resource) => vi.spyOn(resource, 'dispose'));
        world.dispose();
        world.dispose();
        expect(scene.children).toHaveLength(0);
        spies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
    });
});
