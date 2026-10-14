/**
 * Solar Eclipse — the world's choreography, run without a renderer: a scene, a camera, and the
 * world driven in fixed steps (camera, then events, then the frame, as the theme does).
 *
 * Nothing here pins a gain, a width, a colour or a duration: the look is still being tuned.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, SOLAR_ECLIPSE_PARTS, SolarEclipseWorld, fovForAspect,
} from '../../src/themes/solar-eclipse/solar-eclipse-world.js';
import {
    DEG, ERUPTION_SECONDS, HOUR_SECONDS, KIND, MIRROR, MOON, PALETTES, PROMINENCES, PROMINENCE_LIFE, WORLD,
    limbAngleFor, highestCrest, RIDGE_SPAN,
} from '../../src/themes/solar-eclipse/solar-eclipse-core.js';
import { STREAKS } from '../../src/themes/solar-eclipse/solar-eclipse-tsl.js';
import { cardUnion, fallbackLayout } from '../../src/themes/solar-eclipse/solar-eclipse-composition.js';

vi.setConfig({ testTimeout: 30_000 }); // every test builds a dome, on a machine that may be busy

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

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, live = true, start = START, capture = true,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SolarEclipseWorld({ scene, quality, capture }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(live ? fallbackLayout(width, height) : null, aspect);
    world.seek(start);
    step(world, camera, start, start + 0.1);
    return { scene, camera, world };
}

/** The prominence table's rows for slot i: (shape, times, paint). */
const row = (world, i) => world.u.tables.prominences.slice(i * 3, i * 3 + 3);
const lit = (world) => world.prominences.filter((p) => p.on);
const lock = (world, i = 0, extra = {}) => world.onLock({
    rows: [19 - (i % 6), 18 - (i % 6)], u: ((i * 0.37) % 1) * 0.9 + 0.05, color: '#ff5f8a', ...extra,
});
/** Where on screen a point of the sun's plane is. */
const screenAt = (world, x, y) => ({ ...world.screenOf(world.sunPoint(x, y, [0, 0, 0])) });

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
    vi.restoreAllMocks();
});

describe('SolarEclipseWorld build', () => {
    it('builds every named part, on every tier', () => {
        ['Minimal', 'High'].forEach((quality) => {
            const { world, scene } = makeWorld(quality);
            expect([...world.parts.keys()]).toEqual(SOLAR_ECLIPSE_PARTS);
            world.parts.forEach((object) => expect(object.parent).toBe(world.root));
            expect(world.root.parent).toBe(scene);
            expect(world.fx.count).toBe(world.tier.motes);
        });
    });

    it('draws only the parts it is asked for', () => {
        const { world } = makeWorld();
        world.showOnlyParts(['sky']);
        expect(world.parts.get('sky').visible).toBe(true);
        expect(world.parts.get('motes').visible).toBe(false);
    });

    it('leaves the scene clean when disposed', () => {
        const { world, scene } = makeWorld();
        world.dispose();
        expect(scene.children).not.toContain(world.root);
        expect(world.parts.size).toBe(0);
    });

    it('looks through a long lens, opened up on a tall screen', () => {
        expect(fovForAspect(16 / 9)).toBeCloseTo(REST_RIG.fov, 6);
        expect(fovForAspect(21 / 9)).toBeCloseTo(REST_RIG.fov, 6);
        expect(fovForAspect(0.46)).toBeGreaterThan(REST_RIG.fov + 20);
        expect(fovForAspect(0.2)).toBeLessThanOrEqual(74);
    });
});

