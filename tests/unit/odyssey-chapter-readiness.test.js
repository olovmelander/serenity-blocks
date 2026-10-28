// Chapters compile ahead of the player again, and a glide compiles what it flies to (perf audit
// 2026-10-28). Measured on the real methods: every moving frame in a preload window queued a
// compile for a chapter the One World draws (it has no environment), and the drain spent its one
// turn a tick on that empty entry, nearest first — over half the path chapters 6-8 never compiled
// ahead of the player. A trip to a chapter whose build was already under way gave up (navigator
// Play did nothing). The drain holds still while the camera flies, so a glide's destination
// compiled on the frames that first drew it. Chapter 7's hypercubes were made, and compiled, on
// the first fold frame, and their update allocated ~2,600 arrays a frame.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import {
    CH7_HYPERCUBE, HYPERCUBE_EDGES, createFoldHypercubes, hypercubeEdges,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-fold-hypercubes.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (file) => readFileSync(path.resolve(here, '../../src', file), 'utf8');

beforeEach(() => {
    vi.stubGlobal('window', {
        settings: {}, location: { search: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function boardWith({ environments = {}, suppressed = [2, 3, 4, 5] } = {}) {
    const board = new OdysseyBoardController({});
    board.environmentManager = {
        environments: new Map(Object.entries(environments).map(([id, env]) => [Number(id), env])),
        suppressedChapters: new Set(suppressed),
        createChapterEnvironment: vi.fn(),
        updateVisibility: vi.fn(),
    };
    return board;
}

describe('the compile queue', () => {
    it('builds nothing, and queues nothing, for a chapter the One World draws', async () => {
        const board = boardWith();
        board._queueChapterPrewarm = vi.fn();
        await expect(board._requestChapterEnvironment(3)).resolves.toBe(true);
        expect(board.environmentManager.createChapterEnvironment).not.toHaveBeenCalled();
        expect(board.environmentManager.updateVisibility).not.toHaveBeenCalled();
        expect(board._queueChapterPrewarm).not.toHaveBeenCalled();
    });

    it('takes no entry without an environment, and never spends a tick on one', async () => {
        const six = { group: {}, prewarmed: false };
        const board = boardWith({ environments: { 6: six } });
        board._schedulePrewarmDrain = vi.fn();
        board._queueChapterPrewarm(3); // drawn by the world: no environment
        board._queueChapterPrewarm(6);
        expect(board.prewarmQueue).toEqual([6]);

        // An entry whose environment went since it was queued is passed over in the same tick.
        board.prewarmQueue.unshift(4);
        board.queuedPrewarmChapters.add(4);
        board.isActive = true;
        board._canRunBackgroundTask = () => true;
        board._liveFocusChapter = () => 4;
        board.liveCompileEnabled = true;
        board._compileChapter = vi.fn(async () => { six.prewarmed = true; return true; });
        board._renderWarmChapterOffscreen = vi.fn(() => true);
        await board._drainPrewarmQueue();
        expect(board._compileChapter).toHaveBeenCalledWith(6);
        expect(six._renderWarmed).toBe(true);
        expect(board.prewarmQueue).toEqual([]);
        expect(board.queuedPrewarmChapters.size).toBe(0);
    });

    it('waits for a build already on its way instead of refusing it, and builds it once', async () => {
        const board = boardWith();
        let finish;
        board.environmentManager.createChapterEnvironment = vi.fn(() => new Promise((resolve) => {
            finish = () => {
                board.environmentManager.environments.set(6, { group: {} });
                resolve({});
            };
        }));
        board._queueChapterPrewarm = vi.fn();
        const first = board._requestChapterEnvironment(6);
        const second = board._requestChapterEnvironment(6); // the boundary preload, the next frame
        expect(second).toBe(first);
        finish();
        await expect(second).resolves.toBe(true);
        expect(board.environmentManager.createChapterEnvironment).toHaveBeenCalledTimes(1);
        expect(board.pendingChapterLoads.size).toBe(0);
        // Settled: the next request finds the environment.
        await expect(board._requestChapterEnvironment(6)).resolves.toBe(true);
        expect(board.environmentManager.createChapterEnvironment).toHaveBeenCalledTimes(1);
    });
});

describe('a glide compiles what it flies to', () => {
    it('shares one compile per chapter between the drain and a glide', async () => {
        const env = { group: {}, prewarmed: false };
        const board = boardWith({ environments: { 6: env } });
        let finish;
        board._prewarmChapterEnvironment = vi.fn(() => new Promise((resolve) => {
            finish = () => { env.prewarmed = true; resolve(); };
        }));
        const a = board._compileChapter(6);
        const b = board._compileChapter(6);
        expect(b).toBe(a);
        finish();
        await expect(a).resolves.toBe(true);
        expect(board._prewarmChapterEnvironment).toHaveBeenCalledTimes(1);
        await expect(board._compileChapter(6)).resolves.toBe(true); // compiled: nothing more
        expect(board._prewarmChapterEnvironment).toHaveBeenCalledTimes(1);
    });

    it('gives the destination a short head start, starts the chapters between, and builds none', async () => {
        vi.useFakeTimers();
        const envs = {
            1: { group: {}, prewarmed: true }, 6: { group: {}, prewarmed: false }, 8: { group: {}, prewarmed: false },
        };
        const board = boardWith({ environments: envs });
        board.liveCompileEnabled = true;
        const started = [];
        board._compileChapter = vi.fn((ch) => { started.push(ch); return new Promise(() => {}); });
        let set = false;
        board._compileGlideChapters(1, 8).then(() => { set = true; });
        await Promise.resolve();
        expect(started).toEqual([8]); // the destination first; 6 waits behind it, 2-5 are the world's
        await vi.advanceTimersByTimeAsync(249);
        expect(set).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(set).toBe(true); // never longer than the head start
        expect(board.environmentManager.createChapterEnvironment).not.toHaveBeenCalled();
    });

    it('sets out at once to a compiled destination, or with the head start turned off', async () => {
        const envs = { 6: { group: {}, prewarmed: true }, 7: { group: {}, prewarmed: false } };
        const board = boardWith({ environments: envs });
        board.liveCompileEnabled = true;
        board._compileChapter = vi.fn(() => new Promise(() => {}));
        await board._compileGlideChapters(7, 6); // resolves without waiting on chapter 7's compile
        window.location.search = '?odysseyGlideCompileMs=0';
        await board._compileGlideChapters(6, 7);
        expect(board._compileChapter).toHaveBeenCalledWith(7); // still started, just not waited on
    });

    it('travelToLevel compiles before it sets out', () => {
        const src = read('rendering/odyssey/OdysseyBoardController.js');
        const travel = src.slice(src.indexOf('    async travelToLevel('), src.indexOf('    cancelTravel() {'));
        const compile = travel.indexOf('await this._compileGlideChapters(currentChapter, targetChapter);');
        const glide = travel.indexOf('await this.cameraController.travelToPosition(');
        expect(compile).toBeGreaterThan(-1);
        expect(glide).toBeGreaterThan(compile);
    });
});

// The original hypercube code, verbatim (2026-10-26), as the reference the new path must match bit
// for bit.
const CORNERS = Array.from({ length: 16 }, (_, i) => [
    (i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1, (i & 8) ? 1 : -1,
]);
const rotate = (v, i, j, a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = v[i];
    const y = v[j];
    v[i] = (x * c) - (y * s);
    v[j] = (x * s) + (y * c);
};
function referenceEdges(t, size = 1, phase = 0) {
    const [a, b, c, d] = CH7_HYPERCUBE.turn;
    const { eyeW } = CH7_HYPERCUBE;
    const projected = CORNERS.map((corner) => {
        const v = corner.slice();
        rotate(v, 0, 3, (t * a) + phase);
        rotate(v, 1, 3, (t * b) + (phase * 0.7));
        rotate(v, 2, 3, (t * c) + (phase * 0.4));
        rotate(v, 0, 1, (t * d) + (phase * 1.3));
        const k = (size / (eyeW - v[3])) * (eyeW - 1);
        return [v[0] * k, v[1] * k, v[2] * k];
    });
    return HYPERCUBE_EDGES.map(([i, j]) => [...projected[i], ...projected[j]]);
}
function referenceUpdate(position, colour, count, camera, time, cubes) {
    const E = HYPERCUBE_EDGES.length;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const toEye = new THREE.Vector3();
    const side = new THREE.Vector3();
    const white = new THREE.Color(1, 1, 1);
    colour.fill(0);
    const n = Math.min(count, cubes?.length ?? 0);
    for (let k = 0; k < n; k += 1) {
        const cube = cubes[k];
        if (!cube || !(cube.presence > 0.001)) continue;
        const edges = referenceEdges(time, cube.size, cube.phase ?? (k * 1.7));
        const tintColour = cube.colour ?? white;
        const half = cube.size * CH7_HYPERCUBE.width;
        edges.forEach((e, j) => {
            a.set(e[0], e[1], e[2]).add(cube.position);
            b.set(e[3], e[4], e[5]).add(cube.position);
            dir.subVectors(b, a);
            toEye.subVectors(camera.position, a);
            side.crossVectors(dir, toEye);
            const len = side.length();
            if (len < 1e-9) side.set(0, 0, 0);
            else side.multiplyScalar(half / len);
            const v = ((k * E) + j) * 4;
            position.set([a.x - side.x, a.y - side.y, a.z - side.z], v * 3);
            position.set([a.x + side.x, a.y + side.y, a.z + side.z], (v + 1) * 3);
            position.set([b.x - side.x, b.y - side.y, b.z - side.z], (v + 2) * 3);
            position.set([b.x + side.x, b.y + side.y, b.z + side.z], (v + 3) * 3);
            for (let m = 0; m < 4; m += 1) {
                colour.set([tintColour.r, tintColour.g, tintColour.b, cube.presence], (v + m) * 4);
            }
        });
    }
    return n > 0;
}

describe('chapter 7\'s hypercubes', () => {
    it('project their edges exactly as before', () => {
        for (const [t, size, phase] of [[0, 1, 0], [3.7, 2.5, 1.7], [128.25, 0.8, 5.1], [9001.5, 14, 3.4]]) {
            expect(hypercubeEdges(t, size, phase)).toEqual(referenceEdges(t, size, phase));
        }
    });

    it('write the same vertices and colours, with nothing allocated per edge', () => {
        const cubes = createFoldHypercubes({ count: 8 });
        const { geometry } = cubes.mesh;
        const position = geometry.getAttribute('position').array;
        const colour = geometry.getAttribute('aColour').array;
        const refPosition = new Float32Array(position.length);
        const refColour = new Float32Array(colour.length);
        const camera = { position: new THREE.Vector3(12, -40, 300) };
        const set = Array.from({ length: 6 }, (_, k) => ({
            position: new THREE.Vector3(k * 30 - 70, 5 + k, -k * 12),
            size: 3 + k,
            presence: k === 2 ? 0 : 0.2 + (k * 0.13),
            phase: k === 4 ? undefined : k * 0.9,
            colour: k % 2 ? new THREE.Color(0.9, 0.4, 0.2) : undefined,
        }));
        for (const time of [0, 1.25, 77.5]) {
            refPosition.set(position); // the cubes' skipped slots keep what they had, in both
            cubes.update(camera, time, set);
            const shown = referenceUpdate(refPosition, refColour, 8, camera, time, set);
            expect(Array.from(position)).toEqual(Array.from(refPosition));
            expect(Array.from(colour)).toEqual(Array.from(refColour));
            expect(cubes.mesh.visible).toBe(shown);
        }
        cubes.dispose();
    });

    it('with none to show, hide and leave the buffers alone', () => {
        const cubes = createFoldHypercubes({ count: 8 });
        const pos = cubes.mesh.geometry.getAttribute('position');
        const versionBefore = pos.version;
        cubes.update({ position: new THREE.Vector3() }, 1, []);
        expect(cubes.mesh.visible).toBe(false);
        expect(pos.version).toBe(versionBefore);
        cubes.dispose();
    });

    it('are made hidden at startup and wait, clock and all, for the first fold frame', () => {
        const src = read('rendering/odyssey/OdysseyBoardController.js');
        const quench = src.indexOf('this.steamQuench = createSteamQuench();');
        const made = src.indexOf('this._foldHypercubes = createFoldHypercubes({ count: 8 });', quench);
        const presentation = src.indexOf("'board presentation'", quench);
        // In setupDirector beside the steam quench, before the board-presentation compile.
        expect(quench).toBeGreaterThan(-1);
        expect(made).toBeGreaterThan(quench);
        expect(made - quench).toBeLessThan(1500);
        if (presentation > -1) expect(made).toBeLessThan(presentation);
        expect(src.slice(made, made + 200)).toContain('this._foldHypercubes.mesh.visible = false;');

        const board = new OdysseyBoardController({});
        board.presentationLayout = { chapterPositions: [0, 0.06, 0.14, 0.24, 0.35, 0.75, 0.87, 0.96, 1] };
        board._foldHypercubes = { mesh: { visible: false }, update: vi.fn() };
        board._updateFoldHypercubes(0.5, 0.016); // far from the fold
        expect(board._foldHypercubes.update).not.toHaveBeenCalled();
        expect(board._foldHypercubesLive).toBeFalsy();
    });
});
