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

// ⚠️ THE 0.005 STEP IS A PATH FRACTION, and Wave 1A's ascent changed what it buys. `p` is
// arc-normalised over the whole curve, so lengthening the journey 1767.65 -> 2393.89 made
// every one of these frames cover 35% more world. Frame 16 used to sit 81% into chapter 1
// (which ended at 0.093); unscaled it now lands at 0.075 against a chapter that ends at
// 0.0687 — i.e. outside chapter 1 altogether, which is why the Heart left frame. Scaled by
// 0.7384 so each frame samples the WORLD position its hero beat was authored against.
// RE-SCALED for Wave 1C's flyby (total 2393.89 -> 2532.66): 1767.65 / 2532.66 = 0.6979.
const CAPTURE_STEP = 0.005 * 0.6979;

function captureProgress(frameNumber) {
    return (frameNumber - 1) * CAPTURE_STEP;
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
    it('mounts the First Heart, the shaft wall, selenite chapel, and molten basins', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 240 });
        const chapterStartY = getOdysseyPathCurve().getPointAt(getActiveOdysseyChapterPositions()[0]).y;

        expect(group.userData.firstHeart?.name).toBe('first-heart');
        // The shaft wall replaced the colonnade prisms (Act I overhaul, 2026-10-20).
        expect(group.userData.shaftWall?.name).toBe('earth-core-shaft-wall');
        expect(group.userData.colonnade).toBeUndefined();
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
                // A node that multiplies materialOpacity in is still reached through
                // material.opacity, and says so.
                if (material?.opacityNode && !material.uniforms?.uOpacity
                    && !material.userData?.opacityKeepsMaterialOpacity) {
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

    it('closes the vault once the climb has crossed into the sea', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 240 });
        const { uniforms } = group.userData;
        const tEnd = group.userData.chapterTEnd;
        const vault = group.getObjectByName('volcano-background');
        expect(vault.material.opacityNode).toBeTruthy();

        updateEarthCoreEnvironment(group, 0.016, 1.0, null, tEnd);
        expect(uniforms.uVaultExit.value).toBe(1);
        // Under the dense quench, a few thousandths past the boundary, the cavern sky is gone:
        // it never hangs over the seabed's horizon in chapter 2.
        updateEarthCoreEnvironment(group, 0.016, 1.0, null, tEnd + 0.006);
        expect(uniforms.uVaultExit.value).toBe(0);
    });

    it('projects hero beats into the fixed spline camera corridor', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 660 });
        const {
            firstHeart,
            lavaFall,
            seleniteChapel,
            geodeClusters,
            lavaLake,
        } = group.userData.visibilityTargets;

        expect(firstHeart).toBeTruthy();
        expect(lavaFall).toBeTruthy();
        expect(seleniteChapel).toBeTruthy();
        expect(geodeClusters.length).toBeGreaterThanOrEqual(6);

        // THE OPENING FRAME'S SUBJECT CHANGED, BY DIRECTION (2026-08-12): the chapter now
        // opens looking across the lava it is born from - "an angle so that you see the first
        // level orb as well as the lava floor at the start position". A level opening cannot
        // also contain the First Heart, which sits ~62 degrees above the eye at the top of the
        // shaft, so its frame-1 assertion is REPLACED (not dropped) by a pin on the new
        // subject below. The Heart is still required at frames 8 and 16, where the ascent has
        // pitched the camera up and the Heart is genuinely the hero beat.
        [8, 16].forEach((frame) => {
            expectVisible(group, firstHeart, captureProgress(frame), `First Heart frame ${frame}`);
        });

        // Frame 1 pins the authored opening: the lava floor must be in shot, and it must be
        // read as a FLOOR - i.e. below the frame's centre line, not a sliver on the edge.
        expect(lavaLake, 'lava lake exposed as a visibility target').toBeTruthy();
        expectVisible(group, lavaLake, captureProgress(1), 'Lava floor frame 1');
        const lavaNdc = projectTarget(group, lavaLake, captureProgress(1));
        expect(lavaNdc.y, 'lava floor sits below the frame centre at the start').toBeLessThan(0);

        [8, 9, 10, 11].forEach((frame) => {
            expectVisible(group, seleniteChapel, captureProgress(frame), `Selenite chapel frame ${frame}`);
        });

        // THE FALLS POUR DOWN THE SHAFT NOW (Act I overhaul, 2026-10-20). The old hero was one
        // crossed-plane fall at lake level, revealed from local 0.45, pinned at frames 12-16. The
        // shaft's falls leave spouts high on the wall and stand in the climb from its start: at
        // least three lips must be in front of the camera, inside the frame, at frames 4-8 (the throat falls stay in it longer).
        const { falls } = group.userData.shaftPlan;
        [4, 6, 8].forEach((frame) => {
            const progress = captureProgress(frame);
            updateEarthCoreEnvironment(group, 0.016, progress * 20, null, progress);
            const inFrame = falls.filter((f) => {
                const lip = new THREE.Object3D();
                lip.position.set(f.lip.x, f.lip.y - 6, f.lip.z);
                group.add(lip);
                const ndc = projectTarget(group, lip, progress);
                group.remove(lip);
                return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z > -1 && ndc.z < 1;
            });
            expect(inFrame.length, `falls in frame at frame ${frame}`).toBeGreaterThanOrEqual(3);
        });
    });

    it('sinks staged seam boulders before the frame-18 capture equivalent', () => {
        stubCanvasDocument();

        const group = createEarthCoreEnvironment({ particleCount: 660 });
        const { seamBoulders } = group.userData.visibilityTargets;
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
