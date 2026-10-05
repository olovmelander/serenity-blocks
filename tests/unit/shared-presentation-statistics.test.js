import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceMonitor } from '../../src/utils/performance-monitor.js';
import { BreathingGuide } from '../../src/ui/effects/breathing/breathing-guide.js';
import { getBreathWorld } from '../../src/ui/effects/breathing/breath-catalogue.js';

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

/** A guide with write-counting nodes in place of its DOM: only the presentation paths run. */
function presentationGuide() {
    const guide = Object.create(BreathingGuide.prototype);
    Object.assign(guide, {
        _presentation: new WeakMap(),
        root: node(),
        phaseWord: node(),
        count: node(),
        hint: node(),
        eyebrow: node(),
        journeyStage: node(),
        journeyDetail: node(),
        journeyRemaining: node(),
        journeyTrack: Object.assign(node(), { attributes: [], setAttribute(key, value) { this.attributes.push([key, value]); } }),
        segments: Array.from({ length: 4 }, () => ({ segment: node(), fill: node() })),
        world: getBreathWorld('deep-relaxation'),
        sessionPhase: null,
        isExternallyControlled: true,
        _progressVisible: true,
        _progress: {},
    });
    guide._journeyMarks = Array.from({ length: 3 }, () => {
        const fill = node();
        return Object.assign(node(), { firstChild: fill });
    });
    return guide;
}

const everyNode = (guide) => [
    guide.root, guide.phaseWord, guide.count, guide.hint, guide.eyebrow, guide.journeyStage, guide.journeyDetail,
    guide.journeyRemaining, ...guide.segments.flatMap(({ segment, fill }) => [segment, fill]),
    ...guide._journeyMarks.flatMap((mark) => [mark, mark.firstChild]),
];
const writeCount = (guide) => everyNode(guide).reduce((sum, el) => sum + el.writes.length, 0);

const progress = {
    sessionName: 'Hale Base', phase: 'active', phaseIndex: 2, phaseProgress: 0.3, round: 1, totalRounds: 3,
    totalBreaths: 20, breathCount: 4, remainingTime: 90, sessionProgress: 0.3, sessionRemaining: 600,
};

describe('breathing presentation retains identical state', () => {
    it('writes an unchanged frame once: a hold costs no DOM work', () => {
        const guide = presentationGuide();
        guide._render(1, 0.4, 1, 3.2);
        const first = writeCount(guide);
        expect(first).toBeGreaterThan(0);
        for (let i = 0; i < 240; i++) guide._render(1, 0.4, 1, 3.2);
        expect(writeCount(guide)).toBe(first);
        // Only what moved is written: the fill of the current segment.
        guide._render(1, 0.45, 1, 3.1);
        expect(writeCount(guide)).toBe(first + 1);
        expect(guide.segments[1].fill.style.transform).toBe('scaleX(0.4500)');
        guide._render(1, 0.9, 1, 2.9);
        expect(guide.count.textContent).toBe('3');
    });

    it('follows every changing value through an inhale', () => {
        const guide = presentationGuide();
        for (const value of [0, 0.3, 0.9, 1]) {
            guide._render(0, value, value, 5 * (1 - value));
            expect(guide.root.style['--breath']).toBe(value.toFixed(4));
            expect(guide.segments[0].fill.style.transform).toBe(`scaleX(${value.toFixed(4)})`);
        }
        expect(guide.phaseWord.textContent).toBe('Breathe in');
        expect(guide.hint.textContent).toBe('Lift the lights');
    });

    it('writes unchanged session progress once and moves only the current stage', () => {
        const guide = presentationGuide();
        guide.updateProgress(progress);
        const first = writeCount(guide);
        for (let i = 0; i < 100; i++) guide.updateProgress(progress);
        expect(writeCount(guide)).toBe(first);
        expect(guide.journeyTrack.attributes).toEqual([['aria-valuenow', '30']]);
        guide.updateProgress({ phaseProgress: 0.35 });
        expect(writeCount(guide)).toBe(first + 1);
        expect(guide._journeyMarks[1].firstChild.style.transform).toBe('scaleX(0.3500)');
        expect(guide.journeyDetail.textContent).toBe('Breath 5 of 20');
    });

    it('retains hidden progress and catches up on show without hidden writes', () => {
        const guide = presentationGuide();
        guide.journey = { hidden: false };
        guide.showProgress(false);
        for (let i = 0; i < 100; i++) guide.updateProgress({ ...progress, round: 2, breathCount: 8 });
        expect(writeCount(guide)).toBe(0);
        guide.showProgress(true);
        expect(guide.eyebrow.textContent).toBe('Hale Base · Round 2 of 3');
        expect(guide.journeyDetail.textContent).toBe('Breath 9 of 20');
        expect(guide.journey.hidden).toBe(false);
    });
});
