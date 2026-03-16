const DEFAULT_WHEEL_LOCK_ATTRIBUTES = ['data-wheel-lock', 'data-odyssey-wheel-lock'];
const DEFAULT_WHEEL_LINE_HEIGHT_PX = 16;
const DEFAULT_WHEEL_DELTA_CLAMP_PX = 240;
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

export function shouldCaptureWheelInput({
    target,
    styleResolver = resolveStyleForElement,
    attributeNames = DEFAULT_WHEEL_LOCK_ATTRIBUTES,
}) {
    if (findWheelLockTarget(target, attributeNames)) {
        return false;
    }

    if (findScrollableWheelTarget(target, styleResolver)) {
        return false;
    }

    if (findInteractiveWheelTarget(target)) {
        return false;
    }

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
