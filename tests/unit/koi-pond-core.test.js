import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    DEG, NOISE_SIZE, POND, POND_LENGTH, POND_WIDTH, TAU, angleDelta, approach, bakeNoise, basinWeight, clamp, clamp01,
    groundHeight, hash2, lerp, mulberry32, pieceLight, pondUV, sampleNoise, shoreDistance, shoreZ, smooth, waterDepth,
} from '../../src/themes/koi-pond/koi-pond-core.js';
import {
    BOARD_GRID, PLAYER_SLOTS, REST_RIG, boardFor, boardPoint, cardUnion, distanceForAspect, fallbackLayout,
    fovForAspect, layoutsDiffer, restEye,
} from '../../src/themes/koi-pond/koi-pond-composition.js';

const noise = bakeNoise();

/** The camera the composition is measured in: over the near water, looking down at the pond's middle. */
function restCamera(aspect) {
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const eye = restEye(aspect);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
}

/** Where the ray through a screen point (NDC) meets the water plane, or null if it never does. */
function onWater(camera, nx, ny) {
    const ray = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position);
    if (!(ray.y < -1e-6)) return null;
    const t = -camera.position.y / ray.y;
    return { x: camera.position.x + ray.x * t, z: camera.position.z + ray.z * t };
}

describe('koi pond core maths', () => {
    it('clamps, mixes and eases between two edges given in either order', () => {
        expect(clamp(5, 0, 2)).toBe(2);
        expect(clamp(-5, 0, 2)).toBe(0);
        expect(clamp01(1.4)).toBe(1);
        expect(clamp01(-0.1)).toBe(0);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        expect(smooth(2, 4, 2.5)).toBeCloseTo(0.15625, 12);
        // Falling edges: the same curve, mirrored.
        expect(smooth(1, 0, 0.25)).toBeCloseTo(smooth(0, 1, 0.75), 12);
        expect(smooth(1, 0, 3)).toBe(0);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const value = smooth(0, 1, i / 20);
            expect(value).toBeGreaterThan(previous);
            previous = value;
        }
    });

    it('eases at the same rate whatever the frame time', () => {
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, -1)).toBe(0);
        expect(approach(3, 1e9)).toBe(1);
        // Two half steps leave what one whole step leaves.
        const half = approach(2.2, 1 / 120);
        expect(1 - (1 - half) ** 2).toBeCloseTo(approach(2.2, 1 / 60), 12);
        expect(approach(8, 0.1)).toBeGreaterThan(approach(2, 0.1));
    });

    it('turns the short way round between two headings', () => {
        expect(angleDelta(0.1, 0.4)).toBeCloseTo(0.3, 12);
        expect(angleDelta(0.1, TAU - 0.1)).toBeCloseTo(-0.2, 12);
        expect(angleDelta(TAU - 0.1, 0.1)).toBeCloseTo(0.2, 12);
        expect(angleDelta(1, 1 + 5 * TAU)).toBeCloseTo(0, 9);
        for (let i = -40; i <= 40; i++) {
            const delta = angleDelta(i * 0.37, i * -1.13 + 0.2);
            expect(delta).toBeGreaterThanOrEqual(-Math.PI);
            expect(delta).toBeLessThanOrEqual(Math.PI);
        }
        expect(DEG * 180).toBeCloseTo(Math.PI, 12);
    });

    it('seeds a repeatable generator and a repeatable hash', () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        const c = mulberry32(8);
        let differs = false;
        for (let i = 0; i < 50; i++) {
            const value = a();
            expect(value).toBe(b());
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
            if (value !== c()) differs = true;
        }
        expect(differs).toBe(true);
        // Every caller hashes counts (a flower, a petal, a lattice cell): no two of those collide.
        const seen = new Set();
        for (let i = 0; i < 24; i++) {
            for (let j = 0; j < 24; j++) {
                const value = hash2(i, j);
                expect(value).toBe(hash2(i, j));
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(1);
                seen.add(value);
            }
        }
        expect(seen.size).toBe(24 * 24);
        expect(hash2(3, 91)).toBe(hash2(3.7, 91.2)); // whole numbers only: fractions are dropped
    });

    it('turns a piece\'s colour into light of full strength, and anything else into moon white', () => {
        expect(pieceLight('#ff0000')).toEqual([1, 0, 0]);
        // Every piece strikes the pond equally hard: the brightest channel is always 1.
        const pieces = [
            '#ffc852', '#ffadd2', '#7dffb8', '#ff7b52', '#7b94ff', '#ffe48a', '#7eeeff', '#0f1f1a', '#404040',
        ];
        for (const hex of pieces) {
            const light = pieceLight(hex);
            expect(Math.max(...light), hex).toBeCloseTo(1, 12);
            expect(Math.min(...light), hex).toBeGreaterThanOrEqual(0);
        }
        // Scene-linear: a mid grey in the weaker channels falls well below half.
        const koi = pieceLight('#ff7b52');
        expect(koi[0]).toBe(1);
        expect(koi[1]).toBeCloseTo(((0x7b / 255 + 0.055) / 1.055) ** 2.4, 9);
        expect(koi[2]).toBeLessThan(koi[1]);
        expect(pieceLight('#FF7B52')).toEqual(koi);
        // It writes into the array it is given.
        const out = [9, 9, 9];
        expect(pieceLight('#00ff00', out)).toBe(out);
        expect(out).toEqual([0, 1, 0]);
        // Black has no hue to keep: no channel blows up.
        expect(pieceLight('#000000').every((channel) => Number.isFinite(channel))).toBe(true);
        for (const nonsense of [null, undefined, 'teal', '#fff', 'ff7b52', 0xff7b52, '#ff7b5g', {}]) {
            expect(pieceLight(nonsense, [0, 0, 0]), String(nonsense)).toEqual([0.75, 0.88, 1]);
        }
    });
});

