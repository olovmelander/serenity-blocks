import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CROWN_RADIUS_MAX, FLAKE_DISTANCE, ICE_TEMPLE_PARTS, IceTempleWorld, RESONANCE_STEP, REST_RIG, SNOW_FALL,
    SNOW_TURN, fovForAspect,
} from '../../src/themes/ice-temple/ice-temple-world.js';
import {
    AURORA_PALETTES, CLEAR_SLOTS, CLEAR_TRAVEL, CROWN_LIFE, CROWN_SPIKES, FLAKE_LIFE, HUSH_HOLD, LOCK_SLOTS, NAVE,
    linRGB,
} from '../../src/themes/ice-temple/ice-temple-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/ice-temple/ice-temple-quality.js';
import { cardUnion, fallbackLayout } from '../../src/themes/ice-temple/ice-temple-composition.js';
import { CROWN_SLOTS, chipHeight, crownRise } from '../../src/themes/ice-temple/ice-temple-fx.js';

// Every test here builds the whole temple (55,000 triangles and a baked noise texture). Alone
// that is a fraction of a second; in the full suite on a loaded machine it can be several.
vi.setConfig({ testTimeout: 20000 });

function makeWorld(quality = 'Minimal', { width = 1600, height = 900, live = true } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new IceTempleWorld({ scene, quality, capture: true }).build();
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

describe('ice temple world: build', () => {
    it('builds every tier from node materials only, with the parts its tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) materials.add(object.material);
            });
            expect(materials.size).toBeGreaterThan(8);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                expect(material.fog, material.name).toBe(false); // the atmosphere is in every material
            }
            for (const part of ['sky', 'mountains', 'aurora', 'architecture', 'floor', 'flake', 'snow', 'dust', 'chips', 'beams']) {
                expect(world.parts[part], `${quality}.${part}`).toBeTruthy();
            }
            Object.keys(world.parts).forEach((name) => expect(ICE_TEMPLE_PARTS).toContain(name));
            expect(Boolean(world.reflection), `${quality} mirror`).toBe(tier.reflection > 0);
            expect(Boolean(world.parts.mist)).toBe(tier.mist > 0);
            expect(Boolean(world.crown)).toBe(tier.crown);
            expect(world.parts.aurora.count).toBe(tier.curtains);
            expect(world.parts.snow.geometry.instanceCount).toBe(tier.snow);
            expect(world.parts.dust.geometry.instanceCount).toBe(tier.dust);
            expect(world.chips.count).toBe(tier.shards);
            // The air and the row beams are for the camera only: the ice's mirror skips layer 1.
            expect(world.parts.snow.mesh.layers.mask).toBe(2);
            expect(world.parts.beams.mesh.layers.mask).toBe(2);
            expect(world.parts.chips.mesh.layers.mask).toBe(2);
            // What stands in the temple stands in the mirror too — the Great Snowflake included.
            expect(world.parts.architecture.mesh.layers.mask).toBe(1);
            expect(world.parts.aurora.mesh.layers.mask).toBe(1);
            expect(world.parts.flake.mesh.layers.mask).toBe(1);
            world.dispose();
        }
    }, 30000); // six builds: room for a loaded machine

    it('lets the camera see the snow and keeps it out of the mirror', () => {
        const { camera, world } = makeWorld('High');
        expect(camera.layers.test(world.parts.snow.mesh.layers)).toBe(true);
        const mirror = world.reflection.reflector.getVirtualCamera(camera);
        expect(mirror.layers.test(world.parts.snow.mesh.layers)).toBe(false);
        expect(mirror.layers.test(world.parts.architecture.mesh.layers)).toBe(true);
        world.dispose();
    });

    it('never needs a frustum test or a matrix update for any part', () => {
        const { world } = makeWorld('High');
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.frustumCulled, name).toBe(false);
            expect(world.parts[name].mesh.matrixAutoUpdate, name).toBe(false);
        });
        world.dispose();
    });

    it('merges the whole temple into one flat-shaded geometry of finite numbers', () => {
        const { world } = makeWorld('High');
        const { geometry, triangles } = world.parts.architecture;
        expect(triangles).toBeGreaterThan(20000);
        expect(triangles).toBeLessThan(120000);
        expect(geometry.index).toBeNull();
        const position = geometry.getAttribute('position');
        expect(position.count).toBe(triangles * 3);
        for (const name of ['position', 'normal', 'aSmooth', 'aInfo', 'aSt']) {
            const { array } = geometry.getAttribute(name);
            let ok = true;
            for (let i = 0; i < array.length; i++) {
                if (!Number.isFinite(array[i])) ok = false;
            }
            expect(ok, name).toBe(true);
        }
        // Flat shading: the three corners of a face share one unit normal.
        const normal = geometry.getAttribute('normal').array;
        for (let f = 0; f < 600; f += 37) {
            const i = f * 9;
            expect(Math.hypot(normal[i], normal[i + 1], normal[i + 2])).toBeCloseTo(1, 4);
            expect(normal[i]).toBe(normal[i + 3]);
            expect(normal[i + 1]).toBe(normal[i + 7]);
        }
        world.dispose();
    });

    it('removes itself from the scene and survives a second dispose', () => {
        const { scene, world } = makeWorld('High');
        expect(scene.children).toContain(world.root);
        world.dispose();
        expect(scene.children).not.toContain(world.root);
        expect(world.u).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        expect(() => world.update({ time: 11, delta: 0.016 })).not.toThrow();
        expect(() => world.onLock({ u: 0.5 })).not.toThrow();
        expect(() => world.onClear({ lines: 2 })).not.toThrow();
    });
});

