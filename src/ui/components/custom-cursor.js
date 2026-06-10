/**
 * Cosmic cursor system.
 * Replaces the native pointer with a theme-aware, lifecycle-managed cursor.
 */

import { eventBus, EVENTS } from '../../events/event-bus.js';
import { getOdysseyThemePresentationPalette } from '../../core/odyssey/theme-presentation.js';

export const CURSOR_STATES = Object.freeze({
    DEFAULT: 'default',
    INTERACTIVE: 'interactive',
    PRESSED: 'pressed',
    GRAB: 'grab',
    GRABBING: 'grabbing',
    DISABLED: 'disabled',
    TEXT: 'text',
    MODAL: 'modal',
    HIDDEN: 'hidden',
});

export const CURSOR_INTENSITIES = Object.freeze(['low', 'standard', 'high']);
export const CURSOR_VISIBILITY_PRESETS = Object.freeze(['standard', 'high-visibility']);
export const CURSOR_REDUCED_MOTION_MODES = Object.freeze(['system', 'on', 'off']);

const CURSOR_SETTINGS_DEFAULTS = Object.freeze({
    customCursorEnabled: true,
    customCursorIntensity: 'standard',
    customCursorVisibilityPreset: 'standard',
    customCursorReducedMotion: 'system',
});

const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'summary',
    'select',
    'label[for]',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '[role="option"]',
    '[role="switch"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="link"]',
    '.cosmic-select__trigger',
    '.cosmic-select__option',
    '.cosmic-segmented__seg',
    '[data-cursor-interactive="true"]',
    '.clickable',
    '.setting-button',
    '.settings-tab',
    '.controls-subtab',
    '.controls-nav-action',
    '.hub-tab',
    '.theme-card',
    '.playlist-item',
    '.technique-card',
    '.game-mode-card',
    '.serenity-hub-icon',
    '.floating-settings-btn',
    '.highscores-icon',
    '.replays-icon',
    '.odyssey-navigator-icon',
].join(', ');

const MAGNETIC_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'summary',
    'select',
    '.cosmic-select__trigger',
    '.cosmic-segmented__seg',
    '[role="button"]',
    '.clickable',
    '.setting-button',
    '.controls-subtab',
    '.controls-nav-action',
    '.hub-tab',
    '.theme-card',
    '.playlist-item',
    '.technique-card',
    '.game-mode-card',
    '.serenity-hub-icon',
    '.floating-settings-btn',
].join(', ');

const TEXT_SELECTOR = [
    'input:not([type="button"]):not([type="checkbox"]):not([type="color"]):not([type="file"])'
        + ':not([type="hidden"]):not([type="image"]):not([type="radio"]):not([type="range"])'
        + ':not([type="reset"]):not([type="submit"])',
    'textarea',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[role="textbox"]',
].join(', ');

const DISABLED_SELECTOR = [
    'button:disabled',
    'input:disabled',
    'select:disabled',
    'textarea:disabled',
    '[aria-disabled="true"]',
    '[data-disabled="true"]',
    '.disabled',
    '.steam-disabled',
].join(', ');

const PRECISION_ZONE_SELECTOR = [
    'canvas',
    'svg[data-disable-cursor-magnetism="true"]',
    '#background-canvas',
    '.phaser-board-container',
    '.theme-container',
    '.odyssey-layout-editor-panel',
    '.odyssey-layout-editor-overlay',
    '[data-disable-cursor-magnetism="true"]',
].join(', ');

const INLINE_CURSOR_STATE_MAP = Object.freeze({
    default: CURSOR_STATES.DEFAULT,
    pointer: CURSOR_STATES.INTERACTIVE,
    grab: CURSOR_STATES.GRAB,
    grabbing: CURSOR_STATES.GRABBING,
    'not-allowed': CURSOR_STATES.DISABLED,
    text: CURSOR_STATES.TEXT,
    'vertical-text': CURSOR_STATES.TEXT,
});

const INTENSITY_CONFIG = Object.freeze({
    low: {
        lerp: 0.2,
        trailPoints: 10,
        trailAlpha: 0.42,
        trailRadius: 16,
        burstCount: 5,
        magnetism: 0.1,
        maxStretch: 0.12,
    },
    standard: {
        lerp: 0.17,
        trailPoints: 16,
        trailAlpha: 0.56,
        trailRadius: 20,
        burstCount: 8,
        magnetism: 0.18,
        maxStretch: 0.18,
    },
    high: {
        lerp: 0.145,
        trailPoints: 24,
        trailAlpha: 0.68,
        trailRadius: 26,
        burstCount: 12,
        magnetism: 0.26,
        maxStretch: 0.24,
    },
});

