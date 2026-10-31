import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    FOREST_UPRIGHT_ASPECT, FOREST_VIEWS, forestEye, forestViewFor,
} from '../../src/themes/forest/forest-composition.js';
import { ForestFireflySim, forestFireflyWander } from '../../src/themes/forest/forest-firefly-sim.js';
import { ForestLight } from '../../src/themes/forest/forest-light.js';
import { FOREST_MOON_RADIUS_DEGREES } from '../../src/themes/forest/forest-plan.js';
import { forestTier } from '../../src/themes/forest/forest-quality.js';
import { FOREST_FIGURE_TIMING, ForestReactions } from '../../src/themes/forest/forest-reactions.js';
import {
    FOREST_FIGURES, FOREST_FIGURE_ROOM, createForestFigurePoints, forestFigure,
} from '../../src/themes/forest/forest-figures.js';
import { ForestFireflyDirector } from '../../src/themes/forest/forest-firefly-director.js';
import { ForestStage } from '../../src/themes/forest/forest-stage.js';
import { forestGroundHeight } from '../../src/themes/forest/forest-terrain.js';
import { FOREST_FIGURE_STAND, FOREST_FIGURE_STANDS } from '../../src/themes/forest/forest-understory.js';
import { ForestWorld } from '../../src/themes/forest/forest-world.js';

// What the review of the first build found and the fixes that answered it: the figure stood
// off-screen on narrow and upright screens, a square screen cut the moon, a settling
// firefly sank through the moss, and a few public methods took a NaN at its word.

const ASPECTS = [32 / 9, 21 / 9, 16 / 9, 16 / 10, 4 / 3, 1.2, 1, 3 / 4, 9 / 16, 9 / 19.5];
const STAG = forestFigure('stag');
/** How far the widest of the animals reaches to either side of where it stands, in the forest. */
const WIDEST_REACH = Math.max(...FOREST_FIGURES.map((figure) => (
    Math.max(figure.bounds.maxX, -figure.bounds.minX) * figure.scale)));

function frame(aspect) {
    const view = forestViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 3400);
    camera.position.set(...forestEye(view));
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

/** `ForestWorld.figureAnchor` only needs the stage and the trunks. */
function anchorFor(camera, trunks = []) {
    const stage = new ForestStage(camera, forestGroundHeight);
    return ForestWorld.prototype.figureAnchor.call({ stage, trees: { trunks: () => trunks } });
}

describe('Forest: the figure stands where the screen can see it', () => {
    it('keeps its usual place on wide screens', () => {
        for (const aspect of [21 / 9, 16 / 9]) {
            const anchor = anchorFor(frame(aspect));
            expect([anchor.x, anchor.z]).toEqual([FOREST_FIGURE_STAND.x, FOREST_FIGURE_STAND.z]);
        }
    });

    it('no animal reaches further to either side than the stag the place was measured for', () => {
        const stag = Math.max(STAG.bounds.maxX, -STAG.bounds.minX) * STAG.scale;
        expect(WIDEST_REACH).toBeLessThanOrEqual(stag + 0.05);
    });

    it.each(ASPECTS)('fits the widest animal across the view at aspect %f', (aspect) => {
        const camera = frame(aspect);
        const anchor = anchorFor(camera);
        // Nose and tail of the figure at shoulder height, as the director lays it out.
        const reach = WIDEST_REACH;
        for (const along of [-reach, 0, reach]) {
            const point = new THREE.Vector3(
                anchor.x + anchor.facing.x * along,
                anchor.y + 1.8,
                anchor.z + anchor.facing.z * along,
            ).project(camera);
            expect(point.z).toBeLessThan(1);
            expect(Math.abs(point.x)).toBeLessThan(1);
        }
        expect(anchor.y).toBeCloseTo(forestGroundHeight(anchor.x, anchor.z), 10);
        // Side on to the eye: the figure's plane faces the line of sight.
        expect(Math.hypot(anchor.facing.x, anchor.facing.z)).toBeCloseTo(1, 6);
        expect(anchor.facing.x * anchor.depth.x + anchor.facing.z * anchor.depth.z).toBeCloseTo(0, 6);
    });

    it('steps clear of a trunk that stands where it would have stood', () => {
        const camera = frame(9 / 16);
        const first = anchorFor(camera);
        const moved = anchorFor(camera, [{ x: first.x, z: first.z, radius: 0.6 }]);
        expect(Math.hypot(moved.x - first.x, moved.z - first.z)).toBeGreaterThan(2);
    });
});

