/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The ascent sky's own renderer: three r186 WebGPURenderer on WebGPU, on its WebGL2 backend where
 * WebGPU is missing or fails to start (the ladder the themes and the breathing guide climb down),
 * and a CSS veil where neither starts.
 *
 * Renderer kind (ADR-0008): WebGPU-primary node scene with the WebGL2 compatibility backend; it
 * replaces the classic-WebGL CosmicExplorationEffect (two renderers, a composer, bloom).
 *
 * The canvas is laid between the theme and the board (fixed, z-index -1 after the theme layer, so
 * it wins on document order) and is transparent: the theme shows through wherever the sky does
 * not cover it. It is built when Infinity starts, one hidden frame compiles its single pipeline
 * off the compositor thread, and it is drawn only while the player looks around (the director
 * calls draw()); at rest it is hidden and costs nothing.
 */
import * as THREE from 'three/webgpu';
import { AscentSkyWorld, SKY_TIERS } from './ascent-sky-world.js';
import { beginAsyncRenderPipelines, preloadAsyncRenderPipelines } from '../../../rendering/async-render-pipelines.js';
import { eventBus, EVENTS } from '../../../events/event-bus.js';

const INIT_TIMEOUT_MS = 6000;
const SETTLE_MS = 8000;

function wantsWebGL() {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const forced = params.has('forceWebGL')
        && ['', '1', 'true', 'yes', 'on'].includes((params.get('forceWebGL') || '').toLowerCase());
    return forced || !globalThis.navigator?.gpu;
}

