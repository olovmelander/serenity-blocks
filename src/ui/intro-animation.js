/**
 * @fileoverview Epic intro animation for SERENITY BLOCKS
 * Features cosmic particle effects, nebula clouds, stardust, 3D transforms, and galaxy colors
 * Uses WebGPU renderer with TSL shaders when available, falls back to WebGL
 */

import { INTRO_PHASES } from './intro-visual-config.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

const INTRO_TETROMINO_BLOCKED_POINTER_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'label[for]',
    'summary',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="switch"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="link"]',
    '[data-cursor-interactive="true"]',
    '.game-mode-card',
    '.main-menu-player-card',
    '.floating-settings-btn',
    '.serenity-hub-icon',
    '.replays-icon',
    '.highscores-icon',
    '.cosmic-select__trigger',
    '.cosmic-select__option',
    '.cosmic-select__listbox',
    '.cosmic-segmented__seg',
].join(', ');

function isElementVisible(element) {
    if (!element) return false;
    const style = typeof window !== 'undefined'
        ? window.getComputedStyle?.(element)
        : null;
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    return element.getClientRects?.().length > 0;
}

function hasBlockingIntroModal() {
    if (typeof document === 'undefined') return false;
    if (document.body?.classList.contains('serenity-hub-open')) return true;

    const modals = document.querySelectorAll('.modal.visible, [role="dialog"].visible');
    return Array.from(modals).some((modal) => modal.id !== 'start-modal' && isElementVisible(modal));
}

export class IntroAnimation {
    constructor() {
        this.container = null;
        this.isActive = false;
        this.isAnimating = false;
        this.hasCompleted = false;
        this.boundHandlers = {};
        this.soundManager = null;
        this.introMusicTrack = 'CosmicChimes';
        this.isLoadingMasked = false;
        this.loadingIndicator = null;
        this.loadingPromise = null;
        this.loadingPromiseLabel = 'LOADING ASSETS';
        this.smoothedAudioPulse = 0;
        this.dismissPromise = null;

        // Three.js Renderer
        this.threeCanvas = null;
        this.threeRenderer = null;
        this.animationFrameId = null;
        this.boundAnimate = this.animate.bind(this);
        this.phaseTimers = [];
        this.lastTitleBoundsSync = 0;
        // Title-bounds sync settling: the 3D title glow only needs the wordmark's rect while
        // the title is animating (intro reveal + shrink-to-logo). Once it stops moving, its rect
        // is static, so we stop the per-frame getBoundingClientRect() — that read (landing after
        // the cursor/renderer dirty layout each frame) forced a synchronous reflow every frame on
        // the idle menu. Re-armed by scheduleMenuLogoLayoutUpdate() on any layout-affecting event.
        this._titleBoundsSettled = false;
        this._lastTitleRect = null;
        this._titleStableCount = 0;
        this.currentPhase = INTRO_PHASES.BOOT;
        this.menuBgReady = false;
        this.menuLayoutRaf = null;
        this.menuLayoutTrackingInstalled = false;
        this.menuLayoutResizeObserver = null;
        this.menuLayoutObservedElement = null;
        this.tetrominoPointerListenerInstalled = false;
        this.boundMenuLayoutUpdate = this.scheduleMenuLogoLayoutUpdate.bind(this);
        this.boundMenuModalChange = this.handleMenuModalChange.bind(this);
        this.boundIntroTetrominoPointerDown = this.handleIntroTetrominoPointerDown.bind(this);
        const params = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        this.flags = {
            // Keep v2 on by default for active development, allow explicit opt-out.
            introV2: params.get('introV2') !== '0',
        };
    }

    /**
     * Initialize and show the intro animation
     * @returns {Promise<void>} Resolves when user dismisses the intro
     */
    async show(soundManager = null, options = {}) {
        if (this.hasCompleted) {
            return Promise.resolve();
        }

        if (soundManager) {
            this.setSoundManager(soundManager);
        }

        this.ensureIntroMusic();

        this.menuBgReady = false;
        this.clearPhaseTimers();
        this.isActive = true;
        this.isAnimating = true;
        // When deferred, hold the "SERENITY BLOCKS" title hidden + un-animated until
        // revealTitle() — used so the boot warp transition plays out FIRST and the
        // title's reveal animation plays fresh afterwards, not wasted behind the warp.
        this.titleDeferred = options.deferTitle === true;
        this.titleRevealed = !this.titleDeferred;
        // "Press any key / click / tap to begin" is LOCKED until the title reveals, so the
        // boot transition can't be skipped before "SERENITY BLOCKS" appears; the prompt +
        // interaction then unlock IN SYNC with the title. Non-deferred intros allow it
        // immediately, as before.
        this.interactionEnabled = !this.titleDeferred;
        // Readiness gate: resolves once initRenderer() has settled (WebGPU device created,
        // or WebGL fallback, or failure) so callers can reliably read getWebGPUDevice()
        // BEFORE deciding whether the boot warp can share the intro's device. Without this,
        // a cold/slow WebGPU init that outruns the 1500ms boot race leaves getWebGPUDevice()
        // null → the warp makes a 3rd context → blank on heavy themes.
        this._rendererReadyResolve = null;
        this.rendererReady = new Promise((resolve) => { this._rendererReadyResolve = resolve; });
        // Safety net: never let a deferred title stay hidden if the external reveal trigger
        // is somehow missed (warp error, etc.). Armed HERE, in show()'s synchronous prefix,
        // NOT after createIntroHTML — the boot flow calls postponeTitleSafety() while
        // createIntroHTML may still be awaiting a cold renderer init, and re-arming the
        // 4500ms default afterwards would silently CLOBBER that postpone (title +
        // PRESS-ANY-KEY would then unlock behind the opaque ident/warp on a cold first
        // run). Arming synchronously guarantees any later postpone is the last writer.
        // A too-early 'safety' fire is harmless: revealTitle before the DOM exists makes
        // createIntroHTML build the title visible (state-aware hold classes).
        this.clearTitleRevealSafety();
        if (this.titleDeferred) {
            this._titleRevealSafety = setTimeout(() => this.revealTitle('safety'), 4500);
        }
        await this.createIntroHTML();
        if (options.signal?.aborted || this.hasCompleted) {
            this.skip();
            return Promise.resolve();
        }
        this.setupEventListeners();

        this.setRendererPhase(INTRO_PHASES.BOOT, true);
        this.schedulePhase(INTRO_PHASES.REVEAL, 220);
        this.schedulePhase(INTRO_PHASES.IDLE, 1900);

        // Start animation loop
        this.startRenderLoop();

        this.startAnimations();

        // Return a promise that resolves when the intro is dismissed
        return new Promise((resolve) => {
            this.onComplete = resolve;
        });
    }

