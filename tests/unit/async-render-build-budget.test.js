/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import ChainMap from 'three/src/renderers/common/ChainMap.js';
import {
    beginAsyncRenderPipelines,
    exemptBuildCount,
    preloadAsyncRenderPipelines,
    resetAsyncRenderPipelinesForTests,
    SLICED_FIRST_DRAWS_PER_TASK,
    withBuildBudgetExemptFor,
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

describe('a warm frame lets its parked drawables past the budget', () => {
    it('builds the listed objects whatever the budget says, counts them, and budgets the rest', async () => {
        const renderer = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'tornado', renderer }, { buildBudgetMs: 4 });
        const scene = objects(6);
        const parked = new Set([scene[4], scene[5]]);
        expect(exemptBuildCount(renderer)).toBe(0);
        withBuildBudgetExemptFor(renderer, parked, () => renderer.renderFrame(scene));
        // The 4 ms budget takes two 3 ms builds (it is checked before each is charged), then defers
        // the rest, but never the parked two.
        expect(renderer.built).toEqual([0, 1, 4, 5]);
        expect(exemptBuildCount(renderer)).toBe(2);
        expect(session.deferredBuilds).toBeGreaterThan(0);
        expect(session.exemptObjects).toBeNull();

        // Drawn again: nothing new to build, nothing more counted.
        await nextTask();
        withBuildBudgetExemptFor(renderer, parked, () => renderer.renderFrame([scene[4], scene[5]]));
        expect(exemptBuildCount(renderer)).toBe(2);
    });

    it('without a session it only runs the frame, and has no count', () => {
        const renderer = new FakeRenderer();
        expect(withBuildBudgetExemptFor(renderer, new Set(), () => 'ran')).toBe('ran');
        expect(exemptBuildCount(renderer)).toBeNull();
    });
});

describe('an override pass (a shadow map) keys its render objects by the source material too', () => {
    // three r187 RenderObjects.get: while Renderer.renderObject draws with scene.overrideMaterial it
    // sets _currentSourceMaterial and files the render object under five keys, [object, material,
    // renderContext, lightsNode, sourceMaterial]. ChainMap keeps each key length in a map of its own,
    // so the budget's lookup must use the same five or a built shadow draw reads as new every frame.
    class OverrideRenderer {
        constructor() {
            this.built = [];
            this.drawn = [];
            this._currentRenderContext = { id: 'shadow-ctx' };
            this._currentSourceMaterial = null;
            this._renderTarget = { texture: { name: 'shadow' } };
            this.lightsNode = { id: 'lights' };
            const map = new ChainMap();
            this._objects = { getChainMap: () => map };
        }

        _renderObjectDirect(object, material, scene, camera, lightsNode) {
            const keys = [object, material, this._currentRenderContext, lightsNode];
            if (this._currentSourceMaterial !== null) keys.push(this._currentSourceMaterial);
            const map = this._objects.getChainMap('default');
            if (map.get(keys) === undefined) {
                now += buildMs;
                map.set(keys, { object });
                this.built.push(object.id);
            }
            this.drawn.push(object.id);
        }

        /** One shadow frame: every caster drawn with the one depth material, as the shadow pass does. */
        shadowFrame(casters, depthMaterial) {
            const handle = this._renderObjectDirect; // eslint-disable-line no-underscore-dangle
            casters.forEach((caster) => {
                this._currentSourceMaterial = caster.material;
                handle.call(this, caster, depthMaterial, null, null, this.lightsNode, null, null, 'default');
                this._currentSourceMaterial = null;
            });
            now += 16;
        }
    }

    it('builds each caster once, then draws it every frame without charging or deferring it', async () => {
        const renderer = new OverrideRenderer();
        const session = beginAsyncRenderPipelines({ name: 'summer', renderer }, {
            buildBudgetMs: 8, rendererProto: OverrideRenderer.prototype,
        });
        const casters = objects(6);
        const depth = { id: 'depth' };
        for (let frame = 0; frame < 3; frame += 1) {
            renderer.shadowFrame(casters, depth);
            await nextTask(); // eslint-disable-line no-await-in-loop
        }
        expect(renderer.built).toEqual([0, 1, 2, 3, 4, 5]);
        // A frame whose new scene objects spend the budget first: the built casters after them are
        // cache hits, drawn, never deferred (a deferred one is a caster missing from the shadow).
        const { deferredBuilds } = session;
        renderer.drawn.length = 0;
        const fresh = ['a', 'b', 'c', 'd'].map((id) => ({ id, material: { id } }));
        fresh.forEach((object) => renderer._renderObjectDirect(object, object.material, null, null, renderer.lightsNode)); // eslint-disable-line no-underscore-dangle
        expect(renderer.built).toEqual([0, 1, 2, 3, 4, 5, 'a', 'b', 'c']);
        renderer.shadowFrame(casters, depth);
        expect(renderer.drawn).toEqual(['a', 'b', 'c', 0, 1, 2, 3, 4, 5]);
        expect(session.deferredBuilds).toBe(deferredBuilds + 1); // 'd' only
        session.end();
    });
});

