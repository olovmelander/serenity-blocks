import {
    describe, expect, it, vi,
} from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import {
    BOARD_CANVAS_SELECTOR, BOARD_GRID, FALLBACK_BOARD, boardPoint, playerCanvasSelector, readBoardRect,
} from '../../src/themes/murmuration/composition/board-layout.js';
import {
    PALETTE_LEVEL_STEP, PALETTE_SPAN, SWARM_PALETTE, samplePalette,
} from '../../src/themes/murmuration/composition/swarm-palette.js';
import {
    QUALITY_PRESETS, SWARM_FOCAL, applySwarmFrame, frameHalfExtents, normalizeQuality, projectToPlane, shapeLayout,
    swarmFrame, swarmLook,
} from '../../src/themes/murmuration/composition/swarm-tiers.js';
import {
    FLUID_BUDGETS, FluidParticleSim, NATIVE_FLUID_COUNTS,
} from '../../src/themes/murmuration/sim/fluid-particles.js';

const REST_FOV = 38;
const FOCAL = new Vector3(SWARM_FOCAL.x, SWARM_FOCAL.y, SWARM_FOCAL.z);

/** The theme's camera at rest, for a window of this size. */
function cameraFor(width, height) {
    const camera = new PerspectiveCamera(REST_FOV, width / height, 0.1, 400);
    camera.position.set(0, 0.4, 15);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
}

const rect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});
const canvas = (r, visibility = 'visible') => ({ visibility, getBoundingClientRect: () => r });
const WIN = { innerWidth: 1600, innerHeight: 900, getComputedStyle: (el) => ({ visibility: el.visibility }) };

function page(boards, players = {}) {
    return {
        querySelectorAll: vi.fn((selector) => (selector === BOARD_CANVAS_SELECTOR ? boards : [])),
        querySelector: vi.fn((selector) => players[selector] ?? null),
    };
}

