import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { OdysseyCameraController } from '../OdysseyCameraController.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathCurve,
} from '../path-utils.js';
import { createEarthCoreEnvironment, updateEarthCoreEnvironment } from './earth-core.js';

function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        })),
    });
}

function makeCameraHarness() {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        chapterPositions: getActiveOdysseyChapterPositions(),
        startPosition: 0,
    });
    return { camera, controller };
}

function captureProgress(frameNumber) {
    return (frameNumber - 1) * 0.005;
}

function projectTarget(group, target, progress) {
    const { camera, controller } = makeCameraHarness();
    controller.currentPosition = progress;
    controller.updateChapterFraming(1);
    const frame = controller.computeFollowFrame(progress);
    camera.position.copy(frame.camPos);
    camera.up.copy(frame.normal);
    camera.lookAt(frame.lookTarget);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(target);
    const center = new THREE.Vector3();
    if (box.isEmpty()) {
        target.getWorldPosition(center);
    } else {
        box.getCenter(center);
    }
    return center.project(camera);
}

function expectVisible(group, target, progress, label) {
    updateEarthCoreEnvironment(group, 0.016, progress * 20, null, progress);
    const ndc = projectTarget(group, target, progress);
    expect(Number.isFinite(ndc.x), `${label} projected x`).toBe(true);
    expect(Number.isFinite(ndc.y), `${label} projected y`).toBe(true);
    expect(Number.isFinite(ndc.z), `${label} projected z`).toBe(true);
    expect(Math.abs(ndc.x), `${label} screen x`).toBeLessThanOrEqual(1.2);
    expect(Math.abs(ndc.y), `${label} screen y`).toBeLessThanOrEqual(1.2);
    expect(ndc.z, `${label} depth near`).toBeGreaterThanOrEqual(-1);
    expect(ndc.z, `${label} depth far`).toBeLessThanOrEqual(1.02);
}

describe('Earth Core chapter environment (creative plan ch1)', () => {
    it('mounts the First Heart, colonnade walls, selenite chapel, and molten basins', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 240 });
        const chapterStartY = getOdysseyPathCurve().getPointAt(getActiveOdysseyChapterPositions()[0]).y;

        expect(group.userData.firstHeart?.name).toBe('first-heart');
        expect(group.userData.colonnade?.name).toBe('basalt-colonnade-walls');
        expect(group.userData.seleniteChamber?.name).toBe('selenite-geode-chamber');
        expect(group.userData.visibilityTargets?.firstHeart?.name).toBe('first-heart');
        expect(group.userData.visibilityTargets?.lavaFall?.name).toBe('lava-fall-hero');
        expect(group.userData.visibilityTargets?.seleniteChapel?.name).toBe('selenite-geode-chamber');
        // 2 global under-glows + 3 basin coronas (legacy-floor revival).
        expect(group.userData.lavaFloor?.userData.glows?.length).toBe(5);
        expect(group.userData.elements.rockClusters.length).toBeGreaterThan(0);
        expect(group.position.y).toBeCloseTo(chapterStartY, 3);
    });

    it('exposes the ecotone uOpacity bridge on every opacityNode material', () => {
        // Regression guard for the seam-bleed class: any TSL material whose alpha
        // flows through opacityNode is invisible to material.opacity, so it MUST
        // expose material.uniforms.uOpacity for _collectOpacityTargets to reach it.
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 240 });

        const missing = [];
        group.traverse((child) => {
            if (!child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (material?.opacityNode && !material.uniforms?.uOpacity) {
                    missing.push(child.name || material.type);
                }
            });
        });
        expect(missing).toEqual([]);
    });

    it('drives the seam choreography from camera progress', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 240 });
        const { uniforms } = group.userData;
        const tStart = group.userData.chapterTStart;
        const tEnd = group.userData.chapterTEnd;

        // Mid-chapter: no seam — geodes rest at their seats, the Heart breathes.
        updateEarthCoreEnvironment(group, 0.016, 1.0, null, tStart + (tEnd - tStart) * 0.5);
        expect(uniforms.uSeam.value).toBe(0);
        const cluster = group.userData.elements.rockClusters[0];
        const seatY = cluster.userData.baseY;
        expect(Number.isFinite(seatY)).toBe(true);

        // Boundary: full seam — every boulder sinks below its seat (no magma sphere
        // survives past the frame-18 equivalent) and the Heart gutters down.
        updateEarthCoreEnvironment(group, 0.016, 2.0, null, captureProgress(18));
        expect(uniforms.uSeam.value).toBeGreaterThan(0.95);
        expect(cluster.position.y).toBeLessThan(seatY);

        updateEarthCoreEnvironment(group, 0.016, 2.0, null, tEnd);
        expect(uniforms.uSeam.value).toBeCloseTo(1, 5);
        expect(cluster.position.y).toBeLessThan(seatY);
        expect(group.userData.firstHeart.scale.x)
            .toBeLessThan(group.userData.firstHeartBaseScale);
    });

    it('projects hero beats into the fixed spline camera corridor', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 660 });
        const {
            firstHeart,
            lavaFall,
            seleniteChapel,
            geodeClusters,
        } = group.userData.visibilityTargets;

        expect(firstHeart).toBeTruthy();
        expect(lavaFall).toBeTruthy();
        expect(seleniteChapel).toBeTruthy();
        expect(geodeClusters.length).toBeGreaterThanOrEqual(6);

        [1, 8, 16].forEach((frame) => {
            expectVisible(group, firstHeart, captureProgress(frame), `First Heart frame ${frame}`);
        });

        [8, 9, 10, 11].forEach((frame) => {
            expectVisible(group, seleniteChapel, captureProgress(frame), `Selenite chapel frame ${frame}`);
        });

        [12, 14, 16].forEach((frame) => {
            expectVisible(group, lavaFall, captureProgress(frame), `Lava-fall frame ${frame}`);
        });
    });

    it('sinks staged seam boulders before the frame-18 capture equivalent', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 660 });
        const seamBoulders = group.userData.visibilityTargets.seamBoulders;
        expect(seamBoulders.length).toBeGreaterThan(0);

        updateEarthCoreEnvironment(group, 0.016, 1.0, null, captureProgress(12));
        const seatedY = seamBoulders.map((boulder) => boulder.position.y);

        updateEarthCoreEnvironment(group, 0.016, 2.0, null, captureProgress(18));
        expect(group.userData.uniforms.uSeam.value).toBeGreaterThan(0.95);
        seamBoulders.forEach((boulder, i) => {
            expect(boulder.position.y).toBeLessThan(seatedY[i] - 1);
        });
    });
});