describe('ice temple world: camera', () => {
    it('holds a ninety-degree horizontal view on a wide frame', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 3);
        expect(world.u.projScale.value).toBeCloseTo(0.5 / Math.tan((camera.fov * Math.PI) / 360), 6);
        world.dispose();
    });

    it('stands on the centre line looking up the nave, with the Great Crystal behind the card', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(Math.abs(camera.position.x)).toBeLessThan(2);
        expect(camera.position.y).toBeGreaterThan(2);
        expect(camera.position.y).toBeLessThan(3.5);
        expect(camera.position.z).toBeGreaterThan(NAVE.firstZ);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        expect(forward.z).toBeLessThan(-0.95);
        expect(forward.y).toBeGreaterThan(0.05);
        const card = cardUnion(world.layout);
        expect(world.heart.x).toBeGreaterThan(card.x0);
        expect(world.heart.x).toBeLessThan(card.x1);
        expect(world.heart.y).toBeGreaterThan(card.y0);
        expect(world.heart.y).toBeLessThan(card.y1);
        world.dispose();
    });

    it('finds the ice under a screen point and falls back above the horizon', () => {
        const { camera, world } = makeWorld('Minimal');
        const horizon = world.horizonY();
        expect(horizon).toBeGreaterThan(0.5);
        expect(horizon).toBeLessThan(0.75);
        const near = world.screenToIce(0.5, 0.98, { x: 0, z: 0 });
        const far = world.screenToIce(0.5, horizon + 0.06, { x: 0, z: 0 });
        expect(near.z).toBeLessThan(camera.position.z);
        expect(far.z).toBeLessThan(near.z);
        const left = world.screenToIce(0.2, 0.9, { x: 0, z: 0 });
        expect(left.x).toBeLessThan(camera.position.x);
        const sky = world.screenToIce(0.5, 0.1, { x: 0, z: 0 });
        expect(Math.hypot(sky.x - camera.position.x, sky.z - camera.position.z)).toBeCloseTo(9, 5);
        world.dispose();
    });

    it('walks slowly on the spot, and stands still under reduced motion', () => {
        const { camera, world } = makeWorld('Minimal');
        const before = camera.position.clone();
        run(world, camera, 12);
        expect(camera.position.distanceTo(before)).toBeGreaterThan(0.2);
        expect(camera.position.distanceTo(before)).toBeLessThan(4);
        world.setReducedMotion(true);
        run(world, camera, 1);
        const still = camera.position.clone();
        const snow = world.snowFall;
        world.onClear({ lines: 2, tspin: true });
        run(world, camera, 6);
        expect(camera.position.distanceTo(still)).toBeLessThan(1e-9);
        // The snow keeps falling at its resting pace whatever the combo, and the air never turns.
        world.onCombo(9);
        run(world, camera, 2);
        expect(world.snowFall - snow).toBeCloseTo(SNOW_FALL * 8, 3);
        expect(world.swirl).toBe(0);
        expect(world.getPostState().frost).toBe(0);
        world.dispose();
    });
});

