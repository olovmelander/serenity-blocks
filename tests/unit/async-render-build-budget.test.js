/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    beginAsyncRenderPipelines,
    preloadAsyncRenderPipelines,
    resetAsyncRenderPipelinesForTests,
} from '../../src/rendering/async-render-pipelines.js';

/**
 * The build budget of an async render-pipeline session (src/rendering/async-render-pipelines.js).
 * The in-play theme switch builds the incoming theme hidden; its first render met every material at
 * once and built them all (TSL → WGSL) on the main thread: a 0.3-2.4 s freeze of the board in the
 * forest family. With a budget, an owned renderer builds new render objects until the frame's budget
 * is spent and defers the rest to later frames.
 *
 * The renderer double mirrors three r186: `_renderObjectDirect` looks the render object up in a chain
 * map keyed [object, material, renderContext, lightsNode] per passId and builds it when missing
 * (the build costs buildMs of the fake clock). The budget is spent per task: a frame is one task,
 * and the next frame runs after a macrotask (nextTask).
 */

let buildMs = 3;
let now = 0;
const nextTask = () => new Promise((resolve) => { setTimeout(resolve, 0); });

class FakeBackend {
    createRenderPipeline() {}
}

class FakeRenderer {
    constructor() {
        const maps = new Map();
        this.built = [];
        this.drawn = [];
        this._currentRenderContext = { id: 'ctx' };
        this._renderTarget = null;
        this._objects = {
            getChainMap(passId) {
                if (!maps.has(passId)) {
                    const entries = new Map();
                    maps.set(passId, {
                        get: (keys) => entries.get(keys[0])?.get(keys[1]),
                        set: (keys, value) => {
                            if (!entries.has(keys[0])) entries.set(keys[0], new Map());
                            entries.get(keys[0]).set(keys[1], value);
                        },
                    });
                }
                return maps.get(passId);
            },
        };
    }

    _renderObjectDirect(object, material, scene, camera, lightsNode, group, clippingContext, passId) {
        const map = this._objects.getChainMap(passId);
        if (map.get([object, material]) === undefined) {
            now += buildMs;
            map.set([object, material], { object });
            this.built.push(object.id);
        }
        // A post quad's pass node draws the scene inside the quad's own draw, every frame, through
        // the handler (Nodes.updateBefore → PassNode.updateBefore → _renderScene).
        if (object.pass) this.renderPass(object.pass);
        this.drawn.push(object.id);
    }

    renderPass(objects) {
        objects.forEach((object) => {
            this._renderObjectDirect(object, object.material, null, null, null, null, null, 'pass'); // eslint-disable-line no-underscore-dangle
        });
    }

    /** One frame: every object through the handler, as _renderScene does. */
    renderFrame(objects) {
        // eslint-disable-next-line no-underscore-dangle
        const handle = this._renderObjectDirect; // three re-reads it per render (Renderer.js:1737)
        objects.forEach((object) => {
            handle.call(this, object, object.material, null, null, null, null, null, 'default');
        });
        now += 16;
    }
}

const objects = (n) => Array.from({ length: n }, (_, id) => ({ id, material: { id } }));

beforeEach(async () => {
    now = 0;
    buildMs = 3;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await preloadAsyncRenderPipelines(() => ({ WebGPUBackend: FakeBackend, Renderer: FakeRenderer }));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await preloadAsyncRenderPipelines(() => null);
    resetAsyncRenderPipelinesForTests();
});

