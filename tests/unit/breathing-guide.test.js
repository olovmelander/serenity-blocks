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

    it('tells others following the breath of each new phase, beside a session, until they stop', () => {
        const session = vi.fn();
        const voice = vi.fn();
        const broken = vi.fn(() => { throw new Error('listener bug'); });
        guide.onPhaseChangeCallback = session;
        guide.onPhase(broken);
        const stop = guide.onPhase(voice);
        guide.start();
        guide.overridePattern([1, 0, 1, 0]);
        frame(1250);
        expect(session).toHaveBeenLastCalledWith('exhale', 'inhale');
        // One listener failing never stops the breath or the others.
        expect(voice).toHaveBeenLastCalledWith('exhale', 'inhale');
        expect(guide.currentPhase).toBe('exhale');
        stop();
        frame(1000);
        expect(session).toHaveBeenCalledTimes(2);
        expect(voice).toHaveBeenCalledOnce();
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

    it('shows the words the voice spoke on each part of the breath, until it says others or the world changes', () => {
        guide.setTechnique('ocean-breath');
        guide.start();
        guide.setCueWords({ in: 'Let the wave come in' });
        frame(1000);
        expect(text(guide.hint)).toBe('Let the wave come in');
        frame(3500);
        // Nothing was said on the breath out: the world's own words.
        expect(text(guide.hint)).toBe('Slide back');
        guide.setCueWords({ out: 'Let it draw away' });
        frame(100);
        expect(text(guide.hint)).toBe('Let it draw away');
        expect(guide.cueWords).toEqual({ in: 'Let the wave come in', out: 'Let it draw away' });
        // Plain words were spoken ("Breathe out"): back to the world's own for that part only.
        guide.setCueWords({ out: null });
        frame(100);
        expect(text(guide.hint)).toBe('Slide back');
        expect(guide.cueWords).toEqual({ in: 'Let the wave come in' });
        guide.setTechnique('coherence');
        frame(100);
        expect(text(guide.hint)).toBe('Let the petals open');
        guide.setCueWords({ in: 'Open the lotus', out: 'Close it softly' });
        guide.setCueWords(null);
        expect(guide.cueWords).toBeNull();
        guide.setCueWords({ in: 'Open the lotus' });
        guide.stop();
        expect(guide.cueWords).toBeNull();
    });

    it('shows a world\'s own words for its hold and its rest, and the voice\'s when it speaks', () => {
        guide.setTechnique('box-breathing');
        guide.start();
        frame(4500);
        expect(text(guide.phaseWord)).toBe('Hold');
        expect(text(guide.hint)).toBe('Across the top');
        guide.setCueWords({ hold: 'Carry the light across' });
        frame(100);
        expect(text(guide.hint)).toBe('Carry the light across');
        frame(3500);
        frame(4000);
        expect(text(guide.phaseWord)).toBe('Rest');
        expect(text(guide.hint)).toBe('Along the base');
        guide.setCueWords({ rest: 'Close the square' });
        frame(100);
        expect(text(guide.hint)).toBe('Close the square');
        // A world with no words for a pause keeps the plain ones.
        guide.setTechnique('energizing');
        frame(3200);
        expect(text(guide.phaseWord)).toBe('Hold');
        expect(text(guide.hint)).toBe('Stay full, stay soft');
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
        // It begins on Heart Glow, a world everyone has from the start.
        expect(guide.currentTechnique).toBe('coherence');
        guide.start();
        key('ArrowRight');
        key('ArrowLeft');
        key('ArrowLeft');
        expect(heard).toEqual(['triangle', 'coherence', 'energizing']);
        expect(guide.currentTechnique).toBe('energizing');
    });

    it('steps only through the worlds you have found, and starts on one of them', () => {
        const found = new Set(['coherence', 'calm-sleep', 'box-breathing', 'zen-garden']);
        guide.canChoose = (id) => found.has(id);
        guide.start();
        key('ArrowRight');
        expect(guide.currentTechnique).toBe('zen-garden');
        key('ArrowRight');
        expect(guide.currentTechnique).toBe('box-breathing');
        key('ArrowLeft');
        expect(guide.currentTechnique).toBe('zen-garden');
        // A session may leave the guide in a world you have not found: you can step away from it.
        guide.setTechnique('wim-hof');
        key('ArrowRight');
        expect(guide.currentTechnique).toBe('zen-garden');
        expect(guide.allowedWorld('calm-sleep')).toBe('calm-sleep');
        expect(guide.allowedWorld('wim-hof')).toBe('coherence');
        expect(guide.allowedWorld('not-a-world')).toBe('coherence');
        found.delete('coherence');
        expect(guide.allowedWorld('wim-hof')).toBe('box-breathing');
        // With one world, there is nowhere to step to.
        guide.canChoose = (id) => id === 'zen-garden';
        const heard = [];
        win.addEventListener('breathingTechniqueChange', (event) => heard.push(event.detail.id));
        key('ArrowLeft');
        expect(heard).toEqual([]);
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

    it('asks before ending a session, holds the session while it asks, and only then ends it', () => {
        const control = vi.fn();
        guide.setExternalControl(true);
        guide.onControl = control;
        guide.start();
        key('Escape');
        expect(guide.isActive).toBe(true);
        expect(guide.confirm.hidden).toBe(false);
        expect(guide.root.classList.contains('is-confirming')).toBe(true);
        expect(control).toHaveBeenLastCalledWith('suspend');
        key('Escape');
        expect(guide.confirm.hidden).toBe(true);
        expect(control).toHaveBeenLastCalledWith('unsuspend');
        guide.root.fire('click', { target: targetMatching({ '[data-action]': { dataset: { action: 'end' } } }) });
        guide.root.fire('click', { target: targetMatching({ '[data-action]': { dataset: { action: 'confirm-end' } } }) });
        expect(control.mock.calls.map(([action]) => action)).toEqual(['suspend', 'unsuspend', 'suspend', 'end']);
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
        expect(guide.pattern).toEqual([3, 0, 2, 0]);
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

    it('lets an open hold end when you breathe in: Space, a tap on the world, or the button', () => {
        const control = vi.fn();
        guide.setExternalControl(true);
        guide.onControl = control;
        guide.start();
        guide.showProgress(true);
        guide.overridePattern([0, 0, 0, 60]);
        guide.setSessionPhase('retention', 0);
        guide.setGuidance({ mode: 'open-hold', suggested: 60, cap: 120 });
        expect(guide.root.dataset.guidance).toBe('open-hold');
        expect(text(guide.holdLabel)).toBe('Suggested 1:00');
        frame(100);
        expect(text(guide.phaseWord)).toBe('Hold');
        expect(text(guide.count)).toBe('');
        expect(text(guide.hint)).toBe('Press Space or click to breathe in');
        key(' ');
        expect(control).toHaveBeenLastCalledWith('breathe');
        guide.root.fire('click', { target: looseNode() });
        expect(control).toHaveBeenCalledTimes(2);
        guide.root.fire('click', { target: targetMatching({ '[data-action]': { dataset: { action: 'breathe' } } }) });
        expect(control).toHaveBeenCalledTimes(3);
        // P pauses; while paused, Space resumes instead of breathing.
        key('p');
        expect(control).toHaveBeenLastCalledWith('pause');
        guide.pause();
        key(' ');
        expect(control).toHaveBeenLastCalledWith('resume');
        guide.root.fire('click', { target: looseNode() });
        expect(control).toHaveBeenCalledTimes(5);
    });

    it('draws the hold dial: counting up past the suggestion, or down through a timed pause', () => {
        guide.setExternalControl(true);
        guide.start();
        guide.showProgress(true);
        guide.overridePattern([0, 0, 0, 60]);
        guide.setGuidance({ mode: 'open-hold', suggested: 60, cap: 120 });
        guide.updateProgress({
            phase: 'retention', phaseIndex: 1, phaseProgress: 0.5, holdElapsed: 30.6, holdSuggested: 60, holdReady: false,
        });
        expect(text(guide.holdTime)).toBe('0:30');
        expect(guide.root.style['--hold']).toBe('0.5100');
        expect(text(guide.journeyDetail)).toBe('Held 0:30');
        expect(guide.root.classList.contains('is-hold-ready')).toBe(false);
        guide.updateProgress({ holdElapsed: 72.4, holdReady: true, phaseProgress: 1 });
        expect(text(guide.holdTime)).toBe('1:12');
        expect(guide.root.style['--hold']).toBe('1.0000');
        expect(guide.root.classList.contains('is-hold-ready')).toBe(true);
        frame(100);
        expect(text(guide.phaseWord)).toBe('Breathe in when ready');
        guide.setGuidance({ mode: 'timed-hold', suggested: 25 });
        expect(guide.root.classList.contains('is-hold-ready')).toBe(false);
        guide.updateProgress({
            phase: 'retention', holdElapsed: null, phaseProgress: 0.4, remainingTime: 15,
        });
        expect(text(guide.holdTime)).toBe('0:15');
        expect(text(guide.holdLabel)).toBe('Rest in the pause');
        expect(text(guide.journeyDetail)).toBe('0:15 left');
        expect(text(guide.journeyStage)).toBe('Pause');
        frame(100);
        expect(text(guide.phaseWord)).toBe('Pause');
    });

    it('stops counting in the stages you breathe on your own', () => {
        guide.setExternalControl(true);
        guide.start();
        guide.overridePattern([4, 4, 4, 4]);
        [['carry', 'Keep the rhythm'], ['natural', 'Breathe naturally'], ['closing', 'Come back gently']].forEach(([mode, words]) => {
            guide.setGuidance({ mode });
            frame(100);
            expect(text(guide.phaseWord)).toBe(words);
            expect(text(guide.count)).toBe('');
        });
        expect(text(guide.hint)).toBe('Open your eyes when you are ready');
        // A session words its own carry: a rhythm without holds is not "in, hold, out, hold".
        guide.setGuidance({ mode: 'carry', hint: 'On your own now: the same easy rhythm' });
        frame(100);
        expect(text(guide.phaseWord)).toBe('Keep the rhythm');
        expect(text(guide.hint)).toBe('On your own now: the same easy rhythm');
        guide.setGuidance({ mode: 'carry' });
        frame(100);
        expect(text(guide.hint)).toBe('On your own now: in, hold, out, hold');
        guide.setGuidance({ mode: 'paced' });
        frame(100);
        expect(text(guide.phaseWord)).toBe('Breathe in');
        expect(text(guide.count)).not.toBe('');
    });

    it('shows a round card for a few seconds, speaks stages to screen readers, and carries the intention', async () => {
        guide.setExternalControl(true);
        guide.start();
        expect(guide.phaseWord.getAttribute('aria-live')).toBe('off');
        guide.showChapter({ eyebrow: 'Round 2 of 3', title: 'Go Deeper', note: '40 breaths' });
        expect(guide.chapter.classList.contains('is-showing')).toBe(true);
        expect(text(guide.chapterTitle)).toBe('Go Deeper');
        await vi.advanceTimersByTimeAsync(3700);
        expect(guide.chapter.classList.contains('is-showing')).toBe(false);
        guide.announce('Hold on empty lungs.');
        await vi.advanceTimersByTimeAsync(100);
        expect(text(guide.announcer)).toBe('Hold on empty lungs.');
        guide.setIntention('Find calm');
        expect(guide.intentionLine.hidden).toBe(false);
        expect(text(guide.intentionLine)).toBe('Your intention · Find calm');
        guide.setExternalControl(false);
        expect(guide.intentionLine.hidden).toBe(true);
        expect(guide.guidance).toBeNull();
        expect(guide.phaseWord.getAttribute('aria-live')).toBe('polite');
    });

    it('answers a gamepad: A breathes in or pauses, B asks to end and B again ends', () => {
        const control = vi.fn();
        expect(guide.primaryAction()).toBe(false);
        guide.setExternalControl(true);
        guide.onControl = control;
        guide.start();
        guide.setGuidance({ mode: 'open-hold', suggested: 60 });
        guide.primaryAction();
        expect(control).toHaveBeenLastCalledWith('breathe');
        guide.setGuidance({ mode: 'paced' });
        guide.primaryAction();
        expect(control).toHaveBeenLastCalledWith('pause');
        guide.backAction();
        expect(guide.confirm.hidden).toBe(false);
        expect(guide.confirmHint.hidden).toBe(false);
        expect(control).toHaveBeenLastCalledWith('suspend');
        guide.backAction();
        expect(control).toHaveBeenLastCalledWith('end');
        expect(guide.confirm.hidden).toBe(true);
    });

    it('gives the pause button back its own name after a session ends paused', () => {
        guide.setExternalControl(true);
        guide.start();
        guide.pause();
        expect(guide.pauseButton.getAttribute('aria-label')).toBe('Resume session');
        guide.setExternalControl(false);
        expect(guide.pauseButton.getAttribute('aria-label')).toBe('Pause session');
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