describe('ice temple world: locks', () => {
    it('strikes the ice under the board, at the piece\'s own column', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.1, color: '#7fe8ff' });
        const left = world.u.lockA[0].value.clone();
        world.onLock({ u: 0.9, color: '#7fe8ff' });
        const right = world.u.lockA[1].value.clone();
        expect(left.x).toBeLessThan(right.x);
        // Ahead of the camera, before the first pair of columns.
        [left, right].forEach((strike) => {
            expect(strike.y).toBeLessThan(camera.position.z);
            expect(strike.y).toBeGreaterThan(NAVE.firstZ - NAVE.bay);
            expect(Math.abs(strike.x)).toBeLessThan(NAVE.halfWidth);
            expect(strike.z).toBe(world.time);
        });
        expect(world.counts.locks).toBe(2);
        world.dispose();
    });

    it('hits harder on a hard drop, kicks the camera and raises a crown round the card', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.5 });
        const soft = world.u.lockA[0].value.w;
        const softKick = world.kick;
        world.onLock({ u: 0.8, hardDrop: true, color: '#c0a7ff' });
        expect(world.u.lockA[1].value.w).toBeGreaterThan(soft);
        expect(world.kick).toBeGreaterThan(softKick);
        expect(world.counts.crowns).toBe(1);
        const place = world.crown.uniforms.place[0].value;
        expect(place.z).toBe(world.time);
        expect(place.w).toBeGreaterThanOrEqual(1.7);
        expect(place.w).toBeLessThanOrEqual(CROWN_RADIUS_MAX);
        // The ring is wider than the card's foot, so its spikes stand clear of the card.
        const card = cardUnion(world.layout);
        const a = world.screenToIce(card.x0, 0.9, { x: 0, z: 0 });
        const b = world.screenToIce(card.x1, 0.9, { x: 0, z: 0 });
        expect(place.w).toBeGreaterThan(Math.abs(b.x - a.x) / 2);
        // Drawn toward the blow, which fell right of centre.
        expect(place.x).toBeGreaterThan(camera.position.x);
        expect(place.x).toBeLessThan(world.u.lockA[1].value.x + 1e-6);
        world.dispose();
    });

    it('raises no crown on the tier that has none', () => {
        const { world } = makeWorld('Minimal');
        expect(world.crown).toBeNull();
        expect(() => world.onLock({ u: 0.5, hardDrop: true })).not.toThrow();
        expect(world.counts.crowns).toBe(0);
        world.dispose();
    });

    it('reuses its lock slots as a ring and knocks chips from a fixed pool', () => {
        const { world } = makeWorld('Low');
        const births = world.chips.geometry.getAttribute('aBirth').array;
        expect(births.length).toBe(QUALITY.Low.shards * 4);
        for (let i = 0; i < LOCK_SLOTS + 2; i++) world.onLock({ u: i / 6 });
        expect(world.lockCursor).toBe(LOCK_SLOTS + 2);
        let live = 0;
        for (let i = 3; i < births.length; i += 4) {
            if (births[i] > 0) live += 1;
        }
        expect(live).toBeGreaterThan(10);
        expect(live).toBeLessThanOrEqual(QUALITY.Low.shards);
        world.dispose();
    });

    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        const { world } = makeWorld('Minimal');
        world.onLock({ u: 0.5, color: '#ff0000' });
        const red = world.u.lockC[0].value;
        expect(red.x).toBeCloseTo(1.5, 5);
        expect(red.y).toBeGreaterThan(0.1);
        expect(red.z).toBeGreaterThan(0.1);
        world.onLock({ u: 0.5, color: null });
        const fallback = world.u.lockC[1].value;
        expect(Math.max(fallback.x, fallback.y, fallback.z)).toBeCloseTo(1.5, 5);
        world.dispose();
    });

    it('lands a meditation click where it was made, below the horizon', () => {
        const { world } = makeWorld('Minimal');
        world.onLock({ screen: { x: 0.2, y: 0.95 } });
        world.onLock({ screen: { x: 0.8, y: 0.1 } });
        expect(world.u.lockA[0].value.x).toBeLessThan(0);
        expect(world.u.lockA[1].value.x).toBeGreaterThan(0);
        expect(Number.isFinite(world.u.lockA[1].value.y)).toBe(true);
        world.dispose();
    });
});

