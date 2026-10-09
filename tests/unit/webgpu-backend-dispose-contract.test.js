/**
 * three r186: disposing a WebGPU renderer is asynchronous, in a fixed order.
 *
 * Renderer.dispose() awaits its backend; WebGPUBackend.dispose() awaits the base Backend's
 * disposal (which awaits each timestamp query pool) and only then destroys the device it owns.
 * Everything in this repo that retires a renderer (BaseTheme.disposeRenderer, the theme
 * runtimes that call it) is written to that order. Read from node_modules/three, so a bump that
 * changes it fails here (ADR-0018).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const threeSource = (file) => readFileSync(
    new URL(`../../node_modules/three/src/renderers/${file}`, import.meta.url),
    'utf8',
);

describe('three r186 WebGPU backend disposal contract', () => {
    it('WebGPUBackend.dispose awaits base disposal before destroying the owned device', () => {
        const backendSource = threeSource('webgpu/WebGPUBackend.js');
        const disposeStart = backendSource.lastIndexOf('\tasync dispose()');
        const disposeEnd = backendSource.indexOf('\n\t}', disposeStart);
        expect(disposeStart).toBeGreaterThan(-1);
        expect(disposeEnd).toBeGreaterThan(disposeStart);
        const body = backendSource.slice(disposeStart, disposeEnd);
        expect(body).toMatch(/await super\.dispose\(\);[\s\S]*this\.device\.destroy\(\)/);
        expect(threeSource('common/Backend.js')).toContain('await queryPool.dispose();');
        expect(threeSource('common/Renderer.js')).toContain('await this.backend.dispose();');
    });
});
