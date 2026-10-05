import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { looseNode, looseWindow, targetMatching } from './helpers/loose-dom.js';

const STAGE_MODULE = '../../src/ui/effects/breathing/stage/breath-stage.js';

let Guide;
let guide;
let now;
let hidden;
let frames;
let doc;
let win;
let stages;
let stageFails;

/** Advance the clock and run the guide's pending animation frame. */
function frame(ms = 0) {
    now += ms;
    const next = frames.entries().next().value;
    if (!next) return;
    frames.delete(next[0]);
    next[1](now);
}

function setHidden(value) {
    hidden = value;
    doc.fire('visibilitychange');
}

async function settle() {
    await vi.dynamicImportSettled();
    await Promise.resolve();
}

const text = (node) => node.textContent;
const key = (name, extra = {}) => doc.fire('keydown', { key: name, target: looseNode(), ...extra });

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    now = 1000;
    hidden = false;
    frames = new Map();
    stages = [];
    stageFails = false;
    let nextFrame = 1;
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
    doc = looseNode();
    Object.defineProperty(doc, 'hidden', { get: () => hidden });
    doc.body = looseNode('body');
    doc.createElement = (tag) => looseNode(tag);
    win = looseWindow({ settingsManager: { get: () => ({ effectQuality: 'Medium' }) } });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    vi.doMock(STAGE_MODULE, () => ({
        BreathStage: class {
            constructor(container, options) {
                if (stageFails) throw new Error('no GPU');
                this.container = container;
                this.options = options;
                ['setFocus', 'setSessionPhase', 'setBreath', 'stop', 'dispose'].forEach((name) => { this[name] = vi.fn(); });
                this.setWorld = vi.fn(() => Promise.resolve());
                this.start = vi.fn(() => Promise.resolve());
                stages.push(this);
            }
        },
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    ({ BreathingGuide: Guide } = await import('../../src/ui/effects/breathing/breathing-guide.js'));
    guide = new Guide(doc.body);
});

afterEach(async () => {
    guide?.destroy();
    await vi.dynamicImportSettled();
    vi.doUnmock(STAGE_MODULE);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('breathing guide cadence', () => {
    it('keeps the fractional overshoot across phase boundaries', () => {
        const changes = [];
        guide.onPhaseChangeCallback = (next, previous) => changes.push([previous, next]);
        guide.setExternalControl(true);
        guide.start();
        guide.overridePattern([1, 0, 1, 0]);
        frame(1250);
        expect(guide.currentPhase).toBe('exhale');
        expect(guide.root.style['--breath']).toBe((1 - (0.5 - 0.5 * Math.cos(Math.PI * 0.25))).toFixed(4));
        frame(1250);
        expect(guide.currentPhase).toBe('inhale');
        expect(Number(guide.root.style['--breath'])).toBeCloseTo(0.5, 3);
        expect(changes).toEqual([['inhale', 'exhale'], ['exhale', 'inhale']]);
    });

    it('never shows a hold the pattern does not have', () => {
        const seen = new Set();
        guide.onPhaseChangeCallback = (next) => seen.add(next);
        guide.setTechnique('coherence');
        guide.start();
        for (let i = 0; i < 80; i++) frame(250);
        expect([...seen].sort()).toEqual(['exhale', 'inhale']);
        expect(guide.segments[1].segment.hidden).toBe(true);
        expect(guide.segments[3].segment.hidden).toBe(true);
    });

    it('skips whole missed cycles after a long stall and reports one change, not a replay', () => {
        const changes = vi.fn();
        guide.onPhaseChangeCallback = changes;
        guide.setExternalControl(true);
        guide.start();
        guide.overridePattern([2, 1, 3, 1]);
        frame(7 * 40 * 1000 + 2500);
        expect(guide.currentPhase).toBe('hold1');
        expect(changes).toHaveBeenCalledTimes(1);
        expect(changes).toHaveBeenLastCalledWith('hold1', 'inhale');
    });

    it('starts on the first phase that has a duration and keeps the caller\'s pattern', () => {
        const pattern = [0, 0, 0, 60];
        guide.setExternalControl(true);
        guide.start();
        guide.overridePattern(pattern);
        expect(guide.currentPhase).toBe('hold2');
        pattern[3] = 1;
        expect(guide.pattern).toEqual([0, 0, 0, 60]);
        guide.overridePattern([0, 0, 0, 0]);
        guide.overridePattern([4, 4]);
        expect(guide.pattern).toEqual([0, 0, 0, 60]);
    });

    it('says what to do: the phase, the seconds left, and the world\'s own cue', () => {
        guide.setTechnique('ocean-breath');
        guide.start();
        frame(1000);
        expect(text(guide.phaseWord)).toBe('Breathe in');
        expect(text(guide.count)).toBe('3');
        expect(text(guide.hint)).toBe('Rise with the wave');
        frame(3500);
        expect(text(guide.phaseWord)).toBe('Breathe out');
        expect(text(guide.count)).toBe('4');
        expect(text(guide.hint)).toBe('Slide back');
        expect(guide.root.dataset.phase).toBe('exhale');
        expect(guide.segments[0].fill.style.transform).toBe('scaleX(1.0000)');
        expect(guide.segments[2].fill.style.transform).toBe('scaleX(0.1250)');
        expect(guide.segments[2].segment.dataset.active).toBe('true');
    });

    it('sizes the cycle bar by how long each phase lasts', () => {
        guide.setTechnique('calm-sleep');
        expect(guide.segments.map(({ segment }) => segment.style['flex-grow'])).toEqual(['4', '7', '8', '0.0001']);
        expect(guide.segments.map(({ seconds }) => text(seconds))).toEqual(['4', '7', '8', '']);
        expect(text(guide.eyebrow)).toBe('Sleep · 4 · 7 · 8');
        expect(text(guide.title)).toBe('Moonlit Waters');
    });
});

describe('breathing guide pause and visibility', () => {
    it('holds its place in the breath while paused', () => {
        guide.setExternalControl(true);
        guide.start();
        guide.overridePattern([4, 0, 4, 0]);
        frame(1000);
        guide.pause();
        expect(frames.size).toBe(0);
        expect(guide.pausedBadge.hidden).toBe(false);
        now += 60000;
        guide.resume();
        frame(1000);
        expect(guide.currentPhase).toBe('inhale');
        expect(text(guide.count)).toBe('2');
        expect(frames.size).toBe(1);
    });

    it('waits for the player when a standalone practice is hidden', () => {
        guide.setTechnique('ocean-breath');
        guide.start();
        frame(1000);
        setHidden(true);
        expect(frames.size).toBe(0);
        now += 30000;
        setHidden(false);
        frame(500);
        expect(guide.currentPhase).toBe('inhale');
        expect(text(guide.count)).toBe('3');
    });

    it('lets a session\'s own clock run on while the tab is hidden', () => {
        guide.setExternalControl(true);
        guide.start();
        guide.overridePattern([4, 0, 4, 0]);
        frame(1000);
        setHidden(true);
        now += 4500;
        setHidden(false);
        expect(guide.currentPhase).toBe('exhale');
    });
});

describe('breathing guide and its world', () => {
    it('loads the stage only when a practice starts, and hands it the world and tier', async () => {
        expect(stages).toHaveLength(0);
        guide.setTechnique('zen-garden');
        guide.start();
        await settle();
        expect(stages).toHaveLength(1);
        const [stage] = stages;
        expect(stage.container).toBe(guide.stageHost);
        expect(stage.options.quality).toBe('Medium');
        expect(stage.setWorld).toHaveBeenLastCalledWith('zen-garden');
        expect(stage.start).toHaveBeenCalledOnce();
        expect(guide.root.classList.contains('is-live')).toBe(false);
        stage.options.onState('ready');
        expect(guide.root.classList.contains('is-live')).toBe(true);
        frame(500);
        expect(stage.setBreath).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 0 }));
        guide.setTechnique('coherence');
        expect(stage.setWorld).toHaveBeenLastCalledWith('coherence');
        stage.options.onState('veiled');
        expect(guide.root.classList.contains('is-live')).toBe(false);
    });

    it('keeps guiding on the CSS orb when no renderer can be created', async () => {
        stageFails = true;
        guide.start();
        await settle();
        expect(guide.stage).toBeNull();
        expect(guide.root.classList.contains('is-live')).toBe(false);
        frame(2500);
        expect(text(guide.phaseWord)).toBe('Breathe in');
        expect(Number(guide.root.style['--breath'])).toBeGreaterThan(0);
    });

    it('drops a lost stage and builds a fresh one on the next start', async () => {
        guide.start();
        await settle();
        stages[0].options.onState('ready');
        stages[0].options.onState('lost');
        expect(guide.stage).toBeNull();
        expect(guide.root.classList.contains('is-live')).toBe(false);
        guide.stop();
        guide.start();
        await settle();
        expect(stages).toHaveLength(2);
    });

    it('ignores a stage module that arrives after the practice was stopped', async () => {
        guide.start();
        guide.stop();
        await settle();
        expect(stages).toHaveLength(0);
    });

    it('stops the theme behind it only once it covers the screen, and frees the GPU after a while', async () => {
        guide.start();
        await settle();
        expect(win.isThemeCovered).toBeUndefined();
        vi.advanceTimersByTime(1200);
        expect(win.isThemeCovered).toBe(true);
        guide.stop();
        expect(win.isThemeCovered).toBe(false);
        expect(stages[0].stop).toHaveBeenCalledOnce();
        expect(stages[0].dispose).not.toHaveBeenCalled();
        vi.advanceTimersByTime(500);
        expect(guide.root.hidden).toBe(true);
        vi.advanceTimersByTime(60000);
        expect(stages[0].dispose).toHaveBeenCalledOnce();
        expect(guide.stage).toBeNull();
    });

    it('announces every start and stop so the Hub and the mode can follow', () => {
        const heard = [];
        win.addEventListener('breathingGuideChange', (event) => heard.push(event.detail));
        guide.start();
        guide.start();
        guide.stop();
        guide.stop();
        expect(heard).toEqual([{ active: true, session: false }, { active: false, session: false }]);
    });
});

