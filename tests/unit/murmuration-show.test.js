import {
    describe, expect, it, vi,
} from 'vitest';
import { RANDOM_SHAPE_POOL, SwarmShow } from '../../src/themes/murmuration/composition/swarm-show.js';
import { PALETTE_LEVEL_STEP } from '../../src/themes/murmuration/composition/swarm-palette.js';
import { IMPULSE_TYPE } from '../../src/themes/murmuration/sim/fluid-particles.js';
import { SHAPE_NAMES } from '../../src/themes/murmuration/sim/shape-formations.js';

const { RADIAL, VORTEX, ATTRACTOR } = IMPULSE_TYPE;
const FOCAL = Object.freeze({ x: 0.5, y: -0.25, z: -1.5 });
const QUAD = Object.freeze({ lines: 4, rows: [19, 18, 17, 16] });
const PUNCHES = ['chromaPunch', 'bloomPunch', 'vignettePunch'];

function makeShow(options = {}) {
    const impulses = [];
    const sim = {
        // The show reuses its origin object: keep what the simulation would copy.
        pushImpulse: vi.fn((position, strength, dir, type, wave) => impulses.push({
            position: { ...position }, strength, dir, type, wave,
        })),
        setShape: vi.fn(() => true),
        setShapeStrength: vi.fn(),
        setShapePose: vi.fn(),
    };
    const camera = {
        shake: vi.fn(), fovPunch: vi.fn(), dolly: vi.fn(), vertigo: vi.fn(), pullBack: vi.fn(),
    };
    const show = new SwarmShow({
        sim, camera, focal: FOCAL, random: () => 0, ...options,
    });
    return {
        show, sim, camera, impulses,
    };
}

/** Run the show's clock forward in 60 Hz frames; returns the time it reached. */
function run(show, from, seconds) {
    const frames = Math.round(seconds * 60);
    let time = from;
    for (let i = 0; i < frames; i += 1) {
        time += 1 / 60;
        show.update(1 / 60, time);
    }
    return time;
}

describe('swarm show: locks', () => {
    it('sends a ring of light out from a lock, harder and faster for a hard drop', () => {
        const soft = makeShow();
        const hard = makeShow();
        soft.show.lock({ rows: [18, 19], u: 0.45 });
        hard.show.lock({ rows: [19], u: 0.8, hardDrop: true });
        expect(soft.impulses).toHaveLength(1);
        expect(hard.impulses).toHaveLength(1);
        const [tap] = soft.impulses;
        const [slam] = hard.impulses;
        // A travelling ring is the fifth argument; a blunt push has none.
        expect(tap.type).toBe(RADIAL);
        expect(tap.wave).toBeTruthy();
        expect(slam.wave).toBeTruthy();
        expect(tap.wave.squash ?? 1).toBe(1);
        expect(slam.strength).toBeGreaterThan(tap.strength);
        expect(slam.wave.speed).toBeGreaterThan(tap.wave.speed);
        expect(slam.wave.flash).toBeGreaterThan(tap.wave.flash);
        // The lens takes the hit, and only the drop pushes it in.
        expect(soft.camera.shake).toHaveBeenCalledOnce();
        expect(hard.camera.shake.mock.calls[0][0]).toBeGreaterThan(soft.camera.shake.mock.calls[0][0]);
        expect(Math.abs(hard.camera.fovPunch.mock.calls[0][0]))
            .toBeGreaterThan(Math.abs(soft.camera.fovPunch.mock.calls[0][0]));
        expect(soft.camera.dolly).not.toHaveBeenCalled();
        expect(hard.camera.dolly).toHaveBeenCalledOnce();
        for (const key of PUNCHES) {
            expect(soft.show.fx[key], key).toBeGreaterThan(0);
            expect(hard.show.fx[key], key).toBeGreaterThan(soft.show.fx[key]);
        }
        // A lock gathers nothing.
        expect(soft.sim.setShape).not.toHaveBeenCalled();
    });

    it('starts the ring where `locate` puts the event and falls back to the focal point', () => {
        const locate = vi.fn((detail, row, u, out) => {
            out.x = 3; out.y = -2; out.z = FOCAL.z;
            return true;
        });
        const { show, impulses } = makeShow({ locate });
        const lock = { rows: [17, 18], u: 0.3 };
        show.lock(lock);
        // The mean of the rows the piece landed on, and its own column.
        expect(locate).toHaveBeenLastCalledWith(lock, 17.5, 0.3, expect.any(Object));
        expect(impulses[0].position).toEqual({ x: 3, y: -2, z: FOCAL.z });
        // A clear runs along its rows from the middle of the board.
        const clear = { lines: 2, rows: [19, 18] };
        show.clear(clear);
        expect(locate).toHaveBeenLastCalledWith(clear, 18.5, 0.5, expect.any(Object));
        expect(impulses[1].position).toEqual({ x: 3, y: -2, z: FOCAL.z });

        // A locate that cannot place the event leaves it at the focal point, whatever it scribbled.
        locate.mockImplementation((detail, row, u, out) => {
            out.x = 99;
            return false;
        });
        show.lock(lock);
        expect(impulses[2].position).toEqual(FOCAL);
        // As does a show built without one.
        const bare = makeShow();
        bare.show.lock({});
        expect(bare.impulses[0].position).toEqual(FOCAL);
    });
});

