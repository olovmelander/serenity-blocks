/**
 * The charm icons, live, wherever a charm is named: the HUD tray, the ceremony's "Found" line,
 * the failure sheet's mercy, the results sheet's "Charms used", the orb panel's hint and the map
 * header's bag.
 *
 * One small three r186 renderer (WebGPU, or its WebGL2 backend where WebGPU is missing) serves
 * the whole session. Each place an icon shows is a SLOT: a small 2D canvas sized to its box.
 * Every frame the stage draws each visible slot's icon into a tile of its own, detached canvas
 * (one viewport and scissor per tile) and copies the tile into the slot's canvas with
 * drawImage, so an icon sits in the document's own flow and stacking wherever a sheet puts it,
 * and one GPU device draws them all. The clock is the stage's (30 frames a second, nothing while
 * the page is hidden; under reduced motion one frame per slot and per state change).
 *
 * Until a slot's first frame lands, and for good without a renderer or after a lost device, the
 * slot keeps its glyph: nothing waits on this. (It replaced a HUD-only live canvas plus PNG
 * stills exported once for the sheets, which showed the glyph for the first charm of every
 * journey, since the export only ran once the bag held something.)
 */
/* eslint-disable max-classes-per-file -- the stage and the HUD tray's view of it belong together. */
import * as THREE from 'three/webgpu';
import {
    ODYSSEY_CHARM_ICON_HALF_EXTENT, ODYSSEY_CHARM_ICON_IDS, createOdysseyCharmIcon, createOdysseyCharmIconCamera,
    createOdysseyCharmIconLights, createOdysseyCharmStudio,
} from '../../rendering/odyssey/odyssey-charm-icons.js';

const INIT_TIMEOUT_MS = 6000;
const FRAME_MS = 1000 / 30;
/** Under reduced motion the stage only looks for slots that still need their one frame. */
const STILL_POLL_MS = 250;
const SLOT_SPACING = 6;
const MAX_PIXEL_RATIO = 2;
/** A slot never attached to the document is forgotten after this long. */
const ORPHAN_MS = 10000;

function wantsWebGL() {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const forced = params.has('forceWebGL')
        && ['', '1', 'true', 'yes', 'on'].includes((params.get('forceWebGL') || '').toLowerCase());
    return forced || !globalThis.navigator?.gpu;
}

function systemReducedMotion() {
    try {
        return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
        return false;
    }
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
            console.warn('[OdysseyCharmIcons] no renderer; the slots keep their glyphs:', error?.message || error);
            return null;
        }
        console.warn('[OdysseyCharmIcons] WebGPU unavailable, using the WebGL2 backend:', error?.message || error);
        try {
            return await init(true);
        } catch (fallbackError) {
            console.warn('[OdysseyCharmIcons] no renderer; the slots keep their glyphs:', fallbackError?.message || fallbackError);
            return null;
        }
    }
}

/** The element a slot's live flag is written on: the canvas's box (its glyph hides on it). */
function slotHost(slot) {
    return slot.canvas.parentElement || slot.canvas.parentNode || null;
}

function markLive(slot, live) {
    const host = slotHost(slot);
    if (!host?.dataset) return;
    if (live) host.dataset.charmIcon = 'live';
    else delete host.dataset.charmIcon;
}

export class OdysseyCharmIconStage {
    /**
     * @param {object} [options]
     * @param {boolean} [options.reducedMotion] one frame per slot and per state change instead of a loop
     * @param {() => Promise<object|null>} [options.createRenderer]
     * @param {number} [options.pixelRatio] the device pixel ratio to draw at (capped at 2)
     */
    constructor({
        reducedMotion = systemReducedMotion(), createRenderer = createOdysseyCharmIconRenderer, pixelRatio = null,
    } = {}) {
        this.reducedMotion = reducedMotion;
        this.createRenderer = createRenderer;
        this.pixelRatio = pixelRatio;
        this.renderer = null;
        this.backend = null;
        this.scene = null;
        this.camera = null;
        this.studio = null;
        this.icons = new Map();
        this.lights = null;
        this.slots = new Set();
        this.disposed = false;
        this.ready = false;
        this.failed = false;
        this.initPromise = null;
        this.frameHandle = null;
        this.lastFrameAt = 0;
        this.clock = 0;
        this.lastNow = null;
        this.size = { width: 0, height: 0 };
        this.needsFrame = true;
        // Each slot's box size, kept by a ResizeObserver instead of a layout read per slot on
        // every drawn frame (30 a second over the map: a forced style/layout whenever anything
        // else on the page had changed, audit 2026-10-23). Null: read the box each frame.
        this.slotByCanvas = new WeakMap();
        this.resizeObserver = typeof globalThis.ResizeObserver === 'function'
            ? new globalThis.ResizeObserver((entries) => this._onSlotResize(entries))
            : null;
    }

