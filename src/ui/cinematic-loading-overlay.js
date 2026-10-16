/**
 * @fileoverview Every mode's loading cover, in the loading language of the boot's loading
 * screen (First Light): the opening world's first frame painted in CSS (a near-black void,
 * abyssal light rising from below, motes, a breathing halo behind the mode's name), a guide to
 * breathe by and a progress line that follows the mode's real entry milestones. Motion is
 * transform/opacity only (ADR-0020). The shared parts live in main.css (.sb-void-*,
 * .sb-breath-guide, .sb-progress-line); the cover's layout in cinematic-loading.css.
 */

import { createCinematicLoadingSurface } from './cinematic-loading-surface.js';
import { getModeLoadingWordmark } from './mode-loading-wordmarks.js';

const OVERLAY_ID = 'cinematic-loading-overlay';
const loadingSurfaces = new WeakMap();
const GLOBAL_MIN_VISIBLE_MS = 2000;
const ROLE_BACKDROP = 'backdrop';
const ROLE_STARS = 'stars';
const ROLE_CONTENT = 'content';
const ROLE_TITLE = 'title';
const ROLE_LOADING = 'loading';
const ROLE_PROGRESS = 'progress';
const ROLE_COUNTDOWN_LAYER = 'countdown-layer';
const ROLE_COUNTDOWN_PLATE = 'countdown-plate';
const ROLE_COUNTDOWN_TEXT = 'countdown-text';

/**
 * A mode entry's milestones on the progress line, in the order entry reaches them. A mode
 * marks the ones it has; the line never runs back, and it fills as the cover lifts.
 */
export const MODE_LOADING_STEPS = Object.freeze({
    shown: 0.06,
    presented: 0.16, // the cover is painted; heavy work may start
    prepared: 0.3, // pending pipelines / theme switch drained
    activated: 0.48, // the mode's UI and board are built
    started: 0.6, // the mode (and its theme) started
    themeReady: 0.74,
    contentLoaded: 0.86, // the theme's streamed content is in
    settled: 0.95, // its pipelines have settled
    done: 1,
});

/**
 * Show a cinematic loading overlay with the given title text.
 * A cover for the same title that is still loading is kept (a mode that shows its own cover
 * adopts the one main put up the moment its card was chosen), so the motion never restarts.
 * @param {string} title - Text to display (e.g. "SINGLE PLAYER", "INFINITY", "ODYSSEY")
 * @param {{ themeManager?: object }} [options] Optional owner for async theme loading.
 * @returns {{ shownAt: number }} Metadata for minimum display time tracking
 */
export function showCinematicLoadingOverlay(title, { themeManager } = {}) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing && existing.dataset.phase === 'loading' && existing.dataset.leaving !== 'true'
        && existing.dataset.title === String(title ?? '')) {
        if (themeManager && !loadingSurfaces.has(existing)) {
            loadingSurfaces.set(existing, createCinematicLoadingSurface(themeManager));
        }
        return { shownAt: Number(existing.dataset.shownAt) || Date.now() };
    }
    if (existing) {
        _releaseLoadingSurface(existing, false);
        existing.remove();
    }

    const overlay = _createOverlayElement(title);
    if (themeManager) loadingSurfaces.set(overlay, createCinematicLoadingSurface(themeManager));

    document.body.appendChild(overlay);

    const shownAt = Date.now();
    overlay.dataset.shownAt = String(shownAt);
    _writeProgress(overlay, MODE_LOADING_STEPS.shown);

    return { shownAt };
}

/**
 * Move the cover's progress line to a milestone (a MODE_LOADING_STEPS name or 0..1). It only
 * moves forward; light runs along it in between.
 * @param {keyof typeof MODE_LOADING_STEPS | number} step
 * @returns {number|null} the line's value, or null when no cover is up
 */
export function setCinematicLoadingProgress(step) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return null;
    const value = typeof step === 'number' ? step : MODE_LOADING_STEPS[step];
    if (!Number.isFinite(value)) return Number(overlay.dataset.progress) || 0;
    return _writeProgress(overlay, value);
}

function _writeProgress(overlay, value) {
    const current = Number(overlay.dataset.progress) || 0;
    const next = Math.max(current, Math.min(1, Math.max(0, value)));
    if (next === current && overlay.dataset.progress) return current;
    overlay.dataset.progress = next.toFixed(3);
    overlay.style.setProperty?.('--sb-progress', next.toFixed(3));
    return next;
}