describe('SolarEclipseWorld composition', () => {
    it('stands the sun in the free space left of the card, its whole disc clear of it', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080 });
        const card = cardUnion(fallbackLayout(1920, 1080));
        const centre = screenAt(world, 0, 0);
        const edge = screenAt(world, 1, 0);
        expect(world.getState().sunBeside).toBe(true);
        expect(centre.front).toBe(true);
        expect(centre.x).toBeLessThan(card.x0);
        expect(edge.x).toBeLessThan(card.x0);
        expect(centre.y).toBeGreaterThan(0.15);
        expect(centre.y).toBeLessThan(0.5);
    });

    it('keeps the sun and its inner corona well above every range', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080 });
        const lowest = world.sunPoint(0, -2, [0, 0, 0]);
        const crest = highestCrest(world.ranges, -RIDGE_SPAN, RIDGE_SPAN);
        expect(Math.asin(lowest[1])).toBeGreaterThan(crest);
    });

    it('stands it above the card when a narrow screen leaves no room beside it', () => {
        const { world, camera } = makeWorld('Low', { width: 390, height: 844 });
        // Held still: on a narrow frame the shared camera breath's wander alone is ~2% of its width.
        world.setReducedMotion(true);
        step(world, camera, START + 0.1, START + 0.2);
        const card = cardUnion(fallbackLayout(390, 844));
        const centre = screenAt(world, 0, 0);
        expect(world.getState().sunBeside).toBe(false);
        // The middle of the frame.
        expect(Math.abs(centre.x - 0.5)).toBeLessThan(0.02);
        expect(centre.y).toBeLessThan(card.y0);
        expect(centre.y).toBeGreaterThan(0);
    });

    it('draws the sun as a true circle on screen, even at the edge of a phone\'s wide frame', () => {
        [[1920, 1080], [390, 844]].forEach(([width, height]) => {
            const { world } = makeWorld('Low', { width, height });
            const c = screenAt(world, 0, 0);
            const aspect = width / height;
            const r = (x, y) => {
                const p = screenAt(world, x, y);
                return Math.hypot((p.x - c.x) * aspect, p.y - c.y);
            };
            const across = r(1, 0);
            expect(r(0, 1)).toBeCloseTo(across, 4);
            expect(r(-0.7071, -0.7071)).toBeCloseTo(across, 4);
        });
    });

    it('composes for the solo layout when no board is on screen', () => {
        const { world } = makeWorld('Low', { live: false });
        expect(world.getState().sunBeside).toBe(true);
        expect(world.getState().sunScreenX).toBeLessThan(0.3);
    });

    it('keeps the sun the same share of the frame on every wide screen', () => {
        const a = makeWorld('Low', { width: 1280, height: 720 }).world.getState().sunRadiusDeg;
        const b = makeWorld('Low', { width: 3440, height: 1440 }).world.getState().sunRadiusDeg;
        expect(a).toBeCloseTo(b, 6);
    });
});

describe('SolarEclipseWorld: the moon', () => {
    it('wanders a little, so the chromosphere creeps round the limb, and covers the photosphere at rest', () => {
        const { world, camera } = makeWorld();
        const seen = [];
        for (let t = START; t < START + 120; t += 10) {
            step(world, camera, t, t + 10, 0.5);
            const m = world.u.moon.value;
            seen.push([m.x, m.y]);
            expect(Math.hypot(m.x, m.y)).toBeLessThanOrEqual(MOON.wander + 1e-9);
            expect(m.z).toBe(MOON.ratio);
            expect(world.u.diamond.value.z).toBe(0);
        }
        const xs = seen.map((m) => m[0]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(MOON.wander * 0.5);
    });

    it('hands the post the moon\'s disc, so its glare is held off the black', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080 });
        const { moon } = world.getPostState();
        const centre = screenAt(world, 0, 0);
        expect(moon.x).toBeCloseTo(centre.x, 2);
        expect(moon.y).toBeCloseTo(centre.y, 2);
        expect(moon.radius).toBeGreaterThan(20);
        expect(moon.matte).toBeGreaterThan(0.5);
    });
});

