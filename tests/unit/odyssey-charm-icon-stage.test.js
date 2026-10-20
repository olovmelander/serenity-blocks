import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    OdysseyCharmIconStage, OdysseyCharmIconTray, createOdysseyCharmIconNode, createOdysseyCharmIconRenderer,
    disposeOdysseyCharmIconStage, getOdysseyCharmIconStage,
} from '../../src/ui/odyssey/odyssey-charm-icon-stage.js';
import {
    ODYSSEY_CHARM_ICON_IDS, createOdysseyCharmIcon, createOdysseyCharmIconCamera, createOdysseyCharmIconLights,
} from '../../src/rendering/odyssey/odyssey-charm-icons.js';

function fakeRenderer({ failRender = false } = {}) {
    const calls = [];
    return {
        calls,
        autoClear: true,
        backend: { isWebGPUBackend: true },
        domElement: { tag: 'canvas', width: 0, height: 0 },
        setClearColor: vi.fn(),
        setPixelRatio: vi.fn(),
        setSize: vi.fn((width, height) => calls.push(['size', width, height])),
        setScissorTest: vi.fn((on) => calls.push(['scissorTest', on])),
        setViewport: vi.fn((...args) => calls.push(['viewport', ...args])),
        setScissor: vi.fn((...args) => calls.push(['scissor', ...args])),
        clear: vi.fn(() => calls.push(['clear'])),
        render: vi.fn(() => {
            if (failRender) throw new Error('device lost');
            calls.push(['render']);
        }),
        dispose: vi.fn(async () => {}),
    };
}

/** A slot canvas in a box, as a sheet or a chip would hold it. */
function fakeCanvas(width, height, { connected = true, context = true } = {}) {
    const host = { dataset: {} };
    const ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
        tag: 'canvas',
        width: 0,
        height: 0,
        isConnected: connected,
        parentElement: host,
        getBoundingClientRect: () => ({ width, height }),
        getContext: () => (context ? ctx : null),
    };
    return { canvas, ctx, host };
}

function stubDom() {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('document', {
        hidden: false,
        createElement: (tag) => ({
            tag,
            width: 0,
            height: 0,
            className: '',
            textContent: '',
            dataset: {},
            isConnected: true,
            children: [],
            parentElement: null,
            setAttribute: vi.fn(),
            appendChild(child) {
                child.parentElement = this;
                this.children.push(child);
                return child;
            },
            getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
            getBoundingClientRect: () => ({ width: 24, height: 24 }),
            remove: vi.fn(),
        }),
    });
    return frames;
}

describe('The charm icon scene', () => {
    it('builds every charm as a group on a state ring that stays level, and lights it by state', () => {
        ODYSSEY_CHARM_ICON_IDS.forEach((id) => {
            const icon = createOdysseyCharmIcon(id);
            expect(icon.id).toBe(id);
            expect(icon.group.children).toHaveLength(2);
            icon.setState('armed');
            expect(icon.getState()).toBe('armed');
            expect(icon.uniforms.uRing.value).toBe(1);
            icon.setState('used');
            expect(icon.uniforms.uDim.value).toBe(1);
            icon.setState('nonsense');
            expect(icon.getState()).toBe('ready');
            icon.update(2);
            expect(icon.uniforms.uSpin.value).toBeCloseTo(0.8);
            icon.dispose();
        });
        expect(createOdysseyCharmIcon('unknown')).toBeNull();
        const lights = createOdysseyCharmIconLights();
        expect(lights.lights).toHaveLength(2);
        lights.dispose();
        const camera = createOdysseyCharmIconCamera(2);
        expect(camera.right).toBeCloseTo(2.44);
    });
});

