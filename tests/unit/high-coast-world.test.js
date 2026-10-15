/**
 * High Coast — the world's choreography, run without a renderer: the plan of the coast (prepared
 * once), a scene, a camera, and the world driven in fixed steps (camera, then events, then the
 * frame, as the theme does). One world serves most of the file: each test seeks it back to the
 * same start, which a seek must make indistinguishable from a fresh world.
 *
 * The look is still being tuned, so the gameplay beats are held as relations — a bigger clear
 * draws the sea back further, a released chain returns it faster — not as metres or seconds.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HIGH_COAST_PARTS, HighCoastWorld, REST_RIG, fovForAspect,
} from '../../src/themes/high-coast/high-coast-world.js';
import {
    EYE, PIECE_COLORS, TIMING, bearingOf, hexToLinear,
} from '../../src/themes/high-coast/high-coast-core.js';
import { GUSTS } from '../../src/themes/high-coast/high-coast-tsl.js';
import { groundHeight } from '../../src/themes/high-coast/high-coast-field.js';
import { tierFor } from '../../src/themes/high-coast/high-coast-quality.js';

vi.setConfig({ testTimeout: 30_000 });

const START = 10;
const QUALITY = 'Minimal';
let prepared;
/** The world most tests share (seeked back to START by each). */
let shared;

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

function makeWorld() {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new HighCoastWorld({
        scene, quality: QUALITY, capture: true, prepared,
    });
    const built = world.build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    return {
        scene, camera, world, built,
    };
}

/** Seek a world to `time` and draw that frame, as a capture does. */
function begin({ world, camera }, time = START) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo({ world, camera }, to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const time = from + i * h;
        world.updateCamera(camera, { time, delta: 0 });
        world.update({ time, delta: h }, camera);
    }
}

/** Every value the materials read, flattened (the gust table included). */
function uniformValues(world) {
    const out = [];
    for (const [key, node] of Object.entries(world.u)) {
        if (key === 'tables' || !node || !('value' in node)) continue;
        const { value } = node;
        if (typeof value === 'number') out.push([key, value]);
        else if (value?.toArray) value.toArray().forEach((v, i) => out.push([`${key}.${i}`, v]));
    }
    world.u.tables.gusts.forEach((row, r) => row.toArray().forEach((v, i) => out.push([`gusts[${r}].${i}`, v])));
    return out;
}

const gust = (world, slot) => world.u.tables.gusts.slice(slot * 3, slot * 3 + 3);
const objectCount = (root) => {
    let n = 0;
    root.traverse(() => { n += 1; });
    return n;
};

/** A session with something of everything in it, from the world's current time. */
function play(w) {
    const { world } = w;
    const t = world.time;
    world.onLock({ u: 0.2, rows: [18], color: PIECE_COLORS[0] });
    world.onClear({ lines: 2, combo: 1 });
    stepTo(w, t + 1);
    world.levelUp(2);
    for (let n = 2; n <= 5; n++) {
        world.onLock({
            u: n / 7, rows: [19], color: PIECE_COLORS[n % 7], hardDrop: n === 3, distance: 12,
        });
        world.onClear({ lines: 1, combo: n, tspin: n === 4 });
        stepTo(w, world.time + 0.8);
    }
    world.onLock({ u: 0.7, rows: [19, 18, 17, 16], color: PIECE_COLORS[3] });
    world.onClear({ lines: 4, combo: 1 });
    world.onCombo(0);
    world.onB2B(2);
    stepTo(w, world.time + 2);
    world.onClear({ lines: 1, perfect: true });
    stepTo(w, world.time + 1.5);
}

beforeAll(() => {
    prepared = HighCoastWorld.prepareSync(QUALITY);
    shared = makeWorld();
    begin(shared);
});

afterAll(() => {
    shared?.world.dispose();
    vi.restoreAllMocks();
});

