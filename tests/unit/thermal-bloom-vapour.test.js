/**
 * Thermal Bloom — the vapour (the ray-marched steam bodies), the bursts (the events' drops) and the
 * event steam they carry: the boil-overs of the locks, the chain's ladder of vents, the Seal's
 * curtains and the Chalice's eruptions. A real ThermalBloomWorld in a THREE.Scene, no renderer.
 *
 * Relations, never tuning numbers: bodies are counted, ordered, bounded; packing round-trips.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, ThermalBloomWorld, fovForAspect } from '../../src/themes/thermal-bloom/thermal-bloom-world.js';
import {
    BURST_CODE, BURST_KIND, BURST_SLOTS, VAPOUR_KIND, VAPOUR_ROWS_PER, VAPOUR_SLOTS, vapourCode, vapourDecode,
} from '../../src/themes/thermal-bloom/thermal-bloom-core.js';
import { bakeVapourNoise } from '../../src/themes/thermal-bloom/thermal-bloom-bake.js';
import { burstCode } from '../../src/themes/thermal-bloom/thermal-bloom-bursts.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';

function makeWorld(quality = 'Minimal', { width = 1600, height = 900, at = 10 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new ThermalBloomWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(at);
    const sim = {
        time: at, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
    return { world, camera };
}

function run(world, camera, seconds, dt = 1 / 10) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
        const sim = {
            time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

const lock = (world, extra = {}) => world.onLock({
    player: 0,
    rows: [12, 11],
    u: 0.3,
    hardDrop: false,
    distance: 0,
    color: '#BD3B1A',
    shape: 'L',
    cells: null,
    screen: null,
    ...extra,
});

/** The bodies the march reads this frame, decoded. */
function bodies(world) {
    const rows = world.u.tables.vapour;
    const out = [];
    for (let i = 0; i < world.u.vapourCount.value; i++) {
        const A = rows[i * VAPOUR_ROWS_PER];
        const B = rows[i * VAPOUR_ROWS_PER + 1];
        const C = rows[i * VAPOUR_ROWS_PER + 2];
        out.push({
            x: A.x,
            y: A.y,
            z: A.z,
            h: A.w,
            r0: B.x,
            r1: B.y,
            density: B.z,
            under: [C.x, C.y, C.z],
            ...vapourDecode(C.w),
        });
    }
    return out;
}

const distance = (world, b) => {
    const c = world.u.camPos.value;
    return Math.hypot(b.x - c.x, b.y + b.h / 2 - c.y, b.z - c.z) - Math.max(b.r0, b.r1) / 2;
};

describe('Thermal Bloom vapour: packing and the noise volume', () => {
    it('packs a body’s kind and seed into one code and back', () => {
        Object.values(VAPOUR_KIND).forEach((kind) => {
            [0, 1, 17, 63].forEach((seed) => {
                expect(vapourDecode(vapourCode(kind, seed))).toEqual({ kind, seed });
            });
        });
        // Out-of-range seeds are clamped, never wrapped into another kind.
        expect(vapourDecode(vapourCode(VAPOUR_KIND.puff, 999)).kind).toBe(VAPOUR_KIND.puff);
    });

    it('packs a burst’s kind, scale and life within a float’s exact range', () => {
        const code = burstCode(BURST_KIND.fountain, 7.3, 120);
        expect(code).toBeLessThan(2 ** 24);
        const life = Math.floor(code / BURST_CODE.life);
        const rest = code - life * BURST_CODE.life;
        const scale = Math.floor(rest / BURST_CODE.scale);
        expect(life).toBe(120);
        expect(scale).toBe(73);
        expect(rest - scale * BURST_CODE.scale).toBe(BURST_KIND.fountain);
    });

    it('bakes a tileable, deterministic noise volume with every channel spread over its range', () => {
        const a = bakeVapourNoise(16, 7);
        const b = bakeVapourNoise(16, 7);
        expect(a.data).toEqual(b.data);
        expect(a.data.length).toBe(16 ** 3 * 4);
        for (let c = 0; c < 4; c++) {
            let lo = 255;
            let hi = 0;
            let sum = 0;
            for (let i = c; i < a.data.length; i += 4) {
                lo = Math.min(lo, a.data[i]);
                hi = Math.max(hi, a.data[i]);
                sum += a.data[i];
            }
            const mean = sum / (a.data.length / 4);
            expect(hi - lo, `channel ${c} spans its range`).toBeGreaterThan(200);
            expect(mean).toBeGreaterThan(60);
            expect(mean).toBeLessThan(195);
        }
        expect(bakeVapourNoise(16, 8).data).not.toEqual(a.data);
    });
});

