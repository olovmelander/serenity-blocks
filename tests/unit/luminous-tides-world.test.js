/**
 * Luminous Tides — the world, built for real in Node (no renderer): what the board does to it,
 * where things land on screen, how the night turns, and the meshes it builds in code.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FALL_SECONDS, LUMINOUS_TIDES_PARTS, LuminousTidesWorld, SPARE_SPLASHES, rainForCombo,
} from '../../src/themes/luminous-tides/luminous-tides-world.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/luminous-tides/luminous-tides-quality.js';
import { fallbackLayout } from '../../src/themes/luminous-tides/luminous-tides-composition.js';
import {
    NIGHT_SECONDS, runup, SURF, toShore,
} from '../../src/themes/luminous-tides/luminous-tides-core.js';
import { buildShoreFan, fanRadius } from '../../src/themes/luminous-tides/luminous-tides-shore.js';
import { aimLanding, frameFor } from '../../src/themes/luminous-tides/luminous-tides-frame.js';

const W = 1600;
const H = 900;

function makeWorld(options = {}) {
    const scene = new THREE.Scene();
    const world = new LuminousTidesWorld({ scene, quality: 'Low', ...options }).build();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 30000);
    world.bindCamera(camera);
    const layout = options.noBoard ? null : fallbackLayout(W, H);
    world.setLayout(layout, W / H);
    world.setViewport(W, H, W / H);
    world.seek(options.start ?? 10);
    let t = world.clock;
    const step = (seconds, dt = 1 / 30) => {
        const n = Math.round(seconds / dt);
        for (let i = 0; i < n; i += 1) {
            t += dt;
            const sim = {
                time: t, delta: dt, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
    };
    step(0.5);
    return {
        world, camera, scene, layout, step,
    };
}

const onScreen = (camera, p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, z: v.z };
};
const inside = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

describe('luminous tides world: building', () => {
    it('builds every tier with every part, and draws only the parts asked for', () => {
        QUALITY_NAMES.forEach((quality) => {
            const { world, scene } = makeWorld({ quality });
            expect(Object.keys(world.parts).sort()).toEqual([...LUMINOUS_TIDES_PARTS].sort());
            world.showOnlyParts(['sky', 'shore']);
            expect(world.parts.land.mesh.visible).toBe(false);
            expect(world.parts.shore.mesh.visible).toBe(true);
            world.dispose();
            world.dispose();
            expect(scene.children).toHaveLength(0);
        });
    });

    it('builds a shore fan that faces up and widens ring by ring', () => {
        const fan = buildShoreFan(12, 9);
        const p = fan.positions;
        let up = 0;
        for (let i = 0; i < fan.indices.length; i += 3) {
            const corner = (k) => new THREE.Vector3(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
            const [a, b, c] = [fan.indices[i], fan.indices[i + 1], fan.indices[i + 2]].map(corner);
            up += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).y;
        }
        expect(up).toBeGreaterThan(0);
        for (let i = 1; i < 20; i += 1) expect(fanRadius(i, 20)).toBeGreaterThan(fanRadius(i - 1, 20));
    });

    it('never grows the scene after build, whatever the board does', () => {
        const { world, scene, step } = makeWorld();
        const count = () => {
            let n = 0;
            scene.traverse(() => { n += 1; });
            return n;
        };
        const before = count();
        world.onLock({ rows: [18, 17], u: 0.2, color: '#FF7F95' });
        world.onLock({
            rows: [6, 5], u: 0.85, color: '#45DCF7', hardDrop: true,
        });
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        world.onCombo(6);
        world.levelUp(3);
        step(3);
        expect(count()).toBe(before);
    });
});

describe('luminous tides world: the board', () => {
    it('drops a lock into the water or the wet sand beside the card, after its fall', () => {
        const {
            world, camera, layout, step,
        } = makeWorld();
        const card = layout.cards[0];
        [[0.1, 18], [0.3, 4], [0.7, 15], [0.95, 2]].forEach(([u, row]) => {
            world.onLock({ rows: [row], u, color: '#FFB23E' });
            const sp = world.splashes[world.splashes.length - 1];
            expect(sp.t0).toBeCloseTo(world.clock + FALL_SECONDS, 6);
            const where = toShore(sp.x, sp.z);
            expect(where.s).toBeGreaterThan(-runup(SURF.height));
            const seen = onScreen(camera, sp);
            expect(seen.z).toBeLessThan(1);
            expect(inside(card, seen)).toBe(false);
        });
        step(FALL_SECONDS + 0.2);
        expect(world.getState().drops).toBeGreaterThan(0);
        expect(world.getState().splashes).toBeGreaterThan(0);
    });

    it('lands a hard drop harder and keeps the splash table within its tier', () => {
        const { world, step } = makeWorld();
        world.onLock({ rows: [18], u: 0.2, color: '#FFB23E' });
        world.onLock({
            rows: [18], u: 0.2, color: '#FFB23E', hardDrop: true,
        });
        const [soft, hard] = world.splashes.slice(-2);
        expect(hard.strength).toBeGreaterThan(soft.strength);
        expect(hard.radius).toBeGreaterThan(soft.radius);
        for (let i = 0; i < 60; i += 1) world.onLock({ rows: [i % 20], u: (i * 0.37) % 1, color: '#45DCF7' });
        step(0.6);
        // The tier's splashes are lit; a few more rows hold the ones fading out to make room.
        const lit = world.splashes.filter((sp) => sp.retireAt === Infinity);
        expect(lit.length).toBeLessThanOrEqual(tierFor('Low').splashes);
        expect(world.splashes.length).toBeLessThanOrEqual(tierFor('Low').splashes + SPARE_SPLASHES);
        expect(world.getState().splashes).toBeLessThanOrEqual(tierFor('Low').splashes + SPARE_SPLASHES);
    });

    it('throws a wave of light for each line, one great one for four, and sends a shoal on a T-spin', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        expect(world.breakers).toHaveLength(3);
        world.resetSession();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.breakers).toHaveLength(1);
        expect(world.breakers[0].H).toBeGreaterThan(1.2);
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        step(1);
        expect(world.getState().shoal).toBe(true);
        expect(world.getState().waves).toBeGreaterThan(0);
    });

    it('lights the whole bay on a perfect clear, and lets it fade', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        step(0.5);
        const lit = world.getState().bloom;
        expect(lit).toBeGreaterThan(0.8);
        step(15);
        expect(world.getState().bloom).toBeLessThan(lit * 0.1);
    });

    it('brings rain with a chain, harder the longer it is, and lets it ease off when the chain breaks', () => {
        expect(rainForCombo(1)).toBe(0);
        expect(rainForCombo(2)).toBeGreaterThan(0);
        expect(rainForCombo(5)).toBeGreaterThan(rainForCombo(3));
        expect(rainForCombo(40)).toBeLessThanOrEqual(1);
        const { world, step } = makeWorld();
        world.onCombo(6);
        step(6);
        const wet = world.getState().rain;
        expect(wet).toBeGreaterThan(0.5);
        world.onCombo(0);
        step(20);
        expect(world.getState().rain).toBeLessThan(0.05);
    });
});

describe('luminous tides world: the build', () => {
    /** Strength each wave was last drawn with, to catch one vanishing while it still had light. */
    const drawn = (world) => new Map(world.breakers.map((b) => [b, b.strength * b.fade]));
    const vanished = (world, before) => {
        const now = new Set(world.breakers);
        const lost = [];
        before.forEach((light, b) => {
            if (!now.has(b) && light > 0.05 * b.strength && world.clock - b.t0 < b.life - 0.1) lost.push(light);
        });
        return lost;
    };

    it('never drops a lit wave for a new one, and never a great set wave mid-run', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const great = world.breakers[0];
        expect(great.great).toBe(true);
        let before = drawn(world);
        // Doubles 0.4 s apart for eight seconds: far more waves than the table holds.
        for (let k = 0; k < 20; k += 1) {
            world.onClear({ rows: [19, 18], lines: 2, combo: k + 2 });
            for (let f = 0; f < 12; f += 1) {
                step(1 / 30);
                expect(vanished(world, before)).toEqual([]);
                before = drawn(world);
            }
            const lit = world.breakers.filter((b) => b.retireAt === Infinity);
            expect(lit.length).toBeLessThanOrEqual(tierFor('Low').breakers);
        }
        expect(world.breakers).toContain(great);
        expect(great.fade).toBe(1);
    });

    it('lets a weak clear after a strong one only add light', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(0.3);
        const great = world.breakers[0];
        const { flash } = world.getPostState();
        const lift = great.strength;
        world.onClear({ rows: [19], lines: 1 });
        step(1 / 30);
        expect(world.getPostState().flash).toBeGreaterThan(flash * Math.exp(-3.5 / 30) * 0.99);
        expect(great.strength).toBeGreaterThanOrEqual(lift);
        expect(world.breakers).toContain(great);
    });

    it('crowns the running great wave with a late perfect clear instead of throwing a second', () => {
        const { world, step } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(0.36);
        const great = world.breakers.filter((b) => b.great);
        expect(great).toHaveLength(1);
        const { Hto, strength } = great[0];
        const { thrown } = world.getState();
        world.onPerfect({ player: 0 });
        step(1);
        expect(world.breakers.filter((b) => b.great)).toHaveLength(1);
        expect(world.getState().thrown).toBe(thrown);
        expect(great[0].Hto).toBeGreaterThan(Hto);
        expect(great[0].strength).toBeGreaterThan(strength);
        expect(world.getState().bloom).toBeGreaterThan(0.75);
    });

    it('feeds the next wave of a cascade into the one still coming in, taller and brighter', () => {
        const { world, step } = makeWorld();
        world.onClear({
            rows: [19, 18], lines: 2, cascade: 1, combo: 1,
        });
        const first = world.breakers.length;
        step(0.36);
        const host = world.breakers[world.breakers.length - 1];
        const { Hto, strength } = host;
        world.onClear({
            rows: [19], lines: 1, cascade: 2, combo: 1,
        });
        expect(world.breakers).toHaveLength(first);
        expect(host.Hto).toBeGreaterThan(Hto);
        expect(host.strength).toBeGreaterThan(strength);
        // The next wave of the cascade is thrown, and bigger than the first was.
        step(0.36);
        world.onClear({
            rows: [19, 18], lines: 2, cascade: 3, combo: 1,
        });
        const deep = world.breakers[world.breakers.length - 2];
        expect(deep.H).toBeGreaterThan(world.breakers[0].H);
        expect(deep.strength).toBeGreaterThan(world.breakers[0].strength);
    });

    it('burns hotter through a long chain than at its first clear, and breathes back after rest', () => {
        const { world, step } = makeWorld();
        const read = () => ({
            stir: world.U.stir.value,
            bay: world.U.bayBloom.value,
            boost: world.getPostState().bloomBoost - world.state.rain * 0.15,
            power: world.U.glowPower.value / world.light.glowPower,
            stars: world.U.stars.value,
        });
        const calm = read();
        world.onLock({ rows: [19], u: 0.5, hardDrop: true });
        world.onClear({ rows: [19], lines: 1, combo: 1 });
        world.onCombo(1);
        step(0.64);
        const first = read();
        for (let k = 2; k <= 12; k += 1) {
            world.onLock({ rows: [19], u: 0.5, hardDrop: true });
            world.onClear({
                rows: [19, 18], lines: k % 4 === 0 ? 3 : 2, combo: k, tspin: k === 8,
            });
            world.onCombo(k);
            step(0.64);
        }
        const hot = read();
        expect(world.heat.fever).toBeGreaterThan(0.3);
        expect(hot.stir).toBeGreaterThan(first.stir + 0.4);
        expect(hot.boost).toBeGreaterThan(first.boost + 0.03);
        expect(hot.power).toBeGreaterThan(first.power);
        // The rain of a hot chain no longer dims the stars as a cold squall would.
        const cold = world.light.stars * (1 - world.state.rain * 0.8);
        expect(hot.stars).toBeGreaterThan(cold);
        // Hands at rest: the sea breathes back to calm.
        world.onCombo(0);
        step(20);
        const rest = read();
        expect(rest.stir).toBeLessThan(0.02);
        expect(rest.bay).toBeLessThan(calm.bay + 0.03);
        expect(rest.boost).toBeLessThan(calm.boost + 0.02);
        expect(rest.power).toBeCloseTo(1, 2);
    });

    it('sends a small school for a T-spin with no lines, and more fish after a running school', () => {
        const { world, step } = makeWorld();
        world.onSpin({ player: 0 });
        step(0.5);
        expect(world.getState().shoal).toBe(true);
        const small = world.getState().fish;
        expect(small).toBeGreaterThan(0);
        expect(small).toBeLessThan(tierFor('Low').fish);
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        const [a, b] = world.schools;
        const set = [a.at, b.at];
        // Both schools are running: a third T-spin adds fish to the youngest, restarting neither.
        world.onSpin({ player: 0 });
        expect([a.at, b.at]).toEqual(set);
        expect(world.getState().fish).toBeGreaterThan(small + tierFor('Low').fish);
        step(6);
        expect(world.getState().shoal).toBe(false);
    });
});

