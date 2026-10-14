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
 * (the build costs BUILD_MS of the fake clock).
 */

const BUILD_MS = 3;
let now = 0;

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
            now += BUILD_MS;
            map.set([object, material], { object });
            this.built.push(object.id);
        }
        this.drawn.push(object.id);
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
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await preloadAsyncRenderPipelines(() => ({ WebGPUBackend: FakeBackend, Renderer: FakeRenderer }));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await preloadAsyncRenderPipelines(() => null);
    resetAsyncRenderPipelinesForTests();
});

describe('the async session build budget', () => {
    it('builds new render objects until the frame budget is spent, and the rest on later frames', () => {
        const renderer = new FakeRenderer();
        const theme = { name: 'summer', renderer };
        const session = beginAsyncRenderPipelines(theme, { buildBudgetMs: 8 });
        const scene = objects(10);

        renderer.renderFrame(scene);
        expect(renderer.built).toEqual([0, 1, 2]); // 0 + 3 + 3 < 8, then 9 >= 8
        expect(session.deferredBuilds).toBe(7);
        expect(renderer.drawn).toEqual([0, 1, 2]);

        renderer.renderFrame(scene);
        renderer.renderFrame(scene);
        renderer.renderFrame(scene);
        expect(renderer.built).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        // Built objects draw every frame and are never deferred again.
        expect(session.deferredBuilds).toBe(7 + 4 + 1);
        renderer.drawn.length = 0;
        renderer.renderFrame(scene);
        expect(renderer.drawn).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(session.buildMs).toBe(30);
        session.end();
    });

    it('is not quiet while builds are deferred', () => {
        const renderer = new FakeRenderer();
        const session = beginAsyncRenderPipelines({ name: 'summer', renderer }, { buildBudgetMs: 8 });
        const scene = objects(12); // four frames of three builds each
        for (let frame = 0; frame < 3; frame += 1) {
            renderer.renderFrame(scene);
            session.noteFrame();
            expect(session.isQuiet(2)).toBe(false);
        }
        renderer.renderFrame(scene); // the last three: nothing deferred any more
        session.noteFrame();
        session.noteFrame();
        expect(session.isQuiet(2)).toBe(true);
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
