/**
 * @fileoverview Reusable cinematic loading overlay with animated star field,
 * decorative rings, and bouncing dots. Used for game mode transitions.
 */

const OVERLAY_ID = 'cinematic-loading-overlay';
const KEYFRAMES_ID = 'cinematic-loading-keyframes';
const GLOBAL_MIN_VISIBLE_MS = 2000;
const ROLE_BACKDROP = 'backdrop';
const ROLE_STARS = 'stars';
const ROLE_RING = 'ring';
const ROLE_CONTENT = 'content';
const ROLE_TITLE = 'title';
const ROLE_DOTS = 'dots';
const ROLE_COUNTDOWN_LAYER = 'countdown-layer';
const ROLE_COUNTDOWN_PLATE = 'countdown-plate';
const ROLE_COUNTDOWN_TEXT = 'countdown-text';

/**
 * Show a cinematic loading overlay with the given title text.
 * @param {string} title - Text to display (e.g. "SINGLE PLAYER", "INFINITY", "ODYSSEY")
 * @returns {{ shownAt: number }} Metadata for minimum display time tracking
 */
export function showCinematicLoadingOverlay(title) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const overlay = _createOverlayElement(title);

    document.body.appendChild(overlay);

    const shownAt = Date.now();
    overlay.dataset.shownAt = String(shownAt);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });
    });

    return { shownAt };
}

/**
 * Resolves once the loading overlay has actually been painted at least once and
 * its compositor keyframe animations (drifting stars / bouncing dots / pulsing
 * rings) have been committed to the compositor thread.
 *
 * Call this AFTER {@link showCinematicLoadingOverlay} and BEFORE kicking off heavy,
 * main-thread-blocking / GPU-saturating work (e.g. a cold WebGPU board/theme build).
 * Without it, the overlay is only appended (opacity 0, fade-in scheduled via rAF) and
 * the caller's synchronous build runs in the *same* task — so the browser never paints
 * the overlay until the build finishes, and its transform/opacity animations are never
 * promoted. The user then sees a frozen menu (or a frozen overlay) instead of a live
 * loading animation. Yielding a real paint here gets the overlay on-screen and its
 * animations running on the compositor before the build steals the main thread.
 *
 * @returns {Promise<void>}
 */