describe('swarm show: clears', () => {
    it('sends a tall elliptical ring for one to three rows and gathers a shape on the third', () => {
        const made = [1, 2, 3].map((lines) => {
            const one = makeShow();
            one.show.clear({ lines, rows: [19, 18, 17].slice(0, lines) });
            return one;
        });
        made.forEach(({ impulses, sim, show }, i) => {
            expect(impulses).toHaveLength(1);
            expect(impulses[0].type).toBe(RADIAL);
            // The ring is an ellipse taller than it is wide (vertical distance counts for
            // less), so its sides leave the board sideways as near-vertical fronts.
            expect(impulses[0].wave.squash).toBeLessThan(1);
            expect(impulses[0].wave.squash).toBeGreaterThan(0);
            expect(show.skyFlash).toBeGreaterThan(0);
            expect(show.fx.comboPulse).toBeGreaterThan(0);
            expect(sim.setShape).toHaveBeenCalledTimes(i === 2 ? 1 : 0);
        });
        // More lines, more light.
        for (let i = 1; i < made.length; i += 1) {
            expect(made[i].impulses[0].strength).toBeGreaterThan(made[i - 1].impulses[0].strength);
            expect(made[i].impulses[0].wave.flash).toBeGreaterThan(made[i - 1].impulses[0].wave.flash);
            expect(made[i].show.skyFlash).toBeGreaterThan(made[i - 1].show.skyFlash);
            expect(made[i].show.fx.comboPulse).toBeGreaterThan(made[i - 1].show.fx.comboPulse);
        }
        const triple = made[2];
        expect(RANDOM_SHAPE_POOL).toContain(triple.sim.setShape.mock.calls[0][0]);
        expect(triple.show.shape.name).toBe(triple.sim.setShape.mock.calls[0][0]);
        expect(triple.show.shape.target).toBeGreaterThan(0);
    });

    it('answers a quad with two rings, a swirl, a lit sky and a firmer formation', () => {
        const triple = makeShow();
        triple.show.clear({ lines: 3, rows: [19, 18, 17] });
        const {
            show, sim, camera, impulses,
        } = makeShow();
        show.clear(QUAD);
        // The first ring leaves at once: round, and harder than any lesser clear's.
        expect(impulses).toHaveLength(1);
        expect(impulses[0].type).toBe(RADIAL);
        expect(impulses[0].wave.squash ?? 1).toBe(1);
        expect(impulses[0].strength).toBeGreaterThan(triple.impulses[0].strength);
        expect(show.skyFlash).toBeGreaterThan(triple.show.skyFlash);
        expect(camera.dolly).toHaveBeenCalledOnce();
        expect(sim.setShape).toHaveBeenCalledOnce();
        expect(show.shape.target).toBeGreaterThan(triple.show.shape.target);
        expect(show.shape.until).toBeGreaterThan(triple.show.shape.until);
        expect(show.shape.priority).toBeGreaterThan(triple.show.shape.priority);

        run(show, 0, 1);
        expect(impulses.map((impulse) => impulse.type)).toEqual([RADIAL, VORTEX, RADIAL]);
        expect(impulses[1].wave).toBeNull();
        expect(impulses[2].wave).toBeTruthy();
        expect(impulses[2].strength).toBeLessThan(impulses[0].strength);
    });

    it('keeps a quad\'s follow-ups where the quad was, whatever lands in between', () => {
        const spots = [{ x: 3, y: -2 }, { x: -4, y: 1 }];
        const locate = vi.fn((detail, row, u, out) => {
            Object.assign(out, spots[detail.hardDrop ? 1 : 0], { z: FOCAL.z });
            return true;
        });
        const { show, impulses } = makeShow({ locate });
        show.clear(QUAD);
        show.lock({ hardDrop: true, rows: [19] }); // reuses the show's origin object
        run(show, 0, 1);
        const here = { ...spots[0], z: FOCAL.z };
        expect(impulses.map((impulse) => impulse.position)).toEqual([
            here, { ...spots[1], z: FOCAL.z }, here, here,
        ]);
    });

    it('turns a T-spin into two counter-turning eddies either side of the piece, and a knot', () => {
        const { show, sim, impulses } = makeShow();
        show.clear({ lines: 2, rows: [19, 18], tspin: true });
        const eddies = impulses.filter((impulse) => impulse.type === VORTEX);
        expect(impulses).toHaveLength(3); // the clear's own ring, then the eddies
        expect(eddies).toHaveLength(2);
        expect(eddies[0].dir.z * eddies[1].dir.z).toBeLessThan(0);
        expect(eddies[0].strength).toBe(eddies[1].strength);
        expect(eddies[0].position.x).toBeLessThan(FOCAL.x);
        expect(eddies[1].position.x).toBeGreaterThan(FOCAL.x);
        expect((eddies[0].position.x + eddies[1].position.x) / 2).toBeCloseTo(FOCAL.x, 9);
        expect(eddies.every(({ position }) => position.y === FOCAL.y && position.z === FOCAL.z)).toBe(true);
        expect(sim.setShape).toHaveBeenCalledOnce();
        expect(show.shape.name).toBe(sim.setShape.mock.calls[0][0]);
        expect(show.shape.target).toBeGreaterThan(0);
    });

    it('draws the swarm in to a point before a perfect clear blooms', () => {
        const quad = makeShow();
        quad.show.clear(QUAD);
        const {
            show, sim, camera, impulses,
        } = makeShow();
        show.clear({ ...QUAD, perfect: true });
        // Nothing leaves at once, and the quad's own ring is not added to it.
        expect(impulses).toHaveLength(0);
        expect(sim.setShape).not.toHaveBeenCalled();
        expect(camera.vertigo).toHaveBeenCalledOnce();

        run(show, 0, 1);
        const types = impulses.map((impulse) => impulse.type);
        expect(types.length).toBeGreaterThan(2);
        expect(types.slice(0, -1).every((type) => type === ATTRACTOR)).toBe(true);
        expect(types.at(-1)).toBe(RADIAL);
        expect(impulses.every(({ position }) => position.x === FOCAL.x && position.y === FOCAL.y)).toBe(true);
        const bloom = impulses.at(-1);
        expect(bloom.wave).toBeTruthy();
        expect(bloom.strength).toBeGreaterThan(quad.impulses[0].strength);
        expect(sim.setShape).toHaveBeenCalledOnce();
        expect(show.shape.priority).toBeGreaterThan(quad.show.shape.priority);
        expect(show.skyFlash).toBeGreaterThan(0);
        expect(show.getState().queued).toBe(0);
    });

    it('lights the sky and the reward pulse for a back-to-back', () => {
        const plain = makeShow();
        const b2b = makeShow();
        plain.show.clear({ lines: 1, rows: [19] });
        b2b.show.clear({ lines: 1, rows: [19], b2b: true });
        expect(b2b.show.skyFlash).toBeGreaterThan(plain.show.skyFlash);
        expect(b2b.show.fx.rewardPulse).toBeGreaterThan(plain.show.fx.rewardPulse);
        expect(b2b.impulses).toEqual(plain.impulses);
    });

    it('only ever asks the simulation for formations it has', () => {
        expect(RANDOM_SHAPE_POOL.every((name) => SHAPE_NAMES.includes(name))).toBe(true);
        // 'free' is the release state and the heart belongs to game over.
        expect(RANDOM_SHAPE_POOL).not.toContain('free');
        expect(RANDOM_SHAPE_POOL).not.toContain('heart');
        // The T-spin's knots and the perfect clear's blooms are private lists: roll through them.
        const asked = new Set();
        for (let roll = 0.02; roll < 1; roll += 0.04) {
            const { show, sim } = makeShow({ random: () => roll });
            show.clear({ lines: 1, rows: [19], tspin: true });
            show.resetSession();
            show.clear({ lines: 1, rows: [19], perfect: true });
            run(show, 0, 1);
            show.gameOver();
            sim.setShape.mock.calls.forEach(([name]) => asked.add(name));
        }
        expect(asked.size).toBeGreaterThan(3);
        expect([...asked].filter((name) => !SHAPE_NAMES.includes(name))).toEqual([]);
    });

    it('draws a play\'s figure beside the board and in front of the dust; only the heart takes it all', () => {
        const { show, sim } = makeShow();
        show.clear({ lines: 3, rows: [19, 18, 17] });
        show.resetSession();
        show.clear(QUAD);
        show.resetSession();
        show.clear({ lines: 1, rows: [19], tspin: true });
        show.resetSession();
        show.clear({ lines: 1, rows: [19], perfect: true });
        run(show, 0, 1);
        show.resetSession();
        show.combo(4);
        show.combo(7);
        // (A formation that has faded hands the simulation back with 'free'; that is not a figure.)
        const figures = () => sim.setShape.mock.calls.filter(([name]) => name !== 'free');
        const plays = figures();
        expect(plays.length).toBeGreaterThanOrEqual(6);
        // Free to be twinned either side of the board, and formed from the ribbons only.
        expect(plays.filter(([, opts]) => opts?.layout !== undefined)).toEqual([]);
        expect(plays.filter(([, opts]) => opts?.keepDust !== true)).toEqual([]);
        show.resetSession();
        show.gameOver();
        const [name, heart] = figures().at(-1);
        expect(name).toBe('heart');
        expect(heart.layout).toBe('center');
        expect(heart.keepDust).not.toBe(true);
    });
});