export const CURSOR_IDLE_FADE_DELAY_MS = 1200;

function isElement(value) {
    return !!value && typeof value === 'object' && value.nodeType === 1;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hexToRgbParts(hex) {
    if (typeof hex !== 'string') return { r: 92, g: 125, b: 255 };
    const normalized = hex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return { r: 92, g: 125, b: 255 };
    }

    return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16),
    };
}

function rgbPartsToString({ r, g, b }) {
    return `${r}, ${g}, ${b}`;
}

function mixRgb(left, right, amount) {
    const t = clamp(amount, 0, 1);
    return {
        r: Math.round((left.r * (1 - t)) + (right.r * t)),
        g: Math.round((left.g * (1 - t)) + (right.g * t)),
        b: Math.round((left.b * (1 - t)) + (right.b * t)),
    };
}

export function mapInlineCursorStyle(cursorValue) {
    if (typeof cursorValue !== 'string') return null;
    const normalized = cursorValue.trim().toLowerCase();
    if (!normalized || normalized === 'auto' || normalized === 'none') {
        return null;
    }

    return INLINE_CURSOR_STATE_MAP[normalized] || null;
}

export function normalizeCursorSettings(settings = {}) {
    const intensity = CURSOR_INTENSITIES.includes(settings.customCursorIntensity)
        ? settings.customCursorIntensity
        : CURSOR_SETTINGS_DEFAULTS.customCursorIntensity;
    const visibilityPreset = CURSOR_VISIBILITY_PRESETS.includes(settings.customCursorVisibilityPreset)
        ? settings.customCursorVisibilityPreset
        : CURSOR_SETTINGS_DEFAULTS.customCursorVisibilityPreset;
    const reducedMotion = CURSOR_REDUCED_MOTION_MODES.includes(settings.customCursorReducedMotion)
        ? settings.customCursorReducedMotion
        : CURSOR_SETTINGS_DEFAULTS.customCursorReducedMotion;

    return {
        customCursorEnabled: typeof settings.customCursorEnabled === 'boolean'
            ? settings.customCursorEnabled
            : CURSOR_SETTINGS_DEFAULTS.customCursorEnabled,
        customCursorIntensity: intensity,
        customCursorVisibilityPreset: visibilityPreset,
        customCursorReducedMotion: reducedMotion,
    };
}

export function isCursorInactive(lastPointerActivity, now = 0, idleDelay = CURSOR_IDLE_FADE_DELAY_MS) {
    if (!Number.isFinite(lastPointerActivity) || lastPointerActivity <= 0) {
        return false;
    }
    if (!Number.isFinite(now)) {
        return false;
    }
    return (now - lastPointerActivity) >= idleDelay;
}

export function resolveCursorPalette(themeId, fallbackPalette = null) {
    const palette = fallbackPalette
        || getOdysseyThemePresentationPalette(themeId)
        || getOdysseyThemePresentationPalette('cosmic-noir');
    if (!palette) {
        return {
            primary: '#5c7dff',
            accent: '#8ea5ff',
            highlight: '#d7e0ff',
            shadow: '#11182f',
        };
    }

    return palette;
}

function closest(element, selector) {
    if (!isElement(element)) return null;
    if (typeof element.closest === 'function') {
        return element.closest(selector);
    }
    return null;
}

function findInlineCursorOverride(element) {
    let node = isElement(element) ? element : null;
    while (node) {
        const mapped = mapInlineCursorStyle(node.style?.cursor);
        if (mapped) {
            return mapped;
        }
        node = node.parentElement;
    }
    return null;
}

