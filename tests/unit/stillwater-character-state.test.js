import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import {
    createStillwaterCharacterState,
    STILLWATER_SPIRIT_ANCHORS,
    STILLWATER_TROLL_GESTURE,
    STILLWATER_TROLL_PATH_X,
} from '../../src/themes/stillwater/sim/stillwater-character-state.js';
import { resolveStillwaterLayout } from '../../src/themes/stillwater/composition/stillwater-layout.js';

/**
 * "Clear of the board" is a SCREEN-space property, so it has to be measured in
 * screen space. This used to be a bare `x <= -14` world-space threshold, which
 * silently assumed the anchors would never change depth: move a character 12
 * units toward the camera and the same world x is a completely different place
 * in frame — further from the board, as it happens — yet the constant reads as
 * a violation. Project through the authored camera and ask the real question.
 */
// Clearance is measured from a character's ORIGIN, so the gate has to cover the
// widest silhouette that origin carries. The spirit's robe reaches about 2.5% of
// frame width either side at her authored scale; 6% leaves the robe edge clear
// with room for the anchor jitter and the sway.
const BOARD_MARGIN = 0.06;
const LAYOUT = resolveStillwaterLayout({ aspect: 16 / 9 });
const [BOARD_RECT] = LAYOUT.boardSafeRegions;

function makeSoloCamera() {
    const camera = new THREE.PerspectiveCamera(
        LAYOUT.camera.fov,
        16 / 9,
        LAYOUT.camera.near,
        LAYOUT.camera.far,
    );
    camera.position.set(...LAYOUT.camera.position);
    camera.lookAt(...LAYOUT.camera.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return camera;
}

const SOLO_CAMERA = makeSoloCamera();

/** Fraction of frame width between a world point and the nearest board edge. */
function boardClearance(x, y, z) {
    const projected = new THREE.Vector3(x, y, z).project(SOLO_CAMERA);
    const screenX = projected.x * 0.5 + 0.5;
    // A point is outside on exactly one side, so the clearance is whichever of
    // the two edge distances is positive; `min` would report every point as an
    // intrusion.
    return Math.max(
        BOARD_RECT.x - screenX,
        screenX - (BOARD_RECT.x + BOARD_RECT.width),
    );
}

describe('Stillwater Wave 5 character state', () => {
    it('keeps every authored spirit and troll anchor outside the board aperture', () => {
        Object.entries(STILLWATER_SPIRIT_ANCHORS).forEach(([beat, [x, y, z]]) => {
            expect(boardClearance(x, y, z), `spirit ${beat}`).toBeGreaterThan(BOARD_MARGIN);
        });
        Object.entries(STILLWATER_TROLL_PATH_X).forEach(([beat, [x, z]]) => {
            expect(boardClearance(x, 1.6, z), `troll ${beat}`).toBeGreaterThan(BOARD_MARGIN);
        });
    });

    it('moves through observe, approach, respond, and withdraw without teleporting', () => {
        const machine = createStillwaterCharacterState();
        const spiritIdentity = machine.state.spirit;
        const positions = [];

        for (let frame = 0; frame < 1_400; frame += 1) {
            machine.update(1 / 60);
            if (frame % 20 === 0) {
                const { x, y, z } = machine.state.spirit;
                positions.push({ x, y, z });
            }
        }

        expect(machine.state.spirit).toBe(spiritIdentity);
        expect(positions.every(({ x, y, z }) => boardClearance(x, y, z) > BOARD_MARGIN)).toBe(true);
        for (let index = 1; index < positions.length; index += 1) {
            expect(Math.abs(positions[index].x - positions[index - 1].x)).toBeLessThan(1.5);
        }
    });

    it('uses authored event cues for attention rather than crossing the board', () => {
        const machine = createStillwaterCharacterState();
        machine.cue('combo10', 1.2);
        expect(machine.state.spirit.name).toBe('respond');
        expect(machine.state.troll.name).toBe('react');

        for (let frame = 0; frame < 240; frame += 1) machine.update(1 / 60);

        const { spirit, troll } = machine.state;
        expect(boardClearance(spirit.x, spirit.y, spirit.z)).toBeGreaterThan(BOARD_MARGIN);
        expect(boardClearance(troll.x, 1.6, troll.z)).toBeGreaterThan(BOARD_MARGIN);
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
