import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceMonitor } from '../../src/utils/performance-monitor.js';
import { EnhancedBreathingIndicator } from '../../src/ui/effects/enhanced-breathing-indicator.js';

afterEach(() => vi.restoreAllMocks());

describe('deferred renderer counter summaries', () => {
    it('retains all samples while closed, sorting only once when a changed window is read', () => {
        const monitor = new PerformanceMonitor();
        const sort = vi.spyOn(Array.prototype, 'sort');
        for (let i = 0; i < 240; i++) monitor.recordCounters({ calls: i, triangles: i * 10 });
        const afterRecording = sort.mock.calls.length;
        const first = { ...monitor.renderCounters };
        const afterReading = sort.mock.calls.length;
        const second = JSON.parse(JSON.stringify(monitor.renderCounters));
        const afterRepeatedReading = sort.mock.calls.length;
        monitor.recordCounters({ calls: 240, triangles: 2400 });
        const nextMedian = monitor.renderCounters.callsP50;
        const afterNewSample = sort.mock.calls.length;
        sort.mockRestore();
        expect(monitor.enabled).toBe(false);
        expect(afterRecording).toBe(0);
        expect(afterReading).toBe(2);
        expect(afterRepeatedReading).toBe(2);
        expect(afterNewSample).toBe(4);
        expect(first).toEqual(second);
        expect(first).toMatchObject({ calls: 239, callsAvg: 209.5, callsP50: 209, callsMax: 239, trianglesP50: 2090 });
        expect(nextMedian).toBe(210);
        expect(monitor._counterSamples.calls).toEqual(Array.from({ length: 60 }, (_, i) => i + 181));
    });

    it('preserves reference statistics, sample order and fresh report snapshots across eviction', () => {
        const monitor = new PerformanceMonitor();
        const samples = [];
        for (let i = 0; i < 83; i++) {
            const calls = ((i * 17) % 53) / 3;
            samples.push(calls);
            if (samples.length > 60) samples.shift();
            monitor.recordCounters({ calls, triangles: calls * 9, geometries: i });
            const sorted = [...samples].sort((a, b) => a - b);
            const report = { ...monitor.renderCounters };
            expect(report.callsAvg).toBe(samples.reduce((sum, value) => sum + value, 0) / samples.length);
            expect(report.callsP50).toBe(sorted[Math.floor((sorted.length - 1) / 2)]);
            expect(report.callsMax).toBe(Math.max(...samples));
            expect(monitor._counterSamples.calls).toEqual(samples);
            report.calls = -1;
            expect(monitor.renderCounters.calls).toBe(calls);
        }
    });

    it('reset keeps retained old counter objects consistent and clears the new window', () => {
        const monitor = new PerformanceMonitor();
        monitor.recordCounters({ calls: 7, triangles: 21 });
        const previous = monitor.renderCounters;
        monitor.reset();
        monitor.recordCounters({ calls: 9, triangles: 27 });
        expect(previous.calls).toBe(7);
        expect(previous.callsP50).toBe(7);
        expect(monitor.renderCounters.callsP50).toBe(9);
        expect(monitor._counterSamples.calls).toEqual([9]);
    });
});

function node() {
    const values = {};
    const writes = [];
    let text = '';
    const element = {
        dataset: {},
        writes,
        style: new Proxy({ setProperty(key, value) { writes.push([key, value]); values[key] = value; } }, {
            get(target, key) { return key in target ? target[key] : values[key]; },
            set(target, key, value) { writes.push([key, value]); values[key] = value; return true; },
        }),
        get textContent() { return text; },
        set textContent(value) { text = value; writes.push(['textContent', value]); },
    };
    return element;
}

function progressIndicator() {
    const indicator = Object.create(EnhancedBreathingIndicator.prototype);
    const dots = Array.from({ length: 20 }, () => Object.assign(node(), { dataset: { group: '1' } }));
    Object.assign(indicator, {
        progressContainer: node(), roundIndicator: node(), progressBarFill: node(),
        breathDotsContainer: { querySelectorAll: vi.fn(() => dots) },
        _progressState: { visible: true, totalBreaths: 20, currentBreath: 0 },
    });
    return { indicator, dots };
}

