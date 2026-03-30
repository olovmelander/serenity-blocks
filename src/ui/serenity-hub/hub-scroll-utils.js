import { normalizeWheelDeltaToPixels } from '../../utils/wheel-routing.js';

export function resolveHubScrollContainer(root) {
    return root?.querySelector?.('.hub-tab-content') || null;
}

export function scrollHubScrollContainer(root, delta) {
    const scrollContainer = resolveHubScrollContainer(root);
    if (!scrollContainer || !Number.isFinite(delta)) {
        return false;
    }

    const currentScrollTop = Number(scrollContainer.scrollTop) || 0;
    scrollContainer.scrollTop = currentScrollTop + delta;
    return true;
}

export function scrollHubScrollContainerFromWheelEvent(root, event) {
    const scrollContainer = resolveHubScrollContainer(root);
    if (!scrollContainer || !event) {
        return false;
    }

    const delta = normalizeWheelDeltaToPixels(event, {
        lineHeight: 20,
        pageHeight: scrollContainer.clientHeight || globalThis.window?.innerHeight || 900,
        clampPx: null,
    });
    if (!delta) {
        return false;
    }

    const currentScrollTop = Number(scrollContainer.scrollTop) || 0;
    const scrollHeight = Number(scrollContainer.scrollHeight) || 0;
    const clientHeight = Number(scrollContainer.clientHeight) || 0;
    const canClamp = scrollHeight > 0 && clientHeight > 0;
    const nextScrollTop = canClamp
        ? Math.max(0, Math.min(scrollHeight - clientHeight, currentScrollTop + delta))
        : (currentScrollTop + delta);

    if (Math.abs(nextScrollTop - currentScrollTop) < 0.5) {
        return false;
    }

    scrollContainer.scrollTop = nextScrollTop;
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
}

export function scrollHubElementIntoView(element, options = {}) {
    if (!element?.scrollIntoView) {
        return false;
    }

    element.scrollIntoView({
        behavior: 'auto',
        block: 'nearest',
        inline: 'nearest',
        ...options,
    });
    return true;
}
