/**
 * Starlight, the living night (2026-11): the night's air on its own clock, a level-up's front of
 * light, the visitors (satellites, the great comet, fish rising), and the events that got shapes
 * of their own (a twist's spiral, a perfect clear's storm from one radiant, a fireball that bursts,
 * the constellations that fall when a run ends). Relations, not tuning numbers: what each must
 * keep true while its look is free to change.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    COMET, REST_RIG, StarlightWorld, fovForAspect,
} from '../../src/themes/starlight/starlight-world.js';
import {
    DEG, NEBULAE, NEBULA_ARC, PALETTES, STREAK, horizontal,
} from '../../src/themes/starlight/starlight-core.js';
import {
    AIRS, AIR_ORDER, AIR_SECONDS, airAt, airUniforms, heldAir,
} from '../../src/themes/starlight/starlight-night.js';
import { SPIRAL_LIFE } from '../../src/themes/starlight/starlight-spiral.js';
import { cardUnion, fallbackLayout } from '../../src/themes/starlight/starlight-composition.js';

vi.setConfig({ testTimeout: 30_000 });

const START = 10;
const worlds = [];

function step(world, camera, from, to, dt = 1 / 30) {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const sim = {
            time: from + i * h, delta: h, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

function makeWorld({ start = START, visitors = false, air = 'clear' } = {}) {
    const width = 1600;
    const height = 900;
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StarlightWorld({ scene: new THREE.Scene(), quality: 'Low', capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.setVisitors(visitors);
    world.setAirHold(air);
    world.seek(start);
    step(world, camera, start, start + 0.1);
    return { camera, world };
}

/** The live streak slots, as { kind, from, to, start, duration, rgb, power }. */
function streaks(world) {
    const rows = world.u.tables.streaks;
    const out = [];
    for (let i = 0; i < world.streakEnds.length; i += 1) {
        if (world.streakEnds[i] <= world.time) continue;
        out.push({
            kind: rows[i * 4 + 3].x,
            from: [rows[i * 4].x, rows[i * 4].y, rows[i * 4].z],
            start: rows[i * 4].w,
            to: [rows[i * 4 + 1].x, rows[i * 4 + 1].y, rows[i * 4 + 1].z],
            duration: rows[i * 4 + 1].w,
            rgb: [rows[i * 4 + 2].x, rows[i * 4 + 2].y, rows[i * 4 + 2].z],
            power: rows[i * 4 + 2].w,
        });
    }
    return out;
}

const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const lock = (world, i = 0) => world.onLock({
    rows: [19 - (i % 6), 18 - (i % 6)], u: ((i * 0.37) % 1) * 0.9 + 0.05, color: '#93ffe8',
});

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
});

describe('Starlight: the night\'s air', () => {
    it('is a weighting of the states that always sums to one, clear at the start of the night', () => {
        const air = airAt(0);
        expect(air.clear).toBe(1);
        for (let t = 0; t < AIR_SECONDS * AIR_ORDER.length; t += 7.3) {
            const a = airAt(t);
            const sum = AIRS.reduce((s, k) => s + a[k], 0);
            expect(sum).toBeCloseTo(1, 6);
            AIRS.forEach((k) => expect(a[k]).toBeGreaterThanOrEqual(0));
        }
    });

    it('comes round to every weather, never the same one twice in a row', () => {
        AIRS.forEach((name) => expect(AIR_ORDER).toContain(name));
        for (let i = 0; i < AIR_ORDER.length; i += 1) {
            expect(AIR_ORDER[i]).not.toBe(AIR_ORDER[(i + 1) % AIR_ORDER.length]);
        }
        // Clear sky keeps the most of the night: the dark sky is the theme's own.
        const clear = AIR_ORDER.filter((n) => n === 'clear').length;
        AIRS.filter((n) => n !== 'clear').forEach((name) => {
            expect(AIR_ORDER.filter((n) => n === name).length).toBeLessThan(clear);
        });
    });

    it('melts from one weather into the next, never stepping', () => {
        let worst = 0;
        let last = airAt(0);
        for (let t = 0.1; t < AIR_SECONDS * 4; t += 0.1) {
            const a = airAt(t);
            for (let i = 0; i < AIRS.length; i += 1) worst = Math.max(worst, Math.abs(a[AIRS[i]] - last[AIRS[i]]));
            last = a;
        }
        expect(worst).toBeLessThan(0.02);
    });

    it('drifts apart from the hours, so an hour comes back under another sky', () => {
        expect(AIR_SECONDS % 100).not.toBe(0);
    });

    it('lets twilight carry the noctilucent shine and drown the airglow', () => {
        const waves = heldAir('waves');
        const shine = heldAir('shine');
        expect(airUniforms(shine, 1).shine).toBeGreaterThan(airUniforms(shine, 0).shine * 2);
        expect(airUniforms(waves, 1).waves).toBeLessThan(airUniforms(waves, 0).waves);
        expect(airUniforms(heldAir('clear'), 0)).toMatchObject({
            waves: 0, veil: 0, mist: 0, breeze: 0, shine: 0,
        });
    });

    it('is written to the shader each frame, and a held air pins it', () => {
        const { world, camera } = makeWorld({ air: 'veil' });
        step(world, camera, START + 0.1, START + 0.3);
        expect(world.u.air.value.y).toBe(1);
        world.setAirHold('mist');
        step(world, camera, START + 0.3, START + 0.4);
        expect(world.u.air.value.y).toBe(0);
        expect(world.u.air.value.z).toBe(1);
        // Given back to the clock it follows the clock.
        world.setAirHold(null);
        const at = AIR_SECONDS * AIR_ORDER.indexOf('breeze') + AIR_SECONDS * 0.3;
        step(world, camera, START + 0.4, START + 0.5);
        world.writeAir(at);
        expect(world.u.air.value.w).toBe(1);
        expect(world.getState().air).toBe('breeze');
    });
});