describe('HighCoastWorld build', () => {
    it('builds every named part into one root in the scene, once, and hands itself back', () => {
        const { world, scene, built } = shared;
        expect(built).toBe(world);
        expect(Object.keys(world.parts).sort()).toEqual([...HIGH_COAST_PARTS].sort());
        expect(world.root.parent).toBe(scene);
        for (const name of HIGH_COAST_PARTS) {
            const part = world.parts[name];
            for (const mesh of part.meshes || [part.mesh]) expect(mesh.parent, name).toBe(world.root);
        }
        expect(world.getState()).toMatchObject({
            source: 'plan', quality: QUALITY, parts: expect.arrayContaining(HIGH_COAST_PARTS),
        });
        const tier = tierFor(QUALITY);
        expect(world.parts.land.mesh.geometry.attributes.position.count).toBe(tier.fanCols * tier.fanRows);
        expect(world.motes.count).toBe(tier.motes);
        // Building twice builds nothing more.
        const children = world.root.children.length;
        const objects = objectCount(world.root);
        expect(world.build()).toBe(world);
        expect(world.root.children).toHaveLength(children);
        expect(objectCount(world.root)).toBe(objects);
    });

    it('draws everything with node materials (both renderer backends), the shadow passes too', () => {
        const { world } = shared;
        const plain = [];
        let materials = 0;
        world.root.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                materials += 1;
                if (!material.isNodeMaterial) plain.push(`${object.name || object.type}: ${material.type}`);
            });
        });
        Object.entries(world.shadowPass.passes).forEach(([name, pass]) => {
            materials += 1;
            if (!pass.material.isNodeMaterial) plain.push(`shadow ${name}`);
        });
        expect(plain).toEqual([]);
        expect(materials).toBeGreaterThan(HIGH_COAST_PARTS.length);
    });

    it('shows only the parts a capture asks for, and all of them again', () => {
        const { world } = shared;
        world.showOnlyParts(['sky', 'land']);
        expect(world.parts.sky.mesh.visible).toBe(true);
        expect(world.parts.land.mesh.visible).toBe(true);
        expect(world.parts.sea.mesh.visible).toBe(false);
        world.parts.fleet.meshes.forEach((mesh) => expect(mesh.visible).toBe(false));
        world.showOnlyParts(HIGH_COAST_PARTS);
        for (const name of HIGH_COAST_PARTS) {
            const part = world.parts[name];
            for (const mesh of part.meshes || [part.mesh]) expect(mesh.visible, name).toBe(true);
        }
    });

    it('stands the camera at the eye on the rig for its aspect; reduced motion holds it still', () => {
        const { world, camera } = shared;
        begin(shared);
        world.updateCamera(camera, sim(20, 0));
        expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
        expect(camera.fov).toBe(fovForAspect(16 / 9));
        const at = (t, px = 0) => {
            world.updateCamera(camera, sim(t, 0, px));
            return camera.quaternion.clone();
        };
        expect(at(20).angleTo(at(37))).toBeGreaterThan(1e-4); // the lens breathes
        expect(at(20).angleTo(at(20, 1))).toBeGreaterThan(1e-3); // the pointer leans it
        world.setReducedMotion(true);
        try {
            expect(at(20).angleTo(at(37))).toBeLessThan(1e-6);
            expect(at(20).angleTo(at(20, 1))).toBeLessThan(1e-6);
        } finally {
            world.setReducedMotion(false);
        }
        // It looks down across the bay.
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        expect(forward.y).toBeLessThan(0);
        expect(forward.z).toBeLessThan(-0.8);
        begin(shared);
    });

    it('keeps the scene\'s object count stable through every kind of event and many frames', () => {
        const { world, scene } = shared;
        begin(shared);
        const before = {
            scene: scene.children.length, root: world.root.children.length, objects: objectCount(world.root),
        };
        play(shared);
        world.onGameOver();
        stepTo(shared, world.time + TIMING.dusk);
        world.onSessionStart();
        world.resetSession();
        stepTo(shared, world.time + 5, 1 / 15);
        expect({
            scene: scene.children.length, root: world.root.children.length, objects: objectCount(world.root),
        }).toEqual(before);
        expect(world.getState().sceneChildren).toBe(before.root);
    });
});

