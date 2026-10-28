/**
 * The lane chapter builds take while the map is on screen (perf audit 2026-10-28): a budget of
 * steps per frame, one build at a time with the urgent ones first, a hold while the board may not
 * build, `hurry` for a chapter the camera is about to show, and a clean drop on teardown.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { ChapterBuildLane } from '../../src/rendering/odyssey/chapter-build-lane.js';

/** A lane on a fake clock: every step "takes" `stepMs`, and turns run when the test says. */
function createLane({ budgetMs = 3, stepMs = 1, canRun = () => true } = {}) {
    let now = 0;
    const turns = [];
    const lane = new ChapterBuildLane({
        canRun,
        budgetMs: typeof budgetMs === 'function' ? budgetMs : () => budgetMs,
        now: () => now,
        schedule: (run, delayMs = 0) => turns.push({ run, delayMs }),
    });
    const log = [];
    function* steps(name, count, result = name) {
        for (let i = 0; i < count; i += 1) {
            log.push(`${name}${i}`);
            now += stepMs;
            yield;
        }
        log.push(`${name}:done`);
        return result;
    }
    const turn = () => {
        const next = turns.shift();
        next?.run();
        return next;
    };
    return {
        lane, steps, log, turn, turns,
    };
}

describe('ChapterBuildLane', () => {
    it('runs a build a budget of steps per turn, a frame between turns', async () => {
        const {
            lane, steps, log, turn,
        } = createLane({ budgetMs: 3, stepMs: 1 });
        const done = lane.run(1, steps('a', 7), { finish: (v) => `built:${v}` });
        expect(log).toEqual([]); // nothing runs inside run()
        turn();
        expect(log).toEqual(['a0', 'a1', 'a2']);
        turn();
        expect(log).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
        turn();
        expect(log.slice(-2)).toEqual(['a6', 'a:done']);
        await expect(done).resolves.toBe('built:a');
        expect(lane.size).toBe(0);
    });

    it('builds one at a time, an urgent build ahead of the background ones', async () => {
        const {
            lane, steps, log, turn,
        } = createLane({ budgetMs: 2 });
        lane.run(1, steps('a', 4));
        lane.run(6, steps('b', 2));
        lane.run(7, steps('c', 2), { urgent: true });
        turn();
        expect(log).toEqual(['c0', 'c1']);
        turn();
        expect(log.slice(2)).toEqual(['c:done', 'a0', 'a1']);
        expect(lane.promote(6)).toBe(true);
        turn();
        expect(log.slice(5)).toEqual(['b0', 'b1']);
        expect(lane.promote(99)).toBe(false);
    });

    it('waits while the board may not build, then picks up where it was', () => {
        let allowed = false;
        const {
            lane, steps, log, turn, turns,
        } = createLane({ canRun: () => allowed });
        lane.run(1, steps('a', 3));
        turn();
        expect(log).toEqual([]);
        expect(turns[0].delayMs).toBeGreaterThan(0); // asks again a little later, not every frame
        allowed = true;
        turn();
        expect(log).toEqual(['a0', 'a1', 'a2']);
    });

    it('hands the gate the build: a background one waits out a glide, an urgent one does not', () => {
        let gliding = true;
        const {
            lane, steps, log, turn,
        } = createLane({ canRun: ({ urgent }) => urgent || !gliding });
        lane.run(1, steps('a', 2));
        turn();
        expect(log).toEqual([]);
        lane.run(6, steps('b', 1), { urgent: true });
        turn();
        expect(log).toEqual(['b0', 'b:done']); // the urgent one ran; the background one stopped at the gate
        gliding = false;
        turn();
        expect(log.slice(2)).toEqual(['a0', 'a1', 'a:done']);
    });

    it('hurry finishes a build in one go, its finish run before it returns', async () => {
        const { lane, steps, log } = createLane();
        const finish = vi.fn((v) => v);
        const done = lane.run(1, steps('a', 50), { finish });
        expect(lane.hurry(1)).toBe(true);
        expect(log).toHaveLength(51);
        expect(finish).toHaveBeenCalledWith('a');
        expect(lane.has(1)).toBe(false);
        await expect(done).resolves.toBe('a');
        expect(lane.hurry(1)).toBe(false);
    });

    it('joins a second run of the same key instead of building twice', async () => {
        const {
            lane, steps, log, turn,
        } = createLane({ budgetMs: 10 });
        const first = lane.run(1, steps('a', 2));
        const second = lane.run(1, steps('dup', 2));
        expect(first).toBe(second);
        turn();
        expect(log.some((l) => l.startsWith('dup'))).toBe(false);
        await expect(first).resolves.toBe('a');
    });

    it('drops builds on teardown: steps closed, onCancel run, null, and nothing after', async () => {
        const { lane, turn, turns } = createLane({ budgetMs: 0 }); // one step a turn
        let closed = false;
        function* steps() {
            try {
                yield;
                yield;
                return 'never';
            } finally {
                closed = true;
            }
        }
        const onCancel = vi.fn();
        const done = lane.run(1, steps(), { onCancel });
        turn(); // started: suspended inside the try
        lane.cancelAll();
        expect(closed).toBe(true);
        expect(onCancel).toHaveBeenCalledOnce();
        await expect(done).resolves.toBeNull();
        const late = vi.fn();
        await expect(lane.run(2, steps(), { onCancel: late })).resolves.toBeNull();
        expect(late).toHaveBeenCalledOnce();
        turns.length = 0;
        expect(lane.size).toBe(0);
    });

    it('rejects a build whose step throws, and carries on with the next', async () => {
        const {
            lane, steps, log, turn,
        } = createLane({ budgetMs: 10 });
        function* broken() {
            yield;
            throw new Error('bad step');
        }
        const failed = lane.run(1, broken());
        const fine = lane.run(2, steps('b', 1));
        turn();
        await expect(failed).rejects.toThrow('bad step');
        await expect(fine).resolves.toBe('b');
        expect(log).toContain('b:done');
    });
});
