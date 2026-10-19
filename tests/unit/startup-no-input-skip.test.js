/**
 * Player input never skips the opening: a click, tap or key while the ident and warp play is
 * ignored (it used to cut straight to the main menu), and the title's own "Press any key" prompt
 * is the only way on once it shows.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createStartupPipelineController } from '../../src/ui/startup-pipeline-controller.js';
import { resetStartupProgressForTests } from '../../src/ui/startup-progress.js';

describe('early input during the opening', () => {
    let target;
    beforeEach(() => {
        target = new EventTarget();
        vi.spyOn(target, 'addEventListener');
        vi.stubGlobal('window', target);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        resetStartupProgressForTests();
    });

    it('installs no skip-on-input listener and the intro keeps running', () => {
        const introAnimation = { skip: vi.fn() };
        const pipeline = createStartupPipelineController({ introAnimation, watchdogMs: 60000 });
        pipeline.start();
        pipeline.markAppReady();
        pipeline.markMenuReady();
        pipeline.markIntroRunning({ mode: 'interactive' });

        const inputTypes = target.addEventListener.mock.calls.map(([type]) => type);
        expect(inputTypes).not.toContain('pointerdown');
        expect(inputTypes).not.toContain('touchstart');
        expect(inputTypes).not.toContain('keydown');

        target.dispatchEvent(new Event('pointerdown'));
        target.dispatchEvent(new Event('keydown'));
        expect(pipeline.snapshot().introStatus).toBe('running');
        expect(pipeline.snapshot().menuVisible).toBe(false);
        expect(introAnimation.skip).not.toHaveBeenCalled();
        pipeline.dispose();
    });
});