describe('HighCoastWorld: the rising land', () => {
    /** The sea's level `settle` seconds after one clear from a fresh start. */
    function seaAfter(context, settle = 2) {
        begin(shared);
        shared.world.onClear(context);
        stepTo(shared, START + settle);
        return shared.world.getState().sea;
    }

    it('draws the sea back on a clear, further for more lines and for a longer chain', () => {
        begin(shared);
        expect(shared.world.getState().sea).toBeCloseTo(0, 12);
        const byLines = [1, 2, 3, 4].map((lines) => seaAfter({ lines, combo: 1 }));
        expect(byLines[0]).toBeLessThan(0);
        for (let i = 1; i < 4; i++) expect(byLines[i], `${i + 1} lines`).toBeLessThan(byLines[i - 1]);
        const byChain = [1, 2, 4, 6].map((combo) => seaAfter({ lines: 1, combo }));
        for (let i = 1; i < byChain.length; i++) expect(byChain[i], `chain step ${i}`).toBeLessThan(byChain[i - 1]);
        // The uniforms carry it: the sea's level, and the band of just-risen wet rock above it.
        seaAfter({ lines: 3, combo: 1 }, 1);
        const { world } = shared;
        expect(world.u.sea.value).toBe(world.getState().sea);
        expect(world.u.wetLine.value).toBeGreaterThan(world.u.sea.value);
        expect(world.u.wetLine.value).toBeLessThanOrEqual(0);
        expect(world.u.drain.value).toBeGreaterThan(0); // the sea runs off the risen rock...
        stepTo(shared, world.time + TIMING.drain + 1);
        expect(world.u.drain.value).toBe(0); // ...for a while
        expect(world.counts).toMatchObject({ clears: 1, lines: 3 });
    });

    it('lets the sea return toward rest between clears, never past it', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 3, combo: 1 });
        stepTo(shared, START + 3);
        const risen = world.getState().lift;
        expect(risen).toBeGreaterThan(0);
        let previous = risen;
        for (let t = START + 5; t <= START + 60; t += 2) {
            stepTo(shared, t, 0.25);
            const { lift } = world.getState();
            expect(lift, `t = ${t}`).toBeLessThan(previous);
            expect(lift, `t = ${t}`).toBeGreaterThan(0);
            previous = lift;
        }
        stepTo(shared, START + 600, 0.25);
        expect(world.getState().lift).toBeLessThan(risen * 0.01);
        expect(world.getState().sea).toBeLessThanOrEqual(0);
    });

    it('returns the sea faster after a released chain, with a swell running in', () => {
        const { world } = shared;
        const liftAt = (release) => {
            begin(shared);
            world.onClear({ lines: 3, combo: 1 });
            if (release) {
                world.onCombo(2);
                world.onCombo(3);
                world.onCombo(0);
                expect(world.counts.releases).toBe(1);
            }
            stepTo(shared, START + 3);
            const early = world.getState();
            stepTo(shared, START + 8);
            return { early, late: world.getState() };
        };
        const rest = liftAt(false);
        const released = liftAt(true);
        expect(released.early.liftAsk).toBeLessThan(rest.early.liftAsk);
        expect(released.late.lift).toBeLessThan(rest.late.lift);
        expect(released.late.lift).toBeGreaterThan(0);
        // The swell runs in while it returns; without a release there is none.
        expect(released.early.swell).toBeGreaterThan(0);
        expect(rest.early.swell).toBe(0);
        // A chain of two breaking is no release.
        begin(shared);
        world.onCombo(1);
        world.onCombo(2);
        world.onCombo(0);
        expect(world.counts.releases).toBe(0);
    });

    it('sets the great rebound on four lines, and only on four', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 3, combo: 1 });
        stepTo(shared, START + 0.6);
        expect(world.u.rebound.value).toBe(0);
        expect(world.counts.quads).toBe(0);
        begin(shared);
        world.onClear({ lines: 4, combo: 1 });
        expect(world.counts.quads).toBe(1);
        stepTo(shared, START + 1 / 30);
        expect(world.getPostState().flash).toBeGreaterThan(0.1);
        stepTo(shared, START + 0.6);
        expect(world.u.rebound.value).toBeGreaterThan(0.5);
        expect(world.motes.cursor).toBeGreaterThan(0); // spray off the shores
        stepTo(shared, START + 6);
        expect(world.u.rebound.value).toBe(0);
        expect(world.getPostState().flash).toBe(0);
    });
});

