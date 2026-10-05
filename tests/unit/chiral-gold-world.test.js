import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    ChiralGoldWorld, RING_TURN, TOWER_TURN, fovForAspect,
} from '../../src/themes/chiral-gold/chiral-gold-world.js';
import {
    ALLOYS,
    AURUM,
    COMET_SLOTS,
    HELIX,
    PULSE_SLOTS,
    RIPPLE_SLOTS,
    SPARK_FLIGHT,
    STAGE,
    TAU,
    heatForCombo,
} from '../../src/themes/chiral-gold/chiral-gold-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/chiral-gold/chiral-gold-quality.js';
import { buildRibbonGeometry, buildWireGeometry } from '../../src/themes/chiral-gold/chiral-gold-helix.js';
import { BANDS } from '../../src/themes/chiral-gold/chiral-gold-ring.js';
import {
    BLADE_TRAVEL, BRAID, bakeTallyAtlas, braidHeight,
} from '../../src/themes/chiral-gold/chiral-gold-fx.js';
import { fallbackLayout } from '../../src/themes/chiral-gold/chiral-gold-composition.js';

// A High world bakes a 1024-wide studio; the build machine is often busy with other sessions.
vi.setConfig({ testTimeout: 30000 });

const worlds = [];

/** A world with its camera bound and a 1600 × 900 frame, at rest at `time`. */
function createWorld(quality = 'High', { time = 10, width = 1600, height = 900 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, 0.25, 400);
    const world = new ChiralGoldWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect, width, height);
    world.seek(time);
    const run = {
        world, scene, camera, time,
    };
    run.step = (seconds, dt = 1 / 60) => {
        const steps = Math.max(1, Math.round(seconds / dt));
        const h = seconds / steps;
        for (let i = 0; i < steps; i++) {
            run.time += h;
            world.updateCamera(camera, { time: run.time, delta: h });
            world.update({ time: run.time, delta: h });
        }
    };
    run.step(0, 1);
    worlds.push(world);
    return run;
}

const slots = (list) => list.map((u) => u.value.toArray());
const live = (list, birthIndex, time) => slots(list).filter((v) => v[birthIndex] > time - 50);

afterEach(() => {
    for (const world of worlds.splice(0)) world.dispose();
});

