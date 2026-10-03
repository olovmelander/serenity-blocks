import { afterEach, describe, expect, it, vi } from 'vitest';
import { initMenuCardInteractions } from '../../src/ui/menu-card-interactions.js';

let clock = 10000;

function createHarness({ muted = false, failSecondVoice = false } = {}) {
    const handlers = new Map();
    const properties = new Map();
    const audioNodes = [];
    const oscillators = [];
    const param = () => ({
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
    });
    const node = (kind) => {
        const result = {
            kind,
            connect: vi.fn(),
            disconnect: vi.fn(),
            gain: param(),
            frequency: param(),
            Q: {},
            start: vi.fn(),
            stop: vi.fn(),
            onended: null,
        };
        audioNodes.push(result);
        return result;
    };
    const destination = { disconnect: vi.fn() };
    const ctx = {
        currentTime: 3,
        state: 'running',
        destination,
        createGain: () => node('gain'),
        createBiquadFilter: () => node('filter'),
        createOscillator() {
            if (failSecondVoice && oscillators.length === 1) throw new Error('voice unavailable');
            const osc = node('oscillator');
            oscillators.push(osc);
            return osc;
        },
    };
    let frameCallback;
    let covered = false;
    const card = {
        dataset: { mode: 'single' },
        classList: { contains: () => false },
        getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 200, height: 100 })),
        style: { setProperty: (name, value) => properties.set(name, value) },
        addEventListener: (name, handler) => handlers.set(name, handler),
    };
    vi.stubGlobal('window', {
        __serenitySoundManager: { audioContext: ctx, isMuted: muted, getSfxVolume: () => 0.5 },
    });
    vi.stubGlobal('document', {
        body: { classList: { contains: () => covered } },
        querySelectorAll: () => [card],
    });
    vi.stubGlobal('performance', { now: () => clock });
    clock += 1000;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frameCallback = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    initMenuCardInteractions();
    return {
        card, handlers, properties, audioNodes, oscillators, destination,
        flushFrame: () => frameCallback(),
        cover: () => { covered = true; },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('menu card presentation and sound lifecycle', () => {
    it('moves a prepainted spotlight once per frame and skips covered-menu pointer work', () => {
        const h = createHarness({ muted: true });
        h.handlers.get('pointerenter')();
        h.handlers.get('pointermove')({ clientX: 150, clientY: 50 });
        h.handlers.get('pointermove')({ clientX: 200, clientY: 100 });
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        h.flushFrame();
        expect(h.properties.get('--spotlight-x')).toBe('100.0px');
        expect(h.properties.get('--spotlight-y')).toBe('50.0px');
        expect(h.properties.has('--mx')).toBe(false);
        expect(h.card.getBoundingClientRect).toHaveBeenCalledTimes(1);

        h.handlers.get('pointermove')({ clientX: 0, clientY: 0 });
        h.cover();
        h.flushFrame();
        expect(h.properties.get('--spotlight-x')).toBe('100.0px');
    });

    it.each(['pointerenter', 'click'])('releases %s cue graphs only after the last voice tail ends', (event) => {
        const h = createHarness();
        h.handlers.get(event)();
        expect(h.oscillators).toHaveLength(2);
        const filter = h.audioNodes.find((entry) => entry.kind === 'filter');
        const master = h.audioNodes.find((entry) => entry.kind === 'gain');
        h.oscillators[0].onended();
        expect(filter.disconnect).not.toHaveBeenCalled();
        expect(master.disconnect).not.toHaveBeenCalled();
        h.oscillators[1].onended();
        expect(h.audioNodes.every((entry) => entry.disconnect.mock.calls.length === 1)).toBe(true);
        expect(h.destination.disconnect).not.toHaveBeenCalled();
    });

    it('releases a partially created cue while preserving a successfully scheduled voice', () => {
        const h = createHarness({ failSecondVoice: true });
        h.handlers.get('pointerenter')();
        const filter = h.audioNodes.find((entry) => entry.kind === 'filter');
        expect(filter.disconnect).not.toHaveBeenCalled();
        h.oscillators[0].onended();
        expect(h.audioNodes.every((entry) => entry.disconnect.mock.calls.length === 1)).toBe(true);
    });
});
