/**
 * @fileoverview Keystone toasts: short notices stacked bottom-centre (a session that
 * ended — kicked, lobby full, version mismatch — and similar).
 *
 * Any module can raise one with
 *   window.dispatchEvent(new CustomEvent('serenity:toast', { detail: { message, type } }))
 * or call `showToast()` directly. The region is one polite live region; toasts dismiss
 * themselves (paused while hovered or focused) and can be dismissed early. No blur:
 * they sit over live scenes. Styles: `.sb-toast*` in public/styles/keystone-multiplayer.css.
 */
import { mpIcon } from './mp-sheet.js';

const MAX_TOASTS = 3;
const DEFAULT_TIMEOUT_MS = 6000;
const TYPES = new Set(['info', 'success', 'warning', 'error']);

let region = null;
let installed = false;

function ensureRegion() {
    if (region?.isConnected) return region;
    region = document.createElement('div');
    region.id = 'sb-toast-region';
    region.className = 'sb-toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(region);
    return region;
}

function dismiss(toast) {
    if (!toast || toast.dataset.leaving === 'true') return;
    toast.dataset.leaving = 'true';
    clearTimeout(toast._sbTimer);
    toast.classList.add('is-leaving');
    const remove = () => toast.remove();
    toast.addEventListener('animationend', remove, { once: true });
    // Reduced motion (no animation) or a hidden tab: never leave one behind.
    setTimeout(remove, 400);
}

/**
 * @param {{message: string, type?: 'info'|'success'|'warning'|'error', timeoutMs?: number}} options
 * @returns {HTMLElement|null} the toast element
 */
export function showToast({ message, type = 'info', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof document === 'undefined' || !document.body) return null;
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return null;
    const host = ensureRegion();
    const tone = TYPES.has(type) ? type : 'info';

    const toast = document.createElement('div');
    toast.className = `sb-toast sb-toast--${tone}`;
    const tile = document.createElement('span');
    tile.className = 'sb-toast__tile';
    tile.setAttribute('aria-hidden', 'true');
    const body = document.createElement('p');
    body.className = 'sb-toast__message';
    body.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sb-toast__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = mpIcon('close', 16);
    close.addEventListener('click', () => dismiss(toast));
    toast.append(tile, body, close);

    const arm = () => {
        clearTimeout(toast._sbTimer);
        toast._sbTimer = setTimeout(() => dismiss(toast), Math.max(2000, timeoutMs));
    };
    toast.addEventListener('pointerenter', () => clearTimeout(toast._sbTimer));
    toast.addEventListener('pointerleave', arm);
    toast.addEventListener('focusin', () => clearTimeout(toast._sbTimer));
    toast.addEventListener('focusout', arm);

    host.appendChild(toast);
    const live = Array.from(host.children).filter((node) => node.dataset.leaving !== 'true');
    live.slice(0, Math.max(0, live.length - MAX_TOASTS)).forEach(dismiss);
    arm();
    return toast;
}

/** Listen for `serenity:toast` window events. Idempotent; a no-op outside the browser. */
export function installToastListener() {
    if (installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    installed = true;
    window.addEventListener('serenity:toast', (event) => {
        const detail = event?.detail || {};
        showToast({ message: detail.message, type: detail.type, timeoutMs: detail.timeoutMs });
    });
}

installToastListener();
