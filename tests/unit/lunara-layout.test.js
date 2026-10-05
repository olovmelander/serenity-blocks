import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import {
    CLEAR_REACH, CLEAR_TRAVEL, LUNARA_PALETTES, PALETTE_KEYS, RING_REACH, TERRAIN, celestialAnchors, clearPassTime,
    clearRadius, linRGB, mulberry32, pieceColor, powerForCombo, ringRadius,
} from '../../src/themes/lunara/lunara-core.js';
import {
    CRYSTAL_CLUSTERS, MAX_CRYSTALS, MAX_FLORA, buildPlan, strikeTargets,
} from '../../src/themes/lunara/lunara-layout.js';
import { NOISE_SIZE, bakeNoise, sampleNoise } from '../../src/themes/lunara/lunara-tsl.js';
import {
    BOARD_GRID, PLAYER_SLOTS, boardFor, boardPoint, cardUnion, fallbackLayout, layoutsDiffer,
} from '../../src/themes/lunara/lunara-composition.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/lunara/lunara-quality.js';
import { POST_LOOK } from '../../src/themes/lunara/lunara-post.js';
import { MOON_MAP_URL, REST_RIG, fovForAspect } from '../../src/themes/lunara/lunara-world.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const noise = bakeNoise();
const plan = buildPlan(noise, NOISE_SIZE);

/** The camera the composition is measured in: standing in the flats, looking down the valley. */
function restCamera(aspect) {
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    camera.position.set(0, REST_RIG.height, 0);
    camera.lookAt(0, REST_RIG.height + Math.tan(REST_RIG.pitch) * 10, -10);
    camera.updateMatrixWorld();
    return camera;
}

describe('lunara core maths', () => {
    it('grows a lock ring fast, then settles it inside its reach', () => {
        expect(ringRadius(-1)).toBe(0);
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(0.4)).toBeGreaterThan(ringRadius(0.2));
        expect(ringRadius(0.2)).toBeGreaterThan(0);
        expect(ringRadius(60)).toBeLessThanOrEqual(RING_REACH);
        expect(ringRadius(60)).toBeGreaterThan(RING_REACH * 0.99);
    });

    it('runs a clear wave out through the valley, accelerating, and knows when it passes a point', () => {
        expect(clearRadius(-1)).toBe(0);
        expect(clearRadius(0)).toBe(0);
        expect(clearRadius(CLEAR_TRAVEL)).toBeCloseTo(CLEAR_REACH, 9);
        expect(clearRadius(CLEAR_TRAVEL * 3)).toBeCloseTo(CLEAR_REACH, 9);
        // It accelerates: half the time covers less than half the way.
        expect(clearRadius(CLEAR_TRAVEL * 0.5)).toBeLessThan(CLEAR_REACH * 0.5);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const radius = clearRadius((CLEAR_TRAVEL * i) / 20);
            expect(radius).toBeGreaterThan(previous);
            previous = radius;
        }
        // The pass time is the wave's inverse: the crystals release exactly as the front arrives.
        for (const dist of [5, 40, 150, CLEAR_REACH]) {
            expect(clearRadius(clearPassTime(dist))).toBeCloseTo(dist, 6);
        }
        expect(clearPassTime(0)).toBe(0);
        expect(clearPassTime(CLEAR_REACH * 10)).toBe(CLEAR_TRAVEL);
    });

    it('charges with the combo and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(1)).toBeGreaterThan(0);
        expect(powerForCombo(5)).toBeGreaterThan(powerForCombo(2));
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        const a = mulberry32(7);
        const b = mulberry32(7);
        for (let i = 0; i < 50; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        const rose = pieceColor('#ffa8d0');
        expect(Math.max(...rose)).toBeCloseTo(1, 6);
        expect(Math.min(...rose)).toBeGreaterThanOrEqual(0.05);
        expect(rose[0]).toBeGreaterThan(rose[2]);
        expect(rose[2]).toBeGreaterThan(rose[1]);
        // A pastel is pushed toward its own hue: the weakest channel falls further than it would
        // by normalising alone.
        const plain = linRGB(0xffa8d0);
        expect(rose[1]).toBeLessThan(plain[1] / Math.max(...plain));
        expect(pieceColor(0x0000ff)[2]).toBeCloseTo(1, 6);
        expect(pieceColor('a8ffe8')).toEqual(pieceColor('#A8FFE8'));
        // Nonsense falls back to the given colour.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 6);
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
    });

    it('defines every palette key for every level\'s palette, in scene-linear light', () => {
        expect(LUNARA_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(LUNARA_PALETTES.map((p) => p.name)).size).toBe(LUNARA_PALETTES.length);
        for (const palette of LUNARA_PALETTES) {
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
        }
    });

    it('moves the moon and the ringed world up the frame for an upright phone', () => {
        const wide = celestialAnchors(16 / 9);
        const tall = celestialAnchors(9 / 19.5);
        // Landscape leaves the centre to the board: the moon stands left of it, the planet right.
        expect(wide.moon.x).toBeLessThan(0.5);
        expect(wide.planet.x).toBeGreaterThan(0.5);
        // Upright phones show sky only above the card, so both move up there.
        expect(tall.moon.y).toBeLessThan(wide.moon.y);
        expect(tall.planet.y).toBeLessThan(wide.planet.y);
        expect(tall.moon).not.toEqual(wide.moon);
        for (const anchors of [wide, tall, celestialAnchors(1)]) {
            for (const body of [anchors.moon, anchors.planet]) {
                expect(body.x).toBeGreaterThan(0);
                expect(body.x).toBeLessThan(1);
                expect(body.y).toBeGreaterThan(0);
                expect(body.y).toBeLessThan(0.5);
                expect(body.radius).toBeGreaterThan(0);
            }
            // The great moon is the larger of the two.
            expect(anchors.moon.radius).toBeGreaterThan(anchors.planet.radius);
        }
        // A square frame sits between the two.
        const square = celestialAnchors(1);
        expect(square.moon.y).toBeGreaterThan(tall.moon.y);
        expect(square.moon.y).toBeLessThan(wide.moon.y);
        // Nonsense falls back to the landscape composition.
        expect(celestialAnchors(NaN)).toEqual(wide);
        expect(celestialAnchors(0)).toEqual(wide);
    });
});

