/**
 * Stellar Drift — the world, on the CPU: a real StellarDriftWorld in a THREE.Scene, no renderer.
 *
 * These pin behaviour and contracts — what a lock, a clear, a chain and a new level DO, in what
 * order and how often — never a tuning number: constants are imported, and the assertions are
 * relations (counted, ordered, bounded, monotonic).
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, STELLAR_DRIFT_PARTS, StellarDriftWorld, fovForAspect,
} from '../../src/themes/stellar-drift/stellar-drift-world.js';
import {
    AURORA_REST, BOLT_SLOTS, CHIME_SLOTS, EVENT_ROWS, JET_SLOTS, METEOR_SLOTS, MOTE_FLIGHT,
    PALETTES, PALETTE_COUNT, PALETTE_STEP,
    RINGS, RIPPLE_LIFE, RIPPLE_SLOTS, STRIKE_SLOTS, giantAnchors, palettePlace, pieceColor, rowLatitude,
    sunDirection,
} from '../../src/themes/stellar-drift/stellar-drift-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/stellar-drift/stellar-drift-quality.js';
import { fallbackLayout } from '../../src/themes/stellar-drift/stellar-drift-composition.js';
import { STELLAR_DRIFT_TETROMINOS } from '../../src/themes/stellar-drift/stellar-drift-tetrominos.js';

const COLORS = STELLAR_DRIFT_TETROMINOS.colors;

/** The capture's recipe: jump the clock, then draw that moment with the simulation frozen. */
function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, layout, at = 10,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StellarDriftWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(layout === undefined ? fallbackLayout(width, height) : layout, aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

/**
 * One frame as the theme runs it: the camera (which stamps the clock), the gameplay staged since
 * the last frame, then the world.
 */
function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

/** Advance the world from its current time by `seconds` in equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

const rowsOf = (world, block, count) => {
    const out = [];
    for (let i = 0; i < count * 2; i++) {
        const v = world.u.events.array[block + i];
        out.push([v.x, v.y, v.z, v.w]);
    }
    return out;
};
const live = (world) => world.getState().live;
const lock = (world, over = {}) => world.onLock({
    player: 0, rows: [14, 13], u: 0.4, hardDrop: false, color: COLORS.I, screen: null, ...over,
});
const clear = (world, over = {}) => world.onClear({
    player: 0, rows: [19], lines: 1, combo: 1, cascade: 1, tspin: false, perfect: false, b2b: false, screen: null, ...over,
});

describe('stellar drift world: built, posed, taken down', () => {
    it.each(QUALITY_NAMES)('builds every part on %s and leaves nothing behind when disposed', (quality) => {
        const { scene, world } = makeWorld(quality);
        expect(Object.keys(world.parts)).toEqual(STELLAR_DRIFT_PARTS);
        expect(scene.children).toContain(world.root);
        expect(world.getState().parts).toEqual(STELLAR_DRIFT_PARTS);
        expect(world.tier).toBe(QUALITY[quality]);
        const geometryDisposed = vi.spyOn(world.resonances.geometry, 'dispose');
        const materialDisposed = vi.spyOn(world.resonances.material, 'dispose');
        world.dispose();
        expect(geometryDisposed).toHaveBeenCalledOnce();
        expect(materialDisposed).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
        expect(world.u).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        // A disposed world ignores a late frame.
        expect(() => world.update({
            time: 11, delta: 0.016, pointerX: 0, pointerY: 0,
        })).not.toThrow();
    });

    it('stands the camera so the giant falls on its anchor, at its size, for any screen', () => {
        [[1600, 900], [2560, 1080], [1024, 768], [430, 850]].forEach(([width, height]) => {
            const { world } = makeWorld('Minimal', { width, height });
            const anchors = giantAnchors(width / height);
            const cam = world.restCamera();
            const centre = new THREE.Vector3(0, 0, 0).project(cam);
            expect(centre.x * 0.5 + 0.5).toBeCloseTo(anchors.x, 3);
            expect(0.5 - centre.y * 0.5).toBeCloseTo(anchors.y, 3);
            // Its limb, a radius away across the view, lands about a radius away on screen.
            const side = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
            const limb = side.clone().project(cam);
            const dx = (limb.x - centre.x) * 0.5 * (width / height);
            const dy = (limb.y - centre.y) * 0.5;
            expect(Math.hypot(dx, dy)).toBeGreaterThan(anchors.radius * 0.9);
            expect(Math.hypot(dx, dy)).toBeLessThan(anchors.radius * 1.15);
            // The camera is over the ring plane's lit face, outside the rings.
            expect(cam.position.y).toBeGreaterThan(0);
            expect(cam.position.length()).toBeGreaterThan(RINGS.to);
            world.dispose();
        });
    });

    it('hangs both moons in front of the camera, clear of the giant', () => {
        const { world } = makeWorld('Minimal');
        const cam = world.restCamera();
        [world.u.moonA.value, world.u.moonB.value].forEach((m) => {
            const p = new THREE.Vector3(m.x, m.y, m.z);
            const ndc = p.clone().project(cam);
            expect(Math.abs(ndc.x)).toBeLessThan(1);
            expect(Math.abs(ndc.y)).toBeLessThan(1);
            expect(ndc.z).toBeLessThan(1);
            expect(m.w).toBeGreaterThan(0);
            expect(p.length()).toBeGreaterThan(RINGS.to);
        });
        world.dispose();
    });

    it('draws only the parts it is asked for, and `ice` means all three classes of it', () => {
        const { world } = makeWorld('Minimal');
        world.showOnlyParts(['space']);
        expect(world.getState().parts).toEqual(['space']);
        world.showOnlyParts(['space', 'ice']);
        expect(world.getState().parts).toEqual(['space', 'boulders', 'shards', 'motes']);
        world.dispose();
    });

    it('hands the post what it asks for', () => {
        const { world, camera } = makeWorld('Minimal');
        run(world, camera, 0.2);
        const post = world.getPostState();
        expect(post).toBe(world.getPostState());
        ['flash', 'kick', 'bloomBoost', 'exposure', 'heartRadius'].forEach((key) => {
            expect(Number.isFinite(post[key]), key).toBe(true);
        });
        expect(post.heart.x).toBeGreaterThan(0);
        expect(post.heart.x).toBeLessThan(0.5);
        world.dispose();
    });
});

describe('stellar drift world: a lock', () => {
    it('lands in the rings a mote\'s flight later, in the piece\'s own colour', () => {
        const { world, camera } = makeWorld();
        expect(live(world).ripples).toBe(0);
        frame(world, camera, 1 / 60, () => lock(world, { color: COLORS.T }));
        const row = rowsOf(world, EVENT_ROWS.ripple, 1);
        // Born when the mote lands, not when the piece locked.
        expect(row[0][2]).toBeCloseTo(world.time + MOTE_FLIGHT, 5);
        const rgb = pieceColor(COLORS.T);
        for (let c = 0; c < 3; c++) expect(row[1][c]).toBeCloseTo(rgb[c], 5);
        expect(world.getState().counts.locks).toBe(1);
        // The splash is queued for the landing, and thrown then.
        expect(world.getState().queued).toBe(1);
        run(world, camera, MOTE_FLIGHT + 0.1);
        expect(world.getState().queued).toBe(0);
        world.dispose();
    });

    it('lands on ice that can carry the light, on the near arc of the rings', () => {
        const { world, camera } = makeWorld();
        const toCam = camera.position.clone().setY(0).normalize();
        for (let i = 0; i < 40; i++) {
            const u = (i * 0.37) % 1;
            const row = (i * 7) % 20;
            frame(world, camera, 1 / 60, () => lock(world, { u, rows: [row] }));
            const site = world._site;
            const r = Math.hypot(site.x, site.z);
            expect(r).toBeGreaterThan(RINGS.bInner);
            expect(r).toBeLessThan(RINGS.aOuter);
            // On the camera's side of the giant.
            expect((site.x * toCam.x + site.z * toCam.z) / r).toBeGreaterThan(0.5);
        }
        world.dispose();
    });

    it('keeps the board\'s left and right, and its floor outermost', () => {
        const { world, camera } = makeWorld();
        const screenX = (u, row) => {
            const site = world.pickRingSite(u, row, 0, { x: 0, z: 0, r: 0 });
            return { x: new THREE.Vector3(site.x, 0, site.z).project(camera).x, r: site.r };
        };
        expect(screenX(0.05, 10).x).toBeLessThan(screenX(0.5, 10).x);
        expect(screenX(0.5, 10).x).toBeLessThan(screenX(0.95, 10).x);
        expect(screenX(0.5, 19).r).toBeGreaterThan(screenX(0.5, 0).r);
        world.dispose();
    });

    it('hits harder on a hard drop', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => lock(world));
        const soft = rowsOf(world, EVENT_ROWS.ripple, 1)[0][3];
        const { world: other, camera: cam2 } = makeWorld();
        frame(other, cam2, 1 / 60, () => lock(other, { hardDrop: true }));
        expect(rowsOf(other, EVENT_ROWS.ripple, 1)[0][3]).toBeGreaterThan(soft);
        expect(other.kick).toBeGreaterThan(world.kick);
        world.dispose();
        other.dispose();
    });

    it('leaves a stain that outlives its ripple, then lets the slot go', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => lock(world));
        run(world, camera, 6, 120);
        expect(live(world).ripples).toBe(1);
        run(world, camera, RIPPLE_LIFE, 200);
        expect(live(world).ripples).toBe(0);
        world.dispose();
    });
});

describe('stellar drift world: a clear, a chain, a storm', () => {
    it('chimes the rings and writes every cleared row on its own latitude', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => clear(world, { rows: [19, 18, 17], lines: 3 }));
        const state = live(world);
        expect(state.chimes).toBe(1);
        expect(state.jets).toBe(3);
        const chime = rowsOf(world, EVENT_ROWS.chime, 1);
        expect(chime[0][2]).toBe(3); // one front per line
        const jets = rowsOf(world, EVENT_ROWS.jet, 3);
        const lats = [jets[0][0], jets[2][0], jets[4][0]];
        [19, 18, 17].forEach((row, i) => expect(lats[i]).toBeCloseTo(rowLatitude(row), 5));
        expect(world.getState().counts.clears).toBe(1);
        world.dispose();
    });

    it('answers with lightning and a flare of the aurora', () => {
        const { world, camera } = makeWorld();
        const before = world.getState().aurora;
        const { bolts } = world.getState().counts;
        frame(world, camera, 1 / 60, () => clear(world, { rows: [19, 18], lines: 2 }));
        expect(world.getState().aurora).toBeGreaterThan(before);
        expect(world.getState().counts.bolts).toBeGreaterThan(bolts);
        // The flare dies back by itself.
        run(world, camera, 12, 240);
        expect(world.getState().aurora).toBeLessThan(before + 0.05);
        world.dispose();
    });

    it('winds a spiral through the rings on a T-spin', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => clear(world, { rows: [19, 18], lines: 2, tspin: true }));
        run(world, camera, 0.2);
        expect(live(world).chimes).toBe(2);
        const rows = rowsOf(world, EVENT_ROWS.chime, 2);
        expect([rows[0][3], rows[2][3]].filter((arms) => arms >= 2)).toHaveLength(1);
        world.dispose();
    });

    it('gives a zero-line T-spin a helix without inventing a clear, row jet or combo milestone', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => clear(world, {
            rows: [], lines: 0, tspin: true, combo: 8,
        }));
        expect(live(world)).toMatchObject({ chimes: 1, jets: 0 });
        expect(world.getState().counts).toMatchObject({
            clears: 0, tspins: 1, quads: 0, milestones: 0, meteors: 0,
        });
        expect(world.getState().resonances.kinds).toEqual({ sweep: 0, helix: 1, crown: 0 });
        world.dispose();
    });

    it('celebrates true combo milestones once per player, independently of cascade depth', () => {
        const { world } = makeWorld();
        world.onCombo(8);
        expect(world.getState().resonances.emitted).toBe(0);
        clear(world, { combo: 3 });
        expect(world.getState().resonances.kinds.sweep).toBe(1);
        clear(world, { combo: 3, cascade: 99 });
        expect(world.getState().resonances.emitted).toBe(1);
        clear(world, { player: 1, combo: 3 });
        expect(world.getState().resonances.kinds.sweep).toBe(2);
        clear(world, { combo: 5 });
        clear(world, { combo: 8 });
        expect(world.getState().resonances.kinds).toEqual({ sweep: 2, helix: 1, crown: 1 });
        clear(world, { combo: 20 });
        expect(world.getState().resonances.emitted).toBe(4);
        // A fresh chain earns the milestones again while another player's combo is held.
        clear(world, { combo: 1 });
        clear(world, { combo: 3 });
        expect(world.getState().resonances.kinds.sweep).toBe(3);
        world.onCombo(0);
        clear(world, { combo: 3 });
        expect(world.getState().resonances.kinds.sweep).toBe(4);
        world.dispose();
    });

    it('echoes a cascade in staggered fronts without promoting it to a combo', () => {
        const { world } = makeWorld();
        clear(world, { combo: 1, cascade: 999 });
        const fronts = world.chimes.items.filter((item) => item.live).sort((a, b) => a.birth - b.birth);
        expect(fronts.length).toBeGreaterThan(1);
        expect(fronts.length).toBeLessThanOrEqual(CHIME_SLOTS);
        expect(fronts[0].birth).toBe(world.time);
        for (let i = 1; i < fronts.length; i++) expect(fronts[i].birth).toBeGreaterThan(fronts[i - 1].birth);
        expect(world.getState().resonances.emitted).toBe(0);
        expect(world.counts.meteors).toBeLessThanOrEqual(2);
        expect(world.combo).toBe(0);
        world.dispose();
    });

    it('distinguishes a back-to-back echo, a perfect-clear crown and a four-line storm', () => {
        const { world } = makeWorld();
        const emit = vi.spyOn(world.resonances, 'emit');
        clear(world, {
            lines: 2, rows: [19, 18], b2b: true, tspin: true,
        });
        expect(emit.mock.calls.map(([event]) => event.kind)).toEqual(['helix', 'sweep']);
        expect(emit.mock.calls[1][0].time).toBeGreaterThan(emit.mock.calls[0][0].time);
        clear(world, { lines: 1, perfect: true });
        expect(emit.mock.lastCall[0].kind).toBe('crown');
        expect(world.counts).toMatchObject({ perfects: 1, quads: 0, b2b: 1 });
        const meteorsBefore = world.counts.meteors;
        clear(world, { lines: 4, rows: [19, 18, 17, 16] });
        expect(world.counts.quads).toBe(1);
        expect(world.counts.meteors - meteorsBefore).toBeGreaterThanOrEqual(5);
        expect(world.getState().resonances.kinds).toEqual({ sweep: 1, helix: 1, crown: 1 });
        world.dispose();
    });

    it('takes a clear colour from its player even when another player locked most recently', () => {
        const { world } = makeWorld();
        lock(world, { player: 1, color: COLORS.O });
        const emit = vi.spyOn(world.resonances, 'emit');
        clear(world, { player: 0, combo: 3, color: COLORS.T });
        expect(emit.mock.lastCall[0].rgb).toEqual(pieceColor(COLORS.T));
        expect(world.jets.items.find((item) => item.live).rgb).toEqual(pieceColor(COLORS.T));
        world.dispose();
    });

    it('keeps reduced-motion rewards legible without meteors, flashes or camera kicks', () => {
        const { world, camera } = makeWorld();
        const emit = vi.spyOn(world.resonances, 'emit');
        frame(world, camera, 1 / 60, () => clear(world, { combo: 3 }));
        expect(world.flash).toBeGreaterThan(0);
        world.setReducedMotion(true);
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0 });
        world.resetSession();
        const launch = vi.spyOn(world.meteors, 'launch');
        frame(world, camera, 1 / 60, () => {
            lock(world, { hardDrop: true });
            clear(world, {
                lines: 4, rows: [19, 18, 17, 16], combo: 8, cascade: 4, tspin: true, b2b: true, perfect: true,
            });
            world.levelUp(2);
        });
        expect(launch).not.toHaveBeenCalled();
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0 });
        expect(world.getState().resonances.emitted).toBeGreaterThan(0);
        expect(emit.mock.lastCall[0].motion).toBeLessThan(0.5);
        expect(emit.mock.lastCall[0].power).toBeLessThan(1);
        run(world, camera, 3);
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0 });
        expect(world.counts.meteors).toBe(0);
        world.dispose();
    });

    it('retires fast effects already in flight when reduced motion is enabled', () => {
        const { world, camera } = makeWorld();
        const meteorsReset = vi.spyOn(world.meteors, 'reset');
        const sparksReset = vi.spyOn(world.sparks, 'reset');
        frame(world, camera, 1 / 60, () => {
            lock(world, { hardDrop: true });
            clear(world, { combo: 8, lines: 4 });
        });
        expect(world.queue.length).toBeGreaterThan(0);
        expect(world.getState().resonances.emitted).toBeGreaterThan(0);
        world.setReducedMotion(true);
        expect(meteorsReset).toHaveBeenCalledOnce();
        expect(sparksReset).toHaveBeenCalledOnce();
        expect(world.queue).toHaveLength(0);
        expect(world.getState().resonances.emitted).toBe(0);
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0 });
        // Reapplying the setting does not interrupt the gentler rewards emitted afterwards.
        clear(world, { tspin: true, lines: 0, rows: [] });
        world.setReducedMotion(true);
        expect(world.getState().resonances.kinds.helix).toBe(1);
        world.dispose();
    });

    it('brings a meteor storm and the moon\'s great vent on four lines', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => clear(world, { rows: [19], lines: 1 }));
        const few = world.getState().counts.meteors;
        const ventBefore = world.u.plume.value;
        frame(world, camera, 1 / 60, () => clear(world, { rows: [19, 18, 17, 16], lines: 4 }));
        expect(world.getState().counts.meteors - few).toBeGreaterThanOrEqual(5);
        expect(world.getState().counts.quads).toBe(1);
        expect(world.u.plume.value).toBeGreaterThan(ventBefore * 2);
        // Each meteor strikes the cloud when its flight is over.
        run(world, camera, 2.5, 150);
        expect(live(world).strikes).toBeGreaterThan(0);
        // Nothing of the storm is still in flight (the giant's own meteor may be on its way).
        expect(world.getState().queued).toBeLessThanOrEqual(1);
        world.dispose();
    });

    it('raises the aurora with the chain and lets it down when the chain breaks', () => {
        const { world, camera } = makeWorld();
        const levels = [];
        [0, 2, 5, 10].forEach((combo) => {
            world.onCombo(combo);
            run(world, camera, 6, 120);
            levels.push(world.u.aurora.value.x);
        });
        for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
        expect(levels[0]).toBeCloseTo(AURORA_REST, 2);
        // A long chain lights the second oval, and the rings hum.
        expect(world.u.aurora.value.w).toBeGreaterThan(0.5);
        expect(world.u.ringGlow.value.x).toBeGreaterThan(0.5);
        world.onCombo(0);
        run(world, camera, 8, 160);
        expect(world.u.aurora.value.x).toBeCloseTo(AURORA_REST, 2);
        expect(world.u.aurora.value.w).toBeLessThan(0.05);
        world.dispose();
    });

    it('never holds more events than it has slots for, whatever the board throws at it', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 500; i++) {
            frame(world, camera, 1 / 60, () => {
                lock(world, {
                    u: (i * 0.13) % 1, rows: [i % 20], hardDrop: i % 3 === 0, color: COLORS[['I', 'O', 'T', 'S'][i % 4]],
                });
                if (i % 5 < 2) {
                    clear(world, {
                        rows: [19, 18, 17, 16].slice(0, (i % 4) + 1), lines: (i % 4) + 1, combo: 1 + (i % 9), tspin: i % 7 === 0,
                    });
                }
                world.onCombo(i % 12);
            });
            const state = live(world);
            expect(state.ripples).toBeLessThanOrEqual(RIPPLE_SLOTS);
            expect(state.chimes).toBeLessThanOrEqual(CHIME_SLOTS);
            expect(state.jets).toBeLessThanOrEqual(JET_SLOTS);
            expect(state.strikes).toBeLessThanOrEqual(STRIKE_SLOTS);
            expect(state.bolts).toBeLessThanOrEqual(BOLT_SLOTS);
        }
        // Everything queued comes due: nothing waits for ever.
        world.onCombo(0);
        run(world, camera, 4, 240);
        expect(world.getState().queued).toBe(0);
        world.u.events.array.forEach((v) => {
            [v.x, v.y, v.z, v.w].forEach((n) => expect(Number.isFinite(n)).toBe(true));
        });
        world.dispose();
    });

    it('bounds delayed landings even when many clears arrive without an intervening frame', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 100; i++) {
            lock(world);
            clear(world, {
                lines: 4, rows: [19, 18, 17, 16], combo: 8, cascade: 99, perfect: true,
            });
        }
        expect(world.queue.length).toBeLessThanOrEqual(RIPPLE_SLOTS + METEOR_SLOTS);
        expect(world.chimes.items).toHaveLength(CHIME_SLOTS);
        run(world, camera, 2);
        expect(world.queue).toHaveLength(0);
        world.dispose();
    });

    it('goes back to rest on a new run, without stopping the giant or the hour', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => {
            lock(world);
            clear(world, {
                rows: [19, 18, 17, 16], lines: 4, combo: 5, tspin: true,
            });
            world.onCombo(6);
        });
        run(world, camera, 1, 60);
        const { spin, flow, place } = world;
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.getState().resonances).toEqual({ active: 0, emitted: 0, kinds: { sweep: 0, helix: 0, crown: 0 } });
        expect(world.getState().queued).toBe(0);
        expect(world.spin).toBe(spin);
        expect(world.flow).toBe(flow);
        frame(world, camera, 1 / 60);
        expect(live(world)).toMatchObject({
            ripples: 0, chimes: 0, jets: 0, strikes: 0,
        });
        // The wheel did not jump.
        expect(Math.abs(world.place - place)).toBeLessThan(0.01);
        // Session reset also restores eligibility for the same milestone.
        clear(world, { combo: 5 });
        expect(world.getState().resonances.kinds.helix).toBe(1);
        world.dispose();
    });
});

describe('stellar drift world: the hour', () => {
    it('rests on a level\'s own palette, and hands the shaders its colours and its sun', () => {
        for (let level = 1; level <= PALETTE_COUNT + 1; level++) {
            const { world, camera } = makeWorld('Minimal', { at: 0 });
            world.levelUp(level, { silent: true });
            frame(world, camera, 0);
            const palette = PALETTES[(level - 1) % PALETTE_COUNT];
            expect(world.getState().palette).toBe(palette.name);
            ['gasA', 'gasB', 'haze', 'storm', 'auroraLow'].forEach((key) => {
                const v = world.u[key].value;
                expect(v.x).toBeCloseTo(palette[key][0], 5);
                expect(v.y).toBeCloseTo(palette[key][1], 5);
                expect(v.z).toBeCloseTo(palette[key][2], 5);
            });
            const sun = sunDirection(level - 1);
            expect(world.u.sunDir.value.x).toBeCloseTo(sun[0], 5);
            expect(world.u.sunDir.value.y).toBeCloseTo(sun[1], 5);
            expect(Math.floor(world.u.bandPlace.value)).toBe((level - 1) % PALETTE_COUNT);
            world.dispose();
        }
    });

    it('drifts with the clock alone: no level change, and a step later it stands on the next palette', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        expect(world.getState().palette).toBe(PALETTES[0].name);
        const first = world.u.gasA.value.clone();
        // Within the first minute the colours are already on their way.
        run(world, camera, 60, 240);
        expect(world.level).toBe(1);
        expect(world.getState().paletteMix).toBeGreaterThan(0.05);
        expect(world.u.gasA.value.distanceTo(first)).toBeGreaterThan(0.01);
        run(world, camera, PALETTE_STEP - 60, 120);
        expect(world.getState().palette).toBe(PALETTES[1].name);
        expect(world.getState().place).toBeCloseTo(1, 2);
        // The sun has moved with it.
        const sun = sunDirection(world.place);
        expect(world.u.sunDir.value.x).toBeCloseTo(sun[0], 5);
        world.dispose();
    });

    it('takes a level-up as one step on top of the clock, eased, and rings it in', () => {
        const { world, camera } = makeWorld('Minimal', { at: 20 });
        const before = world.place;
        const { chimes } = live(world);
        frame(world, camera, 1 / 60, () => world.levelUp(2));
        expect(live(world).chimes).toBe(chimes + 1);
        // Not a jump.
        expect(world.place - before).toBeLessThan(0.2);
        run(world, camera, 14, 280);
        const clock = palettePlace(0, world.time) - palettePlace(0, 20);
        expect(world.place - before - clock).toBeCloseTo(1, 2);
        // The same level again changes nothing; a rebuilt scene takes its level up at once.
        const held = world.levelPlace;
        world.levelUp(2);
        expect(world.levelPlace).toBe(held);
        world.levelUp(5, { silent: true });
        expect(world.levelPlace).toBe(4);
        world.dispose();
    });

    it('turns the giant and runs its weather on clocks a capture can seek', () => {
        const { world, camera } = makeWorld('Minimal', { at: 100 });
        const { spin, flow } = world;
        run(world, camera, 10, 200);
        expect(world.spin).toBeGreaterThan(spin);
        expect(world.flow).toBeGreaterThan(flow);
        // Sought straight to the same moment, at rest, the clocks agree with the run.
        const { world: other, camera: cam2 } = makeWorld('Minimal', { at: 110 });
        expect(other.spin).toBeCloseTo(world.spin, 6);
        expect(other.flow).toBeCloseTo(world.flow, 6);
        expect(cam2.position.distanceTo(camera.position)).toBeLessThan(1e-6);
        // Reduced motion slows them; it does not stop the hour.
        const { world: calm, camera: cam3 } = makeWorld('Minimal', { at: 0 });
        calm.setReducedMotion(true);
        const s0 = calm.spin;
        run(calm, cam3, 10, 200);
        expect(calm.spin - s0).toBeLessThan((world.spin - spin) * 0.5);
        expect(calm.place).toBeCloseTo(palettePlace(0, 10), 6);
        world.dispose();
        other.dispose();
        calm.dispose();
    });
});

describe('stellar drift world: a capture can be repeated', () => {
    it('varies meteor bearings while repeating the same seed and event sequence exactly', () => {
        const { world } = makeWorld();
        const paths = [];
        vi.spyOn(world.meteors, 'launch').mockImplementation(({ from, to }) => {
            const direction = from.clone().sub(to);
            paths.push([direction.dot(world._right), direction.dot(world._up)]);
        });
        const storm = () => clear(world, { rows: [19, 18, 17, 16], lines: 4, combo: 8 });
        storm();
        const first = paths.splice(0);
        expect(first.some(([x]) => x > 0)).toBe(true);
        expect(first.some(([x]) => x < 0)).toBe(true);
        world.seek(10);
        storm();
        expect(paths).toEqual(first);
        world.dispose();
    });

    it('replays the same events from the same seek to the same frame', () => {
        const play = () => {
            const { world, camera } = makeWorld('Low', { at: 31 });
            world.onCombo(4);
            for (let i = 0; i < 90; i++) {
                frame(world, camera, 1 / 30, () => {
                    if (i % 9 === 0) lock(world, { u: (i * 0.21) % 1, rows: [19 - (i % 6)], hardDrop: i % 2 === 0 });
                    if (i === 30) clear(world, { rows: [19, 18], lines: 2, combo: 2 });
                    if (i === 50) clear(world, { rows: [19, 18, 17, 16], lines: 4, combo: 3 });
                    if (i === 60) world.levelUp(2);
                });
            }
            const out = {
                state: JSON.stringify(world.getState()),
                rows: JSON.stringify(world.u.events.array.map((v) => [v.x, v.y, v.z, v.w])),
                counts: world.u.counts.value.toArray(),
                camera: camera.position.toArray(),
            };
            world.dispose();
            return out;
        };
        expect(play()).toEqual(play());
    });

    it('aims at where the solo board would be when no board is on screen', () => {
        const { world, camera } = makeWorld('Minimal', { layout: null });
        expect(() => frame(world, camera, 1 / 60, () => {
            lock(world);
            clear(world);
        })).not.toThrow();
        expect(live(world).chimes).toBe(1);
        // A click in the meditation mode carries a screen point and no board.
        expect(() => frame(world, camera, 1 / 60, () => world.onLock({
            player: 0, rows: [10], u: 0.5, color: null, screen: { x: 0.3, y: 0.6 },
        }))).not.toThrow();
        world.dispose();
    });
});