describe('Starlight: a level-up rolls the next hour up the sky', () => {
    it('sends a front up from the horizon that climbs, then fades away by itself', () => {
        const { world, camera } = makeWorld();
        expect(world.u.front.value.z).toBe(0);
        world.levelUp(2);
        let height = -Infinity;
        let peak = 0;
        let t = START + 0.1;
        for (let i = 0; i < 6 * 30; i += 1) {
            step(world, camera, t, t + 1 / 30);
            t += 1 / 30;
            const front = world.u.front.value;
            if (front.z > 0.01) {
                expect(front.x).toBeGreaterThanOrEqual(height - 1e-9);
                height = front.x;
            }
            peak = Math.max(peak, front.z);
        }
        expect(peak).toBeGreaterThan(0.8);
        expect(height).toBeGreaterThan(0.8);
        expect(world.u.front.value.z).toBe(0);
    });
});

describe('Starlight: the great comet', () => {
    it('is away until its first visit, then stands low left of the card with its tails rising', () => {
        const away = makeWorld({ start: COMET.first - 20 });
        expect(away.world.u.comet.value.w).toBe(0);
        expect(away.world.cometPart.object.children.every((m) => !m.visible)).toBe(true);
        // The middle of its first visit.
        const mid = COMET.first + COMET.stay / 2;
        const { world, camera } = makeWorld({ start: mid - 0.1 });
        step(world, camera, mid, mid + 0.1);
        const head = world.u.comet.value;
        expect(head.w).toBeGreaterThan(0.95);
        expect(world.cometPart.object.children.every((m) => m.visible)).toBe(true);
        const at = world.screenOf([head.x, head.y, head.z], {});
        const card = cardUnion(world.layoutNow());
        expect(at.front).toBe(true);
        expect(at.x).toBeLessThan(card.x0);
        expect(at.x).toBeGreaterThan(0);
        expect(Math.asin(head.y)).toBeGreaterThan(3 * DEG);
        expect(Math.asin(head.y)).toBeLessThan(20 * DEG);
        // The tails rise, away from the sun far below the northern horizon.
        const tail = world.u.cometTail.value;
        expect(tail.y).toBeGreaterThan(0.3);
        const sun = horizontal(world.poleAz + 0.25, COMET.sunAlt);
        expect(tail.x * sun[0] + tail.y * sun[1] + tail.z * sun[2]).toBeLessThan(0);
        expect(Math.abs(tail.x * head.x + tail.y * head.y + tail.z * head.z)).toBeLessThan(1e-6);
    });

    it('turns with the stars during its visit and fades in and out at its ends', () => {
        const t0 = COMET.first;
        const { world, camera } = makeWorld({ start: t0 + 1 });
        expect(world.u.comet.value.w).toBeLessThan(0.1);
        const { rho } = world.comet;
        const before = world.u.comet.value.clone();
        step(world, camera, t0 + 1.1, t0 + 60, 1 / 10);
        expect(world.u.comet.value.w).toBeGreaterThan(0.9);
        expect(world.comet.rho).toBe(rho);
        const now = world.u.comet.value;
        const moved = angle([before.x, before.y, before.z], [now.x, now.y, now.z]);
        expect(moved).toBeGreaterThan(0.01);
        step(world, camera, t0 + 60, t0 + COMET.stay + 1, 1 / 4);
        expect(world.u.comet.value.w).toBe(0);
    });

    it('comes at once when a perfect clear calls it, and bursts out if it is already up', () => {
        const { world, camera } = makeWorld({ start: 40 });
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        step(world, camera, 40.1, 40.1 + COMET.calledEase + 1, 1 / 10);
        expect(world.u.comet.value.w).toBeGreaterThan(0.9);
        expect(world.u.cometSide.value.w).toBeGreaterThan(0.2);
        // Already up: no new visit, an outburst.
        const { visit } = world.comet;
        world.onCrown();
        expect(world.comet.visit).toBe(visit);
    });
});