/**
 * Decode the mode artwork, then commit the cover and its animations before heavy work.
 * Also waits (bounded) for an owned theme loading surface's async backend preload.
 * A timeout keeps backgrounded windows and unavailable backends from blocking entry.
 * @returns {Promise<void>}
 */
export async function waitForCinematicLoadingOverlayPresented() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    await Promise.all([
        _waitForLoadingArtwork(overlay),
        loadingSurfaces.get(overlay)?.ready,
    ]);
    if (!overlay.isConnected) return;
    await new Promise((resolve) => {
        let settled = false;
        let timer;
        const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
        };
        // A backgrounded window must not prevent loading from completing.
        timer = setTimeout(done, 250);
        if (typeof requestAnimationFrame !== 'function') {
            setTimeout(done, 0);
            return;
        }
        // Commit an opaque cover and promote its animated children before the
        // next task can start synchronous scene/board creation.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setTimeout(done, 0));
            });
        });
    });
}

function _waitForLoadingArtwork(overlay) {
    const images = [...overlay.querySelectorAll('img')];
    return new Promise((resolve) => {
        // A missing/slow asset must not trap the player on the loading screen.
        const timer = setTimeout(resolve, 750);
        Promise.all(images.map((artwork) => Promise.resolve()
            .then(() => artwork.decode?.())
            .catch(() => {})))
            .finally(() => { clearTimeout(timer); resolve(); });
    });
}

function _releaseLoadingSurface(overlay, retain = true) {
    const surface = loadingSurfaces.get(overlay);
    loadingSurfaces.delete(overlay);
    if (retain) surface?.uncover();
    else surface?.cancel();
}

/**
 * Morph the existing cinematic loading overlay into an in-place countdown.
 * @param {{
 *   startCount?: number,
 *   countIntervalMs?: number,
 *   goHoldMs?: number,
 *   overlayFadeMs?: number,
 *   onFirstCountVisible?: Function|null,
 *   onCount?: Function|null,
 *   onGo?: Function|null
 * }} [options]
 * @returns {Promise<void>}
 */
export function transitionCinematicLoadingOverlayToCountdown(options = {}) {
    const {
        startCount = 5,
        countIntervalMs = 1000,
        goHoldMs = 700,
        overlayFadeMs = 260,
        onFirstCountVisible = null,
        onCount = null,
        onGo = null,
    } = options;

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
        overlay = _createOverlayElement('');
        overlay.dataset.shownAt = String(Date.now());
        overlay.style.opacity = '1';
        document.body.appendChild(overlay);
    }

    overlay.dataset.phase = 'countdown';
    overlay.ariaBusy = 'false';
    _writeProgress(overlay, MODE_LOADING_STEPS.done);
    _releaseLoadingSurface(overlay);

    const backdrop = overlay.querySelector(`[data-cinematic-role="${ROLE_BACKDROP}"]`);
    const stars = overlay.querySelector(`[data-cinematic-role="${ROLE_STARS}"]`);
    const content = overlay.querySelector(`[data-cinematic-role="${ROLE_CONTENT}"]`);
    const { layer, plate, text } = _ensureCountdownLayer(overlay);

    let currentCount = startCount;
    let firstCountCallbackTriggered = false;

    const notifyFirstCountVisible = () => {
        if (firstCountCallbackTriggered || typeof onFirstCountVisible !== 'function') {
            return;
        }
        firstCountCallbackTriggered = true;
        Promise.resolve(onFirstCountVisible()).catch((error) => {
            console.warn('[CinematicOverlay] First-count callback failed:', error);
        });
    };

    const renderCount = (value) => {
        const visuals = _getCountdownVisualState(value);

        text.textContent = String(value);
        _applyCountdownVisualState({
            visuals,
            backdrop,
            stars,
            layer,
            plate,
            text,
        });

        if (typeof onCount === 'function') {
            onCount(value);
        }
    };

    const renderGo = () => {
        const visuals = _getCountdownVisualState('GO');

        text.textContent = 'GO';
        _applyCountdownVisualState({
            visuals,
            backdrop,
            stars,
            layer,
            plate,
            text,
        });

        if (typeof onGo === 'function') {
            onGo();
        }
    };

    return new Promise((resolve) => {
        const removeOverlay = () => {
            if (!overlay.isConnected) {
                resolve();
                return;
            }

            overlay.style.transition = `opacity ${overlayFadeMs}ms ease-out`;
            overlay.style.opacity = '0';

            setTimeout(() => {
                if (overlay.isConnected) {
                    overlay.remove();
                }
                resolve();
            }, overlayFadeMs + 50);
        };

        const continueCountdown = () => {
            if (!overlay.isConnected) {
                resolve();
                return;
            }
            currentCount -= 1;

            if (currentCount > 0) {
                renderCount(currentCount);
                setTimeout(continueCountdown, countIntervalMs);
                return;
            }

            renderGo();
            setTimeout(removeOverlay, goHoldMs);
        };

        if (content) {
            content.style.transition = 'opacity 220ms ease-out, transform 220ms ease-out';
            content.style.opacity = '0';
            content.style.transform = 'translateY(-16px) scale(0.98)';
        }
        if (backdrop) {
            backdrop.style.transition = 'opacity 260ms ease-out';
            backdrop.style.opacity = '0.84';
        }
        if (stars) {
            stars.style.transition = 'opacity 260ms ease-out';
            stars.style.opacity = '0.48';
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!overlay.isConnected) {
                    resolve();
                    return;
                }
                layer.style.opacity = '1';
                layer.style.transform = 'scale(1)';
                renderCount(currentCount);

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (!overlay.isConnected) {
                            resolve();
                            return;
                        }
                        notifyFirstCountVisible();
                        setTimeout(continueCountdown, countIntervalMs);
                    });
                });
            });
        });
    });
}