describe('lunara noise field', () => {
    it('bakes four tileable channels stretched to the unit range, the same every time', () => {
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const lo = [Infinity, Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < noise.length; i++) {
            lo[i % 4] = Math.min(lo[i % 4], noise[i]);
            hi[i % 4] = Math.max(hi[i % 4], noise[i]);
        }
        for (let c = 0; c < 4; c++) {
            expect(lo[c]).toBeCloseTo(0, 5);
            expect(hi[c]).toBeCloseTo(1, 5);
        }
        const again = bakeNoise();
        for (let i = 0; i < noise.length; i += 997) expect(again[i]).toBe(noise[i]);
    });

    it('reads the field bilinearly and wraps at its edges', () => {
        for (const [x, y] of [[0.3, 0.7], [0.999, 0.001], [0, 0]]) {
            const v = sampleNoise(noise, NOISE_SIZE, x, y, 1);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(sampleNoise(noise, NOISE_SIZE, x + 1, y - 1, 1)).toBeCloseTo(v, 9);
        }
        // At a texel centre it returns the texel.
        const texel = (ix, iy, c) => noise[(iy * NOISE_SIZE + ix) * 4 + c];
        const centre = sampleNoise(noise, NOISE_SIZE, 10.5 / NOISE_SIZE, 20.5 / NOISE_SIZE, 2);
        expect(centre).toBeCloseTo(texel(10, 20, 2), 6);
    });
});