describe('luminous tides world: the night', () => {
    it('turns the night by the clock alone, with no gameplay at level one', () => {
        const { world, step } = makeWorld({ start: 0 });
        const w0 = world.wheel();
        step(60);
        expect(world.wheel() - w0).toBeCloseTo(60 / NIGHT_SECONDS, 2);
        expect(world.getState().level).toBe(1);
    });

    it('turns one night further for a level, forward only, from where the last turn was headed', () => {
        const { world, step } = makeWorld({ start: 0 });
        const before = world.wheelTarget();
        world.levelUp(2);
        expect(world.wheelTarget()).toBe(before + 1);
        world.levelUp(4);
        expect(world.wheelTarget()).toBe(before + 3);
        world.levelUp(3);
        expect(world.wheelTarget()).toBe(before + 3);
        step(6);
        // A new run keeps the night where it is.
        const held = world.wheel();
        world.resetSession();
        expect(world.wheel()).toBeCloseTo(held, 6);
        world.levelUp(2);
        expect(world.wheelTarget()).toBe(before + 4);
    });

    it('stands on a level at once when told it simply is that level, and hands its night over on a rebuild', () => {
        const { world } = makeWorld({ start: 0 });
        world.levelUp(4, { silent: true });
        expect(world.wheelTarget()).toBe(3);
        const carried = world.wheelTarget();
        const { world: next } = makeWorld({ start: 0 });
        next.restoreWheel(carried);
        expect(next.wheel()).toBeCloseTo(world.wheel(), 6);
    });
});