describe('sliced builds (three r187): a hidden build never builds a material inside a frame', () => {
    // A renderer double shaped like r187 where it matters: _beginPreCompile exists, render objects
    // come from a ChainMap through _objects.get, and _nodes.getForRender(renderObject, yieldFn)
    // builds asynchronously, calling yieldFn after each stage and reading the renderer's target / MRT
    // / context node while it works (as NodeBuilder does).
    class SlicingRenderer {
        constructor(stages = 3, stageMs = 1) {
            this.stages = stages;
            this.stageMs = stageMs;
            this.drawn = [];
            this.syncBuilds = [];
            this.sliceLog = [];
            this._renderTarget = null;
            this._activeCubeFace = 0;
            this._activeMipmapLevel = 0;
            this._mrt = null;
            this.contextNode = { id: 'default' };
            this._currentRenderContext = { id: 'canvas-ctx' };
            this._currentSourceMaterial = null;
            this.toneMapping = 'ACES';
            this.outputColorSpace = 'srgb';
            this.passCtx = { id: 'pass-ctx' };
            this.lights = { id: 'lights' };
            const map = new ChainMap();
            const built = new WeakSet();
            this.built = built;
            const renderer = this;
            this._objects = {
                getChainMap: () => map,
                get(object, material, scene, camera, lightsNode, renderContext) {
                    const keys = [object, material, renderContext, lightsNode];
                    let ro = map.get(keys);
                    if (!ro) {
                        ro = { object, material, context: renderContext };
                        map.set(keys, ro);
                    }
                    return ro;
                },
            };
            this._nodes = {
                getForRender(ro, yieldFn) {
                    if (built.has(ro)) return { built: true };
                    const see = () => ({
                        target: renderer._renderTarget, mrt: renderer._mrt, ctx: renderer.contextNode.id, tone: renderer.toneMapping,
                    });
                    return (async () => {
                        for (let i = 0; i < renderer.stages; i += 1) {
                            renderer.sliceLog.push({ id: ro.object.id, stage: i, ...see() });
                            now += renderer.stageMs; // a stage's cost on the fake clock
                            await yieldFn(); // eslint-disable-line no-await-in-loop
                        }
                        built.add(ro);
                        return { built: true };
                    })();
                },
            };
        }

        _beginPreCompile() {}

        setRenderTarget(t, face = 0, level = 0) {
            this._renderTarget = t;
            this._activeCubeFace = face;
            this._activeMipmapLevel = level;
        }

        setMRT(m) { this._mrt = m; }

        _renderObjectDirect(object, material, scene, camera, lightsNode, group, clippingContext, passId) {
            const ro = this._objects.get(object, material, scene, camera, lightsNode, this._currentRenderContext, clippingContext, passId);
            if (!this.built.has(ro)) {
                this.syncBuilds.push(object.id);
                this.built.add(ro);
            }
            this.drawn.push(object.id);
        }

        /** A frame drawing `list` inside a post pass (its own target, MRT and context node). */
        passFrame(list) {
            this.drawn.length = 0;
            const previous = {
                t: this._renderTarget, m: this._mrt, c: this.contextNode, ctx: this._currentRenderContext,
            };
            this.setRenderTarget('PASS_RT');
            this.setMRT('PASS_MRT');
            this.contextNode = { id: 'pass' };
            this._currentRenderContext = this.passCtx;
            const handle = this._renderObjectDirect; // eslint-disable-line no-underscore-dangle
            list.forEach((o) => handle.call(this, o, o.material, null, null, this.lights, null, null, 'default'));
            this.setRenderTarget(previous.t);
            this.setMRT(previous.m);
            this.contextNode = previous.c;
            this._currentRenderContext = previous.ctx;
            now += 16;
        }
    }

    const until = async (fn, tries = 400) => {
        for (let i = 0; i < tries && !fn(); i += 1) await nextTask(); // eslint-disable-line no-await-in-loop
    };

    it('queues new materials, builds them between frames with the pass state, then draws them', async () => {
        const renderer = new SlicingRenderer(3);
        const session = beginAsyncRenderPipelines({ name: 'neon-district', renderer }, {
            buildBudgetMs: 8, rendererProto: SlicingRenderer.prototype, sliceBuilds: true,
        });
        const n = SLICED_FIRST_DRAWS_PER_TASK + 1;
        const scene = objects(n);
        renderer.passFrame(scene);
        expect(renderer.drawn).toEqual([]); // nothing new drawn in the frame that met it
        expect(renderer.syncBuilds).toEqual([]);
        expect(renderer.sliceLog).toEqual([]); // and nothing built in it
        expect(session.slicedBuilds).toBe(n);
        expect(session.isQuiet(1)).toBe(false);
        await until(() => session.slicedBuilt === n);
        expect(session.slicedBuilt).toBe(n);
        // Every slice saw the state the object was met under, never the live one.
        renderer.sliceLog.forEach((slice) => {
            expect(slice).toMatchObject({
                target: 'PASS_RT', mrt: 'PASS_MRT', ctx: 'pass', tone: 'ACES',
            });
        });
        expect(renderer.sliceLog).toHaveLength(3 * n);
        // Between slices and after them, the live state is back.
        expect(renderer._renderTarget).toBeNull();
        expect(renderer._mrt).toBeNull();
        expect(renderer.contextNode.id).toBe('default');
        // Built: the next frames draw them without building, a few first draws a frame (their
        // texture uploads spread out).
        renderer.passFrame(scene);
        expect(renderer.drawn).toEqual(scene.slice(0, SLICED_FIRST_DRAWS_PER_TASK).map((o) => o.id));
        await nextTask();
        renderer.passFrame(scene);
        expect(renderer.drawn).toEqual(scene.map((o) => o.id));
        expect(renderer.syncBuilds).toEqual([]);
        session.end();
    });

    it('a frame meeting an object whose build is still running skips it and sees the live state', async () => {
        const renderer = new SlicingRenderer(6, 5); // 30 ms of stages: more than one task's share
        const session = beginAsyncRenderPipelines({ name: 'murmuration', renderer }, {
            buildBudgetMs: 8, rendererProto: SlicingRenderer.prototype, sliceBuilds: true,
        });
        const scene = objects(1);
        renderer.passFrame(scene);
        await nextTask();
        expect(renderer._renderTarget).toBeNull(); // a frame here sees the live binding
        renderer.passFrame(scene); // mid-build
        expect(renderer.drawn).toEqual([]);
        expect(renderer.syncBuilds).toEqual([]);
        session.end();
    });

    it('lets an unfinished build go when the session ends, and leaves the live state alone', async () => {
        const renderer = new SlicingRenderer(50);
        const session = beginAsyncRenderPipelines({ name: 'verdant-hills', renderer }, {
            buildBudgetMs: 8, rendererProto: SlicingRenderer.prototype, sliceBuilds: true,
        });
        renderer.passFrame(objects(2));
        await nextTask();
        session.end();
        await nextTask();
        await nextTask();
        expect(renderer._renderTarget).toBeNull();
        expect(renderer._mrt).toBeNull();
        expect(renderer.contextNode.id).toBe('default');
    });

    it('stays off on a three without async render builds (r186)', () => {
        const plain = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'summer', renderer: plain }, { buildBudgetMs: 8, sliceBuilds: true });
        plain.renderFrame(objects(2));
        expect(plain.built.length).toBeGreaterThan(0); // the budget builds as before
        expect(session.slicedBuilds).toBe(0);
        session.end();
    });
});
