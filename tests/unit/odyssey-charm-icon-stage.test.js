import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    OdysseyCharmIconStage, createOdysseyCharmIconNode, createOdysseyCharmIconRenderer, odysseyCharmIconMarkup,
    odysseyCharmSprite,
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
        domElement: { className: '', setAttribute: vi.fn(), remove: vi.fn() },
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
        setRenderTarget: vi.fn(),
        readRenderTargetPixelsAsync: vi.fn(async (_target, _x, _y, width, height) => new Uint8Array(width * height * 4).fill(96)),
        dispose: vi.fn(async () => {}),
    };
}

const rect = (left, top, width, height) => ({
    left, top, width, height, right: left + width, bottom: top + height,
});

function fakeList(chips) {
    return {
        clientWidth: 240,
        clientHeight: 140,
        dataset: {},
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        getBoundingClientRect: () => rect(10, 20, 240, 140),
        querySelectorAll: () => chips,
    };
}

const chip = (id, slotRect, hidden = false) => ({
    hidden, dataset: { charm: id }, querySelector: () => ({ getBoundingClientRect: () => slotRect }),
});

function stubDom() {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('document', {
        hidden: false,
        dispatchEvent: vi.fn(),
        createElement: (tag) => ({
            tag,
            width: 0,
            height: 0,
            getContext: () => ({
                createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
                putImageData: vi.fn(),
            }),
            toDataURL: () => 'data:image/png;base64,c3ByaXRl',
            dataset: {},
            setAttribute: vi.fn(),
        }),
    });
    vi.stubGlobal('CustomEvent', class CustomEvent { constructor(type) { this.type = type; } });
    return frames;
}

describe('The charm icon scene', () => {
    it('builds every charm as a group on a state ring that stays level, and lights it by state', () => {
        ODYSSEY_CHARM_ICON_IDS.forEach((id) => {
            const icon = createOdysseyCharmIcon(id);
            expect(icon.id).toBe(id);
            expect(icon.group.children).toHaveLength(2); // the icon's own group and its ring
            expect(icon.getState()).toBe('ready');
            icon.setState('armed');
            expect(icon.getState()).toBe('armed');
            icon.setState('bogus');
            expect(icon.getState()).toBe('ready');
            icon.update(1.5);
            icon.dispose();
        });
        expect(createOdysseyCharmIcon('keel')).toBeNull();
        const lights = createOdysseyCharmIconLights();
        expect(lights.lights).toHaveLength(2);
        lights.dispose();
        const camera = createOdysseyCharmIconCamera(2);
        expect(camera.right).toBeCloseTo(2.44);
        expect(camera.top).toBeCloseTo(1.22);
    });
});

