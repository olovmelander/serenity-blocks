/**
 * Thermal Bloom — the world, on the CPU: a real ThermalBloomWorld in a THREE.Scene, no renderer
 * (the node graphs are built, never compiled).
 *
 * These pin behaviour and contracts — the camera rig, the composition and its mirror rule, the
 * sun inside its ranges, the season and its succession front, what the events record,
 * determinism and the shape of what the theme reads — never a tuning number: constants are
 * imported, and the assertions are relations (counted, ordered, bounded, monotonic).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, THERMAL_BLOOM_PARTS, ThermalBloomWorld, fovForAspect,
} from '../../src/themes/thermal-bloom/thermal-bloom-world.js';
import {
    CHALICE, ELEVATION, ERUPTIONS, EVENT_ROWS, EVENT_SLOTS, RIG, SEASONS, SEASON_REST, SEASON_STEP, SUN_RANGES,
    projectToScreen,
    rigForAspect,
} from '../../src/themes/thermal-bloom/thermal-bloom-core.js';
import { QUALITY_NAMES } from '../../src/themes/thermal-bloom/thermal-bloom-quality.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';
import { THEME_URL_PARAMETERS } from '../../src/ui/url-parameters/theme-parameters.js';
import { CHALICE_SHAPE, COLUMN_KIND, chaliceField } from '../../src/themes/thermal-bloom/thermal-bloom-geyser.js';
import { applyCameraBreath } from '../../src/themes/shared/camera-breath.js';

const WORLD_METHODS = [
    'build', 'bindCamera', 'showOnlyParts', 'setViewport', 'setLayout', 'setReducedMotion', 'seek', 'resetSession',
    'restCamera', 'updateCamera', 'onLock', 'onClear', 'onCombo', 'levelUp', 'update', 'getPostState', 'getState',
    'dispose', 'onB2B', 'onGameOver', 'onSessionStart',
];
const DEG = Math.PI / 180;
const ASPECTS = [390 / 844, 1.0, 4 / 3, 16 / 9, 2560 / 1080];

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, at = 10, reduce = false, level = 1, layout = 'fallback',
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new ThermalBloomWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    world.setLayout(layout === 'fallback' ? fallbackLayout(width, height) : layout, aspect);
    world.seek(at);
    if (level > 1) world.levelUp(level, { silent: true });
    const sim = {
        time: at, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
    return { scene, camera, world };
}

/** One frame as the theme runs it: the camera, the gameplay staged since the last frame, the world. */
function frame(world, camera, dt, during = null, pointerX = 0) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 10, during = null) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) frame(world, camera, dt, during);
}

const lock = (world, extra = {}) => world.onLock({
    player: 0,
    rows: [12, 11],
    u: 0.3,
    hardDrop: false,
    distance: 0,
    color: '#F5D020',
    shape: 'T',
    cells: null,
    screen: null,
    ...extra,
});
const clear = (world, extra = {}) => world.onClear({
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
    ...extra,
});

const inside = (p, r, m = 0) => p[0] > r.x0 - m && p[0] < r.x1 + m && p[1] > r.y0 - m && p[1] < r.y1 + m;