describe('ice temple world: clears, resonance and the four-line hush', () => {
    it('sends a wave with one front per line and fires the cleared rows out of the card', () => {
        const { world } = makeWorld('High');
        world.onClear({ rows: [19, 18], lines: 2 });
        const A = world.u.clearA[0].value;
        expect(A.x).toBe(world.time);
        expect(A.y).toBe(2);
        expect(A.z).toBeGreaterThan(0.6);
        expect(A.w).toBe(0);
        const beam = world.beams.uniforms;
        expect(beam.frame.value.z).toBe(world.time);
        expect(beam.rows.value.x).toBeGreaterThan(0.5);
        expect(beam.rows.value.y).toBeGreaterThan(0.5);
        expect(beam.rows.value.z).toBe(-1);
        const card = cardUnion(world.layout);
        expect(beam.frame.value.x).toBeCloseTo(card.x0, 6);
        expect(beam.frame.value.y).toBeCloseTo(card.x1, 6);
        world.dispose();
    });

    it('keeps the row beams dark when no board is on screen', () => {
        const { world } = makeWorld('High', { live: false });
        world.onClear({ lines: 3 });
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(world.counts.clears).toBe(1);
        world.dispose();
    });

    it('answers one, two and three lines in different colours and reuses its slots', () => {
        const { world } = makeWorld('Minimal');
        const colours = [1, 2, 3].map((lines) => {
            world.onClear({ lines });
            const slot = (world.clearCursor - 1) % CLEAR_SLOTS;
            return world.u.clearC[slot].value.clone();
        });
        expect(colours[0].distanceTo(colours[1])).toBeGreaterThan(0.2);
        expect(colours[1].distanceTo(colours[2])).toBeGreaterThan(0.2);
        // One line is the aurora's border colour.
        const border = linRGB(AURORA_PALETTES[0].a);
        expect(colours[0].y / colours[0].x).toBeGreaterThan(2);
        expect(border[1]).toBeGreaterThan(border[0]);
        expect(world.clearCursor).toBe(3);
        world.dispose();
    });

    it('flares the Great Crystal when the wave leaves and kicks the camera when it arrives', () => {
        const { camera, world } = makeWorld('Minimal');
        const rest = world.u.heartPower.value;
        world.onClear({ lines: 2 });
        run(world, camera, 0.1);
        expect(world.u.heartPower.value).toBeGreaterThan(rest + 0.5);
        expect(world.kick).toBeLessThan(0.02);
        run(world, camera, CLEAR_TRAVEL);
        expect(world.kick).toBeGreaterThan(0.02);
        world.dispose();
    });

    it('resonates with the combo: the glow climbs the columns a step for every link', () => {
        const { camera, world } = makeWorld('High');
        expect(world.u.resonance.value).toBe(0);
        world.onCombo(3);
        run(world, camera, 4);
        const three = world.getState();
        expect(three.resonance).toBeGreaterThan(0.5);
        expect(three.resLevel).toBeCloseTo(3 * RESONANCE_STEP, 1);
        expect(three.resRadius).toBeGreaterThan(20);
        const aurora = world.u.auroraGain.value;
        expect(aurora).toBeGreaterThan(1.4);
        world.onCombo(9);
        run(world, camera, 4);
        const nine = world.getState();
        expect(nine.resLevel).toBeGreaterThan(NAVE.springHeight); // it has reached the ribs
        expect(nine.resonance).toBeGreaterThan(three.resonance);
        expect(world.u.auroraGain.value).toBeGreaterThan(aurora);
        expect(world.getPostState().frost).toBeGreaterThan(0.4);
        // The resonance has climbed the aurora's spectrum: from its green border to the violet
        // fringe, kept as bright as its brightest channel.
        const res = world.u.resColor.value;
        expect(res.z).toBeGreaterThan(0.9);
        expect(res.x).toBeGreaterThan(res.y);
        expect(three.resonance).toBeLessThan(0.6);
        world.dispose();
    });

    it('slows the snow as the chain builds, holds it at the turn and raises it beyond', () => {
        const { camera, world } = makeWorld('Minimal');
        const fallen = (combo) => {
            world.seek(10);
            world.onCombo(combo);
            const before = world.snowFall;
            run(world, camera, 2);
            return world.snowFall - before;
        };
        expect(fallen(0)).toBeCloseTo(SNOW_FALL * 2, 3);
        expect(fallen(2)).toBeLessThan(fallen(0));
        expect(fallen(2)).toBeGreaterThan(0);
        expect(Math.abs(fallen(SNOW_TURN))).toBeLessThan(1e-6);
        expect(fallen(SNOW_TURN + 3)).toBeLessThan(0);
        world.dispose();
    });

    it('lets its breath go when the chain breaks, and drains', () => {
        const { camera, world } = makeWorld('High');
        world.onCombo(6);
        run(world, camera, 4);
        world.onCombo(0);
        expect(world.exhale).toBeGreaterThan(0.5);
        run(world, camera, 0.05);
        expect(world.u.ambient.value).toBeLessThan(0.9);
        run(world, camera, 12);
        const state = world.getState();
        expect(state.resonance).toBeLessThan(0.01);
        expect(state.resLevel).toBeLessThan(0.05);
        expect(world.u.ambient.value).toBeGreaterThan(0.99);
        world.dispose();
    });

    it('holds its breath on four lines, then answers in diamond white and grows the Great Snowflake', () => {
        const { camera, world } = makeWorld('High');
        const t0 = world.time;
        world.onClear({ lines: 4 });
        expect(world.counts.quads).toBe(1);
        // The wave waits for the hush to end.
        const A = world.u.clearA[0].value;
        expect(A.x).toBeCloseTo(t0 + HUSH_HOLD, 9);
        expect(A.y).toBe(4);
        expect(A.w).toBe(1);
        const snow = world.snowFall;
        run(world, camera, HUSH_HOLD * 0.6);
        expect(world.getState().hush).toBe(true);
        expect(world.u.ambient.value).toBeLessThan(0.3);
        expect(world.u.heartPower.value).toBeLessThan(0.2);
        expect(world.snowFall).toBe(snow); // the snow stands still in the air
        run(world, camera, HUSH_HOLD);
        expect(world.getState().hush).toBe(false);
        expect(world.u.heartPower.value).toBeGreaterThan(2);
        // Diamond white: every channel high, none of the palette's blue cast left.
        const heart = world.u.heartColor.value;
        expect(Math.min(heart.x, heart.y, heart.z)).toBeGreaterThan(0.6);
        expect(world.u.clearC[0].value.x / world.u.clearC[0].value.z).toBeGreaterThan(0.8);
        // The snowflake: one layer, launched as the hush ends, standing in front of the camera.
        const state = world.flake.uniforms.state.value;
        expect(state.x).toBeCloseTo(t0 + HUSH_HOLD + 0.05, 9);
        expect(state.z).toBe(1);
        expect(world.getState().flake).toBe(true);
        const place = world.flake.uniforms.place.value;
        const centre = new THREE.Vector3(place.x, place.y, place.z);
        expect(centre.distanceTo(camera.position)).toBeCloseTo(FLAKE_DISTANCE, 3);
        const onScreen = centre.clone().project(camera);
        expect(onScreen.x).toBeCloseTo(0, 2);
        // Its arms reach past the card on both sides.
        const edge = new THREE.Vector3(place.x + place.w, place.y, place.z).project(camera);
        const card = cardUnion(world.layout);
        expect(edge.x * 0.5 + 0.5).toBeGreaterThan(card.x1 + 0.1);
        run(world, camera, FLAKE_LIFE + 0.5);
        expect(world.getState().flake).toBe(false);
        world.dispose();
    });

    it('grows two snowflakes for a perfect clear', () => {
        const { world } = makeWorld('High');
        world.onClear({ lines: 2, perfect: true });
        expect(world.counts.quads).toBe(1);
        expect(world.flake.uniforms.state.value.z).toBe(2);
        expect(world.overdrive).toBeGreaterThan(1);
        world.dispose();
    });

    it('turns the air on a T-spin and lets it come to rest', () => {
        const { camera, world } = makeWorld('Minimal');
        world.onClear({ lines: 2, tspin: true });
        run(world, camera, 1);
        const turning = world.swirl;
        expect(turning).toBeGreaterThan(1);
        run(world, camera, 12);
        const settled = world.swirl;
        run(world, camera, 2);
        expect(world.swirl - settled).toBeLessThan(1e-3);
        expect(settled).toBeGreaterThan(turning);
        world.dispose();
    });

    it('changes the aurora\'s colours with the level and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Minimal');
        const before = world.u.auroraA.value.clone();
        world.levelUp(2);
        expect(world.getState().palette).toBe('amethyst');
        // No palette holds an orange or a gold (red high, green above blue): inside blue ice
        // those mix to grey. Rose and red-pink keep more blue than green, and stay colours.
        AURORA_PALETTES.forEach((palette) => {
            [palette.a, palette.b, palette.c].forEach((hex) => {
                const [r, g, b] = linRGB(hex);
                expect(r > 0.5 && g > b, `${palette.name} ${hex.toString(16)}`).toBe(false);
            });
        });
        expect(world.flare).toBeGreaterThan(0.5);
        run(world, camera, 8);
        expect(world.u.auroraA.value.distanceTo(before)).toBeGreaterThan(0.3);
        world.levelUp(AURORA_PALETTES.length + 1, { silent: true });
        expect(world.getState().palette).toBe(AURORA_PALETTES[0].name);
        const target = linRGB(AURORA_PALETTES[0].a);
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.u.auroraA.value.x).toBeCloseTo(target[0], 5);
        expect(world.u.auroraA.value.y).toBeCloseTo(target[1], 5);
        world.dispose();
    });
});

