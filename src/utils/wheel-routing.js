const DEFAULT_WHEEL_LOCK_ATTRIBUTES = ['data-wheel-lock', 'data-odyssey-wheel-lock'];
const DEFAULT_WHEEL_LINE_HEIGHT_PX = 16;
const DEFAULT_WHEEL_DELTA_CLAMP_PX = 240;

// Debug mode for diagnosing wheel event routing in Electron.
// Enable via: window.__WHEEL_ROUTING_DEBUG = true
function debugLog(...args) {
    if (typeof globalThis !== 'undefined' && globalThis.__WHEEL_ROUTING_DEBUG) {
        console.log('[WheelRouting]', ...args);
    }
}
const SCROLLABLE_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);
const INTERACTIVE_WHEEL_TARGET_SELECTOR = [
    'input',
    'select',
    'textarea',
    'button',
    'option',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menu"]',
    '[data-wheel-interactive="true"]',
].join(', ');

function getAncestorElement(element) {
    if (!element || typeof element !== 'object') {
        return null;
    }

    return element.parentElement || element.parentNode || null;
}

function getWheelLockAttributeValue(element, attributeNames = DEFAULT_WHEEL_LOCK_ATTRIBUTES) {
    if (!element || typeof element !== 'object') {
        return null;
    }

    const names = Array.isArray(attributeNames) ? attributeNames : [attributeNames];

    if (typeof element.getAttribute === 'function') {
        for (const name of names) {
            const value = element.getAttribute(name);
            if (value !== null) {
                return value;
            }
        }
    }

    const dataset = element.dataset || {};
    if (Object.prototype.hasOwnProperty.call(dataset, 'wheelLock')) {
        return dataset.wheelLock;
    }
    if (Object.prototype.hasOwnProperty.call(dataset, 'odysseyWheelLock')) {
        return dataset.odysseyWheelLock;
    }

    return null;
}

function resolveStyleForElement(element) {
    if (!element || typeof getComputedStyle !== 'function') {
        return null;
    }

    try {
        return getComputedStyle(element);
    } catch {
        return null;
    }
}

function matchesInteractiveWheelTarget(element) {
    if (!element || typeof element !== 'object') {
        return false;
    }

    if (element.isContentEditable) {
        return true;
    }

    if (typeof element.matches === 'function') {
        try {
            return element.matches(INTERACTIVE_WHEEL_TARGET_SELECTOR);
        } catch {
            return false;
        }
    }

    return false;
}

export function findWheelLockTarget(target, attributeNames = DEFAULT_WHEEL_LOCK_ATTRIBUTES) {
    if (!target || typeof target !== 'object') {
        return null;
    }

    const names = Array.isArray(attributeNames) ? attributeNames : [attributeNames];

    if (typeof target.closest === 'function') {
        for (const name of names) {
            const locked = target.closest(`[${name}="true"]`);
            if (locked) {
                return locked;
            }
        }
    }

    let current = target;
    while (current) {
        if (getWheelLockAttributeValue(current, names) === 'true') {
            return current;
        }
        current = getAncestorElement(current);
    }

    return null;
}

export function findScrollableWheelTarget(target, styleResolver = resolveStyleForElement) {
    let current = target;
    while (current) {
        const style = styleResolver(current);
        const overflowY = style?.overflowY ?? style?.overflow ?? '';
        const overflow = style?.overflow ?? '';
        const allowsVerticalScroll = SCROLLABLE_OVERFLOW_VALUES.has(overflowY)
            || SCROLLABLE_OVERFLOW_VALUES.has(overflow);
        const scrollHeight = Number(current.scrollHeight) || 0;
        const clientHeight = Number(current.clientHeight) || 0;

        if (allowsVerticalScroll && scrollHeight > (clientHeight + 1)) {
            return current;
        }

        current = getAncestorElement(current);
    }

    return null;
}

export function findInteractiveWheelTarget(target) {
    let current = target;
    while (current) {
        if (matchesInteractiveWheelTarget(current)) {
            return current;
        }
        current = getAncestorElement(current);
    }

    return null;
}

// Cache elementFromPoint results within the same millisecond (effectively the
// same frame) to avoid redundant layout recalculations when multiple capture-phase
// listeners all call resolveTopmostWheelTarget on the same wheel event.
let _efpCacheResult = null;
let _efpCacheTime = -1;
let _efpCacheX = NaN;
let _efpCacheY = NaN;

export function resolveTopmostWheelTarget(event) {
    if (!event) {
        return null;
    }

    const fallbackTarget = event.target ?? null;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return fallbackTarget;
    }

    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
        return fallbackTarget;
    }

    try {
        const now = performance.now() | 0; // integer ms
        if (
            now === _efpCacheTime
            && event.clientX === _efpCacheX
            && event.clientY === _efpCacheY
            && _efpCacheResult
        ) {
            return _efpCacheResult;
        }
        const result = document.elementFromPoint(event.clientX, event.clientY) || fallbackTarget;
        _efpCacheResult = result;
        _efpCacheTime = now;
        _efpCacheX = event.clientX;
        _efpCacheY = event.clientY;
        return result;
    } catch {
        return fallbackTarget;
    }
}

export function shouldCaptureWheelEvent({
    event,
    styleResolver = resolveStyleForElement,
    attributeNames = DEFAULT_WHEEL_LOCK_ATTRIBUTES,
} = {}) {
    const topmostTarget = resolveTopmostWheelTarget(event);
    return shouldCaptureWheelInput({
        target: topmostTarget || event?.target || null,
        styleResolver,
        attributeNames,
    });
}

export function shouldCaptureWheelInput({
    target,
    styleResolver = resolveStyleForElement,
    attributeNames = DEFAULT_WHEEL_LOCK_ATTRIBUTES,
}) {
    const lockTarget = findWheelLockTarget(target, attributeNames);
    if (lockTarget) {
        debugLog('blocked by wheel-lock', lockTarget.tagName, lockTarget.id || lockTarget.className);
        return false;
    }

    const scrollTarget = findScrollableWheelTarget(target, styleResolver);
    if (scrollTarget) {
        debugLog('blocked by scrollable target', scrollTarget.tagName, scrollTarget.id || scrollTarget.className);
        return false;
    }

    const interactiveTarget = findInteractiveWheelTarget(target);
    if (interactiveTarget) {
        debugLog('blocked by interactive target', interactiveTarget.tagName);
        return false;
    }

    debugLog('capture allowed for', target?.tagName, target?.id || target?.className);
    return true;
}

export function normalizeWheelDeltaToPixels(event, {
    lineHeight = DEFAULT_WHEEL_LINE_HEIGHT_PX,
    pageHeight = null,
    clampPx = DEFAULT_WHEEL_DELTA_CLAMP_PX,
} = {}) {
    if (!event || event.ctrlKey) {
        return 0;
    }

    let deltaPx = Number(event.deltaY) || 0;
    const fallbackPageHeight = pageHeight
        ?? globalThis.window?.innerHeight
        ?? 900;

    if (event.deltaMode === 1) {
        deltaPx *= lineHeight;
    } else if (event.deltaMode === 2) {
        deltaPx *= fallbackPageHeight;
    }

    if (Number.isFinite(clampPx)) {
        deltaPx = Math.min(Math.max(deltaPx, -clampPx), clampPx);
    }

    return deltaPx;
}