describe('The charm icon stage', () => {
    let frames;
    beforeEach(() => {
        frames = stubDom();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        disposeOdysseyCharmIconStage();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('draws each showing slot’s icon into a tile of its own canvas and copies it into the slot', async () => {
        const renderer = fakeRenderer();
        const stage = new OdysseyCharmIconStage({ createRenderer: async () => renderer, pixelRatio: 2 });
        const tide = fakeCanvas(40, 40);
        const hidden = fakeCanvas(0, 0); // display: none — not drawn
        const hearth = fakeCanvas(24, 30);
        const handles = [
            stage.mount(tide.canvas, 'tide'),
            stage.mount(hidden.canvas, 'still-air'),
            stage.mount(hearth.canvas, 'hearth', { state: 'armed' }),
        ];
        expect(handles.every(Boolean)).toBe(true);
        expect(stage.mount(fakeCanvas(10, 10, { context: false }).canvas, 'tide')).toBeNull();
        expect(stage.mount(fakeCanvas(10, 10).canvas, 'bogus')).toBeNull();
        expect(await stage.init()).toBe(true);
        expect(stage.getDiagnostics()).toMatchObject({
            backend: 'webgpu', ready: true, icons: [...ODYSSEY_CHARM_ICON_IDS], slots: 3,
        });
        expect(renderer.setPixelRatio).toHaveBeenCalledWith(1);
        expect(frames).toHaveLength(1); // the loop is armed
        renderer.calls.length = 0;
        stage.frame(1000);
        // Two tiles at device pixels (ratio 2), side by side, in one canvas as wide as both.
        expect(renderer.calls).toContainEqual(['size', 128, 80]);
        expect(renderer.render).toHaveBeenCalledTimes(2);
        expect(renderer.calls).toContainEqual(['viewport', 0, 0, 80, 80]);
        expect(renderer.calls).toContainEqual(['scissor', 0, 0, 80, 80]);
        expect(renderer.calls).toContainEqual(['viewport', 80, 0, 48, 60]);
        expect(renderer.calls.filter(([kind]) => kind === 'clear')).toHaveLength(1);
        expect(renderer.calls[1]).toEqual(['scissorTest', false]);
        expect(renderer.calls.at(-1)).toEqual(['scissorTest', false]);
        // Each slot's canvas takes its tile, and its box shows the icon instead of the glyph.
        expect([tide.canvas.width, tide.canvas.height]).toEqual([80, 80]);
        expect(tide.ctx.drawImage).toHaveBeenCalledWith(renderer.domElement, 0, 0, 80, 80, 0, 0, 80, 80);
        expect(hearth.ctx.drawImage).toHaveBeenCalledWith(renderer.domElement, 80, 0, 48, 60, 0, 0, 48, 60);
        expect(tide.host.dataset.charmIcon).toBe('live');
        expect(hidden.host.dataset.charmIcon).toBeUndefined();
        expect(stage.icons.get('hearth').getState()).toBe('armed');
        // The loop: a frame at most every 33 ms, none while the page is hidden.
        renderer.render.mockClear();
        frames[0](1000);
        expect(renderer.render).toHaveBeenCalledTimes(2);
        renderer.render.mockClear();
        frames.at(-1)(1010);
        expect(renderer.render).not.toHaveBeenCalled();
        frames.at(-1)(1050);
        expect(renderer.render).toHaveBeenCalledTimes(2);
        document.hidden = true;
        renderer.render.mockClear();
        frames.at(-1)(1100);
        expect(renderer.render).not.toHaveBeenCalled();
        document.hidden = false;
        // A state change reaches the next frame; a released slot is not drawn and loses its flag.
        handles[0].setState('used');
        handles[2].release();
        renderer.render.mockClear();
        frames.at(-1)(1200);
        expect(renderer.render).toHaveBeenCalledTimes(1);
        expect(stage.icons.get('tide').getState()).toBe('used');
        expect(hearth.host.dataset.charmIcon).toBeUndefined();
        // A slot whose canvas has left the document is released on its own.
        tide.canvas.isConnected = false;
        frames.at(-1)(1300);
        expect(stage.getDiagnostics().slots).toBe(1);
        stage.dispose();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('keeps the glyphs without a renderer, and after a lost device', async () => {
        const stage = new OdysseyCharmIconStage({ createRenderer: async () => null });
        const slot = fakeCanvas(24, 24);
        expect(stage.mount(slot.canvas, 'tide')).not.toBeNull();
        expect(await stage.init()).toBe(false);
        expect(slot.host.dataset.charmIcon).toBeUndefined();
        expect(() => stage.frame(0)).not.toThrow();
        stage.dispose();

        const failing = fakeRenderer({ failRender: true });
        const lost = new OdysseyCharmIconStage({ createRenderer: async () => failing });
        const lossy = fakeCanvas(24, 24);
        lost.mount(lossy.canvas, 'tide');
        await lost.init();
        lost.frame(100);
        expect(lost.ready).toBe(false);
        expect(lossy.host.dataset.charmIcon).toBeUndefined();
        expect(failing.dispose).toHaveBeenCalledOnce();
        lost.dispose();
        expect(failing.dispose).toHaveBeenCalledOnce();
    });

    it('under reduced motion draws each slot once and again on a state change, and a stage disposed while initialising lets its renderer go', async () => {
        const renderer = fakeRenderer();
        const stage = new OdysseyCharmIconStage({ reducedMotion: true, createRenderer: async () => renderer });
        const slot = fakeCanvas(24, 24);
        const handle = stage.mount(slot.canvas, 'tide');
        await stage.init();
        frames.at(-1)(300);
        expect(renderer.render).toHaveBeenCalledTimes(1);
        frames.at(-1)(600);
        frames.at(-1)(900);
        expect(renderer.render).toHaveBeenCalledTimes(1); // drawn once; no loop
        handle.setState('used');
        frames.at(-1)(1200);
        expect(renderer.render).toHaveBeenCalledTimes(2);
        // A slot that appears later gets its frame too.
        const late = fakeCanvas(24, 24);
        stage.mount(late.canvas, 'hearth');
        frames.at(-1)(1500);
        expect(renderer.render).toHaveBeenCalledTimes(3);
        expect(late.host.dataset.charmIcon).toBe('live');
        stage.dispose();

        let resolveRenderer;
        const pendingStage = new OdysseyCharmIconStage({
            createRenderer: () => new Promise((resolve) => { resolveRenderer = resolve; }),
        });
        const pending = pendingStage.init();
        pendingStage.dispose();
        const lateRenderer = fakeRenderer();
        resolveRenderer(lateRenderer);
        expect(await pending).toBe(false);
        expect(lateRenderer.dispose).toHaveBeenCalledOnce();
    });

    it('serves the HUD tray: a canvas in each chip’s slot, states passed through, released with the tray', async () => {
        const renderer = fakeRenderer();
        const stage = new OdysseyCharmIconStage({ createRenderer: async () => renderer });
        const chip = (id, hidden = false) => {
            const slot = {
                dataset: {},
                children: [],
                appendChild(child) {
                    child.parentElement = this;
                    this.children.push(child);
                    return child;
                },
            };
            return {
                hidden, dataset: { charm: id }, slot, querySelector: () => slot,
            };
        };
        const chips = [chip('tide'), chip('hearth', true)];
        const list = { querySelectorAll: () => chips };
        const tray = new OdysseyCharmIconTray({ list, reducedMotion: true, stage });
        tray.setStates({ tide: 'armed' });
        expect(await tray.init()).toBe(true);
        expect(stage.reducedMotion).toBe(true);
        expect(chips[0].slot.children[0].className).toBe('charm-chip__canvas');
        expect(stage.getDiagnostics().slots).toBe(2);
        expect([...stage.slots][0].state).toBe('armed');
        tray.setStates({ tide: 'used', hearth: 'ready' });
        expect([...stage.slots].map((slot) => slot.state)).toEqual(['used', 'ready']);
        tray.dispose();
        expect(stage.getDiagnostics().slots).toBe(0);
        expect(await tray.init()).toBe(false);
        stage.dispose();
    });

    it('makes an icon node for the sheets and the map on the shared stage, with its glyph inside', async () => {
        const renderer = fakeRenderer();
        const shared = getOdysseyCharmIconStage();
        shared.createRenderer = async () => renderer;
        expect(getOdysseyCharmIconStage()).toBe(shared);
        const node = createOdysseyCharmIconNode('hearth');
        expect(node).toMatchObject({ tag: 'span', className: 'charm-sprite' });
        expect(node.dataset.charm).toBe('hearth');
        expect(node.children.map((child) => [child.tag, child.className]))
            .toEqual([['canvas', 'charm-sprite__canvas'], ['span', 'charm-sprite__glyph']]);
        expect(node.charmIcon).toBeTruthy();
        expect(shared.getDiagnostics().slots).toBe(1);
        expect(await shared.init()).toBe(true);
        shared.frame(50);
        expect(node.dataset.charmIcon).toBe('live');
        expect(createOdysseyCharmIconNode('bogus').charmIcon).toBeUndefined();
        disposeOdysseyCharmIconStage();
        expect(getOdysseyCharmIconStage()).not.toBe(shared);
    });

    it('falls back from WebGPU to the WebGL2 backend, and to nothing', async () => {
        const made = [];
        const init = vi.fn(async (forceWebGL) => {
            if (!forceWebGL) throw new Error('no adapter');
            const renderer = fakeRenderer();
            made.push(renderer);
            return renderer;
        });
        expect(await createOdysseyCharmIconRenderer({ init, forceWebGL: false })).toBe(made[0]);
        expect(init).toHaveBeenNthCalledWith(1, false);
        expect(init).toHaveBeenNthCalledWith(2, true);
        const broken = vi.fn(async () => { throw new Error('nothing'); });
        expect(await createOdysseyCharmIconRenderer({ init: broken, forceWebGL: true })).toBeNull();
        expect(broken).toHaveBeenCalledOnce();
        expect(await createOdysseyCharmIconRenderer({ init: broken, forceWebGL: false })).toBeNull();
    });
});
