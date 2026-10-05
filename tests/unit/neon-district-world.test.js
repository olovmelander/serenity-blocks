import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BLACKOUT_HOLD, CRUISE_SPEED, DISTRICT_PALETTES, NeonDistrictWorld, REST_RIG, SCROLL_REBASE, fovForAspect,
    pieceColor, powerForCombo,
} from '../../src/themes/neon-district/neon-district-world.js';
import {
    CLEAR_SLOTS, CLEAR_TRAVEL, LOCK_SLOTS, STREET,
} from '../../src/themes/neon-district/neon-district-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/neon-district/neon-district-quality.js';
import { fallbackLayout } from '../../src/themes/neon-district/neon-district-composition.js';
import {
    DRAGON, DRAGON_FLIGHT, DRAGON_LANE, DRAGON_OVERHEAD, dragonPath, sparkHeight,
} from '../../src/themes/neon-district/neon-district-fx.js';
import { KIT_KINDS, KIT_PIECES } from '../../src/themes/neon-district/neon-district-kit.js';

function makeWorld(quality = 'Minimal', { width = 1600, height = 900, live = true } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new NeonDistrictWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    if (live) world.setLayout(fallbackLayout(width, height), width / height);
    world.seek(10);
    world.updateCamera(camera, { time: 10, delta: 0 });
    world.update({ time: 10, delta: 0 }, camera);
    return { scene, camera, world };
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

describe('neon district world: build', () => {
    it('builds every tier from node materials only, with the parts its tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) materials.add(object.material);
            });
            expect(materials.size).toBeGreaterThan(10);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                expect(material.fog, material.name).toBe(false); // the atmosphere is in every material
            }
            for (const part of ['sky', 'mega', 'facades', 'street', 'shopfronts', 'signs', 'screens', 'rain', 'sparks', 'beams']) {
                expect(world.parts[part], `${quality}.${part}`).toBeTruthy();
            }
            expect(Boolean(world.reflection), `${quality} mirror`).toBe(tier.reflection > 0);
            expect(Boolean(world.parts.halos)).toBe(tier.halos);
            expect(Boolean(world.dragon)).toBe(tier.drones > 0);
            expect(world.parts.rain.geometry.instanceCount).toBe(tier.rain);
            expect(world.sparks.count).toBe(tier.sparks);
            // Weather and the row beams are for the camera only: the street's mirror skips layer 1.
            expect(world.parts.rain.mesh.layers.mask).toBe(2);
            expect(world.parts.beams.mesh.layers.mask).toBe(2);
            expect(world.parts.facades.mesh.layers.mask).toBe(1);
            world.dispose();
        }
    });

    it('lets the camera see the weather and keeps it out of the mirror', () => {
        const { camera, world } = makeWorld('High');
        expect(camera.layers.test(world.parts.rain.mesh.layers)).toBe(true);
        const mirror = world.reflection.reflector.getVirtualCamera(camera);
        expect(mirror.layers.test(world.parts.rain.mesh.layers)).toBe(false);
        expect(mirror.layers.test(world.parts.facades.mesh.layers)).toBe(true);
        world.dispose();
    });

    it('never needs a frustum test or a matrix update for its instanced parts', () => {
        const { world } = makeWorld('High');
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.frustumCulled, name).toBe(false);
        });
        world.dispose();
    });

    it('removes itself from the scene and survives a second dispose', () => {
        const { scene, world } = makeWorld('Medium');
        expect(scene.children).toContain(world.root);
        world.dispose();
        expect(scene.children).not.toContain(world.root);
        expect(() => world.dispose()).not.toThrow();
        expect(() => world.update({ time: 11, delta: 0.016 })).not.toThrow();
        expect(() => world.onLock({ u: 0.5 })).not.toThrow();
        expect(() => world.onClear({ lines: 4 })).not.toThrow();
    });

    it('builds kit pieces with finite geometry, a shade and a lamp mask', () => {
        for (const kind of KIT_KINDS) {
            const geometry = KIT_PIECES[kind]();
            const position = geometry.getAttribute('position');
            const mask = geometry.getAttribute('aMask');
            expect(position.count, kind).toBeGreaterThan(8);
            expect(mask.count, kind).toBe(position.count);
            expect(geometry.getAttribute('normal').count, kind).toBe(position.count);
            for (let i = 0; i < position.array.length; i++) expect(Number.isFinite(position.array[i]), kind).toBe(true);
            const index = geometry.getIndex();
            for (let i = 0; i < index.count; i++) expect(index.array[i]).toBeLessThan(position.count);
            for (let i = 0; i < mask.count; i++) {
                expect(mask.array[i * 2]).toBeGreaterThan(0);
                expect(mask.array[i * 2]).toBeLessThanOrEqual(1);
                expect(mask.array[i * 2 + 1]).toBeGreaterThanOrEqual(0);
                expect(mask.array[i * 2 + 1]).toBeLessThanOrEqual(1);
            }
            geometry.dispose();
        }
    });
});