describe('Thermal Bloom vapour: the bodies the world writes', () => {
    it('stands the Iris’s dome and the Chalice’s thread at rest, near to far, within the slots', () => {
        const { world } = makeWorld();
        const list = bodies(world);
        expect(list.length).toBeGreaterThanOrEqual(2);
        expect(list.length).toBeLessThanOrEqual(VAPOUR_SLOTS);
        expect(list.some((b) => b.kind === VAPOUR_KIND.dome)).toBe(true);
        expect(list.some((b) => b.kind === VAPOUR_KIND.plume)).toBe(true);
        for (let i = 1; i < list.length; i++) {
            expect(distance(world, list[i])).toBeGreaterThanOrEqual(distance(world, list[i - 1]) - 1e-6);
        }
        list.forEach((b) => {
            expect(b.h).toBeGreaterThan(0);
            expect(b.density).toBeGreaterThan(0);
            expect(Number.isFinite(b.x + b.y + b.z + b.r0 + b.r1)).toBe(true);
        });
    });

    it('raises steam lit in the piece’s colour off each lock, gone once its spring has cooled', () => {
        const { world, camera } = makeWorld();
        const before = bodies(world).length;
        lock(world);
        run(world, camera, 0.8);
        // L is rust: the light from below is warmest in red.
        const lit = bodies(world).filter((b) => b.under[0] > 0 && b.under[0] > b.under[1] && b.under[0] > b.under[2]);
        expect(lit.length).toBeGreaterThan(0);
        expect(bodies(world).length).toBeGreaterThan(before);
        run(world, camera, 40);
        expect(bodies(world).filter((b) => b.under[0] > 0 && b.under[0] > b.under[1] * 2)).toHaveLength(0);
    });

    it('throws a splash of drops for a lock, a jet as well for a hard drop', () => {
        const { world, camera } = makeWorld();
        lock(world);
        run(world, camera, 0.3);
        expect(world.u.burstCount.value).toBe(1);
        lock(world, { hardDrop: true, distance: 16 });
        run(world, camera, 0.3);
        expect(world.u.burstCount.value).toBe(3);
        expect(world.u.burstCount.value).toBeLessThanOrEqual(BURST_SLOTS);
    });

    it('opens a vent a link up the card, lit by the chain’s heat, and blows them out on the break', () => {
        const { world, camera } = makeWorld();
        for (let n = 2; n <= 6; n++) {
            world.onCombo(n);
            run(world, camera, 1);
        }
        expect(world.ladder).toHaveLength(5);
        const rows = new Set(world.ladder.map((v) => v.row));
        expect(rows.size).toBe(5);
        const sides = new Set(world.ladder.map((v) => v.side));
        expect(sides.size).toBe(2);
        const plumes = bodies(world).filter((b) => b.kind === VAPOUR_KIND.plume);
        expect(plumes.length).toBeGreaterThanOrEqual(5);
        // The heat climbs from turquoise toward white-hot.
        const cool = ThermalBloomWorld.heatColour(2);
        const hot = ThermalBloomWorld.heatColour(9);
        expect(cool[2]).toBeGreaterThan(cool[0]);
        expect(hot[0]).toBeGreaterThan(hot[2]);
        expect(hot[0] + hot[1] + hot[2]).toBeGreaterThan(cool[0] + cool[1] + cool[2]);
        world.onCombo(0);
        run(world, camera, 1);
        expect(bodies(world).filter((b) => b.kind === VAPOUR_KIND.puff).length).toBeGreaterThan(0);
        run(world, camera, 5);
        expect(world.ladder).toHaveLength(0);
    });

    it('lifts a curtain of steam off each sealed rim, on both sides of the card', () => {
        const { world, camera } = makeWorld();
        const turquoise = (b) => b.under[1] > 0 && b.under[1] > b.under[0] * 3 && b.under[2] > b.under[0] * 3;
        // (the Stair's hot upper pools breathe turquoise-lit wisps at rest: count from there)
        const resting = bodies(world).filter(turquoise).length;
        world.onClear({
            player: 0,
            rows: [19, 18],
            lines: 2,
            combo: 1,
            cascade: 1,
            tspin: false,
            perfect: false,
            b2b: false,
            rowCodes: [],
            screen: null,
        });
        run(world, camera, 1.2);
        // Lit turquoise from the filling pools: green and blue well above red.
        expect(bodies(world).filter(turquoise).length).toBeGreaterThanOrEqual(resting + 8);
        run(world, camera, 6);
        expect(bodies(world).filter(turquoise)).toHaveLength(resting);
    });

    it('wraps the four-line eruption in a spray veil and keeps the basin’s own steam under load', () => {
        const { world, camera } = makeWorld();
        // Fill the slots with events first: the dome and the thread must survive the overflow.
        for (let i = 0; i < 8; i++) {
            lock(world, {
                u: i % 2 ? 0.8 : 0.2, rows: [10 + (i % 6)], hardDrop: i % 3 === 0, distance: 12,
            });
        }
        for (let n = 2; n <= 9; n++) world.onCombo(n);
        world.onClear({
            player: 0,
            rows: [19, 18, 17, 16],
            lines: 4,
            combo: 9,
            cascade: 1,
            tspin: false,
            perfect: false,
            b2b: false,
            rowCodes: [],
            screen: null,
        });
        run(world, camera, 1.6);
        const list = bodies(world);
        expect(list.length).toBe(VAPOUR_SLOTS);
        expect(list.some((b) => b.kind === VAPOUR_KIND.dome)).toBe(true);
        expect(list.some((b) => b.kind === VAPOUR_KIND.spray)).toBe(true);
        for (let i = 1; i < list.length; i++) {
            expect(distance(world, list[i])).toBeGreaterThanOrEqual(distance(world, list[i - 1]) - 1e-6);
        }
    });

    it('sizes event steam by the board cell where it stands, so a far row is not a near row’s size on screen', () => {
        const { world } = makeWorld();
        const near = world.aimRow(0, 0.1, 18);
        const far = world.aimRow(0, 0.1, 3);
        // Further away, a cell spans more metres across the view, but by no more than the range.
        const eye = world.u.camPos.value;
        const range = (a) => Math.hypot(a.x - eye.x, (a.y || 0) - eye.y, a.z - eye.z);
        expect(far.cell).toBeGreaterThan(near.cell);
        expect(far.cell / near.cell).toBeLessThan((range(far) / range(near)) * 1.2);
        // …and never the ground's foreshortened depth (the old measure grew far faster).
        expect(far.cell).toBeLessThan(far.perRow);
    });
});
