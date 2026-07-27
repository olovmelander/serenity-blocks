import { describe, expect, it } from 'vitest';

import {
    createStillwaterCharacterState,
    STILLWATER_SPIRIT_ANCHORS,
    STILLWATER_TROLL_GESTURE,
    STILLWATER_TROLL_PATH_X,
} from '../../src/themes/stillwater/sim/stillwater-character-state.js';

describe('Stillwater Wave 5 character state', () => {
    it('keeps every authored spirit and troll anchor outside the board aperture', () => {
        Object.values(STILLWATER_SPIRIT_ANCHORS).forEach(([x]) => {
            expect(x).toBeLessThanOrEqual(-14);
        });
        Object.values(STILLWATER_TROLL_PATH_X).forEach((x) => {
            expect(x).toBeGreaterThanOrEqual(17);
        });
    });

    it('moves through observe, approach, respond, and withdraw without teleporting', () => {
        const machine = createStillwaterCharacterState();
        const spiritIdentity = machine.state.spirit;
        const positions = [];

        for (let frame = 0; frame < 1_400; frame += 1) {
            machine.update(1 / 60);
            if (frame % 20 === 0) positions.push(machine.state.spirit.x);
        }

        expect(machine.state.spirit).toBe(spiritIdentity);
        expect(positions.every((x) => x <= -14)).toBe(true);
        for (let index = 1; index < positions.length; index += 1) {
            expect(Math.abs(positions[index] - positions[index - 1])).toBeLessThan(1.5);
        }
    });

    it('uses authored event cues for attention rather than crossing the board', () => {
        const machine = createStillwaterCharacterState();
        machine.cue('combo10', 1.2);
        expect(machine.state.spirit.name).toBe('respond');
        expect(machine.state.troll.name).toBe('react');

        for (let frame = 0; frame < 240; frame += 1) machine.update(1 / 60);

        expect(machine.state.spirit.x).toBeLessThanOrEqual(-14);
        expect(machine.state.troll.x).toBeGreaterThanOrEqual(17);
        expect(machine.state.spirit.attention).toBeLessThan(1.2);
        expect(machine.state.troll.cue).toBeLessThan(1.2);
    });

    it('is deterministic and retains fixed state identities through a long storm', () => {
        const first = createStillwaterCharacterState();
        const second = createStillwaterCharacterState();
        const firstSpirit = first.state.spirit;
        const firstTroll = first.state.troll;

        for (let frame = 0; frame < 10_000; frame += 1) {
            if (frame % 47 === 0) {
                const cue = frame % 94 === 0 ? 'tetris' : 'lock';
                first.cue(cue, 0.8);
                second.cue(cue, 0.8);
            }
            first.update(1 / 144);
            second.update(1 / 144);
        }

        expect(first.state.spirit).toBe(firstSpirit);
        expect(first.state.troll).toBe(firstTroll);
        expect(first.state.spirit).toEqual(second.state.spirit);
        expect(first.state.troll).toEqual(second.state.troll);
        expect(Object.values(first.state.spirit).every((value) => (
            typeof value !== 'number' || Number.isFinite(value)
        ))).toBe(true);
    });

    it('reduces travel while preserving the same serene state vocabulary', () => {
        const full = createStillwaterCharacterState();
        const reduced = createStillwaterCharacterState();
        full.cue('lineClear');
        reduced.cue('lineClear');

        for (let frame = 0; frame < 60; frame += 1) {
            full.update(1 / 60, false);
            reduced.update(1 / 60, true);
        }

        expect(Math.abs(reduced.state.spirit.x - STILLWATER_SPIRIT_ANCHORS.observe[0]))
            .toBeLessThan(Math.abs(full.state.spirit.x - STILLWATER_SPIRIT_ANCHORS.observe[0]));
        expect(reduced.state.spirit.name).toBe(full.state.spirit.name);
    });

    it('authors distinct deterministic troll poses for the reaction vocabulary', () => {
        const cases = [
            ['lock', STILLWATER_TROLL_GESTURE.LOCK_GLANCE, 'glance'],
            ['lineClear', STILLWATER_TROLL_GESTURE.LINE_TURN, 'turn'],
            ['comboHigh', STILLWATER_TROLL_GESTURE.COMBO_WARY, 'wary'],
            ['combo10', STILLWATER_TROLL_GESTURE.COMBO_DELIGHT, 'delight'],
        ];
        cases.forEach(([cue, gesture, pose]) => {
            const machine = createStillwaterCharacterState();
            machine.cueTroll(cue, 1);
            for (let frame = 0; frame < 24; frame += 1) machine.update(1 / 60);
            expect(machine.state.troll.gesture).toBe(gesture);
            expect(machine.state.troll[pose]).toBeGreaterThan(0);
            expect(machine.state.troll.x).toBeGreaterThanOrEqual(17);
        });
    });

    it('bows then looks up for a perfect clear and protects it from lower cues', () => {
        const machine = createStillwaterCharacterState();
        machine.cueTroll('perfectClear', 1);
        for (let frame = 0; frame < 36; frame += 1) machine.update(1 / 60);
        expect(machine.state.troll.gesture)
            .toBe(STILLWATER_TROLL_GESTURE.PERFECT_BOW_LOOK_UP);
        expect(machine.state.troll.bow).toBeGreaterThan(0);

        machine.cueTroll('lock', 1.5);
        expect(machine.state.troll.gesture)
            .toBe(STILLWATER_TROLL_GESTURE.PERFECT_BOW_LOOK_UP);
        expect(machine.state.troll.name).toBe('react');
        for (let frame = 0; frame < 60; frame += 1) machine.update(1 / 60);
        expect(machine.state.troll.lookUp).toBeGreaterThan(0);
    });

    it('upgrades an active wary combo pose when combo ten delights the troll', () => {
        const machine = createStillwaterCharacterState();
        machine.cueTroll('comboHigh', 0.8);
        machine.update(1 / 60);
        expect(machine.state.troll.gesture).toBe(STILLWATER_TROLL_GESTURE.COMBO_WARY);

        machine.cueTroll('combo10', 1);
        expect(machine.state.troll.gesture).toBe(STILLWATER_TROLL_GESTURE.COMBO_DELIGHT);
        expect(machine.state.troll.name).toBe('react');
    });

    it('scales authored pose travel down under reduced motion', () => {
        const full = createStillwaterCharacterState();
        const reduced = createStillwaterCharacterState();
        full.cueTroll('lineClear', 1);
        reduced.cueTroll('lineClear', 1);
        for (let frame = 0; frame < 24; frame += 1) {
            full.update(1 / 60, false);
            reduced.update(1 / 60, true);
        }
        expect(reduced.state.troll.turn).toBeLessThan(full.state.troll.turn);
        expect(reduced.state.troll.pause).toBeLessThan(full.state.troll.pause);
    });
});