describe('The charm icon stage', () => {
    let frames;
    beforeEach(() => {
        frames = stubDom();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('draws each visible chip’s icon into its slot through a viewport and scissor over the list', async () => {
        const renderer = fakeRenderer();
        const chips = [
            chip('tide', rect(15, 25, 40, 40)),
            chip('still-air', rect(15, 75, 40, 40), true), // hidden: not drawn
            chip('hearth', rect(15, 125, 40, 40)),
        ];
        const list = fakeList(chips);
        const stage = new OdysseyCharmIconStage({ list, createRenderer: async () => renderer });
        stage.setStates({ hearth: 'armed' });
        expect(await stage.init()).toBe(true);
        expect(list.children).toContain(renderer.domElement);
        expect(list.dataset.charmIcons).toBe('live');
        expect(renderer.domElement.className).toBe('charms-canvas');
        expect(stage.getDiagnostics()).toMatchObject({ backend: 'webgpu', ready: true, icons: [...ODYSSEY_CHARM_ICON_IDS] });
        expect(stage.icons.get('hearth').getState()).toBe('armed');
        expect(renderer.calls).toContainEqual(['size', 240, 140]);
        expect(frames).toHaveLength(1); // the loop is armed
        renderer.calls.length = 0;
        stage.frame(1000);
        expect(renderer.render).toHaveBeenCalledTimes(2);
        // Tide's slot: 5 px in from the list's left, 5 px down; r186's viewport origin is the top-left corner.
        expect(renderer.calls).toContainEqual(['viewport', 5, 5, 40, 40]);
        expect(renderer.calls).toContainEqual(['scissor', 5, 5, 40, 40]);
        expect(renderer.calls).toContainEqual(['viewport', 5, 105, 40, 40]);
        expect(renderer.calls.filter(([kind]) => kind === 'clear')).toHaveLength(1);
        expect(renderer.calls[0]).toEqual(['scissorTest', false]);
        expect(renderer.calls.at(-1)).toEqual(['scissorTest', false]);
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
        stage.dispose();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(renderer.domElement.remove).toHaveBeenCalled();
        expect(list.dataset.charmIcons).toBeUndefined();
        expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('exports each icon once as a PNG still for the sheets and the map, and keeps the glyph without one', async () => {
        expect(odysseyCharmSprite('tide')).toBeNull();
        expect(odysseyCharmIconMarkup('tide')).toBe('<span class="charm-sprite charm-sprite--glyph" data-charm="tide" aria-hidden="true">◆</span>');
        const glyph = createOdysseyCharmIconNode('hearth');
        expect(glyph).toMatchObject({ tag: 'span', textContent: '◆', className: 'charm-sprite charm-sprite--glyph' });
        expect(glyph.dataset.charm).toBe('hearth');

        const renderer = fakeRenderer();
        const stage = new OdysseyCharmIconStage({ list: fakeList([]), reducedMotion: true, createRenderer: async () => renderer });
        await stage.init();
        stage.icons.get('tide').setState('used');
        const sprites = await stage.exportSprites(8);
        expect([...sprites.keys()]).toEqual([...ODYSSEY_CHARM_ICON_IDS]);
        expect(odysseyCharmSprite('tide')).toMatch(/^data:image\/png/);
        expect(renderer.readRenderTargetPixelsAsync).toHaveBeenCalledTimes(4);
        expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
        // The icons go back to the states the tray had.
        expect(stage.icons.get('tide').getState()).toBe('used');
        expect(document.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'odyssey-charm-sprites' }));
        expect(odysseyCharmIconMarkup('tide')).toMatch(/^<img class="charm-sprite" src="data:image\/png/);
        const still = createOdysseyCharmIconNode('tide');
        expect(still).toMatchObject({ tag: 'img', width: 24, height: 24 });
        expect(still.src).toMatch(/^data:image\/png/);
        // A second export is the same promise's result.
        expect(await stage.exportSprites(8)).toBe(sprites);
        stage.dispose();
    });

    it('keeps the glyphs without a renderer, and after a lost device', async () => {
        const list = fakeList([]);
        const stage = new OdysseyCharmIconStage({ list, createRenderer: async () => null });
        expect(await stage.init()).toBe(false);
        expect(list.children).toHaveLength(0);
        expect(list.dataset.charmIcons).toBeUndefined();
        expect(() => stage.frame(0)).not.toThrow();
        expect(() => stage.setStates({ tide: 'used' })).not.toThrow();
        stage.dispose();

        const failing = fakeRenderer({ failRender: true });
        const lossy = fakeList([chip('tide', rect(15, 25, 40, 40))]);
        const lost = new OdysseyCharmIconStage({ list: lossy, createRenderer: async () => failing });
        await lost.init();
        lost.frame(100);
        expect(lost.ready).toBe(false);
        expect(lossy.dataset.charmIcons).toBeUndefined();
        expect(failing.domElement.remove).toHaveBeenCalled();
        expect(failing.dispose).toHaveBeenCalledOnce();
        lost.dispose();
        expect(failing.dispose).toHaveBeenCalledOnce();
    });

    it('under reduced motion draws one frame per state change instead of a loop, and a stage disposed while initialising lets its renderer go', async () => {
        const renderer = fakeRenderer();
        const stage = new OdysseyCharmIconStage({
            list: fakeList([chip('tide', rect(15, 25, 40, 40))]), reducedMotion: true, createRenderer: async () => renderer,
        });
        await stage.init();
        expect(frames).toHaveLength(1);
        frames[0](16);
        expect(renderer.render).toHaveBeenCalledTimes(1);
        expect(frames).toHaveLength(1); // no loop
        stage.setStates({ tide: 'used' });
        expect(frames).toHaveLength(2);
        stage.dispose();

        let resolveRenderer;
        const late = new OdysseyCharmIconStage({
            list: fakeList([]), createRenderer: () => new Promise((resolve) => { resolveRenderer = resolve; }),
        });
        const pending = late.init();
        late.dispose();
        const lateRenderer = fakeRenderer();
        resolveRenderer(lateRenderer);
        expect(await pending).toBe(false);
        expect(lateRenderer.dispose).toHaveBeenCalledOnce();
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
