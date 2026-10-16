/**
 * What Infinity's ascent asks of the shared code: every theme's camera cranes with the view
 * (camera-breath), every BaseTheme clock slows while the player looks and comes back (themeTime),
 * the board holds a flight pose (BoardJuice.setFlight), the right stick looks and a game button
 * goes home without also playing (gamepad-controller), and the music muffles through one filter
 * (SoundManager.setMusicMuffle).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { applyCameraBreath, CAMERA_CRANE, explorationCrane } from '../../src/themes/shared/camera-breath.js';
import { setExplorationSignal } from '../../src/core/exploration-signal.js';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { BoardJuice } from '../../src/rendering/phaser/board-juice.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { SoundManager } from '../../src/audio/sound-manager.js';

vi.mock('@utils/helpers.js', async () => import('../../src/utils/helpers.js'));

afterEach(() => {
    setExplorationSignal(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const looking = (rise, speed = 0, weight = 1) => setExplorationSignal(() => ({
    weight, rise, speed, timeScale: 0.25,
}));

describe('every theme\'s camera cranes with the view', () => {
    function posed() {
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100000);
        camera.position.set(0, 0, 1000);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        return camera;
    }
    const forward = (camera) => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

    it('is nothing while nobody looks, and nothing under reduced motion', () => {
        expect(explorationCrane()).toBe(0);
        looking(1);
        expect(explorationCrane(0)).toBe(0);
        expect(explorationCrane()).toBeCloseTo(CAMERA_CRANE.RISE, 9);
        const camera = posed();
        // At time 0 the clock's breath is zero, so this is the crane alone; scale 0 is stillness.
        expect(applyCameraBreath(camera, 0, { distance: 1000, scale: 0 })).toBe(false);
        expect(camera.position.y).toBe(0);
    });

    it('rises and turns back to its subject with a distance, so the subject holds its place', () => {
        looking(1);
        const camera = posed();
        expect(applyCameraBreath(camera, 0, { distance: 1000 })).toBe(true);
        expect(camera.position.y).toBeGreaterThan(0);
        camera.updateMatrixWorld();
        const toSubject = new THREE.Vector3(0, 0, 0).sub(camera.position).normalize();
        expect(forward(camera).dot(toSubject)).toBeGreaterThan(0.99999);
        // Descending moves it down.
        looking(-1);
        const low = posed();
        applyCameraBreath(low, 0, { distance: 1000 });
        expect(low.position.y).toBeLessThan(0);
    });

    it('looks up as the view rises when it has no subject (the world sinks on screen)', () => {
        looking(1, 0.5);
        const camera = posed();
        applyCameraBreath(camera, 0);
        expect(camera.position.y).toBe(0);
        expect(forward(camera).y).toBeGreaterThan(0);
        expect(explorationCrane()).toBeCloseTo(CAMERA_CRANE.RISE + 0.5 * CAMERA_CRANE.LEAD, 9);
    });
});

describe('every BaseTheme clock holds its breath while the player looks', () => {
    class Theme extends BaseTheme {
        constructor() { super('clock-test'); }

        async createScene() { return undefined; }
    }

    it('runs on the rAF time exactly while nobody looks', () => {
        const theme = new Theme();
        expect(theme.themeTime(1000)).toBe(1000);
        expect(theme.themeTime(1016.5)).toBe(1016.5);
        expect(theme.realFrameDelta).toBeCloseTo(0.0165, 9);
        vi.spyOn(performance, 'now').mockReturnValue(1030);
        // A direct call passes no time: the clock reads performance.now(), never NaN.
        expect(theme.themeTime(undefined)).toBe(1030);
    });

    it('slows to the asked pace, continuously, and comes back when the look ends', () => {
        const theme = new Theme();
        let raw = 0;
        let last = theme.themeTime(raw);
        const steps = [];
        const frame = () => {
            raw += 1000 / 120;
            const t = theme.themeTime(raw);
            steps.push(t - last);
            last = t;
        };
        looking(0.5);
        for (let i = 0; i < 360; i++) frame();
        const slow = steps.at(-1);
        expect(slow).toBeCloseTo((1000 / 120) * 0.25, 2);
        // Never a jump: each step within a hair of the one before, and never backwards.
        for (let i = 1; i < steps.length; i++) {
            expect(steps[i]).toBeGreaterThanOrEqual(0);
            expect(Math.abs(steps[i] - steps[i - 1])).toBeLessThan(0.2);
        }
        expect(theme.realFrameDelta).toBeCloseTo(1 / 120, 9);
        setExplorationSignal(null);
        for (let i = 0; i < 480; i++) frame();
        expect(steps.at(-1)).toBeCloseTo(1000 / 120, 6);
    });
});

describe('the board holds a flight pose', () => {
    it('tips and stretches with the speed, needs no frames while held, and lets go', () => {
        const pending = [];
        vi.stubGlobal('performance', { now: () => 0 });
        vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { pending.push(cb); return pending.length; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const element = { style: {} };
        const juice = new BoardJuice(element);
        juice.setFlight(2, 0.01);
        pending.splice(0).forEach((cb) => cb(16));
        expect(element.style.transform).toBe('perspective(1600px) rotateX(2.000deg) translate(0.00px, 0.00px) '
            + 'rotate(0.000deg) scale(1.0000, 1.0100)');
        // A held pose with the springs at rest asks for no more frames.
        expect(pending).toHaveLength(0);
        juice.setFlight(2, 0.01);
        expect(pending).toHaveLength(0);
        juice.setFlight(0, 0);
        pending.splice(0).forEach((cb) => cb(32));
        expect(element.style.transform).toBe('');
        juice.setFlight(99, 1);
        pending.splice(0).forEach((cb) => cb(48));
        expect(element.style.transform).toContain('rotateX(4.000deg)');
        juice.destroy();
    });
});

describe('the right stick looks around the tower', () => {
    function harness() {
        vi.stubGlobal('requestAnimationFrame', () => 0);
        vi.stubGlobal('cancelAnimationFrame', () => {});
        vi.stubGlobal('document', {
            addEventListener() {},
            removeEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: () => null,
            body: { classList: { contains: () => false, add() {}, remove() {} } },
            activeElement: null,
        });
        const pad = {
            index: 0,
            id: 'pad',
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        };
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const controller = new GamepadController();
        controller.enabled = true;
        controller.gamepads[0] = pad;
        controller.connected[0] = true;
        const actions = {
            move: vi.fn(), rotate: vi.fn(), softDrop: vi.fn(), hardDrop: vi.fn(), togglePause: vi.fn(),
        };
        controller.setGameActions(actions);
        let exploring = false;
        const callbacks = {
            onStick: vi.fn(),
            onGameInput: vi.fn(() => { exploring = false; }),
            isExploring: () => exploring,
        };
        controller.enableExplorationMode(callbacks);
        const poll = ({ buttons = [], axes = [0, 0, 0, 0] } = {}) => {
            pad.buttons.forEach((button, index) => {
                button.pressed = buttons.includes(index);
                button.value = button.pressed ? 1 : 0;
            });
            pad.axes = axes;
            controller.poll();
        };
        return {
            controller, actions, callbacks, poll, setExploring: (on) => { exploring = on; },
        };
    }

    it('streams the stick and R3 to the ascent every poll', () => {
        const { callbacks, poll } = harness();
        poll({ axes: [0, 0, 0, -0.8] });
        expect(callbacks.onStick).toHaveBeenLastCalledWith(-0.8, { held: false, index: 0 });
        poll({ buttons: [11], axes: [0, 0, 0, 0.5] });
        expect(callbacks.onStick).toHaveBeenLastCalledWith(0.5, { held: true, index: 0 });
    });

    it('sends the view home on a game button, and that press does not play until released', () => {
        vi.useFakeTimers();
        const {
            actions, callbacks, poll, setExploring,
        } = harness();
        setExploring(true);
        poll({ buttons: [1] }); // B: hard drop in play
        expect(callbacks.onGameInput).toHaveBeenCalledOnce();
        poll({ buttons: [1] });
        poll({ buttons: [1] });
        expect(actions.hardDrop).not.toHaveBeenCalled();
        poll();
        poll({ buttons: [1] });
        expect(callbacks.onGameInput).toHaveBeenCalledOnce();
        expect(actions.hardDrop).toHaveBeenCalled();
    });

    it('lets go of every latch when the mode stops exploring', () => {
        const { controller } = harness();
        controller.previousStates[0].explorationLatch = true;
        controller.disableExplorationMode();
        expect(controller.previousStates[0].explorationLatch).toBe(false);
        expect(controller.explorationCallbacks).toBeNull();
    });
});

describe('the music muffles through one filter', () => {
    function fakeContext() {
        const param = () => ({
            value: 0,
            setValueAtTime: vi.fn(),
            setTargetAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
        });
        const destination = { name: 'destination' };
        const made = [];
        return {
            ctx: {
                sampleRate: 48000,
                currentTime: 2,
                state: 'running',
                destination,
                createBiquadFilter: () => {
                    const f = {
                        type: '', frequency: param(), Q: param(), connect: vi.fn(), disconnect: vi.fn(),
                    };
                    made.push(f);
                    return f;
                },
            },
            destination,
            made,
        };
    }

    beforeEach(() => {
        vi.stubGlobal('window', { location: { search: '' } });
        vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    });

    it('inserts the filter after the music\'s gain once and eases its cutoff', () => {
        const sm = new SoundManager();
        const { ctx, destination, made } = fakeContext();
        sm.audioContext = ctx;
        sm.musicGainNode = { connect: vi.fn(), disconnect: vi.fn() };
        sm.musicGainWired = true;
        expect(sm.setMusicMuffle(0)).toBe(true);
        expect(made).toHaveLength(0);
        expect(sm.setMusicMuffle(1, 0.6)).toBe(true);
        expect(made).toHaveLength(1);
        const [filter] = made;
        expect(filter.type).toBe('lowpass');
        expect(sm.musicGainNode.disconnect).toHaveBeenCalledWith(destination);
        expect(sm.musicGainNode.connect).toHaveBeenCalledWith(filter);
        expect(filter.connect).toHaveBeenCalledWith(destination);
        const [hz, at, tau] = filter.frequency.setTargetAtTime.mock.calls.at(-1);
        expect(hz).toBeCloseTo(700, 6);
        expect(at).toBe(2);
        expect(tau).toBeCloseTo(0.2, 9);
        sm.setMusicMuffle(0, 0.9);
        expect(filter.frequency.setTargetAtTime.mock.calls.at(-1)[0]).toBeCloseTo(20000, 6);
        expect(made).toHaveLength(1);
        expect(sm.musicMuffleNode).toBe(filter);
    });

    it('does nothing without music in Web Audio', () => {
        const sm = new SoundManager();
        expect(sm.setMusicMuffle(1)).toBe(false);
        sm.audioContext = fakeContext().ctx;
        sm.musicGainNode = { connect: vi.fn(), disconnect: vi.fn() };
        sm.getAnalyzer = vi.fn(() => null);
        expect(sm.setMusicMuffle(1)).toBe(false);
        expect(sm.getAnalyzer).toHaveBeenCalledWith(true);
    });
});
