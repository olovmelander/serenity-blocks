/**
 * Waves — the playground effect.
 *
 * The effect mounts the same WavesWorld and WavesPost the theme ships and drives them from URL
 * parameters, so a capture is a seek to a time with the gameplay that led up to it replayed. These
 * tests mount it on a renderer double (nothing is drawn) and read the world it built.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { create, meta } from '../../src/playground/effects/waves.effect.js';
import {
    HOLD_SECONDS, REST_RIG, WavesWorld, openForCombo,
} from '../../src/themes/waves/waves-world.js';
import { landingDistance, pieceLight } from '../../src/themes/waves/waves-core.js';
import { QUALITY } from '../../src/themes/waves/waves-quality.js';
import { WavesPost } from '../../src/themes/waves/waves-post.js';
import { sunDirection } from '../../src/themes/waves/waves-tsl.js';
import { GRAVITY } from '../../src/themes/waves/waves-spray.js';

vi.setConfig({ testTimeout: 30_000 }); // every mount builds a wave, on a machine that may be busy

const mocks = vi.hoisted(() => ({ pipelines: [] }));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        RenderPipeline: class {
            constructor() {
                this.render = vi.fn();
                this.dispose = vi.fn();
                mocks.pipelines.push(this);
            }
        },
    };
});

const WIDTH = 1440;
const HEIGHT = 900;
const mounted = [];

/** Mount the effect as the playground does, on a renderer that draws nothing. */
function mount(query = '', { quality = 'Low', renderer = {} } = {}) {
    if (!globalThis.window?.innerWidth) vi.stubGlobal('window', { innerWidth: WIDTH, innerHeight: HEIGHT });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 240);
    const stage = {
        render: vi.fn(),
        toneMapping: THREE.NoToneMapping,
        getDrawingBufferSize: (target) => target.set(WIDTH, HEIGHT),
        ...renderer,
    };
    const build = vi.spyOn(WavesWorld.prototype, 'build');
    const search = [quality ? `quality=${quality}` : '', query].filter(Boolean).join('&');
    const effect = create({
        scene, camera, renderer: stage, params: new URLSearchParams(search),
    });
    // The world is the effect's own: build() returns it.
    const world = build.mock.results[build.mock.results.length - 1].value;
    const mountedEffect = {
        effect, world, scene, camera, renderer: stage, pipeline: mocks.pipelines[mocks.pipelines.length - 1],
    };
    mounted.push(mountedEffect);
    return mountedEffect;
}