    /**
     * Play the deferred "SERENITY BLOCKS" title reveal now. Idempotent — safe to call
     * from any handoff branch (and a safety timer). The WebGPU path calls this once its
     * five-second visible contract is met, letting the title resolve during the nebula
     * arrival and continue through the canvas crossfade.
     */
    revealTitle(source = 'manual') {
        if (this.titleRevealed) {
            return;
        }
        this.titleRevealed = true;
        this.clearTitleRevealSafety();
        performanceMonitor.recordEvent('startup_intro_title_revealed', { source });
        const titleContainer = this.container?.querySelector('.intro-title-container');
        if (titleContainer) {
            titleContainer.classList.remove('intro-title-hold');
            // Force a reflow so the (previously animation:none) reveal restarts from 0%.
            this._titleReflow = titleContainer.offsetWidth;
        }

        // Reveal the "PRESS ANY KEY" prompt + unlock interaction WITH the title (the theme is
        // warmed BEFORE the warp now, so there's nothing to gate on).
        this.enableInteraction();
    }

    /**
     * Push the deferred-title safety timer out to `ms` from now. Called by the boot
     * flow once the warp transition is COMMITTED: on a cold first run the warp's
     * prewarm compile can exceed the default 4500ms safety, which would otherwise
     * reveal the title + unlock "PRESS ANY KEY" behind the still-opaque warp canvas
     * (wasted reveal animation + invisible intro dismissal on a stray keypress).
     * The warp path reveals explicitly at p>=0.9 and again after the handoff, so the
     * postponed timer is purely the stalled-warp backstop.
     * @param {number} ms
     */
    postponeTitleSafety(ms) {
        if (this.titleRevealed) return;
        this.clearTitleRevealSafety();
        this._titleRevealSafety = setTimeout(() => this.revealTitle('postponed-safety'), ms);
        performanceMonitor.recordEvent('startup_intro_title_safety_postponed', { ms });
    }

    clearTitleRevealSafety() {
        if (this._titleRevealSafety) {
            clearTimeout(this._titleRevealSafety);
            this._titleRevealSafety = null;
        }
    }

    resolveRendererReady() {
        this._rendererReadyResolve?.();
        this._rendererReadyResolve = null;
    }

    /**
     * Unlock begin-interaction and reveal the "PRESS ANY KEY" prompt in sync with the
     * title. Idempotent.
     */
    enableInteraction() {
        if (this.interactionEnabled) {
            return;
        }
        this.interactionEnabled = true;
        const prompt = this.container?.querySelector('.intro-prompt.intro-prompt-hold');
        if (prompt) {
            prompt.classList.remove('intro-prompt-hold');
            // Reflow, then run the no-delay reveal so the prompt fades in WITH the title
            // (its base rule has a 3s animation-delay that would otherwise hold it back).
            this._promptReflow = prompt.offsetWidth;
            prompt.classList.add('intro-prompt-shown');
        }
    }

    /**
     * Animation loop for Three.js renderer
     */
    animate(time) {
        if (!this.isAnimating) {
            this.animationFrameId = null;
            return;
        }

        // Pass time in seconds
        if (this.threeRenderer) {
            const pulse = this.getMusicPulse();
            this.threeRenderer.setAudioPulse?.(pulse);
            this.threeRenderer.update(typeof time === 'number' ? time / 1000 : undefined);
            const menuLogoActive = Boolean(this.container?.querySelector('.intro-title-container.shrink-to-logo'));
            if (this.isActive || this.container?.classList?.contains('background-only') || menuLogoActive) {
                this.syncTitleBounds(time);
            }
        }

        this.animationFrameId = requestAnimationFrame(this.boundAnimate);
    }

    startRenderLoop() {
        if (this.animationFrameId !== null) return;
        this.animationFrameId = requestAnimationFrame(this.boundAnimate);
    }

    handleMenuModalChange(event) {
        if (event?.detail?.modalName === 'start') {
            this.scheduleMenuLogoLayoutUpdate();
        }
    }

    setupMenuLogoLayoutTracking() {
        if (this.menuLayoutTrackingInstalled || typeof window === 'undefined') {
            return;
        }

        window.addEventListener('resize', this.boundMenuLayoutUpdate, { passive: true });
        window.addEventListener('modalShown', this.boundMenuModalChange);
        window.addEventListener('modalHidden', this.boundMenuModalChange);
        this.menuLayoutTrackingInstalled = true;
        this.refreshMenuLogoLayoutObserver();
        this.scheduleMenuLogoLayoutUpdate();
    }

    teardownMenuLogoLayoutTracking() {
        if (this.menuLayoutRaf !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.menuLayoutRaf);
            this.menuLayoutRaf = null;
        }

        if (this.menuLayoutResizeObserver) {
            this.menuLayoutResizeObserver.disconnect();
            this.menuLayoutResizeObserver = null;
            this.menuLayoutObservedElement = null;
        }