describe('SolarEclipseWorld: a lock raises a prominence', () => {
    it('sends a mote from the card\'s edge to the limb and raises a prominence of the piece\'s colour there', () => {
        const { world, camera } = makeWorld('Low', { width: 1920, height: 1080 });
        const t0 = world.time;
        world.onLock({ rows: [12, 11], u: 0.5, color: '#00ff00' });
        const { streaks } = world.u.tables;
        const to = [streaks[1].x, streaks[1].y, streaks[1].z];
        const from = [streaks[0].x, streaks[0].y, streaks[0].z];
        const card = cardUnion(fallbackLayout(1920, 1080));
        const start = world.screenOf(from);
        expect(start.x).toBeCloseTo(card.x0, 3);
        // It lands on the top of the limb (the middle column).
        const land = world.screenOf(to);
        const top = screenAt(world, 0, 1.03);
        expect(land.x).toBeCloseTo(top.x, 3);
        expect(land.y).toBeCloseTo(top.y, 3);
        expect(streaks[2].w).toBeGreaterThan(0);
        // The prominence: on the limb's top, green, born as the mote lands.
        const held = lit(world);
        expect(held).toHaveLength(1);
        const p = held[0];
        expect(p.angle).toBeCloseTo(Math.PI / 2, 0);
        expect(p.rgb[1]).toBeGreaterThan(p.rgb[0] * 3);
        expect(p.born).toBeGreaterThan(t0);
        step(world, camera, world.time, world.time + 1.2);
        const slot = world.prominences.indexOf(p);
        const [shape, times, paint] = row(world, slot);
        expect(shape.x).toBeCloseTo(p.angle, 6);
        expect(times.x).toBeCloseTo(p.born, 6);
        expect(paint.w).toBeGreaterThan(0);
        expect(world.getState().prominences).toBe(1);
    });

    it('lays the board\'s columns over the limb, left column on the left', () => {
        const { world } = makeWorld();
        world.onLock({ rows: [19], u: 0.05, color: '#ffffff' });
        world.onLock({ rows: [19], u: 0.95, color: '#ffffff' });
        const [left, right] = lit(world).sort((a, b) => a.serial - b.serial);
        expect(Math.cos(left.angle)).toBeLessThan(-0.6);
        expect(Math.cos(right.angle)).toBeGreaterThan(0.6);
        expect(Math.abs(left.angle - limbAngleFor(0.05))).toBeLessThan(0.1);
    });

    it('raises a taller arch and jolts the lens on a hard drop', () => {
        const { world } = makeWorld();
        for (let i = 0; i < 10; i += 1) lock(world, i);
        const soft = Math.max(...lit(world).map((p) => p.height));
        const kickBefore = world.kick;
        world.onLock({
            rows: [19], u: 0.4, hardDrop: true, color: '#ffffff',
        });
        const hard = lit(world).sort((a, b) => b.serial - a.serial)[0];
        expect(hard.kind).toBe(KIND.arch);
        expect(hard.power).toBeGreaterThan(1);
        expect(hard.height).toBeGreaterThan(soft * 0.6);
        expect(world.kick).toBeGreaterThan(kickBefore);
        expect(world.shake).toBeGreaterThan(0);
    });

    it('holds no more prominences than the limb has room for, and lets the oldest go', () => {
        const { world } = makeWorld();
        for (let i = 0; i < PROMINENCES + 5; i += 1) lock(world, i);
        expect(lit(world)).toHaveLength(PROMINENCES);
        const serials = lit(world).map((p) => p.serial).sort((a, b) => a - b);
        expect(serials[0]).toBe(6);
    });

    it('lets a prominence fade by itself after half a minute', () => {
        const { world, camera } = makeWorld();
        lock(world, 0);
        step(world, camera, world.time, world.time + PROMINENCE_LIFE + 2, 0.25);
        expect(lit(world)).toHaveLength(0);
        expect(world.u.tables.prominences.every((r, i) => i % 3 !== 2 || r.w === 0)).toBe(true);
    });

    it('takes the piece\'s colour, and a light of its own when the colour is not a hex', () => {
        const { world } = makeWorld();
        world.onLock({ rows: [19], u: 0.5, color: 'not-a-colour' });
        const p = lit(world)[0];
        p.rgb.forEach((c) => expect(c).toBeGreaterThan(0.3));
        // A dark piece is lifted so it reads against the corona.
        world.onLock({ rows: [19], u: 0.5, color: '#100820' });
        const dark = lit(world).sort((a, b) => b.serial - a.serial)[0];
        expect(Math.max(...dark.rgb)).toBeGreaterThan(0.8);
    });
});

