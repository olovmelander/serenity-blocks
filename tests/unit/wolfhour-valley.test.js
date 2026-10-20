import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { createWolfhourLandscape } from '../../src/themes/wolfhour/wolfhour-landscape.js';
import { MIST_BANKS, createWolfhourMist } from '../../src/themes/wolfhour/wolfhour-mist.js';
import { createWolfhourPack } from '../../src/themes/wolfhour/wolfhour-wolves.js';
import { createWolfhourHut, hutFlicker } from '../../src/themes/wolfhour/wolfhour-hut.js';
import { WOLFHOUR_PROPS, standWolfhourProps } from '../../src/themes/wolfhour/wolfhour-props.js';
import { WOLFHOUR_PALETTE, computeRange } from '../../src/themes/wolfhour/wolfhour-landscape-bake.js';
import { getWolfhourPostProfile } from '../../src/themes/wolfhour/wolfhour-post.js';

/**
 * Wolfhour's valley: the mist between the ranges, the pack on the right-hand spur, the hut with the
 * one warm light, and the cold, coloured night they sit in (not Cosmic Noir's black and white).
 */
const owners = [];
const own = (owner) => {
    owners.push(owner);
    return owner;
};
afterEach(() => {
    for (const owner of owners.splice(0).reverse()) owner.dispose();
});

describe('Wolfhour valley mist', () => {
    it.each([['Minimal', 1], ['Low', 2], ['High', 3]])('lays %s banks between the ranges', (quality, count) => {
        const mist = own(createWolfhourMist({ quality }));
        expect(mist.banks).toHaveLength(count);
        for (const bank of mist.banks) {
            expect(bank.material.transparent).toBe(true);
            expect(bank.material.depthWrite).toBe(false);
        }
        // Every bank lies between two ranges (z -1920, -1450, -965, -540), farthest first.
        for (const bank of MIST_BANKS) {
            expect(bank.z).toBeLessThan(-540);
            expect(bank.z).toBeGreaterThan(-1920);
        }
    });

    it('moves each bank by its share of the camera without accumulating', () => {
        const mist = own(createWolfhourMist({ quality: 'High' }));
        const camera = new THREE.OrthographicCamera();
        for (const [x, y] of [[40, -12], [-25, 30], [0, 0]]) {
            camera.position.set(x, y, 1000);
            mist.applyParallax(camera);
            for (const bank of mist.banks) {
                expect(bank.position.x).toBeCloseTo(x * (1 - bank.userData.response), 10);
                expect(bank.position.y).toBeCloseTo(bank.userData.baseY + y * (1 - bank.userData.response), 10);
            }
        }
    });

    it('releases its geometry, materials and its own noise tile', () => {
        const scene = new THREE.Scene();
        const mist = createWolfhourMist({ scene, quality: 'High' });
        const released = new Set();
        const resources = new Set(mist.banks.flatMap((bank) => [bank.geometry, bank.material]));
        for (const resource of resources) resource.addEventListener('dispose', () => released.add(resource));
        mist.dispose();
        expect(released).toEqual(resources);
        expect(scene.children).toEqual([]);
    });
});

describe('Wolfhour hut', () => {
    it('flickers by a few percent, far under a flash', () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let t = 0; t < 120; t += 0.01) {
            const f = hutFlicker(t);
            lo = Math.min(lo, f);
            hi = Math.max(hi, f);
        }
        expect(hi - lo).toBeLessThan(0.14);
        expect(lo).toBeGreaterThan(0.85);
        expect(hutFlicker(NaN)).toBeCloseTo(hutFlicker(0), 10);
    });

    it('keeps its warm light small and leaves the target alpha alone', () => {
        const hut = own(createWolfhourHut({ noiseMap: new THREE.DataTexture(new Uint8Array(4), 1, 1) }));
        const glow = hut.group.getObjectByName('Wolfhour hut glow');
        expect(glow.material.blending).toBe(THREE.AdditiveBlending);
        expect(glow.material.premultipliedAlpha).toBe(true);
        expect(glow.material.outputNode).toBeTruthy();
        expect(hut.group.getObjectByName('Wolfhour hut smoke')).toBeTruthy();
        const minimal = own(createWolfhourHut({ quality: 'Minimal' }));
        expect(minimal.group.getObjectByName('Wolfhour hut smoke')).toBeUndefined();
    });
});

