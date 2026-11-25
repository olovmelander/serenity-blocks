// THE FREE FRAME (2026-11-25). The map's UI covers part of the picture: the orb's card over the
// right of the screen (or across the bottom of a narrow one), the header over the top. The lens is
// shifted so the picture's centre sits in the middle of what is left: the orb in the middle of the
// free frame, and what stands beside it (the black hole, the ringed planet, the city's sun) out
// from under the card. A shift of the lens, never a turn of the camera.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    FRAME_SHIFT, OdysseyCameraController, resolveFrameShift,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';
import { measureOdysseyFreeFrame } from '../../src/ui/odyssey/odyssey-free-frame.js';

function rig({ reducedMotion = false } = {}) {
    const layout = getLevelRegistry().getPresentationLayout();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
    const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
        levelPositions: layout.levelPositions,
        chapterPositions: layout.chapterPositions,
        startPosition: 0.3,
        idleAutoDrift: false,
        getReducedMotion: () => reducedMotion,
    });
    controller.cinematicConfig.swayEnabled = false;
    controller.cinematicConfig.bobEnabled = false;
    controller.cinematicConfig.rollEnabled = false;
    controller.cinematicConfig.surgeAmplitude = 0;
    controller.setCurrentPosition(0.3);
    return { controller, camera };
}

const settle = (controller, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i += 1) controller.update(1 / 60);
};

/** Where what the camera aims at lands on the screen, in half-screens from its middle. */
function aimOnScreen(controller, camera) {
    camera.updateMatrixWorld(true);
    const p = controller.lookAtTarget.clone().project(camera);
    return { x: p.x, y: p.y };
}

/** The free frame of a 1920 x 1080 map: the card from x 1560, the header to y 76. */
const WIDE = { x: ((1560 / 2) - 960) / 960, y: -((((76 + 1080) / 2) - 540) / 540) };

describe('the free frame', () => {
    it('puts the picture\'s centre in the middle of the free part of the frame', () => {
        const { controller, camera } = rig();
        settle(controller, 1);
        const before = aimOnScreen(controller, camera);
        expect(Math.abs(before.x)).toBeLessThan(0.02);
        const eye = camera.position.clone();
        const gaze = camera.quaternion.clone();

        controller.setFrameCentre(WIDE.x, WIDE.y);
        settle(controller, 3);
        const after = aimOnScreen(controller, camera);
        // The aim sits at the free frame's middle: 780 of 1920 px, 578 of 1080.
        expect(after.x - before.x).toBeCloseTo(WIDE.x, 2);
        expect(after.y - before.y).toBeCloseTo(WIDE.y, 2);
        // The lens shifted: the eye and its gaze are where they were.
        expect(camera.position.distanceTo(eye)).toBeLessThan(1e-6);
        expect(camera.quaternion.angleTo(gaze)).toBeLessThan(1e-6);
        // ...and the picture keeps its shape (a view offset given as 1 x 1 would square the lens).
        expect(camera.aspect).toBeCloseTo(16 / 9, 6);
        expect(camera.projectionMatrix.elements[0] / camera.projectionMatrix.elements[5]).toBeCloseTo(9 / 16, 6);
    });

    it('takes the first frame at once, then eases as the UI comes and goes', () => {
        const { controller, camera } = rig();
        controller.setFrameCentre(WIDE.x, WIDE.y);
        controller.update(1 / 60);
        // The map opens framed: no slide on the first frame.
        expect(controller.getFrameShift().x).toBeCloseTo(WIDE.x / 2, 6);

        // The card goes (a ride between orbs): the picture eases back to the whole screen.
        controller.setFrameCentre(0, 0);
        controller.update(1 / 60);
        const first = controller.getFrameShift().x;
        expect(first).toBeLessThan(0);
        expect(first).toBeGreaterThan(WIDE.x / 2);
        expect(Math.abs(first - (WIDE.x / 2))).toBeLessThan(Math.abs(WIDE.x / 2) * 0.1);
        settle(controller, 4);
        expect(controller.getFrameShift().x).toBe(0);
        expect(camera.view === null || camera.view.enabled === false).toBe(true);
    });

    it('never carries the lens further than its limit, and sets it at once with reduced motion', () => {
        expect(resolveFrameShift(-0.9, 0).x).toBe(-FRAME_SHIFT.max);
        expect(resolveFrameShift(0.9, -0.9)).toEqual({ x: FRAME_SHIFT.max, y: -FRAME_SHIFT.max });
        expect(resolveFrameShift(0, 0)).toEqual({ x: 0, y: 0 });

        const { controller } = rig({ reducedMotion: true });
        controller.setFrameCentre(WIDE.x, 0);
        controller.update(1 / 60);
        controller.setFrameCentre(0, 0);
        controller.update(1 / 60);
        expect(controller.getFrameShift().x).toBe(0);
    });

    it('holds through a change of lens: every projection the camera rebuilds keeps the shift', () => {
        const { controller, camera } = rig();
        controller.setFrameCentre(WIDE.x, WIDE.y);
        settle(controller, 1);
        const shifted = camera.projectionMatrix.elements[8];
        expect(Math.abs(shifted)).toBeGreaterThan(0.1);
        camera.fov = 44;
        camera.aspect = 21 / 9;
        camera.updateProjectionMatrix();
        // The off-axis term is the shift itself, whatever the lens and the window's shape.
        expect(camera.projectionMatrix.elements[8]).toBeCloseTo(shifted, 6);
    });

    it('measures the look around from the free frame\'s middle, as far to either side', () => {
        const { controller } = rig();
        controller.setFrameCentre(WIDE.x, WIDE.y);
        const cardEdge = ((1560 / 1920) * 2) - 1;
        controller.setLookPointer(cardEdge, 0);
        expect(controller._lookTarget.x).toBeCloseTo(1, 2);
        controller.setLookPointer(-1, 0);
        expect(controller._lookTarget.x).toBeCloseTo(-1, 2);
        controller.setLookPointer(WIDE.x, WIDE.y);
        expect(controller._lookTarget.x).toBeCloseTo(0, 6);
        expect(controller._lookTarget.y).toBeCloseTo(0, 6);
        // Off the map (onto the card, out of the window) the look comes back to rest: the card's
        // edge is a full turn now, and the view must not stay turned while the player reads it.
        controller.setLookPointer(cardEdge, 0);
        controller.restLook();
        expect(controller._lookTarget.x).toBe(0);
    });
});