describe('SolarEclipseWorld: a clear', () => {
    it('sends a necklace of one bead per line round the limb and flashes the chromosphere', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2 });
        const beads = world.u.beads.value;
        expect(beads.z).toBe(2);
        expect(beads.w).toBeGreaterThan(0);
        step(world, camera, world.time, world.time + 0.1);
        expect(world.u.flash.value).toBeGreaterThan(0.3);
        expect(world.u.surge.value).toBeGreaterThan(0.2);
    });

    it('erupts the oldest prominences, two per line', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 6; i += 1) lock(world, i);
        step(world, camera, world.time, world.time + 1.5);
        const t = world.time;
        world.onClear({ rows: [19], lines: 1 });
        const erupting = lit(world).filter((p) => p.erupts < 1e5);
        expect(erupting).toHaveLength(2);
        expect(erupting.map((p) => p.serial).sort()).toEqual([1, 2]);
        erupting.forEach((p) => expect(p.erupts).toBeGreaterThan(t));
        step(world, camera, world.time, world.time + ERUPTION_SECONDS + 1, 0.1);
        expect(lit(world)).toHaveLength(4);
        expect(world.getState().erupting).toBe(0);
    });

    it('sends white jets out instead when the limb holds nothing to erupt', () => {
        const { world } = makeWorld();
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        const jets = lit(world).filter((p) => p.kind === KIND.jet);
        expect(jets).toHaveLength(3);
        jets.forEach((p) => expect(p.erupts).toBe(p.born));
    });

    it('brings the diamond ring on four lines: the moon slides off, the day floods back, then totality returns', () => {
        const { world, camera } = makeWorld('Low', { width: 1920, height: 1080 });
        for (let i = 0; i < 5; i += 1) lock(world, i);
        step(world, camera, world.time, world.time + 1.2);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(lit(world).every((p) => p.erupts < 1e5)).toBe(true);
        step(world, camera, world.time, world.time + 0.6, 1 / 60);
        const m = world.u.moon.value;
        expect(Math.hypot(m.x, m.y)).toBeGreaterThan(MOON.ratio - 1 + MOON.valley);
        expect(world.u.diamond.value.z).toBeGreaterThan(0.5);
        expect(world.u.daylight.value).toBeGreaterThan(0.3);
        expect(world.getPostState().exposure).toBeLessThan(1);
        expect(world.getPostState().moon.matte).toBeLessThan(0.5);
        // The bead is on the limb, on the side the moon slid away from.
        const d = world.u.diamond.value;
        expect(Math.hypot(d.x, d.y)).toBeCloseTo(0.995, 3);
        expect(d.x * m.x + d.y * m.y).toBeLessThan(0);
        // And a CME has left the limb.
        expect(world.u.cme.value.z).toBeGreaterThan(0);
        step(world, camera, world.time, world.time + 4, 1 / 30);
        expect(world.u.diamond.value.z).toBe(0);
        expect(world.u.daylight.value).toBe(0);
        expect(Math.hypot(world.u.moon.value.x, world.u.moon.value.y)).toBeLessThanOrEqual(MOON.wander + 1e-9);
    });

    it('aims the diamond and the CME into the open sky, whatever the layout', () => {
        [[1920, 1080], [390, 844]].forEach(([width, height]) => {
            const { world, camera } = makeWorld('Low', { width, height });
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            step(world, camera, world.time, world.time + 0.7, 1 / 60);
            const angle = world.u.cme.value.x;
            // Its path a few radii out stays on screen, and off the card when the sun is beside it.
            const out = screenAt(world, Math.cos(angle) * 3, Math.sin(angle) * 3);
            expect(out.x).toBeGreaterThan(0);
            expect(out.x).toBeLessThan(1);
            expect(out.y).toBeGreaterThan(0);
            if (world.getState().sunBeside) expect(out.x).toBeLessThan(cardUnion(fallbackLayout(width, height)).x0);
        });
    });

    it('answers a perfect clear with the diamond, a flash and a second necklace', () => {
        const { world, camera } = makeWorld();
        world.onClear({
            rows: [19, 18, 17, 16], lines: 4, perfect: true,
        });
        expect(world.flash).toBeGreaterThan(1);
        step(world, camera, world.time, world.time + 1.3, 1 / 60);
        expect(world.u.beads.value.z).toBe(6);
        expect(world.u.diamond.value.z).toBeGreaterThan(0);
    });

    it('twists the corona on a T-spin and lets it ring down without a jump', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        let last = 0;
        let peak = 0;
        for (let i = 0; i < 300; i += 1) {
            step(world, camera, world.time, world.time + 1 / 60, 1 / 60);
            const tw = world.u.twist.value;
            expect(Math.abs(tw - last)).toBeLessThan(0.1);
            peak = Math.max(peak, tw);
            last = tw;
        }
        expect(peak).toBeGreaterThan(0.5);
        step(world, camera, world.time, world.time + 6, 0.1);
        expect(world.u.twist.value).toBe(0);
    });
});