describe('neon district world: camera', () => {
    it('holds a ninety-degree horizontal view, clamped for very wide and very tall frames', () => {
        expect(fovForAspect(16 / 9)).toBeCloseTo(58.7, 1);
        expect(fovForAspect(4 / 3)).toBeCloseTo(73.7, 1);
        expect(fovForAspect(21 / 9)).toBe(REST_RIG.minFov);
        expect(fovForAspect(9 / 19.5)).toBe(REST_RIG.maxFov);
        expect(fovForAspect(NaN)).toBeCloseTo(58.7, 1);
    });

    it('stands in the street looking up the canyon, with the vanishing point behind the card', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(Math.abs(camera.position.x)).toBeLessThan(1.5);
        expect(camera.position.y).toBeGreaterThan(2.5);
        expect(camera.position.y).toBeLessThan(3.5);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        expect(forward.z).toBeLessThan(-0.95);
        expect(forward.y).toBeGreaterThan(0.08); // looking up
        const card = world.layout.cards[0];
        expect(world.heart.x).toBeGreaterThan(card.x0);
        expect(world.heart.x).toBeLessThan(card.x1);
        expect(world.heart.y).toBeGreaterThan(0.5); // the horizon sits low: the street owns the bottom third
        expect(world.heart.y).toBeLessThan(0.75);
        world.dispose();
    });

    it('finds the street under a screen point and falls back above the horizon', () => {
        const { world } = makeWorld('Minimal');
        const strike = world.screenToStreet(0.5, 0.95, { x: 0, z: 0 });
        expect(strike.z).toBeLessThan(-3);
        expect(strike.z).toBeGreaterThan(-20);
        expect(Math.abs(strike.x)).toBeLessThan(1.5);
        // Left of centre on screen is left in the street.
        expect(world.screenToStreet(0.2, 0.9, { x: 0, z: 0 }).x).toBeLessThan(-1);
        // A point in the sky has no street under it: nine metres ahead instead.
        const sky = world.screenToStreet(0.5, 0.1, { x: 0, z: 0 });
        expect(Math.hypot(sky.x, sky.z)).toBeCloseTo(9, 1);
        world.dispose();
    });

    it('flows the city at cruise speed and stops everything that moves the eye under reduced motion', () => {
        const { camera, world } = makeWorld('Minimal');
        const s0 = world.scroll;
        run(world, camera, 2);
        expect(world.scroll - s0).toBeCloseTo(CRUISE_SPEED * 2, 3);
        world.setReducedMotion(true);
        const s1 = world.scroll;
        run(world, camera, 3);
        expect(world.scroll).toBe(s1);
        expect(camera.position.x).toBe(0);
        expect(camera.position.y).toBe(REST_RIG.height);
        // Feedback stays: a lock still writes its ring.
        world.onLock({ u: 0.5, color: '#ff2ea6' });
        expect(world.u.lockA[0].value.w).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('neon district world: locks', () => {
    it('lands a lock in the street under the board, anchored to the flowing city', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ rows: [19], u: 0.9, color: '#ff2ea6' });
        const slot = world.u.lockA[0].value;
        expect(slot.z).toBe(world.time);
        expect(slot.w).toBeCloseTo(0.8, 6);
        // Right of the board's centre lands right of the street's centre line, a few metres ahead.
        expect(slot.x).toBeGreaterThan(0);
        expect(slot.y + world.scroll).toBeLessThan(-3);
        expect(slot.y + world.scroll).toBeGreaterThan(-25);
        // The anchor rides the scroll: later, the shaders rebuild the same street point.
        const anchored = slot.y;
        run(world, camera, 0.5);
        expect(world.u.lockA[0].value.y).toBe(anchored);
        const left = world.u.lockA[1].value;
        world.onLock({ rows: [19], u: 0.05 });
        expect(left.x).toBeLessThan(0);
        world.dispose();
    });

    it('hits harder on a hard drop and kicks the camera', () => {
        const { world } = makeWorld('Low');
        world.onLock({ u: 0.5 });
        const soft = world.kick;
        world.onLock({ u: 0.5, hardDrop: true });
        expect(world.u.lockA[1].value.w).toBeGreaterThan(world.u.lockA[0].value.w);
        expect(world.kick).toBeGreaterThan(soft);
        world.dispose();
    });

    it('reuses its lock slots as a ring and throws sparks from a fixed pool', () => {
        const { world } = makeWorld('Low');
        const births = world.sparks.geometry.getAttribute('aBirth');
        const { version } = births;
        for (let i = 0; i < LOCK_SLOTS + 2; i++) world.onLock({ u: i / 6, color: '#20e0d0' });
        expect(world.counts.locks).toBe(LOCK_SLOTS + 2);
        expect(world.u.lockA).toHaveLength(LOCK_SLOTS);
        expect(births.version).toBeGreaterThan(version);
        expect(births.count).toBe(QUALITY.Low.sparks);
        let alive = 0;
        for (let i = 0; i < births.count; i++) if (births.array[i * 4 + 3] > -50) alive += 1;
        expect(alive).toBeGreaterThan(0);
        expect(alive).toBeLessThanOrEqual(QUALITY.Low.sparks);
        world.dispose();
    });

    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        const rose = pieceColor('#ff2ea6');
        expect(Math.max(...rose)).toBeCloseTo(1, 6);
        expect(Math.min(...rose)).toBeGreaterThanOrEqual(0.06);
        expect(rose[0]).toBeGreaterThan(rose[2]);
        expect(rose[2]).toBeGreaterThan(rose[1]);
        expect(pieceColor(0x0000ff)[2]).toBeCloseTo(1, 6);
        // Nonsense falls back to the given colour.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 6);
        expect(pieceColor(null)).toEqual(pieceColor(0x22e4ff));
    });
});