describe('ice temple world: time', () => {
    it('reaches the same state at 30 and at 240 frames a second', () => {
        const play = (fps) => {
            const { camera, world } = makeWorld('Minimal');
            world.onLock({ u: 0.3, hardDrop: true });
            world.onCombo(4);
            world.onClear({ lines: 2, tspin: true });
            run(world, camera, 3, 3 * fps);
            const state = world.getState();
            const post = { ...world.getPostState() };
            world.dispose();
            return { state, post };
        };
        const slow = play(30);
        const fast = play(240);
        expect(slow.state.resonance).toBeCloseTo(fast.state.resonance, 3);
        expect(slow.state.resLevel).toBeCloseTo(fast.state.resLevel, 2);
        expect(slow.state.resRadius).toBeCloseTo(fast.state.resRadius, 1);
        expect(slow.state.snowFall).toBeCloseTo(fast.state.snowFall, 2);
        expect(slow.state.swirl).toBeCloseTo(fast.state.swirl, 1);
        expect(slow.post.frost).toBeCloseTo(fast.post.frost, 2);
        expect(slow.post.exposure).toBeCloseTo(fast.post.exposure, 2);
    });

    it('drops every event in flight when it seeks, and keeps the snow falling through a new run', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onCombo(5);
        world.onClear({ lines: 4 });
        run(world, camera, 1);
        const snow = world.snowFall;
        world.resetSession();
        let state = world.getState();
        expect(state).toMatchObject({
            combo: 0, resonance: 0, overdrive: 0, hush: false, flake: false,
        });
        expect(state.counts).toEqual({
            locks: 0, clears: 0, quads: 0, crowns: 0,
        });
        expect(world.snowFall).toBe(snow);
        expect(world.u.lockA[0].value.z).toBe(-100);
        expect(world.u.clearA[0].value.x).toBe(-100);
        expect(world.crown.uniforms.place[0].value.z).toBe(-100);
        expect(world.flake.uniforms.state.value.y).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        world.onCombo(3);
        world.seek(200);
        state = world.getState();
        expect(state.time).toBe(200);
        expect(state.combo).toBe(0);
        expect(world.snowFall).toBeCloseTo(200 * SNOW_FALL, 6);
        world.dispose();
    });

    it('returns to its exact resting look long after the last event', () => {
        const { camera, world } = makeWorld('Minimal');
        const rest = { ...world.getPostState() };
        const heart = world.u.heartPower.value;
        world.onLock({ u: 0.6, hardDrop: true });
        world.onCombo(7);
        world.onClear({ lines: 4 });
        run(world, camera, 2);
        world.onCombo(0);
        run(world, camera, 90, 2700);
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.frost).toBeLessThan(1e-3);
        expect(post.rays).toBeCloseTo(rest.rays, 3);
        expect(post.exposure).toBeCloseTo(rest.exposure, 3);
        expect(world.u.heartPower.value).toBeCloseTo(heart, 3);
        expect(world.u.ambient.value).toBeCloseTo(1, 6);
        expect(world.u.resonance.value).toBeLessThan(1e-6);
        world.dispose();
    });
});