describe('swarm show: combo', () => {
    it('keeps the best chain across players and warms toward it', () => {
        const { show } = makeShow();
        show.combo(3, 1);
        show.combo(5, 2);
        expect(show.comboCount).toBe(5);
        expect(show.getState().combo).toBe(5);
        const hot = show.heatTarget;
        expect(hot).toBeGreaterThan(0);
        // Player 2's chain breaks: player 1's still stands.
        show.combo(0, 2);
        expect(show.comboCount).toBe(3);
        expect(show.heatTarget).toBeGreaterThan(0);
        expect(show.heatTarget).toBeLessThan(hot);
        show.combo(0, 1);
        expect(show.comboCount).toBe(0);
        expect(show.heatTarget).toBe(0);
        // Nonsense is no chain.
        show.combo(NaN, 3);
        show.combo(-4, 3);
        expect(show.comboCount).toBe(0);
    });

    it('raises the heat with the chain, never past full, and eases toward it', () => {
        const targets = [];
        for (let n = 1; n <= 14; n += 1) {
            const { show } = makeShow();
            show.combo(n);
            targets.push(show.heatTarget);
        }
        expect(targets[0]).toBe(0); // one clear is not a chain
        expect(targets.at(-1)).toBe(1);
        for (let i = 1; i < targets.length; i += 1) expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]);
        expect(new Set(targets).size).toBeGreaterThan(4);

        const { show } = makeShow();
        show.combo(6);
        const time = run(show, 0, 0.5);
        const warming = show.heat;
        expect(warming).toBeGreaterThan(0);
        expect(warming).toBeLessThan(show.heatTarget);
        expect(show.fx.stageHeat).toBe(warming);
        run(show, time, 10);
        expect(show.heat).toBeCloseTo(show.heatTarget, 3);
        // It cools more slowly than it warmed.
        show.combo(0);
        run(show, time + 10, 0.5);
        expect(show.heat).toBeGreaterThan(show.heatTarget + warming);
    });

    it('reacts only when the chain grows', () => {
        const { show, impulses } = makeShow();
        show.combo(1);
        expect(impulses).toHaveLength(0);
        show.combo(2);
        expect(impulses).toHaveLength(1);
        // Each step of the chain gives the gyre a shove: a blunt swirl about the focal point.
        expect(impulses[0]).toMatchObject({ type: VORTEX, wave: null, position: FOCAL });
        expect(show.fx.comboIntensity).toBeGreaterThan(0);
        expect(show.fx.rewardPulse).toBeGreaterThan(0);
        show.combo(2);
        show.combo(2, 1); // another board catching up is not growth
        expect(impulses).toHaveLength(1);
        show.combo(3);
        expect(impulses).toHaveLength(2);
        expect(impulses[1].strength).toBeGreaterThan(impulses[0].strength);
        show.combo(0);
        show.combo(0, 1);
        expect(impulses).toHaveLength(2);
        // A new chain starts over.
        show.combo(2);
        expect(impulses).toHaveLength(3);
    });

    it('gathers a formation at four and a firmer, longer one at seven', () => {
        const { show, sim, camera } = makeShow();
        show.combo(2);
        show.combo(3);
        expect(sim.setShape).not.toHaveBeenCalled();
        show.combo(4);
        expect(sim.setShape).toHaveBeenCalledTimes(1);
        expect(camera.dolly).toHaveBeenCalledOnce();
        expect(camera.vertigo).not.toHaveBeenCalled();
        const four = { ...show.shape };
        expect(four.target).toBeGreaterThan(0);
        show.combo(7);
        expect(sim.setShape).toHaveBeenCalledTimes(2);
        expect(camera.vertigo).toHaveBeenCalledOnce();
        expect(show.shape.name).not.toBe(four.name);
        expect(show.shape.target).toBeGreaterThan(four.target);
        expect(show.shape.until).toBeGreaterThan(four.until);
        expect(show.shape.priority).toBeGreaterThan(four.priority);
    });
});