describe('Thermal Bloom world: the contract the theme calls', () => {
    it('implements every method the theme and the playground call', () => {
        WORLD_METHODS.forEach((method) => {
            expect(ThermalBloomWorld.prototype[method], `ThermalBloomWorld.${method}`).toBeTypeOf('function');
        });
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        // The far plane reaches the far rim and the horizon beyond it.
        expect(REST_RIG.far).toBeGreaterThan(15000);
    });

    it('names the parts the URL parameter reference lists for ?thermalBloomParts', () => {
        expect(THERMAL_BLOOM_PARTS).toEqual(['sky', 'basin', 'terraces', 'steam', 'geyser', 'flora', 'fx']);
        const entry = THEME_URL_PARAMETERS.find(({ name }) => name === 'thermalBloomParts');
        const listed = entry.values.replace(/^[^:]*:/, '').split(',').map((name) => name.trim());
        expect(listed).toEqual([...THERMAL_BLOOM_PARTS]);
    });

    it('builds for every tier, node materials only, all in one root, and lets everything go', () => {
        for (const quality of QUALITY_NAMES) {
            const { world, scene } = makeWorld(quality);
            expect(scene.children).toEqual([world.root]);
            expect(Object.keys(world.parts)).toContain('sky');
            Object.keys(world.parts).forEach((name) => expect(THERMAL_BLOOM_PARTS).toContain(name));
            const materials = [];
            scene.traverse((o) => { if (o.material) materials.push(o.material); });
            expect(materials.length).toBeGreaterThan(0);
            expect(materials.every((m) => m.isNodeMaterial && !m.isShaderMaterial)).toBe(true);
            expect(world.getState().quality).toBe(quality);
            world.dispose();
            world.dispose(); // idempotent
            expect(scene.children).toEqual([]);
        }
        // Six tiers of CPU bakes (the Stair, the Chalice's mound, the noise atlases): seconds.
    }, 30000);

    it('never grows the scene after build, whatever the events', () => {
        const { world, scene, camera } = makeWorld('High');
        let count = 0;
        scene.traverse(() => { count += 1; });
        for (let i = 0; i < 40; i++) {
            frame(world, camera, 0.1, () => {
                lock(world, { hardDrop: i % 3 === 0, distance: 12 });
                if (i % 4 === 0) clear(world, { lines: 1 + (i % 4) });
                world.onCombo(i % 9);
                world.onB2B(i % 4);
                if (i === 20) world.levelUp(3);
            });
        }
        let after = 0;
        scene.traverse(() => { after += 1; });
        expect(after).toBe(count);
    });

    it('hands the post one reused state object with finite values', () => {
        const { world, camera } = makeWorld();
        const a = world.getPostState();
        run(world, camera, 1);
        expect(world.getPostState()).toBe(a);
        ['exposure', 'iris', 'sat', 'vivid'].forEach((k) => expect(Number.isFinite(a[k]), k).toBe(true));
        expect(a.vivid).toBeGreaterThanOrEqual(1);
        expect(a.vivid).toBeLessThanOrEqual(1.25);
        expect(a.gradeShadow).toHaveLength(3);
        expect(a.gradeLight).toHaveLength(3);
        expect(a.shimmer).toHaveLength(2);
    });
});

describe('Thermal Bloom world: the overlook rig', () => {
    it('stands on the overlook looking down, higher and through a longer lens upright than on a desktop', () => {
        const desk = rigForAspect(16 / 9);
        const upright = rigForAspect(390 / 844);
        expect(desk).toEqual({ ...RIG.desktop });
        expect(upright).toEqual({ ...RIG.portrait });
        for (const aspect of ASPECTS) {
            const fov = fovForAspect(aspect);
            expect(fov).toBeGreaterThan(1);
            expect(fov).toBeLessThan(179);
        }
        // Upright, the pool must read as an ellipse under the card, not a round eye: a high
        // camera and a longer lens (the record doc's portrait deviation from §1.2).
        expect(upright.height).toBeGreaterThan(desk.height * 3);
        expect(fovForAspect(390 / 844)).toBeLessThan(fovForAspect(16 / 9));
    });

    it('poses the camera at the rig, pitched down, never steeper than the presets allow', () => {
        for (const aspect of ASPECTS) {
            const { world, camera } = makeWorld('Minimal', { width: Math.round(1000 * aspect), height: 1000 });
            const rig = rigForAspect(aspect);
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const pitch = Math.asin(-fwd.y) / DEG;
            expect(pitch).toBeGreaterThan(0);
            expect(pitch).toBeLessThanOrEqual(30.5);
            expect(Math.abs(pitch - rig.pitch)).toBeLessThan(0.6);
            expect(Math.abs(camera.position.y - rig.height)).toBeLessThan(1);
            world.dispose();
        }
    });

    it('breathes slowly, follows the pointer, and holds still under reduced motion', () => {
        const { world, camera } = makeWorld('Minimal', { at: 5 });
        const at = (t, px, reduce) => {
            world.setReducedMotion(reduce);
            world.updateCamera(camera, {
                time: t, delta: 0, pointerX: px, pointerY: 0,
            });
            return { q: camera.quaternion.clone(), p: camera.position.clone() };
        };
        // The rig's own breath, before the shared camera breath is layered on it.
        const own = (t) => {
            world.pose(camera, t, 0, 0, 1);
            return camera.quaternion.clone();
        };
        const a = at(5, 0, false);
        const b = at(20, 0, false);
        expect(a.q.angleTo(b.q)).toBeGreaterThan(0);
        expect(own(5).angleTo(own(20)) / DEG).toBeLessThan(1.2);
        // The live camera is that pose with the shared breath on top, exactly.
        world.pose(camera, 20, 0, 0, 1);
        applyCameraBreath(camera, 20);
        expect(camera.quaternion.angleTo(b.q)).toBeLessThan(1e-9);
        const c = at(5, 1, false);
        expect(c.p.distanceTo(a.p)).toBeGreaterThan(0.5);
        const still1 = at(5, 1, true);
        const still2 = at(23, -1, true);
        expect(still1.q.angleTo(still2.q)).toBeCloseTo(0, 6);
        expect(still1.p.distanceTo(still2.p)).toBeCloseTo(0, 6);
    });
});