export function waitForCinematicLoadingOverlayPresented() {
    return new Promise((resolve) => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        // Headless/test environments (jsdom) have no rAF — resolve on a plain
        // macrotask so this never blocks a build that has no compositor anyway.
        if (typeof requestAnimationFrame !== 'function') {
            setTimeout(done, 0);
            return;
        }
        // rAF#1 + rAF#2: show()'s own double-rAF sets opacity=1 on frame 2; rAF#3
        // lets that style commit + the compositor promote/start the keyframes. The
        // trailing macrotask hop guarantees at least one full present cycle.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(done, 0);
                });
            });
        });
        // Safety net: never let overlay presentation gate the build indefinitely if
        // rAF is starved (e.g. the tab is backgrounded during load).
        setTimeout(done, 250);
    });
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

    const backdrop = overlay.querySelector(`[data-cinematic-role="${ROLE_BACKDROP}"]`);
    const stars = overlay.querySelector(`[data-cinematic-role="${ROLE_STARS}"]`);
    const rings = Array.from(overlay.querySelectorAll(`[data-cinematic-role="${ROLE_RING}"]`));
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
            rings,
            plate,
            text,
        });

        if (typeof onCount === 'function') {
            onCount(value);
        }
    };

    const renderGo = () => {
        const visuals = _getCountdownVisualState('GO');

        text.textContent = 'GO!';
        _applyCountdownVisualState({
            visuals,
            backdrop,
            stars,
            rings,
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
        rings.forEach((ring) => {
            ring.style.transition = 'opacity 260ms ease-out, transform 260ms ease-out';
            ring.style.opacity = '0.34';
            ring.style.transform = 'translate(-50%, -50%) scale(0.98)';
        });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                layer.style.opacity = '1';
                layer.style.transform = 'scale(1)';
                renderCount(currentCount);

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
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

    const shownAt = Number(overlay.dataset.shownAt || Date.now());
    const elapsedMs = Date.now() - shownAt;
    const remainingVisibleMs = Math.max(0, minVisibleMs - elapsedMs);

    return new Promise((resolve) => {
        const startFade = () => {
            if (!overlay.isConnected) {
                resolve();
                return;
            }

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

/**
 * Cinematic "warp into the theme" reveal: the backdrop + starfield accelerate toward
 * the viewer (scale up) and fade, the rings bloom outward, and the title recedes —
 * uncovering the live, already-resuming theme behind. Reads as flying INTO the scene
 * rather than a flat cross-fade. Purely compositor-driven (transform/opacity).
 * @param {HTMLElement} overlay
 * @param {number} durationMs
 */
function _playRevealTransition(overlay, durationMs) {
    const ease = 'cubic-bezier(0.33, 0, 0.2, 1)';
    const q = (role) => overlay.querySelector(`[data-cinematic-role="${role}"]`);

    const backdrop = q(ROLE_BACKDROP);
    const stars = q(ROLE_STARS);
    const content = q(ROLE_CONTENT);
    const rings = Array.from(overlay.querySelectorAll(`[data-cinematic-role="${ROLE_RING}"]`));

    // Starfield rushes toward the viewer + fades (warp), backdrop zooms in behind it.
    if (stars) {
        stars.style.transformOrigin = '50% 50%';
        stars.style.transition = `transform ${durationMs}ms ${ease}, opacity ${Math.round(durationMs * 0.85)}ms ease-out`;
        stars.style.transform = 'scale(2.6)';
        stars.style.opacity = '0';
    }
    if (backdrop) {
        backdrop.style.transformOrigin = '50% 55%';
        backdrop.style.transition = `transform ${durationMs}ms ${ease}, opacity ${durationMs}ms ease-out`;
        backdrop.style.transform = 'scale(1.2)';
        backdrop.style.opacity = '0';
    }
    rings.forEach((ring) => {
        ring.style.transition = `transform ${durationMs}ms ${ease}, opacity ${Math.round(durationMs * 0.7)}ms ease-out`;
        ring.style.transform = 'translate(-50%, -50%) scale(2.8)';
        ring.style.opacity = '0';
    });
    if (content) {
        // Title/dots recede + dissolve slightly ahead of the backdrop.
        content.style.transition = `transform ${Math.round(durationMs * 0.9)}ms ${ease}, opacity ${Math.round(durationMs * 0.55)}ms ease-out`;
        content.style.transform = 'translateY(-14px) scale(1.08)';
        content.style.opacity = '0';
    }

    // The overlay wrapper itself fades a touch later so the zoom reads before it's gone.
    overlay.style.transition = `opacity ${durationMs}ms ease-out`;
    overlay.style.opacity = '0';
}

/**
 * Toggle the overlay's "building" phase. A cold WebGPU theme build saturates the
 * GPU (and blocks the main thread) for ~1s, which would otherwise freeze the
 * overlay's drifting stars / bouncing dots / pulsing rings mid-motion (reads as a
 * broken, hung loading screen). During the build we instead hide those motion
 * elements and freeze the title glow, so the overlay holds a clean, deliberately
 * calm state — there is no animation to visibly stutter. On exit the motion
 * elements fade back in and resume, giving a smooth reveal once the GPU is free.
 *
 * @param {boolean} building - true while the heavy theme build runs
 */
export function setCinematicLoadingOverlayBuilding(building) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    overlay.dataset.building = building ? 'true' : 'false';

    const motionRoles = [ROLE_STARS, ROLE_RING, ROLE_DOTS];
    overlay.querySelectorAll('[data-cinematic-role]').forEach((el) => {
        const role = el.dataset.cinematicRole;
        if (motionRoles.includes(role)) {
            if (building) {
                // Hide instantly (no transition) so the fade itself can't stutter
                // when the build starts blocking a frame later.
                el.style.transition = 'none';
                el.style.opacity = '0';
            } else {
                el.style.transition = 'opacity 420ms ease-out';
                el.style.removeProperty('opacity');
            }
        }
    });

    const title = overlay.querySelector(`[data-cinematic-role="${ROLE_TITLE}"]`);
    if (title) {
        // Keep the title visible with its static glow, but stop the opacity pulse
        // so a mid-pulse freeze isn't visible during the build.
        title.style.animationPlayState = building ? 'paused' : 'running';
    }
}

function _createRing(size, opacity, duration, delay) {
    const ring = document.createElement('div');
    ring.dataset.cinematicRole = ROLE_RING;
    Object.assign(ring.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${size}px`,
        height: `${size}px`,
        border: `1px solid rgba(100, 140, 255, ${opacity})`,
        borderRadius: '50%',
        animation: `cinematic-ring-pulse ${duration}s ease-in-out ${delay}s infinite`,
        // Promote to a compositor layer so the pulse survives main-thread loading work.
        willChange: 'transform, opacity',
        pointerEvents: 'none',
        zIndex: '1',
    });
    return ring;
}

function _getCountdownVisualState(value) {
    if (value === 'GO') {
        return {
            textColor: '#fbbf24',
            textShadow: `
                0 0 18px rgba(251, 191, 36, 0.95),
                0 0 42px rgba(251, 191, 36, 0.72),
                0 14px 34px rgba(2, 6, 23, 0.9)
            `,
            plateBackground: [
                'radial-gradient(circle at 50% 28%, rgba(120, 53, 15, 0.9) 0%, ',
                'rgba(30, 18, 5, 0.88) 54%, rgba(2, 6, 23, 0.92) 100%)',
            ].join(''),
            plateBorder: '1px solid rgba(251, 191, 36, 0.44)',
            plateShadow: [
                '0 26px 72px rgba(2, 6, 23, 0.7)',
                'inset 0 1px 0 rgba(255, 255, 255, 0.16)',
                '0 0 36px rgba(251, 191, 36, 0.18)',
            ].join(', '),
            backdropOpacity: '0.78',
            starsOpacity: '0.56',
            ringOpacity: '0.4',
        };
    }

    if (value >= 3) {
        return {
            textColor: '#ef4444',
            textShadow: `
                0 0 16px rgba(239, 68, 68, 0.92),
                0 0 38px rgba(239, 68, 68, 0.58),
                0 14px 34px rgba(2, 6, 23, 0.9)
            `,
            plateBackground: [
                'radial-gradient(circle at 50% 28%, rgba(127, 29, 29, 0.92) 0%, ',
                'rgba(38, 10, 10, 0.9) 54%, rgba(2, 6, 23, 0.94) 100%)',
            ].join(''),
            plateBorder: '1px solid rgba(248, 113, 113, 0.38)',
            plateShadow: [
                '0 26px 68px rgba(2, 6, 23, 0.72)',
                'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                '0 0 26px rgba(239, 68, 68, 0.16)',
            ].join(', '),
            backdropOpacity: '0.84',
            starsOpacity: '0.48',
            ringOpacity: '0.34',
        };
    }

    if (value === 2) {
        return {
            textColor: '#f59e0b',
            textShadow: `
                0 0 16px rgba(245, 158, 11, 0.94),
                0 0 38px rgba(245, 158, 11, 0.6),
                0 14px 34px rgba(2, 6, 23, 0.9)
            `,
            plateBackground: [
                'radial-gradient(circle at 50% 28%, rgba(120, 53, 15, 0.9) 0%, ',
                'rgba(42, 23, 8, 0.9) 54%, rgba(2, 6, 23, 0.94) 100%)',
            ].join(''),
            plateBorder: '1px solid rgba(251, 191, 36, 0.38)',
            plateShadow: [
                '0 26px 68px rgba(2, 6, 23, 0.72)',
                'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                '0 0 28px rgba(245, 158, 11, 0.14)',
            ].join(', '),
            backdropOpacity: '0.82',
            starsOpacity: '0.5',
            ringOpacity: '0.36',
        };
    }

    return {
        textColor: '#10b981',
        textShadow: `
            0 0 16px rgba(16, 185, 129, 0.96),
            0 0 38px rgba(16, 185, 129, 0.58),
            0 14px 34px rgba(2, 6, 23, 0.9)
        `,
        plateBackground: [
            'radial-gradient(circle at 50% 28%, rgba(6, 95, 70, 0.92) 0%, ',
            'rgba(6, 40, 31, 0.9) 54%, rgba(2, 6, 23, 0.94) 100%)',
        ].join(''),
        plateBorder: '1px solid rgba(52, 211, 153, 0.38)',
        plateShadow: [
            '0 26px 68px rgba(2, 6, 23, 0.72)',
            'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
            '0 0 26px rgba(16, 185, 129, 0.14)',
        ].join(', '),
        backdropOpacity: '0.8',
        starsOpacity: '0.54',
        ringOpacity: '0.38',
    };
}

function _applyCountdownVisualState({
    visuals,
    backdrop,
    stars,
    rings,
    plate,
    text,
}) {
    if (backdrop) {
        backdrop.style.opacity = visuals.backdropOpacity;
    }
    if (stars) {
        stars.style.opacity = visuals.starsOpacity;
    }
    rings.forEach((ring) => {
        ring.style.opacity = visuals.ringOpacity;
    });

    plate.style.background = visuals.plateBackground;
    plate.style.border = visuals.plateBorder;
    plate.style.boxShadow = visuals.plateShadow;

    text.style.color = visuals.textColor;
    text.style.textShadow = visuals.textShadow;
    text.style.webkitTextStroke = '2.5px rgba(2, 6, 23, 0.92)';
    text.style.paintOrder = 'stroke fill';
}

function _createOverlayElement(title) {
    _injectKeyframes();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.dataset.odysseyWheelLock = 'true';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '10002',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: '0',
        transition: 'opacity 0.4s ease-in',
        overflow: 'hidden',
        pointerEvents: 'none',
    });

    const backdrop = document.createElement('div');
    backdrop.dataset.cinematicRole = ROLE_BACKDROP;
    Object.assign(backdrop.style, {
        position: 'absolute',
        inset: '0',
        background: 'radial-gradient(ellipse at 50% 60%, #0a0a2e 0%, #050510 50%, #020208 100%)',
        zIndex: '0',
    });
    overlay.appendChild(backdrop);

    const starField = document.createElement('div');
    starField.dataset.cinematicRole = ROLE_STARS;
    Object.assign(starField.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '1',
    });

    for (let i = 0; i < 60; i++) {
        const star = document.createElement('div');
        const size = 1 + Math.random() * 2.5;
        const hue = 200 + Math.random() * 60;
        const brightness = 0.5 + Math.random() * 0.5;

        Object.assign(star.style, {
            position: 'absolute',
            left: `${Math.random() * 100}%`,
            top: `${100 + Math.random() * 20}%`,
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: '50%',
            background: `hsla(${hue}, 80%, 80%, ${brightness})`,
            boxShadow: `0 0 ${size * 3}px hsla(${hue}, 80%, 70%, 0.5)`,
            animation: `cinematic-star-drift ${4 + Math.random() * 6}s linear ${Math.random() * 3}s infinite`,
            willChange: 'transform, opacity',
            pointerEvents: 'none',
        });
        starField.appendChild(star);
    }
    overlay.appendChild(starField);

    overlay.appendChild(_createRing(350, 0.1, 3, 0));
    overlay.appendChild(_createRing(420, 0.05, 4, 0.5));

    const content = document.createElement('div');
    content.dataset.cinematicRole = ROLE_CONTENT;
    Object.assign(content.style, {
        position: 'relative',
        zIndex: '2',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
    });

    const titleEl = document.createElement('div');
    titleEl.dataset.cinematicRole = ROLE_TITLE;
    titleEl.textContent = title;
    Object.assign(titleEl.style, {
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: '3.5rem',
        fontWeight: '200',
        letterSpacing: '1.2em',
        paddingLeft: '1.2em',
        color: 'rgba(200, 220, 255, 0.95)',
        // Static glow (the keyframe only pulses opacity — compositor-driven, so the
        // title keeps breathing even while loading work blocks the main thread).
        textShadow: '0 0 30px rgba(100, 140, 255, 0.4), 0 0 70px rgba(100, 140, 255, 0.15)',
        animation: 'cinematic-title-glow 3s ease-in-out infinite',
        willChange: 'opacity',
        zIndex: '2',
        userSelect: 'none',
        position: 'relative',
    });
    content.appendChild(titleEl);

    const dotsContainer = document.createElement('div');
    dotsContainer.dataset.cinematicRole = ROLE_DOTS;
    Object.assign(dotsContainer.style, {
        display: 'flex',
        gap: '12px',
        marginTop: '1.5rem',
        zIndex: '2',
    });

    for (let d = 0; d < 3; d++) {
        const dot = document.createElement('div');
        Object.assign(dot.style, {
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'rgba(160, 190, 255, 0.7)',
            boxShadow: '0 0 8px rgba(120, 160, 255, 0.4)',
            animation: `cinematic-dot-bounce 1.4s ease-in-out ${d * 0.2}s infinite`,
            willChange: 'transform, opacity',
        });
        dotsContainer.appendChild(dot);
    }
    content.appendChild(dotsContainer);
    overlay.appendChild(content);

    return overlay;
}

function _ensureCountdownLayer(overlay) {
    let layer = overlay.querySelector(`[data-cinematic-role="${ROLE_COUNTDOWN_LAYER}"]`);
    if (!layer) {
        layer = document.createElement('div');
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
        plate = document.createElement('div');
        plate.dataset.cinematicRole = ROLE_COUNTDOWN_PLATE;
        Object.assign(plate.style, {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(84vw, 460px)',
            minWidth: '280px',
            height: 'min(34vh, 280px)',
            minHeight: '210px',
            borderRadius: '34px',
            background: [
                'radial-gradient(circle at 50% 28%, rgba(127, 29, 29, 0.92) 0%, ',
                'rgba(38, 10, 10, 0.9) 54%, rgba(2, 6, 23, 0.94) 100%)',
            ].join(''),
            border: '1px solid rgba(248, 113, 113, 0.38)',
            boxShadow: [
                '0 26px 68px rgba(2, 6, 23, 0.72)',
                'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                '0 0 26px rgba(239, 68, 68, 0.16)',
            ].join(', '),
            backdropFilter: 'blur(24px) saturate(115%)',
            WebkitBackdropFilter: 'blur(24px) saturate(115%)',
            pointerEvents: 'none',
        });
        layer.appendChild(plate);
    }

    let text = layer.querySelector(`[data-cinematic-role="${ROLE_COUNTDOWN_TEXT}"]`);
    if (!text) {
        text = document.createElement('div');
        text.dataset.cinematicRole = ROLE_COUNTDOWN_TEXT;
        Object.assign(text.style, {
            position: 'relative',
            zIndex: '1',
            fontFamily: "'Orbitron', 'Arial', sans-serif",
            fontSize: 'clamp(120px, 16vw, 170px)',
            fontWeight: '900',
            lineHeight: '1',
            letterSpacing: '0.08em',
            paddingLeft: '0.08em',
            userSelect: 'none',
            textAlign: 'center',
        });
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

function _injectKeyframes() {
    if (document.getElementById(KEYFRAMES_ID)) return;

    const style = document.createElement('style');
    style.id = KEYFRAMES_ID;
    style.textContent = `
        @keyframes cinematic-star-drift {
            0% { transform: translateY(0) translateX(0); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(-100vh) translateX(20px); opacity: 0; }
        }
        /* Compositor-only: text-shadow is a PAINT property (main thread), so animating it
           froze the whole overlay whenever loading work blocked the main thread. The glow
           is now a static shadow on the element; only opacity (compositable) pulses. */
        @keyframes cinematic-title-glow {
            0%, 100% { opacity: 0.82; }
            50% { opacity: 1; }
        }
        @keyframes cinematic-dot-bounce {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
            40% { transform: translateY(-10px); opacity: 1; }
        }
        @keyframes cinematic-ring-pulse {
            0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.15; }
            50% { transform: translate(-50%, -50%) scale(1.05); opacity: 0.25; }
        }
    `;
    document.head.appendChild(style);
}
