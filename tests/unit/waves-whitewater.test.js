/**
 * Waves — the white water where the lip lands (waves-whitewater.js), and what the water lays
 * under it (waves-water.js).
 *
 * The puffs are closed form in the vertex stage, so what is tested here is what the CPU hands
 * them: how many a tier pays for, which kind each is and where along its line, that they cover
 * what is behind them (they are not light added to the frame), and that they are drawn after the
 * water and before the light. The world eases the number that makes them heave: that is in
 * waves-events.test.js.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
    BURST_RISE, ROLL_REACH, WHITE_WATER_KINDS, createWhiteWater,
} from '../../src/themes/waves/waves-whitewater.js';
import { LANDED_WHOLE, LANDING_ARC, createWater } from '../../src/themes/waves/waves-water.js';
import { createLipRain, createMist } from '../../src/themes/waves/waves-spray.js';
import {
    createFoamLace, createLight, createWaterNoise, createWaveShape,
} from '../../src/themes/waves/waves-tsl.js';
import { REST_RIG } from '../../src/themes/waves/waves-composition.js';
import { HOURS, HOUR_COLOURS } from '../../src/themes/waves/waves-hours.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/waves/waves-quality.js';
import {
    DEG, WAVE, landingDistance, lipAngle, wavePoint,
} from '../../src/themes/waves/waves-core.js';

const made = [];

afterEach(() => {
    for (const thing of made.splice(0)) thing.dispose();
    vi.restoreAllMocks();
});

function uniforms() {
    return {
        time: uniform(0),
        sun: uniform(new THREE.Vector3(-0.5, 0.1, -0.86).normalize()),
        warm: uniform(0),
        open: uniform(0),
        bulge: uniform(new THREE.Vector4(-60, 0, 5, 0)),
        tear: uniform(0),
        heave: uniform(0),
        glowing: uniform(0),
        sea: uniform(new THREE.Vector4(0.3, 0, 0, 0.15)),
        light: createLight(uniformArray(HOUR_COLOURS.map((key) => new THREE.Vector4(...HOURS[0][key], 0)), 'vec4')),
    };
}

function build(quality = 'High', seed = 187) {
    const U = uniforms();
    const shape = createWaveShape(U);
    const noise = createWaterNoise(32);
    const part = createWhiteWater({
        tier: tierFor(quality), U, shape, noise, seed,
    });
    made.push(part, noise);
    return part;
}

const seedsOf = (part) => Array.from(part.mesh.geometry.getAttribute('aSeed').array);
const kindsOf = (part) => Array.from(part.mesh.geometry.getAttribute('aKind').array);

describe('waves white water: the puffs', () => {
    it('gives every tier its puffs, never fewer than the tier below, and a few of each kind at the leanest', () => {
        let last = 0;
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            expect(Number.isInteger(tier.whitewater), quality).toBe(true);
            expect(tier.whitewater, quality).toBeGreaterThanOrEqual(last);
            last = tier.whitewater;
            const part = build(quality);
            expect(part.count, quality).toBe(tier.whitewater);
            expect(part.mesh.geometry.instanceCount, quality).toBe(tier.whitewater);
            const kinds = kindsOf(part);
            expect(kinds, quality).toHaveLength(tier.whitewater);
            for (const kind of [0, 1, 2]) {
                expect(kinds.filter((k) => k === kind).length, `${quality}, kind ${kind}`).toBeGreaterThanOrEqual(3);
            }
            expect(seedsOf(part).every((s) => s >= 0 && s <= 1), quality).toBe(true);
        }
        // The leanest tier still has the whole picture; the richest is not a fog of sprites.
        expect(QUALITY.Minimal.whitewater).toBeGreaterThanOrEqual(WHITE_WATER_KINDS.length);
        expect(QUALITY.Extreme.whitewater).toBeLessThanOrEqual(96);
    });

    it('is half the roll, three in ten the burst and the rest mist, each kind spread evenly along its own line', () => {
        expect(Object.isFrozen(WHITE_WATER_KINDS)).toBe(true);
        const share = (kind) => WHITE_WATER_KINDS.filter((k) => k === kind).length / WHITE_WATER_KINDS.length;
        expect(share(0)).toBeCloseTo(0.5, 9);
        expect(share(1)).toBeCloseTo(0.3, 9);
        expect(share(2)).toBeCloseTo(0.2, 9);
        // No two of a kind stand next to each other in the table more than it must (a tier that
        // cuts the table short keeps the mix).
        expect(new Set(WHITE_WATER_KINDS.slice(0, 4)).size).toBe(3);
        for (const quality of ['Minimal', 'High', 'Extreme']) {
            const part = build(quality);
            const seeds = seedsOf(part);
            const kinds = kindsOf(part);
            for (const kind of [0, 1, 2]) {
                const along = kinds.map((k, i) => (k === kind ? seeds[i * 4] : null)).filter((x) => x !== null);
                along.forEach((x, j) => {
                    expect(x, `${quality}, kind ${kind}, puff ${j}`).toBeGreaterThanOrEqual(j / along.length - 1e-6);
                    expect(x, `${quality}, kind ${kind}, puff ${j}`).toBeLessThanOrEqual((j + 1) / along.length + 1e-6);
                });
            }
        }
    });

    it('covers what is behind it: drawn over, premultiplied, after the water and before the light', () => {
        const U = uniforms();
        const shape = createWaveShape(U);
        const noise = createWaterNoise(32);
        const lace = createFoamLace(32);
        const tier = tierFor('Low');
        const white = createWhiteWater({
            tier, U, shape, noise,
        });
        const rows = {
            rings: uniformArray([new THREE.Vector4()], 'vec4'),
            ribbons: uniformArray([new THREE.Vector4(), new THREE.Vector4()], 'vec4'),
            bands: uniformArray(Array.from({ length: 8 }, () => new THREE.Vector4(-100, 0, 4, 0)), 'vec4'),
        };
        const water = createWater({
            tier,
            noise,
            lace,
            U: {
                ...U, counts: uniform(new THREE.Vector4()), ripple: uniform(1), glow: uniform(0), heat: uniform(0),
            },
            shape,
            rows,
        });
        const rain = createLipRain({ tier, U, shape });
        const mist = createMist({
            tier, U, shape, noise,
        });
        made.push(white, water, rain, mist, noise, lace);
        const { material } = white.mesh;
        expect(material.isNodeMaterial).toBe(true);
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(material.depthTest).toBe(true);
        // Not light added to the frame (over an evening sea as bright as itself that shows nothing).
        expect(material.blending).toBe(THREE.NormalBlending);
        expect(material.premultipliedAlpha).toBe(true);
        expect(material.fog).toBe(false);
        expect(white.mesh.frustumCulled).toBe(false);
        expect(white.mesh.renderOrder).toBeGreaterThan(water.mesh.renderOrder);
        expect(white.mesh.renderOrder).toBeLessThan(mist.mesh.renderOrder);
        expect(white.mesh.renderOrder).toBeLessThan(rain.mesh.renderOrder);
    });

    it('is the same for the same seed, another for another, and frees what it made', () => {
        const one = build('Medium', 187);
        const twin = build('Medium', 187);
        const other = build('Medium', 5);
        expect(seedsOf(twin)).toEqual(seedsOf(one));
        expect(kindsOf(twin)).toEqual(kindsOf(one));
        expect(seedsOf(other)).not.toEqual(seedsOf(one));
        const scene = new THREE.Scene();
        const part = createWhiteWater({
            tier: tierFor('Low'), U: uniforms(), shape: createWaveShape(uniforms()), noise: createWaterNoise(32),
        });
        scene.add(part.mesh);
        const geometry = vi.spyOn(part.mesh.geometry, 'dispose');
        const material = vi.spyOn(part.mesh.material, 'dispose');
        part.dispose();
        expect(geometry).toHaveBeenCalledOnce();
        expect(material).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
    });
});

describe('waves white water: where it stands', () => {
    it('rolls along the foot of the landed curtain, on screen ahead of the eye', () => {
        // The roll runs back from the touchdown along the line the lip stands on: all of it where
        // the lip has landed, none of it behind the eye.
        const touchdown = landingDistance(0);
        expect(ROLL_REACH).toBeGreaterThan(1.5);
        expect(touchdown + 0.15 - ROLL_REACH).toBeGreaterThan(0);
        for (let d = touchdown - ROLL_REACH; d <= touchdown; d += 0.25) {
            expect(lipAngle(d, 0), `d ${d}`).toBeCloseTo(WAVE.lipClosed, 6);
            // The foot of the curtain: a hand above the trough, left of the foot of the face.
            const foot = wavePoint(1, d, 0);
            expect(foot.y).toBeLessThan(0.3);
            expect(foot.x).toBeLessThan(-1);
        }
    });

    it('throws the touchdown about as high as the eye at rest, and over it when the lip throws', () => {
        const [low, high] = BURST_RISE.rest;
        expect(low).toBeGreaterThan(0.3);
        expect(high).toBeGreaterThan(low);
        // At rest it stays under the line of the horizon (the sun and its road stay clear)...
        expect(high).toBeLessThan(REST_RIG.eye.y);
        // ...and a clear throws it over the eye.
        expect(BURST_RISE.heave).toBeGreaterThan(1.3);
        expect(high * BURST_RISE.heave).toBeGreaterThan(REST_RIG.eye.y);
        expect(Object.isFrozen(BURST_RISE)).toBe(true);
    });

    it('closes the lip\'s tears as it lands: a curtain standing on the sea, torn only where it still falls', () => {
        // The water's shader and the lip's rain read the same two numbers.
        expect(LANDING_ARC).toBeGreaterThan(0.2);
        expect(LANDING_ARC).toBeLessThan(1);
        expect(LANDED_WHOLE).toBeGreaterThan(0.7);
        expect(LANDED_WHOLE).toBeLessThan(1);
        // Where it has closed (from the touchdown back past the eye) the tears are all but shut;
        // two metres ahead of the touchdown the lip is still in the air and torn as it was.
        const smooth = (a, b, x) => {
            const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
            return t * t * (3 - 2 * t);
        };
        const landed = (d) => smooth(WAVE.lipClosed - LANDING_ARC, WAVE.lipClosed - 0.04, lipAngle(d, 0));
        const touchdown = landingDistance(0);
        expect(landed(touchdown)).toBe(1);
        expect(landed(0)).toBe(1);
        expect(landed(touchdown + 0.5)).toBeGreaterThan(0.4);
        expect(landed(touchdown + 2)).toBeLessThan(0.05);
        expect(landed(touchdown + 6)).toBe(0);
        // The arc it lands over is the last of the fall: the edge is within a metre and a half of
        // the sea when the tears begin to close.
        const start = WAVE.lipClosed - LANDING_ARC;
        expect(WAVE.b * (1 - Math.cos(start))).toBeLessThan(1.5);
        expect(start).toBeGreaterThan(270 * DEG);
    });
});