function resolveCursorStateFromTarget(target) {
    if (!isElement(target)) {
        return {
            state: CURSOR_STATES.DEFAULT,
            magneticElement: null,
            precisionZone: false,
        };
    }

    const inlineState = findInlineCursorOverride(target);
    const precisionZone = !!closest(target, PRECISION_ZONE_SELECTOR);

    if (inlineState === CURSOR_STATES.GRABBING || inlineState === CURSOR_STATES.GRAB) {
        return {
            state: inlineState,
            magneticElement: null,
            precisionZone,
        };
    }

    if (closest(target, DISABLED_SELECTOR) || inlineState === CURSOR_STATES.DISABLED) {
        return {
            state: CURSOR_STATES.DISABLED,
            magneticElement: null,
            precisionZone,
        };
    }

    if (closest(target, TEXT_SELECTOR) || inlineState === CURSOR_STATES.TEXT || target.isContentEditable) {
        return {
            state: CURSOR_STATES.TEXT,
            magneticElement: null,
            precisionZone,
        };
    }

    const magneticElement = closest(target, MAGNETIC_SELECTOR);
    if (magneticElement) {
        return {
            state: inlineState || CURSOR_STATES.INTERACTIVE,
            magneticElement: precisionZone ? null : magneticElement,
            precisionZone,
        };
    }

    if (inlineState) {
        return {
            state: inlineState,
            magneticElement: null,
            precisionZone,
        };
    }

    if (closest(target, INTERACTIVE_SELECTOR)) {
        return {
            state: CURSOR_STATES.INTERACTIVE,
            magneticElement: null,
            precisionZone,
        };
    }

    return {
        state: CURSOR_STATES.DEFAULT,
        magneticElement: null,
        precisionZone,
    };
}

function isFinePointerEnvironment() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return true;
    }

    return window.matchMedia('(pointer: fine)').matches && window.matchMedia('(hover: hover)').matches;
}

export class CustomCursor {
    constructor({ settingsManager = null } = {}) {
        this.settingsManager = settingsManager;

        this.container = null;
        this.cursor = null;
        this.motionShell = null;
        this.trailCanvas = null;
        this.ctx = null;
        this.abortController = null;
        this.bodyObserver = null;
        this.themeUnsubscribe = null;
        this.reducedMotionMedia = null;
        this.finePointerMedia = null;
        this.mediaListeners = [];
        this.animationFrame = null;
        this.idleAnimationTimeout = null;

        this.mounted = false;
        this.pointerInsideWindow = false;
        this.baseVisible = true;
        this.bodyHidden = false;
        this.modalActive = false;
        this.isHubOpen = false;
        this.pointerDown = false;
        this.prefersReducedMotion = false;
        // While a native popup is open (non-enhanced <select>, or a date/color/file/
        // time picker), the OS renders it as a separate window above the page: the
        // cosmic cursor can't paint over it and pointermove stops firing. Detect that
        // and reveal the real OS pointer instead of leaving a frozen custom cursor
        // (enhanced CosmicSelects never open a native popup, so they're excluded).
        // Cleared as soon as pointermove resumes (= popup closed) or on change/blur.
        this.nativePopupOpen = false;
        this.supportsFinePointer = isFinePointerEnvironment();

        this.pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        this.target = { x: this.pos.x, y: this.pos.y };
        this.velocity = { x: 0, y: 0 };
        this.pointerTarget = null;
        this.pointerType = 'mouse';
        this.semanticState = CURSOR_STATES.DEFAULT;
        this.renderState = CURSOR_STATES.HIDDEN;
        this.activeMagneticElement = null;
        this.lastFrameTime = null;
        this.lastPointerActivity = 0;
        this.gamepadSuppressed = false;
        this.lastSuppressionCheck = 0;

        this.trailPoints = [];
        this.burstParticles = [];
        this.themeId = 'cosmic-noir';
        this.palette = resolveCursorPalette(this.themeId);
        this.settings = normalizeCursorSettings(this.settingsManager?.get?.() || {});

        this.syncBodyContext();
    }

    mount() {
        if (this.mounted || typeof document === 'undefined') return;

        if (typeof window !== 'undefined') {
            const previousInstance = window.__serenityCustomCursor;
            if (previousInstance && previousInstance !== this && typeof previousInstance.destroy === 'function') {
                previousInstance.destroy();
            }
            window.__serenityCustomCursor = this;
        }

        this.createDom();
        this.attachListeners();
        this.observeEnvironment();
        this.setupThemeListener();
        this.applySettings(this.settingsManager?.get?.() || {});
        this.refreshModalState();

        const initialTheme = window.themeManager?.activeThemeName
            || this.settingsManager?.get?.()?.backgroundTheme
            || 'cosmic-noir';
        this.setTheme(initialTheme);
        this.mounted = true;
        this.syncPresentation();
        this.scheduleAnimationFrame();
        console.log('✨ [Cosmic Cursor] Mounted');
    }

