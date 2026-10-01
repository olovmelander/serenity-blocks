import { createHash } from 'node:crypto';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { createWolfhourLandscape } from '../../src/themes/wolfhour/wolfhour-landscape.js';

const landscapes = [];
function create(options = {}) {
    const landscape = createWolfhourLandscape({ quality: 'High', seed: 73013, ...options });
    landscapes.push(landscape);
    return landscape;
}
function digest(landscape, attributeName) {
    const hash = createHash('sha256');
    for (const mesh of landscape.group.children) {
        const { array } = mesh.geometry.getAttribute(attributeName);
        hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    }
    return hash.digest('hex');
}
function renderedTriangles(landscape) {
    return landscape.group.children.reduce((count, mesh) => count + mesh.geometry.index.count / 3, 0);
}
function seededRandom(seed = 73013) {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

describe('Wolfhour alpine landscape', () => {
    afterEach(() => {
        for (const landscape of landscapes.splice(0)) landscape.dispose();
    });

    it('builds finite terrain with valid nondegenerate triangles and bounded light response', () => {
        const landscape = create();
        for (const mesh of landscape.group.children) {
            const { geometry } = mesh;
            const position = geometry.getAttribute('position');
            const indices = geometry.index.array;
            expect(indices.length % 3).toBe(0);
            for (const attributeName of ['position', 'normal', 'color', 'aMoonResponse']) {
                const attribute = geometry.getAttribute(attributeName);
                expect(attribute.count).toBe(position.count);
                expect(attribute.array.every(Number.isFinite)).toBe(true);
            }
            const response = geometry.getAttribute('aMoonResponse').array;
            expect(response.every((value) => value >= 0 && value <= 1)).toBe(true);
            expect(indices.every((index) => index >= 0 && index < position.count)).toBe(true);
            let minimumAreaSquared = Infinity;
            for (let i = 0; i < indices.length; i += 3) {
                const a = indices[i]; const b = indices[i + 1]; const c = indices[i + 2];
                const abX = position.getX(b) - position.getX(a);
                const abY = position.getY(b) - position.getY(a);
                const abZ = position.getZ(b) - position.getZ(a);
                const acX = position.getX(c) - position.getX(a);
                const acY = position.getY(c) - position.getY(a);
                const acZ = position.getZ(c) - position.getZ(a);
                const crossX = abY * acZ - abZ * acY;
                const crossY = abZ * acX - abX * acZ;
                const crossZ = abX * acY - abY * acX;
                minimumAreaSquared = Math.min(minimumAreaSquared, crossX ** 2 + crossY ** 2 + crossZ ** 2);
            }
            expect(minimumAreaSquared).toBeGreaterThan(0.000001);
        }
    });

    it('reproduces the same terrain and baked lighting from a seed', () => {
        const first = create();
        const repeat = create();
        const other = create({ seed: 91261 });
        expect(digest(repeat, 'position')).toBe(digest(first, 'position'));
        expect(digest(repeat, 'color')).toBe(digest(first, 'color'));
        expect(digest(other, 'position')).not.toBe(digest(first, 'position'));
    });

    it('keeps High within four opaque draws and 120,000 actual triangles, with cheaper Low geometry', () => {
        const high = create();
        const low = create({ quality: 'Low' });
        expect(high.group.children.length).toBeLessThanOrEqual(4);
        expect(high.group.children.every((mesh) => mesh.isMesh && !mesh.material.transparent)).toBe(true);
        expect(renderedTriangles(high)).toBeGreaterThan(0);
        expect(renderedTriangles(high)).toBeLessThanOrEqual(120000);
        expect(high.triangles).toBe(renderedTriangles(high));
        expect(renderedTriangles(low)).toBeLessThan(renderedTriangles(high));
        expect(low.vertices).toBeLessThan(high.vertices);
    });

    it.each([9 / 16, 16 / 9, 32 / 9])('covers the viewport at aspect %s without rebuilding', (aspect) => {
        const landscape = create({ quality: 'Low' });
        const geometries = landscape.group.children.map((mesh) => mesh.geometry);
        landscape.resize(aspect);
        expect(landscape.group.children.map((mesh) => mesh.geometry)).toEqual(geometries);
        const halfWidth = 500 * aspect;
        landscape.group.updateMatrixWorld(true);
        for (const mesh of landscape.group.children) {
            const { min, max } = new THREE.Box3().setFromObject(mesh);
            expect(min.x).toBeLessThanOrEqual(-halfWidth);
            expect(max.x).toBeGreaterThanOrEqual(halfWidth);
            expect(min.y).toBeLessThan(-500);
        }
    });

    it.each(['Low', 'High'])('places meteor impacts on a finite visible skyline for %s', (quality) => {
        const landscape = create({ quality });
        const bounds = new THREE.Box3().setFromObject(landscape.group);
        for (const x of [-100000, -600, 0, 500, 100000, NaN]) {
            const target = landscape.impactTarget(x);
            expect([target.x, target.y, target.z].every(Number.isFinite)).toBe(true);
            expect(target.x).toBeGreaterThanOrEqual(bounds.min.x);
            expect(target.x).toBeLessThanOrEqual(bounds.max.x);
            expect(target.y).toBeGreaterThan(-500);
            expect(target.y).toBeLessThanOrEqual(bounds.max.y + 0.001);
            expect(target.z).toBeGreaterThanOrEqual(bounds.min.z - 0.001);
            expect(target.z).toBeLessThanOrEqual(bounds.max.z + 0.001);
        }
        // Impacts stay on the visible shoulders outside the central board;
        // arbitrary multiplayer coordinates must not send them beyond the view.
        for (const x of [-100000, -10, 0, 10, 100000, NaN]) {
            const target = landscape.impactTarget(x);
            expect(Math.abs(target.x)).toBeGreaterThan(400);
            expect(Math.abs(target.x)).toBeLessThan(800);
            if (Number.isFinite(x) && x !== 0) expect(Math.sign(target.x)).toBe(Math.sign(x));
        }
    });

    it('detaches and releases every terrain buffer and the shared material', () => {
        const scene = new THREE.Scene();
        const landscape = create({ scene, quality: 'Low' });
        const released = new Set();
        const resources = new Set(landscape.group.children.flatMap((mesh) => [mesh.geometry, mesh.material]));
        resources.add(landscape.graniteTexture);
        for (const resource of resources) resource.addEventListener('dispose', () => released.add(resource));
        landscape.dispose();
        expect(scene.children).not.toContain(landscape.group);
        expect(released).toEqual(resources);
        landscapes.splice(landscapes.indexOf(landscape), 1);
    });

    it('honors world-space impact limits after portrait terrain scaling', () => {
        const landscape = create({ quality: 'Low' });
        landscape.resize(9 / 16);
        for (const x of [-10000, -30, 30, 10000]) {
            const target = landscape.impactTarget(x, { maxAbsX: 180 });
            expect([target.x, target.y, target.z].every(Number.isFinite)).toBe(true);
            expect(Math.abs(target.x)).toBeLessThanOrEqual(180);
            expect(Math.sign(target.x)).toBe(Math.sign(x));
        }
    });

    it('reproduces a distributed impact sequence from an injected random source', () => {
        const first = create({ quality: 'Low' });
        const repeat = create({ quality: 'Low' });
        const alternate = create({ quality: 'Low' });
        const geometryBefore = digest(first, 'position');
        const sequence = (landscape, random) => Array.from({ length: 24 }, () => landscape.randomImpactTarget(random));
        const targets = sequence(first, seededRandom());
        expect(sequence(repeat, seededRandom())).toEqual(targets);
        expect(sequence(alternate, seededRandom(51947))).not.toEqual(targets);
        const left = targets.filter(target => target.x < 0).map(target => target.x);
        const right = targets.filter(target => target.x > 0).map(target => target.x);
        expect(left.length).toBeGreaterThan(2);
        expect(right.length).toBeGreaterThan(2);
        expect(Math.max(...left) - Math.min(...left)).toBeGreaterThan(80);
        expect(Math.max(...right) - Math.min(...right)).toBeGreaterThan(80);
        expect(new Set(targets.map(target => target.x)).size).toBeGreaterThan(12);
        for (const target of targets) {
            expect([target.x, target.y, target.z].every(Number.isFinite)).toBe(true);
            expect(Math.abs(target.x)).toBeGreaterThan(400);
            expect(Math.abs(target.x)).toBeLessThan(800);
            expect(target).toEqual(first.impactTarget(target.x));
        }
        expect(digest(first, 'position')).toBe(geometryBefore);
    });

    it.each([0, 0.5, 0.999])('avoids the two most recent impact locations even with constant random input %s', (value) => {
        const landscape = create({ quality: 'Low' });
        const history = [];
        for (let index = 0; index < 12; index++) {
            const target = landscape.randomImpactTarget(() => value);
            for (const previous of history.slice(-2)) {
                // A neighborhood must be excluded, not only the exact previous
                // floating-point coordinate. No sampling formula is repeated here.
                expect(Math.abs(target.x - previous)).toBeGreaterThan(40);
            }
            history.push(target.x);
        }
    });

    it.each([9 / 16, 16 / 9, 32 / 9])('keeps randomized impacts finite and within world limits while moving at aspect %s', (aspect) => {
        const landscape = create({ quality: 'Low' });
        landscape.resize(aspect);
        const camera = new THREE.OrthographicCamera();
        const random = seededRandom();
        const localHistory = [];
        for (let index = 0; index < 18; index++) {
            camera.position.set(Math.sin(index * 0.8) * 64, Math.cos(index * 0.6) * 27, 1000);
            landscape.applyParallax(camera);
            const target = landscape.randomImpactTarget(random, { maxAbsX: 180 });
            expect([target.x, target.y, target.z].every(Number.isFinite)).toBe(true);
            expect(Math.abs(target.x)).toBeLessThanOrEqual(180.000001);
            const crest = landscape.impactTarget(target.x, { maxAbsX: 180 });
            expect(target.x).toBeCloseTo(crest.x, 8);
            expect(target.y).toBeCloseTo(crest.y, 8);
            expect(target.z).toBeCloseTo(crest.z, 8);
            landscape.group.updateMatrixWorld(true);
            const local = landscape.group.children[1].worldToLocal(new THREE.Vector3(target.x, target.y, target.z));
            for (const previous of localHistory.slice(-2)) {
                expect(Math.abs(local.x - previous)).toBeGreaterThan(0.001);
            }
            localHistory.push(local.x);
        }
    });

    it.each([16 / 9, 9 / 16])('moves each layer at its authored camera response at aspect %s', (aspect) => {
        const landscape = create({ quality: 'Low' });
        landscape.resize(aspect);
        const positionsBefore = digest(landscape, 'position');
        const camera = new THREE.OrthographicCamera();
        camera.position.set(60, -24, 1000);
        landscape.applyParallax(camera);
        landscape.group.updateMatrixWorld(true);
        const world = new THREE.Vector3();
        landscape.group.children.forEach((mesh, i) => {
            mesh.getWorldPosition(world);
            const response = landscape.parallaxResponse[i];
            // Projected displacement is object displacement minus camera displacement.
            expect(world.x - camera.position.x).toBeCloseTo(-camera.position.x * response, 8);
            expect(world.y - camera.position.y).toBeCloseTo(-camera.position.y * response, 8);
            expect(mesh.matrixAutoUpdate).toBe(false);
        });
        expect(digest(landscape, 'position')).toBe(positionsBefore);
        const beforeResize = landscape.group.children.map((mesh) => mesh.getWorldPosition(new THREE.Vector3()));
        landscape.resize(aspect * 0.9);
        landscape.group.updateMatrixWorld(true);
        landscape.group.children.forEach((mesh, i) => {
            mesh.getWorldPosition(world);
            expect(world.x).toBeCloseTo(beforeResize[i].x, 8);
            expect(world.y).toBeCloseTo(beforeResize[i].y, 8);
        });
    });

    it.each([16 / 9, 9 / 16])('keeps impacts attached to a moving baked crest at aspect %s', (aspect) => {
        const landscape = create({ quality: 'Low' });
        landscape.resize(aspect);
        const original = landscape.impactTarget(530 * landscape.group.scale.x);
        const camera = new THREE.OrthographicCamera();
        camera.position.set(-64, 27, 1000);
        landscape.applyParallax(camera);
        const offset = new THREE.Vector3();
        expect(landscape.getImpactOffset(offset)).toBe(offset);
        const moved = landscape.impactTarget(original.x + offset.x);
        expect(moved.x).toBeCloseTo(original.x + offset.x, 8);
        expect(moved.y).toBeCloseTo(original.y + offset.y, 8);
        expect(moved.z).toBeCloseTo(original.z + offset.z, 8);
        // The same offset lets an in-flight or landed effect follow the ridge without
        // rewriting the trajectory's buffer or changing its original surface anchor.
        const saved = offset.clone();
        camera.position.set(51, -12, 1000);
        landscape.applyParallax(camera);
        landscape.getImpactOffset(offset);
        const current = landscape.impactTarget(original.x + offset.x);
        expect(moved.x + offset.x - saved.x).toBeCloseTo(current.x, 8);
        expect(moved.y + offset.y - saved.y).toBeCloseTo(current.y, 8);
        for (const request of [-10000, -20, 20, 10000]) {
            const bounded = landscape.impactTarget(request, { maxAbsX: 170 });
            expect(Math.abs(bounded.x)).toBeLessThanOrEqual(170.000001);
            expect([bounded.x, bounded.y, bounded.z].every(Number.isFinite)).toBe(true);
        }
    });
});
