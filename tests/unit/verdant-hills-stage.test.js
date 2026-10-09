import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { VerdantHillsRings } from '../../src/themes/verdant-hills/verdant-hills-rings.js';
import {
    VERDANT_HILLS_DEFAULT_BOARD, VERDANT_HILLS_STAGE_DEPTH, VerdantHillsStage, readVerdantHillsBoardRect,
} from '../../src/themes/verdant-hills/verdant-hills-stage.js';

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
/** How far a ray is followed before it is given up, and where the march begins. */
const FAR = 260;
const NEAR = 1.5;
/** The march lengthens its step with distance, so the crossing is found to within this much. */
const tolerance = (reach) => 0.03 + 0.002 * reach;

/** The eye on the hilltop: three metres up, looking out over the valley and a little down. */
function hilltopCamera(aspect = LANDSCAPE) {
    const camera = new THREE.PerspectiveCamera(46, aspect, 0.3, 30000);
    camera.position.set(0, 3, 0);
    camera.lookAt(0, -6, -120);
    camera.updateProjectionMatrix();
    return camera;
}

/** An arbitrary pose with yaw, pitch and roll, to prove the maths is not tied to the hilltop's view. */
function tiltedCamera(pitch = 0.4) {
    const camera = new THREE.PerspectiveCamera(38, 1.3, 0.1, 500);
    camera.position.set(4, 7, -3);
    camera.rotation.set(pitch, -1.1, 0.25, 'YXZ');
    camera.updateProjectionMatrix();
    return camera;
}

function expectVector(actual, expected, digits = 9) {
    expect(actual.x).toBeCloseTo(expected.x, digits);
    expect(actual.y).toBeCloseTo(expected.y, digits);
    expect(actual.z).toBeCloseTo(expected.z, digits);
}

function ndc(point, camera) {
    return new THREE.Vector3(point.x, point.y, point.z).project(camera);
}

const flatDistance = (point, origin) => Math.hypot(point.x - origin.x, point.z - origin.z);

/** The first place a ray goes under the land, found the slow way: a centimetre at a time. */
function firstCrossing(stage, sx, sy, height, step = 0.01) {
    const ray = stage.ray(sx, sy);
    for (let reach = NEAR; reach <= FAR; reach += step) {
        const x = stage.origin.x + ray.x * reach;
        const z = stage.origin.z + ray.z * reach;
        if (stage.origin.y + ray.y * reach <= height(x, z)) return reach;
    }
    return null;
}