/**
 * Smoothly dismiss the cinematic loading overlay.
 * Enforces a global minimum visible duration by default.
 * @param {number|{fadeOutMs?: number, minVisibleMs?: number}} [options=800]
 * @returns {Promise<void>} Resolves after the overlay has been removed
 */
export function dismissCinematicLoadingOverlay(options = 800) {
    const fadeOutMs = typeof options === 'number'
        ? options
        : (options?.fadeOutMs ?? 800);
    const minVisibleMs = typeof options === 'number'
        ? GLOBAL_MIN_VISIBLE_MS
        : (options?.minVisibleMs ?? GLOBAL_MIN_VISIBLE_MS);

    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return Promise.resolve();
    // On its way out: a new show for the same mode builds a fresh cover instead of adopting it.
    overlay.dataset.leaving = 'true';

    const shownAt = Number(overlay.dataset.shownAt || Date.now());
    const elapsedMs = Date.now() - shownAt;
    const remainingVisibleMs = Math.max(0, minVisibleMs - elapsedMs);

    return new Promise((resolve) => {
        const startFade = () => {
            if (!overlay.isConnected) {
                resolve();
                return;
            }

            _releaseLoadingSurface(overlay);
            _writeProgress(overlay, MODE_LOADING_STEPS.done);
            _playRevealTransition(overlay, fadeOutMs);

            setTimeout(() => {
                if (overlay.isConnected) {
                    overlay.remove();
                }
                resolve();
            }, fadeOutMs + 60);
        };

        if (remainingVisibleMs > 0) {
            setTimeout(startFade, remainingVisibleMs);
        } else {
            startFade();
        }
    });
}

/** Fade the prepared scene in beneath the same gently drifting loading surface. */
function _playRevealTransition(overlay, durationMs) {
    overlay.dataset.phase = 'dismissing';
    overlay.ariaBusy = 'false';
    const content = overlay.querySelector(`[data-cinematic-role="${ROLE_CONTENT}"]`);
    if (content) {
        content.style.transition = `opacity ${Math.round(durationMs * 0.65)}ms ease-out`;
        content.style.opacity = '0';
    }
    overlay.style.transition = `opacity ${durationMs}ms ease-out`;
    overlay.style.opacity = '0';
}

/**
 * Keep cold-build feedback visible. These animations use only compositor-owned
 * transform/opacity; hiding them made healthy loads look stalled. Async loading
 * surfaces protect theme render compilation; synchronous GPU bakes can still stall.
 * @param {boolean} building
 */
export function setCinematicLoadingOverlayBuilding(building) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.dataset.building = building ? 'true' : 'false';
}