const progress = { round: 1, totalRounds: 3, totalBreaths: 20, breathCount: 4, sessionProgress: 0.3, sessionColor: { r: 100, g: 200, b: 255 } };

describe('breathing presentation retains identical state', () => {
    it('writes unchanged progress once and updates only the affected breath dots', () => {
        const { indicator, dots } = progressIndicator();
        indicator.updateProgress(progress);
        const writes = [...dots, indicator.roundIndicator, indicator.progressBarFill].map((el) => el.writes.length);
        for (let i = 0; i < 100; i++) indicator.updateProgress(progress);
        expect([...dots, indicator.roundIndicator, indicator.progressBarFill].map((el) => el.writes.length)).toEqual(writes);
        expect(indicator.breathDotsContainer.querySelectorAll).toHaveBeenCalledTimes(1);
        indicator.updateProgress({ breathCount: 5 });
        expect(dots[4].style.background).toBe('rgba(255, 255, 255, 0.9)');
        expect(dots[5].style.transform).toBe('scale(1.2)');
        expect(dots[0].writes.length).toBe(writes[0]);
        expect(indicator.roundIndicator.textContent).toBe('ROUND 1/3');
        expect(indicator.progressBarFill.style.transform).toBe('scaleX(0.3)');
    });

    it('retains hidden progress and catches up on show without repeated hidden writes', () => {
        const { indicator, dots } = progressIndicator();
        indicator.showProgress(false);
        for (let i = 0; i < 100; i++) indicator.updateProgress({ ...progress, round: 2, breathCount: 8, sessionProgress: 0.7 });
        expect(indicator.roundIndicator.writes).toHaveLength(0);
        expect(indicator.progressBarFill.writes).toHaveLength(0);
        expect(indicator.breathDotsContainer.querySelectorAll).not.toHaveBeenCalled();
        indicator.showProgress(true);
        expect(indicator.roundIndicator.textContent).toBe('ROUND 2/3');
        expect(indicator.progressBarFill.style.transform).toBe('scaleX(0.7)');
        expect(dots[8].style.transform).toBe('scale(1.2)');
    });

    it('retains ring and color values during holds, but follows every changing inhale value', () => {
        const indicator = Object.create(EnhancedBreathingIndicator.prototype);
        Object.assign(indicator, {
            outerRing: node(), middleRing: node(), innerRing: node(), coreCircle: node(), indicator: node(),
            currentPhase: 'hold1', technique: { color: { r: 100, g: 200, b: 255 } },
        });
        indicator._updateRings(1);
        indicator._updateColors(0);
        const elements = [indicator.outerRing, indicator.middleRing, indicator.innerRing, indicator.coreCircle, indicator.indicator];
        const writes = elements.map((el) => el.writes.length);
        for (let i = 0; i < 240; i++) { indicator._updateRings(1); indicator._updateColors(i / 240); }
        expect(elements.map((el) => el.writes.length)).toEqual(writes);
        indicator.currentPhase = 'inhale';
        for (const value of [0, 0.3, 0.9, 1]) {
            indicator._updateRings(value);
            indicator._updateColors(value);
            const scale = 0.68 + value * 0.32;
            expect(indicator.outerRing.style.transform).toBe(`translate(-50%, -50%) scale(${scale.toFixed(4)})`);
            expect(indicator.indicator.style['--breath-brightness']).toBe(String(0.7 + value * 0.3));
        }
        indicator.technique.color.r = 99;
        indicator._updateColors(1);
        expect(indicator.indicator.style['--breath-color-r']).toBe('99');
    });

    it('new dot geometry invalidates retained breath states even if the count is unchanged', () => {
        const { indicator } = progressIndicator();
        const children = [];
        indicator.breathDotsContainer = { innerHTML: '', appendChild: (el) => children.push(el) };
        vi.stubGlobal('document', { createElement: () => node() });
        try {
            indicator._createBreathDots(40);
            indicator._updateBreathDots(4);
            expect(children[2].style.transform).toBe('scale(1.2)');
            indicator._createBreathDots(20);
            indicator._updateBreathDots(4);
            expect(children[24].style.transform).toBe('scale(1.2)');
        } finally { vi.unstubAllGlobals(); }
    });
});
