/**
 * How the view moves when the player looks around Infinity's tower
 * (src/ui/infinity/ascent/tower-flight.js): the pull that gives way, the glide, the soft edges,
 * the detent at home and the flight back. Rows grow DOWN the tower: a smaller top is higher.
 */
import { describe, expect, it } from 'vitest';
import {
    FLIGHT, TowerFlight, landingCurve, pullGive, springStep, stickResponse,
} from '../../src/ui/infinity/ascent/tower-flight.js';

/** A tower of 140 rows, the floor view at 120, the player's rows at 60. */
function flight({ follow = 60, home = 60 } = {}) {
    const f = new TowerFlight();
    f.setBounds(0, 120);
    f.setHome(home);
    f.setFollowTop(follow);
    return f;
}

/** Step `f` for `seconds` at `hz`, from `now` ms; returns the last frame and the time. */
function run(f, seconds, { hz = 60, now = 0, each } = {}) {
    const dt = 1 / hz;
    let t = now;
    let frame = null;
    const events = [];
    for (let i = 0; i < Math.round(seconds * hz); i++) {
        t += dt * 1000;
        frame = f.step(dt, t);
        events.push(...frame.events);
        each?.(frame, t);
    }
    return { frame, now: t, events };
}

describe('the pull', () => {
    it('peeks at once against a spring and springs back when let go, without asking to pause', () => {
        const f = flight();
        f.wheel(-1.5, 'fine', 0);
        const { frame: peek } = run(f, 0.12);
        expect(peek.phase).toBe('pull');
        expect(peek.offset).toBeLessThan(-0.4);
        expect(peek.offset).toBeGreaterThan(-FLIGHT.PULL_GIVE_ROWS);
        expect(peek.wantCommit).toBe(false);
        const { frame: after } = run(f, 1.5, { now: 120 });
        expect(after.phase).toBe('idle');
        expect(after.offset).toBe(0);
        expect(after.top).toBe(60);
    });

    it('gives way past the threshold, never moving the view more than the give meanwhile', () => {
        const f = flight();
        let most = 0;
        for (let i = 0; i < 6; i++) {
            f.wheel(-0.8, 'fine', i * 30);
            const frame = f.step(1 / 60, i * 30 + 16);
            most = Math.min(most, frame.offset);
        }
        const frame = f.step(1 / 60, 200);
        expect(frame.wantCommit).toBe(true);
        expect(Math.abs(most)).toBeLessThan(FLIGHT.PULL_GIVE_ROWS);
        // Committed, the view catches up with the whole pull.
        f.commit(60 + frame.offset);
        expect(f.target).toBeCloseTo(60 - 4.8, 6);
        const { frame: free, events } = run(f, 1, { now: 200 });
        expect(free.phase).toBe('free');
        expect(free.top).toBeCloseTo(55.2, 2);
        expect(events.some((e) => e.type === 'give')).toBe(true);
    });

    it('lets a single wheel notch be a peek, and two notches a look', () => {
        const one = flight();
        one.wheel(100 / 30, 'notch', 0);
        expect(one.step(1 / 60, 16).wantCommit).toBe(false);
        const two = flight();
        two.wheel(100 / 30, 'notch', 0);
        two.wheel(100 / 30, 'notch', 120);
        expect(two.step(1 / 60, 136).wantCommit).toBe(true);
        // A notch waits longer than a trackpad stream before it lets go.
        const waiting = flight();
        waiting.wheel(100 / 30, 'notch', 0);
        run(waiting, 0.3);
        expect(Math.abs(waiting.pull)).toBeGreaterThan(3);
    });

    it('finds no peek where there is nothing to see (the floor view, scrolling down)', () => {
        const f = flight({ follow: 120, home: 120 });
        f.wheel(3, 'fine', 0);
        const frame = f.step(1 / 60, 16);
        expect(frame.offset).toBe(0);
        expect(frame.events).toEqual([{ type: 'floor-nudge' }]);
        // Reported at most every NUDGE_MS.
        f.wheel(3, 'fine', 100);
        expect(f.step(1 / 60, 116).events).toEqual([]);
    });
});

describe('the glide', () => {
    it('lands where the input says, the same at 60 and 165 Hz', () => {
        const at = (hz) => {
            const f = flight();
            f.requestCommit();
            f.step(1 / hz, 0);
            f.commit(60);
            f.wheel(10, 'notch', 0);
            const tops = [];
            // 0.4 s is a whole number of frames at both rates.
            run(f, 0.4, { hz, each: (frame) => tops.push(frame.top) });
            return tops.at(-1);
        };
        expect(at(60)).toBeCloseTo(at(165), 3);
        expect(at(60)).toBeGreaterThan(60);
        expect(at(60)).toBeLessThan(70.01);
    });

    it('takes more input near the floor and bumps when pushed into it', () => {
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(118);
        expect(f.target).toBe(118);
        f.wheel(2, 'fine', 0);
        expect(f.target).toBeGreaterThan(118);
        expect(f.target).toBeLessThan(120);
        f.wheel(20, 'fine', 20);
        expect(f.target).toBe(120);
        const { events } = run(f, 1, { now: 20 });
        const bump = events.find((e) => e.type === 'floor');
        expect(bump).toBeTruthy();
        expect(bump.strength).toBeGreaterThan(0);
        expect(bump.strength).toBeLessThanOrEqual(1);
    });

    it('flies the stick at a speed after its dead zone', () => {
        expect(stickResponse(0.1)).toBe(0);
        expect(stickResponse(1)).toBe(1);
        expect(stickResponse(-1)).toBe(-1);
        expect(stickResponse(0.6)).toBeGreaterThan(0);
        expect(stickResponse(0.6)).toBeLessThan(0.6);
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(60);
        f.stick(1, 0);
        const { frame } = run(f, 0.5, { each: (_frame, t) => f.stick(1, t) });
        const travelled = frame.top - 60;
        expect(travelled).toBeGreaterThan(FLIGHT.STICK_MAX_SPEED * 0.5 * 0.6);
        expect(travelled).toBeLessThan(FLIGHT.STICK_MAX_SPEED * 0.5);
    });

    it('commits at once when the stick is pressed in (R3), without a pull', () => {
        const f = flight();
        f.stick(0, 0, true);
        expect(f.step(1 / 60, 16).wantCommit).toBe(true);
    });

    it('follows the tower map while it is held, and never flies home meanwhile', () => {
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(60);
        f.hold(true, 0);
        f.dragTo(100, 0);
        const { frame } = run(f, 6);
        expect(frame.top).toBeCloseTo(100, 2);
        expect(frame.wantLand).toBeNull();
        expect(frame.ring).toBe(0);
    });
});

