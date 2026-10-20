/**
 * The charm icons in the HUD tray, and as still sprites everywhere else.
 *
 * One small three r186 renderer (WebGPU, or its WebGL2 backend where WebGPU is missing) draws
 * every visible chip's icon into a transparent canvas laid over the chip list, each icon through
 * a viewport and scissor over its chip's icon slot, on a clock the stage owns (30 frames a
 * second, nothing while the page is hidden, one frame per state change under reduced motion).
 * The same scene exports each icon once as a PNG data URL (rendered into a target and read back),
 * which the ceremony, the failure sheet, the results sheet and the map use as `<img>` sprites
 * (odysseyCharmSprite). Without a renderer the chips keep their glyph; nothing waits on this.
 */
import * as THREE from 'three/webgpu';
import {
    ODYSSEY_CHARM_ICON_HALF_EXTENT, ODYSSEY_CHARM_ICON_IDS, createOdysseyCharmIcon, createOdysseyCharmIconCamera,
    createOdysseyCharmIconLights,
} from '../../rendering/odyssey/odyssey-charm-icons.js';

const INIT_TIMEOUT_MS = 6000;
const FRAME_MS = 1000 / 30;
const SLOT_SPACING = 6;
const SPRITE_SIZE = 96;

function wantsWebGL() {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const forced = params.has('forceWebGL')
        && ['', '1', 'true', 'yes', 'on'].includes((params.get('forceWebGL') || '').toLowerCase());
    return forced || !globalThis.navigator?.gpu;
}

/** @param {boolean} forceWebGL */
async function initRenderer(forceWebGL) {
    const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL });
    let timer;
    try {
        await Promise.race([
            renderer.init(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('charm icon renderer init timed out')), INIT_TIMEOUT_MS);
            }),
        ]);
    } catch (error) {
        Promise.resolve(renderer.dispose()).catch(() => {});
        throw error;
    } finally {
        clearTimeout(timer);
    }
    return renderer;
}

/** WebGPU first, the WebGL2 backend when it is missing; null when neither can be had. */
export async function createOdysseyCharmIconRenderer({ init = initRenderer, forceWebGL = wantsWebGL() } = {}) {
    try {
        return await init(forceWebGL);
    } catch (error) {
        if (forceWebGL) {
            console.warn('[OdysseyCharmIcons] no renderer; the chips keep their glyphs:', error?.message || error);
            return null;
        }
        console.warn('[OdysseyCharmIcons] WebGPU unavailable, using the WebGL2 backend:', error?.message || error);
        try {
            return await init(true);
        } catch (fallbackError) {
            console.warn('[OdysseyCharmIcons] no renderer; the chips keep their glyphs:', fallbackError?.message || fallbackError);
            return null;
        }
    }
}

/** The sprites, once exported this session, by charm id (PNG data URLs). */
const sprites = new Map();
let spritePromise = null;

/** A still of one charm's icon, or null before the first export (the caller keeps its glyph). */
export function odysseyCharmSprite(charmId) {
    return sprites.get(charmId) || null;
}