describe('lunara valley plan', () => {
    it('is deterministic for a seed and different for another', () => {
        const again = buildPlan(noise, NOISE_SIZE);
        expect(again.seed).toBe(plan.seed);
        expect(JSON.stringify(again.crystals)).toBe(JSON.stringify(plan.crystals));
        expect(JSON.stringify(again.flora)).toBe(JSON.stringify(plan.flora));
        expect(Array.from(again.heights)).toEqual(Array.from(plan.heights));
        for (let r = 0; r < plan.ridges.length; r++) {
            expect(Array.from(again.ridges[r].skyline)).toEqual(Array.from(plan.ridges[r].skyline));
        }
        const other = buildPlan(noise, NOISE_SIZE, 1234);
        expect(other.seed).toBe(1234);
        expect(JSON.stringify(other.crystals)).not.toBe(JSON.stringify(plan.crystals));
        expect(JSON.stringify(other.flora)).not.toBe(JSON.stringify(plan.flora));
    });

    it('lists every crystal a tier can draw, the clusters first and by importance', () => {
        expect(plan.crystals).toHaveLength(MAX_CRYSTALS);
        const clustered = CRYSTAL_CLUSTERS.reduce((sum, cluster) => sum + cluster.count, 0);
        expect(plan.clustered).toBe(clustered);
        expect(clustered).toBeLessThan(MAX_CRYSTALS);
        // Cluster after cluster, in the order the table lists them...
        let at = 0;
        CRYSTAL_CLUSTERS.forEach((cluster, index) => {
            for (let k = 0; k < cluster.count; k++) {
                const crystal = plan.crystals[at];
                expect(crystal.cluster, `crystal ${at}`).toBe(index);
                expect(crystal.hero, `crystal ${at}`).toBe(Boolean(cluster.hero));
                at += 1;
            }
        });
        // ...then the scatter of lone spires.
        for (let i = clustered; i < plan.crystals.length; i++) {
            expect(plan.crystals[i].cluster, `crystal ${i}`).toBe(-1);
            expect(plan.crystals[i].hero, `crystal ${i}`).toBe(false);
        }
        // The hero clusters lead the list, so every tier draws them.
        const heroes = plan.crystals.filter((crystal) => crystal.hero).length;
        expect(heroes).toBeGreaterThan(0);
        expect(plan.crystals.slice(0, heroes).every((crystal) => crystal.hero)).toBe(true);
        // Only the clusters are worth aiming a wisp at.
        expect(strikeTargets(plan, MAX_CRYSTALS)).toBe(clustered);
        expect(strikeTargets(plan, 10)).toBe(10);
    });

    it('stands one main spire at the heart of each cluster, the tallest of its mound', () => {
        CRYSTAL_CLUSTERS.forEach((cluster, index) => {
            const mine = plan.crystals.filter((crystal) => crystal.cluster === index);
            expect(mine).toHaveLength(cluster.count);
            const mains = mine.filter((crystal) => crystal.main);
            expect(mains, `cluster ${index}`).toHaveLength(1);
            expect(mine[0]).toBe(mains[0]);
            expect(mains[0].x).toBe(cluster.x);
            expect(mains[0].z).toBe(cluster.z);
            expect(mains[0].height).toBe(cluster.height);
            for (const crystal of mine) {
                expect(crystal.height).toBeLessThanOrEqual(cluster.height);
                // The rest stand round it, on its mound.
                const away = Math.hypot(crystal.x - cluster.x, crystal.z - cluster.z);
                expect(away).toBeLessThanOrEqual(cluster.spread + 1e-9);
            }
        });
    });

    it('points every crystal up along a unit axis, from a root in the ground to its tip', () => {
        plan.crystals.forEach((crystal, index) => {
            const label = `crystal ${index}`;
            for (const key of ['x', 'y', 'z', 'height', 'radius', 'yaw', 'hue', 'seed']) {
                expect(Number.isFinite(crystal[key]), `${label}.${key}`).toBe(true);
            }
            expect(crystal.height, label).toBeGreaterThan(0);
            expect(crystal.radius, label).toBeGreaterThan(0);
            expect(crystal.radius, label).toBeLessThan(crystal.height);
            expect(Number.isInteger(crystal.seed), label).toBe(true);
            expect(Math.hypot(...crystal.axis), label).toBeCloseTo(1, 9);
            expect(crystal.axis[1], label).toBeGreaterThan(0.5); // it leans, it never lies down
            // The tip a wisp flies to and a pillar rises from.
            expect(crystal.tip[1], label).toBeGreaterThan(crystal.y);
            expect(crystal.tip[0], label).toBeCloseTo(crystal.x + crystal.axis[0] * crystal.height, 9);
            expect(crystal.tip[1], label).toBeCloseTo(crystal.y + crystal.axis[1] * crystal.height, 9);
            expect(crystal.tip[2], label).toBeCloseTo(crystal.z + crystal.axis[2] * crystal.height, 9);
            // The root is buried: no spire floats over its ground.
            expect(crystal.y, label).toBeLessThan(plan.heightAt(crystal.x, crystal.z));
            // And it stands inside the square of terrain the water knows the depth of.
            expect(Math.abs(crystal.x), label).toBeLessThan(TERRAIN.halfWidth);
            expect(crystal.z, label).toBeGreaterThan(TERRAIN.zMin);
            expect(crystal.z, label).toBeLessThan(TERRAIN.zMax);
        });
    });

    it('stands the hero clusters either side of the board, clear of its column on screen', () => {
        const heroes = plan.crystals.filter((crystal) => crystal.hero);
        const point = new THREE.Vector3();
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080], [1280, 1024], [1024, 768]]) {
            const frame = `${width}x${height}`;
            const camera = restCamera(width / height);
            const board = fallbackLayout(width, height).boards[0];
            let left = 0;
            let right = 0;
            for (const crystal of heroes) {
                for (const [x, y, z] of [[crystal.x, crystal.y, crystal.z], crystal.tip]) {
                    point.set(x, y, z).project(camera);
                    expect(point.z, frame).toBeLessThan(1); // in front of the camera
                    const sx = point.x * 0.5 + 0.5;
                    const behind = sx > board.x0 && sx < board.x1;
                    expect(behind, `${frame}: a hero spire stands behind the board`).toBe(false);
                    if (Math.abs(point.x) < 1) {
                        if (sx < board.x0) left += 1;
                        else right += 1;
                    }
                }
            }
            // They bracket the board: some of them are in the frame on each side of it.
            expect(left, `${frame} left`).toBeGreaterThan(0);
            expect(right, `${frame} right`).toBeGreaterThan(0);
        }
    });

    it('shapes the valley: mirror flats down the middle, banks rising either side', () => {
        expect(plan.heights).toHaveLength(TERRAIN.size * TERRAIN.size);
        expect(plan.heights.every((height) => Number.isFinite(height))).toBe(true);
        // Where the camera stands and where the board looks: under the water.
        for (const z of [-4, -12, -30, -60, -120]) {
            expect(plan.heightAt(0, z), `flats at z=${z}`).toBeLessThan(0);
        }
        // Out on either side the ground has climbed well clear of it.
        const edge = TERRAIN.halfWidth - 20;
        for (const z of [-30, -60, -150]) {
            expect(plan.heightAt(-edge, z), `left bank at z=${z}`).toBeGreaterThan(1);
            expect(plan.heightAt(edge, z), `right bank at z=${z}`).toBeGreaterThan(1);
        }
        // And the lake ends at a far shore.
        expect(plan.heightAt(0, TERRAIN.zMin + 10)).toBeGreaterThan(0);
        // The heightmap the terrain mesh and the water share is the same function, sampled at
        // its texel centres.
        for (const [i, j] of [[0, 0], [96, 180], [40, 100], [TERRAIN.size - 1, TERRAIN.size - 1]]) {
            const x = -TERRAIN.halfWidth + ((i + 0.5) / TERRAIN.size) * TERRAIN.halfWidth * 2;
            const z = TERRAIN.zMin + ((j + 0.5) / TERRAIN.size) * (TERRAIN.zMax - TERRAIN.zMin);
            expect(plan.heights[j * TERRAIN.size + i]).toBeCloseTo(plan.heightAt(x, z), 4);
        }
    });

    it('lifts a mound for every cluster and rises the hero clusters straight out of the shallows', () => {
        expect(plan.mounds).toHaveLength(CRYSTAL_CLUSTERS.length);
        CRYSTAL_CLUSTERS.forEach((cluster, index) => {
            const ground = plan.heightAt(cluster.x, cluster.z);
            if (cluster.hero) {
                // At the waterline, never down on the deep bed the flats have beside it.
                expect(Math.abs(ground), `hero cluster ${index}`).toBeLessThan(0.25);
            } else {
                expect(ground, `cluster ${index}`).toBeGreaterThan(0);
            }
        });
    });

    it('plants the lantern flowers on the ground, never under the water', () => {
        expect(plan.flora.length).toBeGreaterThan(0);
        expect(plan.flora.length).toBeLessThanOrEqual(MAX_FLORA);
        plan.flora.forEach((flower, index) => {
            const label = `flower ${index}`;
            expect(flower.y, label).toBeGreaterThanOrEqual(0);
            expect(flower.y, label).toBeGreaterThanOrEqual(plan.heightAt(flower.x, flower.z) - 1e-9);
            expect(flower.height, label).toBeGreaterThan(0);
            expect(flower.hue, label).toBeGreaterThanOrEqual(0);
            expect(flower.hue, label).toBeLessThan(1);
            expect(Number.isFinite(flower.seed), label).toBe(true);
            expect(Math.abs(flower.x), label).toBeLessThan(TERRAIN.halfWidth);
            expect(flower.z, label).toBeGreaterThan(TERRAIN.zMin);
            expect(flower.z, label).toBeLessThan(TERRAIN.zMax);
        });
    });

    it('closes the valley with two ranges, each a skyline of finite heights', () => {
        expect(plan.ridges).toHaveLength(2);
        for (const ridge of plan.ridges) {
            expect(ridge.skyline).toHaveLength(ridge.columns + 1);
            for (let c = 0; c <= ridge.columns; c++) {
                expect(Number.isFinite(ridge.skyline[c])).toBe(true);
                expect(ridge.skyline[c]).toBeGreaterThan(Math.max(0, ridge.floor));
            }
            expect(ridge.radius).toBeGreaterThan(-TERRAIN.zMin); // beyond the far shore
            expect(ridge.depth).toBeGreaterThan(0);
            expect(ridge.arc).toBeGreaterThan(0);
        }
        // The second stands farther off and higher, and both inside the camera's far plane.
        const [near, far] = plan.ridges;
        expect(far.radius).toBeGreaterThan(near.radius);
        expect(Math.max(...far.skyline)).toBeGreaterThan(Math.max(...near.skyline));
        expect(far.radius + far.depth).toBeLessThan(REST_RIG.far);
    });
});

