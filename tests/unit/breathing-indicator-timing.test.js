import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

let Indicator;
let indicator;
let now;
let hidden;
let frames;
let listeners;
let createRenderer;

function node() {
    const classes = new Set();
    return {
        style: { setProperty: vi.fn() },
        dataset: {},
        textContent: '',
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains: (name) => classes.has(name),
        },
        remove: vi.fn(),
    };
}

function renderer() {
    return Object.fromEntries([
        'init', 'setTechnique', 'setSessionPhase', 'start', 'stop', 'dispose', 'updateIntensity',
    ].map((name) => [name, vi.fn()]));
}

function animateAt(time) {
    now = time;
    const next = frames.entries().next().value;
    if (next) {
        frames.delete(next[0]);
        next[1](time);
    } else indicator._animate();
}

function setHidden(value) {
    hidden = value;
    listeners.get('visibilitychange')?.forEach((callback) => callback());
}

function activate(pattern = [5, 0, 5, 0]) {
    indicator.overridePattern(pattern);
    indicator.isActive = true;
    indicator.threeRenderer = renderer();
    indicator._animate();
}

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    now = 0;
    hidden = false;
    frames = new Map();
    listeners = new Map();
    let nextFrame = 1;
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
    vi.stubGlobal('document', {
        get hidden() { return hidden; },
        addEventListener: vi.fn((name, callback) => {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(callback);
        }),
        removeEventListener: vi.fn((name, callback) => listeners.get(name)?.delete(callback)),
    });
    createRenderer = vi.fn(function Renderer() {
        return renderer();
    });
    vi.doMock('../../src/ui/effects/threejs-breathing-renderer.js', () => ({
        ThreeJSBreathingRenderer: createRenderer,
    }));
    ({ EnhancedBreathingIndicator: Indicator } = await import('../../src/ui/effects/enhanced-breathing-indicator.js'));
    // Exercise the production timing and lifecycle against lightweight presentation
    // nodes. No WebGL context or full DOM is needed to prove cadence correctness.
    vi.spyOn(Indicator.prototype, '_createElements').mockImplementation(function createElements() {
        [
            'backdrop', 'indicator', 'hoverArea', 'visualContainer', 'outerRing', 'middleRing',
            'innerRing', 'coreCircle', 'textPrompt', 'phaseCountdown', 'phaseDetail',
            'phaseArc', 'techniqueName', 'techniqueDesc', 'techniqueSelector',
            'sessionPhaseLabel', 'progressContainer',
        ].forEach((name) => { this[name] = node(); });
        this.phaseStepNodes = Array.from({ length: 4 }, node);
        this.techniqueSelector.querySelectorAll = () => [];
        this.threeRenderer = null;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    indicator = new Indicator({});
});

