import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    ODYSSEY_CHARM_ICON_IDS, ODYSSEY_CHARM_STUDIO_LIGHTS, ODYSSEY_CHARM_STUDIO_RANGE, ODYSSEY_CHARM_STUDIO_SPIN,
    ODYSSEY_CHARM_STUDIO_WIDTH, bakeOdysseyCharmStudio, createOdysseyCharmIcon, createOdysseyCharmStudio,
} from '../../src/rendering/odyssey/odyssey-charm-icons.js';

/** The baked radiance along a direction (azimuth and elevation in degrees), decoded. */
function radianceAt(data, width, az, el) {
    const H = width >> 1;
    const lon = (az * Math.PI) / 180;
    const lat = (el * Math.PI) / 180;
    // The bake lays longitude along x from -pi (az measured from the camera's side) and latitude up the rows.
    const dx = Math.cos(lat) * Math.sin(lon);
    const dz = Math.cos(lat) * Math.cos(lon);
    const i = Math.floor((Math.atan2(dz, dx) / (Math.PI * 2) + 0.5) * width) % width;
    const j = Math.min(H - 1, Math.floor((lat / Math.PI + 0.5) * H));
    const at = (j * width + i) * 4;
    const decode = (byte) => ((byte / 255) ** 2.2) * ODYSSEY_CHARM_STUDIO_RANGE;
    return [decode(data[at]), decode(data[at + 1]), decode(data[at + 2]), data[at + 3]];
}

describe('The charm studio', () => {
    it('bakes the same small dark room with its lights every time, row 0 the nadir', () => {
        const width = ODYSSEY_CHARM_STUDIO_WIDTH;
        const data = bakeOdysseyCharmStudio(width);
        expect(data).toHaveLength(width * (width >> 1) * 4);
        expect(bakeOdysseyCharmStudio(width)).toEqual(data);
        const key = ODYSSEY_CHARM_STUDIO_LIGHTS.find((light) => light.rgb[0] === 6);
        const inKey = radianceAt(data, width, key.az, key.el);
        const overhead = radianceAt(data, width, 0, 89);
        const behind = radianceAt(data, width, 180, 50);
        const nadir = radianceAt(data, width, 0, -89);
        // The key is the brightest thing in the room, warm; the softbox overhead is cool and broad; the
        // room behind, between the lights, is dark indigo; the floor a shade lighter than the sky.
        expect(inKey[0]).toBeGreaterThan(5);
        expect(inKey[0]).toBeGreaterThan(inKey[2]);
        expect(overhead[2]).toBeGreaterThan(1.5);
        expect(overhead[2]).toBeGreaterThan(overhead[0]);
        expect(behind[0]).toBeLessThan(0.1);
        expect(behind[2]).toBeGreaterThan(behind[0]);
        expect(nadir[2]).toBeGreaterThan(behind[2]);
        // The horizon band is lit all the way round.
        [0, 90, 180, 270].forEach((az) => expect(radianceAt(data, width, az, -1.5)[2]).toBeGreaterThan(1.5));
        // Opaque throughout.
        expect(data.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
        // A smaller bake keeps the same room.
        expect(radianceAt(bakeOdysseyCharmStudio(64), 64, key.az, key.el)[0]).toBeGreaterThan(5);
    });

    it('is a mip-mapped, repeating equirectangular byte texture the icons share or are handed', () => {
        const studio = createOdysseyCharmStudio();
        expect(studio).toBeInstanceOf(THREE.DataTexture);
        expect(studio.image.width).toBe(ODYSSEY_CHARM_STUDIO_WIDTH);
        expect(studio.image.height).toBe(ODYSSEY_CHARM_STUDIO_WIDTH / 2);
        expect(studio.generateMipmaps).toBe(true);
        expect(studio.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(studio.wrapS).toBe(THREE.RepeatWrapping);
        expect(studio.flipY).toBe(false);
        expect(studio.colorSpace).toBe(THREE.NoColorSpace);
        const icon = createOdysseyCharmIcon('tide', { studio });
        expect(icon.group.children).toHaveLength(2);
        icon.dispose();
        studio.dispose();
    });
});

describe('The charm icons as metal', () => {
    it('build every charm on basic materials that reflect the studio, turning it as time passes', () => {
        ODYSSEY_CHARM_ICON_IDS.forEach((id) => {
            const icon = createOdysseyCharmIcon(id);
            const materials = new Set();
            icon.group.traverse((node) => { if (node.isMesh) materials.add(node.material); });
            expect(materials.size).toBeGreaterThanOrEqual(3);
            materials.forEach((material) => {
                expect(material.isMeshBasicNodeMaterial).toBe(true);
                expect(material.colorNode).toBeTruthy();
            });
            expect(icon.uniforms.uSpin.value).toBe(0);
            icon.update(2);
            expect(icon.uniforms.uSpin.value).toBeCloseTo(2 * ODYSSEY_CHARM_STUDIO_SPIN);
            icon.setState('used');
            expect(icon.uniforms.uDim.value).toBe(1);
            icon.dispose();
        });
        // The hourglass holds its glass: see-through, drawn last, both faces.
        const breath = createOdysseyCharmIcon('long-breath');
        const glass = [];
        breath.group.traverse((node) => { if (node.isMesh && node.material.transparent) glass.push(node); });
        expect(glass).toHaveLength(2);
        glass.forEach((bulb) => {
            expect(bulb.renderOrder).toBe(1);
            expect(bulb.material.side).toBe(THREE.DoubleSide);
            expect(bulb.material.depthWrite).toBe(false);
            expect(bulb.material.opacityNode).toBeTruthy();
        });
        breath.dispose();
    });
});