describe('lunara composition helpers', () => {
    it('seats the fallback board at the foot of its card in a wide frame and an upright one', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [430, 932]]) {
            const layout = fallbackLayout(width, height);
            const card = layout.cards[0];
            const board = layout.boards[0];
            expect(layout.cardCount).toBe(0); // nothing is on screen: these are the stylesheet's sums
            expect(layout.cards).toHaveLength(1);
            expect(layout.boards).toHaveLength(PLAYER_SLOTS);
            expect(layout.boards.slice(1).every((b) => b === null)).toBe(true);
            expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 9);
            expect((board.x0 + board.x1) / 2).toBeCloseTo(0.5, 9);
            expect(board.x0).toBeGreaterThan(card.x0);
            expect(board.x1).toBeLessThan(card.x1);
            expect(board.y0).toBeGreaterThan(card.y0);
            expect(board.y1).toBeLessThan(card.y1);
            // Ten columns by twenty rows of square cells.
            const cell = ((board.x1 - board.x0) * width) / BOARD_GRID.columns;
            expect(((board.y1 - board.y0) * height) / BOARD_GRID.rows).toBeCloseTo(cell, 6);
            // The playfield sits nearer the card's foot than its head.
            expect(card.y1 - board.y1).toBeLessThan(board.y0 - card.y0);
        }
    });

    it('maps columns and rows onto a board without allocating', () => {
        const board = {
            x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9,
        };
        const out = { x: 0, y: 0 };
        expect(boardPoint(board, 0.5, 9, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.5, 9);
        // Rows are measured to their centre line, one board-height / rows apart.
        const row = (board.y1 - board.y0) / BOARD_GRID.rows;
        expect(out.y).toBeCloseTo(board.y0 + row * 9.5, 9);
        const next = boardPoint(board, 0.5, 10);
        expect(next.y - out.y).toBeCloseTo(row, 9);
        // The floor row is the last one; anything past the grid is clamped onto it.
        const floor = boardPoint(board, 0.5, BOARD_GRID.rows - 1);
        expect(boardPoint(board, -3, 400)).toEqual({ x: board.x0, y: floor.y });
        expect(boardPoint(board, 0, -7).y).toBeCloseTo(board.y0 + row * 0.5, 9);
    });

    it('joins every card on screen into one rect', () => {
        const a = {
            x0: 0.05, y0: 0.2, x1: 0.3, y1: 0.8,
        };
        const b = {
            x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.7,
        };
        const c = {
            x0: 0.65, y0: 0.25, x1: 0.95, y1: 0.9,
        };
        const layout = {
            cardCount: 3, cards: [a, b, c], hud: null, boards: new Array(PLAYER_SLOTS).fill(null),
        };
        const union = cardUnion(layout);
        expect(union).toEqual({
            x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.9,
        });
        // A copy: the first card is not widened in place.
        expect(union).not.toBe(a);
        expect(a.x1).toBe(0.3);
        expect(cardUnion({ cards: [] })).toBeNull();
        expect(cardUnion(null)).toBeNull();
        // A board for a player who has none is the first board on screen.
        layout.boards[2] = b;
        expect(boardFor(layout, 2)).toBe(b);
        expect(boardFor(layout, 0)).toBe(b);
        layout.boards[2] = null;
        expect(boardFor(layout, 0)).toBeNull();
    });

    it('tells two layout reads apart only when a rect has really moved', () => {
        const base = fallbackLayout(1600, 900);
        const copy = () => JSON.parse(JSON.stringify(base));
        expect(layoutsDiffer(base, copy())).toBe(false);
        expect(layoutsDiffer(null, null)).toBe(false);
        expect(layoutsDiffer(base, null)).toBe(true);
        expect(layoutsDiffer(null, base)).toBe(true);

        // Sub-pixel jitter is the same layout; a real move is not.
        const jitter = copy();
        jitter.cards[0].x0 += 0.001;
        jitter.boards[0].y1 -= 0.001;
        expect(layoutsDiffer(base, jitter)).toBe(false);
        expect(layoutsDiffer(base, jitter, 0.0005)).toBe(true);
        const moved = copy();
        moved.cards[0].x0 += 0.02;
        expect(layoutsDiffer(base, moved)).toBe(true);

        const boardMoved = copy();
        boardMoved.boards[0].y0 += 0.05;
        expect(layoutsDiffer(base, boardMoved)).toBe(true);
        const secondBoard = copy();
        secondBoard.boards[3] = { ...base.boards[0] };
        expect(layoutsDiffer(base, secondBoard)).toBe(true);
        const noHud = copy();
        noHud.hud = null;
        expect(layoutsDiffer(base, noHud)).toBe(true);
        const counted = copy();
        counted.cardCount = 1;
        expect(layoutsDiffer(base, counted)).toBe(true);
        const twoCards = copy();
        twoCards.cards.push({ ...base.cards[0] });
        expect(layoutsDiffer(base, twoCards)).toBe(true);
    });
});

