import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { PaintedAgesWorld, PAINTED_AGES_PARTS } from '../../src/themes/painted-ages/painted-ages-world.js';
import {
    PIECE_COLORS, RECORD_ROWS, PALETTE, hexToLinear,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { fallbackLayout, outsideKeepOut } from '../../src/themes/painted-ages/painted-ages-composition.js';

const worlds = [];
function makeWorld(width = 1920, height = 1080) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const world = new PaintedAgesWorld({ scene, quality: 'Minimal', capture: true }).build();
    world.setViewport(width, height, width / height);
    world.setLayout(fallbackLayout(width, height), width / height);
    world.bindCamera(camera);
    worlds.push(world);
    frame(world, 40);
    return world;
}

function frame(world, time) {
    const sim = {
        time, delta: 1 / 60, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(world._camera, sim);
    world.update(sim, world._camera);
}

const codes = (values) => values.flatMap((value) => new Array(10).fill(value));
const quantizedColour = (code) => hexToLinear(PIECE_COLORS[code]).map((value) => Math.round(value * 255) / 255);

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
});

describe('Painted Ages mineral world', () => {
    it('keeps every pool mounted across a burst of all gameplay events', () => {
        const world = makeWorld();
        expect(Object.keys(world.parts)).toEqual(PAINTED_AGES_PARTS);
        const children = [...world.root.children];
        const geometry = children.map((mesh) => mesh.geometry);
        const materials = children.map((mesh) => mesh.material);
        for (let i = 0; i < 20; i++) {
            world.onLock({
                u: i / 20, hardDrop: i % 2 === 0, distance: 18, color: PIECE_COLORS[i % 7],
            });
            world.onClear({
                lines: 4, rows: [16, 17, 18, 19], rowCodes: codes([0, 1, 2, 3]), tspin: true,
            });
            world.onCombo(7);
            world.onB2B(4);
            world.onClear({ perfect: true });
            frame(world, 40 + i * 0.5);
        }
        expect(world.root.children).toEqual(children);
        expect(world.root.children.map((mesh) => mesh.geometry)).toEqual(geometry);
        expect(world.root.children.map((mesh) => mesh.material)).toEqual(materials);
        expect(world.getState().recordRows).toBeGreaterThan(0);
        world.dispose();
        world.dispose();
        expect(world.scene.children).toHaveLength(0);
    }, 20000); // Node performs the production worker's cold D8 bake synchronously.

    it('copies each clear row before the director reuses its payload and deposits them in order', () => {
        const world = makeWorld();
        const rowCodes = codes([0, 7, 6]);
        world.onClear({ lines: 3, rows: [17, 18, 19], rowCodes });
        rowCodes.fill(4);
        expect(world.getState().pendingDeposits).toBe(3);
        frame(world, 40);
        expect(world.getState().recordRows).toBe(1);
        expect(world.record.read(0, 0)).toEqual(quantizedColour(0));
        frame(world, 41);
        expect(world.getState().recordRows).toBe(3);
        expect(world.getState().pendingDeposits).toBe(0);
        expect(world.record.read(0, 0)).toEqual(quantizedColour(6));
        expect(world.record.read(1, 0)).toEqual(quantizedColour(7));
        expect(world.record.read(2, 0)).toEqual(quantizedColour(0));
    });

    it('keeps overlapping clears in scheduled order when newer rows reuse low queue slots', () => {
        const world = makeWorld();
        world.onClear({ lines: 4, rowCodes: codes([0, 1, 2, 3]) });
        frame(world, 40);
        frame(world, 40.18);
        world.onClear({ lines: 2, rowCodes: codes([4, 5]) });
        for (const time of [40.23, 40.28, 40.33, 40.5]) frame(world, time);
        const times = world.record.journal.map((event) => event.time);
        expect(times).toHaveLength(6);
        expect(times).toEqual([...times].sort((a, b) => a - b));
        [0, 1, 4, 2, 5, 3].forEach((code, index) => {
            expect(world.record.read(5 - index, 0)).toEqual(quantizedColour(code));
        });
        expect(world.getState()).toMatchObject({ recordRows: 6, pendingDeposits: 0 });
        const bytes = world.record.data.slice();
        world.record.seek(40.5);
        expect(world.record.data).toEqual(bytes);
    });

    it('does not mistake cascade depth for a true combo or start rain on a first clear', () => {
        const world = makeWorld();
        world.onClear({
            lines: 1, combo: 1, cascade: 7, rowCodes: codes([0]),
        });
        frame(world, 41);
        expect(world.getState()).toMatchObject({ combo: 1, wetZones: 0, counts: { chainSteps: 0 } });
        world.onClear({
            lines: 1, combo: 5, cascade: 1, rowCodes: codes([1]),
        });
        frame(world, 42);
        expect(world.getState()).toMatchObject({ combo: 5, wetZones: 4 });
    });

    it('reserves the bow for the release of a sufficiently long true chain', () => {
        const world = makeWorld();
        world.onCombo(4);
        frame(world, 41);
        world.onCombo(0);
        frame(world, 44);
        expect(world.getState().bow).toBe(0);
        world.onCombo(7);
        frame(world, 45);
        expect(world.getState().bow).toBe(0);
        world.onCombo(0);
        frame(world, 48);
        expect(world.getState().bow).toBeGreaterThan(0.9);
        frame(world, 64);
        expect(world.getState().bow).toBe(0);
    });

    it.each([4, 7])('retains the peak-%i chain’s wetness when a smaller player hint arrives before release', (peak) => {
        const world = makeWorld();
        world.onCombo(peak);
        world.onCombo(1);
        world.onCombo(0);
        frame(world, 42.5);
        expect(world.getState().wetGlobal).toBeGreaterThan(peak === 7 ? 0.5 : 0);
        if (peak === 4) expect(world.getState().bow).toBe(0);
        else expect(world.getState().bow).toBeGreaterThan(0.9);
        frame(world, 131);
        expect(world.getState().wetGlobal).toBe(0);
    });

    it('keeps recent synthetic flood wetness even when no physical lock has been recorded', () => {
        const world = makeWorld();
        frame(world, 140);
        world.onClear({ lines: 4, rowCodes: codes([0, 2, 4, 6]) });
        frame(world, 142.5);
        expect(world.getState().wetGlobal).toBeGreaterThan(0.5);
        frame(world, 231);
        expect(world.getState().wetGlobal).toBe(0);
    });

    it('keeps reduced-motion camera framing still while preserving clear deposits', () => {
        const world = makeWorld();
        world.setReducedMotion(true);
        world.updateCamera(world._camera, { time: 50, pointerX: -1, pointerY: -1 });
        const pose = world._camera.matrixWorld.toArray();
        world.updateCamera(world._camera, { time: 80, pointerX: 1, pointerY: 1 });
        expect(world._camera.matrixWorld.toArray()).toEqual(pose);
        world.onClear({ lines: 2, rowCodes: codes([3, 5]) });
        frame(world, 82);
        expect(world.getState()).toMatchObject({ reducedMotion: true, recordRows: 2, pendingDeposits: 0 });
    });

    it('crossfades between static tilt angles over 0.3 seconds for reduced motion', () => {
        const world = makeWorld();
        world.setReducedMotion(true);
        world.levelUp(3);
        expect(world.getState().tilt).toBe(12);
        frame(world, 40);
        expect(world.getState().tilt).toBe(12);
        expect(world.u.tilt.value).toBe(12);
        expect(world.u.tiltPrevious.value).toBe(0);
        expect(world.u.tiltBlend.value).toBe(0);
        frame(world, 40.15);
        expect(world.getState().tilt).toBe(12);
        expect(world.u.tiltBlend.value).toBeCloseTo(0.5);
        frame(world, 40.3);
        expect(world.u.tiltBlend.value).toBeCloseTo(1);
        world.levelUp(4);
        frame(world, 40.3);
        expect(world.u.tiltPrevious.value).toBe(12);
        expect(world.u.tilt.value).toBe(18);
        expect(world.u.tiltBlend.value).toBe(0);
        frame(world, 40.6);
        expect(world.u.tiltBlend.value).toBeCloseTo(1);
        world.levelUp(5);
        world.levelUp(6);
        frame(world, 40.6);
        expect(world.u.tiltPrevious.value).toBe(24);
        expect(world.u.tilt.value).toBe(30);
        expect(world.u.tiltBlend.value).toBe(0);
    });

    it('replays the visible mineral ring deterministically after wrapping', () => {
        const world = makeWorld();
        for (let i = 0; i < RECORD_ROWS + 8; i++) {
            world.record.deposit(codes([i % 7]), { time: i });
        }
        world.seek(RECORD_ROWS + 7);
        const final = world.record.data.slice();
        const { head } = world.record;
        world.seek(100);
        expect(world.record.total).toBe(101);
        world.seek(RECORD_ROWS + 7);
        expect(world.record.total).toBe(RECORD_ROWS + 8);
        expect(world.record.head).toBe(head);
        expect(world.record.data).toEqual(final);
        world.seek(RECORD_ROWS + 7);
        expect(world.record.data).toEqual(final);
    });

    it('preserves queued deposition across a renderer rebuild, including its row colours', () => {
        const original = makeWorld();
        original.onClear({ lines: 3, rowCodes: codes([0, 2, 6]) });
        frame(original, 40.05);
        expect(original.getState()).toMatchObject({ recordRows: 1, pendingDeposits: 2 });
        const snapshot = original.exportSessionState();
        const rebuilt = makeWorld();
        rebuilt.importSessionState(snapshot);
        expect(rebuilt.getState().pendingDeposits).toBe(2);
        frame(original, 41);
        frame(rebuilt, 41);
        expect(rebuilt.record.data).toEqual(original.record.data);
        expect(rebuilt.getState().recordRows).toBe(3);
    });

    it('restores a running chain and fold without counting new events or restarting their eases', () => {
        const original = makeWorld();
        original.onCombo(5);
        original.onB2B(3);
        frame(original, 40.6);
        const before = original.getState();
        const rebuilt = makeWorld();
        rebuilt.importSessionState(original.exportSessionState());
        frame(rebuilt, 40.6);
        const after = rebuilt.getState();
        expect(after.counts).toEqual(before.counts);
        expect(after.wetZones).toBeCloseTo(before.wetZones, 8);
        expect(after.fold).toBeCloseTo(before.fold, 8);
    });

    it('restores flood, sky strata, bow, wetness and sunset at their original event ages', () => {
        const original = makeWorld();
        original.onClear({ lines: 4, rowCodes: codes([0, 2, 4, 6]) });
        original.onClear({ perfect: true });
        original.onCombo(7);
        frame(original, 41);
        original.onCombo(0);
        original.levelUp(5);
        original.onGameOver();
        frame(original, 42);
        const rebuilt = makeWorld();
        rebuilt.importSessionState(original.exportSessionState());
        for (const time of [42, 44, 47, 58]) {
            frame(original, time);
            frame(rebuilt, time);
            const { bakeMs: firstBake, ...before } = original.getState();
            const { bakeMs: secondBake, ...after } = rebuilt.getState();
            expect(after).toEqual(before);
            for (const key of ['flood', 'perfect', 'perfectAge', 'depositAge', 'datum', 'tuff']) {
                expect(rebuilt.u[key].value, key).toBeCloseTo(original.u[key].value, 8);
            }
        }
        expect(rebuilt.parts.water.data).toEqual(original.parts.water.data);
    });

    it('seals a finished game once and preserves its rock and tilt when morning returns for the next run', () => {
        const world = makeWorld();
        world.onClear({ lines: 3, rowCodes: codes([0, 1, 2]) });
        frame(world, 41);
        world.levelUp(5, { silent: true });
        world.onGameOver();
        world.onGameOver();
        world.resetSession();
        frame(world, 48);
        expect(world.getState()).toMatchObject({
            recordRows: 4, lowLight: 1, counts: { gameOvers: 1, lines: 3 },
        });
        const sealed = world.record.data.slice();
        const cream = hexToLinear(PALETTE.cream).map((value) => Math.round(value * 255) / 255);
        expect(world.record.read(0, 0)).toEqual(cream);
        world.onSessionStart();
        frame(world, 50);
        expect(world.getState().lowLight).toBeCloseTo(0.5);
        frame(world, 52);
        expect(world.getState()).toMatchObject({
            recordRows: 4, level: 5, tilt: 24, lowLight: 0,
        });
        expect(world.record.data).toEqual(sealed);
        world.onClear({ lines: 1, rowCodes: codes([6]) });
        frame(world, 53);
        expect(world.getState().recordRows).toBe(5);
        expect(world.record.read(0, 0)).toEqual(quantizedColour(6));
        expect(world.record.read(1, 0)).toEqual(cream);
    });

    it('advances a formation every fifteen played lines without counting tuff markers as clears', () => {
        const world = makeWorld();
        for (let line = 0; line < 7; line++) {
            world.onClear({ lines: 1, rowCodes: codes([line % 7]) });
            frame(world, 41 + line);
        }
        world.onGameOver();
        world.onSessionStart();
        for (let line = 7; line < 14; line++) {
            world.onClear({ lines: 1, rowCodes: codes([line % 7]) });
            frame(world, 41 + line);
        }
        expect(world.getState()).toMatchObject({ recordRows: 15, level: 1, counts: { lines: 14 } });
        world.onClear({ lines: 1, rowCodes: codes([0]) });
        frame(world, 55);
        expect(world.getState()).toMatchObject({ recordRows: 17, level: 2, counts: { lines: 15, levelUps: 1 } });
        world.levelUp(2);
        expect(world.getState().recordRows).toBe(17);
    });

    it('dates an automatic formation marker at its deposited row when a frame drains several due rows', () => {
        const world = makeWorld();
        for (let line = 0; line < 14; line++) {
            world.onClear({ lines: 1, rowCodes: codes([line % 7]) });
            frame(world, 41 + line);
        }
        world.onClear({ lines: 4, rowCodes: codes([0, 2, 4, 6]) });
        frame(world, 55);
        const times = world.record.journal.map((event) => event.time);
        expect(times).toEqual([...times].sort((a, b) => a - b));
        expect(world.record.journal[15]).toMatchObject({ time: 54, tuff: true });
        expect(world.getState()).toMatchObject({ recordRows: 19, level: 2, counts: { lines: 18 } });
        world.record.seek(54.1);
        expect(world.record.total).toBe(16);
        expect(world.record.journal[15].tuff).toBe(true);
    });

    it('settles already-cleared rows before sealing a run that ends during staggered deposition', () => {
        const world = makeWorld();
        world.onClear({ lines: 3, rowCodes: codes([0, 2, 6]) });
        frame(world, 40.05);
        expect(world.getState()).toMatchObject({ recordRows: 1, pendingDeposits: 2 });
        world.onGameOver();
        world.resetSession();
        expect(world.getState()).toMatchObject({ recordRows: 4, pendingDeposits: 0, counts: { lines: 3 } });
        expect(world.record.read(1, 0)).toEqual(quantizedColour(6));
        expect(world.record.read(2, 0)).toEqual(quantizedColour(2));
        expect(world.record.read(3, 0)).toEqual(quantizedColour(0));
        expect(world.record.journal.every((event) => event.time <= 40.05)).toBe(true);
        const sealed = world.record.data.slice();
        world.record.seek(40.05);
        expect(world.record.data).toEqual(sealed);
    });

    it('preserves the matching player’s last lock column for a T-spin after rebuilding', () => {
        const original = makeWorld();
        original.onLock({ u: 0.1, player: 2 });
        const rebuilt = makeWorld();
        rebuilt.importSessionState(original.exportSessionState());
        const clear = {
            lines: 2, rowCodes: codes([0, 1]), tspin: true, player: 2,
        };
        original.onClear(clear);
        rebuilt.onClear(clear);
        expect(rebuilt.parts.hoodoo.data).toEqual(original.parts.hoodoo.data);
    });

    it('settles deposited-bed movement without cancelling the advancing record head', () => {
        const world = makeWorld();
        const head = world.getState().recordHead;
        world.onClear({ lines: 3, rowCodes: codes([0, 1, 2]) });
        frame(world, 40.05);
        expect(world.u.datum.value).toBeGreaterThan(0);
        frame(world, 42);
        expect(world.u.datum.value).toBe(0);
        expect(world.getState().recordHead).toBe((head + 3) % RECORD_ROWS);
        expect(world.record.read(0, 0)).toEqual(quantizedColour(2));
    });

    it('continues accumulated formation tilt after the twelfth level', () => {
        const world = makeWorld();
        world.levelUp(12, { silent: true });
        frame(world, 41);
        const { tilt } = world.getState();
        world.levelUp(13);
        frame(world, 44);
        expect(world.getState().tilt).toBeGreaterThan(tilt);
        expect(world.getState().tilt - tilt).toBeCloseTo(6);
    });

    it('routes phone columns to distinct visible chutes below the card', () => {
        const world = makeWorld(390, 844);
        const below = Math.max(...world.layout.cards.map((card) => card.y1));
        const point = new THREE.Vector3();
        const heads = [0.1, 0.5, 0.9].map((u) => {
            const chute = world.chooseChute({ u, rows: [10] });
            point.fromArray(chute.points).project(world._camera);
            const head = { x: point.x * 0.5 + 0.5, y: 0.5 - point.y * 0.5 };
            expect(head.y).toBeGreaterThan(below + 0.015);
            expect(head.y).toBeLessThan(1);
            return head.x;
        });
        expect(heads[1]).toBeGreaterThan(heads[0] + 0.1);
        expect(heads[2]).toBeGreaterThan(heads[1] + 0.1);
    });

    it.each([[1920, 1080], [390, 844], [2560, 1080]])(
        'keeps selected downhill chute centre-lines clear of the live card and HUD at %i×%i',
        (width, height) => {
            const world = makeWorld(width, height);
            const point = new THREE.Vector3();
            for (const u of [0.1, 0.5, 0.9]) {
                const chute = world.chooseChute({ u, rows: [10] });
                expect(chute).not.toBeNull();
                for (let i = 0; i < chute.points.length; i += 3) {
                    point.fromArray(chute.points, i).project(world._camera);
                    expect(outsideKeepOut(world.layout, {
                        x: point.x * 0.5 + 0.5, y: 0.5 - point.y * 0.5,
                    }, 0.015), `chute ${chute.id}, point ${i / 3}`).toBe(true);
                }
            }
        },
    );
});