describe('ice temple effects: closed forms', () => {
    it('throws a chip up, bounces it once lower, and lets it lie', () => {
        const vy = 4.5;
        const apex = chipHeight(vy, vy / 9);
        expect(apex).toBeCloseTo((vy * vy) / 18, 5);
        const landing = (2 * vy) / 9;
        expect(chipHeight(vy, landing)).toBeCloseTo(0, 5);
        const second = chipHeight(vy, landing + (vy * 0.36) / 9);
        expect(second).toBeGreaterThan(0);
        expect(second).toBeLessThan(apex * 0.2);
        expect(chipHeight(vy, 10)).toBe(0);
        expect(chipHeight(0, 0.5)).toBe(0);
    });

    it('shoots a crown up in a tenth of a second, holds it, and sinks it back into the lake', () => {
        expect(crownRise(0)).toBe(0);
        expect(crownRise(-1)).toBe(0);
        expect(crownRise(0.1)).toBeGreaterThan(0.85);
        expect(crownRise(CROWN_LIFE * 0.4)).toBeGreaterThan(0.95);
        expect(crownRise(CROWN_LIFE * 0.4)).toBeLessThan(1.1);
        expect(crownRise(CROWN_LIFE * 0.9)).toBeLessThan(0.2);
        expect(crownRise(CROWN_LIFE)).toBe(0);
        expect(crownRise(CROWN_LIFE + 1)).toBe(0);
    });

    it('keeps one crown per slot, each a full ring of spikes', () => {
        const { world } = makeWorld('High');
        expect(world.crown.geometry.instanceCount).toBe(CROWN_SLOTS * CROWN_SPIKES);
        const spikes = world.crown.geometry.getAttribute('aSpike').array;
        for (let slot = 0; slot < CROWN_SLOTS; slot++) {
            const angles = [];
            for (let k = 0; k < CROWN_SPIKES; k++) {
                const i = (slot * CROWN_SPIKES + k) * 4;
                expect(spikes[i]).toBe(slot);
                angles.push(spikes[i + 1]);
                expect(spikes[i + 2]).toBeGreaterThan(0.7);
                expect(spikes[i + 3]).toBeGreaterThan(0.8);
            }
            // All the way round: no gap wider than a sixth of the ring.
            angles.sort((a, b) => a - b);
            for (let k = 1; k < angles.length; k++) expect(angles[k] - angles[k - 1]).toBeLessThan(Math.PI / 3);
        }
        for (let n = 0; n < CROWN_SLOTS + 1; n++) world.crown.raise(n, -8, [1, 1, 1], 10 + n, 2);
        expect(world.crown.uniforms.place[0].value.x).toBe(CROWN_SLOTS); // the ring of slots wrapped
        world.dispose();
    });
});