describe('Thermal Bloom world: the composition', () => {
    it('keeps the eye, the Chalice, the Sleeper and the Consort out of the card and HUD at every aspect', () => {
        for (const aspect of ASPECTS) {
            const width = Math.round(1000 * aspect);
            const layout = fallbackLayout(width, 1000);
            const { world } = makeWorld('Minimal', { width, height: 1000 });
            const { anchors } = world.getState();
            const card = layout.cards[0];
            for (const key of ['eye', 'chalice', 'sleeper', 'consort']) {
                const p = anchors[key];
                expect(inside(p, card), `${key} under the card at ${aspect.toFixed(2)}`).toBe(false);
                const hudHit = layout.hud ? inside(p, layout.hud) : false;
                expect(hudHit, `${key} under the HUD at ${aspect.toFixed(2)}`).toBe(false);
                expect(p[0]).toBeGreaterThanOrEqual(0);
                expect(p[0]).toBeLessThanOrEqual(1);
                expect(p[1]).toBeGreaterThanOrEqual(0);
                expect(p[1]).toBeLessThanOrEqual(1);
            }
            world.dispose();
        }
    });

    it('lands every hero where its anchor asks (unprojected, then projected back)', () => {
        const { world } = makeWorld('Minimal', { width: 1920, height: 1080 });
        const { plan } = world;
        for (const key of ['eye', 'chalice', 'consort']) {
            const p = projectToScreen(plan.rig, 1920 / 1080, plan[key]);
            expect(p[0]).toBeCloseTo(plan.anchors[key][0], 3);
            expect(p[1]).toBeCloseTo(plan.anchors[key][1], 3);
        }
        // The Iris on the left, the Chalice on the right, the Sleeper on the far rim (far away).
        expect(plan.eye[0]).toBeLessThan(0);
        expect(plan.chalice[0]).toBeGreaterThan(0);
        expect(Math.hypot(plan.sleeper[0], plan.sleeper[2])).toBeGreaterThan(4 * Math.hypot(plan.eye[0], plan.eye[2]));
    });

    it('mirrors the preset when the HUD sits on the Iris’s side, so the eye is never under it', () => {
        const layout = fallbackLayout(1920, 1080);
        const { hud } = layout;
        const mirroredLayout = {
            ...layout, hud: { ...hud, x0: 1 - hud.x1, x1: 1 - hud.x0 },
        };
        const { world } = makeWorld('Minimal', { width: 1920, height: 1080, layout: mirroredLayout });
        const state = world.getState();
        expect(state.mirrored).toBe(true);
        expect(state.anchors.eye[0]).toBeGreaterThan(0.5);
        expect(state.anchors.chalice[0]).toBeLessThan(0.5);
        expect(inside(state.anchors.eye, mirroredLayout.hud)).toBe(false);
        world.setLayout(layout, 1920 / 1080);
        expect(world.getState().mirrored).toBe(false);
        expect(world.getState().anchors.eye[0]).toBeLessThan(0.5);
    });

    it(
        'solves the sun inside its ranges and puts the bow on the Chalice’s column at 16:9, 21:9, 4:3 and upright',
        () => {
            for (const aspect of [16 / 9, 2560 / 1080, 4 / 3, 390 / 844]) {
                const { world } = makeWorld('Minimal', { width: Math.round(1000 * aspect), height: 1000 });
                const { sun } = world.getState();
                const ranges = aspect < 0.62 ? SUN_RANGES.portrait : SUN_RANGES.desktop;
                expect(sun.azimuth).toBeGreaterThanOrEqual(ranges.azimuth[0] - 1e-6);
                expect(sun.azimuth).toBeLessThanOrEqual(ranges.azimuth[1] + 1e-6);
                expect(sun.elevation).toBeGreaterThanOrEqual(ranges.elevation[0] - 1e-6);
                expect(sun.elevation).toBeLessThanOrEqual(ranges.elevation[1] + 1e-6);
                expect(sun.onColumn, `bow on the column at ${aspect.toFixed(2)}`).toBe(true);
                // The sun is behind the camera (never in frame) and above the horizon.
                const dir = world.u.sunDir.value;
                expect(dir.z).toBeGreaterThan(0);
                expect(dir.y).toBeGreaterThan(0);
                world.dispose();
            }
        },
    );
});