describe('murmuration layout: the board on screen', () => {
    it('maps a column and a row onto the window through the board rect', () => {
        const board = {
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.9,
        };
        // A row is measured to its centre line.
        expect(boardPoint(board, 0, 0)).toEqual({ x: 0.4, y: 0.2 + 0.7 * (0.5 / BOARD_GRID.rows) });
        const foot = boardPoint(board, 1, BOARD_GRID.rows - 1);
        expect(foot.x).toBeCloseTo(0.6, 9);
        expect(foot.y).toBeCloseTo(0.9 - 0.7 * (0.5 / BOARD_GRID.rows), 9);
        const middle = boardPoint(board, 0.5, (BOARD_GRID.rows - 1) / 2);
        expect(middle.x).toBeCloseTo(0.5, 9);
        expect(middle.y).toBeCloseTo(0.55, 9);
        // Out-of-range input is clamped onto the board.
        expect(boardPoint(board, 7, 99)).toEqual(foot);
        expect(boardPoint(board, -3, -5)).toEqual(boardPoint(board, 0, 0));
        // It writes into the object it is handed.
        const out = { x: 0, y: 0 };
        expect(boardPoint(board, 0.25, 4, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.45, 9);
    });

    it('uses the solo board\'s usual place when no board is on screen', () => {
        const centre = boardPoint(null, 0.5, (BOARD_GRID.rows - 1) / 2);
        expect(centre.x).toBeCloseTo(0.5, 9);
        expect(centre.y).toBeCloseTo(0.5, 9);
        expect(boardPoint(undefined, 0, 0).x).toBe(FALLBACK_BOARD.x0);
        expect(boardPoint(null, 1, 0).x).toBe(FALLBACK_BOARD.x1);
        // A tall rect, inside the window.
        const { x0, y0, x1, y1 } = FALLBACK_BOARD; // eslint-disable-line object-curly-newline
        expect(x0).toBeGreaterThan(0);
        expect(x1).toBeLessThan(1);
        expect(y0).toBeGreaterThan(0);
        expect(y1).toBeLessThan(1);
        expect(y1 - y0).toBeGreaterThan(x1 - x0);
    });

    it('reads the first visible board canvas as window fractions', () => {
        const doc = page([canvas(rect(650, 200, 300, 600))]);
        expect(readBoardRect(0, doc, WIN)).toEqual({
            x0: 650 / 1600, y0: 200 / 900, x1: 950 / 1600, y1: 800 / 900,
        });
        // The solo board never goes looking for a player's canvas.
        expect(doc.querySelector).not.toHaveBeenCalled();
        // A window that cannot report styles is taken at its word on size alone.
        expect(readBoardRect(0, doc, { innerWidth: 1600, innerHeight: 900 }).x0).toBeCloseTo(650 / 1600, 9);
    });

    it('skips canvases that are not showing', () => {
        const shown = canvas(rect(60, 200, 270, 540));
        const doc = page([
            canvas(rect(0, 0, 0, 0)), // not laid out
            canvas(rect(10, 10, 300, 0)), // collapsed
            canvas(rect(650, 200, 300, 600), 'hidden'), // another mode's board
            canvas(rect(650, 200, 300, 600), 'collapse'),
            { visibility: 'visible' }, // not an element that can be measured
            shown,
            canvas(rect(900, 200, 300, 600)),
        ]);
        expect(readBoardRect(0, doc, WIN)).toEqual({
            x0: 60 / 1600, y0: 200 / 900, x1: 330 / 1600, y1: 740 / 900,
        });
    });

    it('prefers a player\'s own canvas, and falls back to the first board on screen', () => {
        const shared = canvas(rect(650, 200, 300, 600));
        const second = canvas(rect(100, 100, 200, 400));
        const doc = page([shared], {
            [playerCanvasSelector(2)]: second,
            [playerCanvasSelector(3)]: canvas(rect(1200, 100, 200, 400), 'hidden'),
        });
        expect(readBoardRect(2, doc, WIN)).toEqual({
            x0: 100 / 1600, y0: 100 / 900, x1: 300 / 1600, y1: 500 / 900,
        });
        const fallback = readBoardRect(0, doc, WIN);
        expect(fallback.x0).toBeCloseTo(650 / 1600, 9);
        expect(readBoardRect(1, doc, WIN)).toEqual(fallback); // no canvas of their own
        expect(readBoardRect(3, doc, WIN)).toEqual(fallback); // theirs is hidden
        expect(playerCanvasSelector(2)).not.toBe(playerCanvasSelector(3));
    });

    it('reads nothing when there is no board, or no page', () => {
        expect(readBoardRect(0, page([]), WIN)).toBeNull();
        expect(readBoardRect(2, page([]), WIN)).toBeNull();
        expect(readBoardRect(0, page([canvas(rect(0, 0, 0, 0)), canvas(rect(1, 1, 5, 5), 'hidden')]), WIN)).toBeNull();
        expect(readBoardRect(0, null, WIN)).toBeNull();
        expect(readBoardRect(0, page([canvas(rect(1, 1, 5, 5))]), null)).toBeNull();
        expect(readBoardRect(0, {}, WIN)).toBeNull();
        expect(readBoardRect()).toBeNull(); // no DOM here at all
    });
});

describe('murmuration layout: the swarm in the frame', () => {
    it('measures the view at the focal plane', () => {
        const camera = cameraFor(1920, 1080);
        const frame = frameHalfExtents(camera, FOCAL, REST_FOV);
        expect(frame.distance).toBeCloseTo(camera.position.distanceTo(FOCAL), 9);
        expect(frame.halfHeight).toBeCloseTo(Math.tan((REST_FOV * Math.PI) / 360) * frame.distance, 9);
        expect(frame.halfWidth).toBeCloseTo(frame.halfHeight * (16 / 9), 9);
        expect(frameHalfExtents(camera)).toEqual(frame); // the swarm's own focal point, the camera's own lens
        // It agrees with the real projection: the frame's right edge is the screen's right edge.
        const edge = new Vector3(FOCAL.x + frame.halfWidth, FOCAL.y, FOCAL.z).project(camera);
        expect(edge.x).toBeGreaterThan(0.98);
        expect(edge.x).toBeLessThan(1.02);
    });

    it('gives a wide screen wings and a phone a tall, narrower, denser loop', () => {
        const radius = 8;
        const wideCamera = cameraFor(1920, 1080);
        const tallCamera = cameraFor(390, 844);
        const wide = swarmFrame(wideCamera, radius, FOCAL, REST_FOV);
        const tall = swarmFrame(tallCamera, radius, FOCAL, REST_FOV);
        // 16:9 has room for the swarm as authored.
        expect(wide.extent.x).toBeCloseTo(radius, 9);
        expect(wide.extent.y).toBeLessThan(wide.extent.x);
        expect(wide.crowding).toBeCloseTo(1, 9);
        // Portrait squeezes it sideways, so the same motes fly closer together.
        expect(tall.extent.x).toBeLessThan(wide.extent.x);
        expect(tall.extent.x).toBeLessThan(tall.extent.y);
        expect(tall.extent.y).toBeLessThanOrEqual(wide.extent.y);
        expect(tall.extent.z).toBe(wide.extent.z);
        expect(tall.crowding).toBeGreaterThan(1);
        expect(tall.crowding).toBeCloseTo(
            (wide.extent.x * wide.extent.y) / (tall.extent.x * tall.extent.y),
            9,
        );
        // Formations get the frame's own proportions.
        expect(tall.shapeHalfWidth).toBeLessThan(wide.shapeHalfWidth);
        expect(tall.shapeHalfHeight).toBeCloseTo(wide.shapeHalfHeight, 9);
        for (const [camera, frame] of [[wideCamera, wide], [tallCamera, tall]]) {
            const view = frameHalfExtents(camera, FOCAL, REST_FOV);
            expect(frame.shapeHalfWidth).toBeLessThan(view.halfWidth);
            expect(frame.shapeHalfHeight).toBeLessThan(view.halfHeight);
            // The whole ring is on screen: its outer edge projects inside the window.
            const right = new Vector3(FOCAL.x + frame.extent.x, FOCAL.y, FOCAL.z).project(camera);
            const top = new Vector3(FOCAL.x, FOCAL.y + frame.extent.y, FOCAL.z).project(camera);
            expect(right.x).toBeGreaterThan(0.5);
            expect(right.x).toBeLessThan(1);
            expect(top.y).toBeGreaterThan(0.3);
            expect(top.y).toBeLessThan(1);
        }
    });

    it('never asks any tier for a swarm wider than the screen, and never reports it sparser than authored', () => {
        for (const [width, height] of [[1920, 1080], [2560, 1080], [1024, 768], [390, 844]]) {
            const camera = cameraFor(width, height);
            const view = frameHalfExtents(camera, FOCAL, REST_FOV);
            let last = null;
            for (const { focalRadius } of Object.values(FLUID_BUDGETS)) {
                const frame = swarmFrame(camera, focalRadius, FOCAL, REST_FOV);
                expect(frame.extent.x).toBeLessThanOrEqual(Math.min(focalRadius, view.halfWidth));
                expect(frame.extent.y).toBeLessThanOrEqual(view.halfHeight);
                expect(frame.extent.x).toBeGreaterThan(0);
                expect(frame.extent.y).toBeGreaterThan(0);
                expect(frame.crowding).toBeGreaterThanOrEqual(1);
                // A bigger tier never gets a smaller swarm.
                if (last) expect(frame.extent.x).toBeGreaterThanOrEqual(last.extent.x);
                last = frame;
            }
        }
    });

    it('sizes the swarm for the lens at rest, so a zoom punch does not resize it', () => {
        const camera = cameraFor(1920, 1080);
        const rest = swarmFrame(camera, 12, FOCAL, REST_FOV);
        camera.fov = REST_FOV - 6;
        camera.updateProjectionMatrix();
        expect(swarmFrame(camera, 12, FOCAL, REST_FOV)).toEqual(rest);
        // Without a rest lens it follows the camera's own.
        expect(swarmFrame(camera, 12, FOCAL).extent.x).toBeLessThan(rest.extent.x);
        expect(frameHalfExtents(camera, FOCAL).halfHeight)
            .toBeLessThan(frameHalfExtents(camera, FOCAL, REST_FOV).halfHeight);
    });

    it('applies a frame to a running swarm', () => {
        const frame = swarmFrame(cameraFor(390, 844), 9.5, FOCAL, REST_FOV);
        const sim = new FluidParticleSim(64, { cpu: true });
        applySwarmFrame(sim, frame);
        expect(sim.uExtent.value.toArray()).toEqual(frame.extent.toArray());
        // The next formation is fitted to it.
        sim.setShape('torus', { jitter: 0 });
        let width = 0;
        for (let i = 0; i < sim.count; i += 1) width = Math.max(width, Math.abs(sim.targetData[i * 4]));
        expect(width).toBeLessThanOrEqual(frame.shapeHalfWidth + 1e-4);
        expect(sim.shapeFitScale).toBeLessThan(1);
        sim.dispose();
    });

    it('draws formations as a pair flanking the board when there is room either side', () => {
        const frame = swarmFrame(cameraFor(1920, 1080), 9.5, FOCAL, REST_FOV);
        // swarmFrame carries the view it was sized for.
        const view = frameHalfExtents(cameraFor(1920, 1080), FOCAL, REST_FOV);
        expect(frame).toMatchObject({ halfWidth: view.halfWidth, halfHeight: view.halfHeight });
        const blocked = 3; // the solo board and its card
        const layout = shapeLayout(frame, blocked);
        expect(layout.twin).toBe(true);
        // Each copy sits between the board's edge and the edge of the screen.
        expect(layout.offsetX - layout.halfWidth).toBeGreaterThanOrEqual(blocked);
        expect(layout.offsetX + layout.halfWidth).toBeLessThanOrEqual(frame.halfWidth);
        expect(layout.halfWidth).toBeGreaterThan(1);
        expect(layout.halfHeight).toBeGreaterThan(layout.halfWidth);
        expect(layout.halfHeight).toBeLessThan(frame.halfHeight);
        // A wider board pushes the pair outward and narrows it.
        const wider = shapeLayout(frame, blocked + 1);
        expect(wider.twin).toBe(true);
        expect(wider.offsetX).toBeGreaterThan(layout.offsetX);
        expect(wider.halfWidth).toBeLessThan(layout.halfWidth);
    });

    it('keeps one centred figure when the boards leave no room beside them', () => {
        const wide = swarmFrame(cameraFor(1920, 1080), 9.5, FOCAL, REST_FOV);
        const tall = swarmFrame(cameraFor(390, 844), 9.5, FOCAL, REST_FOV);
        const centred = (layout, frame) => {
            expect(layout).toMatchObject({ twin: false, offsetX: 0 });
            expect(layout.halfWidth).toBeLessThan(frame.halfWidth);
            expect(layout.halfWidth).toBeGreaterThan(frame.halfWidth * 0.5);
            expect(layout.halfHeight).toBeLessThan(frame.halfHeight);
        };
        // A phone: the board is most of the width.
        centred(shapeLayout(tall, tall.halfWidth * 0.8), tall);
        // Local multiplayer: boards right across a wide screen.
        centred(shapeLayout(wide, wide.halfWidth * 0.8), wide);
        centred(shapeLayout(wide, wide.halfWidth * 3), wide);
        // No board on screen at all, or a width that makes no sense.
        for (const blocked of [0, -2, NaN, undefined, null]) centred(shapeLayout(wide, blocked), wide);
        // The centred figure is fitted exactly as swarmFrame says a formation should be.
        expect(shapeLayout(wide, 0)).toMatchObject({
            halfWidth: wide.shapeHalfWidth, halfHeight: wide.shapeHalfHeight,
        });
        // Somewhere between a narrow board and a wide one the pair gives way to one figure, once.
        const twins = [];
        for (let blocked = 0.25; blocked < wide.halfWidth; blocked += 0.25) twins.push(shapeLayout(wide, blocked).twin);
        expect(twins[0]).toBe(true);
        expect(twins.at(-1)).toBe(false);
        expect(twins.lastIndexOf(true)).toBeLessThan(twins.indexOf(false));
    });

    it('carries a point on the screen along its view ray to the swarm\'s plane', () => {
        for (const camera of [cameraFor(1920, 1080), cameraFor(390, 844)]) {
            const out = { x: 9, y: 9, z: 9 };
            // The middle of the screen is the middle of the swarm (the camera sits a touch above it).
            expect(projectToPlane(camera, 0.5, 0.5, FOCAL.z, out)).toBe(true);
            expect(out.x).toBeCloseTo(FOCAL.x, 6);
            expect(Math.abs(out.y - FOCAL.y)).toBeLessThan(0.1);
            expect(out.z).toBe(FOCAL.z);
            const centre = { ...out };
            // Screen right is world +x; screen DOWN is world -y.
            projectToPlane(camera, 0.75, 0.5, FOCAL.z, out);
            expect(out.x).toBeGreaterThan(centre.x + 0.5);
            expect(out.y).toBeCloseTo(centre.y, 6);
            projectToPlane(camera, 0.5, 0.75, FOCAL.z, out);
            expect(out.y).toBeLessThan(centre.y - 0.5);
            expect(out.x).toBeCloseTo(centre.x, 6);

            // Round trip: where a world point on the plane appears on screen leads back to it.
            for (const [x, y] of [[0, 0], [3.2, -1.4], [-6, 2.5], [1.1, 4]]) {
                const ndc = new Vector3(x, y, FOCAL.z).project(camera);
                expect(projectToPlane(camera, (ndc.x + 1) / 2, (1 - ndc.y) / 2, FOCAL.z, out)).toBe(true);
                expect(out.x).toBeCloseTo(x, 5);
                expect(out.y).toBeCloseTo(y, 5);
                expect(out.z).toBe(FOCAL.z);
            }
        }
    });

    it('says so when a view ray never reaches the plane', () => {
        const camera = cameraFor(1920, 1080);
        const out = { x: 1, y: 2, z: 3 };
        // A plane behind the camera.
        expect(projectToPlane(camera, 0.5, 0.5, 20, out)).toBe(false);
        // A camera looking along the plane.
        const sideways = new PerspectiveCamera(REST_FOV, 16 / 9, 0.1, 400);
        sideways.position.set(0, 0, 15);
        sideways.lookAt(10, 0, 15);
        sideways.updateMatrixWorld();
        expect(projectToPlane(sideways, 0.5, 0.5, FOCAL.z, out)).toBe(false);
        expect(out).toEqual({ x: 1, y: 2, z: 3 });
    });
});

describe('murmuration layout: quality tiers', () => {
    it('has a preset for every swarm budget, and falls back to High', () => {
        expect(Object.keys(QUALITY_PRESETS)).toEqual(Object.keys(FLUID_BUDGETS));
        for (const name of Object.keys(QUALITY_PRESETS)) expect(normalizeQuality(name)).toBe(name);
        for (const name of ['high', 'Potato', 'Auto', '', null, undefined, 3]) {
            expect(normalizeQuality(name), String(name)).toBe('High');
        }
        // Every tier flies the swarm; only the lowest goes without the post stack.
        const presets = Object.values(QUALITY_PRESETS);
        expect(presets.every((preset) => preset.enableFluid)).toBe(true);
        expect(presets.filter((preset) => !preset.enablePost)).toEqual([QUALITY_PRESETS.Minimal]);
        // Each tier names its total light; a higher tier is never dimmer.
        for (let i = 1; i < presets.length; i += 1) {
            expect(presets[i].light).toBeGreaterThanOrEqual(presets[i - 1].light);
        }
    });

    it('holds each tier to a total light budget whatever the mote count', () => {
        const total = (look, count) => count * look.sizeMul * look.sizeMul * look.exposure;
        const mid = [8000, 12000, 20000, 45000, 60000, 130000];
        for (const name of Object.keys(QUALITY_PRESETS)) {
            // More motes are smaller motes, between a floor and a ceiling.
            const counts = [1, 1000, 5000, ...mid, 1e6, 1e9];
            const looks = counts.map((count) => swarmLook(name, count));
            for (let i = 1; i < looks.length; i += 1) {
                expect(looks[i].sizeMul).toBeLessThanOrEqual(looks[i - 1].sizeMul);
            }
            expect(looks[0].sizeMul).toBe(looks[1].sizeMul);
            expect(looks.at(-1).sizeMul).toBe(looks.at(-2).sizeMul);
            expect(looks.at(-1).sizeMul).toBeGreaterThan(0.25);
            // count × area × exposure is the tier's light, the same at every count: a swarm
            // with five times the motes is finer, not five times as bright.
            const budget = total(swarmLook(name, 20000), 20000);
            mid.forEach((count) => expect(total(swarmLook(name, count), count)).toBeCloseTo(budget, 6));
            // … and proportional to the tier's `light`.
            expect(budget / total(swarmLook('Low', 20000), 20000))
                .toBeCloseTo(QUALITY_PRESETS[name].light / QUALITY_PRESETS.Low.light, 9);
            // The native path carries more motes than the CPU path: smaller ones.
            expect(swarmLook(name, NATIVE_FLUID_COUNTS[name]).sizeMul)
                .toBeLessThan(swarmLook(name, FLUID_BUDGETS[name].count).sizeMul);
        }
        expect(swarmLook('nope', 1000)).toEqual(swarmLook('High', 1000));
        expect(Object.values(swarmLook('High', 0)).every(Number.isFinite)).toBe(true);
    });
});

describe('murmuration layout: the palette', () => {
    const stops = SWARM_PALETTE.length;

    it('is each stop\'s own colour at that stop', () => {
        SWARM_PALETTE.forEach((stop, i) => {
            const colour = samplePalette(i / stops);
            stop.forEach((channel, c) => expect(colour[c]).toBeCloseTo(channel, 9));
            expect(stop.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
        });
    });

    it('is cyclic: any real number is a place on the wheel', () => {
        for (const t of [0.03, 0.31, 0.5, 0.77, 0.999]) {
            const here = samplePalette(t);
            for (const turns of [1, 2, -1, -7, 40]) {
                samplePalette(t + turns).forEach((channel, c) => expect(channel).toBeCloseTo(here[c], 9));
            }
        }
        samplePalette(-0.25).forEach((channel, c) => expect(channel).toBeCloseTo(samplePalette(0.75)[c], 9));
        samplePalette(1).forEach((channel, c) => expect(channel).toBeCloseTo(SWARM_PALETTE[0][c], 9));
        // No seam where the wheel closes.
        const before = samplePalette(1 - 1e-7);
        const after = samplePalette(1e-7);
        before.forEach((channel, c) => expect(channel).toBeCloseTo(after[c], 5));
        samplePalette(-1e-18).forEach((channel, c) => expect(channel).toBeCloseTo(SWARM_PALETTE[0][c], 9));
    });

    it('blends smoothly between neighbouring stops and never leaves them', () => {
        for (let i = 0; i < stops; i += 1) {
            const a = SWARM_PALETTE[i];
            const b = SWARM_PALETTE[(i + 1) % stops];
            // Half way is the even mix.
            samplePalette((i + 0.5) / stops).forEach((channel, c) => expect(channel).toBeCloseTo((a[c] + b[c]) / 2, 9));
            let previous = samplePalette(i / stops);
            for (let f = 0.05; f < 1; f += 0.05) {
                const colour = samplePalette((i + f) / stops);
                for (let c = 0; c < 3; c += 1) {
                    expect(colour[c]).toBeGreaterThanOrEqual(Math.min(a[c], b[c]) - 1e-9);
                    expect(colour[c]).toBeLessThanOrEqual(Math.max(a[c], b[c]) + 1e-9);
                    // No jumps: a twentieth of a stop is a small step in colour.
                    expect(Math.abs(colour[c] - previous[c])).toBeLessThan(0.1);
                }
                previous = colour;
            }
        }
    });

    it('writes into an array, a typed array, or anything with r/g/b', () => {
        const t = 0.41;
        const plain = samplePalette(t);
        const array = [9, 9, 9];
        expect(samplePalette(t, array)).toBe(array);
        expect(array).toEqual(plain);
        const typed = new Float32Array(3);
        expect(samplePalette(t, typed)).toBe(typed);
        expect([...typed]).toEqual(plain.map(Math.fround));
        const colour = { r: 9, g: 9, b: 9 };
        expect(samplePalette(t, colour)).toBe(colour);
        expect([colour.r, colour.g, colour.b]).toEqual(plain);
    });

    it('shows only part of the wheel at once, and steps on by less than a whole turn per level', () => {
        expect(PALETTE_SPAN).toBeGreaterThan(0);
        expect(PALETTE_SPAN).toBeLessThan(0.5);
        expect(PALETTE_LEVEL_STEP).toBeGreaterThan(0);
        expect(PALETTE_LEVEL_STEP).toBeLessThan(1);
        // A new level is a new colour: the step never lands back on the same place.
        const seen = new Set();
        for (let level = 0; level < 20; level += 1) seen.add(((level * PALETTE_LEVEL_STEP) % 1).toFixed(6));
        expect(seen.size).toBe(20);
    });
});