describe('Starlight: visitors', () => {
    it('sends satellites over by itself: slow steady points crossing the frame, now and then the station', () => {
        const { world, camera } = makeWorld({ visitors: true });
        const seen = [];
        let t = START + 0.1;
        for (let i = 0; i < 240; i += 1) {
            step(world, camera, t, t + 0.5, 0.5);
            t += 0.5;
            streaks(world).filter((s) => s.kind === STREAK.satellite).forEach((s) => {
                if (!seen.some((o) => o.start === s.start)) seen.push(s);
            });
        }
        expect(seen.length).toBeGreaterThanOrEqual(3);
        seen.forEach((s) => {
            expect(s.duration).toBeGreaterThan(20);
            expect(Math.asin(s.from[1])).toBeGreaterThan(5 * DEG);
            expect(Math.asin(s.to[1])).toBeGreaterThan(5 * DEG);
            // Across the frame: from one side's edge to the other's.
            const a = world.screenOf(s.from, {});
            const b = world.screenOf(s.to, {});
            expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.9);
        });
    });

    it('holds still when the visitors are held off', () => {
        const { world, camera } = makeWorld({ visitors: false });
        step(world, camera, START + 0.1, START + 90, 0.5);
        expect(streaks(world).filter((s) => s.kind === STREAK.satellite)).toHaveLength(0);
    });

    it('lets fish rise in the open water beside the card: rings with no light of their own', () => {
        const { world } = makeWorld();
        const card = cardUnion(world.layoutNow());
        for (let i = 0; i < 12; i += 1) world.fish();
        const live = world.rings.filter((r) => r.on);
        expect(live.length).toBeGreaterThan(0);
        live.forEach((r) => {
            expect(r.rgb).toEqual([0, 0, 0]);
            const d = [r.x - world._pos.x, -world._pos.y, r.z - world._pos.z];
            const n = Math.hypot(...d);
            const at = world.screenOf(d.map((v) => v / n), {});
            expect(at.x < card.x0 || at.x > card.x1).toBe(true);
            expect(at.y).toBeGreaterThan(0.72);
        });
    });
});