describe('Forest: every place an animal may stand is one the screen can see', () => {
    /** Every place a figure may stand on this screen, as the world hands them to the director. */
    function anchorsFor(camera, trunks = []) {
        const world = Object.assign(Object.create(ForestWorld.prototype), {
            stage: new ForestStage(camera, forestGroundHeight), trees: { trunks: () => trunks },
        });
        return world.figureAnchors();
    }

    /**
     * The game's single-player screen as measured at 1600 x 900: the card 314 px wide from 0.115
     * to 0.885 of the height, the score panel 240 x 274 px from 195 px right of the middle and
     * 170 px down. Both scale with the window's height.
     */
    function gameLayout(aspect) {
        const x = (px) => 0.5 + px / (900 * aspect);
        return {
            board: {
                x0: x(-157), x1: x(157), y0: 0.115, y1: 0.885,
            },
            panel: {
                x0: x(195), x1: x(435), y0: 170 / 900, y1: 444 / 900,
            },
        };
    }

    /** Would the director see a whole animal there (see ForestFireflyDirector.standInSight)? */
    function seenWhole(stage, anchor) {
        return ForestFireflyDirector.prototype.standInSight.call({
            stage,
            standBox: {
                x0: 0, x1: 0, y0: 0, y1: 0,
            },
            standPoint: { x: 0, y: 0 },
        }, anchor);
    }

    it.each(ASPECTS)('fits the widest animal, hooves to crown, at every place offered at aspect %f', (aspect) => {
        const camera = frame(aspect);
        const anchors = anchorsFor(camera);
        // The usual place first, always (moved into view where it must be), and each place once.
        expect(anchors[0]).toEqual(anchorFor(camera));
        expect(new Set(anchors.map((anchor) => anchor.stand)).size).toBe(anchors.length);
        for (const anchor of anchors) {
            const stand = FOREST_FIGURE_STANDS[anchor.stand];
            expect(stand).toBeDefined();
            if (anchor.stand > 0) expect([anchor.x, anchor.z]).toEqual([stand.x, stand.z]);
            expect(anchor.y).toBeCloseTo(forestGroundHeight(anchor.x, anchor.z), 10);
            for (const along of [-WIDEST_REACH, 0, WIDEST_REACH]) {
                for (const up of [0.2, 1.8, FOREST_FIGURE_ROOM.height]) {
                    const point = new THREE.Vector3(
                        anchor.x + anchor.facing.x * along,
                        anchor.y + up,
                        anchor.z + anchor.facing.z * along,
                    ).project(camera);
                    expect(point.z).toBeLessThan(1);
                    expect(Math.abs(point.x), `place ${anchor.stand}`).toBeLessThan(1);
                    expect(Math.abs(point.y), `place ${anchor.stand}`).toBeLessThan(1);
                }
            }
        }
    });

    it('offers every place on a landscape screen, and a choice on every screen but a square one', () => {
        for (const aspect of [32 / 9, 21 / 9, 16 / 9, 16 / 10]) {
            expect(anchorsFor(frame(aspect))).toHaveLength(FOREST_FIGURE_STANDS.length);
        }
        for (const aspect of ASPECTS) {
            expect(anchorsFor(frame(aspect)).length, `aspect ${aspect}`).toBeGreaterThanOrEqual(aspect === 1 ? 1 : 2);
        }
    });

    /** The places the director could stand an animal at in the game's own layout at `aspect`. */
    function inSightInGame(aspect) {
        const camera = frame(aspect);
        const stage = new ForestStage(camera, forestGroundHeight);
        const { board, panel } = gameLayout(aspect);
        stage.setBoard(board);
        stage.setPanels([panel]);
        return anchorsFor(camera).filter((anchor) => seenWhole(stage, anchor));
    }

    it.each([16 / 9, 21 / 9])('in the game sees every place whole, beside the card and its panel, at %f', (aspect) => {
        expect(inSightInGame(aspect).map((anchor) => anchor.stand))
            .toEqual(FOREST_FIGURE_STANDS.map((_, index) => index));
    });

    it.each([32 / 9, 16 / 10, 3 / 2])('in the game sees places on both sides of the card at %f', (aspect) => {
        const seen = inSightInGame(aspect);
        expect(seen.some((anchor) => anchor.x < 0)).toBe(true);
        expect(seen.some((anchor) => anchor.x > 0)).toBe(true);
    });

    it.each([4 / 3, 1.2])('in the game still sees a whole animal somewhere at %f', (aspect) => {
        expect(inSightInGame(aspect).length).toBeGreaterThan(0);
    });
});

