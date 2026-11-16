/**
 * Void Ember — the living pass, on the CPU: a real VoidEmberWorld in a THREE.Scene, no renderer.
 *
 * What moves by itself (the sky's turn, the ember's old shells, its moods, the belt's rocking, the
 * cinder world's moon, falling stars, the wanderer, stones that fall into the star) and what each
 * event now draws that no other does (jets and a new shell for four lines, a pinwheel for a twist,
 * streamers for a perfect clear, a shower for a new level, a splash for a hard drop, the gutter for
 * a run's end). Contracts and relations, never tuning numbers: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GUTTER_HEAT, REST_RIG, VOID_EMBER_PARTS, VoidEmberWorld, fovForAspect,
} from '../../src/themes/void-ember/void-ember-world.js';
import {
    HUSH_HOLD, REST_HEAT, SHELL_CREEP, SKY_BAND_TILT, SKY_TURN, TAU, skyBandShift,
} from '../../src/themes/void-ember/void-ember-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/void-ember/void-ember-quality.js';
import {
    JET_LIFE, PINWHEEL_LIFE, STREAMER_LIFE,
} from '../../src/themes/void-ember/void-ember-aura.js';
import {
    METEOR_SLOTS, WANDERER_CROSSING, WANDERER_PERIOD, meteorDirection,
} from '../../src/themes/void-ember/void-ember-visitors.js';
import { NOVA_SHELL_LIFE, OLD_SHELLS } from '../../src/themes/void-ember/void-ember-sky.js';
import { fallbackLayout } from '../../src/themes/void-ember/void-ember-composition.js';
import { VOID_EMBER_TETROMINOS } from '../../src/themes/void-ember/void-ember-tetrominos.js';

const COLORS = VOID_EMBER_TETROMINOS.colors;

function makeWorld(quality = 'Minimal', { width = 1600, height = 900, at = 10 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new VoidEmberWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

const lock = (extra = {}) => ({
    player: 0, rows: [12], u: 0.3, hardDrop: false, color: COLORS.J, screen: null, ...extra,
});
const clear = (lines, extra = {}) => ({
    player: 0,
    rows: [19, 18, 17, 16].slice(0, lines),
    lines,
    combo: 1,
    cascade: 1,
    twist: false,
    perfect: false,
    b2b: false,
    screen: null,
    ...extra,
});

/** Rows of a 3 × 3 matrix uniform (three.js stores columns). */
function rows(m) {
    const e = m.elements;
    return [[e[0], e[3], e[6]], [e[1], e[4], e[7]], [e[2], e[5], e[8]]];
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('void ember living: parts and tiers', () => {
    it('adds the aura, the falling stars, the wanderer and the moon to the parts it names', () => {
        const { world } = makeWorld();
        for (const name of ['aura', 'meteors', 'wanderer', 'moon']) {
            expect(VOID_EMBER_PARTS, name).toContain(name);
            expect(world.parts[name]?.mesh, name).toBeTruthy();
        }
        // Each is drawn once: a name is one mesh.
        expect(new Set(VOID_EMBER_PARTS).size).toBe(VOID_EMBER_PARTS.length);
        expect(Object.keys(world.parts).sort()).toEqual([...VOID_EMBER_PARTS].sort());
    });

    it('every tier names how deep its sky is, and a richer tier is never shallower', () => {
        let last = -1;
        QUALITY_NAMES.forEach((name) => {
            const { skyDeep } = QUALITY[name];
            expect(Number.isInteger(skyDeep), name).toBe(true);
            expect(skyDeep).toBeGreaterThanOrEqual(last);
            last = skyDeep;
        });
        expect(QUALITY.Minimal.skyDeep).toBe(0);
    });
});

describe('void ember living: the sky turns and the old shells creep', () => {
    it('hands the shaders a pure rotation whose pole is the band\'s, and the frame\'s axes in it', () => {
        const { world } = makeWorld('Minimal', { at: 123 });
        const m = rows(world.u.skyRot.value);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) expect(dot3(m[i], m[j])).toBeCloseTo(i === j ? 1 : 0, 5);
        }
        // The pole (row 1) leans from straight up by the band's tilt: the band falls to the right.
        const pole = m[1];
        expect(Math.atan2(-pole[0], pole[1])).toBeCloseTo(SKY_BAND_TILT, 5);
        // The frame's right and up, carried into the sky's frame, are the matrix's first columns.
        const right = world.u.skyRight.value;
        const up = world.u.skyUp.value;
        expect([right.x, right.y, right.z]).toEqual([m[0][0], m[1][0], m[2][0]]);
        expect([up.x, up.y, up.z]).toEqual([m[0][1], m[1][1], m[2][1]]);
    });

    it('keeps the band\'s line still while the sky goes round it, a turn in SKY_TURN seconds', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        const poleAt = (t) => {
            settle(world, camera, t);
            return rows(world.u.skyRot.value);
        };
        const a = poleAt(0);
        const b = poleAt(SKY_TURN / 4);
        const c = poleAt(SKY_TURN);
        // The pole does not move; the other two axes have gone a quarter of the way round.
        for (let k = 0; k < 3; k++) expect(b[1][k]).toBeCloseTo(a[1][k], 6);
        expect(dot3(a[0], b[0])).toBeCloseTo(0, 5);
        expect(Math.abs(dot3(a[0], b[2]))).toBeCloseTo(1, 5);
        // A whole turn later it is where it began.
        for (let k = 0; k < 3; k++) expect(c[0][k]).toBeCloseTo(a[0][k], 5);
    });

    it('passes the band through the middle of a wide frame and under the card of an upright one', () => {
        expect(skyBandShift(16 / 9)).toBeCloseTo(0, 6);
        expect(skyBandShift(21 / 9)).toBeCloseTo(0, 6);
        expect(skyBandShift(9 / 19.5)).toBeLessThan(-0.2);
        const wide = makeWorld('Minimal').world;
        const tall = makeWorld('Minimal', { width: 430, height: 932 }).world;
        // Straight ahead lies on the band in a wide frame, above it in an upright one.
        const ahead = [0, 0, -1];
        expect(dot3(rows(wide.u.skyRot.value)[1], ahead)).toBeCloseTo(0, 5);
        expect(dot3(rows(tall.u.skyRot.value)[1], ahead)).toBeGreaterThan(0.15);
    });

    it('creeps the old shells out one place every SHELL_CREEP seconds; reduced motion slows both clocks', () => {
        const { world, camera } = makeWorld('High', { at: 0 });
        settle(world, camera, SHELL_CREEP * 2.5);
        expect(world.u.shellPhase.value).toBeCloseTo(2.5, 6);
        const turned = rows(world.u.skyRot.value)[0];
        world.setReducedMotion(true);
        settle(world, camera, SHELL_CREEP * 2.5);
        expect(world.u.shellPhase.value).toBeLessThan(1);
        expect(world.u.shellPhase.value).toBeGreaterThan(0);
        // The sky has turned less far from where it began.
        settle(world, camera, 0);
        const start = rows(world.u.skyRot.value)[0];
        settle(world, camera, SHELL_CREEP * 2.5);
        const slow = rows(world.u.skyRot.value)[0];
        expect(dot3(start, slow)).toBeGreaterThan(dot3(start, turned));
        // The shells stand inside the frame: the outermost is within a few radii of the star.
        expect(OLD_SHELLS.first * OLD_SHELLS.step ** OLD_SHELLS.count).toBeLessThan(8.5);
        expect(OLD_SHELLS.first).toBeGreaterThan(1.3);
    });
});