describe('SolarEclipseWorld: the chain is a longer exposure', () => {
    it('reaches further the longer the chain, and closes slowly when it breaks', () => {
        const { world, camera } = makeWorld();
        world.onCombo(2);
        step(world, camera, world.time, world.time + 3);
        const short = world.u.exposure.value;
        world.onCombo(8);
        step(world, camera, world.time, world.time + 4);
        const long = world.u.exposure.value;
        expect(short).toBeGreaterThan(0);
        expect(long).toBeGreaterThan(short * 2);
        // Earthshine comes up with it.
        expect(world.u.moon.value.w).toBeCloseTo(long, 6);
        world.onCombo(0);
        step(world, camera, world.time, world.time + 1);
        expect(world.u.exposure.value).toBeGreaterThan(long * 0.4);
        step(world, camera, world.time, world.time + 15, 0.2);
        expect(world.u.exposure.value).toBeLessThan(0.05);
    });
});

/** The ripple table's rows for slot i: (where and when, kind). */
const ripple = (world, i) => world.u.tables.ripples.slice(i * 2, i * 2 + 2);
const dropped = (world, at) => world.u.tables.ripples
    .filter((r, i) => i % 2 === 0 && Math.abs(r.z - at) < 1e-6 && r.w > 0);

describe('SolarEclipseWorld: the salt mirror', () => {
    it('lays the horizon low enough that the sun stands in the mirror below it', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080 });
        const sun = screenAt(world, 0, 0);
        const d = world.sunPoint(0, 0, [0, 0, 0]);
        const echo = world.screenOf([d[0], -d[1], d[2]]);
        // Its column (the lens is tilted a little up, so not quite), the same height below the
        // horizon as the sun stands above it.
        expect(Math.abs(echo.x - sun.x)).toBeLessThan(0.02);
        expect(echo.y).toBeGreaterThan(WORLD.horizonY);
        expect(echo.y).toBeLessThan(1);
        expect(Math.abs((echo.y - WORLD.horizonY) - (WORLD.horizonY - sun.y))).toBeLessThan(0.06);
        // The water there reflects it: the ground point mirrors the sun's own direction.
        const g = world.reflectionPoint(0, 0, [0, 0, 0]);
        expect(g).not.toBeNull();
        const back = [g[0], -MIRROR.eye, g[1]];
        const n = Math.hypot(...back);
        expect(back[0] / n).toBeCloseTo(d[0], 4);
        expect(-back[1] / n).toBeCloseTo(d[1], 4);
    });

    it('leaves the water to the sun: a lock drops no ring at the card\'s foot', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080 });
        world.onLock({ rows: [18, 17], u: 0.2, color: '#00ff00' });
        world.onLock({
            rows: [18, 17], u: 0.6, color: '#00ff00', hardDrop: true,
        });
        expect(world.getState().ripples).toBe(0);
    });

    it('drops a ring into the sun\'s own reflection on a clear, stronger for more lines', () => {
        const { world, camera } = makeWorld();
        const t0 = world.time;
        world.onClear({ rows: [19], lines: 1 });
        const [one] = dropped(world, t0);
        const g = world.reflectionPoint(0, 0, [0, 0, 0]);
        expect(one.x).toBeCloseTo(g[0], 6);
        expect(one.y).toBeCloseTo(g[1], 6);
        step(world, camera, world.time, world.time + 1);
        const t1 = world.time;
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        const [three] = dropped(world, t1);
        expect(three.w).toBeGreaterThan(one.w);
        // Four lines: a second ring follows the first.
        step(world, camera, world.time, world.time + 1);
        const t2 = world.time;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(dropped(world, t2)).toHaveLength(1);
        expect(world.u.tables.ripples.filter((r, i) => i % 2 === 0 && r.z > t2 + 0.3 && r.w > 0)).toHaveLength(1);
    });

    it('winds a whirl into the reflection on a T-spin', () => {
        const { world } = makeWorld();
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        const kinds = [];
        for (let i = 0; i < MIRROR.ripples; i += 1) {
            const [a, b] = ripple(world, i);
            if (a.w > 0) kinds.push(b.x);
        }
        expect(kinds).toContain(1);
        expect(kinds).toContain(0);
    });

    it('takes the oldest ring\'s place when the water is full of them', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < MIRROR.ripples + 3; i += 1) {
            step(world, camera, world.time, world.time + 0.1);
            world.onClear({ rows: [19], lines: 1 });
        }
        const starts = world.u.tables.ripples.filter((r, i) => i % 2 === 0).map((r) => r.z);
        expect(new Set(starts).size).toBe(MIRROR.ripples);
        expect(Math.min(...starts)).toBeGreaterThan(START + 0.25);
    });

    it('lays the diamond\'s glitter path on the water and races shadow bands over the salt, then stops', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(world, camera, world.time, world.time + 0.6);
        const glint = world.u.glint.value;
        expect(glint.w).toBeGreaterThan(0);
        // Aimed at the bead that burns on the limb.
        const d = world.u.diamond.value;
        const bead = world.sunPoint(d.x, d.y, [0, 0, 0]);
        expect(glint.x).toBeCloseTo(bead[0], 4);
        expect(glint.y).toBeCloseTo(bead[1], 4);
        expect(world.u.bands.value).toBeGreaterThan(0);
        step(world, camera, world.time, world.time + 4);
        expect(world.u.glint.value.w).toBe(0);
        expect(world.u.bands.value).toBe(0);
    });

    it('stills the water to glass in a chain, and lets the wind back when it breaks', () => {
        const { world, camera } = makeWorld();
        expect(world.u.glass.value).toBe(0);
        world.onCombo(8);
        step(world, camera, world.time, world.time + 5);
        const glass = world.u.glass.value;
        expect(glass).toBeGreaterThan(0.5);
        world.onCombo(0);
        step(world, camera, world.time, world.time + 6);
        expect(world.u.glass.value).toBeLessThan(glass * 0.5);
    });

    it('hands the post the moon\'s reflection too, so the black holds in the water', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080 });
        const { moon, echo } = world.getPostState();
        expect(Math.abs(echo.x - moon.x)).toBeLessThan(0.02);
        expect(echo.y).toBeGreaterThan(WORLD.horizonY);
        expect(echo.radius).toBeCloseTo(moon.radius, 6);
        expect(echo.matte).toBeGreaterThan(0.5);
        expect(echo.matte).toBeLessThanOrEqual(moon.matte);
    });

    it('forgets every ring on a seek, so a replay draws the same water', () => {
        const { world } = makeWorld();
        lock(world, 0);
        world.onClear({ rows: [19], lines: 1 });
        world.seek(START + 30);
        expect(world.getState().ripples).toBe(0);
        expect(world.u.tables.ripples.every((r, i) => i % 2 !== 0 || r.w === 0)).toBe(true);
    });
});

