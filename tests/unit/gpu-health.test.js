import { describe, expect, it } from 'vitest';
import { classifyGpuHealth } from '../../electron/gpu-health.js';

describe('GPU health classification', () => {
    it('marks software rendering as unsafe', () => {
        const health = classifyGpuHealth({
            adapters: [{
                active: true,
                vendor: 'Google',
                name: 'SwiftShader Device',
                driverVendor: 'Google',
                driverVersion: '1.0',
            }],
            gpuFeatureStatus: {
                gpu_compositing: 'disabled_software',
                webgl: 'enabled_readback',
                webgl2: 'unavailable_software',
            },
            activeWebGLRenderer: 'Google SwiftShader',
            angleBackend: 'd3d11',
        });

        expect(health.status).toBe('unsafe');
        expect(health.reasons).toContain('software_renderer_active');
        expect(health.reasons.some((reason) => reason.startsWith('gpu_compositing_'))).toBe(true);
    });

    it('marks hybrid systems using the integrated adapter as degraded when discrete preference is requested', () => {
        const health = classifyGpuHealth({
            adapters: [
                {
                    active: true,
                    vendor: 'Intel',
                    name: 'Intel Iris Xe',
                    driverVendor: 'Intel',
                    driverVersion: '31.0',
                },
                {
                    active: false,
                    vendor: 'NVIDIA',
                    name: 'RTX 3070 Laptop GPU',
                    driverVendor: 'NVIDIA',
                    driverVersion: '566.36',
                },
            ],
            gpuFeatureStatus: {
                gpu_compositing: 'enabled',
                webgl: 'enabled',
                webgl2: 'enabled',
            },
            activeWebGLRenderer: 'ANGLE (Intel, Intel Iris Xe, D3D11)',
            preferDiscreteGpu: true,
            angleBackend: 'd3d11',
        });

        expect(health.status).toBe('degraded');
        expect(health.reasons).toContain('hybrid_gpu_not_using_discrete_adapter');
        expect(health.activeAdapter?.vendor).toBe('Intel');
    });

    it('keeps a healthy hardware GPU path green', () => {
        const health = classifyGpuHealth({
            adapters: [{
                active: true,
                vendor: 'NVIDIA',
                name: 'RTX 3070 Laptop GPU',
                driverVendor: 'NVIDIA',
                driverVersion: '566.36',
            }],
            gpuFeatureStatus: {
                gpu_compositing: 'enabled',
                webgl: 'enabled',
                webgl2: 'enabled',
            },
            activeWebGLRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
            preferDiscreteGpu: true,
            angleBackend: 'd3d11',
        });

        expect(health.status).toBe('healthy');
        expect(health.reasons).toEqual([]);
        expect(health.driverVersion).toBe('566.36');
    });
});