describe('void ember living: the ember\'s own moods', () => {
    it('opens and shuts its crust by itself, thinnest on a side that wanders', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        const moods = [];
        const sides = [];
        for (let t = 0; t <= 600; t += 7) {
            settle(world, camera, t);
            const { mood, moodDir } = world.u;
            expect(Math.abs(mood.value)).toBeLessThanOrEqual(1.0001);
            expect(moodDir.value.length()).toBeCloseTo(1, 5);
            moods.push(mood.value);
            sides.push(moodDir.value.clone());
        }
        // It really swells and ebbs, both ways, and the side goes right round.
        expect(Math.max(...moods)).toBeGreaterThan(0.5);
        expect(Math.min(...moods)).toBeLessThan(-0.5);
        expect(Math.min(...sides.map((s) => s.dot(sides[0])))).toBeLessThan(-0.7);
        // The heat the board drives is untouched by it.
        expect(world.heat).toBeCloseTo(REST_HEAT, 6);
    });

    it('rocks the belt\'s plane within a few degrees and keeps its frame a rotation', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        const tilts = [];
        for (let t = 0; t <= 900; t += 11) {
            settle(world, camera, t);
            const m = rows(world.u.beltRot.value);
            const normal = [m[0][1], m[1][1], m[2][1]];
            expect(dot3(normal, normal)).toBeCloseTo(1, 5);
            // How far the plane leans back from edge-on: the normal's share along the line of sight.
            const f = world._f;
            tilts.push(Math.asin(normal[0] * f.x + normal[1] * f.y + normal[2] * f.z) / (Math.PI / 180));
        }
        const rest = world.anchors.beltTilt / (Math.PI / 180);
        expect(Math.max(...tilts)).toBeGreaterThan(rest + 2);
        expect(Math.min(...tilts)).toBeLessThan(rest - 2);
        expect(Math.max(...tilts)).toBeLessThan(rest + 6);
        // Never edge-on: the ring stays a ring.
        expect(Math.min(...tilts)).toBeGreaterThan(4);
    });

    it('sends the cinder world\'s moon round it: beside it, before it and behind it', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        const radius = world.u.worldRadius.value;
        let front = 0;
        let behind = 0;
        for (let t = 0; t <= 200; t += 2) {
            settle(world, camera, t);
            const off = world.u.moonCentre.value.clone().sub(world.u.worldCentre.value);
            const far = off.length() / radius;
            expect(far).toBeGreaterThan(1.3);
            expect(far).toBeLessThan(3.6);
            // Nearer the eye than the world, or further: the eye is at the origin.
            const nearer = world.u.moonCentre.value.length() < world.u.worldCentre.value.length();
            if (nearer) front += 1;
            else behind += 1;
        }
        expect(front).toBeGreaterThan(10);
        expect(behind).toBeGreaterThan(10);
    });
});