describe('Chiral Gold world: the hall', () => {
    it.each(QUALITY_NAMES)('builds at %s with node materials only, and everything it promised', (quality) => {
        const { world, scene } = createWorld(quality);
        const tier = QUALITY[quality];
        const materials = new Set();
        scene.traverse((object) => {
            if (object.material) materials.add(object.material);
        });
        expect(materials.size).toBeGreaterThan(10);
        for (const material of materials) {
            expect(material.isNodeMaterial, material.name).toBe(true);
            expect(material.isShaderMaterial, material.name).not.toBe(true);
        }
        expect(world.towers.map((t) => t.hand)).toEqual([-1, 1]);
        expect(world.ring.bands).toHaveLength(BANDS.length);
        expect(Boolean(world.reflection)).toBe(tier.reflection > 0);
        expect(Boolean(world.groups.shafts)).toBe(tier.shafts);
        expect(Boolean(world.braid)).toBe(tier.braid > 0);
        expect(world.leaf.count).toBe(tier.leaf);
        expect(world.sparks.count).toBe(tier.sparks);
        // The studio is the scene's environment: the gold has nothing else to reflect.
        expect(scene.environment).toBe(world.textures.studio);
        expect(scene.environment.image.width).toBe(tier.studio);
        const lights = [];
        scene.traverse((object) => {
            if (object.isLight) lights.push(object);
        });
        expect(lights).toEqual([]);
    });

    it('casts the towers as true metal', () => {
        const { world } = createWorld('High');
        for (const tower of world.towers) {
            const [ribbons, wires, beads] = tower.parts;
            for (const part of [ribbons, wires, beads]) {
                expect(part.material.isMeshStandardNodeMaterial).toBe(true);
                expect(part.material.metalness).toBe(1);
                expect(part.material.emissiveNode).toBeTruthy();
            }
        }
        world.ring.bands.forEach((band) => expect(band.mesh.material.metalness).toBe(1));
    });

    it('makes the left tower the mirror image of the right, down to the vertex', () => {
        const right = buildRibbonGeometry(40, 1);
        const left = buildRibbonGeometry(40, -1);
        const rp = right.getAttribute('position').array;
        const lp = left.getAttribute('position').array;
        const rn = right.getAttribute('normal').array;
        const ln = left.getAttribute('normal').array;
        expect(lp.length).toBe(rp.length);
        for (let i = 0; i < rp.length; i += 3) {
            expect(lp[i]).toBeCloseTo(-rp[i], 6);
            expect(lp[i + 1]).toBe(rp[i + 1]);
            expect(lp[i + 2]).toBe(rp[i + 2]);
            expect(ln[i]).toBeCloseTo(-rn[i], 6);
        }
        right.dispose();
        left.dispose();
    });

    it.each([
        ['ribbons, right', () => buildRibbonGeometry(48, 1)],
        ['ribbons, left', () => buildRibbonGeometry(48, -1)],
        ['wires, right', () => buildWireGeometry(48, 5, 1)],
        ['wires, left', () => buildWireGeometry(48, 5, -1)],
    ])('winds every triangle of the %s to face the way its normals point', (_name, build) => {
        const geometry = build();
        const p = geometry.getAttribute('position').array;
        const n = geometry.getAttribute('normal').array;
        const index = geometry.getIndex().array;
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const face = new THREE.Vector3();
        const normal = new THREE.Vector3();
        let checked = 0;
        for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i])).toBe(true);
        for (let i = 0; i < n.length; i += 3) {
            expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 4);
        }
        for (let t = 0; t < index.length; t += 3) {
            a.fromArray(p, index[t] * 3);
            b.fromArray(p, index[t + 1] * 3);
            c.fromArray(p, index[t + 2] * 3);
            face.copy(b).sub(a).cross(c.sub(a));
            // Skip the slivers where a ribbon closes to a point.
            if (face.length() < 1e-7) continue;
            normal.fromArray(n, index[t] * 3).add(b.fromArray(n, index[t + 1] * 3)).add(c.fromArray(n, index[t + 2] * 3));
            expect(face.normalize().dot(normal.normalize())).toBeGreaterThan(0);
            checked += 1;
        }
        expect(checked).toBeGreaterThan((index.length / 3) * 0.9);
        geometry.dispose();
    });

    it('draws in the mirror only what should stand in the water', () => {
        const { world, camera } = createWorld('High');
        expect(camera.layers.mask & 2).toBe(2);
        const mirror = world.reflection.reflector.getVirtualCamera(camera);
        expect(mirror.layers.mask).toBe(1);
        const onLayer = (name) => world.groups[name].map((object) => object.layers.mask);
        expect(onLayer('sky')).toEqual([1]);
        for (const name of ['water', 'motes', 'leaf', 'sparks', 'blades', 'flares', 'braid', 'shafts']) {
            expect(onLayer(name), name).toEqual([2]);
        }
        for (const tower of world.towers) {
            tower.parts.forEach((part) => expect(part.mesh.layers.mask, part.mesh.name).toBe(1));
        }
        world.ring.bands.forEach((band) => expect(band.mesh.layers.mask).toBe(1));
    });

    it('turns the towers in opposite senses, and the ring a band each way', () => {
        const run = createWorld('High', { time: 0 });
        const { world } = run;
        run.step(2);
        const [left, right] = world.towers;
        expect(left.group.rotation.y).toBeLessThan(0);
        expect(right.group.rotation.y).toBeCloseTo(-left.group.rotation.y, 12);
        expect(right.group.rotation.y).toBeCloseTo(TOWER_TURN * 2, 6);
        expect(left.group.position.x).toBeCloseTo(-right.group.position.x, 12);
        const [outer, middle, inner] = world.ring.bands;
        expect(Math.sign(outer.angle - 0)).toBe(1);
        expect(middle.angle - 1.9).toBeLessThan(0);
        expect(inner.angle - 3.8).toBeGreaterThan(0);
        expect(world.ringSpin).toBeCloseTo(RING_TURN * 2, 6);
    });

    it('seeks to a time with the hall at rest', () => {
        const run = createWorld('Medium', { time: 123.5 });
        const { world } = run;
        expect(world.spin).toBeCloseTo(TOWER_TURN * 123.5, 9);
        expect(world.ringSpin).toBeCloseTo(RING_TURN * 123.5, 9);
        expect(world.getState()).toMatchObject({
            time: 123.5, combo: 0, heat: 0, emit: 1, level: 1, counts: { locks: 0, clears: 0, strikes: 0 },
        });
    });
});