describe('Thermal Bloom world: the year and the weather', () => {
    it('turns the season a level with a succession front, and lands silently on a rebuild', () => {
        const { world, camera } = makeWorld();
        expect(world.getState().season).toBe(SEASONS[0].name);
        frame(world, camera, 0.1, () => world.levelUp(2));
        expect(world.getState().season).toBe(SEASONS[1].name);
        expect(world.getState().seasonSweep).toBeLessThan(0.5);
        run(world, camera, 7);
        expect(world.getState().seasonSweep).toBe(1);
        expect(world.getState().counts.seasonSteps).toBe(1);
        world.levelUp(4, { silent: true });
        expect(world.getState().season).toBe(SEASONS[3].name);
        expect(world.getState().seasonSweep).toBe(1);
        world.levelUp(7, { silent: true });
        expect(world.getState().season).toBe(SEASONS[0].name);
    });

    it('turns the year slowly with the clock, whatever the level, and a level-up adds a step', () => {
        // At rest on level one, in the rest at the start of the first step.
        const { world, camera } = makeWorld('Minimal', { at: SEASON_STEP * SEASON_REST * 0.5 });
        expect(world.getState().seasonWheel).toBe(0);
        const zenith0 = world.u.zenith.value.clone();
        // No play, no level-up: within the first minute the light is already on its way…
        run(world, camera, 50, 1);
        expect(world.getState().level).toBe(1);
        expect(world.getState().seasonWheel).toBeGreaterThan(0.2);
        expect(world.getState().seasonWheel).toBeLessThan(0.9);
        expect(world.u.zenith.value.distanceTo(zenith0)).toBeGreaterThan(0.005);
        // …and a step later it stands on the next season (resting there a while).
        run(world, camera, SEASON_STEP - 50, 1);
        expect(world.getState().seasonWheel).toBeCloseTo(1, 5);
        expect(world.getState().season).toBe(SEASONS[1].name);
        // A level-up is a step on top of the clock's.
        const before = world.getState().seasonWheel;
        world.levelUp(2);
        run(world, camera, 1, 1);
        expect(world.getState().seasonWheel - before).toBeGreaterThan(0.99);
        // A new run starts on level one, but the year never turns back.
        const reached = world.getState().seasonWheel;
        world.resetSession();
        run(world, camera, 1, 1);
        expect(world.getState().level).toBe(1);
        expect(world.getState().seasonWheel).toBeGreaterThanOrEqual(reached);
        // A rebuild in place is handed the place reached (it never lands on the level's own).
        const fresh = makeWorld('Minimal', { at: world.time });
        fresh.world.levelUp(1, { silent: true });
        fresh.world.setSeasonOffset(world.seasonOffset);
        run(fresh.world, fresh.camera, 0.1, 0.1);
        expect(fresh.world.getState().seasonWheel).toBeCloseTo(world.getState().seasonWheel, 2);
    });

    it('holds the playground’s season, heat, breath and gust', () => {
        const { world, camera } = makeWorld();
        world.hold('season', 3);
        world.hold('breath', 1);
        world.hold('gust', 0.5);
        world.hold('heat', 1);
        run(world, camera, 3);
        const s = world.getState();
        expect(s.season).toBe(SEASONS[3].name);
        expect(s.breath).toBe(1);
        expect(s.gust).toBeCloseTo(0.5);
        expect(s.reach).toBeGreaterThan(1.5);
        expect(world.u.snow.value).toBe(SEASONS[3].snow);
    });
});