describe('HighCoastWorld: locks', () => {
    it('sends a gust out over the water beside the card and sets a spinnaker on that side', () => {
        const { world } = shared;
        begin(shared);
        const sides = [[0.2, -1, PIECE_COLORS[1]], [0.8, 1, PIECE_COLORS[2]]];
        sides.forEach(([u, side, color], slot) => {
            world.onLock({ u, rows: [14], color });
            const [origin, heading, rgb] = gust(world, slot);
            expect(origin.z, `slot ${slot} start`).toBe(START);
            expect(origin.w, `slot ${slot} power`).toBeGreaterThan(0);
            expect(Math.sign(bearingOf(origin.x, origin.y).bearing), `slot ${slot} side`).toBe(side);
            // It starts on the water, not on the rock.
            expect(groundHeight(world.fields, origin.x, origin.y)).toBeLessThan(world.u.sea.value);
            expect(Math.hypot(heading.x, heading.y)).toBeCloseTo(1, 6);
            expect(heading.z).toBeGreaterThan(0); // speed
            expect(heading.w).toBeGreaterThan(0); // width
            [rgb.x, rgb.y, rgb.z].forEach((v, k) => expect(v).toBeCloseTo(hexToLinear(color)[k], 9));
            // The boat it runs out to: on the lock's side, its spinnaker in the piece's colour.
            const set = world.parts.fleet.boats.filter((boat) => boat.setAt === START && boat.place.side === side);
            expect(set, `slot ${slot}`).toHaveLength(1);
            set[0].colour.forEach((v, k) => expect(v).toBeCloseTo(hexToLinear(color)[k], 9));
            const toBoat = new THREE.Vector2(set[0].place.x - origin.x, set[0].place.z - origin.y).normalize();
            expect(toBoat.x * heading.x + toBoat.y * heading.y).toBeCloseTo(1, 6);
        });
        expect(world.getState().fleet.set).toBe(2);
        expect(world.counts).toMatchObject({ locks: 2, hardDrops: 0 });
    });

    it('sends a hard drop\'s gust out stronger, faster and wider, with a splash', () => {
        const { world } = shared;
        begin(shared);
        world.onLock({ u: 0.2, rows: [12], color: PIECE_COLORS[0] });
        const { cursor } = world.motes;
        world.onLock({
            u: 0.2, rows: [12], color: PIECE_COLORS[0], hardDrop: true, distance: 14,
        });
        const [softOrigin, soft] = gust(world, 0);
        const [hardOrigin, hard] = gust(world, 1);
        expect(hardOrigin.w).toBeGreaterThan(softOrigin.w);
        expect(hard.z).toBeGreaterThan(soft.z);
        expect(hard.w).toBeGreaterThan(soft.w);
        expect(world.motes.cursor).toBeGreaterThan(cursor);
        expect(world.counts).toMatchObject({ locks: 2, hardDrops: 1 });
        expect(world.parts.fleet.boats.some((boat) => boat.setAt === START && boat.hard === 1)).toBe(true);
    });

    it('rings round its gust slots, the newest replacing the oldest', () => {
        const { world } = shared;
        begin(shared);
        expect(GUSTS).toBe(8);
        expect(world.u.tables.gusts).toHaveLength(GUSTS * 3);
        const times = [];
        for (let k = 0; k <= GUSTS; k++) {
            stepTo(shared, START + 0.1 * (k + 1));
            world.onLock({ u: k % 2 ? 0.8 : 0.2, rows: [12], color: PIECE_COLORS[k % 7] });
            times.push(world.time);
            if (k === GUSTS - 1) {
                // Every slot holds one of the eight, each at its own start.
                for (let slot = 0; slot < GUSTS; slot++) {
                    expect(gust(world, slot)[0].z, `slot ${slot}`).toBe(times[slot]);
                }
            }
        }
        expect(gust(world, 0)[0].z).toBe(times[GUSTS]);
        for (let slot = 1; slot < GUSTS; slot++) expect(gust(world, slot)[0].z, `slot ${slot}`).toBe(times[slot]);
        expect(world.gustCursor % GUSTS).toBe(1);
        // A seek empties every slot.
        begin(shared);
        for (let slot = 0; slot < GUSTS; slot++) expect(gust(world, slot)[0].z).toBeLessThan(-1e5);
    });
});