describe('Chiral Gold world: gameplay', () => {
    it('answers a lock with sparks now, a pulse when they land, and a ring on the water', () => {
        const run = createWorld('High');
        const { world } = run;
        const t0 = run.time;
        world.onLock({ rows: [14, 13], u: 0.2, color: '#FFAC33' });
        expect(world.counts.locks).toBe(1);
        // One pulse for each tower, dated for the sparks' arrival; the nearer tower takes more.
        const pulses = live(world.u.pulseA, 1, t0);
        expect(pulses).toHaveLength(2);
        const left = pulses.find((p) => p[3] === -1);
        const right = pulses.find((p) => p[3] === 1);
        expect(left[1]).toBeGreaterThan(t0 + SPARK_FLIGHT * 0.7);
        expect(left[1]).toBeLessThan(t0 + SPARK_FLIGHT * 1.2);
        expect(left[2]).toBeGreaterThan(right[2] * 1.5);
        // The pulse starts at the height the piece's row holds on the tower: row 13.5 of 20 is
        // a third of the way up from the water.
        const board = fallbackLayout(1600, 900).boards[0];
        const height = world.strikeHeight(board.y0 + (board.y1 - board.y0) * (14 / 20), board);
        expect(left[0] * world.place.scaleY).toBeCloseTo(height, 6);
        expect(height).toBeGreaterThan(2);
        expect(height).toBeLessThan(4);
        // The ring is under the board, in front of the towers, at the piece's own column.
        const [ring] = live(world.u.rippleA, 2, t0);
        expect(ring[2]).toBe(t0);
        expect(ring[1]).toBeGreaterThan(2);
        expect(ring[1]).toBeLessThan(STAGE.camera.z);
        expect(ring[0]).toBeLessThan(0);
        // Sparks were written, not created: the pool's attributes are the ones it was built with.
        const birth = world.sparks.geometry.getAttribute('aBirth');
        const born = [];
        for (let i = 0; i < birth.count; i++) if (birth.getW(i) === t0) born.push(i);
        expect(born.length).toBeGreaterThan(30);
        expect(born.length).toBeLessThanOrEqual(world.sparks.count);
        // Most of them home in on a tower, each with that tower's hand.
        const aim = world.sparks.geometry.getAttribute('aAim');
        const homing = born.filter((i) => aim.getW(i) !== 0);
        expect(homing.length).toBeGreaterThan(born.length * 0.5);
        for (const i of homing) expect(Math.sign(aim.getX(i))).toBe(aim.getW(i));
    });

    it('lands a lock on the right of the board harder on the right tower', () => {
        const run = createWorld('High');
        run.world.onLock({ rows: [10], u: 0.9 });
        const pulses = live(run.world.u.pulseA, 1, run.time);
        expect(pulses.find((p) => p[3] === 1)[2]).toBeGreaterThan(pulses.find((p) => p[3] === -1)[2]);
        expect(live(run.world.u.rippleA, 2, run.time)[0][0]).toBeGreaterThan(0);
    });

    it('makes a hard drop heavier than a soft landing', () => {
        const soft = createWorld('High');
        soft.world.onLock({ rows: [12], u: 0.3 });
        const hard = createWorld('High');
        hard.world.onLock({ rows: [12], u: 0.3, hardDrop: true });
        const strength = (run) => live(run.world.u.pulseA, 1, run.time).reduce((s, p) => s + p[2], 0);
        expect(strength(hard)).toBeGreaterThan(strength(soft) * 1.3);
        expect(live(hard.world.u.rippleA, 2, hard.time)[0][3]).toBeGreaterThan(live(soft.world.u.rippleA, 2, soft.time)[0][3]);
        expect(hard.world.dip).toBeGreaterThan(0);
        expect(soft.world.dip).toBe(0);
    });

    it('fires the cleared rows at both towers, each at its own height', () => {
        const run = createWorld('High');
        const { world } = run;
        const t0 = run.time;
        world.onClear({ rows: [19, 18, 17], lines: 3, combo: 1 });
        expect(world.counts.clears).toBe(1);
        const blades = world.blades.uniforms;
        const board = fallbackLayout(1600, 900).boards[0];
        const rowY = (row) => board.y0 + (board.y1 - board.y0) * ((row + 0.5) / 20);
        expect(blades.rows.value.x).toBeCloseTo(rowY(19), 9);
        expect(blades.rows.value.y).toBeCloseTo(rowY(18), 9);
        expect(blades.rows.value.z).toBeCloseTo(rowY(17), 9);
        expect(blades.rows.value.w).toBe(-1);
        expect(blades.frame.value.z).toBe(t0);
        // The blades run from the card's edges out to the towers.
        expect(blades.reach.value.x).toBeLessThan(blades.frame.value.x);
        expect(blades.reach.value.y).toBeGreaterThan(blades.frame.value.y);
        expect(blades.reach.value.x + blades.reach.value.y).toBeCloseTo(1, 1);
        // Each blade rises from its row to the height that row holds on the towers, which is
        // above the waterline even for the board's floor.
        const waterline = world.screenOf(world.place.helixX, 0, 0, {}).y;
        for (const axis of ['x', 'y', 'z']) {
            expect(blades.ends.value[axis]).toBeLessThan(blades.rows.value[axis]);
            expect(blades.ends.value[axis]).toBeLessThan(waterline);
        }
        expect(blades.ends.value.z).toBeLessThan(blades.ends.value.x);
        expect(blades.ends.value.w).toBe(-1);
        // A pulse for each row, through both towers, when the blades arrive; higher rows higher.
        const pulses = live(world.u.pulseA, 1, t0).sort((a, b) => a[1] - b[1]);
        expect(pulses).toHaveLength(3);
        pulses.forEach((p) => {
            expect(p[3]).toBe(0);
            expect(p[1]).toBeGreaterThanOrEqual(t0 + BLADE_TRAVEL);
        });
        expect(pulses[2][0]).toBeGreaterThan(pulses[0][0]);
        // Leaf torn off both towers, carried round each in its own hand.
        const origin = world.leaf.geometry.getAttribute('aOrigin');
        const spin = world.leaf.geometry.getAttribute('aSpin');
        let leftTurn = 0;
        let rightTurn = 0;
        let torn = 0;
        for (let i = world.leaf.ambient; i < origin.count; i++) {
            if (origin.getW(i) < t0) continue;
            torn += 1;
            if (origin.getX(i) < 0) leftTurn += spin.getW(i);
            else rightTurn += spin.getW(i);
        }
        expect(torn).toBeGreaterThan(300);
        expect(leftTurn).toBeLessThan(0);
        expect(rightTurn).toBeGreaterThan(0);
        // The towers flare and spin up; a front crosses the water; comets leave both feet.
        expect(world.flare[0]).toBeGreaterThan(0.5);
        expect(world.flare[0]).toBe(world.flare[1]);
        expect(world.spinKick).toBeGreaterThan(1.5);
        expect(world.u.surge.value.y).toBeCloseTo(0.55 + 0.6, 9);
        expect(world.u.surge.value.z).toBe(3);
        const comets = live(world.u.cometA, 0, t0);
        expect(comets).toHaveLength(4);
        expect(comets.reduce((s, c) => s + c[1], 0)).toBeCloseTo(0, 9);
    });

    it('does not strike below four lines, and strikes at four', () => {
        const run = createWorld('High');
        const { world } = run;
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        expect(world.counts.strikes).toBe(0);
        expect(world.u.aurum.value.y).toBe(0);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.counts.strikes).toBe(1);
        expect(world.u.aurum.value.toArray().slice(0, 2)).toEqual([run.time, 1]);
        const other = createWorld('High');
        other.world.onClear({ rows: [19], lines: 1, perfect: true });
        expect(other.world.counts.strikes).toBe(1);
        expect(other.world.u.aurum.value.y).toBeGreaterThan(1);
    });

    it('hushes the hall before the strike, then lets it blaze and settle', () => {
        const run = createWorld('High');
        const { world, scene } = run;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run.step(AURUM.hush * 0.8, 1 / 240);
        expect(world.u.emit.value).toBeLessThan(0.3);
        expect(scene.environmentIntensity).toBeLessThan(0.3);
        run.step(AURUM.hush * 0.4, 1 / 240);
        expect(world.u.emit.value).toBeGreaterThan(1);
        expect(world.overdrive()).toBeGreaterThan(0.9);
        expect(world.u.heat.value).toBeGreaterThan(0.6);
        run.step(1.4);
        // The ring is fully open and the braid is climbing.
        expect(world.open.every((o) => o > 0.8)).toBe(true);
        expect(world.getPostState().rays).toBeGreaterThan(0.02);
        run.step(14);
        expect(world.overdrive()).toBeLessThan(0.02);
        expect(world.u.emit.value).toBeCloseTo(1, 3);
        expect(world.u.heat.value).toBeLessThan(0.02);
        expect(world.open.every((o) => o < 0.05)).toBe(true);
        expect(scene.environmentIntensity).toBeCloseTo(1, 2);
    });

    it('never lets a strike blind the player', () => {
        const run = createWorld('Extreme');
        const { world, scene } = run;
        world.onCombo(12);
        run.step(3);
        world.onClear({
            rows: [19, 18, 17, 16], lines: 4, combo: 12, perfect: true,
        });
        let peakFlash = 0;
        let peakEnv = 0;
        let peakHeat = 0;
        for (let i = 0; i < 240; i++) {
            run.step(1 / 60);
            const post = world.getPostState();
            peakFlash = Math.max(peakFlash, post.flash);
            peakEnv = Math.max(peakEnv, scene.environmentIntensity);
            peakHeat = Math.max(peakHeat, world.u.heat.value);
            expect(post.rays).toBeLessThan(0.4);
            expect(post.bloomBoost).toBeLessThan(0.75);
        }
        expect(peakFlash).toBeLessThan(0.7);
        expect(peakEnv).toBeLessThan(1.5);
        expect(peakHeat).toBeLessThanOrEqual(1.15);
        expect(Math.max(...world.flare)).toBeLessThanOrEqual(1.2);
    });

    it('takes heat from a chain and opens the ring band by band', () => {
        const run = createWorld('High');
        const { world } = run;
        const openBands = () => world.open.filter((o) => o > 0.5).length;
        world.onCombo(1);
        run.step(3);
        expect(world.heat).toBe(0);
        expect(openBands()).toBe(0);
        world.onCombo(2);
        run.step(3);
        expect(world.heat).toBeCloseTo(heatForCombo(2), 2);
        expect(openBands()).toBe(1);
        world.onCombo(4);
        run.step(3);
        expect(openBands()).toBe(2);
        world.onCombo(7);
        run.step(3);
        expect(world.heat).toBeCloseTo(heatForCombo(7), 2);
        expect(openBands()).toBe(3);
        // Hot, everything turns faster.
        const before = world.spin;
        run.step(1);
        expect(world.spin - before).toBeGreaterThan(TOWER_TURN * 2);
        // Open bands leave the ring's plane; closed ones lie in it.
        world.ring.bands.forEach((band) => expect(Math.abs(band.pivot.rotation.x)).toBeGreaterThan(0.1));
    });

    it('strikes the tally at each step of a chain and drops it when the chain breaks', () => {
        const run = createWorld('High');
        const { world } = run;
        world.onCombo(1);
        expect(world.tallyState.count).toBe(0);
        world.onCombo(2);
        expect(world.tallyState).toMatchObject({ count: 2, punch: 1 });
        run.step(1);
        expect(world.tallyState.shown).toBeGreaterThan(0.95);
        expect(world.tallyState.punch).toBeLessThan(0.02);
        world.onCombo(3);
        expect(world.tallyState).toMatchObject({ count: 3, punch: 1 });
        world.onCombo(250);
        expect(world.tallyState.count).toBe(99);
        world.onCombo(0);
        run.step(2);
        expect(world.tallyState.shown).toBeLessThan(0.01);
    });

    it('drains the heat from the top down when the chain breaks', () => {
        const run = createWorld('High');
        const { world } = run;
        world.onCombo(6);
        run.step(3);
        const t0 = run.time;
        world.onCombo(0);
        const [cooling] = live(world.u.pulseA, 1, t0).filter((p) => p[1] === t0);
        expect(cooling[0] * world.place.scaleY).toBeGreaterThan(9);
        run.step(8);
        expect(world.heat).toBeLessThan(0.01);
        expect(world.open.every((o) => o < 0.01)).toBe(true);
        // A chain that never got going has nothing to drain.
        const cold = createWorld('High');
        cold.world.onCombo(1);
        cold.world.onCombo(0);
        expect(live(cold.world.u.pulseA, 1, cold.time)).toHaveLength(0);
    });

    it('turns both towers exactly once on a T-spin', () => {
        const run = createWorld('High', { time: 5 });
        const { world } = run;
        const [, right] = world.towers;
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        run.step(0.45);
        const mid = right.group.rotation.y - world.spin;
        expect(mid).toBeGreaterThan(1);
        expect(mid).toBeLessThan(TAU - 1);
        run.step(1);
        expect(right.group.rotation.y - world.spin).toBeCloseTo(TAU, 9);
        expect(world.towers[0].group.rotation.y).toBeCloseTo(-right.group.rotation.y, 12);
    });

    it('pours the next alloy up the towers on a level-up', () => {
        const run = createWorld('High');
        const { world } = run;
        const { u } = world;
        expect(u.pour.value).toBe(100);
        world.levelUp(2);
        expect(world.level).toBe(2);
        expect(u.alloyA.value.toArray()).toEqual(ALLOYS[1].ribbons[0]);
        expect(u.prevA.value.toArray()).toEqual(ALLOYS[0].ribbons[0]);
        run.step(0.5);
        expect(u.pour.value).toBeGreaterThan(HELIX.bottom);
        expect(u.pour.value).toBeLessThan(HELIX.top);
        const low = u.pour.value;
        run.step(0.5);
        expect(u.pour.value).toBeGreaterThan(low);
        run.step(4);
        expect(u.pour.value).toBe(100);
        // The same level again changes nothing; a silent change is simply there.
        const comets = slots(u.cometA);
        world.levelUp(2);
        expect(slots(u.cometA)).toEqual(comets);
        world.levelUp(4, { silent: true });
        expect(u.prevB.value.toArray()).toEqual(ALLOYS[3].ribbons[1]);
        expect(u.pour.value).toBe(100);
    });

    it('colours an event with the piece, pulled toward the alloy', () => {
        const { world } = createWorld('Low');
        const amber = world.eventColor('#FFAC33');
        const teal = world.eventColor('#00FFCC');
        // Whatever lands in the hall comes out warmer than it went in.
        expect(teal[0]).toBeGreaterThan(0.3);
        expect(amber[0]).toBeGreaterThan(amber[2] * 3);
        expect(world.eventColor(null)).toEqual([1.0, 0.72, 0.3]);
    });

    it('writes into fixed rings of slots however hard it is driven', () => {
        const run = createWorld('Medium');
        const { world } = run;
        const attributes = () => ['leaf', 'sparks', 'flares'].flatMap(
            (name) => Object.values(world[name].geometry.attributes),
        );
        const before = attributes();
        const children = world.root.children.length;
        for (let i = 0; i < 400; i++) {
            world.onLock({ rows: [i % 20], u: (i % 10) / 9, hardDrop: i % 3 === 0 });
            world.onClear({ rows: [19, 18, 17, 16].slice(0, 1 + (i % 4)), lines: 1 + (i % 4), combo: 1 + (i % 9) });
            world.onCombo(i % 9);
            if (i % 5 === 0) run.step(1 / 30, 1 / 30);
        }
        expect(attributes()).toEqual(before);
        expect(world.root.children.length).toBe(children);
        expect(world.u.pulseA).toHaveLength(PULSE_SLOTS);
        expect(world.u.rippleA).toHaveLength(RIPPLE_SLOTS);
        expect(world.u.cometA).toHaveLength(COMET_SLOTS);
        const finite = (attribute) => Array.from(attribute.array).every(Number.isFinite);
        attributes().forEach((attribute) => expect(finite(attribute)).toBe(true));
    });

    it('comes back to the same hall at 30 and at 240 frames a second', () => {
        const play = (dt) => {
            const run = createWorld('Low', { time: 40 });
            const { world } = run;
            world.onLock({ rows: [15], u: 0.3, hardDrop: true });
            run.step(0.5, dt);
            world.onClear({ rows: [19, 18], lines: 2, combo: 1 });
            world.onCombo(1);
            run.step(0.5, dt);
            world.onClear({ rows: [19], lines: 1, combo: 2 });
            world.onCombo(2);
            run.step(0.5, dt);
            world.onClear({ rows: [19, 18, 17, 16], lines: 4, combo: 3 });
            world.onCombo(3);
            run.step(2.5, dt);
            return world.getState();
        };
        const slow = play(1 / 30);
        const fast = play(1 / 240);
        expect(slow.time).toBeCloseTo(fast.time, 9);
        expect(slow.heat).toBeCloseTo(fast.heat, 1);
        expect(slow.emit).toBeCloseTo(fast.emit, 3);
        expect(slow.flare[0]).toBeCloseTo(fast.flare[0], 2);
        expect(slow.spinKick).toBeCloseTo(fast.spinKick, 2);
        expect(Math.abs(slow.spin - fast.spin)).toBeLessThan(0.12);
        slow.open.forEach((o, i) => expect(o).toBeCloseTo(fast.open[i], 1));
    });

    it('goes back to rest for a new run', () => {
        const run = createWorld('High');
        const { world } = run;
        world.onLock({ rows: [10], u: 0.5 });
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, combo: 5 });
        world.onCombo(5);
        world.levelUp(3);
        run.step(1);
        world.resetSession();
        run.step(0.01);
        expect(world.getState()).toMatchObject({
            combo: 0, heat: 0, emit: 1, level: 1, flare: [0, 0], spinKick: 0, open: [0, 0, 0],
        });
        expect(live(world.u.pulseA, 1, run.time)).toHaveLength(0);
        expect(live(world.u.rippleA, 2, run.time)).toHaveLength(0);
        expect(live(world.u.cometA, 0, run.time)).toHaveLength(0);
        expect(world.u.aurum.value.y).toBe(0);
        expect(world.u.alloyA.value.toArray()).toEqual(ALLOYS[0].ribbons[0]);
        // The flakes that drift for ever are still drifting.
        const life = world.leaf.geometry.getAttribute('aVel');
        expect(life.getW(0)).toBeLessThan(0);
        expect(life.getW(world.leaf.ambient)).toBeGreaterThan(0);
    });
});