/** Pixels from a render target (v = 0 is the TOP row on both backends, so rows are flipped) to a PNG data URL. */
function pixelsToDataUrl(pixels, size) {
    const doc = globalThis.document;
    if (!doc?.createElement) return null;
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext?.('2d');
    if (!context) return null;
    const image = context.createImageData(size, size);
    const row = size * 4;
    for (let y = 0; y < size; y += 1) {
        image.data.set(pixels.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}

export class OdysseyCharmIconStage {
    /**
     * @param {object} options
     * @param {HTMLElement} options.list the chip list the canvas lays over
     * @param {string} [options.slotSelector] how a chip's icon slot is found
     * @param {boolean} [options.reducedMotion] one frame per state change instead of a loop
     * @param {() => Promise<object|null>} [options.createRenderer]
     */
    constructor({
        list, slotSelector = '.charm-chip__icon', reducedMotion = false, createRenderer = createOdysseyCharmIconRenderer,
    }) {
        this.list = list;
        this.slotSelector = slotSelector;
        this.reducedMotion = reducedMotion;
        this.createRenderer = createRenderer;
        this.renderer = null;
        this.backend = null;
        this.canvas = null;
        this.scene = null;
        this.camera = null;
        this.icons = new Map();
        this.lights = null;
        this.disposed = false;
        this.ready = false;
        this.initPromise = null;
        this.frameHandle = null;
        this.lastFrameAt = 0;
        this.clock = 0;
        this.lastNow = null;
        this.size = { width: 0, height: 0 };
        this.pendingStates = new Map();
        this.needsFrame = true;
    }

    /** Build once; resolves true when icons can be drawn. */
    init() {
        if (!this.initPromise) this.initPromise = this._init();
        return this.initPromise;
    }

    async _init() {
        if (!this.list || typeof document === 'undefined') return false;
        const renderer = await this.createRenderer();
        if (this.disposed) {
            if (renderer) Promise.resolve(renderer.dispose()).catch(() => {});
            return false;
        }
        if (!renderer) return false;
        this.renderer = renderer;
        this.backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        const canvas = renderer.domElement;
        canvas.className = 'charms-canvas';
        canvas.setAttribute?.('aria-hidden', 'true');
        this.canvas = canvas;
        this.list.appendChild(canvas);
        if (this.list.dataset) this.list.dataset.charmIcons = 'live';

        this.scene = new THREE.Scene();
        ODYSSEY_CHARM_ICON_IDS.forEach((id, index) => {
            const icon = createOdysseyCharmIcon(id);
            icon.group.position.x = index * SLOT_SPACING;
            icon.setState(this.pendingStates.get(id) || 'ready');
            this.scene.add(icon.group);
            this.icons.set(id, icon);
        });
        this.lights = createOdysseyCharmIconLights();
        this.lights.lights.forEach((light) => this.scene.add(light));
        this.camera = createOdysseyCharmIconCamera(1);
        this.ready = true;
        this.resize();
        this.start();
        return true;
    }

    /** Each charm's chip state, from the tray's view. @param {Record<string, string>} states */
    setStates(states) {
        Object.entries(states || {}).forEach(([id, state]) => {
            this.pendingStates.set(id, state);
            this.icons.get(id)?.setState(state);
        });
        this.needsFrame = true;
        if (this.ready && this.reducedMotion) this.requestFrame();
    }

    /** Fit the canvas to the list. */
    resize() {
        if (!this.renderer || !this.list) return;
        const width = this.list.clientWidth || 0;
        const height = this.list.clientHeight || 0;
        if (!width || !height) return;
        if (width === this.size.width && height === this.size.height) return;
        this.size = { width, height };
        this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
        this.renderer.setSize(width, height, false);
        this.needsFrame = true;
    }

    /**
     * The visible chips' icon slots, as rectangles inside the canvas. Client rectangles come
     * scaled when the HUD column is drawn smaller (odyssey-hud-fit.js); the list's own size
     * brings them back to the canvas's pixels.
     */
    _slots() {
        const listRect = this.list.getBoundingClientRect?.();
        if (!listRect) return [];
        const scaleX = listRect.width ? (this.list.clientWidth || listRect.width) / listRect.width : 1;
        const scaleY = listRect.height ? (this.list.clientHeight || listRect.height) / listRect.height : 1;
        const slots = [];
        this.list.querySelectorAll?.('.charm-chip').forEach((chip) => {
            if (chip.hidden) return;
            const id = chip.dataset?.charm;
            const slot = chip.querySelector?.(this.slotSelector);
            if (!id || !slot || !this.icons.has(id)) return;
            const rect = slot.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            slots.push({
                id,
                x: (rect.left - listRect.left) * scaleX,
                y: (rect.top - listRect.top) * scaleY,
                width: rect.width * scaleX,
                height: rect.height * scaleY,
            });
        });
        return slots;
    }

    /** One frame: every visible icon into its slot. */
    frame(now = globalThis.performance?.now?.() || 0) {
        if (!this.ready || !this.renderer || this.disposed) return;
        if (this.lastNow !== null) this.clock += Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
        this.lastNow = now;
        this.resize();
        const { width, height } = this.size;
        if (!width || !height) return;
        const slots = this._slots();
        this.icons.forEach((icon) => icon.update(this.clock));
        const { renderer, camera } = this;
        try {
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, width, height);
            renderer.clear();
            renderer.setScissorTest(true);
            slots.forEach((slot) => {
                const icon = this.icons.get(slot.id);
                const { x } = icon.group.position;
                const aspect = slot.width / slot.height;
                const h = ODYSSEY_CHARM_ICON_HALF_EXTENT;
                camera.left = -h * aspect;
                camera.right = h * aspect;
                camera.updateProjectionMatrix();
                camera.position.set(x, 1.35, 7);
                camera.lookAt(x, -0.12, 0);
                // r186's viewport origin is the TOP-left corner on both backends (the WebGL backend
                // flips it to GL's bottom-left itself), so a slot's CSS rectangle maps straight across.
                renderer.setViewport(slot.x, slot.y, slot.width, slot.height);
                renderer.setScissor(slot.x, slot.y, slot.width, slot.height);
                renderer.render(this.scene, camera);
            });
            renderer.setScissorTest(false);
        } catch (error) {
            console.warn('[OdysseyCharmIcons] frame failed; the chips keep their glyphs:', error?.message || error);
            this._lose();
        }
        this.needsFrame = false;
    }

    /** Draw one frame on the next animation frame (reduced motion, or a state change while stopped). */
    requestFrame() {
        if (this.frameHandle !== null || typeof requestAnimationFrame === 'undefined') return;
        this.frameHandle = requestAnimationFrame((now) => {
            this.frameHandle = null;
            this.frame(now);
        });
    }

    /** The loop: 30 frames a second while the page is visible; under reduced motion, one frame. */
    start() {
        if (this.disposed || !this.ready) return;
        if (this.reducedMotion) {
            this.requestFrame();
            return;
        }
        if (this.frameHandle !== null || typeof requestAnimationFrame === 'undefined') return;
        const tick = (now) => {
            this.frameHandle = null;
            if (this.disposed || !this.ready) return;
            if (!globalThis.document?.hidden && now - this.lastFrameAt >= FRAME_MS) {
                this.lastFrameAt = now;
                this.frame(now);
            } else if (globalThis.document?.hidden) {
                this.lastNow = null;
            }
            this.frameHandle = requestAnimationFrame(tick);
        };
        this.frameHandle = requestAnimationFrame(tick);
    }

    stop() {
        if (this.frameHandle !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frameHandle);
        this.frameHandle = null;
        this.lastNow = null;
    }

    /**
     * Export every icon once as a PNG data URL for the sheets and the map (odysseyCharmSprite).
     * Rendered into a target and read back, so it works on both backends.
     */
    exportSprites(size = SPRITE_SIZE) {
        if (spritePromise) return spritePromise;
        spritePromise = this._exportSprites(size).catch((error) => {
            console.warn('[OdysseyCharmIcons] sprites could not be exported:', error?.message || error);
            spritePromise = null;
            return sprites;
        });
        return spritePromise;
    }

    async _exportSprites(size) {
        if (!this.ready || !this.renderer) return sprites;
        const { renderer, scene } = this;
        const target = new THREE.RenderTarget(size, size, { depthBuffer: true });
        const camera = createOdysseyCharmIconCamera(1);
        const previousStates = new Map();
        try {
            for (const [id, icon] of this.icons) {
                previousStates.set(id, icon.getState());
                icon.setState('ready');
                icon.update(1.5);
                const { x } = icon.group.position;
                camera.position.set(x, 1.35, 7);
                camera.lookAt(x, -0.12, 0);
                renderer.setRenderTarget(target);
                renderer.setScissorTest(false);
                renderer.setViewport(0, 0, size, size);
                renderer.clear();
                renderer.render(scene, camera);
                renderer.setRenderTarget(null);
                // eslint-disable-next-line no-await-in-loop -- one read-back per icon, four in all.
                const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
                const url = pixelsToDataUrl(pixels, size);
                if (url) sprites.set(id, url);
            }
        } finally {
            renderer.setRenderTarget(null);
            previousStates.forEach((state, id) => this.icons.get(id)?.setState(state));
            target.dispose();
            this.needsFrame = true;
        }
        globalThis.document?.dispatchEvent?.(new CustomEvent('odyssey-charm-sprites'));
        return sprites;
    }

    /** A lost device: keep the glyphs from now on. */
    _lose() {
        const { renderer } = this;
        this.ready = false;
        this.stop();
        this.renderer = null;
        if (this.list?.dataset) delete this.list.dataset.charmIcons;
        this.canvas?.remove?.();
        this.canvas = null;
        if (renderer) Promise.resolve(renderer.dispose()).catch(() => {});
    }

    getDiagnostics() {
        return { backend: this.backend, ready: this.ready, icons: [...this.icons.keys()] };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.stop();
        this.ready = false;
        this.icons.forEach((icon) => icon.dispose());
        this.icons.clear();
        this.lights?.dispose();
        this.lights = null;
        const { renderer } = this;
        this.renderer = null;
        if (this.list?.dataset) delete this.list.dataset.charmIcons;
        this.canvas?.remove?.();
        this.canvas = null;
        if (renderer) {
            // r186: the device must not be released before disposal settles.
            Promise.resolve(renderer.dispose()).catch((error) => {
                console.warn('[OdysseyCharmIcons] renderer dispose failed:', error?.message || error);
            });
        }
        this.scene = null;
        this.camera = null;
    }
}

/**
 * Sprites for the sheets and the map without a tray: a short-lived stage renders the four icons
 * once and is disposed. Idempotent; resolves to the sprite map (possibly empty).
 */
export async function ensureOdysseyCharmSprites() {
    if (sprites.size === ODYSSEY_CHARM_ICON_IDS.length) return sprites;
    if (spritePromise) return spritePromise;
    if (typeof document === 'undefined') return sprites;
    const list = document.createElement('div');
    list.style.cssText = 'position:fixed;left:-9999px;top:0;width:96px;height:96px;overflow:hidden;';
    document.body.appendChild(list);
    const stage = new OdysseyCharmIconStage({ list, reducedMotion: true });
    try {
        if (await stage.init()) await stage.exportSprites();
    } finally {
        stage.dispose();
        list.remove();
    }
    return sprites;
}

/** The sprite markup a sheet or the map uses for a charm: the still, or the glyph until there is one. */
export function odysseyCharmIconMarkup(charmId, { className = 'charm-sprite' } = {}) {
    const url = odysseyCharmSprite(charmId);
    if (url) return `<img class="${className}" src="${url}" alt="" width="24" height="24" data-charm="${charmId}">`;
    return `<span class="${className} ${className}--glyph" data-charm="${charmId}" aria-hidden="true">◆</span>`;
}

/** The same as an element, for sheets built from nodes. @returns {HTMLElement | null} */
export function createOdysseyCharmIconNode(charmId, { className = 'charm-sprite' } = {}) {
    const doc = globalThis.document;
    if (!doc?.createElement) return null;
    const url = odysseyCharmSprite(charmId);
    const node = doc.createElement(url ? 'img' : 'span');
    node.className = url ? className : `${className} ${className}--glyph`;
    if (node.dataset) node.dataset.charm = charmId;
    if (url) {
        node.src = url;
        node.alt = '';
        node.width = 24;
        node.height = 24;
    } else {
        node.textContent = '◆';
        node.setAttribute?.('aria-hidden', 'true');
    }
    return node;
}
