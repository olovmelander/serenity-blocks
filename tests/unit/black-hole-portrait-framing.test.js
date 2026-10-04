import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import BlackHoleTheme from '../../src/themes/black-hole/black-hole-theme.js';
import { ThemeCameraRig } from '../../src/themes/shared/camera-rig.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function createTheme(aspect, seed = 1337, isWebGPU = false) {
    vi.stubGlobal('window', {
        location: { search: `?blackHoleSeed=${seed}` },
        settings: {}, matchMedia: () => ({ matches: false }),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const theme = new BlackHoleTheme();
    theme.isWebGPU = isWebGPU;
    theme.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100000);
    theme.camera.position.copy(theme.cameraBasePosition);
    theme.camera.lookAt(0, 0, 0);
    theme.cameraRig = new ThemeCameraRig(theme.camera, {
        focus: { x: 0, y: 0, z: 0 }, breathe: false, pointer: false,
    });
    return theme;
}

function step(theme, time) {
    theme.time = time;
    const drift = theme.computeDriftPosition(time);
    theme.driftX = drift.x;
    theme.driftY = drift.y;
    theme.driftZ = drift.z;
    theme.updateNaturalCamera(1 / 60);
    theme.camera.updateMatrixWorld();
}

function ringEdges(theme) {
    const center = new THREE.Vector3(theme.driftX, theme.driftY, theme.driftZ);
    const right = new THREE.Vector3().setFromMatrixColumn(theme.camera.matrixWorld, 0).multiplyScalar(135);
    return [-1, 1].map((side) => center.clone().addScaledVector(right, side).project(theme.camera).x);
}

describe('Black Hole portrait orbit framing', () => {
    it.each([
        [390 / 844, 1337, false],
        [320 / 900, 1337, true],
        [390 / 844, 1, true],
        [320 / 900, 42, false],
    ])('keeps the photon-ring extent visible for a full minute at aspect%s seed%s native%s', (aspect, seed, isWebGPU) => {
        const theme = createTheme(aspect, seed, isWebGPU);
        let maxExtent = 0;
        for (let frame = 0; frame < 3600; frame += 1) {
            step(theme, frame / 60);
            maxExtent = Math.max(maxExtent, ...ringEdges(theme).map(Math.abs));
        }
        expect(maxExtent).toBeLessThan(1);
    });

    it('preserves the authored landscape orbit poses through the original 30s and40s excursion', () => {
        const theme = createTheme(16 / 9);
        const poses = {
            1800: {
                position: [734.5813820553105, 13.859832292685985, -460.2080515570965],
                look: [129.71148932121747, -117.68624846291684, 233.50152745429514],
            },
            2400: {
                position: [274.3554998605288, 2.6442932771759384, -816.1545132113223],
                look: [255.02356682368557, -135.25906033351868, 99.71030543765434],
            },
        };
        for (let frame = 0; frame <= 2400; frame += 1) {
            step(theme, frame / 60);
            if (poses[frame]) {
                theme.camera.position.toArray().forEach((value, index) => expect(value).toBeCloseTo(poses[frame].position[index], 9));
                theme.cameraLookTargetSmoothed.toArray().forEach((value, index) => expect(value).toBeCloseTo(poses[frame].look[index], 9));
            }
        }
    });

    it('reframes the smoothed landscape target on the first portrait frame after rotation', () => {
        const theme = createTheme(16 / 9);
        for (let frame = 0; frame <= 2400; frame += 1) step(theme, frame / 60);
        theme.camera.aspect = 390 / 844;
        theme.camera.updateProjectionMatrix();
        step(theme, 40 + 1 / 60);
        expect(ringEdges(theme).every((edge) => Math.abs(edge) < 1)).toBe(true);
    });

    it('preserves a gameplay clear impulse after portrait framing', () => {
        const theme = createTheme(390 / 844);
        for (let frame = 0; frame <= 1800; frame += 1) step(theme, frame / 60);
        theme.onLineClear({ lineCount: 4, comboCount: 8 });
        const before = theme.cameraRig.currentShakeAmount();
        step(theme, 30 + 1 / 60);
        expect(theme.cameraRig.currentShakeAmount()).toBeGreaterThan(0);
        expect(theme.cameraRig.currentShakeAmount()).toBeLessThan(before);
        expect(theme.camera.position.distanceTo(theme.cameraSmoothedPosition)).toBeGreaterThan(0);
    });
});
