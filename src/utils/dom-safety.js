/**
 * Small DOM safety helpers for values that may come from peers, IPC, or device
 * metadata and later flow into HTML or CSS.
 */

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function escapeAttribute(value = '') {
    return escapeHtml(value);
}

export function sanitizeCssColor(value, fallback = '#a78bfa') {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();
    if (HEX_COLOR_PATTERN.test(trimmed)) {
        return trimmed;
    }

    return fallback;
}