describe('swarm show: formations', () => {
    it('does not let a lesser moment interrupt a greater one mid-hold', () => {
        const { show, sim } = makeShow();
        expect(show.requestShape('torus', {}, 0.7, 4, 2)).toBe(true);
        const time = run(show, 0, 2);
        expect(show.requestShape('star', {}, 0.5, 3, 1)).toBe(false);
        expect(show.shape.name).toBe('torus');
        expect(sim.setShape).toHaveBeenCalledTimes(1);
        // Its equal may take over once it has arrived.
        expect(show.requestShape('helix', {}, 0.6, 1, 2)).toBe(true);
        expect(show.shape.name).toBe('helix');
        // Once a hold is over anything may gather, however slight.
        run(show, time, 1.5);
        expect(show.shape.target).toBe(0);
        expect(show.requestShape('star', {}, 0.5, 3, 0)).toBe(true);
        expect(show.shape).toMatchObject({ name: 'star', target: 0.5, priority: 0 });
    });

    it('never re-rolls a formation that is still arriving, unless something greater calls', () => {
        const { show, sim } = makeShow();
        expect(show.requestShape('torus', {}, 0.6, 10, 1)).toBe(true);
        let time = run(show, 0, 1);
        expect(show.requestShape('star', {}, 0.6, 10, 1)).toBe(false);
        expect(show.requestShape('helix', {}, 0.6, 10, 2)).toBe(true);
        time = run(show, time, 1);
        expect(show.requestShape('cube', {}, 0.6, 10, 2)).toBe(false);
        expect(show.shape.name).toBe('helix');
        run(show, time, 1);
        expect(show.requestShape('cube', {}, 0.6, 10, 2)).toBe(true);
        expect(sim.setShape.mock.calls.map(([name]) => name)).toEqual(['torus', 'helix', 'cube']);
    });

    it('refuses a shape the simulation does not know and keeps what it had', () => {
        const { show, sim } = makeShow();
        sim.setShape.mockReturnValueOnce(false);
        expect(show.requestShape('nope')).toBe(false);
        expect(show.shape).toMatchObject({ name: 'free', target: 0 });
        expect(show.requestShape('torus')).toBe(true);
    });

    it('lets a formation go after its hold and frees the simulation once it has faded', () => {
        const { show, sim } = makeShow();
        show.requestShape('torus', {}, 0.7, 2, 1);
        expect(sim.setShape).toHaveBeenLastCalledWith('torus', {});
        let time = run(show, 0, 1);
        // Arriving: the strength eases up, it does not snap.
        expect(show.shape.level).toBeGreaterThan(0.5);
        expect(show.shape.level).toBeLessThan(0.7);
        expect(sim.setShapeStrength).toHaveBeenLastCalledWith(show.shape.level);
        expect(show.shapeColor).toBeGreaterThan(0);

        time = run(show, time, 1.1);
        const fading = show.shape.level;
        expect(show.shape).toMatchObject({ name: 'torus', target: 0 });
        expect(fading).toBeGreaterThan(0.1);
        expect(sim.setShape).not.toHaveBeenCalledWith('free');

        run(show, time, 4);
        expect(show.shape).toMatchObject({
            name: 'free', level: 0, target: 0, priority: 0,
        });
        expect(sim.setShape).toHaveBeenLastCalledWith('free');
        expect(sim.setShape.mock.calls.filter(([name]) => name === 'free')).toHaveLength(1);
        expect(sim.setShapeStrength).toHaveBeenLastCalledWith(0);
        expect(sim.setShapePose).toHaveBeenLastCalledWith(0, 1);
        expect(show.getState()).toMatchObject({ shape: 'free', shapeLevel: 0 });
    });

    it('turns a solid all the way round and only sways a figure that has a face', () => {
        const yaws = (name) => {
            const { show, sim } = makeShow();
            show.requestShape(name, {}, 0.7, Infinity, 1);
            run(show, 0, 30);
            return sim.setShapePose.mock.calls.map(([yaw]) => yaw);
        };
        const sphere = yaws('sphere');
        expect(sphere.at(-1)).toBeGreaterThan(Math.PI * 2);
        for (let i = 1; i < sphere.length; i += 1) expect(sphere[i]).toBeGreaterThan(sphere[i - 1]);
        const heart = yaws('heart');
        expect(Math.max(...heart.map(Math.abs))).toBeLessThan(Math.PI / 4);
        expect(Math.min(...heart)).toBeLessThan(0);
        expect(Math.max(...heart)).toBeGreaterThan(0);
    });

    it('lets go on request', () => {
        const { show } = makeShow();
        show.requestShape('torus', {}, 0.7, Infinity, 3);
        const time = run(show, 0, 1);
        show.releaseShape();
        expect(show.shape.target).toBe(0);
        run(show, time, 4);
        expect(show.shape.name).toBe('free');
    });

    it('never picks the same formation twice running', () => {
        // A die that keeps landing on the same face.
        const stuck = makeShow({ random: () => 0.37 }).show;
        // And an honest, repeatable one.
        let seed = 7;
        const rolled = makeShow({
            random: () => {
                seed = (seed * 16807) % 2147483647;
                return seed / 2147483647;
            },
        }).show;
        for (const show of [stuck, rolled, makeShow({ random: () => 0.999999999 }).show]) {
            const picks = Array.from({ length: 200 }, () => show.pickRandomShape());
            expect(picks.every((pick) => RANDOM_SHAPE_POOL.includes(pick))).toBe(true);
            expect(picks.filter((pick, i) => i > 0 && pick === picks[i - 1])).toEqual([]);
        }
        expect(new Set(Array.from({ length: 200 }, () => rolled.pickRandomShape())).size).toBeGreaterThan(10);
        // A custom pool obeys the same rule; an empty one has nothing to give.
        const pair = Array.from({ length: 6 }, () => stuck.pickRandomShape(['ring', 'star']));
        expect(pair.filter((pick, i) => i > 0 && pick === pair[i - 1])).toEqual([]);
        expect(stuck.pickRandomShape(['ring'])).toBe('ring');
        expect(stuck.pickRandomShape([])).toBeNull();
    });
});

