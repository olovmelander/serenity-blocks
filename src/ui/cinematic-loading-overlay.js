/**
 * @fileoverview Reusable cinematic loading overlay with animated star field,
 * decorative rings, and bouncing dots. Used for game mode transitions.
 */

const OVERLAY_ID = 'cinematic-loading-overlay';
const KEYFRAMES_ID = 'cinematic-loading-keyframes';
const GLOBAL_MIN_VISIBLE_MS = 2000;

/**
 * Show a cinematic loading overlay with the given title text.
 * @param {string} title - Text to display (e.g. "SINGLE PLAYER", "INFINITY", "ODYSSEY")
 * @returns {{ shownAt: number }} Metadata for minimum display time tracking
 */
export function showCinematicLoadingOverlay(title) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    _injectKeyframes();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '10002',
        background: 'radial-gradient(ellipse at 50% 60%, #0a0a2e 0%, #050510 50%, #020208 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: '0',
        transition: 'opacity 0.4s ease-in',
        overflow: 'hidden',
    });

    // Star field
    const starField = document.createElement('div');
    Object.assign(starField.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
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
            pointerEvents: 'none',
        });
        starField.appendChild(star);
    }
    overlay.appendChild(starField);

    // Decorative rings
    overlay.appendChild(_createRing(350, 0.1, 3, 0));
    overlay.appendChild(_createRing(420, 0.05, 4, 0.5));

    // Title
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    Object.assign(titleEl.style, {
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: '3.5rem',
        fontWeight: '200',
        letterSpacing: '1.2em',
        paddingLeft: '1.2em',
        color: 'rgba(200, 220, 255, 0.95)',
        animation: 'cinematic-title-glow 3s ease-in-out infinite',
        zIndex: '2',
        userSelect: 'none',
        position: 'relative',
    });
    overlay.appendChild(titleEl);

    // Bouncing dots
    const dotsContainer = document.createElement('div');
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
        });
        dotsContainer.appendChild(dot);
    }
    overlay.appendChild(dotsContainer);

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

            overlay.style.transition = `opacity ${fadeOutMs}ms ease-out`;
            overlay.style.opacity = '0';

            setTimeout(() => {
                if (overlay.isConnected) {
                    overlay.remove();
                }
                resolve();
            }, fadeOutMs + 50);
        };

        if (remainingVisibleMs > 0) {
            setTimeout(startFade, remainingVisibleMs);
        } else {
            startFade();
        }
    });
}

function _createRing(size, opacity, duration, delay) {
    const ring = document.createElement('div');
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
        pointerEvents: 'none',
    });
    return ring;
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
        @keyframes cinematic-title-glow {
            0%, 100% { text-shadow: 0 0 30px rgba(100, 140, 255, 0.3), 0 0 60px rgba(100, 140, 255, 0.1); opacity: 0.9; }
            50% { text-shadow: 0 0 40px rgba(100, 140, 255, 0.5), 0 0 80px rgba(100, 140, 255, 0.2), 0 0 120px rgba(100, 140, 255, 0.1); opacity: 1; }
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