describe('Wolfhour props on the ridge', () => {
    it.each([16 / 9, 9 / 16, 32 / 9])('stand the wolves where they belong, in proportion, at aspect %s', (aspect) => {
        const landscape = own(createWolfhourLandscape({ quality: 'Low', seed: 73013 }));
        const pack = own(createWolfhourPack({ quality: 'Low' }));
        const hut = own(createWolfhourHut({ quality: 'Low' }));
        const props = standWolfhourProps(landscape, { pack, hut });
        landscape.resize(aspect);
        props.settle();
        pack.update(20);
        const ranges = landscape.group.children;
        expect(pack.group.parent).toBe(ranges[WOLFHOUR_PROPS.pack.range]);
        expect(hut.group.parent).toBe(ranges[WOLFHOUR_PROPS.hut.range]);
        expect(pack.answerer.group.parent).toBe(ranges[WOLFHOUR_PROPS.answerer.range]);
        expect(pack.scout.group.parent).toBe(ranges[WOLFHOUR_PROPS.scout.range]);
        landscape.group.updateMatrixWorld(true);
        const world = new THREE.Vector3();
        const scale = new THREE.Vector3();
        for (const [group, at] of [[pack.group, WOLFHOUR_PROPS.pack], [pack.answerer.group, WOLFHOUR_PROPS.answerer]]) {
            group.getWorldScale(scale);
            // Proportions are kept whatever the stretch; a narrow screen gets slightly smaller wolves.
            expect(scale.x).toBeCloseTo(scale.y, 8);
            expect(scale.y).toBeLessThanOrEqual(at.scale + 1e-9);
            expect(scale.y).toBeGreaterThanOrEqual(at.scale * 0.7);
        }
        // A narrow screen's steep ridge holds two of the pack (three would crowd into one shape).
        const shown = pack.wolves.filter((entry) => entry.mesh.visible);
        expect(shown).toHaveLength(aspect < 1 ? 2 : 3);
        // Each shown wolf's paws rest on the crest under it, sunk a little into the rock.
        const spurs = ranges[WOLFHOUR_PROPS.pack.range];
        for (const entry of [...shown, pack.answerer.wolf]) {
            entry.mesh.getWorldPosition(world);
            expect(entry.mesh.parent.parent).toBe(spurs);
            const local = spurs.worldToLocal(world.clone());
            const crest = landscape.crestPoint(WOLFHOUR_PROPS.pack.range, local.x);
            const sink = crest.y - local.y;
            expect(sink).toBeGreaterThan(0);
            expect(sink).toBeLessThan(4);
        }
        // The pack stands right of the board; the hut and the answering wolf left of it.
        pack.group.getWorldPosition(world);
        expect(world.x).toBeGreaterThan(0);
        hut.group.getWorldPosition(world);
        expect(world.x).toBeLessThan(0);
        pack.answerer.group.getWorldPosition(world);
        expect(world.x).toBeLessThan(0);
    });

    it('leaves the terrain\'s own draws unchanged', () => {
        const landscape = own(createWolfhourLandscape({ quality: 'Low', seed: 73013 }));
        const before = landscape.group.children.length;
        standWolfhourProps(landscape, { pack: own(createWolfhourPack()), hut: own(createWolfhourHut()) });
        expect(landscape.group.children).toHaveLength(before);
    });
});

describe('Wolfhour\'s night is cold and coloured', () => {
    it('lights every range in blue moonlight, snow brighter than rock', () => {
        const {
            snowLit, snowShade, rockLit, rockShade,
        } = WOLFHOUR_PALETTE;
        for (const rgb of [snowLit, snowShade, rockLit, rockShade]) {
            expect(rgb[2]).toBeGreaterThan(rgb[1]);
            expect(rgb[1]).toBeGreaterThan(rgb[0]);
        }
        expect(snowLit[2]).toBeGreaterThan(rockLit[2] * 3);
        expect(snowShade[2]).toBeGreaterThan(rockShade[2] * 3);
        for (let index = 0; index < 4; index++) {
            const range = computeRange(index, 0.32, 73013);
            expect(range.surface.every((value) => value >= 0 && value <= 1)).toBe(true);
            // Snow and rock take the same moonlight; granite is a little darker in its crevices.
            for (let i = 0; i < range.light.length; i += 2) {
                expect(range.light[i]).toBeGreaterThan(0);
                expect(range.light[i]).toBeLessThanOrEqual(1);
                expect(range.light[i + 1]).toBeLessThanOrEqual(range.light[i] + 1e-6);
            }
        }
    });

    it('keeps the scene\'s colour through the grade on every tier', () => {
        for (const tier of ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']) {
            const profile = getWolfhourPostProfile(tier);
            expect(profile.saturation).toBeGreaterThanOrEqual(0.9);
            expect(profile.tintDesaturation).toBeLessThanOrEqual(0.15);
        }
    });
});