describe('neon district world: clears, combos and the four-line overdrive', () => {
    it('sends a wave with one front per line and fires the cleared rows out of the card', () => {
        const { world } = makeWorld('Low');
        world.onClear({ rows: [19, 18], lines: 2, combo: 1 });
        const slot = world.u.clearA[0].value;
        expect(slot.x).toBe(world.time);
        expect(slot.y).toBe(2);
        expect(slot.z).toBeGreaterThan(0.5);
        expect(slot.w).toBe(0);
        const beams = world.beams.uniforms;
        const board = world.layout.boards[0];
        const card = world.layout.cards[0];
        expect(beams.frame.value.x).toBeCloseTo(card.x0, 9);
        expect(beams.frame.value.y).toBeCloseTo(card.x1, 9);
        expect(beams.frame.value.z).toBe(world.time);
        // Row 19 is the floor row; row 18 the one above it.
        expect(beams.rows.value.x).toBeGreaterThan(beams.rows.value.y);
        expect(beams.rows.value.x).toBeLessThan(board.y1);
        expect(beams.rows.value.z).toBe(-1);
        world.dispose();
    });

    it('keeps the row beams dark when no board is on screen', () => {
        const { world } = makeWorld('Low', { live: false });
        world.onClear({ lines: 2 });
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(0);
        world.dispose();
    });

    it('answers one, two and three lines in different colours and reuses its slots', () => {
        const { world } = makeWorld('Low');
        world.onClear({ lines: 1 });
        const one = world.u.clearC[0].value.clone();
        world.onClear({ lines: 2 });
        const two = world.u.clearC[1].value.clone();
        expect(one.distanceTo(two)).toBeGreaterThan(0.5);
        world.onClear({ lines: 3 });
        expect(world.u.clearA).toHaveLength(CLEAR_SLOTS);
        expect(world.u.clearA[0].value.y).toBe(3);
        // Three lines: both accents at once, the least saturated of the three.
        const three = world.u.clearC[0].value;
        expect(Math.min(three.x, three.y, three.z)).toBeGreaterThan(Math.min(one.x, one.y, one.z));
        world.dispose();
    });

    it('kicks the camera when the wave arrives, not when it leaves', () => {
        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 2 });
        run(world, camera, CLEAR_TRAVEL * 0.5);
        expect(world.kick).toBeLessThan(0.05);
        const restRays = world.getPostState().rays;
        run(world, camera, CLEAR_TRAVEL * 0.45);
        expect(world.kick).toBeGreaterThan(0.2);
        expect(world.getPostState().rays).toBeGreaterThan(restRays);
        world.dispose();
    });

    it('charges with the combo, counts it in the hologram and drains when the chain breaks', () => {
        const { camera, world } = makeWorld('Low');
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(5)).toBeGreaterThan(powerForCombo(2));
        expect(powerForCombo(50)).toBeLessThanOrEqual(1);
        world.onCombo(1);
        run(world, camera, 1);
        expect(world.counterShown).toBeLessThan(0.01); // a single clear is not a chain
        world.onCombo(4);
        expect(world.counterPunch).toBe(1);
        run(world, camera, 2.5);
        expect(world.power).toBeGreaterThan(powerForCombo(4) * 0.95);
        expect(world.u.power.value).toBe(world.power);
        expect(world.counterShown).toBeGreaterThan(0.95);
        expect(world.counter.uniforms.state.value.x).toBe(4);
        // The city flows faster and the palette warms.
        expect(world.heat).toBeGreaterThan(0.3);
        const s0 = world.scroll;
        run(world, camera, 1);
        expect(world.scroll - s0).toBeGreaterThan(CRUISE_SPEED * 1.5);
        world.onCombo(0);
        expect(world.dip).toBeGreaterThan(0);
        run(world, camera, 8);
        expect(world.power).toBeLessThan(0.01);
        expect(world.counterShown).toBeLessThan(0.01);
        // The hologram keeps the last number while it fades.
        expect(world.counter.uniforms.state.value.x).toBe(4);
        world.dispose();
    });

    it('blacks the district out on four lines, then brings the wave back gold with the dragon', () => {
        const { camera, world } = makeWorld('High');
        world.onClear({ lines: 4, combo: 2 });
        const slot = world.u.clearA[0].value;
        expect(slot.w).toBe(1);
        expect(slot.y).toBe(4);
        // The wave waits for the lights to come back.
        expect(slot.x).toBeCloseTo(world.time + BLACKOUT_HOLD, 9);
        run(world, camera, BLACKOUT_HOLD * 0.5);
        expect(world.u.neon.value).toBeLessThan(0.1);
        expect(world.getPostState().rays).toBeLessThan(0.1);
        run(world, camera, BLACKOUT_HOLD);
        expect(world.u.neon.value).toBeGreaterThan(1.2);
        expect(world.overdrive).toBeGreaterThan(0.8);
        expect(world.u.heat.value).toBeGreaterThan(0.5);
        // The iris closes as the district flares.
        expect(world.getPostState().exposure).toBeLessThan(0.8);
        const gold = world.u.clearC[0].value;
        expect(gold.x).toBeGreaterThan(gold.y);
        expect(gold.y).toBeGreaterThan(gold.z);
        // The dragon is in the street, and the district stays warm for as long as it is.
        expect(world.getState().dragon).toBe(true);
        expect(world.dragon.uniforms.flight.value.y).toBe(1);
        run(world, camera, DRAGON_FLIGHT * 0.8);
        expect(world.overdrive).toBeGreaterThanOrEqual(0.3);
        run(world, camera, DRAGON_FLIGHT);
        expect(world.getState().dragon).toBe(false);
        run(world, camera, 12);
        expect(world.overdrive).toBeLessThan(0.02);
        expect(world.getPostState().exposure).toBeGreaterThan(0.99);
        expect(world.counts.quads).toBe(1);
        world.dispose();
    });

    it('sends the dragon beside the card on a wide frame and over it on a tall one', () => {
        const wide = makeWorld('High');
        expect(wide.world.dragonLane()).toBe(DRAGON_LANE);
        wide.world.dispose();
        const tall = makeWorld('High', { width: 430, height: 932 });
        expect(tall.world.dragonLane()).toBe(DRAGON_OVERHEAD);
        tall.world.onCombo(5);
        run(tall.world, tall.camera, 2);
        // No room beside the card for the hologram either.
        expect(tall.world.counterShown).toBeLessThan(0.01);
        tall.world.dispose();
    });

    it('hangs the combo hologram right of the cards, clear of the dragon\'s lane', () => {
        const { camera, world } = makeWorld('High');
        world.onCombo(3);
        run(world, camera, 1);
        const zones = world.freeZones();
        expect(zones.right).toBeGreaterThan(0.2);
        const place = world.counter.uniforms.place.value;
        const projected = new THREE.Vector3(place.x, place.y, place.z).project(camera);
        const sx = projected.x * 0.5 + 0.5;
        expect(sx).toBeGreaterThan(zones.rightEdge);
        expect(sx).toBeLessThan(1);
        expect(place.w).toBeGreaterThan(1.4);
        expect(place.w).toBeLessThanOrEqual(3.3);
        world.dispose();
    });

    it('glitches the signs on a T-spin and lets it die away', () => {
        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 2, tspin: true });
        expect(world.glitch).toBe(1);
        run(world, camera, 2);
        expect(world.u.glitch.value).toBeLessThan(0.01);
        world.dispose();
    });

    it('changes the district\'s colours with the level and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Low');
        const before = world.u.accentA.value.clone();
        world.levelUp(2);
        expect(world.getState().palette).toBe(DISTRICT_PALETTES[1].name);
        run(world, camera, 6);
        expect(world.u.accentA.value.distanceTo(before)).toBeGreaterThan(0.2);
        world.levelUp(DISTRICT_PALETTES.length + 1);
        expect(world.getState().palette).toBe(DISTRICT_PALETTES[0].name);
        world.levelUp(3, { silent: true });
        expect(world.getState().palette).toBe(DISTRICT_PALETTES[2].name);
        world.dispose();
    });
});