describe('luminous tides world: determinism and the frame', () => {
    it('replays the same frame from the same seek and steps', () => {
        const a = makeWorld();
        const b = makeWorld();
        [a, b].forEach(({ world, step }) => {
            world.onLock({ rows: [12], u: 0.2, color: '#FF7F95' });
            world.onClear({ rows: [19, 18], lines: 2 });
            world.onCombo(4);
            step(2.5);
        });
        const sa = a.world.getState();
        const sb = b.world.getState();
        expect(sb).toEqual(sa);
        expect(Array.from(b.world.drops)).toEqual(Array.from(a.world.drops));
    });

    it('hands the post one reused state object', () => {
        const { world } = makeWorld();
        expect(world.getPostState()).toBe(world.getPostState());
    });

    it('lifts the horizon on a tall screen and aims drops beside the card on both sides', () => {
        expect(frameFor(0.46, null).horizon).toBeLessThan(frameFor(16 / 9, null).horizon);
        const layout = fallbackLayout(W, H);
        const card = layout.cards[0];
        const left = aimLanding(layout, card, { x: 0.5, y: 0.5 }, 0.1, 18, 0.4);
        const right = aimLanding(layout, card, { x: 0.5, y: 0.5 }, 0.9, 18, 0.4);
        expect(left.x).toBeLessThan(card.x0);
        expect(right.x).toBeGreaterThan(card.x1);
        const high = aimLanding(layout, card, { x: 0.5, y: 0.5 }, 0.1, 2, 0.4);
        expect(high.y).toBeLessThan(left.y);
    });
});

describe('luminous tides world: uploads', () => {
    it('sends only the lights it draws each frame, not the whole pool', () => {
        const { world, step } = makeWorld();
        step(0.2);
        const { glows } = world.parts;
        const mesh = glows.mesh ?? glows;
        expect(mesh.count).toBeGreaterThan(0);
        expect(mesh.count).toBeLessThan(glows.capacity ?? mesh.instanceMatrix.count);
        for (const name of Object.keys(mesh.geometry.attributes).filter((key) => mesh.geometry.attributes[key].isInstancedBufferAttribute)) {
            const ranges = mesh.geometry.attributes[name].updateRanges.map(({ start, count }) => [start, count]);
            expect(ranges, name).toEqual([[0, mesh.count * 4]]);
        }
        world.dispose();
    });
});
