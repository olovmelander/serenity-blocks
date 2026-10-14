/**
 * @fileoverview The focus ring for keyboard and controller players.
 *
 * A controller moves focus with `.focus()`, which never matches `:focus-visible` once the
 * mouse has been used, so a control's own focus outline does not show for it. One cream
 * ring follows focus instead, drawn around whichever control has it, in every menu, but
 * only where the control is not already drawing an outline of its own (keyboard focus on
 * most controls). It is decorative (aria-hidden). Pointer users never see it.
 *
 * Cost: no per-frame work at rest. The ring is placed on focus changes, scroll and
 * resize, with a short rAF burst after each focus change while entrances settle, and
 * re-checked every 400 ms while it shows — a focused control can be removed or hidden
 * without any focus event (closing a surface), and the ring must never be left behind.
 * Styles: `.sb-focus-ring` in public/styles/keystone.css.
 */
import { getInputMode } from './input-mode.js';

const GAP = 3;
const SETTLE_MS = 420;
// Controls that mark focus themselves, and text fields (they show focus in their field).
const EXCLUDED = [
    '.game-mode-card',
    '[data-focus-ring="none"]',
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

function wantsRing(element, { checkRendered = true } = {}) {
    if (!element || element === document.body || element === document.documentElement) return false;
    if (typeof element.closest !== 'function' || element.closest(EXCLUDED)) return false;
    if (checkRendered && !isRendered(element)) return false;
    const mode = getInputMode();
    if (mode === 'pointer') return false;
    if (mode !== 'gamepad') {
        try {
            if (!element.matches(':focus-visible')) return false;
        } catch {
            return false;
        }
    }
    // A control that draws its own focus outline needs no second ring.
    return getComputedStyle(element).outlineStyle === 'none';
}

export function installFocusRing() {
    if (installed || typeof document === 'undefined' || !document.body) return;
    installed = true;

    const ring = document.createElement('div');
    ring.className = 'sb-focus-ring';
    ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring);

    let target = null;
    let frame = 0;
    let settleUntil = 0;
    let shownAt = null;
    let watch = 0;

    const hide = () => {
        ring.classList.remove('is-visible');
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
        if (rect.width < 4 || rect.height < 4
            || isClippedOut(target, rect.left + rect.width / 2, rect.top + rect.height / 2)) {
            hide();
        } else {
            const x = Math.round(rect.left - GAP);
            const y = Math.round(rect.top - GAP);
            const w = Math.round(rect.width + GAP * 2);
            const h = Math.round(rect.height + GAP * 2);
            const key = `${x},${y},${w},${h}`;
            if (key !== shownAt) {
                ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
                ring.style.width = `${w}px`;
                ring.style.height = `${h}px`;
                const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
                ring.style.borderRadius = `${radius + GAP}px`;
                shownAt = key;
            }
            ring.classList.add('is-visible');
        }
        if (performance.now() < settleUntil) frame = requestAnimationFrame(place);
    };

    const schedule = (settleMs = 0) => {
        if (settleMs) settleUntil = Math.max(settleUntil, performance.now() + settleMs);
        if (!frame) frame = requestAnimationFrame(place);
    };

    const recheck = () => {
        if (target && target === document.activeElement && wantsRing(target)) schedule();
        else release();
    };

    const follow = (element, attempt = 0) => {
        if (!wantsRing(element)) {
            release();
            // A control focused while its surface fades in (opacity still near zero)
            // becomes eligible a moment later.
            if (attempt < 8 && element === document.activeElement
                && wantsRing(element, { checkRendered: false })) {
                setTimeout(() => {
                    if (document.activeElement === element) follow(element, attempt + 1);
                }, 120);
            }
            return;
        }
        target = element;
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
