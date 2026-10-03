import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';

class TestTheme extends BaseTheme {
    constructor() {
        super('serenity-warp');
    }

    async createScene() {
        return undefined;
    }
}

function makeContainer(inlineStyle = {}) {
    const classes = new Set(['theme-container']);
    return {
        id: 'serenity-warp-theme',
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        style: {
            ...inlineStyle,
            removeProperty(name) { delete this[name]; },
        },
    };
}

function stubDocument(container) {
    vi.stubGlobal('document', {
        hidden: false,
        getElementById: (id) => (id === container.id ? container : null),
        querySelectorAll: () => [container],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
}

function pausedTheme() {
    const theme = new TestTheme();
    theme.hasStarted = true;
    theme.isActive = false;
    theme.isPaused = true;
    theme.lifecycleState = 'paused';
    return theme;
}

describe('BaseTheme.resume reveals the container', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('activates a container that was parked hidden by the boot pre-warm', () => {
        const container = makeContainer();
        stubDocument(container);

        expect(pausedTheme().resume()).toBe(true);

        expect(container.classList.contains('active')).toBe(true);
    });

    it('clears inline opacity and visibility that would outrank the active class', () => {
        // A lazily created container used to carry inline `opacity: 0`; the hidden
        // start() branch never cleared it, so the resumed theme stayed invisible.
        const container = makeContainer({ opacity: '0', visibility: 'hidden' });
        stubDocument(container);

        expect(pausedTheme().resume()).toBe(true);

        expect(container.classList.contains('active')).toBe(true);
        expect(container.style).not.toHaveProperty('opacity');
        expect(container.style).not.toHaveProperty('visibility');
    });

    it('still refuses to resume a theme that is not parked', () => {
        const container = makeContainer({ opacity: '0' });
        stubDocument(container);
        const theme = pausedTheme();
        theme.lifecycleState = 'running';
        theme.isPaused = false;

        expect(theme.resume()).toBe(false);

        expect(container.classList.contains('active')).toBe(false);
        expect(container.style.opacity).toBe('0');
    });
});