    destroy() {
        if (!this.mounted && !this.container) return;

        this.mounted = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (this.idleAnimationTimeout) {
            clearTimeout(this.idleAnimationTimeout);
            this.idleAnimationTimeout = null;
        }

        this.abortController?.abort();
        this.abortController = null;

        if (this.bodyObserver) {
            this.bodyObserver.disconnect();
            this.bodyObserver = null;
        }

        this.mediaListeners.forEach(({ media, listener }) => {
            media.removeEventListener?.('change', listener);
        });
        this.mediaListeners = [];
        this.themeUnsubscribe?.();
        this.themeUnsubscribe = null;

        if (this.container && document.body.contains(this.container)) {
            document.body.removeChild(this.container);
        }
        this.container = null;
        this.cursor = null;
        this.motionShell = null;
        this.trailCanvas = null;
        this.ctx = null;
        document.body.classList.remove('custom-cursor-active');

        if (typeof window !== 'undefined' && window.__serenityCustomCursor === this) {
            delete window.__serenityCustomCursor;
        }
    }

    createDom() {
        this.container = document.createElement('div');
        this.container.className = 'custom-cursor-container';
        this.container.setAttribute('aria-hidden', 'true');

        this.trailCanvas = document.createElement('canvas');
        this.trailCanvas.className = 'cursor-trail-canvas';

        this.cursor = document.createElement('div');
        this.cursor.className = 'custom-cursor-core';
        this.cursor.innerHTML = `
            <div class="custom-cursor-motion-shell">
                <div class="custom-cursor-aura"></div>
                <div class="custom-cursor-lens">
                    <div class="custom-cursor-ring"></div>
                    <div class="custom-cursor-beam"></div>
                    <div class="custom-cursor-nucleus"></div>
                </div>
            </div>
        `;
        this.motionShell = this.cursor.querySelector('.custom-cursor-motion-shell');

        this.container.appendChild(this.trailCanvas);
        this.container.appendChild(this.cursor);
        document.body.appendChild(this.container);

        this.updateCanvasSize();
        this.ctx = this.trailCanvas.getContext('2d');
        if (this.ctx) {
            this.ctx.globalCompositeOperation = 'screen';
        }
    }

    attachListeners() {
        this.abortController = new AbortController();
        const { signal } = this.abortController;

        window.addEventListener('pointermove', (event) => this.onPointerMove(event), { signal, passive: true });
        window.addEventListener('pointerdown', (event) => this.onPointerDown(event), { signal, passive: true });
        window.addEventListener('pointerup', (event) => this.onPointerUp(event), { signal, passive: true });
        window.addEventListener('pointercancel', () => this.onPointerCancel(), { signal, passive: true });
        window.addEventListener('pointerleave', () => this.onPointerLeaveWindow(), { signal, passive: true });
        window.addEventListener('mouseout', (event) => {
            if (!event.relatedTarget) {
                this.onPointerLeaveWindow();
            }
        }, { signal, passive: true });
        window.addEventListener('resize', () => this.updateCanvasSize(), { signal, passive: true });
        window.addEventListener('blur', () => this.onPointerLeaveWindow(), { signal, passive: true });
        window.addEventListener('modalShown', () => this.refreshModalState(), { signal, passive: true });
        window.addEventListener('modalHidden', () => this.refreshModalState(), { signal, passive: true });
        window.addEventListener('serenityHubVisibilityChange', (event) => {
            this.isHubOpen = !!event.detail?.visible;
            this.refreshModalState();
        }, { signal, passive: true });
        document.addEventListener('visibilitychange', () => this.syncPresentation(), { signal, passive: true });

        // Native-popup safety-net: reveal the OS pointer while a native popup the
        // cosmic cursor can't reach is open — a non-enhanced <select> or a native
        // date/color/file/time picker — then restore on selection/blur (pointermove
        // also clears it on resume).
        const nativePopupSelector = [
            'select:not([data-cosmic-enhanced])',
            'input[type="date"]',
            'input[type="datetime-local"]',
            'input[type="time"]',
            'input[type="month"]',
            'input[type="week"]',
            'input[type="color"]',
            'input[type="file"]',
        ].join(', ');
        const openNativePopup = (event) => {
            const el = event.target?.closest?.(nativePopupSelector);
            if (el && !el.disabled) {
                this.nativePopupOpen = true;
                this.syncPresentation();
            }
        };
        const closeNativePopup = () => {
            if (this.nativePopupOpen) {
                this.nativePopupOpen = false;
                this.syncPresentation();
            }
        };
        document.addEventListener('mousedown', openNativePopup, { signal, passive: true });
        document.addEventListener('focusin', openNativePopup, { signal, passive: true });
        document.addEventListener('change', closeNativePopup, { signal, passive: true });
        document.addEventListener('focusout', closeNativePopup, { signal, passive: true });
    }