describe('breathing guide controls', () => {
    it('ends a standalone practice on Escape and keeps the key from the mode behind it', () => {
        guide.start();
        const event = key('Escape');
        expect(guide.isActive).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expect(event.stoppedNow).toBe(true);
        expect(doc.listenerCount('keydown')).toBe(0);
    });

    it('changes world with the arrow keys and says so', () => {
        const heard = [];
        win.addEventListener('breathingTechniqueChange', (event) => heard.push(event.detail.id));
        guide.start();
        key('ArrowRight');
        key('ArrowLeft');
        key('ArrowLeft');
        expect(heard).toEqual(['box-breathing', 'deep-relaxation', 'electric-storm']);
        expect(guide.currentTechnique).toBe('electric-storm');
    });

    it('leaves the keyboard alone while the Hub is open above it or a field has focus', () => {
        guide.start();
        doc.body.classList.add('serenity-hub-open');
        expect(key('Escape').defaultPrevented).toBe(false);
        doc.body.classList.remove('serenity-hub-open');
        const field = targetMatching({ 'input': true });
        expect(key('Escape', { target: field }).defaultPrevented).toBe(false);
        expect(guide.isActive).toBe(true);
    });

    it('asks before ending a session, and only then tells its owner', () => {
        const control = vi.fn();
        guide.setExternalControl(true);
        guide.onControl = control;
        guide.start();
        key('Escape');
        expect(guide.isActive).toBe(true);
        expect(guide.confirm.hidden).toBe(false);
        key('Escape');
        expect(guide.confirm.hidden).toBe(true);
        expect(control).not.toHaveBeenCalled();
        guide.root.fire('click', { target: targetMatching({ '[data-action]': { dataset: { action: 'end' } } }) });
        guide.root.fire('click', { target: targetMatching({ '[data-action]': { dataset: { action: 'confirm-end' } } }) });
        expect(control).toHaveBeenCalledExactlyOnceWith('end');
    });

    it('pauses and resumes a session with Space, never a standalone practice', () => {
        const control = vi.fn();
        guide.start();
        expect(key(' ').defaultPrevented).toBe(false);
        guide.setExternalControl(true);
        guide.onControl = control;
        expect(key(' ').stoppedNow).toBe(true);
        expect(control).toHaveBeenLastCalledWith('pause');
        guide.pause();
        key(' ');
        expect(control).toHaveBeenLastCalledWith('resume');
    });
});