describe('HighCoastWorld: an event\'s water sites', () => {
    // A big clear asked for up to 72 sites at once, each up to 28 marches over the land: its frame
    // took 30–60 ms (play-feel probe at 120 fps, 2026-10-15). The sites now run a few a frame.
    it('asks for a big clear\'s mist and spray without reading the land, then serves them a few a frame', () => {
        const { world } = shared;
        begin(shared);
        const work = world.marchWork;
        world.onClear({ lines: 4, combo: 3 });
        expect(world.marchWork).toBe(work);
        const asked = world.siteQueue.length;
        expect(asked).toBeGreaterThan(30);
        stepTo(shared, START + 1 / 30);
        expect(world.siteQueue.length).toBeGreaterThan(0);
        expect(world.siteQueue.length).toBeLessThan(asked);
        expect(world.motes.cursor).toBeGreaterThan(0); // the rebound's spray goes first
        stepTo(shared, START + 0.9);
        expect(world.siteQueue).toHaveLength(0);
    });

    it('drops the sites it could not serve within a second of their event', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 2, combo: 1 });
        const { cursor } = world.motes;
        world.updateCamera(shared.camera, { time: START + 2, delta: 0 });
        world.update({ time: START + 2, delta: 1 / 30 }, shared.camera);
        expect(world.siteQueue).toHaveLength(0);
        expect(world.motes.cursor).toBe(cursor);
    });
});