afterEach(async () => {
    indicator?.destroy();
    await vi.dynamicImportSettled();
    vi.doUnmock('../../src/ui/effects/threejs-breathing-renderer.js');
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('breathing indicator cadence', () => {
    it('retains fractional frame overshoot across multiple phase boundaries', () => {
        const changes = vi.fn();
        indicator.onPhaseChangeCallback = changes;
        activate([4, 2, 6, 2]);
        animateAt(7250);
        expect(indicator.currentPhase).toBe('exhale');
        expect(indicator.phaseStartTime).toBe(6000);
        expect(changes.mock.calls).toEqual([['exhale', 'inhale']]);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(1.25 / 6);
        expect(indicator.phaseCountdown.textContent).toBe('5');
        expect(frames.size).toBe(1);
    });

    it('skips zero-duration holds in the same frame without emitting phantom holds', () => {
        const changes = vi.fn();
        indicator.onPhaseChangeCallback = changes;
        activate([5, 0, 5, 0]);
        animateAt(5100);
        expect(indicator.currentPhase).toBe('exhale');
        expect(indicator.phaseStartTime).toBe(5000);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(0.02);
        expect(indicator.phaseStepNodes.map((step) => step.hidden)).toEqual([false, true, false, true]);
        animateAt(10050);
        expect(indicator.currentPhase).toBe('inhale');
        expect(indicator.phaseStartTime).toBe(10000);
        expect(changes.mock.calls).toEqual([
            ['exhale', 'inhale'], ['inhale', 'exhale'],
        ]);
    });

    it('resolves the current phase after a stall longer than the callback catch-up budget', () => {
        const changes = vi.fn();
        indicator.onPhaseChangeCallback = changes;
        activate([1, 0, 2, 0]);
        animateAt(122500);
        expect(indicator.currentPhase).toBe('exhale');
        expect(indicator.phaseStartTime).toBe(121000);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(0.75);
        expect(indicator.phaseCountdown.textContent).toBe('1');
        expect(changes.mock.calls).toEqual([['exhale', 'inhale']]);
        expect(frames.size).toBe(1);
    });

    it('coalesces hidden guided-session boundaries without replaying breath cues during a hold', () => {
        const changes = vi.fn();
        const breathCues = vi.fn();
        indicator.onPhaseChangeCallback = (phase, previous) => {
            changes(phase, previous);
            if (phase === 'inhale' || phase === 'exhale') breathCues(phase);
        };
        indicator.isExternallyControlled = true;
        activate([4, 4, 4, 4]);
        animateAt(1200);
        setHidden(true);
        now = 22000;
        setHidden(false);
        expect(indicator.currentPhase).toBe('hold1');
        expect(indicator.phaseStartTime).toBe(20000);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(0.5);
        expect(changes.mock.calls).toEqual([['hold1', 'inhale']]);
        expect(breathCues).not.toHaveBeenCalled();
        expect(frames.size).toBe(1);

        animateAt(24000);
        expect(changes.mock.lastCall).toEqual(['exhale', 'hold1']);
        expect(breathCues.mock.calls).toEqual([['exhale']]);
    });

    it('starts at the first non-empty phase and preserves the caller\'s pattern', () => {
        const pattern = [0, 2, 3, 0];
        activate(pattern);
        pattern[1] = 100;
        expect(indicator.pattern).toEqual([0, 2, 3, 0]);
        expect(indicator.currentPhase).toBe('hold1');
        animateAt(2500);
        expect(indicator.currentPhase).toBe('exhale');
        expect(indicator.phaseStartTime).toBe(2000);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(1 / 6);
    });

    it.each([
        ['null', null], ['string', '5,0,5,0'], ['short', [1, 2, 3]], ['long', [1, 2, 3, 4, 5]],
        ['empty', [0, 0, 0, 0]], ['negative', [-1, 0, 5, 0]], ['NaN', [NaN, 0, 5, 0]],
        ['infinite', [Infinity, 0, 5, 0]], ['non-numeric', ['5', 0, 5, 0]],
    ])('rejects a %s pattern without resetting an active phase', (label, pattern) => {
        activate();
        animateAt(6250);
        const previous = [...indicator.pattern];
        const start = indicator.phaseStartTime;
        indicator.overridePattern(pattern);
        expect(indicator.pattern).toEqual(previous);
        expect(indicator.currentPhase).toBe('exhale');
        expect(indicator.phaseStartTime).toBe(start);
    });

    it('keeps every built-in technique finite with at least one non-empty phase', () => {
        expect(Object.keys(indicator.techniques)).toHaveLength(12);
        Object.values(indicator.techniques).forEach(({ pattern }) => {
            expect(pattern).toHaveLength(4);
            expect(pattern.every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);
            expect(pattern.some((duration) => duration > 0)).toBe(true);
        });
    });
});

describe('breathing indicator pause and visibility', () => {
    it('preserves phase progress while paused and resumes with one frame owner', () => {
        activate();
        animateAt(1200);
        const before = indicator.threeRenderer.updateIntensity.mock.lastCall[2];
        indicator.pause();
        indicator.pause();
        expect(frames.size).toBe(0);
        expect(indicator.threeRenderer.stop).toHaveBeenCalledOnce();
        now = 10000;
        indicator._animate();
        expect(frames.size).toBe(0);
        indicator.resume();
        indicator.resume();
        expect(indicator.phaseStartTime).toBe(8800);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(before);
        expect(indicator.threeRenderer.start).toHaveBeenCalledOnce();
        expect(frames.size).toBe(1);
    });

    it('freezes a hidden tab and restores its original phase when visible', () => {
        activate();
        animateAt(1200);
        setHidden(true);
        expect(frames.size).toBe(0);
        now = 30000;
        indicator._animate();
        setHidden(false);
        expect(indicator.currentPhase).toBe('inhale');
        expect(indicator.phaseStartTime).toBe(28800);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(0.24);
        expect(frames.size).toBe(1);
    });

    it('does not double-count time when the user pauses a hidden session', () => {
        activate();
        animateAt(1200);
        setHidden(true);
        now = 4000;
        indicator.pause();
        now = 5000;
        setHidden(false);
        expect(frames.size).toBe(0);
        now = 10000;
        indicator.resume();
        expect(indicator.phaseStartTime).toBe(8800);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(0.24);
        expect(frames.size).toBe(1);
    });

    it('continues freezing after resume when the tab is still hidden', () => {
        activate();
        animateAt(1200);
        indicator.pause();
        now = 4000;
        setHidden(true);
        now = 10000;
        indicator.resume();
        expect(frames.size).toBe(0);
        now = 15000;
        setHidden(false);
        expect(indicator.phaseStartTime).toBe(13800);
        expect(indicator.threeRenderer.updateIntensity.mock.lastCall[2]).toBeCloseTo(0.24);
        expect(frames.size).toBe(1);
    });
});

describe('breathing indicator lazy renderer lifecycle', () => {
    it.each(['initial', 'cached'])('keeps breathing guidance after %s initialization fails and retries next start', async (mode) => {
        const failed = renderer();
        failed.init.mockImplementation(() => { throw new Error('GL context unavailable'); });
        if (mode === 'cached') {
            indicator.threeRenderer = failed;
            indicator.indicator.classList.add('breathing-renderer-ready');
        } else createRenderer.mockImplementationOnce(function FailedRenderer() { return failed; });

        expect(() => indicator.start()).not.toThrow();
        await vi.dynamicImportSettled();
        expect(failed.dispose).toHaveBeenCalledOnce();
        expect(failed.start).not.toHaveBeenCalled();
        expect(indicator.threeRenderer).toBeNull();
        expect(indicator.indicator.classList.contains('breathing-renderer-ready')).toBe(false);
        expect(indicator.isActive).toBe(true);
        expect(frames.size).toBe(1);
        animateAt(5500);
        expect(indicator.currentPhase).toBe('hold1');
        expect(indicator.textPrompt.textContent).toBe('Hold gently');

        indicator.stop();
        indicator.start();
        await vi.dynamicImportSettled();
        expect(indicator.threeRenderer).not.toBeNull();
        expect(indicator.threeRenderer).not.toBe(failed);
        expect(indicator.threeRenderer.init).toHaveBeenCalledOnce();
        expect(indicator.threeRenderer.start).toHaveBeenCalledOnce();
        expect(indicator.indicator.classList.contains('breathing-renderer-ready')).toBe(true);
        expect(frames.size).toBe(1);
    });

    it('survives disposal of a partially initialized renderer that also throws', async () => {
        const failed = renderer();
        failed.init.mockImplementation(() => { throw new Error('init failed'); });
        failed.dispose.mockImplementation(() => { throw new Error('lost partial context'); });
        createRenderer.mockImplementationOnce(function FailedRenderer() { return failed; });
        indicator.start();
        await vi.dynamicImportSettled();
        expect(indicator.threeRenderer).toBeNull();
        expect(indicator.isActive).toBe(true);
        expect(indicator.indicator.classList.contains('breathing-renderer-ready')).toBe(false);
        expect(frames.size).toBe(1);
        animateAt(5500);
        expect(indicator.textPrompt.textContent).toBe('Hold gently');
    });

    it('preserves paused state when late initialization fails and resumes the fallback', async () => {
        const failed = renderer();
        failed.init.mockImplementation(() => { throw new Error('init failed'); });
        createRenderer.mockImplementationOnce(function FailedRenderer() { return failed; });
        indicator.start();
        now = 1250;
        indicator.pause();
        await vi.dynamicImportSettled();
        expect(indicator.threeRenderer).toBeNull();
        expect(indicator._isPaused).toBe(true);
        expect(indicator.indicator.classList.contains('breathing-paused')).toBe(true);
        expect(frames.size).toBe(0);
        now = 10000;
        indicator.resume();
        expect(indicator.phaseStartTime).toBe(8750);
        expect(indicator.currentPhase).toBe('inhale');
        expect(indicator.textPrompt.textContent).toBe('Breathe in');
        expect(indicator._isPaused).toBe(false);
        expect(frames.size).toBe(1);
    });

    it('keeps fallback guidance on cached context loss and shows restored graphics on restart', () => {
        const visual = renderer();
        visual.contextLost = true;
        indicator.threeRenderer = visual;
        indicator.start();
        expect(indicator.indicator.classList.contains('breathing-renderer-ready')).toBe(false);
        expect(indicator.isActive).toBe(true);
        animateAt(5500);
        expect(indicator.textPrompt.textContent).toBe('Hold gently');
        indicator.stop();
        visual.contextLost = false;
        indicator.start();
        expect(indicator.threeRenderer).toBe(visual);
        expect(indicator.indicator.classList.contains('breathing-renderer-ready')).toBe(true);
        expect(visual.init).toHaveBeenCalledTimes(2);
        expect(frames.size).toBe(1);
    });

    it.each(['stop', 'destroy'])('ignores a renderer module that arrives after %s', async (action) => {
        indicator.start();
        indicator[action]();
        await vi.dynamicImportSettled();
        expect(createRenderer).not.toHaveBeenCalled();
        expect(indicator.threeRenderer).toBeNull();
        expect(indicator.isActive).toBe(false);
        expect(frames.size).toBe(0);
    });

    it('accepts only the latest start when stop and restart overlap the module load', async () => {
        indicator.start();
        indicator.stop();
        indicator.start();
        await vi.dynamicImportSettled();
        expect(createRenderer).toHaveBeenCalledOnce();
        expect(indicator.threeRenderer.start).toHaveBeenCalledOnce();
        expect(indicator.isActive).toBe(true);
        expect(frames.size).toBe(1);
    });

    it('keeps a late renderer paused until the session resumes', async () => {
        indicator.start();
        indicator.pause();
        await vi.dynamicImportSettled();
        expect(indicator.threeRenderer).not.toBeNull();
        expect(indicator.threeRenderer.start).not.toHaveBeenCalled();
        expect(frames.size).toBe(0);
        now = 10000;
        indicator.resume();
        expect(indicator.threeRenderer.start).toHaveBeenCalledOnce();
        expect(frames.size).toBe(1);
    });

    it('disposes once, removes frame/listener owners, and cannot restart after destroy', () => {
        const visual = renderer();
        indicator.threeRenderer = visual;
        indicator.start();
        expect(frames.size).toBe(1);
        indicator.destroy();
        indicator.destroy();
        indicator.start();
        expect(visual.dispose).toHaveBeenCalledOnce();
        expect(visual.stop).toHaveBeenCalledOnce();
        expect(visual.start).toHaveBeenCalledOnce();
        expect(indicator.threeRenderer).toBeNull();
        expect(indicator.isActive).toBe(false);
        expect(frames.size).toBe(0);
        expect([...listeners.values()].every((callbacks) => callbacks.size === 0)).toBe(true);
    });
});