describe('Thermal Bloom world: what the events record', () => {
    it('records locks, hard drops and the lock rate (the blooms’ slot pressure)', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 20; i++) {
            frame(world, camera, 0.5, () => lock(world, { hardDrop: i % 2 === 0, distance: 9 }));
        }
        const s = world.getState();
        expect(s.counts.locks).toBe(20);
        expect(s.counts.hardDrops).toBe(10);
        expect(s.lockRate).toBeGreaterThan(0.5);
        run(world, camera, 40, 0.5);
        expect(world.getState().lockRate).toBeLessThan(s.lockRate / 10);
        expect(world.lastLock.code).toBe(1); // T
    });

    it('records clears, four lines, T-spins, perfect clears and the stone record', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => clear(world, { lines: 3, rowCodes: new Array(30).fill(2) }));
        frame(world, camera, 0.1, () => clear(world, { lines: 4 }));
        frame(world, camera, 0.1, () => clear(world, { lines: 2, tspin: true, cascade: 2 }));
        frame(world, camera, 0.1, () => clear(world, { lines: 1, perfect: true }));
        const s = world.getState();
        expect(s.counts.clears).toBe(4);
        expect(s.counts.lines).toBe(10);
        expect(s.counts.quads).toBe(1);
        expect(s.counts.tspins).toBe(1);
        expect(s.counts.perfects).toBe(1);
        expect(s.counts.cascades).toBe(1);
        expect(s.records).toBe(9);
        expect(world.lastClear.rowCodes.length).toBeLessThanOrEqual(40);
    });

    it('steps the chain, widens the eye and pushes the reach, and steams on the break', () => {
        const { world, camera } = makeWorld();
        for (let n = 1; n <= 6; n++) frame(world, camera, 0.4, () => world.onCombo(n));
        run(world, camera, 2);
        const held = world.getState();
        expect(held.counts.chainSteps).toBe(5);
        expect(held.heat).toBeGreaterThan(0.2);
        expect(held.reach).toBeGreaterThan(1.4);
        frame(world, camera, 0.1, () => world.onCombo(0));
        expect(world.getState().counts.releases).toBe(1);
        expect(world.lastRelease.peak).toBe(6);
        expect(world.lastRelease.length).toBe(16);
        run(world, camera, 30);
        expect(world.getState().reach).toBeLessThan(1.05);
        expect(world.getState().heat).toBeLessThan(0.05);
    });

    it('wakes and quiets the Consort with the back-to-back level', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => world.onB2B(1));
        frame(world, camera, 0.1, () => world.onB2B(2));
        expect(world.getState().b2b).toBe(2);
        frame(world, camera, 0.1, () => world.onB2B(0));
        const s = world.getState();
        expect(s.b2b).toBe(0);
        expect(s.counts.b2bSteps).toBe(2);
        expect(s.counts.b2bBreaks).toBe(1);
    });

    it('drains the Chalice at game over and refills it with the next run', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => world.onGameOver());
        world.resetSession();
        expect(world.getState().drained).toBe(true);
        frame(world, camera, 0.1, () => world.onSessionStart());
        expect(world.getState().drained).toBe(false);
        frame(world, camera, 0.1, () => world.onGameOver());
        frame(world, camera, 0.1, () => lock(world));
        expect(world.getState().drained).toBe(false);
        expect(world.getState().counts.refills).toBe(2);
    });

    it('starts a new session on level one with no chain, Consort or record, the year where it was', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => {
            world.levelUp(3);
            world.onCombo(4);
            world.onB2B(2);
            clear(world, { lines: 3 });
        });
        const wheel = world.getState().seasonWheel;
        world.resetSession();
        run(world, camera, 1);
        const s = world.getState();
        expect(s.seasonWheel).toBeGreaterThanOrEqual(wheel);
        expect(s.level).toBe(1);
        expect(s.combo).toBe(0);
        expect(s.b2b).toBe(0);
        expect(s.records).toBe(0);
    });
});

describe('Thermal Bloom world: determinism', () => {
    it('reproduces a frame from seek(t) plus the same fixed steps', () => {
        const play = () => {
            const { world, camera } = makeWorld('Minimal', { at: 30 });
            for (let i = 0; i < 30; i++) {
                frame(world, camera, 0.1, () => {
                    if (i === 3) lock(world);
                    if (i === 9) clear(world, { lines: 4 });
                    if (i === 12) world.onCombo(3);
                    if (i === 15) world.levelUp(2);
                });
            }
            const { u } = world;
            return JSON.stringify({
                state: world.getState(),
                sun: u.sunDir.value.toArray(),
                zenith: u.zenith.value.toArray(),
                steam: u.steam.value,
                wind: u.windDir.value.toArray(),
                cam: camera.matrixWorld.elements,
            });
        };
        expect(play()).toBe(play());
    });
});

