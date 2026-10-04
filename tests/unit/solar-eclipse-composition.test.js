import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    PerspectiveCamera, Scene, SphereGeometry, Vector3,
} from 'three';
import { applySolarEclipsePortraitFit } from '../../src/themes/solar-eclipse/solar-eclipse-composition.js';
import SolarEclipseTheme from '../../src/themes/solar-eclipse/solar-eclipse-theme.js';

function projectedExtent(camera, radius, y, z) {
    const geometry = new SphereGeometry(radius, 64, 32);
    const positions = geometry.attributes.position;
    const point = new Vector3();
    let extent = 0;
    for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index);
        point.y += y;
        point.z += z;
        point.project(camera);
        extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
    }
    geometry.dispose();
    return extent;
}

function capturedCamera(aspect) {
    const camera = new PerspectiveCamera(60, aspect, 0.1, 100000);
    camera.position.set(-170.4123, -119.2669, 851.7279);
    camera.rotation.set(0.2519586, -0.1929670, 0.0493276);
    camera.updateMatrixWorld();
    return camera;
}

beforeEach(() => {
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844, location: { search: '' } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Solar Eclipse responsive composition', () => {
    it('confirms the captured portrait solar limbs were clipped before fitting', () => {
        const camera = capturedCamera(390 / 844);
        expect(projectedExtent(camera, 350, 0, -100)).toBeGreaterThan(1);
        expect(applySolarEclipsePortraitFit(camera)).toBeGreaterThan(0);
        expect(projectedExtent(camera, 350, 0, -100)).toBeLessThanOrEqual(0.90001);
        expect(projectedExtent(camera, 320, 25, 50)).toBeLessThanOrEqual(0.90001);
    });

    it.each([320 / 932, 390 / 844, 430 / 932])('fits aligned silhouettes throughout orbit for aspect=%s', (aspect) => {
        const camera = new PerspectiveCamera(60, aspect, 0.1, 100000);
        for (let index = 0; index < 16; index += 1) {
            const phase = (index * Math.PI) / 8;
            camera.position.set(Math.sin(phase) * 350 + 100, Math.cos(phase) * 195 - 50, 850 + Math.sin(phase) * 120);
            camera.lookAt(Math.sin(phase * 0.4) * 150 + 40, Math.cos(phase * 0.5) * 100 - 20, 0);
            const position = camera.position.clone();
            const quaternion = camera.quaternion.clone();
            const zoom = applySolarEclipsePortraitFit(camera);
            expect(zoom).toBeGreaterThanOrEqual(0.05);
            expect(zoom).toBeLessThanOrEqual(1);
            expect(projectedExtent(camera, 350, 0, -100)).toBeLessThanOrEqual(0.90001);
            expect(projectedExtent(camera, 320, 25, 50)).toBeLessThanOrEqual(0.90001);
            expect(camera.position.equals(position)).toBe(true);
            expect(camera.quaternion.equals(quaternion)).toBe(true);
            expect(camera.fov).toBe(60);
        }
    });

    it('restores exact desktop projection after rotation and repeats the portrait fit', () => {
        const camera = capturedCamera(390 / 844);
        const portraitZoom = applySolarEclipsePortraitFit(camera);
        camera.aspect = 844 / 390;
        camera.updateProjectionMatrix();
        expect(applySolarEclipsePortraitFit(camera)).toBe(1);
        const expected = capturedCamera(844 / 390);
        expect(camera.projectionMatrix.elements).toEqual(expected.projectionMatrix.elements);
        camera.aspect = 390 / 844;
        camera.updateProjectionMatrix();
        expect(applySolarEclipsePortraitFit(camera)).toBe(portraitZoom);
    });

    it.each([1, 16 / 9, 21 / 9])('leaves authored desktop framing exact for aspect=%s', (aspect) => {
        const camera = capturedCamera(aspect);
        const projection = camera.projectionMatrix.clone();
        expect(applySolarEclipsePortraitFit(camera)).toBe(1);
        expect(camera.projectionMatrix.equals(projection)).toBe(true);
    });

    it('fits the production orbital frame before rendering', () => {
        const theme = new SolarEclipseTheme();
        theme.isActive = true;
        theme.scene = new Scene();
        theme.camera = capturedCamera(390 / 844);
        theme.renderer = { clear: vi.fn(), render: vi.fn() };
        vi.spyOn(theme.clock, 'getDelta').mockReturnValue(1 / 60);
        let frame;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            frame = callback;
            return 1;
        }));
        theme.startAnimation();
        frame();
        expect(theme.renderer.render).toHaveBeenCalledWith(theme.scene, theme.camera);
        expect(theme.camera.zoom).toBeLessThan(1);
        expect(projectedExtent(theme.camera, 350, 0, -100)).toBeLessThanOrEqual(0.90001);
    });

    it('updates the live production fit through portrait and landscape resize', () => {
        const theme = new SolarEclipseTheme();
        theme.camera = capturedCamera(16 / 9);
        theme.renderer = { setSize: vi.fn() };
        theme.resize(390, 844);
        expect(projectedExtent(theme.camera, 350, 0, -100)).toBeLessThanOrEqual(0.90001);
        theme.resize(844, 390);
        expect(theme.camera.zoom).toBe(1);
        expect(theme.camera.projectionMatrix.elements).toEqual(capturedCamera(844 / 390).projectionMatrix.elements);
        expect(theme.renderer.setSize).toHaveBeenLastCalledWith(844, 390);
    });

    it('gives the authored Points tendrils a defined, bounded size at the scene pixel ratio', () => {
        const theme = new SolarEclipseTheme();
        theme.scene = new Scene();
        theme.renderer = { getPixelRatio: () => 0.5 };
        theme.createSolarTendrils();
        expect(theme.solarTendrils.isPoints).toBe(true);
        expect(theme.solarTendrils.geometry.attributes.position.count).toBe(600);
        expect(theme.solarTendrils.material.uniforms.uPixelRatio.value).toBe(0.5);
        expect(theme.solarTendrils.material.vertexShader).toContain('uniform float uPixelRatio;');
        expect(theme.solarTendrils.material.vertexShader).toMatch(/gl_PointSize\s*=\s*clamp\(/);
        expect(theme.solarTendrils.material.vertexShader).toContain('max(1.0, 12.0 * uPixelRatio)');
    });
});