describe('SolarEclipseWorld: the light of the hour', () => {
    it('moves with the clock alone, whatever the level', () => {
        const { world, camera } = makeWorld('Low', { start: 0.5 });
        const first = world.getState();
        expect(first.palette).toBe(PALETTES[0].name);
        step(world, camera, world.time, 60, 0.5);
        const later = world.getState();
        expect(later.level).toBe(1);
        expect(later.paletteTurn).toBeGreaterThan(0.3);
        expect(world.u.glow.value.x).not.toBeCloseTo(PALETTES[0].glow[0], 3);
        step(world, camera, world.time, HOUR_SECONDS + 14, 0.5);
        expect(world.getState().palette).toBe(PALETTES[1].name);
    });

    it('turns the solar cycle with the light', () => {
        const { world, camera } = makeWorld('Low', { start: 0.5 });
        const quiet = world.u.cycle.value;
        step(world, camera, world.time, 3 * HOUR_SECONDS + 10, 0.5);
        expect(world.u.cycle.value).toBeGreaterThan(quiet + 0.5);
        const strong = world.u.tables.streamers.filter((r) => r.z > 0.25).length;
        expect(strong).toBeGreaterThan(5);
    });

    it('adds a level\'s step on top of where the clock has carried it, and flashes the limb', () => {
        const { world, camera } = makeWorld('Low', { start: 5 });
        world.levelUp(2);
        expect(world.flash).toBeGreaterThanOrEqual(1);
        step(world, camera, world.time, world.time + 12, 0.25);
        expect(world.getState().palette).toBe(PALETTES[1].name);
        expect(world.getState().level).toBe(2);
    });

    it('stands on a level at once when told to do it silently', () => {
        const { world } = makeWorld('Low', { start: 5 });
        world.levelUp(4, { silent: true });
        expect(world.getState().palette).toBe(PALETTES[3].name);
        expect(world.flash).toBe(0);
    });
});