describe('neon district world: time', () => {
    it('reaches the same state at 30 and at 240 frames a second', () => {
        const script = (world, camera, fps) => {
            world.onLock({ u: 0.3, hardDrop: true, color: '#ffd21a' });
            world.onClear({ lines: 2, combo: 3 });
            world.onCombo(3);
            run(world, camera, 1.5, Math.round(1.5 * fps));
            world.onClear({ lines: 4, combo: 4 });
            world.onCombo(4);
            run(world, camera, 2, Math.round(2 * fps));
        };
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        script(slow.world, slow.camera, 30);
        script(fast.world, fast.camera, 240);
        expect(slow.world.time).toBeCloseTo(fast.world.time, 9);
        expect(slow.world.power).toBeCloseTo(fast.world.power, 3);
        expect(slow.world.overdrive).toBeCloseTo(fast.world.overdrive, 2);
        expect(slow.world.heat).toBeCloseTo(fast.world.heat, 1);
        expect(slow.world.scroll).toBeCloseTo(fast.world.scroll, 0);
        expect(slow.world.u.neon.value).toBeCloseTo(fast.world.u.neon.value, 2);
        // Event slots hold timestamps: they are identical whatever the frame rate.
        expect(slow.world.u.clearA[1].value.toArray()).toEqual(fast.world.u.clearA[1].value.toArray());
        slow.world.dispose();
        fast.world.dispose();
    });

    it('drops every event in flight when it seeks, and keeps the city flowing through a new run', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4 });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1);
        const { scroll } = world;
        world.resetSession();
        expect(world.scroll).toBe(scroll);
        expect(world.getState()).toMatchObject({
            combo: 0, power: 0, overdrive: 0, level: 1, dragon: false,
        });
        for (let i = 0; i < LOCK_SLOTS; i++) expect(world.u.lockA[i].value.w).toBe(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.clearA[i].value.z).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(world.dragon.uniforms.flight.value.y).toBe(0);
        world.seek(40);
        expect(world.time).toBe(40);
        expect(world.scroll).toBeCloseTo(40 * CRUISE_SPEED, 9);
        world.dispose();
    });

    it('rebases the scroll by whole periods, and never while a lock is anchored to it', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(SCROLL_REBASE % STREET.period).toBe(0);
        world.scroll = SCROLL_REBASE + 5;
        world.onLock({ u: 0.5 });
        const anchored = world.u.lockA[0].value.y;
        run(world, camera, 2);
        // The ring is still riding the scroll: no rebase yet.
        expect(world.scroll).toBeGreaterThan(SCROLL_REBASE);
        expect(world.u.lockA[0].value.y + world.scroll).toBeCloseTo(anchored + world.scroll, 9);
        run(world, camera, 4);
        expect(world.scroll).toBeLessThan(SCROLL_REBASE);
        expect(world.scroll).toBeGreaterThan(0);
        expect(world.u.scroll.value).toBe(world.scroll);
        world.dispose();
    });

    it('returns to its exact resting look long after the last event', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        world.onLock({ u: 0.5, hardDrop: true });
        world.onClear({ lines: 3 });
        run(world, camera, 30, 600);
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.rays).toBeCloseTo(rest.rays, 6);
        expect(post.streak).toBeCloseTo(rest.streak, 6);
        expect(post.exposure).toBeCloseTo(1, 6);
        expect(world.u.neon.value).toBeCloseTo(1, 6);
        world.dispose();
    });
});