    /** @private keep the observed boxes' sizes and draw them anew */
    _onSlotResize(entries) {
        entries.forEach((entry) => {
            const slot = this.slotByCanvas.get(entry.target);
            if (!slot) return;
            slot.box = { width: entry.contentRect.width, height: entry.contentRect.height };
            slot.drawn = false;
        });
        this.needsFrame = true;
        this.start();
    }

    /** Build once; resolves true when icons can be drawn. */
    init() {
        if (!this.initPromise) this.initPromise = this._init();
        return this.initPromise;
    }

    async _init() {
        if (typeof document === 'undefined') return false;
        const renderer = await this.createRenderer();
        if (this.disposed) {
            if (renderer) Promise.resolve(renderer.dispose()).catch(() => {});
            return false;
        }
        if (!renderer) {
            this.failed = true;
            return false;
        }
        this.renderer = renderer;
        this.backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        // Device pixels are the stage's own business: every tile is drawn at its slot's size.
        renderer.setPixelRatio(1);

        this.scene = new THREE.Scene();
        // The one studio every icon reflects; it goes with the renderer.
        this.studio = createOdysseyCharmStudio();
        ODYSSEY_CHARM_ICON_IDS.forEach((id, index) => {
            const icon = createOdysseyCharmIcon(id, { studio: this.studio });
            icon.group.position.x = index * SLOT_SPACING;
            this.scene.add(icon.group);
            this.icons.set(id, icon);
        });
        this.lights = createOdysseyCharmIconLights();
        this.lights.lights.forEach((light) => this.scene.add(light));
        this.camera = createOdysseyCharmIconCamera(1);
        this.ready = true;
        this.needsFrame = true;
        this.start();
        return true;
    }

    /** @param {boolean} reduced */
    setReducedMotion(reduced) {
        if (this.reducedMotion === Boolean(reduced)) return;
        this.reducedMotion = Boolean(reduced);
        this.needsFrame = true;
        this.stop();
        this.start();
    }

    /**
     * Draw one charm's icon into `canvas` from now on. The canvas is sized to its box each frame
     * and its box gets `data-charm-icon="live"` once the first frame lands.
     * @param {HTMLCanvasElement} canvas
     * @param {string} charmId
     * @param {{ state?: string }} [options]
     * @returns {{ setState(state: string): void, release(): void } | null}
     */
    mount(canvas, charmId, { state = 'ready' } = {}) {
        if (!canvas || !ODYSSEY_CHARM_ICON_IDS.includes(charmId) || this.disposed) return null;
        const context = canvas.getContext?.('2d');
        if (!context) return null;
        const slot = {
            canvas, context, id: charmId, state, drawn: false, seen: false, mountedAt: this._now(),
        };
        this.slots.add(slot);
        if (this.resizeObserver) {
            this.slotByCanvas.set(canvas, slot);
            this.resizeObserver.observe(canvas);
        }
        this.needsFrame = true;
        if (!this.ready && !this.failed) this.init().catch(() => {});
        this.start();
        return {
            setState: (next) => {
                if (slot.state === next) return;
                slot.state = next;
                slot.drawn = false;
                this.needsFrame = true;
                this.start();
            },
            release: () => this._release(slot),
        };
    }

    _release(slot) {
        if (!this.slots.delete(slot)) return;
        this.resizeObserver?.unobserve(slot.canvas);
        markLive(slot, false);
        if (!this.slots.size) this.stop();
    }

    _now() {
        return globalThis.performance?.now?.() || 0;
    }

