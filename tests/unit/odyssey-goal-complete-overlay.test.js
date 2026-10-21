import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createGoalCompleteOverlay } from '../../src/ui/odyssey/GoalCompleteOverlay.js';
import { createOdysseyFlowDom } from '../helpers/odyssey-flow-dom.js';

describe('Odyssey goal complete banner', () => {
    beforeEach(() => {
        const dom = createOdysseyFlowDom();
        vi.stubGlobal('document', dom.document);
        vi.stubGlobal('window', dom.window);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('announces the goal politely with its Finish keys for keyboard and controller', () => {
        const banner = createGoalCompleteOverlay();
        expect(banner.id).toBe('goal-complete-overlay');
        expect(banner.className).toBe('sb-goal-banner');
        expect(banner.role).toBe('status');
        expect(banner.innerHTML).toContain('<p class="goal-complete-title">Goal complete</p>');
        expect(banner.innerHTML).toContain('<p class="goal-complete-subtitle">Keep playing for more stars</p>');
        // odyssey-showcase-input.js relabels or hides the first [data-pad] cap: there is exactly one.
        expect(banner.innerHTML.match(/data-pad/g)).toHaveLength(1);
        expect(banner.innerHTML).toMatch(/<kbd class="sb-kbd" data-key>Enter<\/kbd>/);
        expect(banner.innerHTML).toMatch(/data-pad>View \/ Back<\/kbd> Finish<\/p>/);
        expect(banner.innerHTML).toContain('class="sb-goal-banner__mark" aria-hidden="true"');
    });
});