describe('neon district effects: closed forms', () => {
    it('throws a spark up, bounces it once lower, and lets it skid', () => {
        const vy = 4.5;
        const airborne = (2 * vy) / 9;
        expect(sparkHeight(vy, 0)).toBe(0);
        expect(sparkHeight(vy, airborne / 2)).toBeCloseTo((vy * vy) / 18, 6);
        expect(sparkHeight(vy, airborne)).toBeCloseTo(0, 6);
        const firstPeak = sparkHeight(vy, airborne / 2);
        const secondPeak = sparkHeight(vy, airborne + (airborne * 0.4) / 2);
        expect(secondPeak).toBeGreaterThan(0);
        expect(secondPeak).toBeLessThan(firstPeak * 0.25);
        expect(sparkHeight(vy, airborne * 3)).toBe(0);
    });

    it('swims the dragon out of the haze on the centre line, across to its lane and up over the camera', () => {
        const start = dragonPath(0);
        expect(start.x).toBeCloseTo(0, 6);
        expect(start.z).toBe(DRAGON.start);
        const mid = dragonPath(60);
        expect(Math.abs(mid.x - DRAGON_LANE[0])).toBeLessThan(1);
        expect(Math.abs(mid.y - DRAGON_LANE[1])).toBeLessThan(1.5);
        const end = dragonPath(DRAGON.travel + 6);
        expect(end.z).toBeGreaterThan(20);
        expect(end.y).toBeGreaterThan(mid.y + 5);
        // Inside the canyon all the way: never through a wall.
        for (let d = 0; d <= DRAGON.travel; d += 4) {
            expect(Math.abs(dragonPath(d).x) + DRAGON.radius).toBeLessThan(STREET.halfStreet);
            expect(dragonPath(d).y).toBeGreaterThan(5);
        }
        const overhead = dragonPath(60, DRAGON_OVERHEAD);
        expect(Math.abs(overhead.x)).toBeLessThan(1);
        expect(overhead.y).toBeGreaterThan(18);
        expect(DRAGON_FLIGHT).toBeCloseTo((DRAGON.travel + DRAGON.length) / DRAGON.speed, 9);
    });
});