describe('Thermal Bloom world: the Chalice and the Stair', () => {
    const ground = -ELEVATION.chalice;

    it('settles the mound into the apron all round (its edge under the ground, no vertical face)', () => {
        const field = chaliceField({ tiers: 10 });
        const { reach } = CHALICE_SHAPE;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
            const x = Math.sin(a);
            const z = Math.cos(a);
            expect(field.height(x * reach, z * reach)).toBeLessThan(ground);
            // Down every spoke the ground never rises outward by more than a slope of 1.2.
            let prev = field.height(x * 9, z * 9);
            for (let r = 10; r <= reach; r += 1) {
                const h = field.height(x * r, z * r);
                expect(h - prev).toBeLessThan(1.2);
                prev = h;
            }
        }
        // The cone stands on the vent's base, its lip about CHALICE.height up.
        expect(Math.max(...[0, 1, 2, 3].map((k) => field.height(1.9 * Math.sin(k), 1.9 * Math.cos(k)))))
            .toBeGreaterThan(CHALICE.height * 0.8);
    });

    it('lays the Stair over the mound: no part of the mound stands over its terraces', () => {
        for (const tiers of [8, 10]) {
            const field = chaliceField({ tiers });
            const { z: headZ } = CHALICE_SHAPE.head;
            for (let z = headZ; z < 60; z += 1.5) {
                for (let x = -40; x <= 40; x += 1.5) {
                    const st = field.stairAt(x, z);
                    if (st && st.edge > 0.97) expect(field.height(x, z)).toBeLessThan(st.height - 0.2);
                }
            }
        }
    });
});

describe('Thermal Bloom world: the gameplay beats in the event table', () => {
    const eruptionRow = (world, slot) => world.u.tables.events[EVENT_ROWS.eruptions + slot * 2];

    it('blooms a lock on its side, bounded by the tier\'s slots, and bleaches them at a game over', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 30; i++) frame(world, camera, 0.2, () => lock(world, { u: i % 2 ? 0.1 : 0.9 }));
        expect(world.blooms.length).toBeLessThanOrEqual(world.tier.bloomSlots);
        expect(new Set(world.blooms.map((b) => b.side))).toEqual(new Set([0, 1]));
        expect(world.u.bloomCount.value).toBe(world.blooms.length);
        frame(world, camera, 0.1, () => world.onGameOver());
        run(world, camera, 4);
        expect(world.blooms).toHaveLength(0);
        expect(world.getState().drained).toBe(true);
    });

    it('seals a clear into the stone record and fills on both sides, at most the fills\' slots', () => {
        const { world, camera } = makeWorld();
        const codes = new Array(30).fill(3);
        frame(world, camera, 0.1, () => clear(world, { lines: 3, rows: [19, 18, 17], rowCodes: codes }));
        expect(world.fills.length).toBeGreaterThan(0);
        expect(world.fills.length).toBeLessThanOrEqual(EVENT_SLOTS.fills);
        expect(new Set(world.fills.map((f) => Math.floor(f.code / 100)))).toEqual(new Set([0, 1]));
        const written = world.recordData.filter((v, i) => i % 4 === 3 && v === 255).length;
        expect(written).toBeGreaterThan(0);
        run(world, camera, 7);
        expect(world.fills).toHaveLength(0);
        world.resetSession();
        expect(world.recordData.every((v) => v === 0)).toBe(true);
    });

    it('raises the four-line column above the idle one, with the bow only while its spray flies', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => clear(world, { lines: 4, rows: [19, 18, 17, 16] }));
        run(world, camera, 1.4);
        expect(eruptionRow(world, 0).w).toBeGreaterThan(ERUPTIONS.idle.height * 1.5);
        expect(world.u.bow.value).toBeGreaterThan(0);
        run(world, camera, 4);
        expect(world.u.bow.value).toBe(0);
        frame(world, camera, 0.1, () => clear(world, { lines: 3, rows: [19, 18, 17] }));
        run(world, camera, 1.4);
        expect(world.u.bow.value).toBe(0);
    });

    it('spins up a devil a T-spin line and leaves a rosette where each one ends', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => clear(world, { lines: 2, tspin: true }));
        run(world, camera, 1);
        expect(world.u.devilCount.value).toBe(2);
        run(world, camera, 9);
        expect(world.u.devilCount.value).toBe(0);
        expect(world.u.rosetteCount.value).toBe(2);
        for (let i = 0; i < 5; i++) frame(world, camera, 0.1, () => clear(world, { lines: 3, tspin: true }));
        run(world, camera, 10);
        expect(world.u.rosetteCount.value).toBeLessThanOrEqual(EVENT_SLOTS.rosettes);
    });

    it('wakes the Consort with a back-to-back chain and the Sleeper with a perfect clear', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => world.onB2B(2));
        run(world, camera, 3);
        expect(world.u.consortWet.value).toBeGreaterThan(0.9);
        frame(world, camera, 0.1, () => clear(world, { lines: 4, rows: [19, 18, 17, 16] }));
        run(world, camera, 1.5);
        expect(eruptionRow(world, 1).w).toBeGreaterThan(20);
        frame(world, camera, 0.1, () => clear(world, { lines: 2, perfect: true, rows: [] }));
        run(world, camera, 3);
        expect(eruptionRow(world, 2).w).toBeGreaterThan(60);
    });
});

