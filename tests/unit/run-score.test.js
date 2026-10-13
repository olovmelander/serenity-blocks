/** saveRunScore keeps a storage failure from ending the results flow (audit SCORE-05). */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { saveRunScore } from '../../src/core/progression/run-score.js';

afterEach(() => vi.restoreAllMocks());

describe('saveRunScore', () => {
    it('reports a saved score', async () => {
        const addScore = vi.fn().mockResolvedValue({ id: 1 });
        await expect(saveRunScore({ addScore }, { score: 10 })).resolves.toBe(true);
        expect(addScore).toHaveBeenCalledWith({ score: 10 });
    });

    it('logs and reports a failed save instead of rejecting', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new DOMException('Disk full', 'QuotaExceededError');
        await expect(saveRunScore({ addScore: vi.fn().mockRejectedValue(failure) }, { score: 10 }, '[Infinity]'))
            .resolves.toBe(false);
        expect(error).toHaveBeenCalledWith('[Infinity] Could not save the score on this device:', failure);
    });
});