describe('swarm show: runs and levels', () => {
    it.each(['gameStart', 'resetSession'])('holds the game-over heart until %s()', (letGo) => {
        const {
            show, sim, camera, impulses,
        } = makeShow();
        show.gameOver();
        // One heart, in the middle: the run is over and the board no longer needs the centre.
        expect(sim.setShape).toHaveBeenLastCalledWith('heart', expect.objectContaining({ layout: 'center' }));
        expect(camera.pullBack).toHaveBeenCalledOnce();
        let time = run(show, 0, 30);
        expect(show.shape.name).toBe('heart');
        expect(show.shape.target).toBeGreaterThan(0);
        expect(show.shape.level).toBeCloseTo(show.shape.target, 3);
        // The swarm was drawn in to it.
        expect(impulses.length).toBeGreaterThan(2);
        expect(impulses.every((impulse) => impulse.type === ATTRACTOR)).toBe(true);
        // No lesser moment takes the swarm off the heart.
        show.clear(QUAD);
        show.combo(8);
        time = run(show, time, 2);
        expect(show.shape.name).toBe('heart');
        expect(sim.setShape).toHaveBeenCalledTimes(1);

        show[letGo]();
        expect(show.shape.target).toBe(0);
        expect(show.getState()).toMatchObject({ combo: 0, queued: 0 });
        expect(show.heatTarget).toBe(0);
        run(show, time, 4);
        expect(show.shape.name).toBe('free');
        expect(sim.setShape).toHaveBeenLastCalledWith('free');
        // The next run gathers shapes again.
        expect(show.requestShape('torus', {}, 0.6, 3, 1)).toBe(true);
    });

    it('steps the palette on with each level, without a wave when asked to be silent', () => {
        const { show, impulses } = makeShow();
        show.levelUp(2);
        expect(show.level).toBe(2);
        expect(show.palettePhaseTarget).toBeCloseTo(PALETTE_LEVEL_STEP, 12);
        expect(impulses).toHaveLength(1);
        expect(impulses[0]).toMatchObject({ type: RADIAL, position: FOCAL });
        expect(impulses[0].wave).toBeTruthy();
        expect(show.skyFlash).toBeGreaterThan(0);
        // The colours ease over; they do not jump.
        expect(show.palettePhase).toBe(0);
        const time = run(show, 0, 0.5);
        expect(show.palettePhase).toBeGreaterThan(0);
        expect(show.palettePhase).toBeLessThan(show.palettePhaseTarget);
        run(show, time, 10);
        expect(show.palettePhase).toBeCloseTo(show.palettePhaseTarget, 4);

        // Joining a run in progress: straight to its colours, no wave.
        show.levelUp(6, { silent: true });
        expect(impulses).toHaveLength(1);
        expect(show.palettePhaseTarget).toBeCloseTo(5 * PALETTE_LEVEL_STEP, 12);
        expect(show.palettePhase).toBe(show.palettePhaseTarget);
        expect(show.getState()).toMatchObject({ level: 6, palettePhase: show.palettePhaseTarget });
        // Nonsense is level one.
        show.levelUp(NaN, { silent: true });
        expect(show.level).toBe(1);
        expect(show.palettePhaseTarget).toBe(0);
    });

    it('goes back to its first frame on reset()', () => {
        const fresh = makeShow().show.getState();
        const { show, sim } = makeShow();
        show.lock({ hardDrop: true });
        show.clear({ ...QUAD, b2b: true });
        show.combo(6);
        show.levelUp(4);
        run(show, 0, 1);
        show.reset();
        expect(show.getState()).toEqual(fresh);
        expect(Object.values(show.fx).every((value) => value === 0)).toBe(true);
        expect(show.heatTarget).toBe(0);
        expect(show.palettePhaseTarget).toBe(0);
        expect(sim.setShape).toHaveBeenLastCalledWith('free');
        expect(sim.setShapeStrength).toHaveBeenLastCalledWith(0);
    });
});

