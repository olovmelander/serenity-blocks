import { describe, expect, it } from 'vitest';
import { waitForStartupStep } from '../../src/ui/startup-pipeline-state-machine.js';

describe('already-aborted startup steps', () => {
    it('observes rejection of work already started before the abort check', async () => {
        const controller = new AbortController();
        const cancelled = new Error('startup was skipped');
        controller.abort(cancelled);
        let rejectStep;
        const step = new Promise((_resolve, reject) => { rejectStep = reject; });

        await expect(waitForStartupStep(step, controller.signal)).rejects.toBe(cancelled);
        rejectStep(new Error('late renderer initialization failure'));
        // An abandoned rejection would escape as a runner-level unhandled error.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    });

    it('reports a live step failure normally', async () => {
        const controller = new AbortController();
        const error = new Error('renderer initialization failed');
        await expect(waitForStartupStep(Promise.reject(error), controller.signal)).rejects.toBe(error);
    });
});