describe('SolarEclipseWorld: a session', () => {
    it('replays to the same frame after a seek', () => {
        const play = () => {
            const { world, camera } = makeWorld('Low', { start: 20 });
            for (let i = 0; i < 4; i += 1) {
                lock(world, i, { hardDrop: i === 2 });
                step(world, camera, world.time, world.time + 0.5);
            }
            world.onClear({ rows: [19, 18], lines: 2 });
            world.onCombo(3);
            step(world, camera, world.time, world.time + 1.25);
            return {
                prominences: world.u.tables.prominences.map((r) => r.toArray()),
                streaks: world.u.tables.streaks.map((r) => r.toArray()),
                moon: world.u.moon.value.toArray(),
                exposure: world.u.exposure.value,
            };
        };
        expect(play()).toEqual(play());
    });

    it('lets its prominences go and closes the exposure when a new run begins', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 5; i += 1) lock(world, i);
        world.onCombo(6);
        world.levelUp(3);
        step(world, camera, world.time, world.time + 1);
        world.resetSession();
        expect(world.level).toBe(1);
        expect(world.combo).toBe(0);
        step(world, camera, world.time, world.time + 4, 0.1);
        expect(lit(world)).toHaveLength(0);
        step(world, camera, world.time, world.time + 15, 0.25);
        expect(world.u.exposure.value).toBeLessThan(0.05);
    });

    it('reports what it is doing', () => {
        const { world } = makeWorld();
        lock(world, 0);
        const state = world.getState();
        expect(state).toMatchObject({
            quality: 'Low', level: 1, combo: 0, prominences: 1, erupting: 0, motes: 1, sunBeside: true,
        });
        expect(state.sunRadiusDeg).toBeGreaterThan(1);
        expect(STREAKS).toBeGreaterThanOrEqual(world.tier.motes);
        expect(DEG).toBeCloseTo(Math.PI / 180, 12);
    });
});