describe('HighCoastWorld: the calm, the lighthouse and the day', () => {
    it('lays the sea glass-calm on a perfect clear, then lets the breeze line return', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 2, perfect: true });
        expect(world.counts).toMatchObject({ perfects: 1, clears: 0 });
        stepTo(shared, START + 2);
        expect(world.u.calm.value).toBeGreaterThan(0.99);
        expect(world.getState().calm).toBeGreaterThan(0.99);
        stepTo(shared, START + TIMING.calmHold);
        const held = world.u.calmFront.value;
        stepTo(shared, START + TIMING.calmHold + TIMING.calmReturn * 0.5);
        expect(world.u.calm.value).toBeGreaterThan(0.99);
        expect(world.u.calmFront.value).toBeLessThan(held); // the breeze line comes in
        stepTo(shared, START + TIMING.calmHold + TIMING.calmReturn + 0.1);
        expect(world.u.calm.value).toBe(0);
    });

    it('lights the lighthouse on a back-to-back run and lets it go out after', () => {
        const { world } = shared;
        begin(shared);
        expect(world.getState().beacon).toBe(0);
        world.onB2B(3);
        expect(world.counts.b2bSteps).toBe(1);
        stepTo(shared, START + 4);
        expect(world.getState().beacon).toBeGreaterThan(0.5);
        world.onB2B(0);
        stepTo(shared, START + 10);
        expect(world.getState().beacon).toBeLessThan(0.05);
    });

    it('steps the hour forward on a level-up (a silent one lands at once and is not counted)', () => {
        const { world } = shared;
        begin(shared);
        const { place } = world.light;
        expect(place).toBeCloseTo(START / TIMING.hour, 9);
        world.levelUp(2);
        expect(world.counts.levelUps).toBe(1);
        stepTo(shared, START + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(1, 9);
        expect(world.getState()).toMatchObject({ level: 2, hour: { from: 1 } });
        world.levelUp(3, { silent: true });
        expect(world.counts.levelUps).toBe(1);
        stepTo(shared, world.time + 0.1);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(2, 9);
    });

    it('keeps the light through a new run, and the next level-up steps forward from it', () => {
        const { world } = shared;
        begin(shared);
        world.levelUp(2);
        world.levelUp(3);
        for (let n = 1; n <= 3; n++) world.onCombo(n);
        world.onB2B(2);
        stepTo(shared, START + TIMING.levelTurn + 0.2);
        const { place } = world.light;
        expect(place - world.time / TIMING.hour).toBeCloseTo(2, 9);
        world.resetSession();
        expect(world).toMatchObject({
            level: 1, combo: 0, peak: 0, b2b: 0,
        });
        stepTo(shared, world.time + 1 / 30);
        expect(world.light.place).toBeCloseTo(place + 1 / 30 / TIMING.hour, 9);
        world.levelUp(2);
        stepTo(shared, world.time + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(3, 9);
    });

    it('lets dusk fall at game over with the lamps lit; the next lock brings the morning', () => {
        const { world } = shared;
        begin(shared);
        world.onGameOver();
        expect(world.counts.gameOvers).toBe(1);
        stepTo(shared, START + TIMING.dusk + 0.2);
        expect(world.dusk).toBeCloseTo(1, 6);
        expect(world.u.dusk.value).toBeCloseTo(1, 6);
        expect(world.u.lamps.value).toBeGreaterThan(0.99);
        world.onLock({ u: 0.3, rows: [10], color: PIECE_COLORS[2] });
        expect(world.counts.mornings).toBe(1);
        stepTo(shared, world.time + TIMING.dawn + 0.2);
        expect(world.dusk).toBe(0);
        expect(world.u.lamps.value).toBeLessThan(0.5);
    });
});