describe('Starlight: events with shapes of their own', () => {
    it('lays a lock\'s ring on the open water beside the card, where it can be seen', () => {
        const { world } = makeWorld();
        const card = cardUnion(world.layoutNow());
        for (let i = 0; i < 6; i += 1) {
            lock(world, i);
            const r = world.rings[(world.cursor.ring - 1) % world.rings.length];
            const d = [r.x - world._pos.x, -world._pos.y, r.z - world._pos.z];
            const n = Math.hypot(...d);
            const at = world.screenOf(d.map((v) => v / n), {});
            expect(at.x < card.x0 || at.x > card.x1).toBe(true);
            expect(r.rgb.some((c) => c > 0)).toBe(true);
        }
    });

    it('answers a twist with a spiral in the free sky, and a twist that cleared nothing with a smaller one', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2, twist: true });
        const rows = world.u.tables.spirals;
        const live = [0, 1].filter((i) => rows[i * 2].w === world.time);
        expect(live).toHaveLength(1);
        const big = rows[live[0] * 2 + 1].y;
        const place = rows[live[0] * 2];
        const at = world.screenOf([place.x, place.y, place.z], {});
        const card = cardUnion(world.layoutNow());
        const { hud } = world.layoutNow();
        expect(at.x < card.x0 || at.x > Math.max(card.x1, hud.x1)).toBe(true);
        expect(world.spiralPart.object.children.every((m) => m.visible)).toBe(false);
        step(world, camera, world.time, world.time + 0.1);
        expect(world.spiralPart.object.children.every((m) => m.visible)).toBe(true);
        world.onSpin();
        const small = [0, 1].map((i) => rows[i * 2 + 1].y).find((y, i) => rows[i * 2].w === world.time);
        expect(small).toBeLessThan(big);
        step(world, camera, world.time, world.time + SPIRAL_LIFE + 0.2, 0.25);
        expect(world.spiralPart.object.children.every((m) => !m.visible)).toBe(true);
    });

    it('rains a perfect clear\'s storm out of one radiant, in the colours played', () => {
        const { world } = makeWorld();
        ['#ff0000', '#00ff00', '#0000ff'].forEach((color, i) => world.onLock({ rows: [19 - i], u: 0.3, color }));
        const before = streaks(world).length;
        world.crown(world.time, { fireball: false });
        const storm = streaks(world).filter((s) => s.kind === STREAK.meteor && s.start > world.time);
        expect(storm.length).toBeGreaterThan(20);
        expect(streaks(world).length).toBeGreaterThan(before + 20);
        // One point they all run away from: the mean of where they start.
        const mean = [0, 0, 0];
        storm.forEach((s) => s.from.forEach((v, k) => { mean[k] += v; }));
        const n = Math.hypot(...mean);
        const radiant = mean.map((v) => v / n);
        storm.forEach((s) => {
            expect(angle(s.from, radiant)).toBeLessThan(0.12);
            expect(angle(s.to, radiant)).toBeGreaterThan(angle(s.from, radiant));
        });
        // Not all one colour: the pieces played.
        expect(new Set(storm.map((s) => s.rgb.map((c) => c.toFixed(2)).join())).size).toBeGreaterThan(1);
    });

    it('bursts a fireball as it lands: its pieces fly on from where it ended', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(world, camera, START + 0.1, START + 0.3);
        const ball = world.fireball;
        expect(ball).toBeTruthy();
        step(world, camera, START + 0.3, ball.t0 + ball.duration + 0.05, 1 / 60);
        const end = ball.t0 + ball.duration;
        const pieces = streaks(world)
            .filter((s) => angle(s.from, ball.to) < 0.04 && s.kind === STREAK.meteor && s.start >= end - 0.05);
        expect(pieces.length).toBeGreaterThanOrEqual(3);
        // It flares as it ends: its light at the end is above its light just before.
        expect(world.ballLight(ball, end)).toBeGreaterThan(world.ballLight(ball, end - 0.3));
    });

    it('lets the constellations a run drew fall when it ends, and a reset after cannot cut them off', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 8; i += 1) {
            lock(world, i);
            step(world, camera, world.time, world.time + 1);
        }
        const lit = world.figures.filter((f) => f.on)
            .reduce((n, f) => n + f.stars.filter((s) => s.at <= world.time).length, 0);
        expect(lit).toBeGreaterThan(4);
        const before = streaks(world).length;
        world.onGameOver();
        const falls = streaks(world).filter((s) => s.start > world.time);
        expect(falls.length).toBe(Math.min(lit, 36));
        expect(streaks(world).length).toBe(before + falls.length);
        falls.forEach((s) => expect(s.to[1]).toBeLessThan(s.from[1]));
        // Every figure fades behind them.
        expect(world.figures.filter((f) => f.on).every((f) => f.leaving >= 0)).toBe(true);
        world.resetSession();
        expect(streaks(world).filter((s) => s.start > world.time)).toHaveLength(falls.length);
    });
});

describe('Starlight: the band\'s nebulae', () => {
    it('lie where the shader looks for them, and every hour has a colour for them', () => {
        NEBULAE.forEach(([l, b, size, kind, power]) => {
            expect(Math.abs(b) + size).toBeLessThan(0.3);
            expect(Math.abs(l) + size * 2).toBeLessThan(0.95);
            expect(size).toBeGreaterThan(0);
            expect([0, 1, 2]).toContain(kind);
            expect(power).toBeGreaterThan(0);
        });
        const [, arcB, arcR, arcW] = NEBULA_ARC;
        expect(Math.abs(arcB) + arcR + arcW).toBeLessThan(0.3);
        expect(Math.abs(NEBULA_ARC[0]) + arcR + arcW * 2).toBeLessThan(0.95);
        PALETTES.forEach((p) => expect(Math.max(...p.nebula)).toBeGreaterThan(0.5));
    });
});
