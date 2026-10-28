// Chapter builds on the live map are cut into slices (perf audit 2026-10-28). Chapter 1's build is
// 100-250 ms of main thread and chapter 6's 25-140 ms (Node on a cloud CPU, relative); every one
// that landed after the reveal (the background loader, a boundary preload while scrolling, a far
// orb picked in the navigator) froze the map for that long. Built in steps they are the same scene, value for value; the manager
// slices the builds the board makes once the map is live, finishes one at once when the camera is
// about to show it, and drops what is unfinished on teardown; a travel builds what its glide
// passes before it leaves.

import * as THREE from 'three/webgpu';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const OPTS = { particleCount: 500, qualityTier: 'High' };

function stubBrowser() {
    vi.stubGlobal('window', {
        settings: {},
        location: { search: '' },
        localStorage: { getItem: () => null, setItem: () => {} },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    const gradient = { addColorStop: () => {} };
    const context = new Proxy({}, {
        get: (target, key) => {
            if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
            if (key === 'getImageData' || key === 'createImageData') {
                return (a, b, w, h) => ({ data: new Uint8ClampedArray((w || a || 1) * (h || b || 1) * 4) });
            }
            if (key === 'measureText') return () => ({ width: 10 });
            if (!(key in target)) target[key] = () => {};
            return target[key];
        },
        set: (target, key, value) => { target[key] = value; return true; },
    });
    vi.stubGlobal('document', {
        visibilityState: 'visible',
        createElement: () => ({
            width: 0, height: 0, style: {}, getContext: () => context,
        }),
    });
}

beforeEach(() => {
    stubBrowser();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A seeded stream for Math.random (the chapters' scatter draws from it). */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** What a group draws: every object's kind, name, transform and state, every buffer, every material's flags. */
function fingerprint(root) {
    let h = 2166136261 >>> 0;
    const mix = (bytes) => {
        for (let i = 0; i < bytes.length; i += 1) {
            h ^= bytes[i];
            h = Math.imul(h, 16777619) >>> 0;
        }
    };
    const text = (s) => mix(new TextEncoder().encode(String(s)));
    const view = (a) => mix(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    root.updateMatrixWorld(true);
    root.traverse((o) => {
        text(`${o.type}|${o.name}|${o.visible}|${o.renderOrder}|${o.frustumCulled}`);
        view(new Float64Array(o.matrix.elements));
        if (o.instanceMatrix) view(o.instanceMatrix.array);
        const g = o.geometry;
        if (g) {
            Object.keys(g.attributes).sort().forEach((k) => { text(k); view(g.attributes[k].array); });
            if (g.index) view(g.index.array);
            text(`ic:${g.instanceCount}`);
        }
        (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean).forEach((m) => {
            text(`${m.type}|${m.transparent}|${m.depthWrite}|${m.depthTest}|${m.blending}|${m.side}|${m.fog}`);
        });
        if (o.isLight) view(new Float64Array([o.intensity, o.color.r, o.color.g, o.color.b]));
    });
    return h.toString(16);
}

describe('a chapter built in slices is the chapter built in one go', () => {
    it.each([
        [1, 'earth-core', 'createEarthCoreEnvironment', 'buildEarthCoreEnvironmentSteps', 10],
        [6, 'cosmic-expanse', 'createCosmicExpanseEnvironment', 'buildCosmicExpanseEnvironmentSteps', 10],
        [7, 'black-hole-transcendence', 'createBlackHoleTranscendenceEnvironment',
            'buildBlackHoleTranscendenceEnvironmentSteps', 5],
        [8, 'urban-dreams', 'createUrbanDreamsEnvironment', 'buildUrbanDreamsEnvironmentSteps', 10],
    ])('chapter %i (%s), paused between every step', async (_id, file, create, steps, minTurns) => {
        const mod = await import(`../../src/rendering/odyssey/chapter-environments/${file}.js`);
        const { ChapterBuildLane } = await import('../../src/rendering/odyssey/chapter-build-lane.js');
        mod[create](OPTS); // the first build of a session makes the shared textures; both below reuse them
        const realRandom = Math.random;
        try {
            Math.random = mulberry32(0x57a21197);
            const whole = fingerprint(mod[create](OPTS));
            Math.random = mulberry32(0x57a21197);
            let turns = 0;
            const lane = new ChapterBuildLane({
                budgetMs: () => 0, // one step a turn
                schedule: (run) => { turns += 1; setTimeout(run, 0); },
            });
            const sliced = await lane.run('chapter', mod[steps](OPTS));
            expect(turns).toBeGreaterThan(minTurns);
            expect(fingerprint(sliced)).toBe(whole);
        } finally {
            Math.random = realRandom;
        }
    }, 60_000);
});

describe('the manager builds in slices on request', () => {
    async function managerWith(gate = {}) {
        const { ChapterEnvironmentManager } = await import('../../src/rendering/odyssey/ChapterEnvironmentManager.js');
        const manager = new ChapterEnvironmentManager(new THREE.Scene(), null);
        manager.configureChapterBuilds({ budgetMs: () => 1, ...gate });
        return manager;
    }

    it('slices a build, and registers it in the turn that runs its last step', async () => {
        const manager = await managerWith();
        const built = manager.createChapterEnvironment(1, { sliced: true });
        await vi.waitFor(() => expect(manager.isChapterBuilding(1)).toBe(true));
        expect(manager.environments.has(1)).toBe(false); // nothing half-built is handed over
        const group = await built;
        expect(group?.userData?.chapterId).toBe(1);
        expect(manager.environments.get(1)?.group).toBe(group);
        expect(group.visible).toBe(false);
        expect(manager.isChapterBuilding(1)).toBe(false);
        manager.dispose();
    }, 60_000);

    it('builds in one go when not asked to slice', async () => {
        const manager = await managerWith();
        const built = manager.createChapterEnvironment(6);
        await Promise.resolve();
        expect(manager.isChapterBuilding(6)).toBe(false);
        expect((await built)?.userData?.chapterId).toBe(6);
        manager.dispose();
    }, 60_000);

    it('finishes a build at once when the camera brings its chapter on screen', async () => {
        const manager = await managerWith({ canRun: () => false }); // the lane never gets a turn
        const { getActiveOdysseyChapterPositions } = await import('../../src/rendering/odyssey/path-utils.js');
        const cp = getActiveOdysseyChapterPositions();
        const built = manager.createChapterEnvironment(1, { sliced: true });
        await vi.waitFor(() => expect(manager.isChapterBuilding(1)).toBe(true));

        // In chapter 4 nothing of chapter 1 is shown: it keeps waiting its turn.
        manager.updateVisibility((cp[3] + cp[4]) / 2, { mode: 'progress' });
        expect(manager.environments.has(1)).toBe(false);

        // Back in chapter 1: built, registered and given its opacity in the same pass.
        manager.updateVisibility(cp[0] + ((cp[1] - cp[0]) * 0.3), { mode: 'progress' });
        expect(manager.isChapterBuilding(1)).toBe(false);
        expect(manager.environments.get(1)?.group.visible).toBe(true);
        await expect(built).resolves.toBe(manager.environments.get(1).group);
        manager.dispose();
    }, 60_000);

    it('a build the player waits on goes first, even if it was asked for while loading its module', async () => {
        const manager = await managerWith({ canRun: () => false });
        manager.createChapterEnvironment(1, { sliced: true });
        manager.createChapterEnvironment(6, { sliced: true });
        manager.createChapterEnvironment(6, { urgent: true }); // promoted before its module loaded
        await vi.waitFor(() => expect(manager.isChapterBuilding(6)).toBe(true));
        await vi.waitFor(() => expect(manager.isChapterBuilding(1)).toBe(true));
        expect(manager._chapterBuildLane._head().key).toBe(6);
        manager.dispose();
    }, 60_000);

    it('drops an unfinished build on teardown and gives its pool lights back', async () => {
        const manager = await managerWith({ canRun: () => false });
        const { acquireChapterLight, getChapterLightPool } = await import(
            '../../src/rendering/odyssey/chapter-environments/shared/chapter-light-pool.js'
        );
        const built = manager.createChapterEnvironment(6, { sliced: true });
        await vi.waitFor(() => expect(manager.isChapterBuilding(6)).toBe(true));
        acquireChapterLight(6, 'AmbientLight'); // as a build part-way through its lighting would hold
        expect(getChapterLightPool().virtual.has(6)).toBe(true);
        manager.dispose();
        await expect(built).resolves.toBeNull();
        expect(manager.environments.has(6)).toBe(false);
        expect(getChapterLightPool().virtual.has(6)).toBe(false);
    }, 60_000);
});

describe('the board slices what it builds on the live map', () => {
    async function board() {
        const { OdysseyBoardController } = await import('../../src/rendering/odyssey/OdysseyBoardController.js');
        const b = new OdysseyBoardController({});
        b.environmentManager = {
            environments: new Map(),
            suppressedChapters: new Set([2, 3, 4, 5]),
            createChapterEnvironment: vi.fn(async () => ({})),
            promoteChapterBuild: vi.fn(),
            updateVisibility: vi.fn(),
        };
        b._queueChapterPrewarm = vi.fn();
        return b;
    }

    it('builds in one go under the loading cover, in slices once the map is live', async () => {
        const b = await board();
        const { createChapterEnvironment } = b.environmentManager;
        b.isActive = false;
        await b._requestChapterEnvironment(1);
        expect(createChapterEnvironment).toHaveBeenLastCalledWith(1, { sliced: false, urgent: false });
        b.isActive = true;
        await b._requestChapterEnvironment(6, { urgent: true });
        expect(createChapterEnvironment).toHaveBeenLastCalledWith(6, { sliced: true, urgent: true });
    });

    it('builds in one go on the live map too under ?odysseyOneGoBuilds=1 (the A/B for the pacing)', async () => {
        vi.stubGlobal('window', { location: { search: '?odysseyOneGoBuilds=1' } });
        try {
            const b = await board();
            const { createChapterEnvironment } = b.environmentManager;
            b.isActive = true;
            await b._requestChapterEnvironment(6, { urgent: true });
            expect(createChapterEnvironment).toHaveBeenLastCalledWith(6, { sliced: false, urgent: true });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('promotes a build already on its way when the player starts waiting on it', async () => {
        const b = await board();
        b.isActive = true;
        let release;
        b.environmentManager.createChapterEnvironment = vi.fn(() => new Promise((r) => { release = r; }));
        const background = b._requestChapterEnvironment(6);
        const waited = b._requestChapterEnvironment(6, { urgent: true });
        expect(waited).toBe(background);
        expect(b.environmentManager.promoteChapterBuild).toHaveBeenCalledWith(6);
        expect(b.environmentManager.createChapterEnvironment).toHaveBeenCalledOnce();
        release({});
        await expect(waited).resolves.toBe(true);
    });

    it('builds what a glide passes before it leaves: the destination first, all urgent', async () => {
        const b = await board();
        b._requestChapterEnvironment = vi.fn(async () => true);
        await expect(b._requestGlideChapters(1, 7)).resolves.toBe(true);
        expect(b._requestChapterEnvironment.mock.calls).toEqual([
            [7, { urgent: true }], [2, { urgent: true }], [3, { urgent: true }],
            [4, { urgent: true }], [5, { urgent: true }], [6, { urgent: true }],
        ]);
        b._requestChapterEnvironment.mockClear();
        await b._requestGlideChapters(8, 6);
        expect(b._requestChapterEnvironment.mock.calls).toEqual([[6, { urgent: true }], [7, { urgent: true }]]);
        b._requestChapterEnvironment.mockClear();
        await b._requestGlideChapters(6, 6);
        expect(b._requestChapterEnvironment.mock.calls).toEqual([[6, { urgent: true }]]);
    });

    it('a parked board builds nothing; a glide holds background builds, never a travel\'s', async () => {
        const b = await board();
        const gate = b._chapterBuildGate();
        b.isActive = true;
        b.isRenderingPaused = false;
        b.cameraController = { isAnimating: false };
        expect(gate.canRun({ urgent: false })).toBe(true);
        b.cameraController.isAnimating = true;
        expect(gate.canRun({ urgent: false })).toBe(false);
        expect(gate.canRun({ urgent: true })).toBe(true);
        b.isRenderingPaused = true; // an orb is being played
        expect(gate.canRun({ urgent: true })).toBe(false);
    });

    it('shares the frame by what the player is doing', async () => {
        const b = await board();
        const gate = b._chapterBuildGate();
        b.targetFrameRate = 60;
        b._isCovered = () => false;
        b._isInteractionIdle = () => true;
        b._isScrollIdle = () => true;
        const idle = gate.budgetMs({ urgent: false });
        expect(idle).toBeCloseTo(1000 / 60 / 3, 5);
        b._isScrollIdle = () => false;
        expect(gate.budgetMs({ urgent: false })).toBeLessThan(idle);
        const waitedOn = gate.budgetMs({ urgent: true });
        expect(waitedOn).toBeGreaterThan(idle);
        b._isCovered = () => true; // a sheet covers the map: nothing of it is drawn
        expect(gate.budgetMs({ urgent: false })).toBeGreaterThan(waitedOn);
        b.targetFrameRate = 144;
        b._isCovered = () => false;
        b._isScrollIdle = () => true;
        expect(gate.budgetMs({ urgent: false })).toBeCloseTo(1000 / 144 / 3, 5);
    });
});