// The countdown: the logo's spectrum walks down the count (lavender, aqua, mint) and lands on
// coral for GO, the colour of every primary action. Each count is a ring of light in its
// colour over the void (as the opening's wave and the stack's lock are), not a panel.
const COUNTDOWN_HUES = Object.freeze({
    high: { color: '#b8a4ff', rgb: '184, 164, 255' },
    two: { color: '#9ee8ed', rgb: '158, 232, 237' },
    one: { color: '#c5f1cf', rgb: '197, 241, 207' },
    go: { color: '#ffac88', rgb: '255, 172, 136' },
});

const COUNTDOWN_BACKDROP_OPACITY = Object.freeze({
    high: '0.84',
    two: '0.82',
    one: '0.8',
    go: '0.78',
});
const COUNTDOWN_STARS_OPACITY = Object.freeze({
    high: '0.48',
    two: '0.5',
    one: '0.54',
    go: '0.56',
});

function _getCountdownVisualState(value) {
    let key = 'one';
    if (value === 'GO') key = 'go';
    else if (value >= 3) key = 'high';
    else if (value === 2) key = 'two';
    const { color, rgb } = COUNTDOWN_HUES[key];
    return {
        key,
        textColor: color,
        textShadow: `0 0 26px rgba(${rgb}, 0.5), 0 0 64px rgba(${rgb}, 0.26)`,
        plateBackground: `radial-gradient(circle, rgba(${rgb}, 0.14) 0%, rgba(${rgb}, 0.05) 42%, transparent 70%)`,
        plateBorder: `1px solid rgba(${rgb}, 0.34)`,
        plateShadow: `0 0 46px rgba(${rgb}, 0.16), inset 0 0 38px rgba(${rgb}, 0.1)`,
        backdropOpacity: COUNTDOWN_BACKDROP_OPACITY[key],
        starsOpacity: COUNTDOWN_STARS_OPACITY[key],
    };
}