describe('Forest: the moon is whole in every framing', () => {
    it.each(ASPECTS)('holds the full disc inside the view at aspect %f', (aspect) => {
        const camera = frame(aspect);
        const light = new ForestLight({ tier: forestTier('Minimal') });
        const moon = light.uMoonDir.value.clone().normalize();
        const radius = THREE.MathUtils.degToRad(FOREST_MOON_RADIUS_DEGREES);
        // The limb's far left and right points.
        for (const side of [-1, 1]) {
            const limb = moon.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -side * radius);
            const point = camera.position.clone().addScaledVector(limb, 500).project(camera);
            expect(Math.abs(point.x)).toBeLessThan(1);
            expect(Math.abs(point.y)).toBeLessThan(1);
        }
        light.dispose();
    });

    it('turns toward the moon below the upright aspect, and not above it', () => {
        expect(forestViewFor(FOREST_UPRIGHT_ASPECT - 0.01)).toBe(FOREST_VIEWS.portrait);
        expect(forestViewFor(FOREST_UPRIGHT_ASPECT + 0.01)).toBe(FOREST_VIEWS.landscape);
    });
});

describe('Forest: small guards', () => {
    it('a settling firefly comes to rest above the moss', () => {
        let state = 7;
        const rng = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        const sim = new ForestFireflySim({
            count: 300, reserve: 120, rng, groundHeight: forestGroundHeight,
        });
        const wander = [0, 0, 0];
        let lowest = Infinity;
        for (let frameIndex = 0; frameIndex < 60 * 25; frameIndex += 1) {
            sim.step(1 / 60, { settled: true });
            if (frameIndex % 30 === 0) {
                for (let i = 0; i < sim.ambient; i += 1) {
                    // The sim keeps an offset from the wander path; rebuild the height it draws.
                    forestFireflyWander(sim.seed[i], sim.time, wander);
                    const height = sim.home[i * 3 + 1] + wander[1] + sim.y[i] - sim.homeFloor[i];
                    lowest = Math.min(lowest, height);
                }
            }
        }
        expect(lowest).toBeGreaterThan(0.1);
        // And they did sink: this is not the resting swarm.
        expect(lowest).toBeLessThan(0.3);
    });

    it('a spark is not bound to a place that is not a number', () => {
        const sim = new ForestFireflySim({ count: 40, reserve: 20, rng: () => 0.5 });
        const index = sim.spawn(0, 2, 0, 0, 0, 0, { life: 5 });
        expect(sim.bind(index, NaN, 1, 1)).toBe(false);
        expect(sim.bound[index]).toBe(0);
        expect(sim.bind(index, 1, 2, 3, NaN)).toBe(true);
        expect(sim.bound[index]).toBe(1);
    });

    it('the figure is summoned for its usual stay when the stay asked for is not a number', () => {
        const reactions = new ForestReactions({ quality: 'High', rng: () => 0.5 });
        reactions.summon(NaN);
        expect(reactions.figure.hold).toBe(FOREST_FIGURE_TIMING.hold);
        reactions.summon(Infinity);
        expect(reactions.figure.hold).toBe(12);
        // And it does let go.
        for (let i = 0; i < 60 * 20; i += 1) reactions.update(1 / 60);
        expect(reactions.getFrame().figure).toBeNull();
    });

    it('a disposed director stays disposed through a reset', () => {
        const reactions = new ForestReactions({ quality: 'High', rng: () => 0.5 });
        reactions.dispose();
        reactions.reset();
        expect(reactions.onPieceLock({})).toBe(false);
        expect(reactions.onLineClear(4)).toBe(false);
    });

    it('the figure figure is drawn even when asked for a number of lights that is not one', () => {
        expect(createForestFigurePoints(STAG, NaN, () => 0.5).length).toBe(8 * 4);
    });

    it('the static shadow map is drawn again by the clock, for pipelines that land late', () => {
        const light = new ForestLight({ tier: forestTier('Minimal') });
        light.frameShadows();
        // Past every frame-counted redraw without a second going by, each frame's render drawing the
        // map as three does (the first redraws count draws: shared/static-shadow-draws.js).
        for (let i = 0; i < 200; i += 1) {
            light.update(0, 0, {});
            light.moon.shadow.needsUpdate = false;
        }
        light.moon.shadow.needsUpdate = false;
        light.update(1, 1, {});
        expect(light.moon.shadow.needsUpdate).toBe(false);
        light.update(2.5, 1.5, {});
        expect(light.moon.shadow.needsUpdate).toBe(true);
        light.moon.shadow.needsUpdate = false;
        light.update(3, 0.5, {});
        expect(light.moon.shadow.needsUpdate).toBe(false);
        light.update(60, 57, {});
        expect(light.moon.shadow.needsUpdate).toBe(true);
        light.moon.shadow.needsUpdate = false;
        light.update(120, 60, {});
        expect(light.moon.shadow.needsUpdate).toBe(false);
        light.dispose();
    });
});