describe('void ember living: each great event has a shape of its own', () => {
    it('is nothing at rest: the aura has no size until something happens', () => {
        const { world } = makeWorld();
        expect(world.aura.uniforms.live.value).toBe(0);
        expect(world.u.novaShell.value.y).toBe(0);
    });

    it('four lines: jets out of the poles when the flare goes off, and a new shell after them', () => {
        const { world, camera } = makeWorld();
        const t0 = world.time;
        frame(world, camera, 1 / 60, () => world.onClear(clear(4)));
        const born = world.time + HUSH_HOLD;
        // Nothing during the hush.
        expect(world.aura.uniforms.jets.value.y).toBe(0);
        run(world, camera, HUSH_HOLD + 0.1);
        const jets = world.aura.uniforms.jets.value;
        expect(jets.y).toBeGreaterThan(0.5);
        expect(jets.x).toBeCloseTo(born, 4);
        expect(world.aura.uniforms.live.value).toBe(1);
        // The shell leaves a moment after the jets, in the nova's own fire.
        const shell = world.u.novaShell.value;
        expect(shell.y).toBeGreaterThan(0.5);
        expect(shell.x).toBeGreaterThan(born);
        expect(shell.x - born).toBeLessThan(1);
        // No pinwheel and no streamers: those belong to other events.
        expect(world.aura.uniforms.pinwheel.value.y).toBe(0);
        expect(world.aura.uniforms.streamers.value.y).toBe(0);
        // The jets are over long before the shell is; then the sheet has no size again.
        run(world, camera, JET_LIFE + 0.2, 60);
        expect(world.aura.uniforms.live.value).toBe(0);
        expect(world.time - t0).toBeLessThan(NOVA_SHELL_LIFE);
    });

    it('a twist winds a pinwheel, the other way each time; one that clears nothing winds a small one', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => world.onClear(clear(2, { twist: true })));
        const first = world.aura.uniforms.pinwheel.value.clone();
        expect(first.y).toBeGreaterThan(0.8);
        expect(Math.abs(first.z)).toBe(1);
        expect(first.w).toBeGreaterThanOrEqual(3);
        expect(world.aura.uniforms.jets.value.y).toBe(0);
        run(world, camera, 1);
        frame(world, camera, 1 / 60, () => world.onSpin());
        const second = world.aura.uniforms.pinwheel.value.clone();
        expect(second.z).toBe(-first.z);
        expect(second.y).toBeLessThan(first.y);
        expect(second.x).toBeGreaterThan(first.x);
        run(world, camera, PINWHEEL_LIFE + 0.2, 60);
        expect(world.aura.uniforms.live.value).toBe(0);
    });

    it('a perfect clear opens the corona into streamers in the pieces\' flames, late or with its four', () => {
        // Late (physics sends it after the clear): the crown alone.
        const late = makeWorld();
        frame(late.world, late.camera, 1 / 60, () => late.world.onCrown());
        expect(late.world.aura.uniforms.streamers.value.y).toBeGreaterThan(0.5);
        expect(late.world.aura.uniforms.jets.value.y).toBe(0);
        const shell = late.world.u.novaShell.value;
        expect(shell.y).toBeGreaterThan(0.5);
        // Its shell is not the nova's gold: more blue than red in it.
        expect(late.world.u.novaColor.value.z).toBeGreaterThan(late.world.u.novaColor.value.x);
        // The flames are the pieces' own: six different colours.
        const flames = late.world.aura.uniforms.flames.array.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}`);
        expect(new Set(flames).size).toBe(6);
        // With its four: the jets first, then the crown, exactly once.
        const whole = makeWorld();
        frame(whole.world, whole.camera, 1 / 60, () => whole.world.onClear(clear(4, { perfect: true })));
        run(whole.world, whole.camera, HUSH_HOLD + 0.6);
        expect(whole.world.aura.uniforms.jets.value.y).toBeGreaterThan(0.5);
        expect(whole.world.aura.uniforms.streamers.value.y).toBeGreaterThan(0.5);
        expect(whole.world.counts.crowns).toBe(1);
        run(whole.world, whole.camera, STREAMER_LIFE + 0.5, 120);
        expect(whole.world.aura.uniforms.live.value).toBe(0);
    });

    it('a hard drop splashes: a crown of sparks that the star pulls back; a plain lock does not', () => {
        const { world, camera } = makeWorld('High');
        frame(world, camera, 1 / 60, () => world.onLock(lock()));
        run(world, camera, 1.5);
        expect(world.counts.splashes).toBe(0);
        const pull = world.sparks.geometry.getAttribute('aPull').array;
        expect(pull.every((v) => v === 0)).toBe(true);
        frame(world, camera, 1 / 60, () => world.onLock(lock({ hardDrop: true })));
        run(world, camera, 1.5);
        // One splash for the drop (its heavy comet), whatever its two smaller ones do.
        expect(world.counts.splashes).toBe(1);
        const birth = world.sparks.geometry.getAttribute('aBirth').array;
        let pulled = 0;
        for (let i = 0; i < pull.length / 4; i++) {
            const g = [pull[i * 4], pull[i * 4 + 1], pull[i * 4 + 2]];
            if (g[0] === 0 && g[1] === 0 && g[2] === 0) continue;
            pulled += 1;
            // Pulled toward the star's centre from where it left.
            const out = [birth[i * 4] - world._centre.x, birth[i * 4 + 1] - world._centre.y, birth[i * 4 + 2] - world._centre.z];
            expect(dot3(g, out)).toBeLessThan(0);
        }
        expect(pulled).toBeGreaterThan(10);
    });
});

describe('void ember living: a new level', () => {
    it('sends a shower of falling stars out of one radiant over a couple of seconds; a silent one none', () => {
        const { world, camera } = makeWorld();
        const before = world.meteors.flying(world.time + 0.5);
        frame(world, camera, 1 / 60, () => world.levelUp(2));
        expect(world.counts.showers).toBe(1);
        const path = world.meteors.geometry.getAttribute('aPath').array;
        const births = [];
        for (let i = 0; i < METEOR_SLOTS; i++) if (path[i * 4 + 3] >= world.time - 0.02) births.push(path[i * 4 + 3]);
        expect(births.length).toBeGreaterThanOrEqual(20);
        expect(Math.max(...births) - Math.min(...births)).toBeGreaterThan(0.8);
        expect(Math.max(...births) - world.time).toBeLessThan(3);
        // More of them are in the air a second in than before the level changed.
        expect(world.meteors.flying(world.time + 1)).toBeGreaterThan(before + 4);
        const quiet = makeWorld();
        frame(quiet.world, quiet.camera, 1 / 60, () => quiet.world.levelUp(3, { silent: true }));
        expect(quiet.world.counts.showers).toBe(0);
    });

    it('a shower under reduced motion is a few falling stars, not a storm', () => {
        const { world, camera } = makeWorld();
        world.setReducedMotion(true);
        frame(world, camera, 1 / 60, () => world.levelUp(2));
        const path = world.meteors.geometry.getAttribute('aPath').array;
        let fired = 0;
        for (let i = 0; i < METEOR_SLOTS; i++) if (path[i * 4 + 3] >= world.time - 0.02) fired += 1;
        expect(fired).toBeGreaterThan(3);
        expect(fired).toBeLessThan(12);
    });
});

describe('void ember living: visitors', () => {
    it('a meteor\'s path is a line across the sky: unit directions, from its start along its travel', () => {
        const start = [0, 0, -1];
        const travel = [1, 0, 0];
        const a = meteorDirection(start, travel, 0.4, 0);
        const b = meteorDirection(start, travel, 0.4, 0.5);
        const c = meteorDirection(start, travel, 0.4, 1);
        [a, b, c].forEach((d) => expect(Math.hypot(...d)).toBeCloseTo(1, 6));
        expect(a).toEqual([0, 0, -1]);
        expect(b[0]).toBeGreaterThan(0);
        expect(c[0]).toBeGreaterThan(b[0]);
        // Its far end is the angle whose tangent is the arc.
        expect(Math.atan2(c[0], -c[2])).toBeCloseTo(Math.atan(0.4), 6);
    });

    it('falling stars cross by themselves, and the same ones in another world at the same clock', () => {
        const a = makeWorld('Minimal', { at: 0 });
        const b = makeWorld('Minimal', { at: 0 });
        run(a.world, a.camera, 90, 900);
        run(b.world, b.camera, 90, 300);
        const pa = a.world.meteors.geometry.getAttribute('aPath').array;
        const pb = b.world.meteors.geometry.getAttribute('aPath').array;
        expect(Array.from(pa)).toEqual(Array.from(pb));
        let fired = 0;
        for (let i = 0; i < METEOR_SLOTS; i++) if (pa[i * 4 + 3] > -50) fired += 1;
        expect(fired).toBeGreaterThanOrEqual(5);
        // Each start is a unit direction, and its travel is square to it.
        const ra = a.world.meteors.geometry.getAttribute('aRun').array;
        for (let i = 0; i < METEOR_SLOTS; i++) {
            if (pa[i * 4 + 3] <= -50) continue;
            const s = [pa[i * 4], pa[i * 4 + 1], pa[i * 4 + 2]];
            const tr = [ra[i * 4], ra[i * 4 + 1], ra[i * 4 + 2]];
            expect(Math.hypot(...s)).toBeCloseTo(1, 4);
            expect(Math.hypot(...tr)).toBeCloseTo(1, 4);
            expect(dot3(s, tr)).toBeCloseTo(0, 4);
        }
    });

    it('the wanderer comes round every WANDERER_PERIOD on a path of its own, and a seek finds it', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        const seen = [];
        for (let cycle = 1; cycle <= 6; cycle++) {
            settle(world, camera, cycle * WANDERER_PERIOD + 10);
            const path = world.wanderer.uniforms.path.value;
            const runRow = world.wanderer.uniforms.run.value;
            const look = world.wanderer.uniforms.look.value;
            // In the sky now: born before this moment and not yet across.
            expect(look.w).toBeGreaterThan(WANDERER_CROSSING * 0.8);
            expect(look.w).toBeLessThan(WANDERER_CROSSING * 1.2);
            expect(world.time - path.w).toBeGreaterThan(-WANDERER_PERIOD);
            const s = [path.x, path.y, path.z];
            const tr = [runRow.x, runRow.y, runRow.z];
            expect(Math.hypot(...s)).toBeCloseTo(1, 5);
            expect(Math.hypot(...tr)).toBeCloseTo(1, 5);
            expect(dot3(s, tr)).toBeCloseTo(0, 5);
            // It crosses a good part of the frame.
            expect(runRow.w).toBeGreaterThan(0.4);
            seen.push(`${path.x.toFixed(2)},${path.y.toFixed(2)},${runRow.x.toFixed(2)},${runRow.y.toFixed(2)}`);
        }
        expect(new Set(seen).size).toBeGreaterThanOrEqual(4);
        // The same clock, the same wanderer.
        const again = makeWorld('Minimal', { at: 3 * WANDERER_PERIOD + 10 });
        settle(world, camera, 3 * WANDERER_PERIOD + 10);
        expect(again.world.wanderer.uniforms.path.value.toArray()).toEqual(world.wanderer.uniforms.path.value.toArray());
    });

    it('while play is easy a stone falls out of the belt into the star now and then, and marks it', () => {
        const { world, camera } = makeWorld('Minimal', { at: 0 });
        run(world, camera, 200, 2000);
        expect(world.counts.grazers).toBeGreaterThanOrEqual(2);
        // Each one landed: a mark on the photosphere, and nothing of the board's (no loop, no lock).
        expect(world.impactCursor).toBeGreaterThanOrEqual(world.counts.grazers - 1);
        expect(world.counts.locks).toBe(0);
        expect(world.loops.litCount(world.time, 0, 24)).toBe(0);
    });
});

describe('void ember living: a run ends and another begins', () => {
    it('gutters: the fire sinks into the cracks, the wind dies, and what it held flies', () => {
        const { world, camera } = makeWorld('High');
        for (let i = 0; i < 4; i++) {
            frame(world, camera, 1 / 60, () => world.onLock(lock({ u: 0.1 + i * 0.2 })));
            run(world, camera, 0.6);
        }
        world.levelUp(4, { silent: true });
        run(world, camera, 1);
        expect(world.loops.litCount(world.time, 0, 24)).toBeGreaterThan(2);
        const windBefore = world.wind.uniforms.emit.value;
        frame(world, camera, 1 / 60, () => world.onGameOver());
        expect(world.counts.gameOvers).toBe(1);
        expect(world.gutter()).toBeLessThan(0.1);
        // The run's own state is over at once.
        expect(world.level).toBe(1);
        expect(world.combo).toBe(0);
        // Every loop it held is leaving.
        expect(world.loops.litCount(world.time + 0.5, 0, 24)).toBe(0);
        run(world, camera, 6);
        expect(world.gutter()).toBeCloseTo(1, 3);
        expect(world.heat).toBeLessThan(REST_HEAT - 0.08);
        expect(world.heat).toBeGreaterThanOrEqual(GUTTER_HEAT - 1e-6);
        expect(world.wind.uniforms.emit.value).toBeLessThan(windBefore * 0.4);
        expect(world.u.breath.value).toBeLessThan(0.8);
    });

    it('a new run blows it back to life; left alone it finds its own breath again', () => {
        const blown = makeWorld('Minimal');
        frame(blown.world, blown.camera, 1 / 60, () => blown.world.onGameOver());
        run(blown.world, blown.camera, 5);
        expect(blown.world.gutter()).toBeCloseTo(1, 3);
        // A reset in between (the menu) keeps the gutter: the coal does not pop back.
        blown.world.resetSession();
        expect(blown.world.gutter()).toBeCloseTo(1, 3);
        frame(blown.world, blown.camera, 1 / 60, () => blown.world.onSessionStart());
        run(blown.world, blown.camera, 12);
        expect(blown.world.gutter()).toBe(0);
        expect(blown.world.heat).toBeGreaterThan(REST_HEAT - 0.02);
        expect(blown.world.u.breath.value).toBeGreaterThan(0.95);
        // Left alone: it comes back by itself, later.
        const alone = makeWorld('Minimal');
        frame(alone.world, alone.camera, 1 / 60, () => alone.world.onGameOver());
        run(alone.world, alone.camera, 8);
        expect(alone.world.gutter()).toBeGreaterThan(0.9);
        run(alone.world, alone.camera, 30, 600);
        expect(alone.world.gutter()).toBe(0);
        expect(alone.world.heat).toBeGreaterThan(REST_HEAT - 0.02);
        // A new run with nothing guttered is nothing at all.
        const fresh = makeWorld('Minimal');
        const { flash } = fresh.world;
        fresh.world.onSessionStart();
        expect(fresh.world.flash).toBe(flash);
    });

    it('a seek and a replay still agree with every visitor and mood in play', () => {
        const shot = (world) => ({
            heat: world.heat,
            mood: world.u.mood.value,
            sky: world.u.skyRot.value.toArray(),
            belt: world.u.beltRot.value.toArray(),
            moon: world.u.moonCentre.value.toArray(),
            wanderer: world.wanderer.uniforms.path.value.toArray(),
            shell: world.u.shellPhase.value,
        });
        const a = makeWorld('Minimal', { at: 300 });
        const b = makeWorld('Minimal', { at: 300 });
        run(a.world, a.camera, 20, 200);
        run(b.world, b.camera, 20, 200);
        expect(shot(a.world)).toEqual(shot(b.world));
        // And a world sought straight to that moment stands where the replay did.
        const c = makeWorld('Minimal', { at: a.world.time });
        const direct = shot(c.world);
        const replay = shot(a.world);
        expect(direct.sky.map((v) => +v.toFixed(5))).toEqual(replay.sky.map((v) => +v.toFixed(5)));
        expect(direct.belt.map((v) => +v.toFixed(5))).toEqual(replay.belt.map((v) => +v.toFixed(5)));
        expect(direct.shell).toBeCloseTo(replay.shell, 5);
        expect(direct.mood).toBeCloseTo(replay.mood, 5);
        expect(TAU).toBeGreaterThan(6);
    });
});