describe('Chiral Gold world: the frame', () => {
    it('widens the lens as the frame narrows, within reason', () => {
        expect(fovForAspect(16 / 9)).toBe(STAGE.camera.fov);
        expect(fovForAspect(21 / 9)).toBe(STAGE.camera.fov);
        expect(fovForAspect(4 / 3)).toBeGreaterThan(STAGE.camera.fov);
        expect(fovForAspect(9 / 19.5)).toBe(60);
        expect(fovForAspect(0)).toBe(60);
    });

    it('stands the towers clear of the card and inside the frame at every shape', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [1280, 1024], [1024, 768], [430, 932], [360, 640]]) {
            const { world } = createWorld('Low', { width, height });
            const layout = fallbackLayout(width, height);
            const [card] = layout.cards;
            const halfW = world.halfWidth();
            const axis = world.place.helixX / halfW; // NDC
            const half = (HELIX.radius * 1.4 * world.place.scale) / halfW; // to the ribbons' edge
            const cardEdge = (card.x1 - 0.5) * 2;
            expect(axis - half, `${width}x${height} inner`).toBeGreaterThan(cardEdge - 0.02);
            expect(axis, `${width}x${height} axis`).toBeLessThan(0.9);
            expect(world.place.scale).toBeGreaterThanOrEqual(0.3);
            expect(world.place.scale).toBeLessThanOrEqual(1.04);
            // Squeezed, a tower grows slender rather than short: it still fills the frame's height.
            expect(world.place.scaleY).toBeGreaterThanOrEqual(0.8);
            const frameTop = STAGE.camera.y + STAGE.camera.z * Math.tan((world.fov * Math.PI) / 360);
            expect(HELIX.top * world.place.scaleY).toBeGreaterThan(frameTop * 0.9);
            // And every row of the board lands on the part of it that is in the frame and out of the water.
            const top = world.strikeHeight(layout.boards[0].y0, layout.boards[0]);
            const floor = world.strikeHeight(layout.boards[0].y1, layout.boards[0]);
            expect(floor).toBeGreaterThan(0.5);
            expect(top).toBeGreaterThan(floor + 4);
            expect(top).toBeLessThan(frameTop);
            expect(world.ringScale()).toBeGreaterThanOrEqual(0.35);
        }
    });

    it('moves the towers out when more boards come on screen, easing rather than jumping', () => {
        const run = createWorld('Low');
        const { world } = run;
        const solo = world.place.helixX;
        world.setLayout({
            cardCount: 2,
            cards: [{
                x0: 0.14, y0: 0.1, x1: 0.46, y1: 0.9,
            }, {
                x0: 0.54, y0: 0.1, x1: 0.86, y1: 0.9,
            }],
            hud: null,
            boards: [null, {
                x0: 0.18, y0: 0.2, x1: 0.42, y1: 0.86,
            }, {
                x0: 0.58, y0: 0.2, x1: 0.82, y1: 0.86,
            }, null, null],
        });
        expect(world.place.helixX).toBe(solo);
        run.step(0.1);
        expect(world.place.helixX).toBeGreaterThan(solo);
        expect(world.place.helixX).toBeLessThan(world.place.targetX);
        run.step(3);
        expect(world.place.helixX).toBeCloseTo(world.place.targetX, 2);
        expect(world.place.scale).toBeLessThan(0.7);
        // Each board's lock lands under its own board.
        const t0 = run.time;
        world.onLock({ player: 1, rows: [10], u: 0.5 });
        world.onLock({ player: 2, rows: [10], u: 0.5 });
        const rings = live(world.u.rippleA, 2, t0);
        expect(rings).toHaveLength(2);
        expect(rings[0][0]).toBeLessThan(-1);
        expect(rings[1][0]).toBeGreaterThan(1);
    });

    it('aims through the bound camera: the middle of the frame is the middle of the hall', () => {
        const created = createWorld('Low');
        const { world, camera } = created;
        const centre = world.worldAtDepth(0.5, 0.5, 0);
        // The camera looks a quarter of its own drift off the hall's axis.
        expect(centre.x).toBeCloseTo(camera.position.x * 0.25, 6);
        expect(centre.y).toBeCloseTo(STAGE.camera.y + 0.2, 0);
        expect(world.waterAt(0.5, 0.1)).toBeNull(); // above the horizon
        const foot = world.waterAt(0.5, 0.92);
        expect(foot.y).toBeCloseTo(0, 6);
        expect(foot.z).toBeGreaterThan(0);
        expect(foot.z).toBeLessThan(STAGE.camera.z);
        expect(world.screenXOf(0)).toBe(0.5);
        expect(world.screenXOf(world.halfWidth())).toBeCloseTo(1, 12);
        // There and back again.
        const back = world.screenOf(foot.x, foot.y, foot.z, {});
        expect(back.x).toBeCloseTo(0.5, 6);
        expect(back.y).toBeCloseTo(0.92, 6);
    });

    it('stills the camera and spares the hush for reduced motion', () => {
        const calm = createWorld('Low');
        calm.world.setReducedMotion(true);
        calm.world.onLock({ rows: [12], u: 0.4, hardDrop: true });
        calm.world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(calm.world.dip).toBe(0);
        expect(calm.world.dolly).toBe(0);
        let lowest = 1;
        for (let i = 0; i < 30; i++) {
            calm.step(1 / 60);
            lowest = Math.min(lowest, calm.world.u.emit.value);
            const post = calm.world.getPostState();
            expect(post.flash).toBeLessThanOrEqual(0.15);
            expect(post.kick).toBe(0);
        }
        expect(lowest).toBe(1);
        expect(calm.camera.position.z).toBeCloseTo(STAGE.camera.z, 0);
    });

    it('listens to the music only outside captures', () => {
        const { world } = createWorld('Low');
        world.setAudio(0.8, 0.5, 0.3, 1);
        expect(world.u.audio.value.toArray()).toEqual([0, 0, 0, 0]);
        const scene = new THREE.Scene();
        const liveWorld = new ChiralGoldWorld({ scene, quality: 'Minimal' }).build();
        worlds.push(liveWorld);
        liveWorld.setAudio(0.8, 5, -2, NaN);
        expect(liveWorld.u.audio.value.toArray()).toEqual([0.8, 1, 0, 0]);
    });

    it('draws only the parts it is asked for', () => {
        const { world } = createWorld('High');
        world.showOnlyParts(['towers', 'water']);
        expect(world.groups.towers.every((g) => g.visible)).toBe(true);
        expect(world.groups.water[0].visible).toBe(true);
        expect(world.groups.ring[0].visible).toBe(false);
        expect(world.groups.motes[0].visible).toBe(false);
    });

    it('gives the scene back as it found it', () => {
        const scene = new THREE.Scene();
        const borrowed = new THREE.Texture();
        scene.environment = borrowed;
        scene.environmentIntensity = 0.4;
        const world = new ChiralGoldWorld({ scene, quality: 'High', capture: true }).build();
        const disposed = [];
        world.parts.forEach((part) => {
            if (part.geometry) part.geometry.addEventListener('dispose', () => disposed.push(part.geometry));
            part.material.addEventListener('dispose', () => disposed.push(part.material));
        });
        const count = world.parts.reduce((n, part) => n + (part.geometry ? 2 : 1), 0);
        expect(scene.children).toContain(world.root);
        world.dispose();
        world.dispose();
        expect(scene.children).not.toContain(world.root);
        expect(scene.environment).toBe(borrowed);
        expect(scene.environmentIntensity).toBe(0.4);
        expect(scene.environmentRotation.y).toBe(0);
        expect(disposed).toHaveLength(count);
        expect(new Set(disposed).size).toBe(count);
    });
});

