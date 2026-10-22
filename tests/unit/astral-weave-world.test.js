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
import {
    LAMPS, SKY_TIERS, lampFlare, lampPositions,
} from '../../src/themes/astral-weave/astral-weave-sky.js';
import { MOTE_TIERS, placeMotes } from '../../src/themes/astral-weave/astral-weave-motes.js';
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
        expect(world.energySwell.valueAt(world.time)).toBeGreaterThan(0);
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
        const lockSlots = () => world.shared.uSweep.array.filter((v) => v.y > 0).length;
        expect(lockSlots()).toBe(0);
        run(world, SHUTTLE_SECONDS * 0.5);
        expect(lockSlots()).toBe(0);
        run(world, SHUTTLE_SECONDS);
        expect(lockSlots()).toBe(1);
        const ring = world.shared.uSweep.array.find((v) => v.y > 0);
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
        // The pair takes the slots with the least light left (the lock's own ring keeps its own).
        const fronts = world.shared.uSweep.array.filter((v) => v.y === world.time);
        expect(fronts).toHaveLength(2);
        const [right, left] = fronts;
        expect(left.x).toBeCloseTo(PI - right.x, 10);
        expect(right.z).toBeGreaterThan(0.5);
        run(world, 0.2);
        const { uShockR, uShockG } = world.shared;
        expect(Math.max(uShockR.value.x, uShockR.value.y, uShockR.value.z, uShockR.value.w)).toBeGreaterThan(0.2);
        expect(Math.max(uShockG.value.x, uShockG.value.y, uShockG.value.z, uShockG.value.w)).toBeGreaterThan(0);
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
        // A level-up never takes petals away: from level 4 on it rests on the richest figure.
        world.levelUp(5);
        expect(world.kTarget).toBe(K_REST + 3);
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
        expect(world.crownSwell.valueAt(world.time + QUAD.gather)).toBeGreaterThan(1);
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

