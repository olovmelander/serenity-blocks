import { describe, expect, it } from 'vitest';
import { createBootStageCoordinator } from '../../src/utils/boot-stage-coordinator.js';

describe('boot stage coordinator', () => {
    it('resolves waiters when a stage is marked', async () => {
        const coordinator = createBootStageCoordinator();
        const menuReadyPromise = coordinator.waitFor('menu-ready');

        coordinator.mark('core-ready', { source: 'test' });
        coordinator.mark('intro-started');
        coordinator.mark('menu-ready', { source: 'test' });

        await expect(menuReadyPromise).resolves.toMatchObject({
            stage: 'menu-ready',
            detail: { source: 'test' },
        });
    });

    it('ignores duplicate stage marks without changing order', () => {
        const coordinator = createBootStageCoordinator();

        const first = coordinator.mark('core-ready');
        const duplicate = coordinator.mark('core-ready');

        expect(first.duplicate).toBe(false);
        expect(duplicate.duplicate).toBe(true);
        expect(coordinator.getCompletedStages()).toHaveLength(1);
        expect(coordinator.getCompletedStages()[0].stage).toBe('core-ready');
    });
});