describe('Chiral Gold effects', () => {
    it('raises the braid out of the water and brings it back down as rain', () => {
        expect(braidHeight(0)).toBeCloseTo(0.15, 6);
        expect(braidHeight(-1)).toBeCloseTo(0.15, 6);
        const top = braidHeight(BRAID.climb);
        expect(top).toBeGreaterThan(6);
        // Inside the frame at the towers' plane, so the rain is seen falling.
        expect(top).toBeLessThan(STAGE.camera.y + STAGE.camera.z * Math.tan((STAGE.camera.fov * Math.PI) / 360) + 1.5);
        let peak = 0;
        let last = braidHeight(0);
        let fell = false;
        for (let t = 0.1; t < 11; t += 0.1) {
            const y = braidHeight(t);
            peak = Math.max(peak, y);
            if (y < last - 1e-6) fell = true;
            else expect(fell, `rose again at ${t}`).toBe(false);
            last = y;
        }
        expect(peak).toBeLessThan(BRAID.height + 0.2);
        expect(braidHeight(8)).toBeLessThan(2);
    });

    it('has no tally to draw where there is no canvas', () => {
        expect(bakeTallyAtlas(undefined)).toBeNull();
        expect(bakeTallyAtlas({ createElement: () => ({}) })).toBeNull();
        const { world } = createWorld('Low');
        expect(world.tally).toBeNull();
        expect(() => world.onCombo(3)).not.toThrow();
    });

    it('bakes the tally from the page canvas: coverage only, right way up', () => {
        const fills = [];
        const canvas = {
            getContext: () => ({
                clearRect() {},
                fillText: (text, x, y) => fills.push([text, x, y]),
                getImageData: (_x, _y, w, h) => {
                    const data = new Uint8ClampedArray(w * h * 4);
                    // Ink on the top row only.
                    for (let x = 0; x < w; x++) data[x * 4 + 3] = 200;
                    return { data };
                },
            }),
        };
        const atlas = bakeTallyAtlas({ createElement: () => canvas });
        expect(fills.map((f) => f[0])).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '×']);
        const { width, height, data } = atlas.image;
        expect(width).toBe(canvas.width);
        expect(height).toBe(canvas.height);
        // The canvas's top row is the texture's last row.
        expect(data[(height - 1) * width * 4]).toBe(200);
        expect(data[0]).toBe(0);
        expect(data[3]).toBe(255);
        atlas.dispose();
    });
});