    /**
     * The slots to draw this frame: attached, laid out and showing, each at its box's device
     * pixel size, side by side in the stage's canvas. Slots whose canvas has left the document
     * are released here; one never attached is forgotten after ORPHAN_MS.
     */
    _tiles(now) {
        const ratio = Math.min(this.pixelRatio || globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const tiles = [];
        let x = 0;
        [...this.slots].forEach((slot) => {
            const { canvas } = slot;
            const connected = canvas.isConnected !== false;
            if (connected) slot.seen = true;
            else if (slot.seen || now - slot.mountedAt > ORPHAN_MS) {
                this._release(slot);
                return;
            } else return;
            // The observed box (a first report arrives within a frame of mounting), else a read.
            const rect = this.resizeObserver ? slot.box : canvas.getBoundingClientRect?.();
            if (!rect || !rect.width || !rect.height) return;
            const width = Math.max(1, Math.round(rect.width * ratio));
            const height = Math.max(1, Math.round(rect.height * ratio));
            tiles.push({
                slot, x, width, height,
            });
            x += width;
        });
        return tiles;
    }

    /** One frame: every showing slot's icon, through its tile, into its canvas. */
    frame(now = this._now()) {
        if (!this.ready || !this.renderer || this.disposed) return;
        if (this.lastNow !== null) this.clock += Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
        this.lastNow = now;
        const tiles = this._tiles(now);
        if (this.reducedMotion) {
            const due = tiles.filter(({ slot }) => !slot.drawn);
            if (!due.length) {
                this.needsFrame = false;
                return;
            }
            tiles.length = 0;
            let x = 0;
            due.forEach((tile) => {
                tiles.push({ ...tile, x });
                x += tile.width;
            });
        }
        if (!tiles.length) {
            this.needsFrame = false;
            return;
        }
        const width = tiles.reduce((sum, tile) => sum + tile.width, 0);
        const height = tiles.reduce((max, tile) => Math.max(max, tile.height), 0);
        const { renderer, camera } = this;
        try {
            if (width !== this.size.width || height !== this.size.height) {
                this.size = { width, height };
                renderer.setSize(width, height, false);
            }
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, width, height);
            renderer.clear();
            renderer.setScissorTest(true);
            tiles.forEach((tile) => {
                const { slot } = tile;
                const icon = this.icons.get(slot.id);
                icon.setState(slot.state);
                icon.update(this.clock);
                const { x } = icon.group.position;
                const aspect = tile.width / tile.height;
                const h = ODYSSEY_CHARM_ICON_HALF_EXTENT;
                camera.left = -h * aspect;
                camera.right = h * aspect;
                camera.updateProjectionMatrix();
                camera.position.set(x, 1.35, 7);
                camera.lookAt(x, -0.12, 0);
                // r186's viewport origin is the TOP-left corner on both backends (the WebGL backend
                // flips it to GL's bottom-left itself), so a tile's rectangle is also its source
                // rectangle for the copy below.
                renderer.setViewport(tile.x, 0, tile.width, tile.height);
                renderer.setScissor(tile.x, 0, tile.width, tile.height);
                renderer.render(this.scene, camera);
            });
            renderer.setScissorTest(false);
            tiles.forEach((tile) => {
                const { slot } = tile;
                if (slot.canvas.width !== tile.width) slot.canvas.width = tile.width;
                if (slot.canvas.height !== tile.height) slot.canvas.height = tile.height;
                slot.context.clearRect(0, 0, tile.width, tile.height);
                slot.context.drawImage(renderer.domElement, tile.x, 0, tile.width, tile.height, 0, 0, tile.width, tile.height);
                if (!slot.drawn) markLive(slot, true);
                slot.drawn = true;
            });
        } catch (error) {
            console.warn('[OdysseyCharmIcons] frame failed; the slots keep their glyphs:', error?.message || error);
            this._lose();
            return;
        }
        this.needsFrame = false;
    }

    /**
     * The loop: 30 frames a second while slots exist and the page is visible. Under reduced
     * motion it only looks, a few times a second, for slots that still need their one frame.
     */
    start() {
        if (this.disposed || !this.ready || !this.slots.size) return;
        if (this.frameHandle !== null || typeof requestAnimationFrame === 'undefined') return;
        const tick = (now) => {
            this.frameHandle = null;
            if (this.disposed || !this.ready || !this.slots.size) return;
            const interval = this.reducedMotion ? STILL_POLL_MS : FRAME_MS;
            if (!globalThis.document?.hidden && now - this.lastFrameAt >= interval) {
                this.lastFrameAt = now;
                this.frame(now);
            } else if (globalThis.document?.hidden) {
                this.lastNow = null;
            }
            if (!this.disposed && this.ready && this.slots.size) this.frameHandle = requestAnimationFrame(tick);
        };
        this.frameHandle = requestAnimationFrame(tick);
    }

    stop() {
        if (this.frameHandle !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frameHandle);
        this.frameHandle = null;
        this.lastNow = null;
    }

    /** A lost device: keep the glyphs from now on. */
    _lose() {
        const { renderer } = this;
        this.ready = false;
        this.failed = true;
        this.stop();
        this.renderer = null;
        this.slots.forEach((slot) => {
            markLive(slot, false);
            slot.drawn = false;
        });
        if (renderer) Promise.resolve(renderer.dispose()).catch(() => {});
    }