    observeEnvironment() {
        if (typeof window.matchMedia === 'function') {
            this.reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
            this.finePointerMedia = window.matchMedia('(pointer: fine)');
            this.registerMediaListener(this.reducedMotionMedia, () => {
                this.prefersReducedMotion = this.resolveReducedMotion();
                this.syncPresentation();
            });
            this.registerMediaListener(this.finePointerMedia, () => {
                this.supportsFinePointer = isFinePointerEnvironment();
                this.syncPresentation();
            });
            this.prefersReducedMotion = this.resolveReducedMotion();
        }

        if (typeof MutationObserver === 'function' && document.body) {
            this.bodyObserver = new MutationObserver(() => {
                this.syncBodyContext();
                this.refreshModalState();
                this.syncPresentation();
            });
            this.bodyObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['class'],
            });
        }
    }

    registerMediaListener(media, listener) {
        media.addEventListener?.('change', listener);
        this.mediaListeners.push({ media, listener });
    }

    setupThemeListener() {
        this.themeUnsubscribe = eventBus.on(EVENTS.THEME_CHANGED, ({ themeName }) => {
            this.setTheme(themeName);
        });
    }

    applySettings(settings = {}) {
        this.settings = normalizeCursorSettings(settings);
        this.prefersReducedMotion = this.resolveReducedMotion();

        if (!this.container) return;

        this.container.dataset.intensity = this.settings.customCursorIntensity;
        this.container.dataset.visibilityPreset = this.settings.customCursorVisibilityPreset;
        this.container.dataset.reducedMotion = this.prefersReducedMotion ? 'true' : 'false';

        const size = this.settings.customCursorVisibilityPreset === 'high-visibility' ? 30 : 24;
        this.container.style.setProperty('--cursor-size', `${size}px`);
        this.container.style.setProperty(
            '--cursor-beam-height',
            this.settings.customCursorVisibilityPreset === 'high-visibility' ? '34px' : '28px',
        );
        this.syncPresentation();
        this.scheduleAnimationFrame();
    }

    setTheme(themeId, palette = null) {
        this.themeId = themeId || this.themeId;
        this.palette = resolveCursorPalette(this.themeId, palette);
        if (!this.container) return;

        const primary = hexToRgbParts(this.palette.primary);
        const accent = hexToRgbParts(this.palette.accent);
        const highlight = hexToRgbParts(this.palette.highlight);
        const shadow = hexToRgbParts(this.palette.shadow);
        const hotspot = mixRgb(highlight, { r: 255, g: 255, b: 255 }, 0.55);

        this.container.dataset.themeId = this.themeId;
        this.container.style.setProperty('--cursor-primary-rgb', rgbPartsToString(primary));
        this.container.style.setProperty('--cursor-accent-rgb', rgbPartsToString(accent));
        this.container.style.setProperty('--cursor-highlight-rgb', rgbPartsToString(highlight));
        this.container.style.setProperty('--cursor-shadow-rgb', rgbPartsToString(shadow));
        this.container.style.setProperty('--cursor-hotspot-rgb', rgbPartsToString(hotspot));
        this.scheduleAnimationFrame();
    }

    setVisible(isVisible) {
        this.baseVisible = !!isVisible;
        this.syncPresentation();
        this.scheduleAnimationFrame();
    }

    setSemanticState(state) {
        this.semanticState = Object.values(CURSOR_STATES).includes(state)
            ? state
            : CURSOR_STATES.DEFAULT;
        this.syncPresentation();
        this.scheduleAnimationFrame();
    }

    onPointerMove(event) {
        if (!event || (event.pointerType && event.pointerType === 'touch')) return;

        // pointermove resuming means any native popup has closed.
        this.nativePopupOpen = false;
        this.pointerType = event.pointerType || 'mouse';
        this.pointerInsideWindow = true;
        this.lastPointerActivity = performance.now();
        this.target.x = event.clientX;
        this.target.y = event.clientY;
        this.setVisible(true);
        this.updatePointerTarget(event.target);
        this.syncPresentation();
        this.scheduleAnimationFrame(true);
    }

    onPointerDown(event) {
        if (!event || (event.pointerType && event.pointerType === 'touch')) return;

        this.pointerDown = true;
        this.pointerType = event.pointerType || this.pointerType;
        this.pointerInsideWindow = true;
        this.lastPointerActivity = performance.now();
        this.target.x = event.clientX;
        this.target.y = event.clientY;
        this.updatePointerTarget(event.target);

        const intensity = INTENSITY_CONFIG[this.settings.customCursorIntensity];
        this.spawnBurstParticles(intensity.burstCount);
        this.syncPresentation();
        this.scheduleAnimationFrame(true);
    }

    onPointerUp(event) {
        this.pointerDown = false;
        if (event && !(event.pointerType && event.pointerType === 'touch')) {
            this.pointerType = event.pointerType || this.pointerType;
            this.lastPointerActivity = performance.now();
            this.updatePointerTarget(event.target);
        }
        this.syncPresentation();
        this.scheduleAnimationFrame(true);
    }

    onPointerCancel() {
        this.pointerDown = false;
        this.syncPresentation();
        this.scheduleAnimationFrame(true);
    }

    onPointerLeaveWindow() {
        this.pointerDown = false;
        this.pointerInsideWindow = false;
        this.setVisible(false);
        this.scheduleAnimationFrame(true);
    }

    updatePointerTarget(target) {
        this.pointerTarget = isElement(target)
            ? target
            : document.elementFromPoint(this.target.x, this.target.y);

        const resolved = resolveCursorStateFromTarget(this.pointerTarget);
        this.semanticState = resolved.state;
        this.activeMagneticElement = resolved.magneticElement;
    }

    syncBodyContext() {
        if (!document.body) return;
        this.bodyHidden = document.body.classList.contains('cursor-hidden');
        this.isHubOpen = document.body.classList.contains('serenity-hub-open');
    }

    refreshModalState() {
        this.syncBodyContext();
        this.modalActive = this.isHubOpen || !!document.querySelector('.modal.visible');
    }

    resolveReducedMotion() {
        if (this.settings.customCursorReducedMotion === 'on') return true;
        if (this.settings.customCursorReducedMotion === 'off') return false;
        return !!this.reducedMotionMedia?.matches;
    }

    shouldSuppressForGamepad(now) {
        if (now - this.lastPointerActivity < 1200) {
            return false;
        }
        return !!document.querySelector('.gamepad-focused');
    }

    shouldRender() {
        if (!this.settings.customCursorEnabled) return false;
        if (this.nativePopupOpen) return false;
        if (!this.supportsFinePointer) return false;
        if (document.hidden) return false;
        if (!this.pointerInsideWindow) return false;
        if (!this.baseVisible) return false;
        if (this.gamepadSuppressed) return false;
        if (this.pointerType === 'touch') return false;
        if (this.bodyHidden) return false;
        return true;
    }

    isMotionSettled() {
        return Math.abs(this.target.x - this.pos.x) < 0.2
            && Math.abs(this.target.y - this.pos.y) < 0.2
            && Math.abs(this.velocity.x) < 0.03
            && Math.abs(this.velocity.y) < 0.03;
    }

    shouldUseHighFrequencyAnimation(timestamp = performance.now()) {
        if (!this.mounted) return false;
        if (timestamp - this.lastPointerActivity < 180) return true;
        if (this.pointerDown) return true;
        if (this.trailPoints.length > 0 || this.burstParticles.length > 0) return true;
        if (!this.isMotionSettled()) return true;
        return false;
    }

    isPointerInactive(timestamp = performance.now()) {
        return isCursorInactive(this.lastPointerActivity, timestamp);
    }

    scheduleAnimationFrame(forceImmediate = false) {
        if (!this.mounted) return;
        if (this.animationFrame) return;

        if (forceImmediate && this.idleAnimationTimeout) {
            clearTimeout(this.idleAnimationTimeout);
            this.idleAnimationTimeout = null;
        }

        if (this.idleAnimationTimeout) {
            return;
        }

        const requestTick = () => {
            this.animationFrame = requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
        };

        if (forceImmediate || this.shouldUseHighFrequencyAnimation()) {
            requestTick();
            return;
        }

        this.idleAnimationTimeout = setTimeout(() => {
            this.idleAnimationTimeout = null;
            requestTick();
        }, 120);
    }

    resolveRenderState() {
        if (!this.shouldRender()) {
            return CURSOR_STATES.HIDDEN;
        }

        if (this.pointerDown && this.semanticState !== CURSOR_STATES.DISABLED) {
            return CURSOR_STATES.PRESSED;
        }

        if (this.modalActive && this.semanticState === CURSOR_STATES.DEFAULT) {
            return CURSOR_STATES.MODAL;
        }

        return this.semanticState;
    }

    syncPresentation(timestamp = performance.now()) {
        if (!this.container) return;

        this.syncBodyContext();
        this.renderState = this.resolveRenderState();

        const isRenderable = this.renderState !== CURSOR_STATES.HIDDEN;
        const pointerActivity = isRenderable && this.isPointerInactive(timestamp)
            ? 'inactive'
            : 'active';
        this.container.classList.toggle('is-visible', isRenderable);
        this.container.dataset.semanticState = this.semanticState;
        this.container.dataset.renderState = this.renderState;
        this.container.dataset.modalActive = this.modalActive ? 'true' : 'false';
        this.container.dataset.pointerActivity = pointerActivity;

        document.body.classList.toggle('custom-cursor-active', isRenderable);
        if (isRenderable || this.trailPoints.length > 0 || this.burstParticles.length > 0) {
            this.scheduleAnimationFrame();
        }
    }

    updateCanvasSize() {
        if (!this.trailCanvas) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        this.trailCanvas.width = Math.floor(window.innerWidth * ratio);
        this.trailCanvas.height = Math.floor(window.innerHeight * ratio);
        this.trailCanvas.style.width = `${window.innerWidth}px`;
        this.trailCanvas.style.height = `${window.innerHeight}px`;
        this.ctx = this.trailCanvas.getContext('2d');
        if (this.ctx) {
            this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            this.ctx.globalCompositeOperation = 'screen';
        }
    }

    spawnBurstParticles(count) {
        if (this.prefersReducedMotion) return;

        for (let i = 0; i < count; i += 1) {
            this.burstParticles.push({
                x: this.pos.x,
                y: this.pos.y,
                vx: (Math.random() - 0.5) * 1.8 + (this.velocity.x * 0.18),
                vy: (Math.random() - 0.5) * 1.8 + (this.velocity.y * 0.18),
                life: 1,
                decay: 0.03 + (Math.random() * 0.025),
                radius: 1.5 + (Math.random() * 2.2),
            });
        }
    }

    updateMotion(deltaMs) {
        const intensity = INTENSITY_CONFIG[this.settings.customCursorIntensity];
        const magneticPull = { x: 0, y: 0 };

        if (this.activeMagneticElement && !this.prefersReducedMotion) {
            const rect = this.activeMagneticElement.getBoundingClientRect();
            const centerX = rect.left + (rect.width / 2);
            const centerY = rect.top + (rect.height / 2);
            magneticPull.x = (centerX - this.target.x) * intensity.magnetism;
            magneticPull.y = (centerY - this.target.y) * intensity.magnetism;
        }

        const finalTargetX = this.target.x + magneticPull.x;
        const finalTargetY = this.target.y + magneticPull.y;
        const prevX = this.pos.x;
        const prevY = this.pos.y;

        const lerpFactor = 1 - ((1 - intensity.lerp) ** Math.max(1, deltaMs / 16.667));
        this.pos.x += (finalTargetX - this.pos.x) * lerpFactor;
        this.pos.y += (finalTargetY - this.pos.y) * lerpFactor;
        this.velocity.x = this.pos.x - prevX;
        this.velocity.y = this.pos.y - prevY;
    }

    updateTrail(deltaMs) {
        if (!this.ctx || !this.trailCanvas) return;

        const intensity = INTENSITY_CONFIG[this.settings.customCursorIntensity];
        const primary = hexToRgbParts(this.palette.primary);
        const accent = hexToRgbParts(this.palette.accent);
        const highlight = hexToRgbParts(this.palette.highlight);
        const reducedMotion = this.prefersReducedMotion;
        const trailLifeDecay = reducedMotion ? 0.13 : 0.085;

        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (!this.shouldRender()) {
            this.trailPoints = [];
            this.burstParticles = [];
            return;
        }

        const speed = Math.hypot(this.velocity.x, this.velocity.y);
        const trailBudget = reducedMotion
            ? Math.max(5, Math.floor(intensity.trailPoints * 0.45))
            : intensity.trailPoints;

        if (!reducedMotion || this.trailPoints.length === 0) {
            this.trailPoints.push({
                x: this.pos.x,
                y: this.pos.y,
                life: 1,
                speed,
            });
        }

        while (this.trailPoints.length > trailBudget) {
            this.trailPoints.shift();
        }

        for (let i = this.trailPoints.length - 1; i >= 0; i -= 1) {
            const point = this.trailPoints[i];
            point.life -= trailLifeDecay * (deltaMs / 16.667);
            if (point.life <= 0) {
                this.trailPoints.splice(i, 1);
            }
        }

        this.trailPoints.forEach((point, index) => {
            const progress = (index + 1) / Math.max(1, this.trailPoints.length);
            const radius = intensity.trailRadius * (0.24 + (progress * 0.76));
            const alpha = point.life * intensity.trailAlpha * progress * (this.modalActive ? 0.62 : 1);
            const gradient = this.ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);

            gradient.addColorStop(0, `rgba(${rgbPartsToString(highlight)}, ${alpha * 0.3})`);
            gradient.addColorStop(0.4, `rgba(${rgbPartsToString(primary)}, ${alpha * 0.55})`);
            gradient.addColorStop(1, `rgba(${rgbPartsToString(accent)}, 0)`);
            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
        });

        for (let i = this.burstParticles.length - 1; i >= 0; i -= 1) {
            const particle = this.burstParticles[i];
            particle.x += particle.vx * (deltaMs / 16.667);
            particle.y += particle.vy * (deltaMs / 16.667);
            particle.life -= particle.decay * (deltaMs / 16.667);

            if (particle.life <= 0) {
                this.burstParticles.splice(i, 1);
                continue;
            }

            const gradient = this.ctx.createRadialGradient(
                particle.x,
                particle.y,
                0,
                particle.x,
                particle.y,
                particle.radius * 4,
            );
            gradient.addColorStop(0, `rgba(${rgbPartsToString(highlight)}, ${particle.life * 0.8})`);
            gradient.addColorStop(0.55, `rgba(${rgbPartsToString(primary)}, ${particle.life * 0.45})`);
            gradient.addColorStop(1, `rgba(${rgbPartsToString(accent)}, 0)`);
            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.radius * (0.8 + particle.life), 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    updateCursorVisuals() {
        if (!this.cursor || !this.motionShell) return;

        const intensity = INTENSITY_CONFIG[this.settings.customCursorIntensity];
        const speed = Math.hypot(this.velocity.x, this.velocity.y);
        const rotation = this.prefersReducedMotion ? 0 : Math.atan2(this.velocity.y, this.velocity.x) * (180 / Math.PI);
        const stretch = this.prefersReducedMotion
            ? 1
            : 1 + clamp(speed * 0.015, 0, intensity.maxStretch);
        const squash = this.prefersReducedMotion ? 1 : clamp(1 / stretch, 0.82, 1);

        this.cursor.style.transform = `translate3d(${this.pos.x}px, ${this.pos.y}px, 0) rotate(${rotation}deg)`;
        this.motionShell.style.transform = `translate(-50%, -50%) scale(${stretch}, ${squash})`;
    }

    animate(timestamp = performance.now()) {
        if (!this.mounted) return;
        this.animationFrame = null;

        const deltaMs = this.lastFrameTime === null
            ? 16.667
            : clamp(timestamp - this.lastFrameTime, 8, 40);
        this.lastFrameTime = timestamp;

        if (timestamp - this.lastSuppressionCheck >= 180) {
            this.gamepadSuppressed = this.shouldSuppressForGamepad(timestamp);
            this.lastSuppressionCheck = timestamp;
        }

        this.syncPresentation(timestamp);
        this.updateMotion(deltaMs);
        this.updateCursorVisuals();
        this.updateTrail(deltaMs);

        this.scheduleAnimationFrame(this.shouldUseHighFrequencyAnimation(timestamp));
    }
}