describe('the async session build budget', () => {
    it('builds new render objects until the frame budget is spent, and the rest on later frames', async () => {
        const renderer = new FakeRenderer();
        const theme = { name: 'summer', renderer };
        const session = beginAsyncRenderPipelines(theme, { buildBudgetMs: 8 });
        const scene = objects(10);

        renderer.renderFrame(scene);
        expect(renderer.built).toEqual([0, 1, 2]); // 0 + 3 + 3 < 8, then 9 >= 8
        expect(session.deferredBuilds).toBe(7);
        expect(renderer.drawn).toEqual([0, 1, 2]);

        for (let frame = 0; frame < 3; frame += 1) {
            await nextTask(); // eslint-disable-line no-await-in-loop
            renderer.renderFrame(scene);
        }
        expect(renderer.built).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        // Built objects draw every frame and are never deferred again.
        expect(session.deferredBuilds).toBe(7 + 4 + 1);
        renderer.drawn.length = 0;
        await nextTask();
        renderer.renderFrame(scene);
        expect(renderer.drawn).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(session.buildMs).toBe(30);
        session.end();
    });

    it('counts the open time of a build that draws a pass inside it (a post quad and its scene)', async () => {
        const renderer = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'verdant-hills', renderer }, { buildBudgetMs: 8 });
        const quad = { id: 'quad', material: { id: 'post' }, pass: objects(10) };

        renderer.renderFrame([quad]);
        // The quad (3) and two of the scene (6, 9): the third would start past the budget.
        expect(renderer.built).toEqual(['quad', 0, 1]);
        expect(session.buildMs).toBe(9);

        for (let frame = 0; frame < 4; frame += 1) {
            await nextTask(); // eslint-disable-line no-await-in-loop
            renderer.renderFrame([quad]);
        }
        expect(renderer.built).toEqual(['quad', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        // Each later frame charges the scene's builds one by one (three a frame), not the quad.
        expect(session.buildMs).toBe(33);
        session.end();
    });

    it('is not quiet while builds are deferred', async () => {
        const renderer = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'summer', renderer }, { buildBudgetMs: 8 });
        const scene = objects(12); // four frames of three builds each
        for (let frame = 0; frame < 3; frame += 1) {
            renderer.renderFrame(scene);
            session.noteFrame();
            expect(session.isQuiet(2)).toBe(false);
            await nextTask(); // eslint-disable-line no-await-in-loop
        }
        renderer.renderFrame(scene); // the last three: nothing deferred any more
        session.noteFrame();
        session.noteFrame();
        expect(session.isQuiet(2)).toBe(true);
        session.end();
    });

    it('spends the budget per task: a frame of long builds does not reopen it from its own length', async () => {
        buildMs = 20; // each build longer than the old 14 ms wall-clock window, which each one reopened
        const renderer = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'koi-pond', renderer }, { buildBudgetMs: 8 });
        const scene = objects(6);
        renderer.renderFrame(scene);
        // The task's first build always runs; every one after it waits for a later task.
        expect(renderer.built).toEqual([0]);
        expect(session.deferredBuilds).toBe(5);
        renderer.renderFrame(scene); // the same task still: nothing more
        expect(renderer.built).toEqual([0]);
        for (let frame = 1; frame < 6; frame += 1) {
            await nextTask(); // eslint-disable-line no-await-in-loop
            renderer.renderFrame(scene);
            expect(renderer.built).toHaveLength(frame + 1); // one build a task
        }
        expect(renderer.built).toEqual([0, 1, 2, 3, 4, 5]);
        session.end();
    });

    it('leaves a one-shot bake target, a renderer it does not own and a session without a budget alone', () => {
        const owned = new FakeRenderer();
        const other = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'summer', renderer: owned }, { buildBudgetMs: 8 });
        other.renderFrame(objects(10));
        expect(other.built).toHaveLength(10);

        owned._renderTarget = { texture: { isPMREMTexture: true } }; // eslint-disable-line no-underscore-dangle
        owned.renderFrame(objects(10));
        expect(owned.built).toHaveLength(10);
        // A theme's own one-shot bake (Spring's impostor atlas) opts in the same way.
        owned._renderTarget = { isOneShotBake: true, texture: { name: 'spring-impostor-albedo' } }; // eslint-disable-line no-underscore-dangle
        owned.renderFrame(objects(10));
        expect(owned.built).toHaveLength(20);
        session.end();

        const plain = new FakeRenderer();
        const unbudgeted = beginAsyncRenderPipelines({ name: 'ocean', renderer: plain });
        plain.renderFrame(objects(10));
        expect(plain.built).toHaveLength(10);
        unbudgeted.end();
    });

    it('the last budgeted session to end restores the renderer prototype exactly', () => {
        const original = FakeRenderer.prototype._renderObjectDirect; // eslint-disable-line no-underscore-dangle
        const a = beginAsyncRenderPipelines({ name: 'a', renderer: new FakeRenderer() }, { buildBudgetMs: 8 });
        const b = beginAsyncRenderPipelines({ name: 'b', renderer: new FakeRenderer() }, { buildBudgetMs: 8 });
        expect(FakeRenderer.prototype._renderObjectDirect).not.toBe(original); // eslint-disable-line no-underscore-dangle
        a.end();
        expect(FakeRenderer.prototype._renderObjectDirect).not.toBe(original); // eslint-disable-line no-underscore-dangle
        b.end();
        expect(FakeRenderer.prototype._renderObjectDirect).toBe(original); // eslint-disable-line no-underscore-dangle
    });
});

/**
 * 2026-10-19, Odyssey's live map: a VISIBLE renderer may carry a budget only if its canvas draw
 * (the final composite) is never deferred, and a render that exists to build (an offscreen warm)
 * must be able to opt out.
 */
describe('the build budget on a live surface', () => {
    it('exemptCanvasDraws never defers a draw into the canvas, and still budgets render targets', async () => {
        const renderer = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'odyssey-board', renderer }, {
            buildBudgetMs: 4, exemptCanvasDraws: true,
        });
        renderer._renderTarget = null; // eslint-disable-line no-underscore-dangle
        renderer.renderFrame(objects(4));
        expect(renderer.built).toEqual([0, 1, 2, 3]); // the canvas: everything, budget or not
        expect(session.deferredBuilds).toBe(0);

        await nextTask();
        renderer._renderTarget = { texture: {} }; // eslint-disable-line no-underscore-dangle
        const scenePass = objects(8).map((o) => ({ ...o, id: o.id + 10, material: { id: o.id + 10 } }));
        renderer.renderFrame(scenePass);
        expect(renderer.built).toEqual([0, 1, 2, 3, 10, 11]); // 0 + 3 < 4, then 6 >= 4
        expect(session.deferredBuilds).toBe(6);
    });

    it('withoutBudget builds everything inside it and restores the budget after', async () => {
        const renderer = new FakeRenderer();
        renderer._renderTarget = { texture: {} }; // eslint-disable-line no-underscore-dangle
        const session = beginAsyncRenderPipelines({ name: 'odyssey-board', renderer }, {
            buildBudgetMs: 4, exemptCanvasDraws: true,
        });
        const value = session.withoutBudget(() => { renderer.renderFrame(objects(6)); return 'warmed'; });
        expect(value).toBe('warmed');
        expect(renderer.built).toEqual([0, 1, 2, 3, 4, 5]);
        expect(session.deferredBuilds).toBe(0);
        expect(session.budgetSuspended).toBe(0);

        await nextTask();
        const more = objects(4).map((o) => ({ ...o, id: o.id + 20, material: { id: o.id + 20 } }));
        renderer.renderFrame(more);
        expect(session.deferredBuilds).toBeGreaterThan(0);
        expect(() => session.withoutBudget(() => { throw new Error('boom'); })).toThrow('boom');
        expect(session.budgetSuspended).toBe(0);
    });
});