function _applyCountdownVisualState({
    visuals,
    backdrop,
    stars,
    layer,
    plate,
    text,
}) {
    if (backdrop) {
        backdrop.style.opacity = visuals.backdropOpacity;
    }
    if (stars) {
        stars.style.opacity = visuals.starsOpacity;
    }
    // CSS (keystone-overlays.css) styles each count from the layer's data-count.
    if (layer) layer.dataset.count = visuals.key;

    plate.style.background = visuals.plateBackground;
    plate.style.border = visuals.plateBorder;
    plate.style.boxShadow = visuals.plateShadow;

    text.style.color = visuals.textColor;
    text.style.textShadow = visuals.textShadow;

    // Each number drops a few pixels and locks, like a piece landing.
    const reduced = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!reduced && typeof text.animate === 'function') {
        text.animate(
            [{ opacity: 0.4, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }],
            { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' },
        );
    }
    // ...and its ring opens out to meet it.
    if (!reduced && typeof plate.animate === 'function') {
        plate.animate(
            [
                { opacity: 0.3, transform: 'translate(-50%, -50%) scale(0.84)' },
                { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
            ],
            { duration: 560, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' },
        );
    }
}

function _createOverlayElement(title) {
    const element = (tag, className, role) => {
        const node = document.createElement(tag);
        node.className = className;
        if (role) node.dataset.cinematicRole = role;
        return node;
    };
    const overlay = element('div', 'cinematic-loading');
    overlay.id = OVERLAY_ID;
    overlay.dataset.odysseyWheelLock = 'true';
    overlay.dataset.phase = 'loading';
    overlay.dataset.title = String(title ?? '');
    overlay.role = 'status';
    overlay.ariaLive = 'polite';
    overlay.ariaBusy = 'true';
    overlay.ariaLabel = title ? `Loading ${title}` : 'Loading Serenity Blocks';
    // Cover immediately; only the decorative children animate. A fade-in would
    // expose the menu while its renderer is busy preparing the selected mode.
    overlay.style.opacity = '1';

    // The world's first frame: the void, and the light rising from below, breathing.
    const backdrop = element('div', 'cinematic-loading__backdrop', ROLE_BACKDROP);
    backdrop.ariaHidden = 'true';
    backdrop.appendChild(element('div', 'cinematic-loading__light sb-void-light'));
    overlay.appendChild(backdrop);
    // Stars thinning toward the light, and motes rising through it at two depths.
    const sky = element('div', 'cinematic-loading__sky', ROLE_STARS);
    sky.ariaHidden = 'true';
    sky.appendChild(element('div', 'cinematic-loading__stars sb-starfield sb-void-stars'));
    const motes = element('div', 'cinematic-loading__motes sb-void-motes');
    motes.appendChild(document.createElement('i'));
    motes.appendChild(document.createElement('i'));
    sky.appendChild(motes);
    overlay.appendChild(sky);
    overlay.appendChild(element('div', 'cinematic-loading__vignette sb-void-vignette'));

    const content = element('div', 'cinematic-loading__content', ROLE_CONTENT);
    const glow = element('div', 'cinematic-loading__glow sb-void-halo');
    glow.ariaHidden = 'true';
    content.appendChild(glow);
    const wordmark = getModeLoadingWordmark(title);
    if (wordmark?.eyebrow) {
        const eyebrow = element('p', 'cinematic-loading__eyebrow');
        eyebrow.textContent = wordmark.eyebrow;
        content.appendChild(eyebrow);
    }
    const titleEl = element('h2', 'cinematic-loading__title', ROLE_TITLE);
    if (wordmark) {
        if (wordmark.wide) titleEl.className += ' cinematic-loading__title--wide';
        const lettering = element('img', 'cinematic-loading__wordmark');
        lettering.src = wordmark.src;
        lettering.alt = wordmark.label;
        lettering.width = wordmark.width;
        lettering.height = wordmark.height;
        titleEl.appendChild(lettering);
    } else {
        const lettering = element('span', 'cinematic-loading__wordmark');
        lettering.textContent = title || 'GET READY';
        titleEl.appendChild(lettering);
    }
    content.appendChild(titleEl);
    if (wordmark?.variant) {
        const variant = element('p', 'cinematic-loading__variant');
        variant.textContent = wordmark.variant;
        content.appendChild(variant);
    }
    const tagline = element('p', 'cinematic-loading__tagline');
    tagline.textContent = 'Stack \u00b7 Breath \u00b7 Ascend';
    content.appendChild(tagline);
    overlay.appendChild(content);

    // Below: a guide to breathe by (the world's breath, in 4 s, out 6 s) and the progress line.
    const footer = element('div', 'cinematic-loading__footer', ROLE_LOADING);
    footer.ariaHidden = 'true';
    const breath = element('div', 'cinematic-loading__breath sb-breath-guide');
    for (const [kind, words] of [['in', 'Breathe in'], ['out', 'Breathe out'], ['still', 'Preparing your space']]) {
        const word = element('span', `sb-breath-guide__word sb-breath-guide__word--${kind}`);
        word.textContent = words;
        breath.appendChild(word);
    }
    footer.appendChild(breath);
    const progress = element('div', 'cinematic-loading__progress sb-progress-line', ROLE_PROGRESS);
    progress.appendChild(element('i', 'sb-progress-line__fill'));
    footer.appendChild(progress);
    overlay.appendChild(footer);
    return overlay;
}

function _ensureCountdownLayer(overlay) {
    let layer = overlay.querySelector(`[data-cinematic-role="${ROLE_COUNTDOWN_LAYER}"]`);
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'cinematic-countdown';
        layer.dataset.cinematicRole = ROLE_COUNTDOWN_LAYER;
        Object.assign(layer.style, {
            position: 'absolute',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: '0',
            transform: 'scale(0.96)',
            transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            zIndex: '3',
            pointerEvents: 'none',
            overflow: 'visible',
        });
        overlay.appendChild(layer);
    }

    let plate = layer.querySelector(`[data-cinematic-role="${ROLE_COUNTDOWN_PLATE}"]`);
    if (!plate) {
        // Static look lives in keystone-overlays.css (.cinematic-countdown__plate): a night
        // panel. No backdrop blur — the live game is already drawing.
        plate = document.createElement('div');
        plate.className = 'cinematic-countdown__plate';
        plate.dataset.cinematicRole = ROLE_COUNTDOWN_PLATE;
        layer.appendChild(plate);
    }

    let text = layer.querySelector(`[data-cinematic-role="${ROLE_COUNTDOWN_TEXT}"]`);
    if (!text) {
        text = document.createElement('div');
        text.className = 'cinematic-countdown__text';
        text.dataset.cinematicRole = ROLE_COUNTDOWN_TEXT;
        layer.appendChild(text);
    }

    plate = layer.querySelector(`[data-cinematic-role="${ROLE_COUNTDOWN_PLATE}"]`);
    text = layer.querySelector(`[data-cinematic-role="${ROLE_COUNTDOWN_TEXT}"]`);

    return {
        layer,
        plate,
        text,
    };
}