describe('koi pond: the lie of the pond', () => {
    it('runs the far waterline across the top of the picture and curves it toward the viewer at both ends', () => {
        const middle = shoreZ(0);
        expect(middle).toBeLessThan(-2.5);
        expect(shoreZ(-10)).toBeGreaterThan(middle + 3);
        expect(shoreZ(10)).toBeGreaterThan(middle + 3);
        // The whole waterline lies inside the rectangle the waves are simulated over.
        for (let x = POND.minX; x <= POND.maxX; x += 0.1) {
            expect(shoreZ(x)).toBeGreaterThan(POND.minZ);
            expect(shoreZ(x)).toBeLessThan(POND.maxZ);
            expect(shoreDistance(x, shoreZ(x))).toBeCloseTo(0, 12);
            // Positive out in the pond, negative up the bank, never more than the straight gap.
            expect(shoreDistance(x, shoreZ(x) + 1.5)).toBeGreaterThan(0);
            expect(shoreDistance(x, shoreZ(x) + 1.5)).toBeLessThanOrEqual(1.5);
            expect(shoreDistance(x, shoreZ(x) - 1.5)).toBeLessThan(0);
        }
    });

    it('holds water everywhere inside the waterline and none on the bank', () => {
        let wet = 0;
        let dry = 0;
        for (let x = POND.minX; x <= POND.maxX; x += 0.2) {
            for (let z = POND.minZ; z <= POND.maxZ; z += 0.2) {
                const from = shoreDistance(x, z);
                const depth = waterDepth(x, z);
                expect(Number.isFinite(groundHeight(x, z))).toBe(true);
                if (from > 1e-6) {
                    wet += 1;
                    expect(depth, `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBeGreaterThan(0);
                    expect(depth).toBeCloseTo(-groundHeight(x, z), 12);
                } else if (from < -1e-6) {
                    dry += 1;
                    expect(depth, `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(0);
                    expect(groundHeight(x, z), `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBeGreaterThanOrEqual(0);
                }
            }
        }
        // Most of the rectangle is water; the far bank and its two horns are land.
        expect(wet).toBeGreaterThan(dry);
        expect(dry).toBeGreaterThan(wet / 10);
    });

    it('meets the bank at the waterline: the bed comes up to y = 0 there, with no step', () => {
        // "The ground: y of the bed under the water (negative) and of the bank above it (positive),
        // meeting at y = 0 on the waterline."
        const steps = [];
        for (let x = POND.minX; x <= POND.maxX + 1e-9; x += 0.25) {
            const z = shoreZ(x);
            const wet = groundHeight(x, z + 1e-5);
            const bank = groundHeight(x, z - 1e-5);
            expect(Math.abs(bank), `the bank at x=${x}`).toBeLessThan(1e-3);
            if (Math.abs(wet) > 0.01) {
                steps.push(`x=${x.toFixed(2)}: the bed is at ${wet.toFixed(3)} m a hair inside the waterline`);
            }
        }
        expect(steps).toEqual([]);
    });

    it('shelves gently from the bank before it deepens', () => {
        // A hand's breadth out from the waterline the water is ankle deep at most, wherever the basin is not under it.
        for (let x = POND.minX; x <= POND.maxX; x += 0.5) {
            const z = shoreZ(x);
            const near = waterDepth(x, z + 0.1);
            const further = waterDepth(x, z + 1.2);
            expect(further, `x=${x}`).toBeGreaterThan(near);
            if (basinWeight(x, z + 0.1) < 0.01) expect(near, `x=${x}`).toBeLessThan(0.1);
        }
    });

    it('is deepest in the basin under the board card', () => {
        const { basin } = POND;
        expect(basinWeight(basin.x, basin.z)).toBe(1);
        expect(basinWeight(basin.x + basin.radiusX, basin.z)).toBeLessThan(0.5);
        expect(basinWeight(basin.x + 3 * basin.radiusX, basin.z)).toBeLessThan(0.001);
        // The card floats over the pond's middle: the basin lies under it.
        expect(Math.abs(basin.x)).toBeLessThan(0.5);
        expect(basin.x - basin.radiusX).toBeGreaterThan(POND.minX);
        expect(basin.z + basin.radiusZ).toBeLessThan(POND.maxZ);
        let deepest = { depth: 0, x: 0, z: 0 };
        const centre = waterDepth(basin.x, basin.z);
        for (let x = POND.minX; x <= POND.maxX; x += 0.1) {
            for (let z = POND.minZ; z <= POND.maxZ; z += 0.1) {
                const depth = waterDepth(x, z);
                if (depth > deepest.depth) deepest = { depth, x, z };
                // Away from the basin the bed is a shelf a koi's length down, no more.
                const away = Math.hypot((x - basin.x) / basin.radiusX, (z - basin.z) / basin.radiusZ);
                if (away > 1.6) expect(depth, `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(centre * 0.5);
            }
        }
        expect(centre).toBeGreaterThan(basin.depth);
        expect(deepest.depth).toBeGreaterThanOrEqual(centre);
        expect(Math.hypot(deepest.x - basin.x, deepest.z - basin.z)).toBeLessThan(0.6);
    });

    it('maps the simulated rectangle onto the unit square', () => {
        expect(POND_WIDTH).toBe(POND.maxX - POND.minX);
        expect(POND_LENGTH).toBe(POND.maxZ - POND.minZ);
        expect(pondUV(POND.minX, POND.minZ)).toEqual({ u: 0, v: 0 });
        expect(pondUV(POND.maxX, POND.maxZ)).toEqual({ u: 1, v: 1 });
        const middle = pondUV((POND.minX + POND.maxX) / 2, (POND.minZ + POND.maxZ) / 2);
        expect(middle.u).toBeCloseTo(0.5, 12);
        expect(middle.v).toBeCloseTo(0.5, 12);
        const out = { u: 9, v: 9 };
        expect(pondUV(0, 0, out)).toBe(out);
        expect(out.u).toBeCloseTo(-POND.minX / POND_WIDTH, 12);
        expect(out.v).toBeCloseTo(-POND.minZ / POND_LENGTH, 12);
        for (let x = POND.minX; x <= POND.maxX; x += 1.1) {
            for (let z = POND.minZ; z <= POND.maxZ; z += 1.1) {
                const uv = pondUV(x, z);
                expect(uv.u).toBeGreaterThanOrEqual(0);
                expect(uv.u).toBeLessThanOrEqual(1);
                expect(uv.v).toBeGreaterThanOrEqual(0);
                expect(uv.v).toBeLessThanOrEqual(1);
            }
        }
    });

    it.each([
        ['21:9', 21 / 9], ['16:9', 16 / 9], ['16:10', 16 / 10], ['4:3', 4 / 3], ['1:1', 1], ['9:16', 9 / 16],
        ['9:19.5', 9 / 19.5],
    ])('simulates all the water the rest camera sees on a %s screen', (label, aspect) => {
        // "Everything the camera can see of the pond lies inside it." (To within a few centimetres:
        // beyond the rectangle the surface texture repeats its last row.)
        const camera = restCamera(aspect);
        const slack = 0.05;
        const outside = [];
        for (let i = 0; i <= 8; i++) {
            const along = (i / 8) * 2 - 1;
            for (const [nx, ny] of [[along, -1], [along, 1], [-1, along], [1, along]]) {
                const hit = onWater(camera, nx, ny);
                if (hit && waterDepth(hit.x, hit.z) > 0 && (hit.x < POND.minX - slack || hit.x > POND.maxX + slack
                    || hit.z < POND.minZ - slack || hit.z > POND.maxZ + slack)) {
                    const seen = `(${hit.x.toFixed(2)}, ${hit.z.toFixed(2)})`;
                    outside.push(`screen (${nx.toFixed(2)}, ${ny.toFixed(2)}) sees water at ${seen}`);
                }
            }
        }
        expect(outside).toEqual([]);
    });
});

describe('koi pond noise field', () => {
    it('bakes four channels of bytes, the same every time, and another field for another seed', () => {
        expect(noise).toBeInstanceOf(Uint8Array);
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const again = bakeNoise();
        expect(Buffer.from(again).equals(Buffer.from(noise))).toBe(true);
        expect(Buffer.from(bakeNoise(5)).equals(Buffer.from(noise))).toBe(false);
        // Each channel is stretched over the byte range and is not flat.
        for (let channel = 0; channel < 4; channel++) {
            let lo = 255;
            let hi = 0;
            let sum = 0;
            for (let i = channel; i < noise.length; i += 4) {
                lo = Math.min(lo, noise[i]);
                hi = Math.max(hi, noise[i]);
                sum += noise[i];
            }
            expect(lo, `channel ${channel}`).toBeLessThan(30);
            expect(hi, `channel ${channel}`).toBeGreaterThan(225);
            const mean = sum / (NOISE_SIZE * NOISE_SIZE);
            expect(mean, `channel ${channel}`).toBeGreaterThan(90);
            expect(mean, `channel ${channel}`).toBeLessThan(165);
        }
        // A smaller field can be asked for.
        expect(bakeNoise(20261008, 32)).toHaveLength(32 * 32 * 4);
    });

    it('tiles: no seam where the field wraps', () => {
        const last = NOISE_SIZE - 1;
        for (let channel = 0; channel < 4; channel++) {
            const at = (i, j) => noise[(j * NOISE_SIZE + i) * 4 + channel];
            const step = (i0, j0, i1, j1) => Math.abs(at(i0, j0) - at(i1, j1));
            let seam = 0;
            let inside = 0;
            for (let k = 0; k < NOISE_SIZE; k++) {
                seam = Math.max(seam, step(0, k, last, k), step(k, 0, k, last));
                for (let i = 1; i < NOISE_SIZE; i++) {
                    inside = Math.max(inside, step(i, k, i - 1, k), step(k, i, k, i - 1));
                }
            }
            // The step across the wrap is no bigger than the steps between neighbours anywhere else.
            expect(seam, `channel ${channel}`).toBeLessThanOrEqual(inside);
        }
    });

    it('rises in frequency from the first channel to the last', () => {
        const roughness = [0, 1, 2, 3].map((channel) => {
            let sum = 0;
            for (let j = 0; j < NOISE_SIZE; j++) {
                for (let i = 1; i < NOISE_SIZE; i++) {
                    const at = (j * NOISE_SIZE + i) * 4 + channel;
                    sum += Math.abs(noise[at] - noise[at - 4]);
                }
            }
            return sum;
        });
        expect(roughness[1]).toBeGreaterThan(roughness[0]);
        expect(roughness[2]).toBeGreaterThan(roughness[1]);
        expect(roughness[3]).toBeGreaterThan(roughness[2]);
    });

    it('reads the field bilinearly and wraps at its edges', () => {
        for (const [u, v] of [[0.3, 0.7], [0.999, 0.001], [0, 0], [0.5, 0.25]]) {
            for (let channel = 0; channel < 4; channel++) {
                const value = sampleNoise(noise, u, v, channel);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
                expect(sampleNoise(noise, u + 1, v - 1, channel)).toBeCloseTo(value, 9);
                expect(sampleNoise(noise, u - 3, v + 2, channel)).toBeCloseTo(value, 9);
            }
        }
        // At a texel centre it returns the texel; half way to the next, the mean of the two.
        const texel = (i, j, channel) => noise[(j * NOISE_SIZE + i) * 4 + channel] / 255;
        expect(sampleNoise(noise, 10.5 / NOISE_SIZE, 20.5 / NOISE_SIZE, 2)).toBeCloseTo(texel(10, 20, 2), 9);
        const between = (texel(10, 20, 2) + texel(11, 20, 2)) / 2;
        expect(sampleNoise(noise, 11 / NOISE_SIZE, 20.5 / NOISE_SIZE, 2)).toBeCloseTo(between, 9);
        // The first channel is the default; a field of another size reads by its own size.
        expect(sampleNoise(noise, 0.3, 0.7)).toBe(sampleNoise(noise, 0.3, 0.7, 0));
        const small = bakeNoise(3, 32);
        expect(sampleNoise(small, 4.5 / 32, 7.5 / 32, 1, 32)).toBeCloseTo(small[(7 * 32 + 4) * 4 + 1] / 255, 9);
    });
});

describe('koi pond composition', () => {
    it('holds its horizontal view, clamped for very wide and very tall frames', () => {
        const free = (aspect) => (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / aspect)) / DEG;
        expect(fovForAspect(16 / 9)).toBeCloseTo(free(16 / 9), 9);
        expect(fovForAspect(16 / 9)).toBeGreaterThan(REST_RIG.minFov);
        expect(fovForAspect(16 / 9)).toBeLessThan(REST_RIG.maxFov);
        expect(fovForAspect(4 / 3)).toBeGreaterThan(fovForAspect(16 / 9));
        expect(fovForAspect(32 / 9)).toBe(REST_RIG.minFov);
        expect(fovForAspect(9 / 19.5)).toBe(REST_RIG.maxFov);
        for (const aspect of [0, -1, 0.01, 0.2, 0.5, 1, 2, 4, 40]) {
            expect(fovForAspect(aspect)).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fovForAspect(aspect)).toBeLessThanOrEqual(REST_RIG.maxFov);
        }
        // Nonsense falls back to a 16:9 frame.
        expect(fovForAspect(NaN)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(undefined)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(Infinity)).toBe(fovForAspect(16 / 9));
    });

    it('stands further back for a tall screen, and never nearer than the landscape rig', () => {
        expect(distanceForAspect(16 / 9)).toBe(REST_RIG.distance);
        expect(distanceForAspect(21 / 9)).toBe(REST_RIG.distance);
        expect(distanceForAspect(4 / 3)).toBe(REST_RIG.distance);
        expect(distanceForAspect(9 / 16)).toBeGreaterThan(REST_RIG.distance * 1.2);
        expect(distanceForAspect(9 / 19.5)).toBeGreaterThan(distanceForAspect(9 / 16));
        let previous = Infinity;
        for (let aspect = 0.2; aspect <= 3; aspect += 0.05) {
            const distance = distanceForAspect(aspect);
            expect(distance).toBeLessThanOrEqual(previous);
            expect(distance).toBeGreaterThanOrEqual(REST_RIG.distance);
            expect(distance).toBeLessThan(REST_RIG.distance * 1.5);
            previous = distance;
        }
        for (const nonsense of [NaN, undefined, Infinity]) expect(distanceForAspect(nonsense)).toBe(REST_RIG.distance);
        // The far plane clears the whole pond from the furthest the eye ever stands.
        expect(REST_RIG.far).toBeGreaterThan(distanceForAspect(0.2) + Math.hypot(POND_WIDTH, POND_LENGTH));
    });

    it('stands the eye over the near water, looking steeply down at the pond\'s middle', () => {
        for (const aspect of [21 / 9, 16 / 9, 1, 9 / 19.5]) {
            const eye = restEye(aspect);
            expect(eye.x).toBe(0);
            expect(eye.y).toBeGreaterThan(0);
            expect(eye.z).toBeGreaterThan(0); // on the viewer's side of the middle
            expect(Math.hypot(eye.y, eye.z)).toBeCloseTo(distanceForAspect(aspect), 12);
            expect(Math.atan2(eye.y, eye.z) / DEG).toBeCloseTo(REST_RIG.pitch, 9);
            // The near plane is above the water, the pond's middle in front of the lens.
            expect(eye.y).toBeGreaterThan(REST_RIG.near * 2);
            const centre = new THREE.Vector3(0, 0, 0).project(restCamera(aspect));
            expect(centre.x).toBeCloseTo(0, 9);
            expect(centre.y).toBeCloseTo(0, 9);
        }
        const out = { x: 5, y: 5, z: 5 };
        expect(restEye(16 / 9, out)).toBe(out);
        expect(out.x).toBe(0);
        expect(REST_RIG.pitch).toBeGreaterThan(40); // steeply down: the picture is water, not sky
        expect(REST_RIG.pitch).toBeLessThan(90);
    });

    it('shows the far bank along the top of a landscape picture and open water either side of the card', () => {
        const camera = restCamera(16 / 9);
        const layout = fallbackLayout(1600, 900);
        const card = layout.cards[0];
        // The far waterline at the pond's middle is in the frame, above the centre.
        const shore = new THREE.Vector3(0, 0, shoreZ(0)).project(camera);
        expect(shore.y).toBeGreaterThan(0.3);
        expect(shore.y).toBeLessThan(1);
        // Left and right of the card there is water to swim in, and the basin lies behind the card.
        for (const side of [-1, 1]) {
            const beside = onWater(camera, side * ((card.x1 - card.x0) + 0.25), 0);
            expect(waterDepth(beside.x, beside.z)).toBeGreaterThan(0.4);
        }
        const basin = new THREE.Vector3(POND.basin.x, 0, POND.basin.z).project(camera);
        expect(basin.x * 0.5 + 0.5).toBeGreaterThan(card.x0);
        expect(basin.x * 0.5 + 0.5).toBeLessThan(card.x1);
        expect(0.5 - basin.y * 0.5).toBeGreaterThan(card.y0);
        expect(0.5 - basin.y * 0.5).toBeLessThan(card.y1);
    });

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
            expect(layout.hud.x0).toBeGreaterThan(card.x1);
        }
        // A degenerate size still gives finite rects.
        const tiny = fallbackLayout(0, NaN);
        for (const rect of [tiny.cards[0], tiny.boards[0], tiny.hud]) {
            for (const value of Object.values(rect)) expect(Number.isFinite(value)).toBe(true);
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