describe('lunara tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(POST_LOOK[name]).toBeTruthy();
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[QUALITY_NAMES[i]];
            for (const key of ['crystals', 'flowers', 'motes', 'shards', 'meteors', 'curtains', 'reflection']) {
                expect(b[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(a[key]);
            }
            const lookA = POST_LOOK[QUALITY_NAMES[i - 1]];
            const lookB = POST_LOOK[QUALITY_NAMES[i]];
            for (const key of ['shafts', 'msaa', 'bloomResolution']) {
                expect(lookB[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(lookA[key]);
            }
        }
    });

    it('never asks the plan for more than it lists, and keeps the picture and every event on every tier', () => {
        const heroes = plan.crystals.filter((crystal) => crystal.hero).length;
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(tier.crystals, name).toBeLessThanOrEqual(MAX_CRYSTALS);
            expect(tier.flowers, name).toBeLessThanOrEqual(MAX_FLORA);
            // The spires that frame the board, to send a wisp to...
            expect(tier.crystals, name).toBeGreaterThanOrEqual(heroes);
            // ...dust for them to throw, meteors for a four-line clear, a curtain of aurora.
            expect(tier.shards, name).toBeGreaterThan(0);
            expect(tier.meteors, name).toBeGreaterThan(0);
            expect(tier.curtains, name).toBeGreaterThan(0);
        }
    });

    it('ships the moon map the world asks for, at a path that survives file://', () => {
        expect(MOON_MAP_URL.startsWith('./textures/')).toBe(true); // relative: file:// in Electron
        expect(existsSync(path.join(repoRoot, 'public', MOON_MAP_URL)), MOON_MAP_URL).toBe(true);
    });
});