describe('home', () => {
    it('clicks into place on the way back, then lands', () => {
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(60);
        f.wheel(12, 'fine', 0);
        run(f, 0.5);
        f.wheel(-20, 'fine', 600);
        expect(f.target).toBe(60);
        const { frame, events } = run(f, 0.2, { now: 600 });
        expect(events.some((e) => e.type === 'dock')).toBe(true);
        expect(frame.wantLand).toBeNull();
        const later = run(f, 0.3, { now: 800 });
        expect(later.frame.wantLand).toBe('home');
    });

    it('lets a firm push carry on through it', () => {
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(60);
        f.wheel(6, 'fine', 0);
        f.wheel(-8, 'fine', 50);
        expect(f.target).toBe(60);
        f.wheel(-3, 'fine', 100);
        expect(f.target).toBeLessThan(60 - FLIGHT.DOCK_ESCAPE_ROWS);
        const { events } = run(f, 0.1, { now: 100 });
        expect(events.some((e) => e.type === 'undock')).toBe(true);
    });

    it('fills the ring after a while without input, then asks to fly home', () => {
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(60);
        f.wheel(20, 'fine', 0);
        const rings = [];
        let wanted = null;
        run(f, FLIGHT.IDLE_RETURN_MS / 1000 + 0.1, {
            each: (frame) => {
                rings.push(frame.ring);
                wanted = wanted || frame.wantLand;
            },
        });
        expect(rings[0]).toBe(0);
        expect(Math.max(...rings)).toBeCloseTo(1, 1);
        expect(wanted).toBe('idle');
    });

    it('flies home softly: a lift away first, zero speed at both ends', () => {
        expect(landingCurve(0, 0.03)).toBe(0);
        expect(landingCurve(1, 0.03)).toBe(1);
        expect(landingCurve(0.2, 0.03)).toBeLessThan(landingCurve(0.2, 0));
        expect(landingCurve(0.02, 0)).toBeLessThan(0.001);
        expect(landingCurve(0.98, 0)).toBeGreaterThan(0.999);
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(100);
        f.beginLanding(1000, 60);
        const tops = [];
        const { frame, events } = run(f, FLIGHT.LAND_MAX_S + 0.1, { now: 1000, each: (fr) => tops.push(fr.top) });
        expect(frame.phase).toBe('landed');
        expect(frame.top).toBe(60);
        expect(Math.max(...tops)).toBeGreaterThan(100);
        expect(events.at(-1)).toEqual({ type: 'land' });
    });

    it('flies straight under reduced motion, and quickly when a key asked', () => {
        const f = flight();
        f.setReducedMotion(true);
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(100);
        f.beginLanding(0, 60);
        expect(f.land.lift).toBe(0);
        const g = flight();
        g.requestCommit();
        g.step(1 / 60, 0);
        g.commit(100);
        g.beginLanding(0, 60, { quick: true });
        expect(g.land.ms).toBeLessThanOrEqual(FLIGHT.LAND_QUICK_MAX_S * 1000);
    });

    it('gives the view back to the player when they grab it mid-flight', () => {
        const f = flight();
        f.requestCommit();
        f.step(1 / 60, 0);
        f.commit(100);
        f.beginLanding(0, 60);
        run(f, 0.3);
        f.wheel(2, 'fine', 300);
        expect(f.phase).toBe('free');
    });
});

describe('the helpers', () => {
    it('spring exactly: a large step lands where many small ones do', () => {
        let a = { x: 0, v: 0 };
        for (let i = 0; i < 100; i++) a = springStep(a.x, a.v, 10, 12, 0.001);
        const b = springStep(0, 0, 10, 12, 0.1);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(springStep(3, 1, 5, 12, 0)).toEqual({ x: 3, v: 1 });
    });

    it('give at most PULL_GIVE_ROWS, symmetrically', () => {
        expect(pullGive(0)).toBe(0);
        expect(pullGive(10)).toBeLessThan(FLIGHT.PULL_GIVE_ROWS);
        expect(pullGive(100)).toBeLessThanOrEqual(FLIGHT.PULL_GIVE_ROWS);
        expect(pullGive(-2)).toBeCloseTo(-pullGive(2), 9);
    });
});