afterEach(() => {
    for (const { effect } of mounted.splice(0)) effect.dispose();
    mocks.pipelines.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const rows = (list, count) => list.slice(0, count).map((row) => row.toArray());
const liveBands = (world) => world.bandRows.filter((row) => row.y > 0).map((row) => row.toArray());
const sorted = (list) => [...list].sort((p, q) => p[0] - q[0] || p[1] - q[1]);

/** How many drops of the spray pool have been thrown since it was last emptied. */
function thrown(world) {
    const start = world.spray.geometry.getAttribute('aStart');
    let n = 0;
    for (let i = 0; i < world.spray.count; i++) if (start.getW(i) > -1000) n += 1;
    return n;
}

/**
 * Everything that decides what a frame looks like. The counters a seek does not rewind (`locks`,
 * `clears`, `leaps`: see the expected failure in waves-world.test.js) and the slots the bands sit in
 * are left out, so a replay on the same world can be compared with the first play.
 */
function picture(world) {
    const { U } = world;
    const {
        locks, clears, leaps, ...state
    } = world.getState();
    return {
        state,
        rings: rows(world.ringRows, world.ringCount),
        ribbons: rows(world.ribbonRows, world.ribbonCount * 2),
        bands: sorted(liveBands(world)),
        uniforms: [U.time.value, U.open.value, U.warm.value, U.glow.value, U.tear.value, ...U.bulge.value.toArray()],
        spray: Array.from(world.spray.data),
        pod: Array.from(world.pod.data),
    };
}

describe('waves playground effect: mounting', () => {
    it('mounts the theme\'s own world on the theme\'s rig, as a capture', () => {
        expect(meta).toMatchObject({ id: 'waves' });
        expect(meta.title).toBeTruthy();
        const {
            effect, world, scene, camera,
        } = mount();
        expect(world).toBeInstanceOf(WavesWorld);
        expect(scene.children).toEqual([world.group]);
        expect(world.capture).toBe(true);
        expect(world.quality).toBe('Low');
        expect(world.tier).toBe(QUALITY.Low);
        expect(world.camera).toBe(camera);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        expect(camera.aspect).toBeCloseTo(WIDTH / HEIGHT, 12);
        expect(world.aspect).toBeCloseTo(WIDTH / HEIGHT, 12);
        expect(world.viewport).toEqual({ w: WIDTH, h: HEIGHT });
        // No mock board: the world aims at the solo board's place, and the post is not calmed.
        expect(world.hasBoard).toBe(false);
        for (const method of ['camera', 'update', 'seek', 'render', 'resize', 'getDiagnostics', 'dispose']) {
            expect(typeof effect[method], method).toBe('function');
        }
        expect(effect.cameraRadius).toBeGreaterThan(0);
    });

    it('reads its tier, its seed, its sun, its parts and its motion setting from the URL', () => {
        const plain = mount('', { quality: null });
        expect(plain.world.quality).toBe('High');
        expect(plain.world.reducedMotion).toBe(false);
        expect(plain.world.sunDir.toArray()).toEqual(sunDirection().toArray());
        expect(Object.values(plain.world.parts).every((part) => part.mesh.visible)).toBe(true);
        const told = mount('seed=42&sunAz=30&sunEl=20&parts=sky,%20water&reduce=1', { quality: 'Minimal' });
        expect(told.world.quality).toBe('Minimal');
        expect(told.world.seed).toBe(42);
        expect(told.world.sunDir.toArray()).toEqual(sunDirection(30, 20).toArray());
        expect(told.world.reducedMotion).toBe(true);
        for (const [name, part] of Object.entries(told.world.parts)) {
            expect(part.mesh.visible, name).toBe(name === 'sky' || name === 'water');
        }
        // The hour: the clock's unless the URL holds one, and a level is an hour further round.
        expect(plain.world.hour.pin).toBe(null);
        const held = mount('hour=3');
        held.effect.seek(20);
        expect(held.world.getState()).toMatchObject({ hour: 'moon', hourPlace: 3, hourMix: 0 });
        const between = mount('hour=2.4&level=5');
        between.effect.seek(140);
        expect(between.world.getState()).toMatchObject({ hour: 'afterglow', hourNext: 'moon', hourPlace: 2.4 });
        const levelled = mount('level=4');
        levelled.effect.seek(10);
        expect(levelled.world.getState()).toMatchObject({ level: 4, hour: 'moon' });
        // A tier it does not know is the High tier, with the High tier's look.
        const odd = mount('', { quality: 'Nonsense' });
        expect(odd.world.tier).toBe(QUALITY.High);
    });

    it('draws through the post stack, or raw when told to', () => {
        const update = vi.spyOn(WavesPost.prototype, 'update');
        const graded = mount();
        expect(graded.pipeline).toBeTruthy();
        expect(graded.renderer.toneMapping).toBe(THREE.NoToneMapping);
        graded.effect.update(0.5, 0.5);
        // The post is told the wave's state and the frame's time.
        expect(update).toHaveBeenCalled();
        const told = update.mock.calls[update.mock.calls.length - 1][0];
        expect(told).toMatchObject({ ...graded.world.getPostState(), time: 0.5 });
        graded.effect.render();
        expect(graded.pipeline.render).toHaveBeenCalledOnce();
        expect(graded.renderer.render).not.toHaveBeenCalled();

        mocks.pipelines.length = 0;
        const raw = mount('noPost=1');
        expect(mocks.pipelines).toHaveLength(0);
        expect(raw.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        raw.effect.update(0.5, 0.5);
        raw.effect.render();
        expect(raw.renderer.render).toHaveBeenCalledExactlyOnceWith(raw.scene, raw.camera);
    });

    it('follows the window when it is resized', () => {
        const { effect, world, camera } = mount();
        const viewport = vi.spyOn(world, 'setViewport');
        vi.stubGlobal('window', { innerWidth: 800, innerHeight: 1000 });
        effect.resize();
        expect(viewport).toHaveBeenCalledExactlyOnceWith(WIDTH, HEIGHT, 0.8);
        expect(camera.aspect).toBeCloseTo(0.8, 12);
        expect(world.aspect).toBeCloseTo(0.8, 12);
    });

    it('aims the lens without moving the world, and leans it with a held pointer', () => {
        const still = mount();
        const leaning = mount('px=1&py=0');
        still.effect.seek(5);
        leaning.effect.seek(5);
        expect(leaning.camera.position.x).toBeGreaterThan(still.camera.position.x);
        const aim = vi.spyOn(still.world, 'updateCamera');
        const move = vi.spyOn(still.world, 'update');
        still.effect.camera(5.5);
        expect(aim).toHaveBeenCalledOnce();
        expect(aim.mock.calls[0][1]).toMatchObject({ time: 5.5, delta: 0 });
        expect(move).not.toHaveBeenCalled();
        expect(still.world.time).toBe(5);
        // The icon's lens is tighter, and turned to the eye of the barrel.
        const icon = mount('icon=1&iconFov=50');
        const wide = mount();
        icon.effect.seek(5);
        wide.effect.seek(5);
        expect(icon.camera.fov).toBe(50);
        expect(wide.camera.fov).not.toBe(50);
        const iconView = new THREE.Vector3();
        const wideView = new THREE.Vector3();
        icon.camera.getWorldDirection(iconView);
        wide.camera.getWorldDirection(wideView);
        expect(iconView.x).toBeLessThan(wideView.x); // further left, where the barrel opens
    });

    it('runs live: every update is a frame of the world at the time it is given', () => {
        const { effect, world } = mount();
        for (let i = 1; i <= 90; i++) effect.update(i / 60, 1 / 60);
        expect(world.time).toBeCloseTo(1.5, 12);
        expect(world.clock).toBeCloseTo(1.5, 9);
        expect(world.getState()).toMatchObject({ locks: 0, clears: 0, combo: 0 });
    });

    it('plays its demo script when asked: locks, clears, a chain that calls the dolphins and breaks', () => {
        const { effect, world } = mount('demo=1');
        let longest = 0;
        let broke = false;
        const wrong = [];
        for (let i = 1; i <= 34 * 30; i++) {
            effect.update(i / 30, 1 / 30);
            const { combo } = world.getState();
            if (combo < longest && combo === 0) broke = true;
            longest = Math.max(longest, combo);
            const numbers = [world.U.open.value, world.U.glow.value, world.U.warm.value, world.U.tear.value];
            if (!numbers.every(Number.isFinite)) wrong.push(`at ${i / 30} s: ${numbers}`);
        }
        expect(wrong).toEqual([]);
        const state = world.getState();
        expect(state.locks).toBeGreaterThan(10);
        expect(state.clears).toBeGreaterThan(5);
        expect(state.leaps).toBeGreaterThan(0);
        expect(longest).toBeGreaterThan(4);
        expect(broke).toBe(true);
        // Without the flag nothing plays by itself.
        const quiet = mount();
        for (let i = 1; i <= 300; i++) quiet.effect.update(i / 30, 1 / 30);
        expect(quiet.world.getState()).toMatchObject({ locks: 0, clears: 0, leaps: 0 });
    });

    it('lets go of everything and hands the camera and the renderer back as they were', () => {
        const {
            effect, world, scene, camera, renderer, pipeline,
        } = mount('noPost=0&icon=1');
        const disposeWorld = vi.spyOn(world, 'dispose');
        effect.seek(4);
        expect(camera.fov).not.toBe(75);
        effect.dispose();
        expect(disposeWorld).toHaveBeenCalledOnce();
        expect(pipeline.dispose).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
        expect(world.camera).toBeNull();
        expect(camera.fov).toBe(75);
        expect(camera.near).toBe(0.1);
        expect(camera.far).toBe(240);
        expect(camera.up.toArray()).toEqual([0, 1, 0]);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        // The raw mount gives the tone mapping back too.
        const raw = mount('noPost=1', { renderer: { toneMapping: THREE.ACESFilmicToneMapping } });
        expect(raw.renderer.toneMapping).toBe(THREE.AgXToneMapping);
        raw.effect.dispose();
        expect(raw.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    });
});

describe('waves playground effect: captures', () => {
    it('replays the same picture after seeking away and back', () => {
        const { effect, world } = mount('event=clear&lines=3&eventAge=0.8&combo=5&locks=3&leap=2&leapAge=2&level=3');
        effect.seek(12);
        const first = picture(world);
        // The capture is what the URL asks for.
        expect(first.state).toMatchObject({ time: 12, combo: 5, level: 3 });
        expect(first.rings.length).toBeGreaterThan(0);
        expect(first.bands).toHaveLength(3);
        expect(first.state.airborne).toBeGreaterThan(0);
        expect(first.spray.every(Number.isFinite)).toBe(true);
        effect.seek(3);
        expect(world.time).toBe(3);
        expect(picture(world)).not.toEqual(first);
        effect.seek(12);
        expect(picture(world)).toEqual(first);
        // And after running live for a while.
        for (let i = 1; i <= 120; i++) effect.update(12 + i / 60, 1 / 60);
        expect(picture(world)).not.toEqual(first);
        effect.seek(12);
        expect(picture(world)).toEqual(first);
    });

    it('replays a hard drop to the same ring, the same ribbon and the same crown of spray', () => {
        const { effect, world } = mount('event=drop&eventAge=1.5&u=0.2&row=15');
        effect.seek(7);
        const first = picture(world);
        expect(first.rings).toHaveLength(1);
        expect(first.ribbons).toHaveLength(2); // its head and its tint
        expect(thrown(world)).toBeGreaterThan(0);
        for (const away of [0, 30, 6.9]) {
            effect.seek(away);
            effect.seek(7);
            expect(picture(world), `after a seek to ${away}`).toEqual(first);
        }
    });

    it('builds the same capture on another mount, and another one for another seed', () => {
        const query = 'event=quad&combo=7&locks=2&leap=3';
        const a = mount(query);
        const b = mount(query);
        const c = mount(`${query}&seed=5`);
        a.effect.seek(9);
        b.effect.seek(9);
        c.effect.seek(9);
        expect(picture(b.world)).toEqual(picture(a.world));
        expect(b.effect.getDiagnostics()).toEqual(a.effect.getDiagnostics());
        expect(picture(c.world).spray).not.toEqual(picture(a.world).spray);
    });

    it('replays once while the time is pinned, and again after a live frame', () => {
        const { effect, world } = mount('event=lock');
        const seek = vi.spyOn(world, 'seek');
        effect.seek(8);
        effect.seek(8);
        effect.seek(8);
        expect(seek).toHaveBeenCalledOnce();
        // The event was fired once, not once a seek.
        expect(world.getState()).toMatchObject({ ribbons: 1, time: 8 });
        effect.seek(8.5);
        expect(seek).toHaveBeenCalledTimes(2);
        effect.update(8.6, 0.1);
        effect.seek(8.5);
        expect(seek).toHaveBeenCalledTimes(3);
        expect(world.time).toBe(8.5);
    });

    it('plays the world up to the time from a little before it, never from before the start', () => {
        const { effect, world } = mount();
        const seek = vi.spyOn(world, 'seek');
        effect.seek(100);
        const lead = 100 - seek.mock.calls[0][0];
        expect(lead).toBeGreaterThan(0.5);
        expect(lead).toBeLessThan(60);
        expect(world.time).toBe(100);
        expect(world.clock).toBeCloseTo(100, 6);
        effect.seek(lead / 2);
        expect(seek).toHaveBeenLastCalledWith(0);
        expect(world.time).toBe(lead / 2);
        effect.seek(0);
        expect(world.time).toBe(0);
        expect(world.clock).toBe(0);
        // A capture with gameplay in it is given longer, so the gameplay fits in before the time.
        const busy = mount('combo=4&locks=4&event=clear&eventAge=2');
        const busySeek = vi.spyOn(busy.world, 'seek');
        busy.effect.seek(100);
        expect(100 - busySeek.mock.calls[0][0]).toBeGreaterThan(lead + 2);
    });

    it('shows a lock at the age it is asked for, where and in the colour it is asked for', () => {
        const { effect, world } = mount('event=lock&eventAge=0.5&u=0.8&row=6&color=ff0000');
        effect.seek(10);
        expect(world.getState()).toMatchObject({
            locks: 1, ribbons: 1, clears: 0, time: 10,
        });
        expect(world.ringCount).toBeGreaterThanOrEqual(1);
        const [head, tint] = rows(world.ribbonRows, 2);
        // Born half a second before the frame.
        expect(world.clock - head[2]).toBeCloseTo(0.5, 6);
        expect(tint.slice(0, 3)).toEqual(pieceLight('#ff0000'));
        // Another column and another row is another ribbon.
        const other = mount('event=lock&eventAge=0.5&u=0.1&row=18&color=%2300ff00');
        other.effect.seek(10);
        const [otherHead, otherTint] = rows(other.world.ribbonRows, 2);
        expect(otherTint.slice(0, 3)).toEqual(pieceLight('#00ff00'));
        expect(Math.hypot(otherHead[0] - head[0], otherHead[1] - head[1])).toBeGreaterThan(0.05);
        // With no colour given the piece still has one of the game's.
        const plain = mount('event=lock');
        plain.effect.seek(10);
        const [, plainTint] = rows(plain.world.ribbonRows, 2);
        expect(Math.max(...plainTint.slice(0, 3))).toBe(1);
        expect(plainTint.slice(0, 3)).not.toEqual(pieceLight(null));
    });

    it('strikes a drop harder than a lock', () => {
        const lock = mount('event=lock&eventAge=0.3');
        const drop = mount('event=drop&eventAge=0.3');
        lock.effect.seek(10);
        drop.effect.seek(10);
        expect(drop.world.getState()).toMatchObject({ locks: 1, ribbons: 1 });
        expect(drop.world.ringRows[0].w).toBeGreaterThan(lock.world.ringRows[0].w);
        expect(drop.world.ribbonRows[0].w).toBeGreaterThan(lock.world.ribbonRows[0].w);
        expect(drop.world.U.glow.value).toBeGreaterThan(lock.world.U.glow.value);
    });

    it.each([
        ['clear&lines=1', 1, false],
        ['clear', 2, false], // two lines when it is not told how many
        ['clear&lines=3', 3, false],
        ['clear&lines=9', 4, true],
        ['quad', 4, true],
        ['tspin', 2, false],
        ['perfect', 4, true],
    ])('shows event=%s as a clear of %s line(s)', (event, lines, held) => {
        const age = Math.min(0.5, HOLD_SECONDS / 2);
        const { effect, world } = mount(`event=${event}&eventAge=${age}`);
        effect.seek(10);
        const state = world.getState();
        expect(state).toMatchObject({ clears: 1, locks: 0, holding: held });
        const bands = liveBands(world);
        expect(bands).toHaveLength(lines);
        // The first band left with the clear, `age` seconds of the frame's time ago.
        const first = Math.min(...bands.map((band) => band[0]));
        if (held) {
            // The wave is holding: its clock has fallen behind the frame's time.
            expect(state.clock).toBeLessThan(state.time);
            expect(state.clock - first).toBeLessThanOrEqual(age + 1e-9);
        } else {
            expect(state.clock).toBeCloseTo(state.time, 9);
            expect(state.clock - first).toBeCloseTo(age, 6);
        }
        expect(state.open).toBeGreaterThan(0);
        expect(state.glow).toBeGreaterThan(0);
        // A T-spin's bands are screws of light; the whole pod answers a perfect clear.
        expect(bands.every((band) => band[3] !== 0)).toBe(event === 'tspin');
        expect(state.leaps).toBe(event === 'perfect' ? world.pod.count : 0);
    });

    it('shows a new level as a set wave in the tube, and rests on a level silently', () => {
        const up = mount('event=levelUp&eventAge=0.6');
        up.effect.seek(10);
        expect(up.world.getState()).toMatchObject({ level: 2, locks: 0, clears: 0 });
        expect(up.world.U.bulge.value.y).toBeGreaterThan(0);
        const told = mount('event=levelUp&eventLevel=7&level=4');
        told.effect.seek(10);
        expect(told.world.getState().level).toBe(7);
        const resting = mount('level=4');
        resting.effect.seek(10);
        expect(resting.world.getState().level).toBe(4);
        expect(resting.world.U.bulge.value.y).toBe(0);
        // An event it does not know is no event.
        const unknown = mount('event=earthquake');
        unknown.effect.seek(10);
        expect(unknown.world.getState()).toMatchObject({
            locks: 0, clears: 0, leaps: 0, level: 1, rings: 0, ribbons: 0,
        });
        expect(liveBands(unknown.world)).toHaveLength(0);
    });

    it('holds a chain and plays warm-up locks before the frame', () => {
        const { effect, world } = mount('combo=6&locks=4');
        // The locks as the world is given them, and the clock it is given them at.
        const played = [];
        const lock = world.onLock.bind(world);
        vi.spyOn(world, 'onLock').mockImplementation((c) => {
            played.push({ ...c, clock: world.clock });
            lock(c);
        });
        const chain = vi.spyOn(world, 'onCombo');
        effect.seek(20);
        const state = world.getState();
        expect(state).toMatchObject({ combo: 6, locks: 4, clears: 0 });
        expect(chain).toHaveBeenCalledExactlyOnceWith(6);
        // The chain has had time to open the barrel as far as it holds it.
        expect(state.open).toBeCloseTo(openForCombo(6), 2);
        expect(state.landing).toBeCloseTo(landingDistance(openForCombo(6)), 2);
        expect(state.warm).toBeGreaterThan(0);
        // The locks came one after another, before anything else, each in a colour of its own.
        expect(played).toHaveLength(4);
        expect(played.every((c, i) => i === 0 || c.clock > played[i - 1].clock)).toBe(true);
        expect(played[3].clock).toBeLessThan(20);
        expect(new Set(played.map((c) => c.color)).size).toBe(4);
        for (const c of played) {
            expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(c.u).toBeGreaterThanOrEqual(0);
            expect(c.u).toBeLessThanOrEqual(1);
            expect(c.rows.every((row) => Number.isInteger(row) && row >= 0 && row <= 19)).toBe(true);
        }
    });

    it('sends as many dolphins as it is asked for, the first across the sun when told to', () => {
        const { effect, world } = mount('leap=2&leapAge=2');
        effect.seek(10);
        expect(world.getState()).toMatchObject({
            leaps: 2, airborne: 2, locks: 0, clears: 0,
        });
        const [first, second] = world.pod.arcs;
        // Sent two seconds before the frame, one after the other.
        expect(first.t0).toBeGreaterThan(8);
        expect(first.t0).toBeLessThan(10);
        expect(second.t0).toBeGreaterThan(first.t0);
        // More than the tier has: the whole pod, no more.
        const many = mount('leap=100&leapAge=1');
        many.effect.seek(10);
        expect(many.world.getState().leaps).toBe(many.world.pod.count);
        // hero=1 throws the first so that the top of its arc crosses the sun.
        const hero = mount('leap=1&hero=1');
        hero.effect.seek(10);
        const [arc] = hero.world.pod.arcs;
        const t = arc.vy / GRAVITY;
        const rise = arc.vy * t - 0.5 * GRAVITY * t * t;
        const top = new THREE.Vector3(arc.x + arc.vx * t, arc.y + rise, arc.z + arc.vz * t);
        const rel = top.sub(new THREE.Vector3(REST_RIG.eye.x, REST_RIG.eye.y, REST_RIG.eye.z));
        const sun = hero.world.sunDir;
        expect(rel.clone().sub(sun.clone().multiplyScalar(rel.dot(sun))).length()).toBeLessThan(0.3);
        // Asked for none: none.
        const none = mount('leap=0');
        none.effect.seek(10);
        expect(none.world.getState()).toMatchObject({ leaps: 0, airborne: 0 });
    });

    it('reports the renderer and the world\'s own state as its diagnostics', () => {
        const { effect, world } = mount('event=lock');
        effect.seek(10);
        const diagnostics = effect.getDiagnostics();
        expect(diagnostics).toEqual({
            backend: 'WebGL2', calls: null, triangles: null, ...world.getState(),
        });
        for (const key of ['quality', 'time', 'clock', 'combo', 'level', 'open', 'rings', 'ribbons', 'airborne']) {
            expect(diagnostics, key).toHaveProperty(key);
        }
        expect(diagnostics).toMatchObject({
            quality: 'Low', time: 10, locks: 1, ribbons: 1,
        });
        // On the GPU backend, with the renderer's own counts.
        const gpu = mount('', {
            renderer: { backend: { isWebGPUBackend: true }, info: { render: { calls: 7, triangles: 1234 } } },
        });
        expect(gpu.effect.getDiagnostics()).toMatchObject({ backend: 'WebGPU', calls: 7, triangles: 1234 });
        // It can be serialised: the playground prints it.
        expect(() => JSON.stringify(diagnostics)).not.toThrow();
    });
});

describe('waves playground effect: the mock board', () => {
    /** A page that lays the mock card, board and HUD out where the test says. */
    function stubPage({ hud = true } = {}) {
        const rects = {
            card: [500, 71, 440, 758], board: [570, 205, 300, 600], hud: [1000, 225, 140, 450],
        };
        const made = [];
        const element = () => {
            const node = {
                style: {},
                dataset: {},
                className: '',
                id: '',
                children: [],
                append: (...kids) => node.children.push(...kids),
                remove: vi.fn(),
                getBoundingClientRect: () => {
                    let rect = null;
                    if (node.className === 'player-card') rect = rects.card;
                    else if (node.id === 'single-player-game-canvas') rect = rects.board;
                    else if (node.className === 'single-player-stats-bar') rect = rects.hud;
                    const [left, top, width, height] = rect || [0, 0, 0, 0];
                    return {
                        left, top, width, height, right: left + width, bottom: top + height,
                    };
                },
            };
            made.push(node);
            return node;
        };
        const find = (selector) => made.filter((node) => {
            const isCard = node.className === 'player-card' && Boolean(node.dataset.player);
            if (selector === '.player-card[data-player]') return isCard;
            if (selector === '.single-player-stats-bar') return node.className === 'single-player-stats-bar';
            if (selector === '#single-player-game-canvas') return node.id === 'single-player-game-canvas';
            return false;
        });
        const body = { appendChild: vi.fn() };
        vi.stubGlobal('document', {
            createElement: element,
            body,
            querySelectorAll: (selector) => find(selector),
            querySelector: (selector) => find(selector)[0] || null,
        });
        vi.stubGlobal('window', {
            innerWidth: WIDTH,
            innerHeight: HEIGHT,
            getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        });
        return { body, made, hud };
    }

    it('mounts a mock card, board and HUD, aims the wave at them and calms the post over them', () => {
        const page = stubPage();
        const calm = vi.spyOn(WavesPost.prototype, 'setCalmRects');
        const { effect, world } = mount('board=1');
        expect(page.body.appendChild).toHaveBeenCalledOnce();
        const [root] = page.body.appendChild.mock.calls[0];
        // The real class names, so the theme's own layout reader finds them.
        expect(world.hasBoard).toBe(true);
        expect(world.layout.cardCount).toBe(1);
        expect(world.layout.cards[0].x0).toBeCloseTo(500 / WIDTH, 9);
        expect(world.layout.cards[0].y1).toBeCloseTo(829 / HEIGHT, 9);
        expect(world.layout.boards[0].x0).toBeCloseTo(570 / WIDTH, 9);
        expect(world.layout.hud.x1).toBeCloseTo(1140 / WIDTH, 9);
        const [rects, strength] = calm.mock.calls[calm.mock.calls.length - 1];
        expect(rects).toEqual([world.layout.cards[0], world.layout.hud]);
        expect(strength).toBe(1);
        // A lock is aimed through the mock card.
        effect.seek(5);
        const cast = vi.spyOn(world, 'castScreen');
        world.onLock({ rows: [19], u: 0.5 });
        expect(cast).toHaveBeenCalledTimes(2);
        // The overlay goes with the effect.
        effect.dispose();
        expect(root.remove).toHaveBeenCalledOnce();
    });

    it('leaves the HUD out when told to, and mounts no overlay at all without board=1', () => {
        const page = stubPage();
        const calm = vi.spyOn(WavesPost.prototype, 'setCalmRects');
        const { world } = mount('board=1&statsHud=0');
        expect(world.hasBoard).toBe(true);
        expect(world.layout.hud).toBeNull();
        expect(calm.mock.calls[calm.mock.calls.length - 1]).toEqual([[world.layout.cards[0]], 1]);
        page.body.appendChild.mockClear();
        const bare = mount('board=0');
        expect(page.body.appendChild).not.toHaveBeenCalled();
        expect(bare.world.hasBoard).toBe(false);
        expect(calm.mock.calls[calm.mock.calls.length - 1]).toEqual([[], 0]);
    });
});
