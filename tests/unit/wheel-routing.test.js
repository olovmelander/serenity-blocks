import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    findInteractiveWheelTarget,
    normalizeWheelDeltaToPixels,
    shouldCaptureWheelInput,
} from '../../src/utils/wheel-routing.js';

function createTarget(options = {}) {
    const attrs = { ...(options.attrs || {}) };
    const target = {
        parentElement: options.parent || null,
        parentNode: options.parent || null,
        clientHeight: options.clientHeight ?? 0,
        scrollHeight: options.scrollHeight ?? 0,
        isContentEditable: options.isContentEditable ?? false,
        __style: {
            overflowY: options.overflowY ?? 'visible',
            overflow: options.overflow ?? 'visible',
        },
        getAttribute(name) {
            return attrs[name] ?? null;
        },
        matches(selector) {
            if (!options.matches) {
                return false;
            }
            return selector.split(',').map((part) => part.trim()).includes(options.matches);
        },
    };

    target.closest = (selector) => {
        let current = target;
        while (current) {
            if (selector === '[data-wheel-lock="true"]'
                && typeof current.getAttribute === 'function'
                && current.getAttribute('data-wheel-lock') === 'true') {
                return current;
            }
            current = current.parentElement || current.parentNode || null;
        }
        return null;
    };

    return target;
}

describe('wheel routing helpers', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { innerHeight: 720 });
        vi.stubGlobal('getComputedStyle', vi.fn((element) => element?.__style || {
            overflowY: 'visible',
            overflow: 'visible',
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does not capture wheel input for scrollable modal content', () => {
        const scrollContainer = createTarget({
            attrs: { 'data-wheel-lock': 'true' },
            overflowY: 'auto',
            clientHeight: 160,
            scrollHeight: 480,
        });
        const buttonInside = createTarget({ parent: scrollContainer });

        expect(shouldCaptureWheelInput({ target: buttonInside })).toBe(false);
    });

    it('does not capture wheel input for interactive controls like selects', () => {
        const selectTarget = createTarget({ matches: 'select' });

        expect(findInteractiveWheelTarget(selectTarget)).toBe(selectTarget);
        expect(shouldCaptureWheelInput({ target: selectTarget })).toBe(false);
    });

    it('normalizes wheel delta values across delta modes', () => {
        expect(normalizeWheelDeltaToPixels({
            deltaY: 120,
            deltaMode: 0,
            ctrlKey: false,
        })).toBe(120);

        expect(normalizeWheelDeltaToPixels({
            deltaY: 3,
            deltaMode: 1,
            ctrlKey: false,
        }, { lineHeight: 20, clampPx: null })).toBe(60);

        expect(normalizeWheelDeltaToPixels({
            deltaY: 1,
            deltaMode: 2,
            ctrlKey: false,
        }, { pageHeight: 500, clampPx: null })).toBe(500);
    });
});
