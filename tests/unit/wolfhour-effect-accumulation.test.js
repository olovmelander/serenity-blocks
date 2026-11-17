import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

function createTheme() {
    const theme = new WolfhourTheme();
    theme.activeQualityLevel = 'High';
    return theme;
}

function countQueued(theme, type) {
    return theme.reactiveQueue.filter((token) => token.type === type).length;
}

describe('Wolfhour effect accumulation', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('preserves earlier lunar reactions when successive events claim new slots', () => {
        const theme = createTheme();
        theme.time = 10;

        const firstIndex = theme.triggerLunarReaction({
            strength: 0.72,
            combo: 0.25,
            duration: 1.8,
        });
        const firstSnapshot = { ...theme.lunarReactions[firstIndex] };

        theme.time = 10.3;
        const secondIndex = theme.triggerLunarReaction({
            strength: 0.94,
            combo: 0.75,
            duration: 2.1,
        });

        expect(firstIndex).toBe(0);
        expect(secondIndex).toBe(1);
        expect(theme.lunarReactions[firstIndex]).toMatchObject(firstSnapshot);
        expect(theme.lunarReactions[firstIndex].active).toBe(true);
        expect(theme.lunarReactions[secondIndex]).toMatchObject({
            active: true,
            startTime: 10.3,
            duration: 2.1,
            strength: 0.94,
            combo: 0.75,
        });
    });

    it.each([
        ['Minimal', 2],
        ['Low', 2],
        ['Medium', 3],
        ['High', 4],
        ['Ultra', 6],
        ['Extreme', 6],
    ])('keeps an accumulation budget on the %s quality tier', (quality, expectedSlots) => {
        const theme = createTheme();
        theme.activeQualityLevel = quality;

        expect(theme.getLunarReactionSlotCapacity()).toBe(expectedSlots);
    });

    it('never cuts a ring still lit: with the bounded pool full, a new one waits for the first to run out', () => {
        const theme = createTheme();
        const startsAndDurations = [
            [0, 10],
            [0.1, 6],
            [0.2, 4],
            [0.3, 8],
        ];

        startsAndDurations.forEach(([time, duration], index) => {
            theme.time = time;
            expect(theme.triggerLunarReaction({
                strength: 0.5 + index * 0.1,
                combo: index * 0.1,
                duration,
            })).toBe(index);
        });

        const serialsBefore = theme.lunarReactions.slice(0, 4)
            .map((reaction) => reaction.serial);
        theme.time = 3;

        const replacedIndex = theme.triggerLunarReaction({
            strength: 1.2,
            combo: 1,
            duration: 2,
        });
        const serialsAfter = theme.lunarReactions.slice(0, 4)
            .map((reaction) => reaction.serial);

        // Slot 2's ring (0.2 s + 4 s) runs out first: the new one waits there, and every ring
        // still lit rings on untouched.
        expect(replacedIndex).toBe(2);
        expect(serialsAfter).toEqual(serialsBefore);
        expect(theme.lunarReactions[2].next).toMatchObject({
            startTime: 4.2,
            duration: 2,
            strength: 1.2,
            combo: 1,
        });
        // It takes over the moment that ring has run out.
        theme.time = 4.25;
        theme.updateLunarReaction();
        expect(theme.lunarReactions[2]).toMatchObject({
            active: true,
            startTime: 4.2,
            duration: 2,
            strength: 1.2,
            combo: 1,
            next: null,
        });
        expect(theme.lunarReactions[2].serial).not.toBe(serialsBefore[2]);
        // With every slot holding one waiting, a weaker ring is let go, a stronger one waits
        // in place of the weakest waiting.
        theme.time = 4.3;
        for (const [index, reaction] of theme.lunarReactions.slice(0, 4).entries()) {
            reaction.next = {
                startTime: 20, duration: 1, strength: 0.4 + index * 0.1, combo: 0, serial: 99,
            };
        }
        expect(theme.triggerLunarReaction({ strength: 0.3 })).toBe(-1);
        expect(theme.triggerLunarReaction({ strength: 0.9 })).toBe(0);
        expect(theme.lunarReactions[0].next.strength).toBe(0.9);
    });

    it('adds effect-state energy and clamps it at the configured cap', () => {
        const theme = createTheme();

        theme.addEffectState({
            starBurstIntensity: 0.4,
            cameraShake: 0.3,
        });
        theme.addEffectState({
            starBurstIntensity: 0.35,
            cameraShake: 0.25,
        });

        expect(theme.effectState.starBurstIntensity).toBeCloseTo(0.75);
        expect(theme.effectState.cameraShake).toBeCloseTo(0.55);

        theme.addEffectState({
            starBurstIntensity: 100,
            cameraShake: 100,
            nebulaBoost: -1,
            unknownChannel: 1,
        });

        expect(theme.effectState.starBurstIntensity)
            .toBe(theme.effectStateCaps.starBurstIntensity);
        expect(theme.effectState.cameraShake).toBe(theme.effectStateCaps.cameraShake);
        expect(theme.effectState.nebulaBoost).toBe(0);
        expect(theme.effectState).not.toHaveProperty('unknownChannel');
    });

    it('keeps ambient meteors alive and emits the combo-five crash once per lock', () => {
        const theme = createTheme();
        const ambientMeteor = {
            visible: true,
            userData: { active: true, reactive: false },
        };
        theme.meteors.push(ambientMeteor);
        vi.spyOn(theme, 'resolvePieceLockOrigin').mockReturnValue({ x: 12, y: 34, z: 100 });

        theme.onPieceLock({ playerId: 'alpha' });
        theme.onCombo({ playerId: 'alpha', comboCount: 5 });

        expect(theme.meteors).toContain(ambientMeteor);
        expect(ambientMeteor).toMatchObject({
            visible: true,
            userData: { active: true, reactive: false },
        });
        expect(countQueued(theme, 'crash')).toBe(1);

        theme.onCombo({ playerId: 'alpha', comboCount: 5 });
        theme.onCombo({ playerId: 'alpha', comboCount: 6 });
        expect(countQueued(theme, 'crash')).toBe(1);

        theme.onPieceLock({ playerId: 'alpha' });
        theme.onCombo({ playerId: 'alpha', comboCount: 5 });
        expect(countQueued(theme, 'crash')).toBe(2);
        expect(theme.meteors).toEqual([ambientMeteor]);
    });

    it('tracks combo progress and reactive origins independently per player', () => {
        const theme = createTheme();
        const origins = {
            alpha: { x: -40, y: 20, z: 100 },
            beta: { x: 45, y: 28, z: 100 },
        };
        vi.spyOn(theme, 'resolvePieceLockOrigin').mockImplementation((data) => (
            origins[data.playerId]
        ));

        theme.onPieceLock({ playerId: 'alpha' });
        theme.onPieceLock({ playerId: 'beta' });
        theme.onCombo({ playerId: 'alpha', comboCount: 3 });
        theme.onCombo({ playerId: 'beta', comboCount: 4 });

        expect(theme.comboProgressByPlayer.get('alpha')).toBe(3);
        expect(theme.comboProgressByPlayer.get('beta')).toBe(4);
        expect(theme.reactiveOriginsByPlayer.get('alpha')).toEqual(origins.alpha);
        expect(theme.reactiveOriginsByPlayer.get('beta')).toEqual(origins.beta);

        const alphaMeteor = theme.reactiveQueue.find((token) => (
            token.type === 'meteor' && token.payload.origin?.x === origins.alpha.x
        ));
        const betaMeteor = theme.reactiveQueue.find((token) => (
            token.type === 'meteor' && token.payload.origin?.x === origins.beta.x
        ));
        expect(alphaMeteor?.payload.origin).toEqual(origins.alpha);
        expect(betaMeteor?.payload.origin).toEqual(origins.beta);
    });
});
