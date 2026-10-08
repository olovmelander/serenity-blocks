import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SwarmShow } from '../../src/themes/murmuration/composition/swarm-show.js';
import { IMPULSE_TYPE } from '../../src/themes/murmuration/sim/fluid-particles.js';

const showSource = fileURLToPath(
    new URL('../../src/themes/murmuration/composition/swarm-show.js', import.meta.url),
);

function makeShow() {
    const sim = {
        pushImpulse: vi.fn(),
        setShape: vi.fn(() => true),
        setShapeStrength: vi.fn(),
        setShapePose: vi.fn(),
    };
    return { sim, show: new SwarmShow({ sim, random: () => 0 }) };
}

/** Run the show's own clock forward in 60 Hz frames; returns the time it reached. */
function advance(show, from, seconds) {
    const frames = Math.round(seconds * 60);
    let time = from;
    for (let i = 0; i < frames; i += 1) {
        time += 1 / 60;
        show.update(1 / 60, time);
    }
    return time;
}

describe('theme async resource retirement', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps a quad clear\'s follow-up impulses on the show\'s clock, never on a timer', () => {
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        const interval = vi.spyOn(globalThis, 'setInterval');
        const { sim, show } = makeShow();

        show.clear({ lines: 4, rows: [19, 18, 17, 16] });
        // The first ring leaves at once; the swirl and the second ring wait in the queue.
        expect(sim.pushImpulse).toHaveBeenCalledTimes(1);
        const { queued } = show.getState();
        expect(queued).toBeGreaterThan(0);

        // A frame that does not move the clock fires nothing.
        show.update(0, 0);
        expect(sim.pushImpulse).toHaveBeenCalledTimes(1);

        advance(show, 0, 1);
        expect(sim.pushImpulse).toHaveBeenCalledTimes(1 + queued);
        expect(show.getState().queued).toBe(0);

        expect(timeout).not.toHaveBeenCalled();
        expect(interval).not.toHaveBeenCalled();
        expect(readFileSync(showSource, 'utf8')).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    });

    it.each([
        ['dispose', (show) => show.dispose()],
        ['resetSession', (show) => show.resetSession()],
    ])('never fires a quad clear\'s queued impulses after %s()', (name, letGo) => {
        const { sim, show } = makeShow();

        show.clear({ lines: 4, rows: [19, 18, 17, 16] });
        expect(sim.pushImpulse).toHaveBeenCalledTimes(1);
        expect(show.getState().queued).toBeGreaterThan(0);

        letGo(show);
        expect(show.getState().queued).toBe(0);
        // Even with the simulation handed back, nothing that was queued can reach it.
        show.sim = sim;
        advance(show, 0, 5);

        expect(sim.pushImpulse).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['dispose', (show) => show.dispose()],
        ['resetSession', (show) => show.resetSession()],
        ['gameStart', (show) => show.gameStart()],
    ])('cuts the game-over attractor chain short on %s()', (name, letGo) => {
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        const interval = vi.spyOn(globalThis, 'setInterval');
        const { sim, show } = makeShow();

        show.gameOver();
        expect(sim.setShape).toHaveBeenCalledWith('heart', expect.any(Object));
        // The whole chain is queued: nothing pulls before the clock runs.
        expect(sim.pushImpulse).not.toHaveBeenCalled();
        const chain = show.getState().queued;
        expect(chain).toBeGreaterThan(2);

        const time = advance(show, 0, 0.5);
        const fired = sim.pushImpulse.mock.calls.length;
        expect(fired).toBeGreaterThan(0);
        expect(fired).toBeLessThan(chain);
        expect(sim.pushImpulse.mock.calls.every(([, , , type]) => type === IMPULSE_TYPE.ATTRACTOR)).toBe(true);
        expect(show.getState().queued).toBe(chain - fired);

        letGo(show);
        expect(show.getState().queued).toBe(0);
        show.sim = sim;
        advance(show, time, 5);

        expect(sim.pushImpulse).toHaveBeenCalledTimes(fired);
        expect(timeout).not.toHaveBeenCalled();
        expect(interval).not.toHaveBeenCalled();
    });
});