describe('breathing guide under a session', () => {
    it('follows the session\'s rhythm and prompts, and returns to the world\'s own afterwards', () => {
        guide.setTechnique('energizing');
        guide.setExternalControl(true);
        guide.setSessionTheme('ELIXIR');
        guide.overridePattern([3, 0, 1, 0]);
        guide.setTechnique('wim-hof');
        guide.cycleTechnique(1);
        expect(guide.pattern).toEqual([3, 0, 1, 0]);
        expect(guide.currentTechnique).toBe('wim-hof');
        guide.setPrompt('Round 1 • Activate', 'Mouth breathing.');
        expect(text(guide.title)).toBe('Round 1 • Activate');
        expect(text(guide.note)).toBe('Mouth breathing.');
        expect(guide.root.dataset.session).toBe('ELIXIR');
        expect(guide.root.style['--breath-accent']).toBe('255, 150, 120');
        guide.setExternalControl(false);
        expect(guide.pattern).toEqual([2, 0, 1, 0]);
        expect(guide.onControl).toBeNull();
        expect(text(guide.title)).toBe('Volcanic Fire');
        expect(guide.root.style['--breath-accent']).toBe('255, 140, 80');
    });

    it('calls an empty hold a hold during retention and leaves its long count to the journey', () => {
        guide.setExternalControl(true);
        guide.start();
        guide.overridePattern([0, 0, 0, 120]);
        guide.setSessionPhase('retention', 0.25);
        frame(500);
        expect(text(guide.phaseWord)).toBe('Hold');
        expect(text(guide.count)).toBe('');
        expect(text(guide.hint)).toBe('Rest in the stillness');
        expect(text(guide.segments[3].label)).toBe('Hold');
        expect(guide.root.style['--session-phase-progress']).toBe('0.2500');
    });

    it('draws the journey once and moves only the current stage', () => {
        guide.setExternalControl(true);
        guide.setJourney([
            { type: 'grounding', round: 0, seconds: 180 },
            { type: 'active', round: 1, seconds: 240 },
            { type: 'retention', round: 1, seconds: 60 },
        ]);
        guide.showProgress(true);
        const marks = guide.journeyTrack.children;
        expect(marks.map((mark) => mark.style.flexGrow)).toEqual(['180', '240', '60']);
        const progress = {
            sessionName: 'Hale Base', phase: 'active', phaseIndex: 2, phaseProgress: 0.5, round: 1, totalRounds: 3,
            breathCount: 14, totalBreaths: 30, remainingTime: 120, sessionProgress: 0.4, sessionRemaining: 900,
        };
        guide.updateProgress(progress);
        expect(text(guide.eyebrow)).toBe('Hale Base · Round 1 of 3');
        expect(text(guide.journeyStage)).toBe('Breathe');
        expect(text(guide.journeyDetail)).toBe('Breath 15 of 30');
        expect(text(guide.journeyRemaining)).toBe('15 min to go');
        expect(marks.map((mark) => mark.dataset.state)).toEqual(['done', 'current', 'upcoming']);
        expect(marks[1].firstChild.style.transform).toBe('scaleX(0.5000)');
        expect(guide.journeyTrack.getAttribute('aria-valuenow')).toBe('40');
        guide.updateProgress({ phase: 'retention', phaseIndex: 3, phaseProgress: 0.1, remainingTime: 54 });
        expect(text(guide.journeyDetail)).toBe('0:54 left');
        expect(marks.map((mark) => mark.dataset.state)).toEqual(['done', 'done', 'current']);
    });

    it('cannot be restarted once destroyed', () => {
        guide.start();
        guide.destroy();
        expect(guide.root.removed).toBe(true);
        expect(doc.listenerCount('visibilitychange')).toBe(0);
        guide.start();
        expect(guide.isActive).toBe(false);
        guide = null;
    });
});