    getDiagnostics() {
        return {
            backend: this.backend, ready: this.ready, icons: [...this.icons.keys()], slots: this.slots.size,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.stop();
        this.ready = false;
        this.resizeObserver?.disconnect();
        this.slots.forEach((slot) => markLive(slot, false));
        this.slots.clear();
        this.icons.forEach((icon) => icon.dispose());
        this.icons.clear();
        this.lights?.dispose();
        this.lights = null;
        this.studio?.dispose();
        this.studio = null;
        const { renderer } = this;
        this.renderer = null;
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

/** The session's one stage, built on first use. */
let sharedStage = null;

export function getOdysseyCharmIconStage() {
    if (!sharedStage || sharedStage.disposed) sharedStage = new OdysseyCharmIconStage();
    return sharedStage;
}

/** Tests and teardown: let the shared stage go. */
export function disposeOdysseyCharmIconStage() {
    sharedStage?.dispose();
    sharedStage = null;
}

/**
 * The HUD tray's view of the stage: a canvas in each chip's icon slot, the chips' states passed
 * through, released with the HUD.
 */
export class OdysseyCharmIconTray {
    /**
     * @param {object} options
     * @param {HTMLElement} options.list the chip list
     * @param {string} [options.slotSelector] how a chip's icon slot is found
     * @param {boolean} [options.reducedMotion] one frame per state change instead of a loop
     * @param {OdysseyCharmIconStage} [options.stage]
     */
    constructor({
        list, slotSelector = '.charm-chip__icon', reducedMotion = false, stage = null,
    }) {
        this.list = list;
        this.slotSelector = slotSelector;
        this.reducedMotion = reducedMotion;
        this.stage = stage;
        this.handles = new Map();
        this.pendingStates = new Map();
        this.mounted = false;
        this.disposed = false;
    }

    /** Put a canvas in each chip once; resolves true when icons can be drawn. */
    async init() {
        if (this.disposed || !this.list || typeof document === 'undefined') return false;
        const stage = this.stage || (this.stage = getOdysseyCharmIconStage());
        if (!this.mounted) {
            this.mounted = true;
            stage.setReducedMotion(this.reducedMotion);
            this.list.querySelectorAll?.('.charm-chip').forEach((chip) => {
                const id = chip.dataset?.charm;
                const slot = chip.querySelector?.(this.slotSelector);
                if (!id || !slot || this.handles.has(id)) return;
                const canvas = document.createElement('canvas');
                canvas.className = 'charm-chip__canvas';
                canvas.setAttribute?.('aria-hidden', 'true');
                slot.appendChild(canvas);
                const handle = stage.mount(canvas, id, { state: this.pendingStates.get(id) || 'ready' });
                if (handle) this.handles.set(id, handle);
                else canvas.remove?.();
            });
        }
        const ready = await stage.init();
        return ready && !this.disposed;
    }

    /** Each charm's chip state, from the tray's view. @param {Record<string, string>} states */
    setStates(states) {
        Object.entries(states || {}).forEach(([id, state]) => {
            this.pendingStates.set(id, state);
            this.handles.get(id)?.setState(state);
        });
    }

    getDiagnostics() {
        return this.stage?.getDiagnostics() || {
            backend: null, ready: false, icons: [], slots: 0,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.handles.forEach((handle) => handle.release());
        this.handles.clear();
    }
}

/**
 * A charm's icon for a sheet or the map: a box holding the canvas the shared stage draws into
 * and the glyph it shows until the first frame (and for good without a renderer).
 * @param {string} charmId
 * @param {{ className?: string, state?: string, stage?: OdysseyCharmIconStage }} [options]
 * @returns {HTMLElement | null}
 */
export function createOdysseyCharmIconNode(charmId, {
    className = 'charm-sprite', state = 'ready', stage = null,
} = {}) {
    const doc = globalThis.document;
    if (!doc?.createElement) return null;
    const node = doc.createElement('span');
    node.className = className;
    if (node.dataset) node.dataset.charm = charmId;
    node.setAttribute?.('aria-hidden', 'true');
    // The glyph itself is CSS (`::before`), so the charm's name reads clean in the text around it.
    const glyph = doc.createElement('span');
    glyph.className = `${className}__glyph`;
    const canvas = doc.createElement('canvas');
    canvas.className = `${className}__canvas`;
    node.appendChild(canvas);
    node.appendChild(glyph);
    const handle = (stage || getOdysseyCharmIconStage()).mount(canvas, charmId, { state });
    if (handle) node.charmIcon = handle;
    return node;
}