describe('astral weave world: fast play builds instead of popping', () => {
    const quadRows = [16, 17, 18, 19];
    const sumGains = (v) => v.x + v.y + v.z + v.w;
    const litFronts = (world) => world.shared.uSweep.array.filter((v) => v.w > 0.05).length;

    it('never cuts the light of a quad with the single that follows it', () => {
        const { world } = makeWorld();
        world.clear({ rows: quadRows, lines: 4, combo: 1 });
        run(world, 0.5);
        const { quadAt } = world;
        const before = {
            flash: world.flash,
            energy: world.energy,
            crown: world.shared.uCrown.value,
            fronts: litFronts(world),
            rings: sumGains(world.shared.uShockG.value),
        };
        world.clear({ rows: [19], lines: 1, combo: 2 });
        run(world, 1 / 60);
        expect(world.flash).toBeGreaterThan(before.flash * 0.95);
        expect(world.energy).toBeGreaterThan(before.energy * 0.95);
        expect(world.shared.uCrown.value).toBeGreaterThan(before.crown * 0.95);
        // The quad's fronts and its ring run on beside the single's.
        expect(litFronts(world)).toBeGreaterThanOrEqual(before.fronts + 2);
        expect(sumGains(world.shared.uShockG.value)).toBeGreaterThan(before.rings * 0.97 + 0.3);
        expect(world.quadAt).toBe(quadAt);
        world.dispose();
    });

    it('lets a burning row finish its burn when the next piece lands before it settles', () => {
        const { world } = makeWorld();
        world.lock({ rows: [19] });
        run(world, 0.5);
        world.clear({ rows: [19], lines: 1, combo: 1 });
        const clearedAt = world.time;
        run(world, 0.3);
        world.lock({ rows: [19] }); // the tapestry drops the burnt row now: the board already has
        expect(burn(world, 19).x).toBe(-2000); // a fresh thread on the floor row...
        expect(world.getState().embers).toBe(1); // ...and the old one still burning, where it was
        const slot = world.shared.uWeftB.array.slice(WEFT_ROWS).findIndex((v) => v.x === clearedAt);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(world.shared.uEmber.array[slot].x).toBe(19);
        expect(world.shared.uWeftB.array[WEFT_ROWS + slot].y).toBeGreaterThan(0);
        run(world, 2.5);
        expect(world.getState().embers).toBe(0);
        expect(world.getState().wefts).toBe(1);
        world.dispose();
    });

    it('builds each cascade wave on the last: brighter burns, stronger fronts, faster rings', () => {
        const { world } = makeWorld();
        const burns = [];
        const fronts = [];
        const speeds = [];
        for (let wave = 1; wave <= 6; wave++) {
            world.clear({
                rows: [19], lines: 1, combo: 1, cascade: wave,
            });
            burns.push(burn(world, 19).y);
            fronts.push(Math.max(...world.shared.uSweep.array.filter((v) => v.y === world.time).map((v) => v.z)));
            speeds.push(Math.max(...world.shockSpeed));
            run(world, 0.36);
        }
        for (let i = 1; i < burns.length; i++) {
            expect(burns[i], `wave ${i + 1}`).toBeGreaterThan(burns[i - 1]);
            expect(fronts[i], `wave ${i + 1}`).toBeGreaterThan(fronts[i - 1]);
            expect(speeds[i], `wave ${i + 1}`).toBeGreaterThan(speeds[i - 1]);
        }
        world.dispose();
    });

    it('reads hotter through a long chain than at its first clear, and breathes back when the hands rest', () => {
        const { world } = makeWorld('High');
        const read = () => {
            const s = world.shared;
            const post = world.getPostState();
            return {
                heat: s.uHeat.value,
                energy: s.uEnergy.value,
                lamps: s.uLampFlare.value.x,
                carousel: s.uCarousel.value.y,
                lace: s.uLace.value,
                bloom: post.bloomBoost,
                exposure: post.exposure,
                stage: world.play.stage,
            };
        };
        let first = null;
        for (let i = 0; i < 12; i++) {
            world.lock({ rows: [19], hardDrop: true });
            world.clear({ rows: [19], lines: 1 + (i % 3), combo: i + 1 });
            run(world, 0.64);
            if (i === 0) first = read();
        }
        const last = read();
        expect(first.stage).toBeLessThan(2);
        expect(last.stage).toBe(3); // fever
        expect(last.heat).toBeGreaterThan(first.heat + 0.5);
        expect(last.energy).toBeGreaterThan(first.energy);
        expect(last.lamps).toBeGreaterThan(first.lamps + 0.5);
        expect(first.carousel).toBeLessThan(0.02);
        expect(last.carousel).toBeGreaterThan(0.3);
        expect(last.lace).toBeGreaterThan(0.3);
        expect(last.bloom).toBeGreaterThan(first.bloom + 0.15);
        // The iris closes a touch as the heat adds light, so the colours stay saturated.
        expect(last.exposure).toBeLessThan(first.exposure);
        run(world, 12);
        const rested = read();
        expect(rested.stage).toBe(0);
        expect(rested.carousel).toBeLessThan(0.01);
        expect(rested.lamps).toBeLessThan(1.02);
        expect(rested.bloom).toBeLessThan(0.01);
        expect(rested.exposure).toBeGreaterThan(0.995);
        world.dispose();
    });

    it('leaves the loom as it always was under casual play', () => {
        const { world } = makeWorld();
        let most = 0;
        for (let i = 0; i < 14; i++) {
            world.lock({ rows: [19 - (i % 6)], u: (i * 0.37) % 1 });
            if (i % 4 === 3) world.clear({ rows: [19], lines: 1, combo: 1 });
            for (let f = 0; f < 90; f++) {
                run(world, 1 / 60, 1);
                most = Math.max(most, world.shared.uCarousel.value.y, world.getPostState().bloomBoost);
            }
        }
        expect(most).toBeLessThan(0.02);
        expect(world.play.stage).toBe(0);
        expect(world.shared.uLampFlare.value.x).toBeLessThan(1.02);
        world.dispose();
    });

    it('crowns the quad still playing with a late perfect clear: no re-gather, no row burns', () => {
        const twin = makeWorld().world;
        const { world } = makeWorld();
        for (const w of [world, twin]) {
            w.lock({ rows: quadRows });
            w.clear({ rows: quadRows, lines: 4, combo: 1 });
            run(w, 0.36);
        }
        const { quadAt } = world;
        const burnt = quadRows.map((row) => burn(world, row).x);
        const { k } = world;
        world.onPerfect({ player: 0 });
        expect(world.quadAt).toBe(quadAt);
        expect(world.quadHold).toBeGreaterThan(twin.quadHold);
        expect(quadRows.map((row) => burn(world, row).x)).toEqual(burnt);
        run(world, 1 / 120, 1);
        run(twin, 1 / 120, 1);
        expect(Math.abs(world.k - twin.k)).toBeLessThan(1e-9); // the gather carries on untouched
        expect(Math.abs(world.k - k)).toBeLessThan(0.6);
        run(world, 0.2);
        run(twin, 0.2);
        expect(world.shared.uCrown.value).toBeGreaterThan(twin.shared.uCrown.value);
        expect(world.play.punch).toBeGreaterThan(twin.play.punch);
        world.dispose();
        twin.dispose();
    });

    it('opens an iris of its own for a perfect clear after a smaller clear', () => {
        const { world } = makeWorld();
        world.clear({ rows: [19, 18], lines: 2, combo: 1 });
        run(world, 0.36);
        world.onPerfect({ player: 0 });
        expect(world.quadK()).not.toBeNull();
        expect(world.quadHold).toBeGreaterThan(QUAD.hold);
        world.dispose();
    });

    it('holds and tightens the open iris for a back-to-back quad, never re-gathers, and laces the gimbals', () => {
        const { world } = makeWorld();
        world.clear({ rows: quadRows, lines: 4, combo: 1 });
        run(world, 2.3);
        const { quadAt } = world;
        const holdBefore = world.quadHold;
        const phase = world.shared.uPhase.value;
        expect(world.k).toBe(K_IRIS);
        world.clear({
            rows: quadRows, lines: 4, combo: 1, b2b: true,
        });
        expect(world.quadAt).toBe(quadAt);
        expect(world.quadHold).toBeGreaterThan(holdBefore);
        run(world, 1 / 120, 1);
        expect(world.k).toBe(K_IRIS);
        expect(Math.abs(world.shared.uPhase.value - phase)).toBeLessThan(0.05);
        run(world, 0.3);
        // A tighter circle of tangency: a larger phase.
        expect(world.shared.uPhase.value).toBeGreaterThan(phase + 0.05);
        expect(world.shared.uLace.value).toBeGreaterThan(0.5);
        world.dispose();
    });

    it('unweaves a broken chain one petal at a time', () => {
        const { world } = makeWorld();
        world.setCombo(9);
        run(world, 4);
        expect(world.kTarget).toBe(K_REST + 8);
        world.setCombo(0);
        let steepest = 0;
        let last = world.k;
        for (let i = 0; i < 300; i++) {
            run(world, 1 / 60, 1);
            steepest = Math.max(steepest, last - world.k);
            last = world.k;
            if (i === 30) expect(world.kTarget).toBeGreaterThan(K_REST + 5);
        }
        expect(world.kTarget).toBe(K_REST);
        expect(world.k).toBeCloseTo(K_REST, 2);
        expect(steepest * 60).toBeLessThan(4.5); // petals per second, at the fastest
        world.dispose();
    });

    it('answers a T-spin that cleared nothing with a small wring of the hoop', () => {
        const { world } = makeWorld();
        world.onSpin({ player: 0 });
        run(world, 0.2);
        expect(Math.abs(world.spin)).toBeGreaterThan(0.02);
        expect(world.play.punch).toBeGreaterThan(0);
        expect(world.getState().wefts).toBe(0);
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
        expect(Math.max(...world.shockGain)).toBeGreaterThan(0);
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

describe('astral weave world: the lit sky and the near motes', () => {
    it('sets the lamps in the free corners on a landscape frame and above and below the card on a portrait one', () => {
        const wide = lampPositions(16 / 9);
        const half = (16 / 9) / 2;
        for (const [x, y] of [[wide[0], wide[1]], [wide[2], wide[3]]]) {
            expect(Math.abs(x)).toBeGreaterThan(0.6 * half); // clear of the card and the HUD
            expect(Math.abs(x)).toBeLessThan(half); // inside the frame
            expect(Math.abs(y)).toBeLessThan(0.5);
        }
        // One lower left, one upper right: the corners the river crosses.
        expect(wide[0]).toBeLessThan(0);
        expect(wide[1]).toBeLessThan(0);
        expect(wide[2]).toBeGreaterThan(0);
        expect(wide[3]).toBeGreaterThan(0);
        const tall = lampPositions(430 / 932);
        for (const [x, y] of [[tall[0], tall[1]], [tall[2], tall[3]]]) {
            expect(Math.abs(x)).toBeLessThan((430 / 932) / 2);
            expect(Math.abs(y)).toBeGreaterThan(0.38); // the strips above and below the card
            expect(Math.abs(y)).toBeLessThan(0.5);
        }
        expect(LAMPS).toHaveLength(2);
    });

    it('re-seats the lamps when the aspect changes', () => {
        const { world } = makeWorld();
        const { uLamps } = world.shared;
        expect(uLamps.value.x).toBeCloseTo(lampPositions(16 / 9)[0], 8);
        world.setViewport(430, 932, 430 / 932);
        expect(uLamps.value.y).toBeCloseTo(lampPositions(430 / 932)[1], 8);
        world.dispose();
    });

    it('flares each lamp only while a clear\'s shock ring passes it', () => {
        const loom = { cx: 0, cy: 0, radius: 0.5 };
        expect(lampFlare(0.6, 0, loom, 0, 0)).toBe(1);
        expect(lampFlare(0.6, 0, loom, 1.2, 0.8)).toBeCloseTo(1 + 0.8 * 0.85, 6); // the front is on it
        expect(lampFlare(0.6, 0, loom, 2.4, 0.8)).toBeLessThan(1.001); // long past
        const { world } = makeWorld();
        const camera = new THREE.PerspectiveCamera();
        world.clear({ rows: [19, 18], lines: 2 });
        const flares = [];
        for (let i = 1; i <= 120; i++) {
            const sim = { time: 10 + i / 60, delta: 1 / 60 };
            world.updateCamera(camera, sim);
            world.update(sim);
            flares.push(Math.max(world.shared.uLampFlare.value.x, world.shared.uLampFlare.value.y));
        }
        expect(Math.max(...flares)).toBeGreaterThan(1.2);
        expect(flares[flares.length - 1]).toBeLessThan(1.05);
        world.dispose();
    });

    it('keeps what is authored in the frame in place however long the session runs', () => {
        const { world } = makeWorld();
        const camera = new THREE.PerspectiveCamera();
        for (const time of [10, 1800, 3600, 7200]) {
            world.updateCamera(camera, { time, pointerX: 1, pointerY: -1 });
            // The gas drifts with time; the jewels, lamps and near motes take the camera's parallax
            // alone, which stays a few thousandths of the view.
            expect(Math.abs(world.shared.uParallax.value.x)).toBeLessThan(0.004);
            expect(Math.abs(world.shared.uParallax.value.y)).toBeLessThan(0.004);
        }
        expect(world.shared.uSkyShift.value.x).toBeGreaterThan(2);
        world.dispose();
    });

    it('places the near motes beside the card column, in the frame, and scales them with the tier', () => {
        for (let i = 1; i < TIERS.length; i++) {
            expect(MOTE_TIERS[TIERS[i]]).toBeGreaterThanOrEqual(MOTE_TIERS[TIERS[i - 1]]);
        }
        expect(MOTE_TIERS.Minimal).toBe(0);
        const place = placeMotes(64);
        for (let i = 0; i < 64; i++) {
            const [x, y, depth] = place.subarray(i * 4, i * 4 + 3);
            expect(Math.abs(x)).toBeGreaterThan(0.3);
            expect(Math.abs(x)).toBeLessThanOrEqual(1.05);
            expect(Math.abs(y)).toBeLessThanOrEqual(1.05);
            expect(depth).toBeGreaterThanOrEqual(0);
            expect(depth).toBeLessThanOrEqual(1);
        }
        const minimal = makeWorld('Minimal');
        expect(minimal.world.motes).toBeNull();
        expect(minimal.world.parts.motes).toEqual([]);
        minimal.world.dispose();
        const high = makeWorld('High');
        expect(high.world.motes.count).toBe(MOTE_TIERS.High);
        high.world.showOnlyParts(['sky', 'motes']);
        expect(high.world.motes.mesh.visible).toBe(true);
        expect(high.world.rosette.mesh.visible).toBe(false);
        high.world.dispose();
    });
});
