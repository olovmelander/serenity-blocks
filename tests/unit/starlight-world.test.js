/**
 * Starlight — the world's choreography, run without a renderer: a scene, a camera, and the world
 * driven in fixed steps (camera, then events, then the frame, as the theme does).
 *
 * Nothing here pins a gain, a width, a colour or a duration: the look is still being tuned.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, STARLIGHT_PARTS, StarlightWorld, fovForAspect,
} from '../../src/themes/starlight/starlight-world.js';
import {
    DEG, EXPOSURE_MAX, FIGURES, FIGURES_KEPT, HOUR_SECONDS, HOUR_SWING, LINES_PER_ROW, PALETTES, SKY_RATE,
    SKY_START, TAU, TSPIN_SWING,
} from '../../src/themes/starlight/starlight-core.js';
import { RINGS, STREAKS } from '../../src/themes/starlight/starlight-tsl.js';
import { cardUnion, fallbackLayout } from '../../src/themes/starlight/starlight-composition.js';

vi.setConfig({ testTimeout: 30_000 }); // every test builds a sky, on a machine that may be busy

const START = 10;
const worlds = [];

function step(world, camera, from, to, dt = 1 / 30) {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const sim = {
            time: from + i * h, delta: h, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, live = true, start = START, capture = true,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StarlightWorld({ scene, quality, capture }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(live ? fallbackLayout(width, height) : null, aspect);
    world.seek(start);
    step(world, camera, start, start + 0.1);
    return { scene, camera, world };
}

const liveRings = (world) => world.u.tables.rings.filter((row, i) => i % 2 === 0 && row.w > 0).length;
const litStars = (figure) => figure.stars.filter((star) => star.at !== Infinity).length;
const lock = (world, i = 0, extra = {}) => world.onLock({
    rows: [19 - (i % 6), 18 - (i % 6)], u: ((i * 0.37) % 1) * 0.9 + 0.05, color: '#93ffe8', ...extra,
});

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
    vi.restoreAllMocks();
});

describe('StarlightWorld build', () => {
    it('builds every named part, on every tier', () => {
        ['Minimal', 'High'].forEach((quality) => {
            const { world, scene } = makeWorld(quality);
            expect([...world.parts.keys()]).toEqual(STARLIGHT_PARTS);
            world.parts.forEach((object) => expect(object.parent).toBe(world.root));
            expect(world.root.parent).toBe(scene);
            expect(world.getState().stars).toBe(world.tier.stars);
        });
    });

    it('draws only the parts it is asked for', () => {
        const { world } = makeWorld();
        world.showOnlyParts(['sky', 'figures']);
        expect(world.parts.get('sky').visible).toBe(true);
        expect(world.parts.get('figures').visible).toBe(true);
        expect(world.parts.get('stars').visible).toBe(false);
        expect(world.parts.get('streaks').visible).toBe(false);
    });

    it('leaves the scene clean when disposed', () => {
        const { world, scene } = makeWorld();
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(world.parts.size).toBe(0);
    });

    it('opens the lens on a tall screen and looks up from the lake', () => {
        expect(fovForAspect(16 / 9)).toBe(REST_RIG.fov);
        expect(fovForAspect(0.5)).toBeGreaterThan(REST_RIG.fov);
        expect(fovForAspect(0.2)).toBeLessThanOrEqual(76);
        expect(REST_RIG.pitch).toBeGreaterThan(0.1);
        expect(REST_RIG.far).toBeGreaterThan(6000);
    });
});

describe('StarlightWorld composition', () => {
    it('stands the pole in the free space left of the card', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080 });
        const card = cardUnion(fallbackLayout(1920, 1080));
        const state = world.getState();
        expect(state.poleBeside).toBe(true);
        expect(state.poleScreenX).toBeGreaterThan(0.08);
        expect(state.poleScreenX).toBeLessThan(card.x0 - 0.05);
        // The pole itself is where the uniforms say, above the horizon, left of the lens.
        expect(world.u.pole.value.y).toBeGreaterThan(0.3);
        expect(world.u.pole.value.x).toBeLessThan(0);
        expect(world.u.pole.value.length()).toBeCloseTo(1, 6);
    });

    it('stands it behind the card when a narrow screen leaves no room beside it', () => {
        const { world } = makeWorld('Low', { width: 320, height: 700 });
        const state = world.getState();
        expect(state.poleBeside).toBe(false);
        expect(state.poleScreenX).toBe(0.5);
        expect(Math.abs(world.u.pole.value.x)).toBeLessThan(1e-6);
    });

    it('composes for the solo layout when no board is on screen', () => {
        const { world } = makeWorld('Low', { live: false });
        expect(world.layout).toBeNull();
        expect(world.layoutNow().cards).toHaveLength(1);
        expect(() => lock(world)).not.toThrow();
    });
});

describe('StarlightWorld: the sky turns', () => {
    it('turns with the clock alone, at its own pace', () => {
        const { world, camera } = makeWorld();
        const a0 = world.skyAngle;
        step(world, camera, START + 0.1, START + 60.1);
        expect(world.skyAngle - a0).toBeCloseTo(60 * SKY_RATE, 5);
        // A seek stands the sky where the clock alone would have carried it.
        world.seek(500);
        expect(world.skyAngle).toBeCloseTo(SKY_START + 500 * SKY_RATE, 9);
    });

    it('hands the GPU an angle that stays small however long the night', () => {
        const { world, camera } = makeWorld('Low', { start: 30000 });
        step(world, camera, 30000.1, 30001);
        expect(Math.abs(world.u.skyAngle.value)).toBeLessThanOrEqual(TAU);
        expect(Number.isFinite(world.u.exposure.value)).toBe(true);
    });

    it('swings an hour on at a new level, and takes the next hour\'s light', () => {
        const { world, camera } = makeWorld();
        const a0 = world.skyAngle;
        world.levelUp(2);
        step(world, camera, START + 0.1, START + 0.6);
        // In the middle of the swing every star draws a trail.
        expect(world.getState().exposureDeg).toBeGreaterThan(1);
        step(world, camera, START + 0.6, START + 8.1);
        expect(world.skyAngle - a0).toBeCloseTo(HOUR_SWING + 8 * SKY_RATE, 3);
        expect(world.getState().exposureDeg).toBeLessThan(0.2);
        expect(world.level).toBe(2);
        expect(world.hourShift).toBeGreaterThan(0.9);
    });

    it('stands on a level at once when told to do it silently', () => {
        const { world } = makeWorld();
        const a0 = world.skyAngle;
        world.levelUp(4, { silent: true });
        expect(world.level).toBe(4);
        expect(world.hourShift).toBe(3);
        expect(world.skyAngle - a0).toBeCloseTo(3 * HOUR_SWING, 9);
        expect(world.turnDebt).toBe(0);
    });

    it('whirls on a T-spin without ever jumping', () => {
        [START, 1800].forEach((start) => {
            const { world, camera } = makeWorld('Low', { start });
            const a0 = world.skyAngle;
            let worst = 0;
            let last = world.skyAngle;
            let t = start + 0.1;
            // A rapid chain of T-spins, sixty frames a second.
            for (let i = 0; i < 240; i += 1) {
                if (i % 20 === 0) {
                    lock(world, i);
                    world.onClear({ rows: [19, 18], lines: 2, tspin: true });
                    world.onCombo(i / 20 + 1);
                }
                step(world, camera, t, t + 1 / 60, 1 / 60);
                t += 1 / 60;
                worst = Math.max(worst, Math.abs(world.skyAngle - last));
                last = world.skyAngle;
            }
            // The sky has whirled far, but never more than a few degrees in one frame, and no
            // further in an old session than in a new one.
            expect(world.skyAngle - a0).toBeGreaterThan(TSPIN_SWING * 6);
            expect(worst).toBeLessThan(4 * DEG);
        });
    });
});

describe('StarlightWorld: the light of the hour', () => {
    it('moves with the clock alone, whatever the level', () => {
        const { world, camera } = makeWorld('Low', { start: 0 });
        expect(world.getState().hour).toBe(PALETTES[0].name);
        const first = world.u.horizon.value.clone();
        // No gameplay at all: within a minute the light has left the hour it began on.
        step(world, camera, 0.1, 60, 0.5);
        expect(world.getState().level).toBe(1);
        expect(world.getState().hourTurn).toBeGreaterThan(0.3);
        expect(world.u.horizon.value.distanceTo(first)).toBeGreaterThan(0.005);
        // One step later it stands on the next hour.
        step(world, camera, 60, HOUR_SECONDS + 2, 0.5);
        expect(world.getState().hour).toBe(PALETTES[1].name);
        expect(world.getState().hourTurn).toBeLessThan(0.05);
        expect(world.getState().level).toBe(1);
    });

    it('adds a level\'s step on top of where the clock has carried it', () => {
        const { world, camera } = makeWorld('Low', { start: HOUR_SECONDS + 2 });
        expect(world.getState().hour).toBe(PALETTES[1].name);
        world.levelUp(2);
        step(world, camera, HOUR_SECONDS + 2.1, HOUR_SECONDS + 14);
        // Clock (one hour) + level (one hour) = the third hour, and still turning.
        expect(world.getState().hour).toBe(PALETTES[2].name);
        expect(world.wheel()).toBeGreaterThan(2);
    });

    it('goes all the way round the wheel and comes back', () => {
        const { world } = makeWorld();
        const names = new Set();
        for (let i = 0; i < PALETTES.length; i += 1) {
            world.seek(i * HOUR_SECONDS + 1);
            names.add(world.getState().hour);
        }
        expect(names.size).toBe(PALETTES.length);
        world.seek(PALETTES.length * HOUR_SECONDS + 1);
        expect(world.getState().hour).toBe(PALETTES[0].name);
    });
});

describe('StarlightWorld: a lock kindles a star', () => {
    it('begins a figure, sends a mote to its first star and a ring out over the lake', () => {
        const { world, camera } = makeWorld();
        expect(world.current).toBeNull();
        expect(liveRings(world)).toBe(0);
        lock(world);
        const figure = world.current;
        expect(figure).toBeTruthy();
        expect(FIGURES.map((f) => f.name)).toContain(figure.name);
        expect(world.getState().streaks).toBe(1);
        // The star is lit when the mote arrives, not before.
        expect(figure.stars[0].at).toBeGreaterThan(world.time);
        step(world, camera, START + 0.1, START + 0.4);
        expect(liveRings(world)).toBe(1);
        const ring = world.u.tables.rings[0];
        // Out on the lake, in front of the lens.
        expect(ring.y).toBeLessThan(-8);
        expect(ring.z).toBeGreaterThan(0.6);
        step(world, camera, START + 0.4, START + 1.4);
        expect(litStars(figure)).toBe(1);
        expect(figure.stars[0].at).toBeLessThanOrEqual(world.time);
    });

    it('lights one star per lock, in the figure\'s own order', () => {
        const { world, camera } = makeWorld();
        let t = START + 0.1;
        for (let i = 0; i < 4; i += 1) {
            lock(world, i);
            step(world, camera, t, t + 0.5);
            t += 0.5;
        }
        const figure = world.current;
        expect(litStars(figure)).toBe(4);
        expect(figure.stars.slice(0, 4).every((star) => star.at !== Infinity)).toBe(true);
        expect(world.getState().figureLit).toBe(4);
    });

    it('places every star of a figure in the frame, above the hills and clear of the card', () => {
        [[1600, 900], [1920, 1080], [2560, 1080]].forEach(([width, height]) => {
            const { world, camera } = makeWorld('Low', { width, height });
            const card = cardUnion(fallbackLayout(width, height));
            let t = START + 0.1;
            for (let n = 0; n < 4; n += 1) {
                lock(world, n);
                world.onClear({ rows: [19, 18, 17, 16], lines: 4 }); // finishes the figure
                step(world, camera, t, t + 3);
                t += 3;
            }
            world.figures.filter((f) => f.on).forEach((figure) => {
                figure.stars.forEach((star) => {
                    const d = world.skyNow(star.rho, star.theta, [0, 0, 0]);
                    const at = world.screenOf(d, { x: 0, y: 0, front: true });
                    expect(d[1], figure.name).toBeGreaterThan(0.1);
                    expect(at.front).toBe(true);
                    const inCard = at.x > card.x0 && at.x < card.x1 && at.y > card.y0 && at.y < card.y1;
                    const where = `${figure.name} at ${at.x.toFixed(2)},${at.y.toFixed(2)} on ${width}x${height}`;
                    expect(inCard, where).toBe(false);
                });
            });
        });
    });

    it('throws a wider, stronger ring and jolts the lens on a hard drop', () => {
        const soft = makeWorld();
        lock(soft.world);
        step(soft.world, soft.camera, START + 0.1, START + 0.6);
        const hard = makeWorld();
        lock(hard.world, 0, { hardDrop: true });
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
        step(hard.world, hard.camera, START + 0.1, START + 0.6);
        expect(hard.world.u.tables.rings[0].w).toBeGreaterThan(soft.world.u.tables.rings[0].w);
        expect(hard.world.u.tables.rings[0].z).toBeGreaterThan(soft.world.u.tables.rings[0].z);
    });

    it('survives a hard drop on every piece without flooding the lake', () => {
        const { world, camera } = makeWorld();
        let t = START + 0.1;
        for (let i = 0; i < 30; i += 1) {
            lock(world, i, { hardDrop: true });
            step(world, camera, t, t + 0.35);
            t += 0.35;
        }
        expect(liveRings(world)).toBeLessThanOrEqual(RINGS);
        expect(world.getState().streaks).toBeLessThanOrEqual(STREAKS);
        world.u.tables.rings.forEach((row) => row.toArray().forEach((v) => expect(Number.isFinite(v)).toBe(true)));
    });

    it('takes the piece\'s colour, and a light of its own when the colour is not a hex', () => {
        const { world } = makeWorld();
        const teal = world.colourOf('#93ffe8').slice();
        expect(teal[1]).toBeGreaterThan(teal[0]);
        const plain = world.colourOf('teal').slice();
        plain.forEach((v) => expect(v).toBeGreaterThan(0.5));
        // A dark colour is lifted so it still reads against the night.
        expect(Math.max(...world.colourOf('#101030'))).toBeGreaterThan(0.6);
    });
});

describe('StarlightWorld: a clear draws the figure', () => {
    it('draws two lines for every row, and lights the stars they need', () => {
        const { world, camera } = makeWorld();
        lock(world);
        step(world, camera, START + 0.1, START + 1);
        const figure = world.current;
        world.onClear({ rows: [19], lines: 1 });
        expect(figure.drawn).toBe(Math.min(LINES_PER_ROW, figure.lines.length));
        world.onClear({ rows: [19, 18], lines: 2 });
        expect(figure.drawn).toBe(Math.min(3 * LINES_PER_ROW, figure.lines.length));
        // A line never hangs from a dark star.
        for (let i = 0; i < figure.drawn; i += 1) {
            const line = figure.lines[i];
            expect(figure.stars[line.a].at).not.toBe(Infinity);
            expect(figure.stars[line.b].at).not.toBe(Infinity);
        }
    });

    it('sends a shooting star across the sky for every row', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        step(world, camera, START + 0.1, START + 0.55);
        expect(world.getState().streaks).toBe(3);
        // They are gone again a moment later.
        step(world, camera, START + 0.55, START + 3);
        expect(world.getState().streaks).toBe(0);
    });

    it('finishes the figure on four lines, flares it and keeps it in the sky', () => {
        const { world, camera } = makeWorld();
        lock(world);
        const figure = world.current;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(figure.drawn).toBe(figure.lines.length);
        expect(litStars(figure)).toBe(figure.stars.length);
        expect(figure.done).toBeGreaterThan(world.time);
        // It is no longer the figure being drawn: the next lock begins another.
        expect(world.current).toBeNull();
        step(world, camera, START + 0.1, figure.done + 0.1);
        expect(figure.flare).toBeGreaterThan(0.5);
        expect(figure.on).toBe(true);
        lock(world, 1);
        expect(world.current).not.toBe(figure);
        expect(world.current.slot).not.toBe(figure.slot);
        expect(world.getState().figuresKept).toBe(2);
    });

    it('sends a fireball over the sky on four lines: it lights the air, lands, and bends the lens', () => {
        const { world, camera } = makeWorld();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(world, camera, START + 0.1, START + 0.9);
        expect(world.fireball).toBeTruthy();
        expect(world.u.flash.value.w).toBeGreaterThan(0.5);
        expect(world.getPostState().flash).toBeGreaterThan(0);
        expect(world.getPostState().exposure).toBeLessThan(1);
        expect(world.surge).toBeGreaterThan(0.3);
        const landed = world.fireball.t0 + world.fireball.duration;
        step(world, camera, START + 0.9, landed + 0.5);
        expect(world.getPostState().ripple.strength).toBeGreaterThan(0);
        step(world, camera, landed + 0.5, landed + 4);
        expect(world.fireball).toBeNull();
        expect(world.u.flash.value.w).toBe(0);
        expect(world.getPostState().ripple.strength).toBe(0);
    });

    it('answers a perfect clear with a storm of shooting stars', () => {
        const quad = makeWorld();
        quad.world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const perfect = makeWorld();
        perfect.world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        expect(perfect.world.scheduled.length).toBeGreaterThan(quad.world.scheduled.length + 5);
    });

    it('never keeps more figures than the sky has room for, and lets the oldest go', () => {
        const { world, camera } = makeWorld();
        let t = START + 0.1;
        const names = [];
        for (let n = 0; n < FIGURES_KEPT + 4; n += 1) {
            lock(world, n);
            names.push(world.current.name);
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            step(world, camera, t, t + 4);
            t += 4;
            expect(world.figures.filter((f) => f.on).length).toBeLessThanOrEqual(FIGURES_KEPT);
        }
        // Every figure was a different one, and the sky is not empty.
        expect(new Set(names).size).toBe(names.length);
        expect(world.getState().figuresKept).toBeGreaterThanOrEqual(2);
        expect(world.getState().figuresDone).toBe(FIGURES_KEPT + 4);
    });
});

describe('StarlightWorld: the chain opens the shutter', () => {
    it('draws longer trails the longer the chain, and closes slowly when it breaks', () => {
        const { world, camera } = makeWorld();
        expect(world.u.exposure.value).toBe(0);
        let t = START + 0.1;
        let last = 0;
        [2, 4, 7, 12].forEach((combo) => {
            world.onCombo(combo);
            step(world, camera, t, t + 6);
            t += 6;
            expect(world.u.exposure.value).toBeGreaterThan(last);
            last = world.u.exposure.value;
        });
        expect(last).toBeLessThanOrEqual(EXPOSURE_MAX);
        expect(world.u.shutter.value).toBeGreaterThan(0.8);
        // The chain breaks: a second later the trails are still there, ten seconds later gone.
        world.onCombo(0);
        step(world, camera, t, t + 1);
        expect(world.u.exposure.value).toBeGreaterThan(last * 0.5);
        step(world, camera, t + 1, t + 14);
        expect(world.u.exposure.value).toBeLessThan(0.01);
    });

    it('draws a star as one quad until the shutter opens, and as a trail while it is open', () => {
        const { world, camera } = makeWorld();
        const drawn = (trails) => world.parts.get('stars').children
            .filter((mesh) => mesh.visible && mesh.name.endsWith('-trails') === trails).length;
        expect(drawn(false)).toBe(2);
        expect(drawn(true)).toBe(0);
        world.onCombo(5);
        step(world, camera, START + 0.1, START + 2);
        expect(drawn(true)).toBe(2);
        expect(drawn(false)).toBe(0);
        world.onCombo(0);
        step(world, camera, START + 2, START + 40);
        expect(drawn(false)).toBe(2);
    });

    it('turns the sky faster while the shutter is open, and thickens the shower', () => {
        const calm = makeWorld();
        step(calm.world, calm.camera, START + 0.1, START + 20.1);
        const chain = makeWorld();
        chain.world.onCombo(9);
        step(chain.world, chain.camera, START + 0.1, START + 20.1);
        expect(chain.world.skyAngle).toBeGreaterThan(calm.world.skyAngle + 5 * SKY_RATE);
        expect(chain.world.cursor.streak).toBeGreaterThan(calm.world.cursor.streak);
    });

    it('draws shorter trails for someone who asked for less motion', () => {
        const full = makeWorld();
        full.world.onCombo(8);
        step(full.world, full.camera, START + 0.1, START + 8);
        const calm = makeWorld();
        calm.world.setReducedMotion(true);
        calm.world.onCombo(8);
        step(calm.world, calm.camera, START + 0.1, START + 8);
        expect(calm.world.u.exposure.value).toBeLessThan(full.world.u.exposure.value * 0.5);
        // …and holds the lens still.
        expect(calm.camera.rotation.y).toBe(0);
        expect(calm.camera.rotation.x).toBe(REST_RIG.pitch);
    });
});

describe('StarlightWorld: a session', () => {
    it('replays to the same frame after a seek', () => {
        const play = (world, camera) => {
            world.seek(START);
            step(world, camera, START, START + 0.1);
            lock(world, 0);
            lock(world, 1, { hardDrop: true });
            world.onClear({ rows: [19], lines: 1 });
            world.onCombo(3);
            step(world, camera, START + 0.1, START + 2.5, 1 / 60);
            return JSON.stringify({
                sky: world.skyAngle,
                exposure: world.u.exposure.value,
                streaks: world.u.tables.streaks.map((row) => row.toArray()),
                rings: world.u.tables.rings.map((row) => row.toArray()),
                figures: world.u.tables.figures.map((row) => row.toArray()),
                horizon: world.u.horizon.value.toArray(),
            });
        };
        const { world, camera } = makeWorld();
        const first = play(world, camera);
        world.seek(900);
        step(world, camera, 900, 903);
        expect(play(world, camera)).toBe(first);
    });

    it('lets its figures go and closes the shutter when a new run begins', () => {
        const { world, camera } = makeWorld();
        lock(world);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        step(world, camera, START + 0.1, START + 4);
        expect(world.getState().figuresKept).toBe(1);
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.level).toBe(1);
        expect(world.current).toBeNull();
        expect(world.getState().figuresKept).toBe(0);
        step(world, camera, START + 4, START + 20);
        expect(world.figures.every((f) => !f.on)).toBe(true);
        expect(world.u.exposure.value).toBeLessThan(0.01);
        // The clock goes on: a new run does not turn the night back.
        expect(world.time).toBeCloseTo(START + 20, 6);
    });

    it('reports what it is doing', () => {
        const { world, camera } = makeWorld('Medium');
        lock(world);
        world.onCombo(4);
        step(world, camera, START + 0.1, START + 2);
        const state = world.getState();
        expect(state).toMatchObject({
            quality: 'Medium', combo: 4, level: 1, hour: PALETTES[0].name, figuresKept: 1, figureLit: 1,
        });
        expect(state.shutter).toBeGreaterThan(0);
        expect(state.exposureDeg).toBeGreaterThan(0);
        expect(state.figure).toBe(world.current.name);
        expect(world.getPostState()).toHaveProperty('ripple');
    });
});