describe('HighCoastWorld state', () => {
    /** What a capture would see: the session, every uniform, the fleet and the post. */
    const read = ({ world }) => ({
        state: world.getState(),
        uniforms: uniformValues(world),
        fleet: world.parts.fleet.exportState(),
        post: structuredClone(world.getPostState()),
    });

    it('seeks deterministically: a seek and the same events draw the same frame', () => {
        begin(shared);
        play(shared);
        const first = read(shared);
        expect(first.state.counts).toMatchObject({
            locks: 6, hardDrops: 1, clears: 6, quads: 1, tspins: 1, perfects: 1, levelUps: 1,
        });
        begin(shared);
        play(shared);
        expect(read(shared)).toEqual(first);
    });

    // BUG (high-coast-world.js): a seek does not re-seed `this.random`, from which the motes' spray
    // and sea mist draw their places, so the same events after a seek throw them elsewhere: an
    // in-page seek (a contact sheet) never reproduces a frame. Fix, in resetState():
    // `this.random = mulberry32(this.seed ^ 0x51ab);`.
    it('replays the spray and the mist the same after a seek', () => {
        const { world } = shared;
        const air = () => ({
            start: Array.from(world.motes.start),
            move: Array.from(world.motes.move),
            look: Array.from(world.motes.look),
        });
        begin(shared);
        play(shared);
        const first = air();
        begin(shared);
        play(shared);
        const second = air();
        // How many values of each differ (a count, so a failure reads in one line).
        const differing = Object.fromEntries(Object.keys(first).map((key) => [
            key, first[key].filter((v, i) => !Object.is(v, second[key][i])).length,
        ]));
        expect(differing).toEqual({ start: 0, move: 0, look: 0 });
        expect(first.start.some((v, i) => i % 4 === 3 && v > 0)).toBe(true); // something was thrown up
    });

    // BUG (high-coast-world.js): resetState() resets the fleet and the motes but not the gulls
    // (`parts.life` has a reset() for its eased `gather` and its `startleAt`), so after a seek the
    // gulls still circle low over the bay, gathered by a chain that the seek undid. Fix, in
    // resetState(): `this.parts?.life?.reset?.();` beside the fleet's and the motes' resets.
    it('forgets the gulls\' gathering on a seek, as a fresh world has none', () => {
        const fresh = makeWorld();
        try {
            begin(fresh);
            const gulls = (w) => Array.from(w.world.parts.life.mesh.instanceMatrix.array);
            const expected = gulls(fresh);
            begin(shared);
            for (let n = 1; n <= 6; n++) shared.world.onCombo(n);
            stepTo(shared, START + 10);
            begin(shared);
            const after = gulls(shared);
            expect(after.filter((v, i) => Math.abs(v - expected[i]) > 1e-3).length).toBe(0);
        } finally {
            fresh.world.dispose();
        }
    });

    it('round-trips a session through export and import (structured-clone equal)', () => {
        begin(shared);
        play(shared);
        const snapshot = structuredClone(shared.world.exportSessionState());
        expect(snapshot).toEqual(shared.world.exportSessionState());
        const other = makeWorld();
        try {
            begin(other, shared.world.time);
            other.world.importSessionState(snapshot);
            expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
            expect(other.world.counts).toEqual(shared.world.counts);
            for (const t of [shared.world.time, shared.world.time + 3, shared.world.time + 250]) {
                expect(other.world.wheel.place(t), `t = ${t}`).toBeCloseTo(shared.world.wheel.place(t), 12);
            }
            // A snapshot of another shape, or none, changes nothing.
            other.world.importSessionState({ record: [] });
            other.world.importSessionState(null);
            expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
        } finally {
            other.world.dispose();
        }
    });

    // BUG (high-coast-world.js): SNAPSHOT does not carry `beaconShown` (the lighthouse's eased
    // strength), so a world rebuilt in place during a back-to-back run starts it from 0: the
    // lighthouse goes dark and fades back in over a few seconds. Fix: add 'beaconShown' to SNAPSHOT
    // (and 'levelUpAt', which the lighthouse's level-up signal reads, for the same reason).
    it('draws the same frame after an import as the world it came from', () => {
        begin(shared);
        play(shared);
        const snapshot = structuredClone(shared.world.exportSessionState());
        const other = makeWorld();
        try {
            begin(other, shared.world.time);
            other.world.importSessionState(snapshot);
            const t = shared.world.time + 1 / 30;
            for (const w of [shared, other]) {
                w.world.updateCamera(w.camera, { time: t, delta: 0 });
                w.world.update({ time: t, delta: 1 / 30 }, w.camera);
            }
            const drawn = [
                'sea', 'wetLine', 'drain', 'swell', 'calm', 'calmFront', 'breeze', 'rebound', 'sunDir', 'sun',
                'horizon', 'dusk', 'lamps',
            ];
            for (const key of drawn) {
                const a = shared.world.u[key].value;
                const b = other.world.u[key].value;
                expect(typeof b === 'number' ? b : b.toArray(), key).toEqual(typeof a === 'number' ? a : a.toArray());
            }
            expect(other.world.u.beacon.value.x, 'beacon').toBeCloseTo(shared.world.u.beacon.value.x, 9);
            expect(other.world.parts.fleet.exportState()).toEqual(shared.world.parts.fleet.exportState());
        } finally {
            other.world.dispose();
        }
    });

    it('hands the post one object, every frame, with finite values', () => {
        const { world } = shared;
        begin(shared);
        const post = world.getPostState();
        world.onClear({ lines: 4, combo: 1 });
        for (let k = 1; k <= 20; k++) {
            stepTo(shared, START + k / 10);
            expect(world.getPostState()).toBe(post);
        }
        const { sun } = post;
        for (const v of [post.exposure, post.bloomBoost, post.flash, post.saturation, sun.x, sun.y, sun.strength]) {
            expect(Number.isFinite(v)).toBe(true);
        }
    });

    it('keeps every uniform finite over a long scripted session', () => {
        const { world } = shared;
        begin(shared, 0);
        const bad = [];
        let combo = 0;
        for (let frame = 1; frame <= 1500; frame++) {
            const t = frame / 15;
            if (frame % 22 === 0) {
                world.onLock({
                    u: (frame * 0.173) % 1,
                    rows: [19 - (frame % 20)],
                    color: PIECE_COLORS[frame % 8],
                    hardDrop: frame % 66 === 0,
                    distance: frame % 19,
                });
            }
            if (frame % 44 === 0) {
                const lines = 1 + (frame % 4);
                combo = frame % 440 < 330 ? combo + 1 : 0;
                world.onClear({ lines, combo: Math.max(1, combo), tspin: frame % 352 === 0 });
                world.onCombo(combo);
                world.onB2B(lines === 4 ? Math.min(4, world.b2b + 1) : 0);
            }
            if (frame === 700) world.onClear({ lines: 4, perfect: true });
            if (frame % 400 === 0) world.levelUp(world.level + 1);
            if (frame === 1100) world.onGameOver();
            if (frame === 1160) world.resetSession();
            world.updateCamera(shared.camera, sim(t, 0, Math.sin(t), Math.cos(t * 0.7)));
            world.update(sim(t, 1 / 15), shared.camera);
            if (frame % 30 === 0) {
                for (const [key, v] of uniformValues(world)) {
                    if (!Number.isFinite(v)) bad.push(`${key} at ${t.toFixed(2)} s: ${v}`);
                }
            }
        }
        expect(bad.slice(0, 10)).toEqual([]);
        expect(world.counts.locks).toBeGreaterThan(50);
        expect(world.counts.gameOvers).toBe(1);
        begin(shared);
    });
});

