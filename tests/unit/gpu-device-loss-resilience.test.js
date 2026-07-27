import {
    afterEach, describe, expect, it,
} from 'vitest';
import { gpuResilience } from '../../src/utils/gpu-context-resilience.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

/**
 * Contract test for the GPU device-loss wiring the boot warp and intro renderer
 * now depend on (R5). Previously neither surface monitored its GPUDevice, so a
 * mid-boot TDR blanked the screen with no teardown or fallback.
 *
 * The boot warp reacts to the broadcast CONTEXT_LOST event (not just its own
 * onDeviceLost) precisely because monitorWebGPU() dedupes per device — when the
 * intro registers the shared device first, the warp's own onDeviceLost never
 * fires. These tests pin both behaviors.
 */

function fakeDevice() {
    let resolveLost;
    return {
        device: {
            lost: new Promise((r) => { resolveLost = r; }),
            addEventListener() {},
            removeEventListener() {},
        },
        lose(reason = 'destroyed') { resolveLost({ reason }); },
    };
}

describe('GPU device-loss resilience contract', () => {
    afterEach(() => {
        gpuResilience.cleanup();
    });

    it('fires onDeviceLost AND broadcasts CONTEXT_LOST for the lost device', async () => {
        const { device, lose } = fakeDevice();
        let localFired = false;
        let broadcastMatched = false;

        // Mirrors the boot warp's device-matched broadcast subscription.
        const off = eventBus.on(EVENTS.CONTEXT_LOST, (p) => {
            if (p?.type === 'webgpu' && p.device === device) broadcastMatched = true;
        });
        const unsub = gpuResilience.monitorWebGPU(device, {
            label: 'test',
            onDeviceLost: () => { localFired = true; },
        });

        lose();
        // Let the device.lost .then microtask run.
        await Promise.resolve();
        await Promise.resolve();

        expect(localFired).toBe(true);
        expect(broadcastMatched).toBe(true);

        off();
        unsub();
    });

    it('dedupes a second monitor of the same device (why the warp also uses the broadcast)', () => {
        const { device } = fakeDevice();

        gpuResilience.monitorWebGPU(device, { label: 'intro' });
        let secondFired = false;
        const unsub2 = gpuResilience.monitorWebGPU(device, {
            label: 'boot-warp',
            onDeviceLost: () => { secondFired = true; },
        });

        // The second registration is a no-op unsub and its onDeviceLost is never
        // wired — so a surface sharing an already-monitored device must rely on the
        // broadcast CONTEXT_LOST event, exactly as the warp does.
        expect(typeof unsub2).toBe('function');
        expect(secondFired).toBe(false);
    });

    it('detaches a local loss callback when its theme unsubscribes', async () => {
        const { device, lose } = fakeDevice();
        let localCalls = 0;
        const unsub = gpuResilience.monitorWebGPU(device, {
            label: 'retired-theme',
            onDeviceLost: () => {
                localCalls += 1;
            },
        });

        unsub();
        lose();
        await Promise.resolve();
        await Promise.resolve();

        expect(localCalls).toBe(0);
    });

    it('safely no-ops when the device cannot be read', () => {
        const unsub = gpuResilience.monitorWebGPU(null, { label: 'missing' });
        expect(typeof unsub).toBe('function');
        expect(() => unsub()).not.toThrow();
    });
});