/** @param {boolean} forceWebGL */
async function initRenderer(forceWebGL) {
    const renderer = new THREE.WebGPURenderer({ antialias: false, alpha: true, forceWebGL });
    let timer;
    try {
        await Promise.race([
            renderer.init(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('renderer init timed out')), INIT_TIMEOUT_MS);
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

/** The quality setting's name → a sky tier. @param {string} quality */
export function skyTierFor(quality) {
    const q = String(quality || 'High').toLowerCase();
    if (q === 'low' || q === 'minimal' || q === 'potato') return 'Low';
    if (q === 'medium') return 'Medium';
    return 'High';
}

export class AscentSkyStage {
    /** @param {{quality?: string}} [options] */
    constructor({ quality = 'High' } = {}) {
        this.name = 'infinity-ascent';
        this.tierName = skyTierFor(quality);
        this.renderer = null;
        this.scene = null;
        this.world = null;
        this.backend = null;
        this.container = null;
        this.css = null;
        this.disposed = false;
        this.visible = false;
        this.ready = false;
        this.initPromise = null;
        this.size = { width: 0, height: 0 };
        this._unsubscribeResize = null;
    }

    /** Build once. Resolves when the sky can be drawn (WebGPU, WebGL2 or the CSS veil). */
    init() {
        if (!this.initPromise) this.initPromise = this._init();
        return this.initPromise;
    }

    async _init() {
        if (typeof document === 'undefined') return false;
        const container = document.createElement('div');
        container.className = 'ia-sky';
        container.setAttribute('aria-hidden', 'true');
        const themeLayer = document.querySelector('.background-container');
        if (themeLayer?.parentNode) themeLayer.parentNode.insertBefore(container, themeLayer.nextSibling);
        else document.body.appendChild(container);
        this.container = container;
        this._unsubscribeResize = eventBus.on(EVENTS.VIEWPORT_RESIZED, () => this.resize());

        const forceWebGL = wantsWebGL();
        let renderer = null;
        try {
            renderer = await initRenderer(forceWebGL);
        } catch (error) {
            if (!forceWebGL) {
                console.warn('[AscentSky] WebGPU unavailable, using the WebGL2 backend:', error?.message || error);
                try {
                    renderer = await initRenderer(true);
                } catch (fallbackError) {
                    const why = fallbackError?.message || fallbackError;
                    console.warn('[AscentSky] no renderer, using the CSS veil:', why);
                }
            } else {
                console.warn('[AscentSky] no renderer, using the CSS veil:', error?.message || error);
            }
        }
        if (this.disposed) {
            if (renderer) Promise.resolve(renderer.dispose()).catch(() => {});
            return false;
        }
        if (!renderer) {
            this._useCss();
            return true;
        }
        this.renderer = renderer;
        this.backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
        renderer.toneMapping = THREE.NoToneMapping;
        // The sky is authored in display values: no output conversion.
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        renderer.setClearColor(0x000000, 0);
        const canvas = renderer.domElement;
        canvas.className = 'ia-sky__canvas';
        container.appendChild(canvas);
        this.scene = new THREE.Scene();
        this.world = new AscentSkyWorld({ quality: this.tierName }).build(this.scene);
        this.resize();
        renderer.backend?.device?.lost?.then(() => {
            if (this.renderer === renderer) this._handleLost();
        });
        canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            this._handleLost();
        });
        // One hidden frame compiles the pipeline off the compositor thread.
        if (this.backend === 'webgpu') await preloadAsyncRenderPipelines(() => Promise.resolve(THREE)).catch(() => {});
        const session = this.backend === 'webgpu'
            ? beginAsyncRenderPipelines(this, { label: 'infinity-ascent' }) : null;
        try {
            this._render();
            if (session) await session.settle({ maxMs: SETTLE_MS, quietFrames: 2 });
        } finally {
            session?.end();
        }
        this.ready = !this.disposed;
        return this.ready;
    }

    /** No renderer: two CSS gradients stand in for the night and the depths. */
    _useCss() {
        this.backend = 'css';
        const night = document.createElement('div');
        night.className = 'ia-sky__css-night';
        const deep = document.createElement('div');
        deep.className = 'ia-sky__css-deep';
        this.container.append(night, deep);
        this.css = { night, deep };
        this.ready = true;
    }

    /** @param {{glow?: number[], night?: number[], ground?: number[], mote?: number[]}} tints */
    setTints(tints) {
        this.world?.setTints(tints);
        if (this.css && tints) {
            const rgb = (c, fallback) => (Array.isArray(c) ? `${c[0]}, ${c[1]}, ${c[2]}` : fallback);
            this.container.style.setProperty('--ia-glow-rgb', rgb(tints.glow, '104, 116, 168'));
            this.container.style.setProperty('--ia-night-rgb', rgb(tints.night, '8, 9, 24'));
            this.container.style.setProperty('--ia-ground-rgb', rgb(tints.ground, '26, 22, 44'));
        }
    }

    /**
     * Draw the sky of the moment (or hide it when there is none).
     * @param {Parameters<AscentSkyWorld['setState']>[0]} state
     */
    draw(state) {
        if (!this.container || this.disposed) return;
        const shown = (state.presence || 0) > 0.002;
        if (shown !== this.visible) {
            this.visible = shown;
            this.container.classList.toggle('is-shown', shown);
        }
        if (!shown) return;
        if (this.css) {
            this.container.style.setProperty('--ia-presence', String(state.presence));
            this.container.style.setProperty('--ia-sky', String(state.sky || 0));
            this.container.style.setProperty('--ia-deep', String(state.deep || 0));
            return;
        }
        if (!this.ready || !this.world) return;
        this.world.setState(state);
        this._render();
    }

    _render() {
        if (!this.renderer || !this.world) return;
        try {
            this.renderer.render(this.scene, this.world.camera);
        } catch (error) {
            console.warn('[AscentSky] frame failed:', error?.message || error);
            this._handleLost();
        }
    }

    resize() {
        if (!this.container) return;
        const width = window.innerWidth || this.container.clientWidth;
        const height = window.innerHeight || this.container.clientHeight;
        if (!width || !height) return;
        this.size = { width, height };
        this.world?.setViewport(width, height);
        if (!this.renderer) return;
        const cap = SKY_TIERS[this.tierName]?.pixelRatio ?? 1;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
        this.renderer.setSize(width, height, false);
    }

    /** A lost device: keep the CSS veil from now on. */
    _handleLost() {
        if (this.disposed || this.css) return;
        const { renderer } = this;
        this.renderer = null;
        this.world?.dispose();
        this.world = null;
        if (renderer) {
            renderer.domElement.remove();
            Promise.resolve(renderer.dispose()).catch(() => {});
        }
        this._useCss();
    }

    getDiagnostics() {
        return {
            backend: this.backend, ready: this.ready, visible: this.visible, tier: this.tierName,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this._unsubscribeResize?.();
        this._unsubscribeResize = null;
        this.world?.dispose();
        this.world = null;
        const { renderer } = this;
        this.renderer = null;
        if (renderer) {
            renderer.domElement.remove();
            // r186: the device must not be released before disposal settles.
            Promise.resolve(renderer.dispose()).catch((error) => {
                console.warn('[AscentSky] renderer dispose failed:', error?.message || error);
            });
        }
        this.container?.remove();
        this.container = null;
        this.css = null;
        this.scene = null;
    }
}
