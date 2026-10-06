/**
 * @fileoverview The keystone focus marker.
 *
 * One coral tile — the logo's tile that completes the O — drops onto the top-right
 * corner of whichever control has keyboard or controller focus, in every menu. It is
 * decorative (aria-hidden); controls keep their own focus outline. Pointer users never
 * see it: hover states belong to the controls themselves.
 *
 * Cost: no per-frame work at rest. The tile is placed on focus changes, scroll and
 * resize, with a short rAF burst after each focus change while entrances settle, and
 * re-checked every 400 ms while it shows — a focused control can be removed or hidden
 * without any focus event (closing a surface), and the tile must never be left behind.
 * Styles: `.sb-keystone` in public/styles/keystone.css.
 */
import { getInputMode } from './input-mode.js';

const TILE = 12;
const OVERHANG = 4;
const SETTLE_MS = 420;
// Drop and lock: `translate` composes with the inline position transform.
const DROP_KEYFRAMES = [
    { translate: '0 -12px', filter: 'brightness(1.7)' },
    { translate: '0 1px', offset: 0.7 },
    { translate: '0 0', filter: 'brightness(1)' },
];
const DROP_TIMING = { duration: 240, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' };
// Controls that carry their own keystone, and text fields (a tile beside a caret distracts).
const EXCLUDED = [
    '.game-mode-card',
    '[data-keystone="none"]',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="number"]',
    'input:not([type])',
    'textarea',
    '[contenteditable="true"]',
].join(',');

let installed = false;

function isClippedOut(element, x, y) {
    let node = element.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 30) {
        const style = getComputedStyle(node);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
            const rect = node.getBoundingClientRect();
            if (x < rect.left - 1 || x > rect.right + 1 || y < rect.top - 1 || y > rect.bottom + 1) {
                return true;
            }
        }
        node = node.parentElement;
        depth += 1;
    }
    return x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
}

function isRendered(element) {
    if (typeof element.checkVisibility !== 'function') return true;
    return element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        // Older Chromium spellings of the same two options.
        checkOpacity: true,
        checkVisibilityCSS: true,
    });
}

function wantsKeystone(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    if (typeof element.closest !== 'function' || element.closest(EXCLUDED)) return false;
    if (!isRendered(element)) return false;
    const mode = getInputMode();
    if (mode === 'pointer') return false;
    if (mode === 'gamepad') return true;
    try {
        return element.matches(':focus-visible');
    } catch {
        return false;
    }
}

export function installKeystoneFocus() {
    if (installed || typeof document === 'undefined' || !document.body) return;
    installed = true;

    const tile = document.createElement('div');
    tile.className = 'sb-keystone';
    tile.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tile);

    let target = null;
    let frame = 0;
    let settleUntil = 0;
    let shownAt = null;
    let watch = 0;

    const hide = () => {
        tile.classList.remove('is-visible');
        shownAt = null;
    };

    const release = () => {
        target = null;
        hide();
        if (watch) {
            clearInterval(watch);
            watch = 0;
        }
    };

    const place = () => {
        frame = 0;
        if (!target || !target.isConnected) {
            release();
            return;
        }
        const rect = target.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4 || isClippedOut(target, rect.right - 2, rect.top + 2)) {
            hide();
        } else {
            const x = Math.round(rect.right - TILE + OVERHANG);
            const y = Math.round(rect.top - OVERHANG);
            const key = `${x},${y}`;
            if (key !== shownAt) {
                tile.style.transform = `translate3d(${x}px, ${y}px, 0)`;
                shownAt = key;
            }
            tile.classList.add('is-visible');
        }
        if (performance.now() < settleUntil) frame = requestAnimationFrame(place);
    };

    const schedule = (settleMs = 0) => {
        if (settleMs) settleUntil = Math.max(settleUntil, performance.now() + settleMs);
        if (!frame) frame = requestAnimationFrame(place);
    };

    const recheck = () => {
        if (target && target === document.activeElement && wantsKeystone(target)) schedule();
        else release();
    };

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const lock = () => {
        if (reducedMotion?.matches || typeof tile.animate !== 'function') return;
        tile.animate(DROP_KEYFRAMES, DROP_TIMING);
    };

    const follow = (element) => {
        if (!wantsKeystone(element)) {
            release();
            return;
        }
        const changed = element !== target;
        target = element;
        if (changed) lock();
        schedule(SETTLE_MS);
        if (!watch) watch = setInterval(recheck, 400);
    };

    document.addEventListener('focusin', (event) => follow(event.target), true);
    document.addEventListener('focusout', () => {
        // Focus may be moving to another control; decide once it lands.
        setTimeout(() => {
            if (document.activeElement && document.activeElement !== document.body) return;
            release();
        }, 0);
    }, true);
    document.addEventListener('scroll', () => { if (target) schedule(); }, { capture: true, passive: true });
    window.addEventListener('resize', () => { if (target) schedule(); }, { passive: true });
    window.addEventListener('sb:inputmode', () => follow(document.activeElement));
}