describe('Thermal Bloom world: the columns and their steam phases', () => {
    const eruption = (world, slot) => [
        world.u.tables.events[EVENT_ROWS.eruptions + slot * 2],
        world.u.tables.events[EVENT_ROWS.eruptions + slot * 2 + 1],
    ];
    const thread = (world) => world.u.tables.plumes[world.threadSlot * 2 + 1];

    it('swells the Chalice\'s thread into a steam phase after four lines and a broken chain, then settles it', () => {
        const { world, camera } = makeWorld();
        const rest = thread(world).x;
        frame(world, camera, 0.1, () => clear(world, { lines: 4, rows: [19, 18, 17, 16] }));
        run(world, camera, 9);
        expect(thread(world).x).toBeGreaterThan(rest * 4);
        run(world, camera, 20);
        expect(thread(world).x).toBeCloseTo(rest, 3);
        frame(world, camera, 0.1, () => world.onCombo(6));
        run(world, camera, 0.3);
        frame(world, camera, 0.1, () => world.onCombo(0));
        run(world, camera, 2);
        expect(thread(world).x).toBeGreaterThan(rest * 3);
        run(world, camera, world.lastRelease.length);
        expect(thread(world).x).toBeCloseTo(rest, 3);
    });

    it('stands the Consort\'s steam column while its chain lives, taller a level, and thins it after the break', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => world.onB2B(1));
        run(world, camera, 3);
        const [, level1] = eruption(world, 1);
        expect(level1.w).toBe(COLUMN_KIND.standing);
        const tall1 = Math.floor(level1.z);
        expect(tall1).toBeGreaterThan(20);
        frame(world, camera, 0.1, () => world.onB2B(2));
        run(world, camera, 3);
        expect(Math.floor(eruption(world, 1)[1].z)).toBeGreaterThan(tall1);
        expect(eruption(world, 1)[1].z % 1).toBeGreaterThan(0.8);
        frame(world, camera, 0.1, () => world.onB2B(0));
        run(world, camera, 2);
        expect(eruption(world, 1)[1].z % 1).toBeLessThan(0.8);
        run(world, camera, 5);
        expect(eruption(world, 1)[1].z).toBe(0);
    });

    it('keeps a held chain\'s count pulsing at the Chalice, and fires a hard drop\'s jet', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0.1, () => world.onCombo(4));
        run(world, camera, 8);
        let top = 0;
        run(world, camera, 2.5, 0.1, () => { top = Math.max(top, eruption(world, 0)[0].w); });
        expect(top).toBeGreaterThanOrEqual(8);
        frame(world, camera, 0.1, () => lock(world, { hardDrop: true, distance: 18 }));
        run(world, camera, 0.3);
        const jets = [6, 7].map((slot) => eruption(world, slot));
        expect(jets.some(([a, b]) => a.w > 2 && b.w === COLUMN_KIND.jet)).toBe(true);
    });
});