describe('swarm show: the frame', () => {
    it('stills the lens under reduced motion and keeps the light', () => {
        const play = ({ show }) => {
            show.lock({ rows: [19] });
            show.lock({ rows: [19], hardDrop: true });
            show.clear(QUAD);
            show.clear({ lines: 1, rows: [19], perfect: true });
            show.combo(4);
            show.combo(7);
            show.gameOver();
            run(show, 0, 1);
        };
        const moving = makeShow();
        play(moving);
        const still = makeShow();
        still.show.reducedMotion = true;
        play(still);
        for (const [name, fn] of Object.entries(moving.camera)) expect(fn, name).toHaveBeenCalled();
        for (const [name, fn] of Object.entries(still.camera)) expect(fn, name).not.toHaveBeenCalled();
        // Everything that is light, not motion, is unchanged.
        expect(still.impulses).toEqual(moving.impulses);
        expect(still.sim.setShape.mock.calls).toEqual(moving.sim.setShape.mock.calls);
        expect(still.show.fx).toEqual(moving.show.fx);
    });

    it('decays its punches with time, whatever the frame rate', () => {
        const punched = () => {
            const { show } = makeShow();
            show.lock({ rows: [19], hardDrop: true });
            show.clear({ lines: 3, rows: [19, 18, 17], b2b: true });
            show.combo(5);
            return show;
        };
        const coarse = punched();
        const fine = punched();
        const before = { ...coarse.fx, skyFlash: coarse.skyFlash };
        coarse.update(0.1, 0.1);
        for (let i = 1; i <= 10; i += 1) fine.update(0.01, i * 0.01);
        for (const key of [...PUNCHES, 'comboPulse', 'comboIntensity', 'rewardPulse']) {
            expect(before[key], key).toBeGreaterThan(0);
            expect(coarse.fx[key], key).toBeLessThan(before[key]);
            expect(fine.fx[key], key).toBeCloseTo(coarse.fx[key], 9);
        }
        expect(coarse.skyFlash).toBeLessThan(before.skyFlash);
        expect(fine.skyFlash).toBeCloseTo(coarse.skyFlash, 9);
        // What eases toward a target arrives at the same place too.
        expect(coarse.heat).toBeGreaterThan(0);
        expect(fine.heat).toBeCloseTo(coarse.heat, 9);
        expect(fine.shape.level).toBeCloseTo(coarse.shape.level, 9);
        expect(fine.simParams.gyre).toBeCloseTo(coarse.simParams.gyre, 9);

        // The punches are a tap, not a state: gone within a second, while the chain's glow lingers.
        run(coarse, 0.1, 0.9);
        for (const key of PUNCHES) expect(coarse.fx[key], key).toBeLessThan(before[key] * 0.01);
        expect(coarse.fx.comboIntensity).toBeGreaterThan(before.comboIntensity * 0.05);
    });

    it('spins the gyre up and stirs the flow while a chain runs', () => {
        const cold = makeShow().show;
        const hot = makeShow().show;
        hot.combo(8);
        const time = run(hot, 0, 2);
        run(cold, 0, 2);
        expect(cold.simParams.gyre).toBeGreaterThan(0);
        expect(hot.simParams.gyre).toBeGreaterThan(cold.simParams.gyre);
        expect(hot.simParams.turbulence).toBeGreaterThan(cold.simParams.turbulence);
        // And settles back when it breaks.
        hot.combo(0);
        run(hot, time, 30);
        expect(hot.simParams.gyre).toBeCloseTo(cold.simParams.gyre, 3);
        expect(hot.simParams.turbulence).toBeCloseTo(cold.simParams.turbulence, 3);
    });

    it('feeds the motes and the sky each frame', () => {
        const slot = (value = 0) => ({ value });
        const tint = () => ({ value: { setRGB: vi.fn() } });
        const visual = {
            baseExposure: 0.8,
            uniforms: {
                uHeat: slot(), uPalettePhase: slot(), uShapeColor: slot(), uExposure: slot(1),
            },
        };
        const sky = {
            uniforms: {
                uHeat: slot(), uPulse: slot(), uFlash: slot(), uTintA: tint(), uTintB: tint(),
            },
        };
        const { show } = makeShow({ visual, sky });
        show.combo(3); // a chain long enough to warm the swarm, too short to gather it
        show.clear({ lines: 2, rows: [19, 18] });
        show.levelUp(3);
        let time = run(show, 0, 0.5);
        expect(visual.uniforms.uHeat.value).toBe(show.heat);
        expect(visual.uniforms.uHeat.value).toBeGreaterThan(0);
        expect(visual.uniforms.uPalettePhase.value).toBe(show.palettePhase);
        expect(sky.uniforms.uHeat.value).toBe(show.heat);
        expect(sky.uniforms.uPulse.value).toBe(show.fx.comboPulse);
        expect(sky.uniforms.uFlash.value).toBe(show.skyFlash);
        expect(sky.uniforms.uFlash.value).toBeGreaterThan(0);
        // The free swarm glows at its base exposure, held back a little while it is hot
        // (a hot swarm is a fast, bright one; the total must not bleach).
        const restExposure = () => 0.8 * (1 - show.heat * 0.3);
        expect(visual.uniforms.uExposure.value).toBeCloseTo(restExposure(), 9);
        expect(restExposure()).toBeLessThan(0.8);
        expect(restExposure()).toBeGreaterThan(0.8 * 0.7 - 1e-9);
        expect(visual.uniforms.uShapeColor.value).toBe(0);
        // The sky is lit in two of the swarm's hues: dim, and never the same one.
        const a = sky.uniforms.uTintA.value.setRGB.mock.calls.at(-1);
        const b = sky.uniforms.uTintB.value.setRGB.mock.calls.at(-1);
        expect([...a, ...b].every((channel) => channel >= 0 && channel <= 1)).toBe(true);
        expect(a).not.toEqual(b);

        // A formation packs the swarm into a figure a quarter of its size: the exposure eases
        // well down for it (more than half, never to nothing), and back.
        show.requestShape('torus', {}, 0.7, 2, 9);
        time = run(show, time, 1.5);
        expect(visual.uniforms.uExposure.value).toBeLessThan(0.8 * 0.5);
        expect(visual.uniforms.uExposure.value).toBeGreaterThan(0.8 * 0.2);
        expect(visual.uniforms.uShapeColor.value).toBeGreaterThan(0.5);
        run(show, time, 8);
        expect(visual.uniforms.uExposure.value).toBeCloseTo(restExposure(), 6);
        expect(visual.uniforms.uShapeColor.value).toBeLessThan(0.01);
    });

    it('fires what it queued in order, late frames included', () => {
        const { show } = makeShow();
        const order = [];
        show.after(0.3, () => order.push('c'));
        show.after(0.1, () => order.push('a'));
        show.after(0.2, () => {
            order.push('b');
            show.after(0.05, () => order.push('d')); // queued from inside the queue
        });
        show.update(0.05, 0.05);
        expect(order).toEqual([]);
        // One long frame crosses all three.
        show.update(0.1, 1);
        expect(order).toEqual(['a', 'b', 'c']);
        expect(show.getState().queued).toBe(1);
        show.update(0.1, 1.1);
        expect(order).toEqual(['a', 'b', 'c', 'd']);
        expect(show.getState().queued).toBe(0);
    });

    it('outlives the simulation: nothing throws once the swarm has been torn down', () => {
        const everything = (show) => {
            show.lock({});
            show.lock({ hardDrop: true, rows: [19], u: 0.2 });
            show.clear({});
            show.clear({
                lines: 3, rows: [19, 18, 17], tspin: true, b2b: true,
            });
            show.clear(QUAD);
            show.clear({ lines: 1, perfect: true });
            show.combo(4);
            show.combo(8, 2);
            show.levelUp(3);
            show.gameOver();
            run(show, 0, 6);
            show.releaseShape();
            show.gameStart();
            show.reset();
        };
        // The fluid failed and was removed mid-run, a formation still held.
        const torn = makeShow();
        torn.show.requestShape('torus', {}, 0.7, 1, 1);
        torn.show.sim = null;
        torn.show.visual = null;
        expect(() => everything(torn.show)).not.toThrow();
        expect(torn.show.requestShape('torus')).toBe(false);
        expect(torn.sim.pushImpulse).not.toHaveBeenCalled();
        // The theme stopped.
        const stopped = makeShow();
        stopped.show.dispose();
        expect(() => everything(stopped.show)).not.toThrow();
        expect(stopped.sim.pushImpulse).not.toHaveBeenCalled();
    });
});