describe('HighCoastWorld GPU work and teardown', () => {
    it('paints the land\'s shadow before the frame only when the sun has moved', () => {
        const { world } = shared;
        begin(shared);
        const renderer = {
            setRenderTarget: vi.fn(), getRenderTarget: vi.fn(() => null), render: vi.fn(),
        };
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(3); // every field the first time
        expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null); // the frame's target restored
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(3); // nothing moved
        stepTo(shared, START + 40, 0.25);
        world.prerender(renderer);
        expect(renderer.render).toHaveBeenCalledTimes(4); // then one stale field a frame
        // A renderer without targets is skipped, not thrown at.
        expect(() => world.prerender({})).not.toThrow();
        begin(shared);
    });

    it('disposes once, however often it is asked, and ignores what comes after', () => {
        const own = makeWorld();
        const { world, scene, camera } = own;
        begin(own);
        world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
        const disposeLand = vi.spyOn(world.parts.land.mesh.geometry, 'dispose');
        world.dispose();
        expect(() => world.dispose()).not.toThrow();
        expect(disposeLand).toHaveBeenCalledOnce();
        expect(world.root.parent).toBeNull();
        expect(world.root.children).toHaveLength(0);
        expect(scene.children).not.toContain(world.root);
        const renderer = {
            setRenderTarget: vi.fn(), getRenderTarget: vi.fn(() => null), render: vi.fn(),
        };
        const counts = { ...world.counts };
        expect(() => {
            world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
            world.onClear({ lines: 2, combo: 1 });
            world.update(sim(world.time + 1, 0.1), camera);
            world.prerender(renderer);
        }).not.toThrow();
        expect(world.counts).toEqual(counts);
        expect(renderer.render).not.toHaveBeenCalled();
    });
});
