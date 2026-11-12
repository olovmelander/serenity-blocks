import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BREATH_WORLDS } from '../../src/ui/effects/breathing/breath-catalogue.js';
import {
    BREATH_CAUTION, BREATH_CAUTION_TEXT, BREATH_SAFETY_ACK, BREATH_SAFETY_VERSION, STRONG_REST_SECONDS,
    STRONG_WORLD_BREATHS, breathCautionMarkup, canPractise, createStrongDose, isBreathSafetyRead, isStrongPattern,
    isStrongSession, setBreathSafetyRead,
} from '../../src/ui/effects/breathing/breath-safety.js';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
    };
}

describe('breathing safety note (breath-safety.js)', () => {
    beforeEach(() => {
        vi.stubGlobal('Audio', class {
            constructor() {
                this.pause = vi.fn();
                this.play = vi.fn().mockResolvedValue();
                this.load = vi.fn();
            }
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('treats only Volcanic Fire among the twelve worlds as fast breathing', () => {
        expect(BREATH_WORLDS.filter((world) => isStrongPattern(world.pattern)).map((world) => world.id))
            .toEqual(['volcanic-fire']);
        expect(isStrongPattern([3, 0, 2, 0])).toBe(true);
        expect(isStrongPattern([3, 1, 3, 1])).toBe(false);
        expect(isStrongPattern(null)).toBe(false);
    });

    it('asks before the sessions with fast breathing or holds you end yourself, and no others', () => {
        const manager = new BreathworkSessionManager({});
        const strong = Object.entries(manager.SESSIONS)
            .filter(([, session]) => isStrongSession(session.phases)).map(([id]) => id).sort();
        expect(strong).toEqual(['BASE', 'ELIXIR', 'SUNRISE']);
        manager.destroy();
    });

    it('names the people who should not practise it, and never asks for a squeeze', () => {
        for (const words of [
            'pregnant', 'epilepsy', 'blood-pressure', 'fainting', 'water', 'driving', 'standing',
            'For adults only', 'asthma or COPD', 'a past stroke', 'Never force a hold', 'chest pain',
            'panic attacks or a serious mental-health condition', 'an aneurysm', 'surgery recently',
            'If you have any medical condition or take medication, ask a doctor first.',
            'If you faint, stop for the day, and get help if you do not recover quickly.',
            'Tingling or cramping hands mean ease off',
        ]) {
            expect(BREATH_CAUTION_TEXT).toContain(words);
        }
        const manager = new BreathworkSessionManager({});
        const prompts = Object.values(manager.SESSIONS).flatMap((session) => session.phases)
            .map((phase) => `${phase.prompt || ''} ${phase.subPrompt || ''}`);
        expect(prompts.filter((text) => /squeeze/i.test(text))).toEqual([]);
        manager.destroy();
    });

    it('is a lead line and a short list, drawn the same wherever it shows, with a tick that says what it asks', () => {
        expect(BREATH_CAUTION.points.length).toBeGreaterThanOrEqual(4);
        expect(BREATH_CAUTION.points.length).toBeLessThanOrEqual(6);
        expect(BREATH_CAUTION_TEXT).toBe([BREATH_CAUTION.lead, ...BREATH_CAUTION.points].join(' '));
        const markup = breathCautionMarkup({ icon: '<svg></svg>', closing: 'A closing line.' });
        const items = BREATH_CAUTION.points.map((point) => `<li>${point}</li>`).join('');
        expect(markup).toBe(`<p class="breath-note__lead"><svg></svg><span>${BREATH_CAUTION.lead}</span></p>`
            + `<ul class="breath-note__points">${items}</ul>`
            + '<p class="breath-note__closing">A closing line.</p>');
        expect(breathCautionMarkup()).not.toContain('breath-note__closing');
        // Plain words of the game's own: nothing in them needs escaping.
        expect(BREATH_CAUTION_TEXT).not.toMatch(/[<>&"]/);
        expect(BREATH_SAFETY_ACK).toBe('I am 18 or over, I have read this, and none of it applies to me');
        // Changed words are read once more by everyone.
        expect(BREATH_SAFETY_VERSION).toBe('2026-11-12');
    });

    it('says what a fast breath, a hold and a pause feel like without making light of the signs', () => {
        const manager = new BreathworkSessionManager({});
        const stages = Object.entries(manager.SESSIONS).flatMap(([id, session]) => session.phases
            .map((phase) => ({ id, type: phase.type, words: `${phase.prompt || ''}. ${phase.subPrompt || ''}` })));
        // Tingling is a sign to ease off, never something to breathe through.
        stages.filter((stage) => /tingl/i.test(stage.words)).forEach((stage) => {
            expect(stage.words, stage.id).toMatch(/slow down|pause/i);
            expect(stage.words, stage.id).not.toMatch(/normal/i);
        });
        // Every hold says it is yours to end, whenever you want.
        const holds = stages.filter((stage) => stage.type === 'retention');
        expect(holds).toHaveLength(6);
        const yours = /breathe in (whenever|as soon as|the moment) you (want to|like|feel like it)/i;
        holds.forEach((stage) => expect(stage.words, stage.id).toMatch(yours));
        const every = [
            ...stages.map((stage) => stage.words),
            ...Object.values(manager.SESSIONS).map((session) => session.description),
        ];
        for (const never of [
            /keep going/i, /surrender/i, /you are safe/i, /deep hold/i, /as long as (it )?feels good/i,
            /tingling is normal/i, /energy rise/i, /you are held/i, /simply watch/i, /deep silence/i,
        ]) {
            expect(every.filter((words) => never.test(words)), String(never)).toEqual([]);
        }
        manager.destroy();
    });

    it('lets a fast world run for thirty breaths, then rest a minute before more (createStrongDose)', () => {
        expect(STRONG_WORLD_BREATHS).toBe(30);
        expect(STRONG_REST_SECONDS).toBeGreaterThanOrEqual(60);
        const dose = createStrongDose();
        let now = 0;
        for (let i = 1; i < STRONG_WORLD_BREATHS; i++) {
            now += 5000;
            expect(dose.breath(now), `breath ${i}`).toBe(false);
            expect(dose.restLeft(now)).toBe(0);
        }
        now += 5000;
        expect(dose.breath(now)).toBe(true);
        expect(dose.restLeft(now)).toBe(STRONG_REST_SECONDS * 1000);
        expect(dose.restLeft(now + 20000)).toBe((STRONG_REST_SECONDS - 20) * 1000);
        // The rest over, the count starts again.
        now += STRONG_REST_SECONDS * 1000;
        expect(dose.restLeft(now)).toBe(0);
        expect(dose.breath(now + 5000)).toBe(false);
    });

    it('remembers the current note only', () => {
        const storage = memoryStorage();
        expect(isBreathSafetyRead(storage)).toBe(false);
        storage.setItem('serenity.breathSafetyRead', 'an older note');
        expect(isBreathSafetyRead(storage)).toBe(false);
        setBreathSafetyRead(true, storage);
        expect(storage.getItem('serenity.breathSafetyRead')).toBe(BREATH_SAFETY_VERSION);
        expect(isBreathSafetyRead(storage)).toBe(true);
        setBreathSafetyRead(false, storage);
        expect(isBreathSafetyRead(storage)).toBe(false);
        expect(isBreathSafetyRead(null)).toBe(false);
    });

    it('has one rule for what may be practised: a gentle rhythm always, a fast one once the note is read', () => {
        const storage = memoryStorage();
        expect(canPractise([5, 0, 5, 0], storage)).toBe(true);
        expect(canPractise([3, 0, 2, 0], storage)).toBe(false);
        // Without storage (private browsing) the note cannot be remembered: the fast rhythm waits.
        expect(canPractise([3, 0, 2, 0], null)).toBe(false);
        setBreathSafetyRead(true, storage);
        expect(canPractise([3, 0, 2, 0], storage)).toBe(true);
        BREATH_WORLDS.filter((world) => world.id !== 'volcanic-fire')
            .forEach((world) => expect(canPractise(world.pattern, memoryStorage()), world.id).toBe(true));
    });
});
