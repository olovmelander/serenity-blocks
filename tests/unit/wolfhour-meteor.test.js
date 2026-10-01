import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createWolfhourMeteor, setWolfhourRibbon } from '../../src/themes/wolfhour/wolfhour-meteor.js';

const meteors = [];
function create() {
    const meteor = createWolfhourMeteor();
    meteors.push(meteor);
    return meteor;
}
function endpoint(geometry, u) {
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const vertices = [];
    for (let i = 0; i < position.count; i++) {
        if (uv.getX(i) === u) vertices.push(new THREE.Vector3().fromBufferAttribute(position, i));
    }
    return {
        center: vertices[0].clone().add(vertices[1]).multiplyScalar(0.5),
        width: vertices[0].clone().sub(vertices[1]),
    };
}

describe('Wolfhour meteor ribbon', () => {
    afterEach(() => {
        for (const meteor of meteors.splice(0)) {
            meteor.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
        }
    });

    it.each([
        [1, 0], [-1, 0], [1, -0.35], [-1, -0.35],
        [1, 0.7], [-1, 0.7], [1, -Math.PI / 2], [-1, -Math.PI / 2],
    ])('keeps the luminous UV end at the head and the tail behind it for direction %s, angle %s', (direction, angle) => {
        const meteor = create();
        const geometry = meteor.userData.trail.geometry;
        const head = new THREE.Vector3(321, 174, -1860);
        const velocity = new THREE.Vector3(Math.cos(angle) * direction, Math.sin(angle), 0);
        setWolfhourRibbon(geometry, head.x, head.y, head.z, angle, direction, 250);
        const front = endpoint(geometry, 1);
        const tail = endpoint(geometry, 0);
        expect(geometry.getAttribute('position').count).toBe(4);
        expect(geometry.getAttribute('position').array.every(Number.isFinite)).toBe(true);
        expect(front.center.distanceTo(head)).toBeLessThan(0.0001);
        const travel = front.center.clone().sub(tail.center);
        expect(travel.length()).toBeCloseTo(250, 3);
        expect(travel.clone().normalize().dot(velocity)).toBeCloseTo(1, 5);
        expect(Math.abs(front.width.dot(velocity))).toBeLessThan(0.0001);
        expect(front.width.length()).toBeGreaterThan(0);
        expect(front.width.dot(tail.width)).toBeGreaterThan(0);
        expect(front.center.z).toBe(head.z);
        expect(tail.center.z).toBe(head.z);
    });

    it('updates the same four-vertex GPU buffer and preserves finite geometry through a direction change', () => {
        const geometry = create().userData.trail.geometry;
        const position = geometry.getAttribute('position');
        const array = position.array;
        setWolfhourRibbon(geometry, 10, 20, -1700, -0.4, 1, 220);
        const firstVersion = position.version;
        setWolfhourRibbon(geometry, -20, 40, -1700, -0.4, -1, 180);
        expect(geometry.getAttribute('position')).toBe(position);
        expect(position.array).toBe(array);
        expect(position.version).toBeGreaterThan(firstVersion);
        expect(position.array.every(Number.isFinite)).toBe(true);
        expect(endpoint(geometry, 1).center.x).toBeCloseTo(-20);
    });
});