/** A stand-in page: elements with a box and a computed style. */
function page({
    width = 1920, height = 1080, header = null, panel = null, overlay = {},
} = {}) {
    const make = (id, box, style = {}, hidden = false, parent = null) => ({
        id,
        parentElement: parent,
        classList: { contains: (name) => name === 'hidden' && hidden },
        getBoundingClientRect: () => ({
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            right: box.left + box.width,
            bottom: box.top + box.height,
        }),
        style: {
            display: 'block', visibility: 'visible', opacity: '1', ...style,
        },
    });
    const root = make('odyssey-board-overlay', {
        left: 0, top: 0, width, height,
    }, overlay);
    const elements = { 'odyssey-board-overlay': root };
    if (header) elements['odyssey-map-header'] = make('odyssey-map-header', header.box, header.style, false, root);
    if (panel) elements['odyssey-level-panel'] = make('odyssey-level-panel', panel.box, panel.style, panel.hidden === true, root);
    return {
        doc: { getElementById: (id) => elements[id] ?? null },
        win: { innerWidth: width, innerHeight: height, getComputedStyle: (node) => node.style },
    };
}

describe('measuring the free frame', () => {
    const header = {
        box: {
            left: 0, top: 0, width: 1920, height: 76,
        },
    };
    const card = {
        box: {
            left: 1560, top: 80, width: 344, height: 984,
        },
    };

    it('finds the middle of what the card and the header leave open', () => {
        const { doc, win } = page({ header, panel: card });
        const free = measureOdysseyFreeFrame(doc, win);
        expect(free.x).toBeCloseTo(WIDE.x, 6);
        expect(free.y).toBeCloseTo(WIDE.y, 6);
    });

    it('is the whole screen when the UI is away', () => {
        for (const state of [
            { header, panel: { ...card, hidden: true } },
            { header, panel: card, overlay: { visibility: 'hidden' } },
            { header, panel: card, overlay: { opacity: '0' } },
            { header, panel: { ...card, style: { opacity: '0' } } },
        ]) {
            const { doc, win } = page(state);
            const free = measureOdysseyFreeFrame(doc, win);
            expect(free.x).toBe(0);
        }
        expect(measureOdysseyFreeFrame({ getElementById: () => null }, { innerWidth: 1920, innerHeight: 1080 }))
            .toEqual({ x: 0, y: 0 });
    });

    it('lifts the picture over a sheet across the bottom of a narrow screen', () => {
        const { doc, win } = page({
            width: 390,
            height: 844,
            header: {
                box: {
                    left: 0, top: 0, width: 390, height: 64,
                },
            },
            panel: {
                box: {
                    left: 12, top: 420, width: 366, height: 412,
                },
            },
        });
        const free = measureOdysseyFreeFrame(doc, win);
        expect(free.x).toBe(0);
        // The open part runs from the header (64) to the sheet (420): its middle is over the screen's.
        expect(free.y).toBeCloseTo(-((((64 + 420) / 2) - 422) / 422), 6);
        expect(free.y).toBeGreaterThan(0.3);
    });

    it('goes the other way for a card on the left', () => {
        const { doc, win } = page({
            panel: {
                box: {
                    left: 16, top: 80, width: 344, height: 900,
                },
            },
        });
        expect(measureOdysseyFreeFrame(doc, win).x).toBeCloseTo(360 / 1920, 6);
    });
});