/** A valley floor twenty metres under the hilltop, and a far hillside climbing out of it. */
const farHillside = (x, z) => -20 + 0.3 * Math.max(0, -z - 80);
/** Land that drops away from the eye at forty-five degrees in every direction. */
const scarp = (x, z) => -5 - Math.hypot(x, z);
/** Rolling downs: crests and hollows of either sign, nothing a ray could mistake for a wall. */
const downs = (x, z) => -14 + 11 * Math.sin(x * 0.021 + 0.6) * Math.cos(z * 0.017) + 5 * Math.sin(z * 0.043 + x * 0.01);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Verdant Hills stage', () => {
    it.each([
        ['the landscape hilltop view', () => hilltopCamera(LANDSCAPE)],
        ['the portrait hilltop view', () => hilltopCamera(PORTRAIT)],
        ['an arbitrary tilted camera', tiltedCamera],
    ])('maps screen fractions onto a plane in front of %s', (_label, makeCamera) => {
        const camera = makeCamera();
        const stage = new VerdantHillsStage(camera);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (const depth of [1, VERDANT_HILLS_STAGE_DEPTH, 40]) {
            // The middle of the screen lies on the camera's axis, `depth` metres out.
            expectVector(stage.point(0.5, 0.5, depth), camera.position.clone().addScaledVector(forward, depth));
            for (const [sx, sy] of [[0, 0], [1, 1], [0.2, 0.7], [0.9, 0.05], [-0.3, 1.4]]) {
                const point = stage.point(sx, sy, depth);
                // y runs down the screen, as DOM rectangles do.
                const projected = ndc(point, camera);
                expect(projected.x).toBeCloseTo(sx * 2 - 1, 9);
                expect(projected.y).toBeCloseTo(1 - sy * 2, 9);
                expect(point.clone().sub(camera.position).dot(forward)).toBeCloseTo(depth, 9);
            }
        }
        expect(VERDANT_HILLS_STAGE_DEPTH).toBe(8.5);
        expectVector(stage.point(0.3, 0.6), stage.point(0.3, 0.6, VERDANT_HILLS_STAGE_DEPTH));
        const target = new THREE.Vector3(9, 9, 9);
        expect(stage.point(0.3, 0.6, 5, target)).toBe(target);
        expectVector(target, stage.point(0.3, 0.6, 5));
        expect(stage.halfWidth(10)).toBeCloseTo(stage.point(1, 0.5, 10).distanceTo(stage.point(0.5, 0.5, 10)), 9);
        expect(stage.halfWidth()).toBeCloseTo(stage.halfWidth(VERDANT_HILLS_STAGE_DEPTH), 12);
    });

    it.each([
        ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
    ])('finds the card edges, its centre and its rows in %s', (_label, aspect) => {
        const camera = hilltopCamera(aspect);
        const stage = new VerdantHillsStage(camera);
        expect(stage.board).toEqual(VERDANT_HILLS_DEFAULT_BOARD);
        expect(stage.board).not.toBe(VERDANT_HILLS_DEFAULT_BOARD);
        const {
            x0, x1, y0, y1,
        } = stage.board;
        for (const row of [0, 0.25, 0.5, 1]) {
            const left = stage.edge(-1, row);
            const right = stage.edge(1, row);
            expect(ndc(left, camera).x).toBeCloseTo(x0 * 2 - 1, 9);
            expect(ndc(right, camera).x).toBeCloseTo(x1 * 2 - 1, 9);
            // Row 0 is the foot of the card, row 1 its top.
            const screenY = y1 + (y0 - y1) * row;
            expect(ndc(left, camera).y).toBeCloseTo(1 - screenY * 2, 9);
            expect(ndc(right, camera).y).toBeCloseTo(1 - screenY * 2, 9);
            expect(stage.screen(0, row).x).toBeCloseTo(x0, 12);
            expect(stage.screen(0, row).y).toBeCloseTo(screenY, 12);
            expect(stage.screen(1, row).x).toBeCloseTo(x1, 12);
        }
        expect(stage.edge(-1, 1).y).toBeGreaterThan(stage.edge(-1, 0).y + 3);
        // Rows and columns outside the card are clamped onto it.
        expectVector(stage.edge(1, -4), stage.edge(1, 0));
        expectVector(stage.edge(1, 9), stage.edge(1, 1));
        expect(stage.screen(-3, 7).x).toBeCloseTo(x0, 12);
        expect(stage.screen(-3, 7).y).toBeCloseTo(y0, 12);
        expect(stage.screen(0.5, 0.5).x).toBeCloseTo((x0 + x1) / 2, 12);
        // An inset moves the point in from either edge, toward the middle of the card.
        expect(ndc(stage.edge(-1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x0 + 0.02) * 2 - 1, 9);
        expect(ndc(stage.edge(1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x1 - 0.02) * 2 - 1, 9);
        const centre = ndc(stage.centre(), camera);
        expect(centre.x).toBeCloseTo(x0 + x1 - 1, 9);
        expect(centre.y).toBeCloseTo(1 - (y0 + y1), 9);
        const target = new THREE.Vector3();
        expect(stage.edge(1, 0.5, 4, target)).toBe(target);
        expect(stage.centre(4, target)).toBe(target);
    });

    describe('the sky through the card', () => {
        it.each([
            ['the landscape hilltop view', () => hilltopCamera(LANDSCAPE)],
            ['the portrait hilltop view', () => hilltopCamera(PORTRAIT)],
            ['an arbitrary tilted camera', tiltedCamera],
        ])('gives the unit direction of the ray through any screen position of %s', (_label, makeCamera) => {
            const camera = makeCamera();
            const stage = new VerdantHillsStage(camera);
            // Through the middle of the screen it is the way the camera looks.
            expectVector(stage.ray(0.5, 0.5), camera.getWorldDirection(new THREE.Vector3()));
            for (const [sx, sy] of [[0, 0], [1, 1], [0.2, 0.7], [0.9, 0.05], [0.5, 0.09], [-0.3, 1.4]]) {
                const ray = stage.ray(sx, sy);
                expect(ray.length()).toBeCloseTo(1, 12);
                // The same line as the eye to that place on a plane at any depth.
                for (const depth of [1, VERDANT_HILLS_STAGE_DEPTH, 300]) {
                    expectVector(ray, stage.point(sx, sy, depth).sub(stage.origin).normalize());
                }
                // A point any distance along it is seen at that place on the screen.
                const seen = ndc(stage.origin.clone().addScaledVector(ray, 77), camera);
                expect(seen.x).toBeCloseTo(sx * 2 - 1, 9);
                expect(seen.y).toBeCloseTo(1 - sy * 2, 9);
            }
        });

        it('points higher toward the top of the screen and follows the columns sideways', () => {
            const stage = new VerdantHillsStage(hilltopCamera());
            let previous = Infinity;
            for (let sy = 0; sy <= 1.001; sy += 0.1) {
                const { y } = stage.ray(0.5, sy);
                expect(y).toBeLessThan(previous);
                previous = y;
            }
            // This view looks down the -z axis: left on screen is -x, and the top of the card is sky.
            expect(stage.ray(0.2, 0.5).x).toBeLessThan(0);
            expect(stage.ray(0.8, 0.5).x).toBeGreaterThan(0);
            expect(stage.ray(0.5, 0.5).x).toBeCloseTo(0, 12);
            expect(stage.ray(0.5, 0.5).z).toBeLessThan(-0.9);
            const top = stage.screen(0.5, 1);
            expect(stage.ray(top.x, top.y).y).toBeGreaterThan(0.1);
        });

        it('writes into the vector it is given, and into a new one otherwise', () => {
            const stage = new VerdantHillsStage(hilltopCamera());
            const target = new THREE.Vector3(7, 7, 7);
            expect(stage.ray(0.3, 0.2, target)).toBe(target);
            const first = target.clone();
            const other = stage.ray(0.9, 0.7);
            expect(other).not.toBe(target);
            expect(stage.ray(0.9, 0.7)).not.toBe(other);
            // A look at the land in between does not disturb a ray already handed out.
            stage.ground(0.6, 0.9, downs);
            expectVector(target, first, 12);
            expectVector(stage.ray(0.3, 0.2), first, 12);
            expect(other.x).not.toBeCloseTo(first.x, 3);
        });
    });

    describe('the hills behind the card', () => {
        it.each([
            ['landscape', () => hilltopCamera(LANDSCAPE)],
            ['portrait', () => hilltopCamera(PORTRAIT)],
            ['a tilted camera looking down', () => tiltedCamera(-0.45)],
        ])('finds where a ray through the screen meets level ground of either sign in %s', (_label, makeCamera) => {
            const camera = makeCamera();
            const stage = new VerdantHillsStage(camera);
            for (const level of [1.5, 0, -0.5, -40]) {
                let met = 0;
                for (let sx = 0; sx <= 1.001; sx += 0.25) {
                    for (let sy = 0.4; sy <= 1.001; sy += 0.05) {
                        const point = stage.ground(sx, sy, () => level);
                        // Always on the ground it was asked about: a hollow is not lifted to zero.
                        expect(point.y).toBe(level);
                        const ray = stage.ray(sx, sy);
                        const reach = (level - camera.position.y) / ray.y;
                        if (ray.y < 0 && reach > NEAR + 0.5 && reach < FAR - 1) {
                            // Inside its reach it is what the eye sees there.
                            const exact = camera.position.clone().addScaledVector(ray, reach);
                            expect(point.distanceTo(exact)).toBeLessThan(tolerance(reach));
                            // The distance along the ray is kept for whoever needs it.
                            expect(stage.reach).toBeGreaterThanOrEqual(reach - 1e-9);
                            expect(stage.reach - reach).toBeLessThan(tolerance(reach));
                            met += 1;
                        }
                    }
                }
                expect(met, `level ${level}`).toBeGreaterThan(10);
            }
        });

        it('meets a far hillside that climbs out of the valley, on the land and at its first crossing', () => {
            const camera = hilltopCamera(LANDSCAPE);
            const stage = new VerdantHillsStage(camera);
            let floor = 0;
            let slope = 0;
            for (let sx = 0.1; sx <= 0.901; sx += 0.2) {
                for (let sy = 0.3; sy <= 1.001; sy += 0.05) {
                    const exact = firstCrossing(stage, sx, sy, farHillside);
                    const point = stage.ground(sx, sy, farHillside);
                    if (exact === null) continue;
                    expect(point.y).toBe(farHillside(point.x, point.z));
                    expect(Math.abs(stage.reach - exact), `${sx}, ${sy}`).toBeLessThan(tolerance(exact) + 0.01);
                    // It lies under the ray through that screen position: same compass bearing.
                    const ray = stage.ray(sx, sy);
                    const flat = Math.hypot(ray.x, ray.z);
                    const distance = flatDistance(point, camera.position);
                    expect((point.x - camera.position.x) / distance).toBeCloseTo(ray.x / flat, 9);
                    expect((point.z - camera.position.z) / distance).toBeCloseTo(ray.z / flat, 9);
                    if (point.z > -80) floor += 1;
                    else slope += 1;
                }
            }
            // The view holds both: the valley floor under the eye and the slope beyond it.
            expect(floor).toBeGreaterThan(10);
            expect(slope).toBeGreaterThan(10);
            // The floor is below zero and stays there; the slope climbs past the height of the eye.
            const down = stage.ground(0.5, 0.95, farHillside);
            expect(down.y).toBe(-20);
            expect(down.z).toBeGreaterThan(-80);
            const level = stage.screen(0.5, 0.5);
            const across = stage.ground(level.x, 0.42, farHillside);
            expect(across.z).toBeLessThan(-80);
            expect(across.y).toBeGreaterThan(-20);
            expect(stage.reach).toBeLessThan(FAR);
            // Higher on the screen the ray meets the slope further up it.
            expect(stage.ground(level.x, 0.38, farHillside).y).toBeGreaterThan(across.y);
        });

        it('ends a ray the falling land never meets at its far reach, dropped to the ground there', () => {
            const camera = hilltopCamera(LANDSCAPE);
            const stage = new VerdantHillsStage(camera);
            for (const [sx, sy] of [[0.5, 0], [0.1, 0.3], [0.9, 0.6], [0.5, 0.8], [0.3, 1]]) {
                // The scarp drops faster than any ray in the view: the slow march agrees it is never met.
                expect(firstCrossing(stage, sx, sy, scarp, 0.25)).toBeNull();
                const point = stage.ground(sx, sy, scarp);
                expect(stage.reach).toBe(FAR);
                const ray = stage.ray(sx, sy);
                expectVector(
                    new THREE.Vector3(point.x, 0, point.z),
                    new THREE.Vector3(camera.position.x + ray.x * FAR, 0, camera.position.z + ray.z * FAR),
                    9,
                );
                // On the land under the end of the ray, which is still in the air above it.
                expect(point.y).toBe(scarp(point.x, point.z));
                expect(point.y).toBeLessThan(camera.position.y + ray.y * FAR);
                expect(point.y).toBeLessThan(-100);
            }
            // The sky above level ground is the same: the far reach, on the ground under it.
            for (const level of [2, -30]) {
                const sky = stage.ground(0.5, 0.05, () => level);
                expect(stage.reach).toBe(FAR);
                expect(sky.y).toBe(level);
                expect(flatDistance(sky, camera.position)).toBeCloseTo(FAR * Math.hypot(
                    stage.ray(0.5, 0.05).x,
                    stage.ray(0.5, 0.05).z,
                ), 9);
            }
            // And a hit resets the reach it reports.
            stage.ground(0.5, 0.9, () => -1);
            expect(stage.reach).toBeLessThan(20);
        });

        it('stops at the first land in the way and comes nearer as the position moves down the screen', () => {
            const camera = hilltopCamera(LANDSCAPE);
            const stage = new VerdantHillsStage(camera);
            let previous = Infinity;
            for (let sy = 0.55; sy <= 1.001; sy += 0.05) {
                const distance = flatDistance(stage.ground(0.5, sy, () => -2), camera.position);
                expect(distance).toBeLessThan(previous);
                previous = distance;
            }
            // A bank across the view hides the ground behind it.
            const bank = (x, z) => (z < -6 && z > -8 ? 50 : -2);
            const open = stage.ground(0.5, 0.62, () => -2);
            const hidden = stage.ground(0.5, 0.62, bank);
            expect(flatDistance(open, camera.position)).toBeGreaterThan(12);
            expect(flatDistance(hidden, camera.position)).toBeGreaterThan(5.9);
            expect(flatDistance(hidden, camera.position)).toBeLessThan(6.2);
            expect(hidden.y).toBe(50);
            // Left on screen is left on the ground.
            expect(stage.ground(0.2, 0.9, () => -2).x).toBeLessThan(stage.ground(0.8, 0.9, () => -2).x);
            // Land already over the eye where the march begins is met at once.
            const buried = stage.ground(0.5, 0.5, () => 100);
            expect(stage.reach).toBe(NEAR);
            expect(buried.y).toBe(100);
            expect(buried.distanceTo(new THREE.Vector3(0, 100, 0))).toBeLessThan(NEAR);
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('returns a point on rolling downs for every place on the screen, in %s', (_label, aspect) => {
            const camera = hilltopCamera(aspect);
            const stage = new VerdantHillsStage(camera);
            let met = 0;
            let missed = 0;
            let hollows = 0;
            for (let sx = 0; sx <= 1.001; sx += 0.1) {
                for (let sy = 0; sy <= 1.001; sy += 0.05) {
                    const point = stage.ground(sx, sy, downs);
                    const { reach } = stage;
                    expect(Number.isFinite(point.x) && Number.isFinite(point.z)).toBe(true);
                    // On the land it was given, whatever its sign.
                    expect(point.y).toBe(downs(point.x, point.z));
                    if (point.y < 0) hollows += 1;
                    const ray = stage.ray(sx, sy);
                    const above = (along) => camera.position.y + ray.y * along
                        - downs(camera.position.x + ray.x * along, camera.position.z + ray.z * along);
                    expect(reach).toBeGreaterThanOrEqual(NEAR);
                    expect(reach).toBeLessThanOrEqual(FAR);
                    if (above(reach) <= 0) {
                        // A real crossing: just short of it the ray is still in the air.
                        expect(above(reach - tolerance(reach))).toBeGreaterThan(0);
                        met += 1;
                    } else {
                        expect(reach).toBe(FAR);
                        missed += 1;
                    }
                }
            }
            expect(met).toBeGreaterThan(60);
            expect(missed).toBeGreaterThan(20);
            expect(hollows).toBeGreaterThan(60);
            // The foot of the default card stands on the near slope, all the way across.
            for (const column of [0, 0.25, 0.5, 0.75, 1]) {
                const foot = stage.screen(column, 0);
                const point = stage.ground(foot.x, foot.y, downs);
                expect(stage.reach, `column ${column}`).toBeLessThan(120);
                expect(point.z).toBeLessThan(camera.position.z);
            }
        });

        it('writes into the vector it is given and leaves its own state reusable', () => {
            const stage = new VerdantHillsStage(hilltopCamera());
            const target = new THREE.Vector3(7, 7, 7);
            expect(stage.ground(0.5, 0.9, downs, target)).toBe(target);
            const first = target.clone();
            const { reach } = stage;
            const other = stage.ground(0.2, 0.7, downs);
            expect(other).not.toBe(target);
            expectVector(target, first, 12);
            expectVector(stage.ground(0.5, 0.9, downs), first, 12);
            expect(stage.reach).toBe(reach);
            // The land is asked about, never changed, and only where the ray goes.
            const height = vi.fn(() => -4);
            stage.ground(0.5, 0.9, height);
            expect(height.mock.calls.length).toBeGreaterThan(3);
            expect(height.mock.calls.length).toBeLessThan(80);
            for (const [x, z] of height.mock.calls) expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
        });
    });

    it('accepts a measured card, clamps it to the screen and falls back to the default for junk', () => {
        const stage = new VerdantHillsStage(hilltopCamera());
        const measured = {
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        };
        stage.setBoard(measured);
        expect(stage.board).toEqual(measured);
        // The stage keeps its own copy.
        measured.x0 = 0.9;
        expect(stage.board.x0).toBe(0.05);
        stage.setBoard({
            x0: -0.2, x1: 0.4, y0: -1, y1: 2,
        });
        expect(stage.board).toEqual({
            x0: 0, x1: 0.4, y0: 0, y1: 1,
        });
        const junk = [null, undefined, {}, 'board', 42, [], {
            x0: NaN, x1: 0.5, y0: 0.1, y1: 0.9,
        },
        { x0: 0.1, x1: 0.5, y0: 0.1 }, {
            x0: '0.1', x1: 0.5, y0: 0.1, y1: 0.9,
        },
        {
            x0: 0.9, x1: 0.1, y0: 0, y1: 1,
        }, {
            x0: 0.1, x1: 0.9, y0: 0.8, y1: 0.2,
        },
        // A sliver is not a board.
        {
            x0: 0.5, x1: 0.501, y0: 0.1, y1: 0.9,
        }, {
            x0: 0.2, x1: 0.8, y0: 0.5, y1: 0.501,
        },
        {
            x0: 0.1, x1: Infinity, y0: 0.1, y1: 0.9,
        }];
        for (const rect of junk) {
            stage.setBoard({
                x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
            });
            expect(() => stage.setBoard(rect)).not.toThrow();
            expect(stage.board, JSON.stringify(rect)).toEqual(VERDANT_HILLS_DEFAULT_BOARD);
        }
        expect(Object.isFrozen(VERDANT_HILLS_DEFAULT_BOARD)).toBe(true);
        expect(VERDANT_HILLS_DEFAULT_BOARD.x1).toBeGreaterThan(VERDANT_HILLS_DEFAULT_BOARD.x0);
        expect(VERDANT_HILLS_DEFAULT_BOARD.y1).toBeGreaterThan(VERDANT_HILLS_DEFAULT_BOARD.y0);
        // The edges follow the card at once.
        const camera = hilltopCamera();
        const framed = new VerdantHillsStage(camera);
        framed.setBoard({
            x0: 0.6, x1: 0.9, y0: 0.2, y1: 0.8,
        });
        expect(ndc(framed.edge(-1, 0), camera).x).toBeCloseTo(0.2, 9);
        expect(ndc(framed.edge(1, 0), camera).x).toBeCloseTo(0.8, 9);
        expect(ndc(framed.centre(), camera).y).toBeCloseTo(0, 9);
    });

    it('keeps the rest pose it read until it is refreshed', () => {
        const camera = hilltopCamera();
        const stage = new VerdantHillsStage(camera);
        const origin = stage.origin.clone();
        const centre = stage.centre().clone();
        const ray = stage.ray(0.3, 0.4).clone();
        const ground = stage.ground(0.5, 0.9, downs).clone();
        // Pointer parallax moves the live camera every frame; the stage must not follow it.
        camera.position.x += 3;
        camera.rotation.y += 0.4;
        camera.fov = 80;
        camera.aspect = 0.5;
        camera.updateProjectionMatrix();
        expectVector(stage.origin, origin, 12);
        expectVector(stage.centre(), centre, 12);
        expectVector(stage.ray(0.3, 0.4), ray, 12);
        expectVector(stage.ground(0.5, 0.9, downs), ground, 12);
        stage.refresh();
        expect(stage.origin.x).toBeCloseTo(origin.x + 3, 9);
        expect(stage.tanV).toBeCloseTo(Math.tan(THREE.MathUtils.degToRad(40)), 12);
        expect(stage.tanH).toBeCloseTo(stage.tanV * 0.5, 12);
        expect(ndc(stage.centre(), camera).x).toBeCloseTo(0, 9);
        expect(stage.ray(0.3, 0.4).distanceTo(ray)).toBeGreaterThan(0.1);
        expect(stage.ground(0.5, 0.9, downs).distanceTo(ground)).toBeGreaterThan(1);
    });
});

describe('reading the Verdant Hills board card from the page', () => {
    const SELECTOR = '.player-card[data-player]';
    const win = (overrides = {}) => ({
        innerWidth: 1000, innerHeight: 500, getComputedStyle: (element) => element.style ?? {}, ...overrides,
    });
    const card = ({
        left, top, width, height, style = {},
    }) => ({
        style,
        getBoundingClientRect: () => ({
            left, top, right: left + width, bottom: top + height, width, height,
        }),
    });
    const page = (cards) => ({ querySelectorAll: vi.fn((selector) => (selector === SELECTOR ? cards : [])) });

    it('measures a visible board card in screen fractions and unites several', () => {
        const doc = page([card({
            left: 400, top: 50, width: 200, height: 400,
        })]);
        expect(readVerdantHillsBoardRect(doc, win())).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        expect(doc.querySelectorAll).toHaveBeenCalledExactlyOnceWith(SELECTOR);
        const both = page([
            card({
                left: 100, top: 100, width: 200, height: 300,
            }),
            card({
                left: 600, top: 50, width: 250, height: 400,
            }),
        ]);
        expect(readVerdantHillsBoardRect(both, win())).toEqual({
            x0: 0.1, x1: 0.85, y0: 0.1, y1: 0.9,
        });
    });

    it('ignores hidden, collapsed and off-screen cards', () => {
        const visible = card({
            left: 400, top: 50, width: 200, height: 400,
        });
        const ghosts = [
            card({
                left: 0, top: 0, width: 300, height: 300, style: { display: 'none' },
            }),
            card({
                left: 0, top: 0, width: 300, height: 300, style: { visibility: 'hidden' },
            }),
            card({
                left: 0, top: 0, width: 300, height: 300, style: { opacity: '0.01' },
            }),
            card({
                left: 0, top: 0, width: 4, height: 300,
            }),
            card({
                left: 0, top: 0, width: 300, height: 0,
            }),
            card({
                left: -500, top: 0, width: 300, height: 300,
            }),
            card({
                left: 1000, top: 0, width: 300, height: 300,
            }),
            card({
                left: 0, top: -400, width: 300, height: 300,
            }),
            card({
                left: 0, top: 500, width: 300, height: 300,
            }),
            {},
            null,
        ];
        expect(readVerdantHillsBoardRect(page([...ghosts, visible]), win())).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        expect(readVerdantHillsBoardRect(page(ghosts), win())).toBeNull();
        // A faint card is still a card.
        const faint = card({
            left: 400, top: 50, width: 200, height: 400, style: { opacity: '0.3' },
        });
        expect(readVerdantHillsBoardRect(page([faint]), win())).not.toBeNull();
    });

    it('returns null when there is no page, no window or no board, and never divides by an unknown size', () => {
        expect(readVerdantHillsBoardRect(null, win())).toBeNull();
        expect(readVerdantHillsBoardRect(page([]), null)).toBeNull();
        expect(readVerdantHillsBoardRect({}, win())).toBeNull();
        expect(readVerdantHillsBoardRect(page([]), win())).toBeNull();
        const rect = readVerdantHillsBoardRect(page([card({
            left: 0, top: 0, width: 20, height: 40,
        })]), { innerWidth: 0, innerHeight: undefined });
        expect(Object.values(rect).every(Number.isFinite)).toBe(true);
        // A card hanging off the screen is reported as it is; the stage clamps it.
        const hanging = readVerdantHillsBoardRect(page([card({
            left: -100, top: 50, width: 400, height: 400,
        })]), win());
        expect(hanging.x0).toBeCloseTo(-0.1, 12);
        const stage = new VerdantHillsStage(hilltopCamera());
        stage.setBoard(hanging);
        expect(stage.board.x0).toBe(0);
        expect(stage.board.x1).toBeCloseTo(0.3, 12);
    });

    it('reads the live document and window by default', () => {
        vi.stubGlobal('window', win());
        vi.stubGlobal('document', page([card({
            left: 250, top: 100, width: 500, height: 300,
        })]));
        expect(readVerdantHillsBoardRect()).toEqual({
            x0: 0.25, x1: 0.75, y0: 0.2, y1: 0.8,
        });
        vi.unstubAllGlobals();
        vi.stubGlobal('document', undefined);
        vi.stubGlobal('window', undefined);
        expect(readVerdantHillsBoardRect()).toBeNull();
    });
});

describe('Verdant Hills gusts through the grass', () => {
    const snapshot = (pool) => pool.rings.map((entry) => entry.toArray());

    it('keeps a fixed pool, all at rest', () => {
        for (const [asked, count] of [[8, 8], [4, 4], [1, 1], [0, 1], [-3, 1], [5.9, 5]]) {
            const pool = new VerdantHillsRings(asked);
            expect(pool.count).toBe(count);
            expect(pool.rings).toHaveLength(count);
            expect(pool.active()).toBe(0);
            for (const ring of pool.rings) {
                expect(ring).toBeInstanceOf(THREE.Vector4);
                expect(ring.toArray()).toEqual([0, 0, 0, 0]);
            }
        }
        const plain = new VerdantHillsRings();
        expect(plain.count).toBeGreaterThan(0);
        expect(plain.life).toBeGreaterThan(0);
    });

    it('starts a gust at a point with its strength, capped, and refuses nonsense', () => {
        const pool = new VerdantHillsRings(4);
        const ring = pool.add(3, -7, 1.5);
        // One vec4 for the shader: where, how old, how strong.
        expect(ring).toBe(pool.rings[0]);
        expect(ring.toArray()).toEqual([3, -7, 0, 1.5]);
        expect(pool.active()).toBe(1);
        expect(pool.add(1, 1).w).toBe(1);
        // A ceiling, the same however much is asked.
        const ceiling = pool.add(0, 0, 1e9).w;
        expect(Number.isFinite(ceiling)).toBe(true);
        expect(ceiling).toBeGreaterThan(1.5);
        expect(pool.add(0, 0, Infinity).w).toBe(ceiling);
        const before = snapshot(pool);
        for (const [x, z, strength] of [[NaN, 0, 1], [0, Infinity, 1], [0, 0, 0], [0, 0, -1], [0, 0, NaN],
            [undefined, 0, 1], ['1', 0, 1], [0, 0, null]]) {
            expect(pool.add(x, z, strength), `${x}, ${z}, ${strength}`).toBeNull();
        }
        expect(snapshot(pool)).toEqual(before);
    });

    it('fills free slots in turn, then replaces the oldest gust', () => {
        const pool = new VerdantHillsRings(4, 100);
        for (let index = 0; index < 4; index++) {
            pool.add(index, 0, 1);
            pool.update(1);
        }
        expect(pool.rings.map((ring) => ring.x)).toEqual([0, 1, 2, 3]);
        expect(pool.rings.map((ring) => ring.z)).toEqual([4, 3, 2, 1]);
        // Full: the next ones take the oldest first.
        for (let index = 4; index < 7; index++) {
            const taken = pool.add(index, 0, 1);
            expect(taken).toBe(pool.rings[index - 4]);
            expect(taken.z).toBe(0);
            pool.update(1);
            expect(pool.active()).toBe(4);
        }
        expect(pool.rings.map((ring) => ring.x)).toEqual([4, 5, 6, 3]);
        // A gust that has blown itself out frees its slot before anything is replaced.
        const short = new VerdantHillsRings(3, 5);
        short.add(0, 0, 1);
        short.update(3);
        short.add(1, 0, 1);
        short.add(2, 0, 1);
        short.update(3);
        expect(short.active()).toBe(2);
        short.add(9, 9, 1);
        expect(short.rings.map((ring) => ring.x).sort()).toEqual([1, 2, 9]);
    });

    it('ages the gusts and clears each one at the end of its life', () => {
        const pool = new VerdantHillsRings(3, 6);
        pool.add(1, 2, 0.8);
        pool.update(2);
        pool.add(5, 6, 1.2);
        expect(snapshot(pool)).toEqual([[1, 2, 2, 0.8], [5, 6, 0, 1.2], [0, 0, 0, 0]]);
        // Nothing but time moves a gust: it keeps its place and its strength.
        pool.update(3.5);
        expect(snapshot(pool)).toEqual([[1, 2, 5.5, 0.8], [5, 6, 3.5, 1.2], [0, 0, 0, 0]]);
        pool.update(1);
        expect(snapshot(pool)).toEqual([[0, 0, 0, 0], [5, 6, 4.5, 1.2], [0, 0, 0, 0]]);
        expect(pool.active()).toBe(1);
        for (const dt of [0, -1, NaN, undefined, null, 'x', -Infinity]) pool.update(dt);
        expect(snapshot(pool)).toEqual([[0, 0, 0, 0], [5, 6, 4.5, 1.2], [0, 0, 0, 0]]);
        pool.update(60);
        expect(pool.active()).toBe(0);
    });

    it('forgets every gust on reset without replacing the vectors the shader was given', () => {
        const pool = new VerdantHillsRings(5);
        const { rings } = pool;
        const vectors = [...rings];
        for (let index = 0; index < 12; index++) {
            pool.add(index, -index, 1 + index / 10);
            pool.update(0.4);
        }
        expect(pool.active()).toBe(5);
        pool.reset();
        expect(pool.active()).toBe(0);
        expect(pool.rings).toBe(rings);
        pool.rings.forEach((ring, index) => {
            expect(ring).toBe(vectors[index]);
            expect(ring.toArray()).toEqual([0, 0, 0, 0]);
        });
        // The next gust goes into the first slot again.
        expect(pool.add(1, 1, 1)).toBe(vectors[0]);
    });
});