        if (this.menuLayoutTrackingInstalled && typeof window !== 'undefined') {
            window.removeEventListener('resize', this.boundMenuLayoutUpdate);
            window.removeEventListener('modalShown', this.boundMenuModalChange);
            window.removeEventListener('modalHidden', this.boundMenuModalChange);
            this.menuLayoutTrackingInstalled = false;
        }
    }

    refreshMenuLogoLayoutObserver() {
        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const cardsContainer = document.querySelector('.game-mode-cards-container');
        if (this.menuLayoutObservedElement === cardsContainer) {
            return;
        }

        if (this.menuLayoutResizeObserver) {
            this.menuLayoutResizeObserver.disconnect();
        }

        this.menuLayoutObservedElement = cardsContainer;
        if (!cardsContainer) {
            this.menuLayoutResizeObserver = null;
            return;
        }

        this.menuLayoutResizeObserver = new ResizeObserver(() => {
            this.scheduleMenuLogoLayoutUpdate();
        });
        this.menuLayoutResizeObserver.observe(cardsContainer);
    }

    scheduleMenuLogoLayoutUpdate() {
        // Any layout-affecting event (resize, modal open/close, cards ResizeObserver, or the
        // shrink-to-logo transition) can move/resize the title, so re-arm the per-frame
        // title-bounds sync until it settles again.
        this._titleBoundsSettled = false;
        this._titleStableCount = 0;
        if (typeof requestAnimationFrame !== 'function') {
            this.updateMenuLogoLayout();
            return;
        }

        if (this.menuLayoutRaf !== null) {
            cancelAnimationFrame(this.menuLayoutRaf);
        }

        this.menuLayoutRaf = requestAnimationFrame(() => {
            this.menuLayoutRaf = null;
            this.updateMenuLogoLayout();
        });
    }

    updateMenuLogoLayout() {
        this.refreshMenuLogoLayoutObserver();

        const titleContainer = this.container?.querySelector('.intro-title-container.shrink-to-logo');
        if (!titleContainer) {
            return;
        }

        if (!document.body.classList.contains('start-modal-open')) {
            titleContainer.style.removeProperty('--menu-logo-top');
            titleContainer.style.removeProperty('--menu-logo-scale');
            return;
        }

        const cardsContainer = document.querySelector('.game-mode-cards-container');
        const firstCard = cardsContainer?.querySelector('.game-mode-card');
        if (!cardsContainer || !firstCard) {
            return;
        }

        // The resting menu logo now renders at font-size = natural × --menu-logo-scale
        // (crisp vector glyphs, not a transform-downscaled bitmap). Neutralize that
        // scale to 1 before measuring, or we'd measure the already-shrunk wordmark and
        // the computed scale would drift smaller on every layout pass. Reading
        // offsetWidth forces a synchronous reflow, so the measurement reflects the
        // natural size; the real scale is reapplied below before the frame paints.
        const prevScale = titleContainer.style.getPropertyValue('--menu-logo-scale');
        titleContainer.style.setProperty('--menu-logo-scale', '1');
        const naturalWidth = titleContainer.offsetWidth;
        const naturalHeight = titleContainer.offsetHeight;
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            // Restore the prior scale so a transient zero-size measurement can't leave
            // the wordmark stuck at full (unscaled) size.
            if (prevScale) titleContainer.style.setProperty('--menu-logo-scale', prevScale);
            else titleContainer.style.removeProperty('--menu-logo-scale');
            return;
        }

        const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
        const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0);
        const firstCardTop = firstCard.getBoundingClientRect().top;

        const sidePadding = Math.max(16, Math.round(viewportWidth * 0.02));
        const topPadding = Math.max(6, Math.min(18, viewportHeight * 0.018));
        const bottomGap = Math.max(6, Math.min(12, viewportHeight * 0.012));

        const availableWidth = Math.max(120, viewportWidth - sidePadding * 2);
        const availableHeight = Math.max(24, firstCardTop - topPadding - bottomGap);
        const maxScale = 0.42;
        const scale = Math.max(
            0.12,
            Math.min(
                maxScale,
                availableWidth / naturalWidth,
                availableHeight / naturalHeight,
            ),
        );

        const scaledHeight = naturalHeight * scale;
        const preferredTop = topPadding + Math.max(0, (availableHeight - scaledHeight) * 0.5);
        const maxTop = Math.max(topPadding, firstCardTop - scaledHeight - bottomGap);
        const resolvedTop = Math.min(preferredTop, maxTop);

        titleContainer.style.setProperty('--menu-logo-top', `${Math.round(resolvedTop)}px`);
        titleContainer.style.setProperty('--menu-logo-scale', scale.toFixed(4));

        this.lastTitleBoundsSync = 0;
        this.syncTitleBounds(performance.now());
    }

    emitPhaseChanged(phase) {
        this.currentPhase = phase;
        window.dispatchEvent(new CustomEvent('intro:phaseChanged', {
            detail: { phase },
        }));
    }

    setRendererPhase(phase, immediate = false) {
        this.threeRenderer?.setPhase?.(phase, immediate);
        this.emitPhaseChanged(phase);

        if (phase === INTRO_PHASES.MENU_BG) {
            this.menuBgReady = true;
            window.dispatchEvent(new CustomEvent('intro:menuBgReady', {
                detail: { phase },
            }));
        }
    }

    clearPhaseTimers() {
        this.phaseTimers.forEach((timerId) => clearTimeout(timerId));
        this.phaseTimers.length = 0;
    }

    schedulePhase(phase, delayMs) {
        const timerId = setTimeout(() => {
            this.setRendererPhase(phase);
        }, delayMs);
        this.phaseTimers.push(timerId);
    }

    syncTitleBounds(timeMs = performance.now()) {
        if (!this.threeRenderer?.setTitleBounds || !this.container) return;
        // Once the title has settled (menu idle / logo at rest) its rect is static, so stop
        // reading layout every frame — that per-frame getBoundingClientRect(), landing right
        // after the cursor/renderer dirty layout, forced a synchronous reflow on every frame.
        // scheduleMenuLogoLayoutUpdate() re-arms this on resize/modal/observer/shrink so the
        // glow keeps tracking the wordmark smoothly whenever it actually moves.
        if (this._titleBoundsSettled) return;
        // Sync ~every frame while animating so the renderer's title glow tracks the wordmark
        // smoothly during the fast shrink-to-logo move (a coarse throttle made the glow lag).
        if (timeMs - this.lastTitleBoundsSync < 16) return;

        const titleContainer = this.container.querySelector('.intro-title-container');
        if (!titleContainer) return;
        const rect = titleContainer.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        this.threeRenderer.setTitleBounds({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
        });
        this.lastTitleBoundsSync = timeMs;

        // Settle detection: when the rect stops changing between syncs the title has finished
        // moving, so after a few stable frames we stop the per-frame reads (until re-armed).
        const last = this._lastTitleRect;
        const stable = last
            && Math.abs(last.x - rect.left) < 0.5 && Math.abs(last.y - rect.top) < 0.5
            && Math.abs(last.w - rect.width) < 0.5 && Math.abs(last.h - rect.height) < 0.5;
        if (stable) {
            this._titleStableCount += 1;
            if (this._titleStableCount >= 6) this._titleBoundsSettled = true;
        } else {
            this._titleStableCount = 0;
            this._lastTitleRect = {
                x: rect.left,
                y: rect.top,
                w: rect.width,
                h: rect.height,
            };
        }
    }

    waitForMenuBgReady(timeoutMs = 2200) {
        if (this.menuBgReady) return Promise.resolve();

        return new Promise((resolve) => {
            let settled = false;
            let timerId = null;
            const done = () => {
                if (settled) return;
                settled = true;
                if (timerId !== null) clearTimeout(timerId);
                resolve();
            };
            const onReady = () => done();
            timerId = setTimeout(() => {
                window.removeEventListener('intro:menuBgReady', onReady);
                done();
            }, timeoutMs);
            window.addEventListener('intro:menuBgReady', onReady, { once: true });
        });
    }

    /**
     * Derive a simple beat pulse from current music playback time.
     * Returns a stable 0..1 envelope that can drive visual accents.
     */
    getMusicPulse() {
        const audioEl = this.soundManager?.audioElement;
        if (!audioEl || audioEl.paused || audioEl.ended) return 0;

        if (this.soundManager?.hasAudioAnalyzer?.() && this.soundManager?.getAudioAnalysis) {
            const analysis = this.soundManager.getAudioAnalysis(1 / 60);
            const weightedEnergy = (analysis.bassEnergy * 0.6)
                + (analysis.midEnergy * 0.25)
                + (analysis.trebleEnergy * 0.15);
            this.smoothedAudioPulse = this.smoothedAudioPulse * 0.78 + weightedEnergy * 0.22;
            const beatBoost = analysis.beatDetected ? 0.18 : 0;
            return Math.min(1, this.smoothedAudioPulse * 1.6 + beatBoost);
        }

        const t = audioEl.currentTime;
        const primary = Math.max(0, Math.sin(t * Math.PI * 2 * 1.85));
        const secondary = Math.max(0, Math.sin(t * Math.PI * 2 * 3.7));
        return Math.min(1, primary * 0.7 + secondary * 0.3);
    }

    setLoadingPromise(promise, label = 'LOADING ASSETS') {
        if (!promise || typeof promise.then !== 'function') {
            this.loadingPromise = null;
            return;
        }
        this.loadingPromiseLabel = label;
        this.loadingPromise = Promise.resolve(promise)
            .catch((error) => {
                console.error('[IntroAnimation] Loading promise failed:', error);
            })
            .finally(() => {
                this.loadingPromise = null;
            });
    }

    async waitForLoadingPromise() {
        if (!this.loadingPromise) return;
        await this.loadingPromise;
    }

    /**
     * Initialize the 3D renderer. Tries WebGPU first, falls back to WebGL.
     */
    replaceRendererCanvasForFallback(canvas) {
        if (!canvas || typeof document === 'undefined') {
            return canvas;
        }

        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.id = canvas.id || 'intro-webgl-canvas';
        if (canvas.style && fallbackCanvas.style) {
            fallbackCanvas.style.cssText = canvas.style.cssText;
            if (!fallbackCanvas.style.cssText) {
                fallbackCanvas.style.position = canvas.style.position || 'absolute';
                fallbackCanvas.style.top = canvas.style.top || '0';
                fallbackCanvas.style.left = canvas.style.left || '0';
                fallbackCanvas.style.width = canvas.style.width || '100%';
                fallbackCanvas.style.height = canvas.style.height || '100%';
                fallbackCanvas.style.zIndex = canvas.style.zIndex || '0';
            }
        }

        const parent = canvas.parentNode;
        if (parent?.replaceChild) {
            parent.replaceChild(fallbackCanvas, canvas);
        } else if (parent?.appendChild) {
            parent.appendChild(fallbackCanvas);
        }

        if (this.threeCanvas === canvas) {
            this.threeCanvas = fallbackCanvas;
        }
        performanceMonitor.recordEvent('startup_intro_renderer_canvas_replaced', {
            reason: 'webgpu-timeout',
        });
        return fallbackCanvas;
    }

    async initRenderer(canvas) {
        const initStartedAt = typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        const hasWebGPU = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
        let rendererCanvas = canvas;
        let fallbackReason = 'none';
        performanceMonitor.recordEvent('startup_intro_renderer_init_started', {
            introV2: this.flags.introV2,
            hasWebGPU,
        });

        // Keep a fallback path for rollout / regression checks.
        if (this.flags.introV2 && hasWebGPU) {
            let webgpuRenderer = null;
            try {
                const { default: WebGPURenderer } = await import('./threejs-intro-renderer-webgpu.js');
                webgpuRenderer = new WebGPURenderer(rendererCanvas);
                // Budget the init: a stalled requestAdapter/requestDevice would otherwise
                // hang createIntroHTML -> show() -> the whole boot at `await introPromise`.
                const initPromise = webgpuRenderer.init();
                let initTimedOut = false;
                let timeoutId = null;
                let success = false;
                try {
                    success = await Promise.race([
                        initPromise,
                        new Promise((resolve) => {
                            timeoutId = setTimeout(() => { initTimedOut = true; resolve(false); }, 10000);
                        }),
                    ]);
                } finally {
                    if (timeoutId !== null) {
                        clearTimeout(timeoutId);
                    }
                }
                if (initTimedOut) {
                    fallbackReason = 'webgpu-timeout';
                    rendererCanvas = this.replaceRendererCanvasForFallback(rendererCanvas);
                    // The orphaned init may still resolve later and would then hold a live
                    // GPUDevice + render loop for the whole session. Destroy it on arrival.
                    initPromise
                        .then(() => { webgpuRenderer.destroy?.(); })
                        .catch(() => { /* failed anyway - nothing live to clean */ });
                    performanceMonitor.recordEvent('startup_intro_renderer_webgpu_timeout', {
                        timeoutMs: 10000,
                    });
                    console.warn('[IntroAnimation] WebGPU init timed out, falling back to WebGL');
                }
                if (success) {
                    this.threeRenderer = webgpuRenderer;
                    this.isWebGPU = true;
                    this.threeRenderer.setVisualProfile?.('cinematic_clean');
                    performanceMonitor.recordEvent('startup_intro_renderer_init_completed', {
                        backend: 'webgpu',
                        durationMs: (typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now()) - initStartedAt,
                    });
                    console.log('[IntroAnimation] WebGPU renderer initialized');
                    return 'webgpu';
                }
                if (!initTimedOut) {
                    fallbackReason = 'webgpu-init-failed';
                    webgpuRenderer.destroy?.();
                }
            } catch (err) {
                fallbackReason = 'webgpu-exception';
                webgpuRenderer?.destroy?.();
                console.warn('[IntroAnimation] WebGPU init failed, falling back to WebGL:', err);
            }
        }

        try {
            const { default: ThreeJSIntroRenderer } = await import('./threejs-intro-renderer.js');
            const webglRenderer = new ThreeJSIntroRenderer(rendererCanvas);
            if (webglRenderer.init()) {
                this.threeRenderer = webglRenderer;
                this.isWebGPU = false;
                performanceMonitor.recordEvent('startup_intro_renderer_init_completed', {
                    backend: 'webgl',
                    fallbackReason,
                    durationMs: (typeof performance !== 'undefined' && performance.now
                        ? performance.now()
                        : Date.now()) - initStartedAt,
                });
                console.log('[IntroAnimation] WebGL renderer initialized (fallback)');
                return 'webgl';
            }

            webglRenderer.destroy?.();
            fallbackReason = 'webgl-init-failed';
        } catch (error) {
            fallbackReason = 'webgl-exception';
            console.warn('[IntroAnimation] WebGL fallback init failed:', error);
        }

        this.threeRenderer = null;
        this.isWebGPU = false;
        performanceMonitor.recordEvent('startup_intro_renderer_init_completed', {
            backend: 'failed',
            fallbackReason,
            durationMs: (typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now()) - initStartedAt,
        });
        return 'failed';
    }

    /**
     * Set the shared sound manager used for intro music
     * @param {?Object} soundManager
     */
    setSoundManager(soundManager) {
        this.soundManager = soundManager;
    }

    /**
     * The intro's live GPUDevice (or null on WebGL/uninited) — shared with the boot warp so
     * it doesn't create a 3rd WebGPU context (which blanked the warp when a heavy theme was
     * already warmed). See BootWarpTransition({ device }).
     * @returns {GPUDevice|null}
     */
    getWebGPUDevice() {
        return this.threeRenderer?.getDevice?.() || null;
    }

    /**
     * Ensure the intro music track is playing
     */
    ensureIntroMusic() {
        if (!this.soundManager) return;

        const trackKey = this.introMusicTrack;
        const hasTrackList = Array.isArray(this.soundManager.trackNames)
            && this.soundManager.trackNames.length > 0;

        if (hasTrackList && this.soundManager.trackNames.includes(trackKey)) {
            if (this.soundManager.musicTrack !== trackKey) {
                this.soundManager.setTrack(trackKey);
            } else if (typeof this.soundManager.isMusicPlaying === 'function'
                && !this.soundManager.isMusicPlaying()) {
                this.soundManager.startBackgroundMusic();
            }
            return;
        }

        if (typeof this.soundManager.isMusicPlaying === 'function'
            && this.soundManager.isMusicPlaying()) {
            return;
        }

        if (typeof this.soundManager.playAudioFile === 'function') {
            this.soundManager.musicTrack = trackKey;
            this.soundManager.playAudioFile('./assets/music/Cosmic Chimes.mp3');
        }
    }

    /**
     * Create the intro animation HTML structure
     */
    async createIntroHTML() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';

        // Create canvas for Three.js (Background & core visuals)
        this.threeCanvas = document.createElement('canvas');
        this.threeCanvas.id = 'intro-webgl-canvas';
        this.threeCanvas.style.position = 'absolute';
        this.threeCanvas.style.top = '0';
        this.threeCanvas.style.left = '0';
        this.threeCanvas.style.width = '100%';
        this.threeCanvas.style.height = '100%';
        this.threeCanvas.style.zIndex = '0'; // Behind CSS overlays
        this.container.appendChild(this.threeCanvas);

        // Initialize renderer: try WebGPU first, fall back to WebGL. This must never
        // prevent the DOM/CSS title + prompt from being created.
        try {
            await this.initRenderer(this.threeCanvas);
        } catch (error) {
            this.threeRenderer = null;
            this.isWebGPU = false;
            console.warn('[IntroAnimation] Renderer init crashed, continuing with DOM fallback:', error);
            performanceMonitor.recordEvent('startup_intro_renderer_init_completed', {
                backend: 'failed',
                fallbackReason: 'unhandled-exception',
                message: error?.message || String(error),
            });
        } finally {
            // Signal readiness: the renderer settled (or definitively failed), so
            // getWebGPUDevice() is reliable for the boot-warp device-share decision.
            this.resolveRendererReady();
        }
        this.setLoadingState(false);

        // Phase 5: CSS particles/orbs removed; visuals are now GPU-native in both WebGPU and WebGL paths.
        this.threeRenderer?.setBackgroundMode?.(false);

        // PERFORMANCE: Removed foreground particles - WebGL handles foreground particles

        // Create title container
        const titleContainer = document.createElement('div');
        titleContainer.className = 'intro-title-container';
        if (this.titleDeferred && !this.titleRevealed) {
            // Applied BEFORE the element is laid out, so the CSS reveal never fires
            // early; revealTitle() removes it to play the animation fresh. The
            // !titleRevealed guard covers the cold-boot race where the CSS-fallback
            // path calls revealTitle() before this DOM exists — then the title must
            // be created VISIBLE (its reveal plays on insertion), never held forever.
            titleContainer.classList.add('intro-title-hold');
        }

        // Create title with individual letters
        const title = this.createAnimatedTitle();
        titleContainer.appendChild(title);

        // Add shimmer effect
        const shimmer = document.createElement('div');
        shimmer.className = 'intro-shimmer';
        titleContainer.appendChild(shimmer);

        this.container.appendChild(titleContainer);

        // Create chromatic aberration overlay
        const chromatic = document.createElement('div');
        chromatic.className = 'intro-chromatic';
        this.container.appendChild(chromatic);

        // Warp overlay for dismiss transition polish
        const warpOverlay = document.createElement('div');
        warpOverlay.className = 'intro-warp-overlay';
        this.container.appendChild(warpOverlay);

        // Create prompt text
        const prompt = document.createElement('div');
        prompt.className = 'intro-prompt';
        if (this.titleDeferred && !this.interactionEnabled) {
            // Don't invite "press to begin" until the title has appeared + interaction
            // unlocks. Same cold-boot race guard as the title above: if interaction was
            // already unlocked before this DOM existed, create the prompt visible.
            prompt.classList.add('intro-prompt-hold');
        }
        prompt.innerHTML = 'PRESS ANY KEY / CLICK / TAP TO BEGIN';
        this.container.appendChild(prompt);

        // Loading mask indicator (Phase 7 loading integration)
        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.className = 'intro-loading-indicator';
        this.loadingIndicator.textContent = 'LOADING ASSETS';
        this.loadingIndicator.style.display = 'none';
        this.container.appendChild(this.loadingIndicator);

        // Add to body
        document.body.appendChild(this.container);
        this.setupMenuLogoLayoutTracking();
        this.syncTitleBounds(performance.now());
        this.installTetrominoPointerListener();
    }

    /**
     * Create animated title with individual letters
     * @returns {HTMLElement}
     */
    createAnimatedTitle() {
        const title = document.createElement('h1');
        title.className = 'intro-title';

        const text = 'SERENITY BLOCKS';
        const letters = text.split('');

        letters.forEach((char) => {
            if (char === ' ') {
                const space = document.createElement('span');
                space.className = 'intro-space';
                title.appendChild(space);
            } else {
                const letter = document.createElement('span');
                letter.className = 'intro-letter';
                letter.textContent = char;
                title.appendChild(letter);
            }
        });

        return title;
    }

    /**
     * Setup event listeners for user input
     */
    setupEventListeners() {
        // Mouse click
        this.boundHandlers.click = () => this.handleInteraction();
        this.container.addEventListener('click', this.boundHandlers.click);

        // Keyboard
        this.boundHandlers.keydown = () => this.handleInteraction();
        window.addEventListener('keydown', this.boundHandlers.keydown);

        // Touch
        this.boundHandlers.touchstart = () => this.handleInteraction();
        this.container.addEventListener('touchstart', this.boundHandlers.touchstart, { passive: true });

        // Optional external loading mask hook:
        // window.dispatchEvent(new CustomEvent('intro-loading-state', { detail: { loading: true, label: '...' } }))
        this.boundHandlers.loadingState = (event) => {
            const detail = event?.detail || {};
            this.setLoadingState(Boolean(detail.loading), detail.label);
        };
        window.addEventListener('intro-loading-state', this.boundHandlers.loadingState);

        // Gamepad (check for button press)
        this.gamepadCheckInterval = setInterval(() => {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp) {
                    // Check if any button is pressed
                    for (let j = 0; j < gp.buttons.length; j++) {
                        if (gp.buttons[j].pressed) {
                            this.handleInteraction();
                            break;
                        }
                    }
                }
            }
        }, 100);
    }

    installTetrominoPointerListener() {
        if (this.tetrominoPointerListenerInstalled || typeof window === 'undefined') {
            return;
        }

        window.addEventListener('pointerdown', this.boundIntroTetrominoPointerDown, {
            capture: true,
            passive: true,
        });
        this.tetrominoPointerListenerInstalled = true;
    }

    removeTetrominoPointerListener() {
        if (!this.tetrominoPointerListenerInstalled || typeof window === 'undefined') {
            return;
        }

        window.removeEventListener('pointerdown', this.boundIntroTetrominoPointerDown, true);
        this.tetrominoPointerListenerInstalled = false;
    }

    shouldHandleTetrominoPointer(event) {
        if (!event
            || this.isActive
            || !this.isAnimating
            || !this.container
            || !document.body.contains(this.container)
            || !this.threeRenderer?.triggerTetrominoBounceAt) {
            return false;
        }

        if (event.isPrimary === false || (Number.isInteger(event.button) && event.button !== 0)) {
            return false;
        }

        if (hasBlockingIntroModal()) {
            return false;
        }

        const pathTarget = typeof event.composedPath === 'function'
            ? event.composedPath()[0]
            : event.target;
        const target = pathTarget instanceof Element ? pathTarget : null;
        if (!target) {
            return true;
        }

        if (target.closest(INTRO_TETROMINO_BLOCKED_POINTER_SELECTOR)) {
            return false;
        }

        const modal = target.closest('.modal.visible, [role="dialog"].visible');
        if (modal && modal.id !== 'start-modal') {
            return false;
        }

        return true;
    }

    handleIntroTetrominoPointerDown(event) {
        if (!this.shouldHandleTetrominoPointer(event)) {
            return;
        }

        try {
            const result = this.threeRenderer.triggerTetrominoBounceAt(event.clientX, event.clientY);
            if (result && typeof result.catch === 'function') {
                result.catch((error) => {
                    console.warn('[IntroAnimation] Tetromino click bounce failed:', error);
                });
            }
        } catch (error) {
            console.warn('[IntroAnimation] Tetromino click bounce failed:', error);
        }
    }

    /**
     * Handle user interaction (click, key press, tap, gamepad)
     */
    handleInteraction() {
        if (!this.isActive) return;
        // Ignore begin-input until the title has appeared (locked through the boot transition).
        if (!this.interactionEnabled) return;
        // Single-shot: once "begin" fires, ignore further presses (no double sound/dismiss).
        this.interactionEnabled = false;

        // "Begin" confirm — dark-space start pulse, in sync with the dismiss/warp-out.
        // Honors mute/volume; best-effort so a missing/blocked file never blocks the dismiss.
        this.soundManager?.playOneShotFile?.('assets/audio/intro/begin.ogg', { volume: 0.8 });

        // Dismiss only the text, keep the background
        const prompt = this.container?.querySelector('.intro-prompt');
        if (prompt) {
            prompt.remove();
        }
        if (this.loadingIndicator) {
            this.loadingIndicator.remove();
            this.loadingIndicator = null;
        }

        this.threeRenderer?.startWarpDismiss?.(1.2);
        this.setRendererPhase(INTRO_PHASES.DISMISS);
        this.setLoadingState(false);
        this.dismissText();
    }

    setLoadingState(isLoading, label = 'LOADING ASSETS') {
        this.isLoadingMasked = Boolean(isLoading);
        if (!this.loadingIndicator) return;

        if (this.isLoadingMasked) {
            this.loadingIndicator.textContent = label;
            this.loadingIndicator.style.display = '';
            this.loadingIndicator.classList.add('visible');
        } else {
            this.loadingIndicator.classList.remove('visible');
            this.loadingIndicator.style.display = 'none';
        }
    }

    /**
     * Create ripple effect at position
     */
    createRipple(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'intro-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.style.transform = 'translate(-50%, -50%)';
        this.container.appendChild(ripple);

        setTimeout(() => ripple.remove(), 1500);
    }

    /**
     * Create particle burst effect at position with vibrant colors (CSS)
     * PERFORMANCE: Reduced burst particles from 30 to 15
     */
    createBurstParticles(x, y) {
        const particleCount = 15;

        // Vibrant color palette for burst particles
        const burstColors = [
            '#64c8ff', // Cyan
            '#9333ea', // Purple
            '#3b82f6', // Blue
            '#ec4899', // Pink
            '#10b981', // Emerald
            '#8b5cf6', // Violet
            '#14b8a6', // Teal
            '#ff9900', // Orange
            '#ffff00', // Yellow
            '#00ffff', // Cyan
        ];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'intro-burst-particle';
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;

            // Random direction
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = Math.random() * 150 + 50;
            const burstX = Math.cos(angle) * distance;
            const burstY = Math.sin(angle) * distance;

            particle.style.setProperty('--burst-x', `${burstX}px`);
            particle.style.setProperty('--burst-y', `${burstY}px`);

            // Assign random color
            const color = burstColors[i % burstColors.length];
            particle.style.backgroundColor = color;
            particle.style.boxShadow = `0 0 10px ${color}`;

            this.container.appendChild(particle);

            setTimeout(() => particle.remove(), 1000);
        }
    }

    /**
     * Start animation effects
     */
    startAnimations() {
        // All animations are CSS-based or managed by Three.js renderer
    }

    /**
     * Dismiss only the text elements (title and prompt) while keeping the background
     */
    dismissText() {
        if (!this.isActive) return;

        this.clearPhaseTimers();
        this.clearTitleRevealSafety();
        this.isActive = false;

        // Remove event listeners
        this.container.removeEventListener('click', this.boundHandlers.click);
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);
        window.removeEventListener('intro-loading-state', this.boundHandlers.loadingState);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Get text elements
        const titleContainer = this.container.querySelector('.intro-title-container');
        const prompt = this.container.querySelector('.intro-prompt');
        const chromatic = this.container.querySelector('.intro-chromatic');

        // Hide bottom prompt immediately to avoid residual glow smear on dismiss.
        if (prompt) prompt.style.display = 'none';
        if (chromatic) chromatic.classList.add('fade-out-text');

        // Transition title to top as logo
        if (titleContainer) {
            titleContainer.classList.add('shrink-to-logo');
            this.scheduleMenuLogoLayoutUpdate();
        }

        // Lower the z-index so modal cards can appear on top
        if (this.container) {
            this.container.style.zIndex = '100';
            // Remove cursor pointer since we don't want clicks anymore
            this.container.style.cursor = 'default';
            this.container.style.pointerEvents = 'none';
        }

        this.threeRenderer?.setBackgroundMode?.(true);
        this.installTetrominoPointerListener();
        this.setRendererPhase(INTRO_PHASES.DISMISS);

        // Signal completion near the midpoint of the warp to mask theme loading hitch.
        if (this.onComplete) {
            const handoverPromise = new Promise((resolve) => {
                setTimeout(resolve, 380);
            });
            handoverPromise.then(() => {
                if (this.onComplete) {
                    this.onComplete();
                    this.onComplete = null;
                }
            });
        }

        // After the warp transition reaches a stable point, switch to MENU_BG loop.
        setTimeout(async () => {
            if (prompt) prompt.style.display = 'none';
            if (chromatic) chromatic.style.display = 'none';

            await this.waitForLoadingPromise();
            this.setRendererPhase(INTRO_PHASES.MENU_BG);
        }, 850);
    }

    /**
     * Dismiss the intro animation completely
     */
    dismiss() {
        if (this.dismissPromise) {
            return this.dismissPromise;
        }

        // Allow dismissal even if not active anymore
        if (!this.container) {
            return Promise.resolve();
        }

        this.clearPhaseTimers();
        this.isActive = false;
        this.isAnimating = false;
        this.hasCompleted = true;
        this.removeTetrominoPointerListener();

        // Remove event listeners if still attached
        if (this.container) {
            this.container.removeEventListener('click', this.boundHandlers.click);
            this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);
        }
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        window.removeEventListener('intro-loading-state', this.boundHandlers.loadingState);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Fade out
        if (this.container) {
            this.container.classList.add('fade-out');
        }

        this.dismissPromise = new Promise((resolve) => {
            // Remove from DOM after fade
            setTimeout(() => {
                // Cleanup Three.js
                if (this.animationFrameId) {
                    cancelAnimationFrame(this.animationFrameId);
                    this.animationFrameId = null;
                }
                if (this.threeRenderer) {
                    this.threeRenderer.destroy();
                    this.threeRenderer = null;
                }

                if (this.container && this.container.parentNode) {
                    this.container.parentNode.removeChild(this.container);
                }
                this.teardownMenuLogoLayoutTracking();
                this.container = null;
                this.loadingIndicator = null;
                this.loadingPromise = null;
                this.smoothedAudioPulse = 0;

                // Resolve the promise if not already resolved
                if (this.onComplete) {
                    this.onComplete();
                    this.onComplete = null;
                }

                this.dismissPromise = null;
                resolve();
            }, 1000);
        });

        return this.dismissPromise;
    }

    /**
     * Skip the intro animation (for development/testing)
     */
    skip() {
        this.clearPhaseTimers();
        this.clearTitleRevealSafety();
        this.removeTetrominoPointerListener();
        this.isActive = false;
        if (this.container) {
            this.container.classList.add('hidden');
            this.container.removeEventListener('click', this.boundHandlers.click);
            this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);
        }
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        window.removeEventListener('intro-loading-state', this.boundHandlers.loadingState);
        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
            this.gamepadCheckInterval = null;
        }
        this.teardownMenuLogoLayoutTracking();

        // Cleanup Three.js
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.threeRenderer) {
            this.threeRenderer.destroy();
            this.threeRenderer = null;
        }

        this.hasCompleted = true;
        this.isAnimating = false;
        this.dismissPromise = null;
        if (this.onComplete) {
            this.onComplete();
            this.onComplete = null;
        }
    }

    /**
     * Reset the intro animation (for replay)
     */
    reset() {
        this.clearPhaseTimers();
        this.clearTitleRevealSafety();
        this.removeTetrominoPointerListener();
        this.hasCompleted = false;
        this.isActive = false;
        this.isAnimating = false;

        // Cleanup Three.js
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.threeRenderer) {
            this.threeRenderer.destroy();
            this.threeRenderer = null;
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.teardownMenuLogoLayoutTracking();
        this.container = null;
        this.loadingIndicator = null;
        this.loadingPromise = null;
        this.smoothedAudioPulse = 0;
        this.dismissPromise = null;
    }

    /**
     * True when the cinematic should be suppressed for motion comfort. Honors the
     * OS `prefers-reduced-motion`, mirroring the boot warp's own gate
     * (boot-warp-transition.js) so the whole boot behaves consistently.
     */
    _prefersReducedMotion() {
        return typeof window !== 'undefined'
            && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    /**
     * The cinematic intro title has become the live menu logo again. Clear the
     * terminal `startup-intro-skipped` flag so the CSS keeps hiding the static
     * DOM `.main-menu-logo`. Without this, the skipped-intro CSS override keeps
     * the static logo visible while `showBackgroundOnly()` re-creates the
     * animated title, so the menu renders the "Serenity Blocks" header twice
     * (repro: skip the intro, enter Local Multiplayer, return to the menu).
     */
    _claimMenuLogoIdentity() {
        if (typeof document !== 'undefined') {
            document.body.classList.remove('startup-intro-skipped');
        }
    }

    /**
     * Show only the background animation with shrunken logo at top
     * (for returning to start modal from gameplay)
     */
    async showBackgroundOnly(soundManager = null) {
        // Reduced motion: never run the animated cinematic background. Keep the
        // static DOM menu logo as the identity (leave `startup-intro-skipped` set
        // so CSS shows it) and report the menu background as ready immediately so
        // callers awaiting waitForMenuBgReady() don't stall on the timeout.
        if (this._prefersReducedMotion()) {
            this.menuBgReady = true;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('intro:menuBgReady', { detail: { reducedMotion: true } }));
            }
            return;
        }

        // If already showing, check if it's hidden and revive it
        if (this.container && document.body.contains(this.container)) {
            if (this.container.style.display === 'none') {
                console.log('[IntroAnimation] Reviving hidden container');
                this.container.style.removeProperty('display');
                this.container.style.display = '';

                // Ensure correct state for background only
                this.container.classList.add('background-only');
                this.container.classList.remove('warp-dismiss');
                this.container.style.zIndex = '100';
                this.container.style.pointerEvents = 'none';

                const titleContainer = this.container.querySelector('.intro-title-container');
                if (titleContainer) {
                    titleContainer.classList.add('shrink-to-logo');
                    this.scheduleMenuLogoLayoutUpdate();
                }
                this._claimMenuLogoIdentity();

                // Hide prompt/chromatic if they exist (cleanup from full intro)
                const prompt = this.container.querySelector('.intro-prompt');
                if (prompt) prompt.style.display = 'none';
                const chromatic = this.container.querySelector('.intro-chromatic');
                if (chromatic) chromatic.style.display = 'none';
                this.setLoadingState(false);

                // Ensure music
                this.ensureIntroMusic();
                this.isAnimating = true;
                this.threeRenderer?.setBackgroundMode?.(true);
                this.setRendererPhase(INTRO_PHASES.MENU_BG, true);
                this.startRenderLoop();
            }
            this.installTetrominoPointerListener();
            return;
        }

        if (soundManager) {
            this.setSoundManager(soundManager);
        }

        this.ensureIntroMusic();
        this.isActive = false; // Not active for interaction
        this.isAnimating = true; // Keep animating
        this.hasCompleted = true; // Mark as completed so show() won't work

        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';
        this.container.classList.add('background-only'); // Add class for background-only mode
        this.container.style.zIndex = '100';
        this.container.style.pointerEvents = 'none';

        // Create WebGL canvas for Three.js
        this.threeCanvas = document.createElement('canvas');
        this.threeCanvas.id = 'intro-webgl-canvas';
        this.threeCanvas.style.position = 'absolute';
        this.threeCanvas.style.top = '0';
        this.threeCanvas.style.left = '0';
        this.threeCanvas.style.width = '100%';
        this.threeCanvas.style.height = '100%';
        this.threeCanvas.style.zIndex = '0'; // Behind everything
        this.container.appendChild(this.threeCanvas);

        // Initialize renderer (WebGPU with WebGL fallback)
        await this.initRenderer(this.threeCanvas);
        this.threeRenderer?.setBackgroundMode?.(true);
        this.setRendererPhase(INTRO_PHASES.MENU_BG, true);

        // Start animation loop
        this.startRenderLoop();

        // Create title container with shrunken logo
        const titleContainer = document.createElement('div');
        titleContainer.className = 'intro-title-container shrink-to-logo';

        // Create title with individual letters
        const title = this.createAnimatedTitle();
        titleContainer.appendChild(title);

        // Add shimmer effect
        const shimmer = document.createElement('div');
        shimmer.className = 'intro-shimmer';
        titleContainer.appendChild(shimmer);

        this.container.appendChild(titleContainer);

        const warpOverlay = document.createElement('div');
        warpOverlay.className = 'intro-warp-overlay';
        this.container.appendChild(warpOverlay);

        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.className = 'intro-loading-indicator';
        this.loadingIndicator.textContent = 'LOADING ASSETS';
        this.loadingIndicator.style.display = 'none';
        this.container.appendChild(this.loadingIndicator);
        this.setLoadingState(false);

        // Add to DOM
        document.body.appendChild(this.container);
        this._claimMenuLogoIdentity();
        this.setupMenuLogoLayoutTracking();
        this.scheduleMenuLogoLayoutUpdate();
        this.syncTitleBounds(performance.now());
        this.installTetrominoPointerListener();

        // Trigger animations
        requestAnimationFrame(() => {
            this.container.classList.add('active');
        });
    }
}

// Create singleton instance
export const introAnimation = new IntroAnimation();
