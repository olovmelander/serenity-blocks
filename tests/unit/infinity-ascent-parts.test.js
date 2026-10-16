/**
 * The parts of Infinity's ascent (src/ui/infinity/ascent/): where the view is (ascent-model),
 * what the tower remembers (tower-memory), the signal the themes read (core/exploration-signal),
 * the theme's colours (ascent-tints), the rumble (ascent-haptics), the sounds (ascent-audio) and
 * the well's overlay (ascent-overlay).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    ASCENT, crossings, milestoneHeights, themeShift, viewMetrics,
} from '../../src/ui/infinity/ascent/ascent-model.js';
import {
    MEMORY, TowerMemory, agoText, describeMoment,
} from '../../src/ui/infinity/ascent/tower-memory.js';
import { readExplorationSignal, setExplorationSignal } from '../../src/core/exploration-signal.js';
import { tintsFromIcon } from '../../src/ui/infinity/ascent/ascent-tints.js';
import { AscentHaptics, RUMBLE } from '../../src/ui/infinity/ascent/ascent-haptics.js';
import { AscentAudio, tickPitch } from '../../src/ui/infinity/ascent/ascent-audio.js';
import { AscentOverlay } from '../../src/ui/infinity/ascent/ascent-overlay.js';
import { EVENTS } from '../../src/events/event-bus.js';
import { looseNode } from './helpers/loose-dom.js';

afterEach(() => {
    setExplorationSignal(null);
    vi.unstubAllGlobals();
});

describe('where the view is', () => {
    const base = {
        home: 60, visibleRows: 20, boardLength: 140, summitRow: 70,
    };

    it('measures height from the floor and the rise from the player\'s rows', () => {
        const m = viewMetrics({ ...base, top: 60 });
        expect(m.height).toBe(70);
        expect(m.summitHeight).toBe(70);
        expect(m.riseRows).toBe(0);
        expect(m.sky).toBe(0);
        expect(m.deep).toBe(0);
        expect(m.rise).toBe(0);
        expect(viewMetrics({ ...base, top: 60, summitRow: 140 }).summitHeight).toBe(0);
    });

    it('brings the night down above and the depths up below, never all of the depths', () => {
        const up = viewMetrics({ ...base, top: 60 - ASCENT.SKY_FULL_ROWS });
        expect(up.sky).toBe(1);
        expect(up.rise).toBeGreaterThan(0.6);
        const down = viewMetrics({ ...base, top: 120 });
        expect(down.deep).toBeCloseTo(ASCENT.DEEP_MAX, 6);
        expect(down.rise).toBeLessThan(-0.9);
        expect(viewMetrics({ ...base, top: 58 }).sky).toBe(0);
    });

    it('sinks the theme as the view rises and lifts it a little as it descends, within caps', () => {
        expect(themeShift(0, 30, 900)).toBe(0);
        const rising = themeShift(10, 30, 900);
        expect(rising).toBeCloseTo(10 * 30 * ASCENT.THEME_PARALLAX, -1);
        expect(themeShift(1000, 30, 900)).toBeLessThanOrEqual(ASCENT.THEME_SINK_CAP * 900);
        expect(themeShift(-1000, 30, 900)).toBeGreaterThanOrEqual(-ASCENT.THEME_LIFT_CAP * 900);
        expect(themeShift(-20, 30, 900)).toBeLessThan(0);
        expect(themeShift(5, 0, 900)).toBe(0);
    });

    it('counts the lines passed either way, never the floor', () => {
        expect(crossings(12, 31, 10)).toEqual([20, 30]);
        expect(crossings(45, 12, 10)).toEqual([40, 30, 20]);
        expect(crossings(20, 12, 10)).toEqual([]);
        expect(crossings(5, -1, 10)).toEqual([]);
        expect(crossings(0, 5000, 10)).toHaveLength(64);
        expect(crossings(3, 3, 10)).toEqual([]);
    });

    it('puts the milestones where the HUD and the tower map do', () => {
        expect(milestoneHeights(1000)).toEqual([100, 250, 500, 750, 1000]);
        expect(milestoneHeights(undefined)).toEqual([100, 250, 500, 750, 1000]);
    });
});

describe('what the tower remembers', () => {
    function bus() {
        const handlers = new Map();
        return {
            on(name, handler) {
                handlers.set(name, handler);
                return () => handlers.delete(name);
            },
            emit(name, payload) { handlers.get(name)?.(payload); },
            handlers,
        };
    }

    it('names a moment', () => {
        expect(describeMoment({
            chain: 6, lines: 9, waveLines: 3, perfect: false,
        }).label).toBe('6-chain cascade · 9 lines');
        expect(describeMoment({
            chain: 1, lines: 4, waveLines: 4, perfect: false,
        }).label).toBe('Four lines at once');
        expect(describeMoment({
            chain: 2, lines: 2, waveLines: 1, perfect: true,
        }).kind).toBe('perfect');
        expect(describeMoment({
            chain: 2, lines: 3, waveLines: 2, perfect: false,
        })).toBeNull();
        expect(agoText(30_000)).toBe('just now');
        expect(agoText(4 * 60_000)).toBe('4 min ago');
        expect(agoText(61 * 60_000)).toBe('1 h ago');
    });

    it('keeps a chain where it began, closed by the next piece', () => {
        let now = 1000;
        const b = bus();
        const memory = new TowerMemory({ getBoardLength: () => 140, now: () => now, bus: b });
        memory.start();
        const changed = vi.fn();
        memory.onChange(changed);
        b.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [100, 101], cascadeCount: 1 });
        now += 300;
        b.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [110], cascadeCount: 2 });
        now += 300;
        b.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [115, 116], cascadeCount: 3 });
        expect(memory.marks).toEqual([]);
        b.emit(EVENTS.PIECE_LOCK, {});
        expect(memory.marks).toHaveLength(1);
        expect(memory.marks[0].height).toBeCloseTo(140 - 100.5 - 0.5, 6);
        expect(memory.marks[0].label).toBe('3-chain cascade · 5 lines');
        expect(changed).toHaveBeenCalledOnce();
        expect(memory.nearest(39)?.kind).toBe('chain');
        expect(memory.nearest(39 + MEMORY.NEAR_ROWS + 1)).toBeNull();
        now += 5 * 60_000;
        expect(memory.caption(memory.marks[0])).toBe('3-chain cascade · 5 lines · 5 min ago');
        memory.stop();
        expect(b.handlers.size).toBe(0);
    });

    it('closes a chain that has settled, and keeps only the most significant marks', () => {
        let now = 0;
        const memory = new TowerMemory({ getBoardLength: () => 400, now: () => now, bus: bus() });
        for (let i = 0; i < MEMORY.MAX_MARKS + 6; i++) {
            memory.noteClear({ lineCount: 4, clearedRows: [300 - i, 301 - i, 302 - i, 303 - i], cascadeCount: 1 });
            now += MEMORY.CHAIN_SETTLE_MS + 1;
        }
        memory.notePerfectClear();
        memory.close();
        expect(memory.marks.length).toBe(MEMORY.MAX_MARKS);
        expect(memory.marks.some((mark) => mark.kind === 'perfect')).toBe(true);
        // Lowest first.
        const heights = memory.marks.map((mark) => mark.height);
        expect([...heights].sort((a, b) => a - b)).toEqual(heights);
        memory.clear();
        expect(memory.marks).toEqual([]);
    });
});

describe('the exploration signal', () => {
    it('is silent until published, clamps, reuses one object and survives a broken source', () => {
        expect(readExplorationSignal()).toBeNull();
        setExplorationSignal(() => ({
            weight: 0.5, rise: 3, speed: -2, timeScale: 0,
        }));
        const a = readExplorationSignal();
        expect(a).toEqual({
            weight: 0.5, rise: 1, speed: -1, timeScale: 0.05,
        });
        expect(readExplorationSignal()).toBe(a);
        setExplorationSignal(() => ({ weight: 0 }));
        expect(readExplorationSignal()).toBeNull();
        setExplorationSignal(() => ({ weight: 1, rise: Number.NaN }));
        expect(readExplorationSignal().rise).toBe(0);
        setExplorationSignal(() => { throw new Error('gone'); });
        expect(readExplorationSignal()).toBeNull();
    });
});

describe('a theme\'s colours', () => {
    it('takes the glow from the icon\'s upper band and the ground from its lower band', () => {
        const size = 10;
        const data = new Uint8ClampedArray(size * size * 4);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const top = y < 5;
                data[i] = top ? 230 : 40;
                data[i + 1] = top ? 120 : 80;
                data[i + 2] = top ? 60 : 30;
                data[i + 3] = x === 0 ? 0 : 255;
            }
        }
        const tints = tintsFromIcon(data, size);
        // Warm sky in, warm glow out (red above blue), held to a readable brightness.
        expect(tints.glow[0]).toBeGreaterThan(tints.glow[2]);
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        expect(lum(tints.glow)).toBeGreaterThanOrEqual(73);
        expect(lum(tints.glow)).toBeLessThanOrEqual(169);
        expect(lum(tints.ground)).toBeLessThanOrEqual(41);
        expect(lum(tints.night)).toBeLessThan(20);
        expect(tintsFromIcon(new Uint8ClampedArray(size * size * 4), size)).toBeNull();
    });
});

describe('the rumble', () => {
    it('pulses only while the gamepad moves the view, and lets ticks purr', () => {
        const playEffect = vi.fn(() => Promise.resolve());
        let now = 0;
        const haptics = new AscentHaptics({ getGamepads: () => [{ vibrationActuator: { playEffect } }], now: () => now });
        expect(haptics.pulse('give')).toBe(false);
        haptics.useGamepad(true, 0);
        expect(haptics.pulse('give')).toBe(true);
        expect(playEffect).toHaveBeenLastCalledWith('dual-rumble', expect.objectContaining({
            duration: RUMBLE.give.duration, weakMagnitude: RUMBLE.give.weak,
        }));
        now = 100;
        expect(haptics.pulse('tick')).toBe(true);
        now = 120;
        expect(haptics.pulse('tick')).toBe(false);
        expect(haptics.pulse('bump', 0.5)).toBe(true);
        expect(playEffect.mock.calls.at(-1)[1].strongMagnitude).toBeCloseTo(RUMBLE.bump.strong * 0.5, 9);
        const silent = new AscentHaptics({ getGamepads: () => [{}] });
        silent.useGamepad(true);
        expect(silent.pulse('land')).toBe(false);
    });
});

describe('the sounds', () => {
    function fakeAudio({ muted = false } = {}) {
        const made = [];
        const param = () => ({
            value: 0,
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
            setTargetAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
        });
        const node = (kind) => {
            const n = {
                kind,
                gain: param(),
                frequency: param(),
                Q: param(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
            };
            made.push(n);
            return n;
        };
        const ctx = {
            currentTime: 1,
            state: 'running',
            createOscillator: () => node('osc'),
            createGain: () => node('gain'),
            createBiquadFilter: () => node('filter'),
            createBufferSource: () => node('source'),
            destination: { kind: 'destination' },
        };
        const bus = { kind: 'sfx-bus' };
        const sm = {
            audioContext: ctx,
            getToneDestination: vi.fn(() => bus),
            getSfxVolume: () => 0.5,
            canPlaySoundEffect: () => !muted,
            getNoiseBuffer: vi.fn(() => ({})),
            setMusicMuffle: vi.fn(() => true),
        };
        return {
            sm, made, bus, ctx,
        };
    }

    it('muffles the music on lift-off, plays on the effects bus, and opens it on landing', () => {
        const { sm, made, bus } = fakeAudio();
        const audio = new AscentAudio(sm);
        audio.liftOff();
        expect(sm.setMusicMuffle).toHaveBeenCalledWith(1, 0.7);
        expect(made.some((n) => n.kind === 'osc')).toBe(true);
        const sentToBus = made.filter((n) => n.connect.mock.calls.some(([to]) => to === bus));
        expect(sentToBus.length).toBeGreaterThan(0);
        expect(audio.wind).not.toBeNull();
        audio.motion(1, 0.5);
        expect(audio.wind.gain.gain.setTargetAtTime).toHaveBeenCalled();
        // A second lift-off does not muffle twice.
        audio.liftOff();
        expect(sm.setMusicMuffle).toHaveBeenCalledTimes(1);
        audio.land();
        expect(sm.setMusicMuffle).toHaveBeenLastCalledWith(0, 1.1);
        expect(audio.wind).toBeNull();
    });

    it('stays silent when the effects are muted, but still opens the music', () => {
        const { sm, made } = fakeAudio({ muted: true });
        const audio = new AscentAudio(sm);
        audio.liftOff();
        audio.tick(40);
        audio.chime(true);
        expect(made).toEqual([]);
        audio.release();
        expect(sm.setMusicMuffle).toHaveBeenLastCalledWith(0, 0.4);
    });

    it('ticks higher the higher the view, merging a fast patter', () => {
        expect(tickPitch(0)).toBe(520);
        expect(tickPitch(320)).toBeCloseTo(1040, 6);
        expect(tickPitch(10_000)).toBe(tickPitch(640));
        const { sm, made, ctx } = fakeAudio();
        const audio = new AscentAudio(sm);
        audio.tick(10);
        const count = made.length;
        audio.tick(20);
        expect(made.length).toBe(count);
        ctx.currentTime += 0.1;
        audio.tick(30);
        expect(made.length).toBeGreaterThan(count);
    });
});

describe('the well\'s overlay', () => {
    it('places the ruler, the floors, the marks and the way home from the camera row', () => {
        vi.stubGlobal('document', { createElement: (tag) => looseNode(tag) });
        const section = looseNode('div');
        section.clientHeight = 800;
        const overlay = new AscentOverlay(section);
        overlay.height = 800;
        overlay.render({
            presence: 0,
            top: 60,
            visibleRows: 20,
            boardLength: 140,
            home: 60,
            summitHeight: 70,
            maxRows: 1000,
            ring: 0,
            marks: [],
            caption: null,
            captionHeight: null,
        });
        expect(overlay.root.classList.contains('is-shown')).toBe(false);
        overlay.render({
            presence: 1,
            top: 20,
            visibleRows: 20,
            boardLength: 140,
            home: 60,
            summitHeight: 120,
            maxRows: 1000,
            ring: 0.5,
            marks: [{ height: 110, kind: 'chain' }],
            caption: '6-chain cascade · just now',
            captionHeight: 110,
            firstLook: true,
        });
        expect(overlay.root.classList.contains('is-shown')).toBe(true);
        expect(overlay.root.style['--ia-presence']).toBe('1.000');
        // Heights 110 and 120 are on screen (rows 20..40 = heights 120..100): two ticks, 100 too.
        const shownTicks = overlay.ticks.filter((t) => t.tick.style.display !== 'none').map((t) => t.value);
        expect(shownTicks).toEqual([100, 110, 120]);
        // A row is 40 px; height 110 is row 30, ten rows below the top.
        expect(overlay.ticks[1].tick.style.transform).toBe('translate3d(0, 400.0px, 0)');
        expect(overlay.marks[0].style.display).toBe('');
        expect(overlay.marks[0].dataset.kind).toBe('chain');
        expect(overlay.caption.textContent).toBe('6-chain cascade · just now');
        expect(overlay.home.classList.contains('is-shown')).toBe(true);
        expect(overlay.homeText.textContent).toBe('40');
        expect(overlay.home.classList.contains('is-up')).toBe(false);
        expect(overlay.altValue.textContent).toBe('110');
        expect(overlay.altSub.textContent).toBe('40 above your piece');
        expect(overlay.altimeter.classList.contains('is-first')).toBe(true);
        expect(overlay.ringFill.getAttribute('stroke-dashoffset')).not.toBeNull();
        overlay.dispose();
        expect(overlay.root).toBeNull();
    });
});
